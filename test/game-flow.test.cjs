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
  const events = {}, nodes = {};
  const ctx = new Proxy({}, { get: (target, key) => key === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; } });
  for (const id of ['game', 'score', 'lives', 'phase', 'startBtn', 'pauseBtn', 'mode', 'courseInfo', 'dailyBest', 'overallBest']) {
    nodes[id] = { tagName: id === 'mode' ? 'SELECT' : id.endsWith('Btn') ? 'BUTTON' : 'CANVAS',
      value: id === 'mode' ? mode : '', textContent: '', parentElement: {},
      addEventListener: (kind, fn) => { events[id + ':' + kind] = fn; }, focus() {}, getContext: () => ctx };
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + clock])); }
    static now() { return epoch + clock; }
  }
  const document = { hidden: false, getElementById: id => nodes[id], addEventListener: (kind, fn) => { events[kind] = fn; } };
  const sandbox = { document, Date: FakeDate, Math: Object.assign(Object.create(Math), { random: () => random }),
    performance: { now: () => clock }, requestAnimationFrame: fn => { frame = fn; } };
  sandbox.window = sandbox; sandbox.parent = sandbox;
  Object.defineProperty(sandbox, 'localStorage', { get: () => { if (store === 'blocked') throw new Error('SecurityError'); return store; } });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../daily-orbit.js'), 'utf8'), sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
  // Test-only read access to the private state. Inputs still use the real DOM handlers.
  vm.runInContext(source.replace('  reset();', '  reset();\n  window.readRun = function () { return JSON.stringify(s); };'), sandbox);
  return { nodes, store, read: () => JSON.parse(sandbox.readRun()),
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

module.exports = { boot, storage };
