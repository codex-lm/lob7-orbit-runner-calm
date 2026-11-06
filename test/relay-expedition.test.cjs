'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var OrbitRelay = require('../relay-expedition.js');

var TAU = Math.PI * 2;
var ROUTES = ['safe', 'salvage'];
var STAGE_NAMES = ['Dawn Relay', 'Ember Belt', 'Last Beacon'];
var LABELS = { safe: 'Safe passage', salvage: 'Salvage field' };

// Flies one full leg: departs on `route` and arrives with `lives` left.
function flyLeg(mission, route, lives) {
  assert.equal(OrbitRelay.chooseRoute(mission, route), true, 'departure accepted');
  return OrbitRelay.finishLeg(mission, lives === undefined ? 3 : lives);
}

function wonMission() {
  var m = OrbitRelay.createMission();
  flyLeg(m, 'salvage', 3);
  flyLeg(m, 'salvage', 3);
  flyLeg(m, 'salvage', 3);
  return m;
}

test('exposes the documented constants and functions', function () {
  assert.equal(OrbitRelay.TARGET_ENERGY, 6);
  assert.equal(OrbitRelay.MAX_LIVES, 3);
  assert.equal(OrbitRelay.REPAIR_COST, 2);
  assert.equal(OrbitRelay.STAGES, 3);
  ['createMission', 'getLeg', 'buildCourse', 'chooseRoute',
    'collectCell', 'repair', 'finishLeg', 'fail'].forEach(function (name) {
    assert.equal(typeof OrbitRelay[name], 'function', name + ' is a function');
  });
});

test('createMission returns a fresh mission docked with 2 energy', function () {
  var m = OrbitRelay.createMission();
  assert.deepEqual(m, { stage: 0, completed: 0, energy: 2, status: 'dock', route: null, legs: [] });
  assert.ok(!('health' in m) && !('lives' in m), 'health stays with the caller');

  var other = OrbitRelay.createMission();
  assert.notEqual(m, other);
  assert.notEqual(m.legs, other.legs);
  m.energy = 99;
  m.status = 'flight';
  m.legs.push({ stage: 0, route: 'safe', arrivalEnergy: 1 });
  assert.deepEqual(other, { stage: 0, completed: 0, energy: 2, status: 'dock', route: null, legs: [] },
    'missions never share state');
});

test('getLeg anchors the documented leg configs', function () {
  assert.deepEqual(OrbitRelay.getLeg(0, 'safe'), {
    stage: 0, name: 'Dawn Relay', route: 'safe', label: 'Safe passage',
    duration: 20, speed: 105, angularSpeed: 1.7, arrivalEnergy: 1,
    spawnGap: 1.45, crystalChance: 0.30
  });
  assert.deepEqual(OrbitRelay.getLeg(2, 'salvage'), {
    stage: 2, name: 'Last Beacon', route: 'salvage', label: 'Salvage field',
    duration: 30, speed: 155, angularSpeed: 2.1, arrivalEnergy: 3,
    spawnGap: 0.75, crystalChance: 0.45
  });
});

test('getLeg describes every stage and route with fresh objects', function () {
  for (var stage = 0; stage < OrbitRelay.STAGES; stage++) {
    ROUTES.forEach(function (route) {
      var leg = OrbitRelay.getLeg(stage, route);
      assert.deepEqual(Object.keys(leg).sort(),
        ['angularSpeed', 'arrivalEnergy', 'crystalChance', 'duration', 'label',
          'name', 'route', 'spawnGap', 'speed', 'stage']);
      assert.equal(leg.stage, stage);
      assert.equal(leg.name, STAGE_NAMES[stage]);
      assert.equal(leg.route, route);
      assert.equal(leg.label, LABELS[route]);
      assert.ok(leg.duration > 0 && leg.speed > 0 && leg.angularSpeed > 0 && leg.spawnGap > 0);
      assert.ok(leg.crystalChance > 0 && leg.crystalChance < 1);
      assert.ok(Number.isInteger(leg.arrivalEnergy) && leg.arrivalEnergy >= 1);
    });
  }

  var a = OrbitRelay.getLeg(1, 'safe');
  a.speed = 1;
  a.label = 'mutated';
  assert.deepEqual(OrbitRelay.getLeg(1, 'safe'), OrbitRelay.getLeg(1, 'safe'),
    'each call returns an independent copy');
  assert.notEqual(OrbitRelay.getLeg(1, 'safe').speed, 1, 'mutation does not stick');
});

test('getLeg returns null for invalid arguments', function () {
  var badStages = [-1, 3, 4, 1.5, NaN, Infinity, '0', 'safe', null, undefined, {}, []];
  var badRoutes = ['', 'Safe', 'SAFE', 'hard', 'salvagee', ' safe', 'safe ', null, undefined, 0, 1, {}, []];
  badStages.forEach(function (stage) {
    assert.equal(OrbitRelay.getLeg(stage, 'safe'), null, 'stage ' + String(stage));
  });
  badRoutes.forEach(function (route) {
    assert.equal(OrbitRelay.getLeg(0, route), null, 'route ' + String(route));
  });
  assert.equal(OrbitRelay.getLeg(), null);
});

test('safe and salvage routes are materially different on every stage', function () {
  for (var stage = 0; stage < OrbitRelay.STAGES; stage++) {
    var safe = OrbitRelay.getLeg(stage, 'safe');
    var salvage = OrbitRelay.getLeg(stage, 'salvage');
    assert.ok(salvage.speed > safe.speed, 'stage ' + stage + ': salvage is faster');
    assert.ok(salvage.angularSpeed > safe.angularSpeed, 'stage ' + stage + ': salvage spins faster');
    assert.ok(salvage.spawnGap < safe.spawnGap, 'stage ' + stage + ': salvage spawns denser');
    assert.ok(salvage.duration > safe.duration, 'stage ' + stage + ': salvage takes longer');
    assert.ok(salvage.crystalChance > safe.crystalChance, 'stage ' + stage + ': more crystals');
    assert.ok(salvage.arrivalEnergy > safe.arrivalEnergy, 'stage ' + stage + ': richer arrival');
    assert.ok(OrbitRelay.buildCourse(stage, 'salvage').length > OrbitRelay.buildCourse(stage, 'safe').length,
      'stage ' + stage + ': salvage course has more events');
  }
});

test('leg configs do not ramp with mission progress', function () {
  var before = OrbitRelay.getLeg(2, 'salvage');
  var mission = OrbitRelay.createMission();
  flyLeg(mission, 'salvage', 3);
  flyLeg(mission, 'salvage', 3);
  assert.deepEqual(OrbitRelay.getLeg(2, 'salvage'), before, 'same leg, same config');
  assert.deepEqual(OrbitRelay.buildCourse(2, 'salvage'), OrbitRelay.buildCourse(2, 'salvage'),
    'course generation has no memory of earlier calls');
});

test('buildCourse is deterministic and returns independent copies', function () {
  var a = OrbitRelay.buildCourse(1, 'salvage');
  var b = OrbitRelay.buildCourse(1, 'salvage');
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  assert.deepEqual(a, b);
  a[0].at = -999;
  a.push({ at: 99, angle: 0, spin: 0, kind: 'rock' });
  assert.deepEqual(OrbitRelay.buildCourse(1, 'salvage'), b, 'mutation does not stick');
});

test('buildCourse never calls Math.random', function () {
  var baseline = OrbitRelay.buildCourse(0, 'safe');
  var original = Math.random;
  try {
    Math.random = function () { throw new Error('Math.random must not be used'); };
    assert.deepEqual(OrbitRelay.buildCourse(0, 'safe'), baseline);
    Math.random = function () { return 0.5; };
    assert.deepEqual(OrbitRelay.buildCourse(0, 'safe'), baseline);
  } finally {
    Math.random = original;
  }
});

test('buildCourse gives a distinct course per stage and route', function () {
  var seen = new Set();
  for (var stage = 0; stage < OrbitRelay.STAGES; stage++) {
    ROUTES.forEach(function (route) {
      var json = JSON.stringify(OrbitRelay.buildCourse(stage, route));
      assert.ok(!seen.has(json), 'course must differ for ' + stage + '/' + route);
      seen.add(json);
    });
  }
  assert.equal(seen.size, 6);
});

test('buildCourse event shape, spacing and arrival clearance', function () {
  for (var stage = 0; stage < OrbitRelay.STAGES; stage++) {
    ROUTES.forEach(function (route) {
      var leg = OrbitRelay.getLeg(stage, route);
      var events = OrbitRelay.buildCourse(stage, route);
      assert.ok(events.length >= 5 && events.length <= 60,
        'sane event count for ' + stage + '/' + route + ': ' + events.length);
      assert.equal(events[0].at, 1.1, 'first spawn at 1.1 s');
      var crystals = 0;
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        assert.deepEqual(Object.keys(e).sort(), ['angle', 'at', 'kind', 'spin']);
        assert.ok(e.at >= 1.1 && e.at < leg.duration, 'spawn inside the leg: ' + e.at);
        assert.ok(e.angle >= 0 && e.angle < TAU, 'angle inside [0, 2pi): ' + e.angle);
        assert.ok(e.spin >= 0 && e.spin < TAU, 'spin inside [0, 2pi): ' + e.spin);
        assert.ok(e.kind === 'rock' || e.kind === 'crystal', 'kind is rock or crystal');
        if (e.kind === 'crystal') crystals++;
        if (i > 0) {
          var gap = e.at - events[i - 1].at;
          assert.ok(gap > 0, 'events strictly ordered by time');
          assert.ok(gap >= leg.spawnGap * 0.85 - 1e-9 && gap <= leg.spawnGap * 1.15 + 1e-9,
            'gap within 0.85..1.15 of spawnGap: ' + gap);
        }
      }
      var last = events[events.length - 1];
      assert.ok(last.at < leg.duration - 4,
        'last spawn strictly before duration-4s: ' + last.at + ' vs ' + leg.duration);
      assert.ok(last.at >= leg.duration - 4 - leg.spawnGap * 1.15 - 1e-9,
        'spawning fills the window right up to the cutoff: ' + last.at);
      assert.ok(crystals > 0, 'course offers crystals');
      assert.ok(crystals < events.length, 'course still has rocks');
    });
  }
});

test('buildCourse returns an empty array for invalid input', function () {
  assert.deepEqual(OrbitRelay.buildCourse(3, 'safe'), []);
  assert.deepEqual(OrbitRelay.buildCourse(-1, 'safe'), []);
  assert.deepEqual(OrbitRelay.buildCourse(1.5, 'safe'), []);
  assert.deepEqual(OrbitRelay.buildCourse(0, 'hard'), []);
  assert.deepEqual(OrbitRelay.buildCourse('0', 'safe'), []);
  assert.deepEqual(OrbitRelay.buildCourse(), []);
  assert.deepEqual(OrbitRelay.buildCourse(null, null), []);
});

test('chooseRoute departs only from the dock with a valid route', function () {
  var m = OrbitRelay.createMission();
  ['hard', '', 'SAFE', ' safe', null, undefined, 0, {}].forEach(function (route) {
    assert.equal(OrbitRelay.chooseRoute(m, route), false, 'route ' + String(route));
    assert.equal(m.status, 'dock');
    assert.equal(m.route, null);
  });

  assert.equal(OrbitRelay.chooseRoute(m, 'safe'), true);
  assert.equal(m.status, 'flight');
  assert.equal(m.route, 'safe');
  assert.equal(m.energy, 2, 'departure grants no reward');

  assert.equal(OrbitRelay.chooseRoute(m, 'salvage'), false, 'duplicate click ignored');
  assert.equal(OrbitRelay.chooseRoute(m, 'safe'), false, 'duplicate click ignored');
  assert.equal(m.route, 'safe', 'route unchanged');
  assert.equal(m.status, 'flight');
});

test('chooseRoute refuses finished missions and impossible stages', function () {
  var won = wonMission();
  assert.equal(won.status, 'win');
  assert.equal(OrbitRelay.chooseRoute(won, 'safe'), false);

  var corrupt = OrbitRelay.createMission();
  corrupt.stage = 3; // no fourth leg exists
  assert.equal(OrbitRelay.chooseRoute(corrupt, 'safe'), false);
  assert.equal(corrupt.status, 'dock');
  assert.equal(corrupt.route, null);
});

test('collectCell awards energy only during flight', function () {
  var m = OrbitRelay.createMission();
  assert.equal(OrbitRelay.collectCell(m), false, 'docked');
  assert.equal(m.energy, 2);

  OrbitRelay.chooseRoute(m, 'safe');
  assert.equal(OrbitRelay.collectCell(m), true);
  assert.equal(OrbitRelay.collectCell(m), true);
  assert.equal(m.energy, 4);
  assert.equal(m.status, 'flight', 'no other change');
  assert.equal(m.route, 'safe');
  assert.equal(m.stage, 0);
  assert.equal(m.completed, 0);
  assert.deepEqual(m.legs, []);

  OrbitRelay.finishLeg(m, 3);
  assert.equal(OrbitRelay.collectCell(m), false, 'back at dock');
  assert.equal(m.energy, 5);

  var lost = OrbitRelay.createMission();
  OrbitRelay.chooseRoute(lost, 'safe');
  OrbitRelay.fail(lost);
  assert.equal(OrbitRelay.collectCell(lost), false, 'lost');
  assert.equal(lost.energy, 2);
});

test('finishLeg banks the arrival energy exactly once', function () {
  var m = OrbitRelay.createMission();
  assert.equal(OrbitRelay.finishLeg(m, 3), false, 'not in flight');

  OrbitRelay.chooseRoute(m, 'salvage');
  var arrival = OrbitRelay.getLeg(0, 'salvage').arrivalEnergy;
  assert.equal(OrbitRelay.finishLeg(m, 3), true);
  assert.equal(m.energy, 2 + arrival, 'arrival energy added once');
  assert.deepEqual(m.legs, [{ stage: 0, route: 'salvage', arrivalEnergy: arrival }]);
  assert.equal(m.completed, 1);
  assert.equal(m.stage, 1, 'stage advances to completed');
  assert.equal(m.route, null);
  assert.equal(m.status, 'dock');

  assert.equal(OrbitRelay.finishLeg(m, 3), false, 'repeated call rejected');
  assert.equal(m.energy, 2 + arrival, 'no double reward');
  assert.equal(m.legs.length, 1, 'no duplicate log entry');
  assert.equal(m.completed, 1);
  assert.equal(m.stage, 1);
});

test('finishLeg requires surviving lives (integer 1..3)', function () {
  [0, -1, 4, 1.5, NaN, Infinity, '3', null, undefined].forEach(function (lives) {
    var m = OrbitRelay.createMission();
    OrbitRelay.chooseRoute(m, 'safe');
    assert.equal(OrbitRelay.finishLeg(m, lives), false, 'lives ' + String(lives));
    assert.equal(m.status, 'flight', 'flight left unresolved');
    assert.equal(m.energy, 2, 'no reward');
    assert.deepEqual(m.legs, []);
    assert.equal(m.completed, 0);
    assert.equal(m.stage, 0);
    assert.equal(m.route, 'safe');
  });
  [1, 2, 3].forEach(function (lives) {
    var m = OrbitRelay.createMission();
    OrbitRelay.chooseRoute(m, 'safe');
    assert.equal(OrbitRelay.finishLeg(m, lives), true, 'lives ' + lives);
  });
});

test('three arrivals complete the expedition, each banked exactly once', function () {
  var m = OrbitRelay.createMission();
  assert.equal(flyLeg(m, 'salvage', 3), true);
  assert.equal(m.status, 'dock');
  assert.equal(m.stage, 1);
  assert.equal(flyLeg(m, 'salvage', 3), true);
  assert.equal(m.status, 'dock');
  assert.equal(m.stage, 2);
  assert.equal(flyLeg(m, 'salvage', 3), true);

  assert.equal(m.completed, 3);
  assert.equal(m.stage, 3);
  assert.equal(m.legs.length, 3);
  assert.deepEqual(m.legs.map(function (l) { return l.stage; }), [0, 1, 2]);
  assert.equal(m.energy, 11, '2 start + 3 x 3 salvage arrivals');
  assert.equal(m.status, 'win');

  assert.equal(OrbitRelay.finishLeg(m, 3), false, 'expedition is over');
  assert.equal(m.energy, 11);
});

test('docking with too little cargo ends in shortfall', function () {
  var m = OrbitRelay.createMission();
  flyLeg(m, 'safe', 3);
  flyLeg(m, 'safe', 3);
  flyLeg(m, 'safe', 3);
  assert.equal(m.energy, 5, 'below the target of 6');
  assert.equal(m.status, 'shortfall');
  assert.equal(m.completed, 3);
  assert.equal(OrbitRelay.chooseRoute(m, 'salvage'), false, 'no fourth leg');
});

test('collected crystals can make up the shortfall at exactly the target', function () {
  var m = OrbitRelay.createMission();
  flyLeg(m, 'safe', 3);
  flyLeg(m, 'safe', 3);
  OrbitRelay.chooseRoute(m, 'safe');
  assert.equal(OrbitRelay.collectCell(m), true);
  assert.equal(OrbitRelay.finishLeg(m, 3), true);
  assert.equal(m.energy, 6, 'exactly the target');
  assert.equal(m.status, 'win');
});

test('fail ends the flight in a loss without reward', function () {
  var m = OrbitRelay.createMission();
  assert.equal(OrbitRelay.fail(m), false, 'not in flight');

  OrbitRelay.chooseRoute(m, 'salvage');
  OrbitRelay.collectCell(m);
  var energyBefore = m.energy;
  assert.equal(OrbitRelay.fail(m), true);
  assert.equal(m.status, 'lost');
  assert.equal(m.energy, energyBefore, 'no energy change on failure');
  assert.deepEqual(m.legs, []);
  assert.equal(m.completed, 0);

  assert.equal(OrbitRelay.fail(m), false, 'already lost');
  assert.equal(OrbitRelay.finishLeg(m, 3), false, 'no arrival after a loss');
  assert.equal(OrbitRelay.chooseRoute(m, 'safe'), false, 'no relaunch after a loss');
  assert.equal(OrbitRelay.collectCell(m), false, 'no crystals after a loss');
  assert.equal(m.energy, energyBefore);
});

test('terminal missions reject every action without mutation', function () {
  var won = wonMission();
  assert.equal(won.status, 'win');
  var snapshot = JSON.stringify(won);
  assert.equal(OrbitRelay.chooseRoute(won, 'safe'), false);
  assert.equal(OrbitRelay.collectCell(won), false);
  assert.equal(OrbitRelay.finishLeg(won, 3), false);
  assert.equal(OrbitRelay.fail(won), false);
  assert.deepEqual(OrbitRelay.repair(won, 2), { ok: false, lives: 2 });
  assert.equal(JSON.stringify(won), snapshot, 'no mutation');
});

test('repair at a stop costs 2 energy for 1 life', function () {
  var m = OrbitRelay.createMission();
  flyLeg(m, 'salvage', 3); // docked after leg 1, energy 5
  assert.deepEqual(OrbitRelay.repair(m, 2), { ok: true, lives: 3 });
  assert.equal(m.energy, 3);
  assert.equal(m.status, 'dock');
  assert.equal(m.completed, 1);
  assert.equal(m.stage, 1);
});

test('repair can be bought twice while damaged and funded', function () {
  var m = OrbitRelay.createMission();
  flyLeg(m, 'salvage', 3); // energy 5
  assert.deepEqual(OrbitRelay.repair(m, 1), { ok: true, lives: 2 });
  assert.equal(m.energy, 3);
  assert.deepEqual(OrbitRelay.repair(m, 2), { ok: true, lives: 3 });
  assert.equal(m.energy, 1);
  assert.deepEqual(OrbitRelay.repair(m, 2), { ok: false, lives: 2 }, 'too poor for a third');
  assert.equal(m.energy, 1, 'a denied purchase costs nothing');
});

test('repair is denied at departure, at full health, in flight and after the end', function () {
  var start = OrbitRelay.createMission();
  assert.deepEqual(OrbitRelay.repair(start, 1), { ok: false, lives: 1 },
    'no free repair at departure');
  assert.equal(start.energy, 2);
  assert.equal(start.status, 'dock');

  var m = OrbitRelay.createMission();
  flyLeg(m, 'safe', 3); // docked after leg 1, energy 3
  assert.deepEqual(OrbitRelay.repair(m, 3), { ok: false, lives: 3 }, 'already full health');
  assert.equal(m.energy, 3, 'no mutation');

  OrbitRelay.chooseRoute(m, 'safe');
  assert.deepEqual(OrbitRelay.repair(m, 2), { ok: false, lives: 2 }, 'not mid-flight');
  assert.equal(m.energy, 3);
  OrbitRelay.finishLeg(m, 3);
  assert.deepEqual(OrbitRelay.repair(m, 2), { ok: true, lives: 3 }, 'docked after leg 2');
  assert.equal(m.energy, 2);

  var won = wonMission();
  assert.deepEqual(OrbitRelay.repair(won, 2), { ok: false, lives: 2 }, 'expedition over');

  var lost = OrbitRelay.createMission();
  OrbitRelay.chooseRoute(lost, 'safe');
  OrbitRelay.fail(lost);
  assert.deepEqual(OrbitRelay.repair(lost, 2), { ok: false, lives: 2 }, 'no repair on a loss');
});

test('repair rejects invalid lives and preserves the passed value', function () {
  var invalid = [0, 3, 4, -1, 1.5, 2.5, NaN, Infinity, '1', '2', null, undefined, {}, []];
  invalid.forEach(function (lives) {
    var m = OrbitRelay.createMission();
    flyLeg(m, 'salvage', 3);
    var before = m.energy;
    assert.deepEqual(OrbitRelay.repair(m, lives), { ok: false, lives: lives },
      'lives ' + String(lives));
    assert.equal(m.energy, before, 'no mutation');
  });
  [1, 2].forEach(function (lives) {
    var m = OrbitRelay.createMission();
    flyLeg(m, 'salvage', 3);
    assert.deepEqual(OrbitRelay.repair(m, lives), { ok: true, lives: lives + 1 });
  });
});

test('missions are fully independent of each other', function () {
  var a = OrbitRelay.createMission();
  var b = OrbitRelay.createMission();
  flyLeg(a, 'salvage', 3);
  OrbitRelay.chooseRoute(a, 'safe');

  assert.equal(a.status, 'flight');
  assert.equal(a.completed, 1);
  assert.equal(a.energy, 5);
  assert.deepEqual(b, { stage: 0, completed: 0, energy: 2, status: 'dock', route: null, legs: [] },
    'the other mission is untouched');

  flyLeg(b, 'safe', 3);
  assert.equal(b.completed, 1);
  assert.equal(b.energy, 3);
  assert.equal(a.completed, 1, 'interleaved progress stays separate');
  assert.equal(a.energy, 5);
});

test('actions reject non-mission input without throwing', function () {
  [null, undefined, 42, 'mission', [], true].forEach(function (bad) {
    assert.equal(OrbitRelay.chooseRoute(bad, 'safe'), false);
    assert.equal(OrbitRelay.collectCell(bad), false);
    assert.equal(OrbitRelay.finishLeg(bad, 3), false);
    assert.equal(OrbitRelay.fail(bad), false);
    assert.deepEqual(OrbitRelay.repair(bad, 2), { ok: false, lives: 2 });
  });
});
