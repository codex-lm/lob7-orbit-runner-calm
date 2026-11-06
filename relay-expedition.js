/*
 * relay-expedition.js — "Relay Expedition" mode for Orbit Runner.
 *
 * Exposes window.OrbitRelay in browsers and module.exports in Node (UMD).
 * Dependency-free, ES2017-compatible, no imports/fetch/worker/eval.
 * Pure gameplay logic: no DOM, no timers, no Math.random, no global state.
 *
 * The expedition
 * --------------
 * A mission is three legs (stages 0..2: Dawn Relay, Ember Belt,
 * Last Beacon) with a repair stop between legs. For each leg the player
 * picks one of two routes:
 *
 *   'safe'     Safe passage  — slower, sparse spawns, 1 energy on arrival
 *   'salvage'  Salvage field — faster, dense spawns, more crystals,
 *                              3 energy on arrival
 *
 * Leg config values are constant per leg; there is no cumulative speed
 * ramp across the expedition.
 *
 * Mission lifecycle (mission.status):
 *   dock   -> chooseRoute -> flight
 *   flight -> finishLeg   -> dock (legs 1-2) | 'win' | 'shortfall' (leg 3)
 *   flight -> fail        -> lost
 * collectCell adds +1 energy, only in flight.
 * repair spends 2 energy for +1 life, only docked after leg 1 or 2.
 * 'win' requires energy >= TARGET_ENERGY (6) after the third arrival.
 *
 * The module never tracks health: lives are owned by the caller and are
 * passed in wherever a decision depends on them (repair, finishLeg).
 *
 * Deterministic course generation
 * -------------------------------
 * buildCourse(stage, route) derives everything from the string seed
 *   'orbit-relay-v1:' + stage + ':' + route
 * so every player and every restart of the same leg gets an identical
 * course, independent of Math.random, rendering or controls.
 *
 *   Hash:  FNV-1a 32-bit over the seed's UTF-16 code units
 *          (offset basis 2166136261, prime 16777619, Math.imul steps).
 *   PRNG:  mulberry32 — 32-bit state, returns doubles in [0, 1).
 *
 * Draw order per event (fixed, do not reorder — it defines the course):
 *   1. angle = random() * 2pi                 in [0, 2pi)
 *   2. spin  = random() * 2pi                 in [0, 2pi)
 *   3. kind  = 'crystal' if random() < crystalChance else 'rock'
 *   4. gap   = spawnGap * (0.85 + random() * 0.30)
 *      next event time = at + gap, where `at` is the event just placed.
 *
 * First spawn at 1.1 s; the last spawn is strictly before duration - 4 s
 * so every object (speed >= 105) has crossed the lanes before arrival.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrbitRelay = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var TARGET_ENERGY = 6;
  var MAX_LIVES = 3;
  var REPAIR_COST = 2;
  var STAGES = 3;

  var TAU = Math.PI * 2;
  var SEED_PREFIX = 'orbit-relay-v1:';
  var FIRST_AT = 1.1;
  var ARRIVAL_CLEARANCE = 4;
  var GAP_MIN_FACTOR = 0.85;
  var GAP_SPREAD = 0.30;

  var NAMES = ['Dawn Relay', 'Ember Belt', 'Last Beacon'];
  var LABELS = { safe: 'Safe passage', salvage: 'Salvage field' };

  // Constant per leg; there is deliberately no cumulative speed ramp.
  var LEGS = [
    {
      safe: { duration: 20, speed: 105, angularSpeed: 1.7, arrivalEnergy: 1, spawnGap: 1.45, crystalChance: 0.30 },
      salvage: { duration: 26, speed: 135, angularSpeed: 1.9, arrivalEnergy: 3, spawnGap: 0.85, crystalChance: 0.45 }
    },
    {
      safe: { duration: 22, speed: 115, angularSpeed: 1.8, arrivalEnergy: 1, spawnGap: 1.35, crystalChance: 0.30 },
      salvage: { duration: 28, speed: 145, angularSpeed: 2.0, arrivalEnergy: 3, spawnGap: 0.80, crystalChance: 0.45 }
    },
    {
      safe: { duration: 24, speed: 125, angularSpeed: 1.9, arrivalEnergy: 1, spawnGap: 1.25, crystalChance: 0.30 },
      salvage: { duration: 30, speed: 155, angularSpeed: 2.1, arrivalEnergy: 3, spawnGap: 0.75, crystalChance: 0.45 }
    }
  ];

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

  function isValidStage(stage) {
    return Number.isInteger(stage) && stage >= 0 && stage < STAGES;
  }

  function isValidRoute(route) {
    return route === 'safe' || route === 'salvage';
  }

  function isMission(mission) {
    return !!mission && typeof mission === 'object' &&
      typeof mission.status === 'string' &&
      Number.isInteger(mission.stage) &&
      Number.isInteger(mission.completed) &&
      Number.isFinite(mission.energy) &&
      Array.isArray(mission.legs);
  }

  function createMission() {
    return { stage: 0, completed: 0, energy: 2, status: 'dock', route: null, legs: [] };
  }

  function getLeg(stage, route) {
    if (!isValidStage(stage) || !isValidRoute(route)) return null;
    var leg = LEGS[stage][route];
    return {
      stage: stage,
      name: NAMES[stage],
      route: route,
      label: LABELS[route],
      duration: leg.duration,
      speed: leg.speed,
      angularSpeed: leg.angularSpeed,
      arrivalEnergy: leg.arrivalEnergy,
      spawnGap: leg.spawnGap,
      crystalChance: leg.crystalChance
    };
  }

  function buildCourse(stage, route) {
    if (!isValidStage(stage) || !isValidRoute(route)) return [];
    var leg = LEGS[stage][route];
    var random = mulberry32(fnv1a(SEED_PREFIX + stage + ':' + route));
    var events = [];
    var at = FIRST_AT;
    var stopAt = leg.duration - ARRIVAL_CLEARANCE;
    while (at < stopAt) {
      var angle = random() * TAU;
      var spin = random() * TAU;
      var kind = random() < leg.crystalChance ? 'crystal' : 'rock';
      events.push({ at: at, angle: angle, spin: spin, kind: kind });
      at += leg.spawnGap * (GAP_MIN_FACTOR + random() * GAP_SPREAD);
    }
    return events;
  }

  function chooseRoute(mission, route) {
    if (!isMission(mission)) return false;
    if (mission.status !== 'dock') return false;
    if (!isValidStage(mission.stage)) return false;
    if (!isValidRoute(route)) return false;
    mission.route = route;
    mission.status = 'flight';
    return true;
  }

  function collectCell(mission) {
    if (!isMission(mission)) return false;
    if (mission.status !== 'flight') return false;
    mission.energy += 1;
    return true;
  }

  function denied(lives) {
    return { ok: false, lives: lives };
  }

  function repair(mission, lives) {
    if (!isMission(mission)) return denied(lives);
    if (mission.status !== 'dock') return denied(lives);
    if (mission.completed !== 1 && mission.completed !== 2) return denied(lives);
    if (!Number.isInteger(lives) || lives < 1 || lives > MAX_LIVES - 1) return denied(lives);
    if (mission.energy < REPAIR_COST) return denied(lives);
    mission.energy -= REPAIR_COST;
    return { ok: true, lives: lives + 1 };
  }

  function finishLeg(mission, lives) {
    if (!isMission(mission)) return false;
    if (mission.status !== 'flight') return false;
    if (!Number.isInteger(lives) || lives < 1 || lives > MAX_LIVES) return false;
    var leg = isValidStage(mission.stage) ? LEGS[mission.stage][mission.route] : null;
    if (!leg) return false;
    var arrivalEnergy = leg.arrivalEnergy;
    mission.legs.push({ stage: mission.stage, route: mission.route, arrivalEnergy: arrivalEnergy });
    mission.energy += arrivalEnergy;
    mission.completed += 1;
    mission.stage = mission.completed;
    mission.route = null;
    if (mission.completed < STAGES) {
      mission.status = 'dock';
    } else {
      mission.status = mission.energy >= TARGET_ENERGY ? 'win' : 'shortfall';
    }
    return true;
  }

  function fail(mission) {
    if (!isMission(mission)) return false;
    if (mission.status !== 'flight') return false;
    mission.status = 'lost';
    return true;
  }

  return {
    TARGET_ENERGY: TARGET_ENERGY,
    MAX_LIVES: MAX_LIVES,
    REPAIR_COST: REPAIR_COST,
    STAGES: STAGES,
    createMission: createMission,
    getLeg: getLeg,
    buildCourse: buildCourse,
    chooseRoute: chooseRoute,
    collectCell: collectCell,
    repair: repair,
    finishLeg: finishLeg,
    fail: fail
  };
}));
