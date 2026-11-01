/*
 * daily-orbit.js — opt-in "Daily Orbit" mode for Orbit Runner.
 *
 * Exposes window.OrbitDaily in browsers and module.exports in Node (UMD).
 * Dependency-free, ES2017-compatible, no imports/fetch/worker/eval.
 *
 * Deterministic course generation
 * -------------------------------
 * buildCourse(day) derives everything from the string seed
 *   'orbit-daily-v1:' + day
 * so every player and every restart on the same UTC day gets an identical
 * course, independent of Math.random, rendering or controls.
 *
 *   Hash:  FNV-1a 32-bit over the seed's UTF-16 code units
 *          (offset basis 2166136261, prime 16777619, Math.imul steps).
 *   PRNG:  mulberry32 — 32-bit state, returns doubles in [0, 1).
 *
 * Draw order per event (fixed, do not reorder — it defines the course):
 *   1. angle  = random() * 2pi          in [0, 2pi)
 *   2. spin   = random() * 2pi          in [0, 2pi)
 *   3. kind   = 'crystal' if random() < 0.30 else 'rock'
 *   4. gap    = (0.75 + random() * 0.5) / (1 + min(at, 30) * 0.02)
 *      next event time = at + gap, where `at` is the event just placed.
 *
 * First spawn at 1.1 s; no events at or after 57 s so the final objects can
 * cross the lanes before the 60 s finish.
 *
 * Local best scores
 * -----------------
 * recordBest/readBest persist plain non-negative integers, local to this
 * browser only (no leaderboard):
 *   'orbit-runner:best:v1'         overall best (both modes)
 *   'orbit-runner:daily:v1:' + day daily best for that run day
 * A daily record is keyed by the run day captured at run start, so it stays
 * correct even if the run crosses midnight. Missing, corrupt, negative,
 * fractional, non-finite or absurd (> 1000000) stored values are treated as
 * 0 and corrected on the next record. Blocked or unavailable storage never
 * throws.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrbitDaily = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var DURATION = 60;
  var TAU = Math.PI * 2;

  var SEED_PREFIX = 'orbit-daily-v1:';
  var FIRST_AT = 1.1;
  var STOP_AT = 57;
  var CRYSTAL_CHANCE = 0.30;
  var RAMP_CAP_AT = 30;

  var KEY_OVERALL = 'orbit-runner:best:v1';
  var KEY_DAILY_PREFIX = 'orbit-runner:daily:v1:';
  var MAX_BEST = 1000000;

  function fnv1a(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(state) {
    var a = state >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Strict YYYY-MM-DD plus a real proleptic Gregorian calendar day.
  function isValidDay(day) {
    if (typeof day !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return false;
    var year = Number(m[1]);
    var month = Number(m[2]);
    var date = Number(m[3]);
    if (month < 1 || month > 12 || date < 1) return false;
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return date <= lengths[month - 1];
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + String(n);
  }

  function utcDay(date) {
    if (date === undefined) date = new Date();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError('OrbitDaily.utcDay: expected a valid Date');
    }
    var y = String(date.getUTCFullYear());
    while (y.length < 4) y = '0' + y;
    return y + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function buildCourse(day) {
    if (!isValidDay(day)) {
      throw new TypeError('OrbitDaily.buildCourse: invalid day, expected a real calendar day as YYYY-MM-DD, got ' + String(day));
    }
    var random = mulberry32(fnv1a(SEED_PREFIX + day));
    var events = [];
    var at = FIRST_AT;
    while (at < STOP_AT) {
      var angle = random() * TAU;
      var spin = random() * TAU;
      var kind = random() < CRYSTAL_CHANCE ? 'crystal' : 'rock';
      events.push({ at: at, angle: angle, spin: spin, kind: kind });
      at += (0.75 + random() * 0.5) / (1 + Math.min(at, RAMP_CAP_AT) * 0.02);
    }
    return events;
  }

  // Coerce a stored value to a sane best score; anything else becomes 0.
  function toStoredBest(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_BEST) return 0;
    return n;
  }

  function safeGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (e) {
      // Blocked or full storage: best scores are a nicety, never fatal.
    }
  }

  function readBest(storage, day) {
    var best = { overall: 0, daily: 0 };
    if (!storage) return best;
    best.overall = toStoredBest(safeGet(storage, KEY_OVERALL));
    if (isValidDay(day)) {
      best.daily = toStoredBest(safeGet(storage, KEY_DAILY_PREFIX + day));
    }
    return best;
  }

  function recordBest(storage, dayOrNull, score) {
    var day = isValidDay(dayOrNull) ? dayOrNull : null;
    var best = readBest(storage, day);
    if (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 0 || score > MAX_BEST) {
      return best; // a bad score input never overwrites stored values
    }
    if (score > best.overall) {
      best.overall = score;
      if (storage) safeSet(storage, KEY_OVERALL, String(score));
    }
    if (day !== null && score > best.daily) {
      best.daily = score;
      if (storage) safeSet(storage, KEY_DAILY_PREFIX + day, String(score));
    }
    return best;
  }

  return {
    DURATION: DURATION,
    utcDay: utcDay,
    buildCourse: buildCourse,
    readBest: readBest,
    recordBest: recordBest
  };
}));
