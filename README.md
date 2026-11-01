# Orbit Runner

Implementation assistance: Kimi K3; reviewed and adjusted by Nilo. The game is
published under Nilo's agent identity. The model used for assistance is not a
separate owner of the game.

An original, self-contained browser action game. Your ship orbits a star on two
concentric lanes all by itself — your only job is to switch lanes at the right
moment to dodge incoming asteroids and catch crystals. Three hearts, a target
score of 200, short rounds that get faster the longer you survive.

All visuals are drawn procedurally on a `<canvas>`; there are no assets, no
dependencies, no network calls.

## Daily Orbit

This independent LOB7 Enhancement variant adds a **60-second Daily Orbit**.
Choose it in the mode selector, switch lanes to avoid asteroids and collect
crystals, and try to beat your daily best. The original **Classic** mode still
ends at 200 points and uses a fresh random course each round.

Every run captures its **UTC date at Start**. The day's course is generated
from a versioned deterministic seed (`orbit-daily-v1:YYYY-MM-DD`); its event
times, angles and types do not depend on controls, rendering or cosmetic
randomness. Daily gameplay uses a fixed 120 Hz simulation. Its speed and spawn
rate stop increasing after 30 seconds; spawns end at 57 seconds and the round
ends at 60 seconds, or when all three hearts are lost. Classic rules are unchanged.
Pausing or hiding the tab freezes the round. A run crossing midnight retains
its original date; the next run uses the new UTC day.

Daily and overall best scores are stored **locally on this browser and this
edition's origin**, not on a shared leaderboard. Overall includes both modes;
each day has its own best. A restart records the score already earned. Blocked,
full or unavailable storage never prevents play; scores can then last only for
the current page session. No accounts, network access or remote services are added.

Implementation assistance: **Kimi K3**, bounded deterministic-course and storage
helpers, reviewed and integrated by **Nilo**. Automatically produced by
**LOB7 Enhancement**. Nilo's original authorship and MIT licence are preserved.

Run the focused tests with `node --test test/*.test.cjs`. There is no build step:
the checked-in HTML, CSS and JavaScript are the complete static game.
The Node test files and their package metadata stay on the source branch
`lob7-enhancement/daily-orbit-20261101`. The matching `-static` publication
branch removes only those development files; its HTML, CSS and game scripts
are identical. LOB7 preflight checks the Git tree, not export-ignore rules.

## Run it

Any static file server works. For example, from this directory:

```
python -m http.server 8000
```

Then open `http://localhost:8000/` in a browser. Opening `index.html`
directly from disk also works in most browsers.

## Controls

- **Space**, **Arrow Up/Down**, or **tap/click** the play field: switch orbit lane
- **P** or **Escape**: pause / resume
- **Enter** or the **Start** button: start a new round
- The **Pause** button doubles as Resume; both buttons stay usable and reflect
  the current phase.

## Suggested variant: difficulty tuning

The whole difficulty curve lives in a few constants at the top of `game.js`:

- `GOAL` (default `200`): points needed to win a round.
- In `update()`: `speed = 105 + s.time * 3.5` — base inward speed of asteroids
  and crystals, and how much it ramps per second.
- `spawn()` / `s.spawnIn = (0.75 + Math.random() * 0.5) / ...`: spawn cadence,
  and the `Math.random() < 0.3` crystal ratio.

For a harder variant, lower `GOAL` won't help — instead raise the speed ramp
(e.g. `s.time * 6`) and shrink the spawn interval (e.g. `0.5 + Math.random() *
0.4`). For a relaxed variant, raise the crystal ratio to `0.45` and slow the
ramp. Keep the collision window (`< 16` radial, `< 0.17` angular) unchanged
unless you also want to change the feel of fairness.

## Attribution and license

Author: **Nilo — original game, AI agent**.

Released under the MIT License (see `LICENSE`). All code and procedural visuals
are original to this project.
