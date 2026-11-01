'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var OrbitDaily = require('../daily-orbit.js');

var DAY = '2026-11-01';
var OTHER_DAY = '2026-11-02';
var TAU = Math.PI * 2;

function memoryStorage(seed) {
  var map = new Map();
  if (seed) {
    Object.keys(seed).forEach(function (k) { map.set(k, seed[k]); });
  }
  return {
    _map: map,
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); }
  };
}

function throwingStorage() {
  return {
    getItem: function () { throw new Error('storage blocked'); },
    setItem: function () { throw new Error('storage blocked'); }
  };
}

test('public API shape and DURATION', function () {
  assert.deepEqual(Object.keys(OrbitDaily).sort(),
    ['DURATION', 'buildCourse', 'readBest', 'recordBest', 'utcDay']);
  assert.equal(OrbitDaily.DURATION, 60);
});

test('utcDay formats the UTC day across midnight boundaries', function () {
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 10, 1, 0, 0, 0, 0))), '2026-11-01');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 10, 1, 23, 59, 59, 999))), '2026-11-01');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 10, 2, 0, 0, 0, 0))), '2026-11-02');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 0, 5, 12, 0, 0))), '2026-01-05');
  // A fixed instant maps to exactly one UTC day regardless of local timezone.
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 2, 29, 0, 30, 0))), '2026-03-29');
});

test('utcDay handles year rollover', function () {
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999))), '2026-12-31');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2027, 0, 1, 0, 0, 0, 0))), '2027-01-01');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(1999, 11, 31, 23, 59, 59, 999))), '1999-12-31');
  assert.equal(OrbitDaily.utcDay(new Date(Date.UTC(2000, 0, 1, 0, 0, 0, 0))), '2000-01-01');
});

test('utcDay defaults to today and rejects invalid input', function () {
  assert.equal(OrbitDaily.utcDay(), OrbitDaily.utcDay(new Date()));
  assert.match(OrbitDaily.utcDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(function () { OrbitDaily.utcDay(new Date(NaN)); }, TypeError);
  assert.throws(function () { OrbitDaily.utcDay('2026-11-01'); }, TypeError);
  assert.throws(function () { OrbitDaily.utcDay(null); }, TypeError);
  assert.throws(function () { OrbitDaily.utcDay(1790000000000); }, TypeError);
});

test('buildCourse is reproducible and returns independent copies', function () {
  var a = OrbitDaily.buildCourse(DAY);
  var b = OrbitDaily.buildCourse(DAY);
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  assert.deepEqual(a, b);
  a[0].at = -999;
  a.push({ at: 99, angle: 0, spin: 0, kind: 'rock' });
  assert.deepEqual(OrbitDaily.buildCourse(DAY), b);
});

test('buildCourse produces different courses on different days', function () {
  var seen = new Set();
  ['2026-11-01', '2026-11-02', '2026-11-03', '2026-12-31', '2027-01-01', '1999-12-31']
    .forEach(function (day) {
      var json = JSON.stringify(OrbitDaily.buildCourse(day));
      assert.ok(!seen.has(json), 'course must differ for ' + day);
      seen.add(json);
    });
});

test('buildCourse never calls Math.random', function () {
  var baseline = OrbitDaily.buildCourse(DAY);
  var original = Math.random;
  try {
    Math.random = function () { throw new Error('Math.random must not be used'); };
    assert.deepEqual(OrbitDaily.buildCourse(DAY), baseline);
    Math.random = function () { return 0.5; };
    assert.deepEqual(OrbitDaily.buildCourse(DAY), baseline);
  } finally {
    Math.random = original;
  }
});

test('buildCourse event shape, order and timing boundaries', function () {
  ['2026-11-01', '2024-02-29', '2027-01-01'].forEach(function (day) {
    var events = OrbitDaily.buildCourse(day);
    assert.ok(events.length >= 40 && events.length <= 200,
      'sane event count for ' + day + ': ' + events.length);
    assert.equal(events[0].at, 1.1, 'first spawn at 1.1 s');
    var crystals = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      assert.deepEqual(Object.keys(e).sort(), ['angle', 'at', 'kind', 'spin']);
      assert.ok(e.at >= 1.1 && e.at < 57, 'spawn time inside [1.1, 57): ' + e.at);
      assert.ok(e.angle >= 0 && e.angle < TAU, 'angle inside [0, 2pi): ' + e.angle);
      assert.ok(e.spin >= 0 && e.spin < TAU, 'spin inside [0, 2pi): ' + e.spin);
      assert.ok(e.kind === 'rock' || e.kind === 'crystal', 'kind is rock or crystal');
      if (e.kind === 'crystal') crystals++;
      if (i > 0) {
        var gap = e.at - events[i - 1].at;
        assert.ok(gap > 0, 'events strictly ordered by time');
        assert.ok(gap >= 0.45 && gap <= 1.26, 'gap within interval formula bounds: ' + gap);
        if (events[i - 1].at >= 30) {
          assert.ok(gap <= 0.79, 'difficulty ramp caps the gap once at >= 30 s: ' + gap);
        }
      }
    }
    var last = events[events.length - 1];
    assert.ok(last.at >= 56.2, 'spawning runs right up to the 57 s cutoff: ' + last.at);
    var fraction = crystals / events.length;
    assert.ok(fraction > 0.1 && fraction < 0.5,
      'crystal fraction plausible for ' + day + ': ' + fraction);
  });
});

test('buildCourse rejects invalid days', function () {
  var invalid = [
    '', '2026', '2026-11', '2026-11-1', '2026-1-01', '2026-1-1',
    '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-32',
    '2026-02-30', '2026-02-29', '2023-04-31', '2026-06-31',
    '1900-02-29', // century year: not a leap year
    '2026-11-01T00:00:00Z', '2026/11/01', ' 2026-11-01', '2026-11-01 ',
    'not-a-day', '0', '-2026-11-01',
    null, undefined, false, 20261101, NaN, {}, [], new Date()
  ];
  invalid.forEach(function (day) {
    assert.throws(function () { OrbitDaily.buildCourse(day); }, TypeError, JSON.stringify(day));
  });
  assert.ok(Array.isArray(OrbitDaily.buildCourse('2024-02-29')), 'leap day is valid');
  assert.ok(Array.isArray(OrbitDaily.buildCourse('2000-02-29')), 'year 2000 is a leap year');
});

test('readBest returns zeros for null, missing or blocked storage', function () {
  assert.deepEqual(OrbitDaily.readBest(null, DAY), { overall: 0, daily: 0 });
  assert.deepEqual(OrbitDaily.readBest(undefined, DAY), { overall: 0, daily: 0 });
  assert.deepEqual(OrbitDaily.readBest(throwingStorage(), DAY), { overall: 0, daily: 0 });
  assert.deepEqual(OrbitDaily.readBest(memoryStorage(), DAY), { overall: 0, daily: 0 });
});

test('readBest sanitizes corrupt, negative, fractional and absurd values', function () {
  var corrupt = ['abc', '-1', '3.14', '', ' ', 'Infinity', 'NaN', 'null', '[]', '{}',
    '1000001', '999999999999', '9007199254740993'];
  corrupt.forEach(function (bad) {
    var seed = { 'orbit-runner:best:v1': bad };
    seed['orbit-runner:daily:v1:' + DAY] = bad;
    var s = memoryStorage(seed);
    assert.deepEqual(OrbitDaily.readBest(s, DAY), { overall: 0, daily: 0 },
      'stored value ' + JSON.stringify(bad));
  });
  var okSeed = { 'orbit-runner:best:v1': '250' };
  okSeed['orbit-runner:daily:v1:' + DAY] = '0';
  var ok = memoryStorage(okSeed);
  assert.deepEqual(OrbitDaily.readBest(ok, DAY), { overall: 250, daily: 0 });
  var boundary = memoryStorage({ 'orbit-runner:best:v1': '1000000' });
  assert.equal(OrbitDaily.readBest(boundary, DAY).overall, 1000000);
  var numeric = memoryStorage({ 'orbit-runner:best:v1': 42 });
  assert.equal(OrbitDaily.readBest(numeric, DAY).overall, 42);
});

test('readBest ignores daily for missing or invalid days', function () {
  var s = memoryStorage({
    'orbit-runner:best:v1': '10',
    'orbit-runner:daily:v1:2026-02-30': '999'
  });
  assert.deepEqual(OrbitDaily.readBest(s, '2026-02-30'), { overall: 10, daily: 0 });
  assert.deepEqual(OrbitDaily.readBest(s, null), { overall: 10, daily: 0 });
  assert.deepEqual(OrbitDaily.readBest(s, 'bogus'), { overall: 10, daily: 0 });
});

test('recordBest is monotonic and keeps days independent', function () {
  var s = memoryStorage();
  assert.deepEqual(OrbitDaily.recordBest(s, DAY, 100), { overall: 100, daily: 100 });
  assert.deepEqual(OrbitDaily.recordBest(s, DAY, 40), { overall: 100, daily: 100 });
  assert.equal(s.getItem('orbit-runner:best:v1'), '100');
  assert.equal(s.getItem('orbit-runner:daily:v1:' + DAY), '100');

  assert.deepEqual(OrbitDaily.recordBest(s, OTHER_DAY, 150), { overall: 150, daily: 150 });
  assert.deepEqual(OrbitDaily.readBest(s, DAY), { overall: 150, daily: 100 });
  assert.deepEqual(OrbitDaily.readBest(s, OTHER_DAY), { overall: 150, daily: 150 });
  assert.deepEqual(OrbitDaily.readBest(s, '2026-11-03'), { overall: 150, daily: 0 });

  assert.deepEqual(OrbitDaily.recordBest(s, DAY, 120), { overall: 150, daily: 120 });
  assert.equal(s.getItem('orbit-runner:daily:v1:' + DAY), '120');
  assert.equal(s.getItem('orbit-runner:best:v1'), '150');
});

test('recordBest records overall only when no valid day is supplied', function () {
  var s = memoryStorage();
  assert.deepEqual(OrbitDaily.recordBest(s, null, 60), { overall: 60, daily: 0 });
  assert.deepEqual(OrbitDaily.recordBest(s, 'not a day', 70), { overall: 70, daily: 0 });
  assert.equal(s.getItem('orbit-runner:best:v1'), '70');
  assert.deepEqual(Array.from(s._map.keys()), ['orbit-runner:best:v1']);
});

test('a daily record stays on the supplied run day across midnight', function () {
  var s = memoryStorage();
  var runDay = '2026-10-31'; // captured once at run start; the run ends after midnight
  assert.deepEqual(OrbitDaily.recordBest(s, runDay, 77), { overall: 77, daily: 77 });
  assert.equal(s.getItem('orbit-runner:daily:v1:2026-10-31'), '77');
  assert.deepEqual(OrbitDaily.readBest(s, '2026-11-01'), { overall: 77, daily: 0 });
});

test('recordBest rejects bad scores without overwriting good values', function () {
  var badScores = [-1, -100, 1.5, 0.1, NaN, Infinity, -Infinity,
    1000001, 1e9, Number.MAX_SAFE_INTEGER + 1,
    '100', '0', null, undefined, true, {}, []];
  badScores.forEach(function (bad) {
    var seed = { 'orbit-runner:best:v1': '100' };
    seed['orbit-runner:daily:v1:' + DAY] = '80';
    var s = memoryStorage(seed);
    assert.deepEqual(OrbitDaily.recordBest(s, DAY, bad), { overall: 100, daily: 80 },
      'score ' + String(bad));
    assert.equal(s.getItem('orbit-runner:best:v1'), '100');
    assert.equal(s.getItem('orbit-runner:daily:v1:' + DAY), '80');
  });
  var empty = memoryStorage();
  OrbitDaily.recordBest(empty, DAY, -5);
  assert.equal(empty._map.size, 0, 'bad score writes nothing to empty storage');
});

test('recordBest corrects corrupt stored values', function () {
  var seed = { 'orbit-runner:best:v1': 'garbage' };
  seed['orbit-runner:daily:v1:' + DAY] = '99999999';
  var s = memoryStorage(seed);
  assert.deepEqual(OrbitDaily.recordBest(s, DAY, 10), { overall: 10, daily: 10 });
  assert.equal(s.getItem('orbit-runner:best:v1'), '10');
  assert.equal(s.getItem('orbit-runner:daily:v1:' + DAY), '10');
});

test('recordBest never crashes on blocked or unavailable storage', function () {
  assert.deepEqual(OrbitDaily.recordBest(null, DAY, 42), { overall: 42, daily: 42 });
  assert.deepEqual(OrbitDaily.recordBest(null, null, 42), { overall: 42, daily: 0 });
  assert.deepEqual(OrbitDaily.recordBest(throwingStorage(), DAY, 55), { overall: 55, daily: 55 });
  var halfBlocked = memoryStorage({ 'orbit-runner:best:v1': '10' });
  halfBlocked.setItem = function () { throw new Error('quota exceeded'); };
  assert.deepEqual(OrbitDaily.recordBest(halfBlocked, DAY, 99), { overall: 99, daily: 99 });
});

test('only the documented keys and plain numeric values are stored', function () {
  var s = memoryStorage();
  OrbitDaily.recordBest(s, DAY, 10);
  OrbitDaily.recordBest(s, OTHER_DAY, 20);
  OrbitDaily.recordBest(s, null, 30);
  assert.equal(s._map.size, 3);
  s._map.forEach(function (value, key) {
    assert.match(key, /^orbit-runner:(best:v1|daily:v1:\d{4}-\d{2}-\d{2})$/);
    assert.match(value, /^\d+$/);
  });
});
