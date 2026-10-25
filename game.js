'use strict';
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 640;
  var H = 640;
  var CX = 320;
  var CY = 320;
  var LANES = [150, 225];
  var GOAL = 200;
  var TAU = Math.PI * 2;
  var scoreEl = document.getElementById('score');
  var livesEl = document.getElementById('lives');
  var phaseEl = document.getElementById('phase');
  var startBtn = document.getElementById('startBtn');
  var pauseBtn = document.getElementById('pauseBtn');

  function send(event) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'lob7:game', event: event }, 'https://lob7.com');
    }
  }

  var stars = [];
  for (var i = 0; i < 90; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * H,
      r: 0.4 + Math.random() * 1.5, p: Math.random() * TAU });
  }

  var s;
  function reset() {
    s = { phase: 'menu', score: 0, lives: 5, time: 0, angle: -Math.PI / 2,
      lane: 0, laneR: LANES[0], objs: [], spawnIn: 1.1, invuln: 0,
      shake: 0, lastAct: 0, autoPaused: false };
  }
  reset();

  function phaseText() {
    if (s.phase === 'menu') return 'Ready — press Start';
    if (s.phase === 'playing') return 'Running — reach ' + GOAL + ' points';
    if (s.phase === 'paused') return 'Paused';
    if (s.phase === 'win') return 'You win! Final score ' + s.score;
    return 'Game over — score ' + s.score;
  }

  function syncDom() {
    scoreEl.textContent = String(s.score);
    livesEl.textContent = s.lives > 0 ? new Array(s.lives + 1).join('♥') : '0';
    phaseEl.textContent = phaseText();
    startBtn.textContent = s.phase === 'menu' ? 'Start' : 'Restart';
    pauseBtn.textContent = s.phase === 'paused' ? 'Resume' : 'Pause';
    pauseBtn.disabled = s.phase !== 'playing' && s.phase !== 'paused';
  }

  function startGame() {
    if (s.phase === 'playing' || s.phase === 'paused') send('end');
    reset();
    s.phase = 'playing';
    syncDom();
    canvas.focus();
    send('start');
  }

  function pauseGame(auto) {
    if (s.phase !== 'playing') return;
    s.autoPaused = !!auto;
    s.phase = 'paused';
    syncDom();
    send('pause');
  }

  function resumeGame() {
    if (s.phase !== 'paused') return;
    s.autoPaused = false;
    s.phase = 'playing';
    syncDom();
    canvas.focus();
    send('resume');
  }

  function endGame(win) {
    s.phase = win ? 'win' : 'over';
    syncDom();
    send('end');
  }

  function switchLane() {
    if (s.phase === 'playing') {
      s.lane = 1 - s.lane;
      if (s.time - s.lastAct >= 2) { s.lastAct = s.time; send('activity'); }
    }
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return Math.abs(d);
  }

  function spawn() {
    s.objs.push({ a: Math.random() * TAU, r: 400, spin: Math.random() * TAU,
      kind: Math.random() < 0.3 ? 'crystal' : 'rock', dodged: false });
  }

  function update(dt) {
    if (s.phase !== 'playing') return;
    s.time += dt;
    var speed = 70 + s.time * 1.8;
    s.angle = (s.angle + (1.7 + Math.min(s.time * 0.012, 0.6)) * dt) % TAU;
    var target = LANES[s.lane];
    s.laneR += Math.max(-620 * dt, Math.min(620 * dt, target - s.laneR));
    if (s.invuln > 0) s.invuln -= dt;
    if (s.shake > 0) s.shake -= dt * 30;
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) {
      spawn();
      s.spawnIn = (1.15 + Math.random() * 0.6) / (1 + s.time * 0.01);
    }
    for (var i = s.objs.length - 1; i >= 0; i--) {
      var o = s.objs[i];
      o.r -= speed * dt;
      o.spin += dt;
      if (!o.dodged && o.r < LANES[0] - 26) {
        o.dodged = true;
        if (o.kind === 'rock') s.score += 5;
      }
      if (Math.abs(o.r - s.laneR) < 16 && angDiff(o.a, s.angle) < 0.17) {
        if (o.kind === 'crystal') {
          s.score += 20;
          s.objs.splice(i, 1);
        } else if (s.invuln <= 0) {
          s.lives -= 1;
          s.invuln = 1.6;
          s.shake = 9;
          s.objs.splice(i, 1);
        }
        continue;
      }
      if (o.r < 46) s.objs.splice(i, 1);
    }
    if (s.lives <= 0) endGame(false);
    else if (s.score >= GOAL) endGame(true);
    syncDom();
  }

  function drawShip() {
    var x = CX + Math.cos(s.angle) * s.laneR;
    var y = CY + Math.sin(s.angle) * s.laneR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s.angle + Math.PI / 2);
    if (s.invuln > 0 && Math.floor(s.time * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-10, 4); ctx.lineTo(-19, 0); ctx.lineTo(-10, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7ef0ff';
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(-10, 9); ctx.lineTo(-5, 0); ctx.lineTo(-10, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRock(o) {
    ctx.save();
    ctx.translate(CX + Math.cos(o.a) * o.r, CY + Math.sin(o.a) * o.r);
    ctx.rotate(o.spin);
    ctx.fillStyle = '#9b8c7a';
    ctx.beginPath();
    for (var k = 0; k < 7; k++) {
      var t = (k / 7) * TAU;
      var rr = 9 + ((k * 37) % 6);
      if (k === 0) ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
      else ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCrystal(o) {
    ctx.save();
    ctx.translate(CX + Math.cos(o.a) * o.r, CY + Math.sin(o.a) * o.r);
    ctx.rotate(o.spin * 0.6);
    ctx.fillStyle = '#8dff9e';
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(8, 0); ctx.lineTo(0, 11); ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawOverlay() {
    if (s.phase === 'playing') return;
    ctx.fillStyle = 'rgba(6, 11, 26, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ef0ff';
    if (s.phase === 'menu') {
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText('ORBIT RUNNER', CX, CY - 30);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText('Switch lanes. Dodge rocks. Catch crystals.', CX, CY + 10);
      ctx.fillText('Press Start or Space to fly.', CX, CY + 42);
    } else if (s.phase === 'paused') {
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText('PAUSED', CX, CY);
    } else {
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(s.phase === 'win' ? 'YOU WIN!' : 'GAME OVER', CX, CY - 20);
      ctx.font = '22px sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('Score: ' + s.score, CX, CY + 18);
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText('Press Start or Space to play again.', CX, CY + 50);
    }
  }

  function draw() {
    ctx.fillStyle = '#060b1a';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (s.shake > 0) {
      ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    }
    var t = performance.now() / 1000;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.5 + st.p));
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(126, 240, 255, 0.28)';
    ctx.lineWidth = 2;
    for (var l = 0; l < LANES.length; l++) {
      ctx.beginPath();
      ctx.arc(CX, CY, LANES[l], 0, TAU);
      ctx.stroke();
    }
    var glow = ctx.createRadialGradient(CX, CY, 6, CX, CY, 44);
    glow.addColorStop(0, '#fff3b0');
    glow.addColorStop(0.5, '#ffb347');
    glow.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(CX, CY, 44, 0, TAU);
    ctx.fill();
    for (var j = 0; j < s.objs.length; j++) {
      if (s.objs[j].kind === 'crystal') drawCrystal(s.objs[j]);
      else drawRock(s.objs[j]);
    }
    drawShip();
    ctx.restore();
    drawOverlay();
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (s.phase === 'playing') switchLane();
      else if (s.phase !== 'paused') startGame();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (s.phase === 'playing') pauseGame(false);
      else resumeGame();
    } else if (e.code === 'Enter' && s.phase !== 'playing' && s.phase !== 'paused') {
      startGame();
    }
  });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    canvas.focus();
    switchLane();
  });
  startBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', function () {
    if (s.phase === 'playing') pauseGame(false);
    else resumeGame();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame(true);
    else if (s.autoPaused) resumeGame();
  });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  syncDom();
  send('ready');
  requestAnimationFrame(frame);
})();
