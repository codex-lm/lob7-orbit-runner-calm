const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function boot({ mode = 'daily', store = storage(), date = '2026-11-01T12:00:00Z', random = .37 } = {}) {
  let clock = 0, epoch = Date.parse(date), frame;
  const events = {}, nodes = {}, messages = [];
  let focused = null;
  const ctx = new Proxy({}, { get: (target, key) => key === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; } });
  for (const id of ['game', 'score', 'lives', 'phase', 'startBtn', 'pauseBtn', 'mode', 'courseInfo', 'dailyBest', 'overallBest',
    'relayPanel', 'relayTitle', 'relayText', 'safeBtn', 'salvageBtn', 'repairBtn', 'energy', 'relayProgress', 'relayReport', 'records']) {
    nodes[id] = { tagName: id === 'mode' ? 'SELECT' : id.endsWith('Btn') ? 'BUTTON' : 'CANVAS',
      value: id === 'mode' ? mode : '', textContent: '', parentElement: {},
      addEventListener: (kind, fn) => { events[id + ':' + kind] = fn; },
      focus() { focused = id; }, getContext: () => ctx };
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + clock])); }
    static now() { return epoch + clock; }
  }
  const document = { hidden: false, getElementById: id => nodes[id], addEventListener: (kind, fn) => { events[kind] = fn; } };
  const sandbox = { document, Date: FakeDate, Math: Object.assign(Object.create(Math), { random: () => random }),
    performance: { now: () => clock }, requestAnimationFrame: fn => { frame = fn; } };
  sandbox.window = sandbox;
  sandbox.parent = { postMessage: (message, origin) => { messages.push({ ...message, origin }); } };
  Object.defineProperty(sandbox, 'localStorage', { get: () => { if (store === 'blocked') throw new Error('SecurityError'); return store; } });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../daily-orbit.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../relay-expedition.js'), 'utf8'), sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
  // Test-only state access. Full playthroughs use read access plus real DOM inputs;
  // named boundary fixtures below explicitly arrange rare collision/repair cases.
  vm.runInContext(source.replace('  reset();', '  reset();\n  window.readRun = function () { return JSON.stringify(s); };\n'
    + '  window.setBoundaryFixture = function (json) { Object.assign(s, JSON.parse(json)); };'), sandbox);
  return { nodes, store, messages, read: () => JSON.parse(sandbox.readRun()), focused: () => focused,
    boundaryFixture: patch => sandbox.setBoundaryFixture(JSON.stringify(patch)),
    click: id => events[id + ':click'](),
    key(code, target = nodes.game) {
      let prevented = false; events.keydown({ code, target, preventDefault() { prevented = true; } }); return prevented;
    },
    select(value) { nodes.mode.value = value; events['mode:change'](); },
    hidden(value) { document.hidden = value; events.visibilitychange(); },
    date(value) { epoch = Date.parse(value) - clock; },
    advance(ms, step = 1000 / 60) {
      const end = clock + ms;
      while (clock < end - 1e-7) { clock = Math.min(end, clock + step); frame(clock); }
    }
  };
}

test('daily mode is visible at entry and native mode keys do not start or switch lanes', () => {
  const b = boot();
  assert.match(b.nodes.courseInfo.textContent, /2026-11-01 UTC/);
  assert.equal(b.key('Space', b.nodes.mode), false);
  assert.equal(b.key('ArrowDown', b.nodes.mode), false);
  assert.equal(b.read().phase, 'menu');
  b.click('startBtn'); assert.equal(b.nodes.mode.disabled, true);
  b.click('pauseBtn'); assert.equal(b.nodes.mode.disabled, true);
  b.select('classic'); assert.equal(b.read().mode, 'daily');
});

test('daily simulation is identical across rendering rates and cosmetic random streams', () => {
  const a = boot({ random: .1 }), b = boot({ random: .9 });
  a.click('startBtn'); b.click('startBtn');
  a.advance(10000, 1000 / 120); b.advance(10000, 40);
  assert.deepEqual(a.read(), b.read());
  a.key('Space'); b.key('Space');
  a.advance(5000, 1000 / 120); b.advance(5000, 40);
  assert.deepEqual(a.read(), b.read());
});

test('pause and backgrounding freeze daily time, course and score', () => {
  const b = boot(); b.click('startBtn'); b.advance(3000);
  b.key('KeyP'); const paused = b.read(); b.advance(12000);
  assert.deepEqual(b.read(), paused);
  b.key('KeyP'); b.advance(1000); assert.ok(b.read().time > paused.time);
  b.hidden(true); const hidden = b.read(); b.advance(10000);
  assert.deepEqual(b.read(), hidden);
  b.hidden(false); assert.equal(b.read().phase, 'playing');
});

test('finished daily run is frozen, saves its result, and restarts the same dated course', () => {
  const b = boot(); b.click('startBtn'); const course = b.read().course;
  b.advance(61000); const end = b.read();
  assert.ok(['over', 'win'].includes(end.phase));
  assert.ok(end.time <= 60 && end.score > 0);
  assert.equal(b.nodes.mode.disabled, false);
  assert.equal(Number(b.nodes.dailyBest.textContent), end.score);
  b.advance(10000); assert.deepEqual(b.read(), end);
  const reload = boot({ store: b.store });
  assert.equal(Number(reload.nodes.dailyBest.textContent), end.score);
  assert.equal(Number(reload.nodes.overallBest.textContent), end.score);
  b.click('startBtn'); assert.deepEqual(b.read().course, course);
  assert.equal(b.read().score, 0); assert.equal(b.read().lives, 3);
});

test('daily can pass 200 points and finish at 60 seconds using only lane controls', () => {
  const b = boot(); b.click('startBtn');
  let passedClassicGoal = false;
  for (let step = 0; step < 1300 && b.read().phase === 'playing'; step++) {
    const run = b.read();
    const danger = lane => run.objs.some(o => {
      if (o.kind !== 'rock') return false;
      for (let t = 0; t <= .7; t += .025) {
        const radius = run.laneR + Math.max(-620 * t, Math.min(620 * t, [150, 225][lane] - run.laneR));
        const rockRadius = o.r - (105 + Math.min(run.time, 30) * 3.5) * t;
        const angle = run.angle + (1.7 + Math.min(run.time * .012, .6)) * t;
        const delta = Math.abs(Math.atan2(Math.sin(angle - o.a), Math.cos(angle - o.a)));
        if (Math.abs(radius - rockRadius) < 24 && delta < .24) return true;
      }
      return false;
    });
    if (danger(run.lane) && !danger(1 - run.lane)) b.key('Space');
    b.advance(50);
    if (b.read().phase === 'playing' && b.read().score >= 200) passedClassicGoal = true;
  }
  const end = b.read();
  assert.equal(passedClassicGoal, true);
  assert.equal(end.phase, 'win'); assert.equal(end.time, 60);
  assert.ok(end.lives > 0); assert.ok(end.score > 200);
  assert.equal(Number(b.nodes.dailyBest.textContent), end.score);
  b.advance(1000); assert.deepEqual(b.read(), end);
});

test('UTC midnight does not change an ongoing course or credit the next day', () => {
  const b = boot({ date: '2026-11-01T23:59:55Z' }); b.click('startBtn');
  const course = b.read().course; b.advance(61000);
  assert.equal(b.read().day, '2026-11-01'); assert.deepEqual(b.read().course, course);
  assert.ok(b.store.values.has('orbit-runner:daily:v1:2026-11-01'));
  assert.equal(b.store.values.has('orbit-runner:daily:v1:2026-11-02'), false);
  b.click('startBtn'); assert.equal(b.read().day, '2026-11-02');
  assert.notDeepEqual(b.read().course, course); assert.equal(b.nodes.dailyBest.textContent, '0');
});

test('an idle menu refreshes its UTC date without starting a round', () => {
  const b = boot({ date: '2026-11-01T23:59:59Z' });
  b.advance(2000);
  assert.equal(b.read().phase, 'menu'); assert.equal(b.read().day, '2026-11-02');
  assert.match(b.nodes.courseInfo.textContent, /2026-11-02 UTC/);
});

test('classic remains available with three hearts, a 200-point goal and no daily course', () => {
  const b = boot(); b.select('classic'); b.click('startBtn'); b.advance(1000);
  assert.equal(b.read().mode, 'classic'); assert.equal(b.read().lives, 3);
  assert.deepEqual(b.read().course, []); assert.match(b.nodes.phase.textContent, /200 points/);
  assert.equal(b.nodes.dailyBest.parentElement.hidden, true);
  b.key('Space'); assert.equal(b.read().lane, 1);
  b.advance(60000); assert.ok(['over', 'win'].includes(b.read().phase));
  assert.equal([...b.store.values.keys()].some(k => k.includes('daily:')), false);
  assert.equal(Number(b.nodes.overallBest.textContent), b.read().score);
});

test('a blocked localStorage getter does not prevent playing, ending or retrying', () => {
  const b = boot({ store: 'blocked' }); b.click('startBtn'); b.advance(61000);
  assert.ok(['over', 'win'].includes(b.read().phase));
  const best = Number(b.nodes.dailyBest.textContent); assert.ok(best > 0);
  b.click('startBtn'); assert.equal(b.read().phase, 'playing');
  assert.equal(Number(b.nodes.dailyBest.textContent), best);
});

// Integration controller: inspect the same simulated objects that are rendered,
// then use the real lane-switch handler. Never alter health, time or mission state.
function flyLeg(b, { avoidRocks = true, onFrame = () => {} } = {}) {
  for (let step = 0; step < 800 && b.read().phase === 'playing'; step++) {
    const run = b.read();
    const danger = lane => run.objs.some(o => {
      if (o.kind !== 'rock') return false;
      for (let t = 0; t <= .8; t += .025) {
        const radius = run.laneR + Math.max(-620 * t, Math.min(620 * t, [150, 225][lane] - run.laneR));
        const rockRadius = o.r - run.leg.speed * t;
        const angle = run.angle + run.leg.angularSpeed * t;
        const delta = Math.abs(Math.atan2(Math.sin(angle - o.a), Math.cos(angle - o.a)));
        if (Math.abs(radius - rockRadius) < 24 && delta < .24) return true;
      }
      return false;
    });
    if (avoidRocks && danger(run.lane) && !danger(1 - run.lane)) b.key('Space');
    b.advance(50);
    onFrame(b.read(), run);
  }
  assert.notEqual(b.read().phase, 'playing', 'a leg must reach an arrival or a defeat within 40 seconds');
  return b.read();
}

test('expedition begins at a frozen departure dock and only an explicit route starts flight', () => {
  const b = boot({ mode: 'expedition' }); b.click('startBtn');
  assert.equal(b.read().mode, 'expedition'); assert.equal(b.read().phase, 'dock');
  assert.equal(b.read().relay.energy, 2); assert.equal(b.read().relay.completed, 0);
  assert.equal(b.nodes.mode.disabled, true); assert.equal(b.nodes.repairBtn.disabled, true);
  assert.equal(b.nodes.records.hidden, true);
  const dock = b.read();
  for (const key of ['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'KeyP', 'Escape']) b.key(key);
  b.click('repairBtn'); b.advance(3000); b.hidden(true); b.advance(5000); b.hidden(false);
  assert.deepEqual(b.read(), dock);
  b.select('classic'); assert.deepEqual(b.read(), dock);
  b.click('safeBtn'); assert.equal(b.read().phase, 'playing');
  assert.equal(b.read().relay.route, 'safe'); assert.equal(b.read().relay.energy, 2);
  assert.equal(b.focused(), 'game');
  const flight = b.read(); b.click('safeBtn'); b.click('salvageBtn');
  assert.deepEqual(b.read(), flight, 'queued route clicks cannot replace or restart an active leg');
  assert.equal(b.messages.filter(m => m.event === 'start').length, 1);
  assert.equal(b.messages.filter(m => m.event === 'end').length, 0);
});

test('safe and salvage choices start materially different flights, without pre-paying arrival rewards', () => {
  const safe = boot({ mode: 'expedition' }), salvage = boot({ mode: 'expedition' });
  safe.click('startBtn'); salvage.click('startBtn');
  safe.click('safeBtn'); salvage.click('salvageBtn');
  const a = safe.read(), b = salvage.read();
  assert.ok(b.leg.duration > a.leg.duration); assert.ok(b.leg.speed > a.leg.speed);
  assert.ok(b.course.length > a.course.length); assert.notDeepEqual(a.course, b.course);
  assert.equal(a.relay.energy, 2); assert.equal(b.relay.energy, 2);
  assert.equal(a.lives, 3); assert.equal(b.lives, 3);
});

test('three expedition flights finish once, carry cargo through docks and keep Classic/Daily records intact', () => {
  const store = storage();
  store.setItem('orbit-runner:best:v1', '17');
  store.setItem('orbit-runner:daily:v1:2026-11-01', '11');
  const recordsBefore = [...store.values];
  const b = boot({ mode: 'expedition', store }); b.click('startBtn');
  let collected = 0, passedClassicGoal = false;
  for (let stage = 0; stage < 3; stage++) {
    assert.equal(b.read().phase, 'dock'); assert.equal(b.read().relay.completed, stage);
    b.click('salvageBtn');
    assert.equal(b.read().time, 0); assert.equal(b.read().relay.route, 'salvage');
    const after = flyLeg(b, { onFrame(next, previous) {
      const arrival = next.relay.completed > previous.relay.completed ? 3 : 0;
      const cells = next.relay.energy - previous.relay.energy - arrival;
      assert.ok(cells >= 0 && Number.isInteger(cells)); collected += cells;
      if (next.phase === 'playing' && next.score >= 200) passedClassicGoal = true;
    } });
    assert.equal(after.relay.completed, stage + 1);
    assert.equal(after.relay.legs.length, stage + 1);
    assert.equal(after.relay.energy, 2 + (stage + 1) * 3 + collected);
    assert.equal(after.time, after.leg.duration); assert.ok(after.lives > 0);
    if (stage < 2) {
      assert.equal(after.phase, 'dock'); assert.equal(after.relay.status, 'dock');
      b.key('Space'); b.key('Enter'); b.key('Escape');
      b.hidden(true); b.advance(2000); b.hidden(false); b.advance(2000);
      assert.deepEqual(b.read(), after, 'arrival cannot pay twice or resume on a keyboard/background event');
      assert.equal(b.messages.filter(m => m.event === 'end').length, 0);
    }
  }
  const done = b.read();
  assert.equal(done.phase, 'win'); assert.equal(done.relay.status, 'win');
  assert.equal(passedClassicGoal, true, 'Expedition must continue beyond Classic\'s 200-point victory');
  assert.equal(b.nodes.mode.disabled, false);
  assert.ok(b.nodes.relayReport.textContent.length > 0, 'completion must have a visible result');
  b.click('safeBtn'); b.click('salvageBtn'); b.click('repairBtn'); b.advance(5000);
  assert.deepEqual(b.read(), done);
  assert.equal(b.messages.filter(m => m.event === 'start').length, 1);
  assert.equal(b.messages.filter(m => m.event === 'end').length, 1);
  assert.ok(b.messages.every(m => m.origin === 'https://lob7.com'));
  assert.deepEqual([...store.values], recordsBefore);
  b.click('startBtn');
  assert.equal(b.read().phase, 'dock'); assert.equal(b.read().lives, 3);
  assert.equal(b.read().relay.energy, 2); assert.equal(b.read().relay.completed, 0);
  assert.equal(b.read().score, 0); assert.deepEqual(b.read().relay.legs, []);
  assert.deepEqual([...store.values], recordsBefore);
});

test('expedition pause and visibility changes freeze flight without consuming cargo or resetting its route', () => {
  const b = boot({ mode: 'expedition' }); b.click('startBtn'); b.click('safeBtn'); b.advance(1000);
  b.key('KeyP'); const paused = b.read();
  assert.equal(paused.phase, 'paused'); b.advance(4000); assert.deepEqual(b.read(), paused);
  b.click('salvageBtn'); b.click('repairBtn'); assert.deepEqual(b.read(), paused);
  b.key('KeyP'); b.advance(500); assert.ok(b.read().time > paused.time);
  b.hidden(true); const hidden = b.read(); b.advance(4000); assert.deepEqual(b.read(), hidden);
  b.hidden(false); assert.equal(b.read().phase, 'playing');
  assert.equal(b.read().relay.route, 'safe'); assert.equal(b.read().relay.energy, hidden.relay.energy);
});

test('expedition flight uses a deterministic fixed simulation across rendering rates and dates', () => {
  const a = boot({ mode: 'expedition', random: .1 });
  const b = boot({ mode: 'expedition', random: .9 });
  a.click('startBtn'); b.click('startBtn'); a.click('salvageBtn'); b.click('salvageBtn');
  a.advance(5000, 1000 / 120); b.advance(5000, 40);
  assert.deepEqual(a.read(), b.read());
  a.key('Space'); b.key('Space'); a.advance(2000, 1000 / 120); b.advance(2000, 40);
  assert.deepEqual(a.read(), b.read());
  const tomorrow = boot({ mode: 'expedition', date: '2026-11-02T12:00:00Z' });
  tomorrow.click('startBtn'); tomorrow.click('salvageBtn');
  assert.deepEqual(tomorrow.read().course, a.read().course, 'the expedition route is not another UTC daily course');
});

test('repair button spends cargo for actual hull health, rejects poor/full-health purchases, and cannot revive a lost run', () => {
  const b = boot({ mode: 'expedition' }); b.click('startBtn'); b.click('safeBtn');
  // Boundary fixture: a valid first arrival, two missing hearts, three cells.
  b.boundaryFixture({ phase: 'dock', lives: 1, relay: { stage: 1, completed: 1, energy: 3, status: 'dock', route: null,
    legs: [{ stage: 0, route: 'safe', arrivalEnergy: 1 }] } });
  b.click('repairBtn');
  assert.equal(b.read().lives, 2); assert.equal(b.read().relay.energy, 1);
  assert.equal(b.nodes.repairBtn.disabled, true);
  const poor = b.read(); b.click('repairBtn'); assert.deepEqual(b.read(), poor);
  b.boundaryFixture({ relay: { ...b.read().relay, energy: 4 } });
  b.click('repairBtn'); assert.equal(b.read().lives, 3); assert.equal(b.read().relay.energy, 2);
  assert.equal(b.nodes.repairBtn.disabled, true);
  const full = b.read(); b.click('repairBtn'); assert.deepEqual(b.read(), full);
  b.click('safeBtn'); const departure = b.read(); b.click('repairBtn'); assert.deepEqual(b.read(), departure);

  // Arrange a lethal contact at the player's actual rendered position, then run the real collision update.
  b.boundaryFixture({ lives: 1, invuln: 0,
    objs: [{ a: b.read().angle, r: b.read().laneR, spin: 0, kind: 'rock', dodged: false }] });
  const energyBeforeHit = b.read().relay.energy; b.advance(20);
  assert.equal(b.read().phase, 'over'); assert.equal(b.read().relay.status, 'lost');
  assert.equal(b.read().lives, 0); assert.equal(b.read().relay.energy, energyBeforeHit);
  assert.equal(b.read().relay.completed, 1); assert.equal(b.read().relay.legs.length, 1);
  const lost = b.read(); b.click('repairBtn'); b.click('safeBtn'); b.advance(1000);
  assert.deepEqual(b.read(), lost);
  assert.equal(b.messages.filter(m => m.event === 'end').length, 1);
  assert.equal(b.store.values.size, 0);
});

test('the final arrival reports an energy shortfall instead of a score victory, and final-tick death grants no arrival', () => {
  function finalApproach() {
    const b = boot({ mode: 'expedition' }); b.click('startBtn'); b.click('safeBtn');
    // Boundary fixture: valid last flight immediately before arrival, with inadequate cargo and a high arcade score.
    const leg = require('../relay-expedition.js').getLeg(2, 'safe');
    b.boundaryFixture({ phase: 'playing', leg, time: leg.duration - .005, score: 999, objs: [], course: [], nextSpawn: 0,
      relay: { stage: 2, completed: 2, energy: 4, status: 'flight', route: 'safe',
        legs: [{ stage: 0, route: 'safe', arrivalEnergy: 1 }, { stage: 1, route: 'safe', arrivalEnergy: 1 }] } });
    return b;
  }
  const short = finalApproach(); short.advance(20);
  assert.equal(short.read().phase, 'over'); assert.equal(short.read().relay.status, 'shortfall');
  assert.equal(short.read().relay.completed, 3); assert.equal(short.read().relay.energy, 5);
  assert.match(short.nodes.phase.textContent, /not enough|shortfall/i);
  assert.equal(short.nodes.relayReport.hidden, false); assert.match(short.nodes.relayReport.textContent, /5/);
  const terminal = short.read(); short.advance(1000); assert.deepEqual(short.read(), terminal);
  assert.equal(short.store.values.size, 0);

  const dead = finalApproach();
  dead.boundaryFixture({ lives: 1, invuln: 0,
    objs: [{ a: dead.read().angle, r: dead.read().laneR, spin: 0, kind: 'rock', dodged: false }] });
  dead.advance(20);
  assert.equal(dead.read().phase, 'over'); assert.equal(dead.read().relay.status, 'lost');
  assert.equal(dead.read().relay.completed, 2); assert.equal(dead.read().relay.energy, 4);
  assert.equal(dead.messages.filter(m => m.event === 'end').length, 1);
});

module.exports = { boot, storage, flyLeg };
