// Play: a side-on badminton rally game against the computer.
// Arrow keys move, Space swings (hold and release to serve). The score, who serves,
// which service court and every fault follow the real rules through engine.js.
import { createMatch, pointTo, positions, currentGame, umpireCall, SYSTEMS } from './engine.js';
import { Court, L, NET, SHORT, LONG_D } from './court.js';
import { matchPlayers } from './scene.js';

const NET_H = 1.524; // net height in the middle (m)
const REACH_X = 0.95; // how far from a player's body the racket reaches (m)
const REACH_H = 2.75; // highest a player can reach, with a jump (m)
const SERVE_H = 0.95; // contact height on the serve: always below the 1.15 m limit
const LEVELS = {
  easy: { speed: 3.6, error: 0.15, serveFault: 0.12, leave: 0.4, smart: 0.2 },
  normal: { speed: 4.6, error: 0.08, serveFault: 0.06, leave: 0.7, smart: 0.55 },
  hard: { speed: 5.6, error: 0.04, serveFault: 0.02, leave: 0.92, smart: 0.85 },
};
const YOU_SPEED = 5.4;

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Where the serve must land when `side` serves. Team A is always on the left in the side view. */
function serviceBox(side, discipline) {
  const back = discipline === 'doubles' ? LONG_D : 0;
  return side === 'A' ? { from: NET + SHORT, to: L - back } : { from: back, to: NET - SHORT };
}

/** A flight from `from` to a landing point, rising to `peak` at fraction `at` of the way. */
function flight(from, land, peak, at, ms, decel = 1.6) {
  const hAt = (u) => (u < at ? from.h + (peak - from.h) * (1 - (1 - u / at) ** 2) : peak * (1 - ((u - at) / (1 - at)) ** 2));
  return { from, land, ms, decel, x: (u) => from.x + (land - from.x) * u, h: hAt };
}

export function renderPlay(root) {
  const node = h(`
    <section class="play">
      <h1 class="page-title">Rally game</h1>
      <p class="lead">Play a real game against the computer. Score, serving order, service courts and faults follow the rules from the lessons.</p>
      <div class="play-setup card">
        <div class="play-opts">
          <div><span class="opt-label">Discipline</span><div class="seg" data-opt="disc"><button class="seg-btn on" data-v="singles">Singles</button><button class="seg-btn" data-v="doubles">Doubles</button></div></div>
          <div><span class="opt-label">Length</span><div class="seg" data-opt="sys"><button class="seg-btn on" data-v="1x7">Short game (to 7)</button><button class="seg-btn" data-v="3x15">Match (3 × 15)</button></div></div>
          <div><span class="opt-label">Opponent</span><div class="seg" data-opt="level"><button class="seg-btn" data-v="easy">Easy</button><button class="seg-btn on" data-v="normal">Normal</button><button class="seg-btn" data-v="hard">Hard</button></div></div>
        </div>
        <div class="play-help">
          <p><kbd>←</kbd> <kbd>→</kbd> move &nbsp; <kbd>Space</kbd> swing &nbsp; hold <kbd>↓</kbd> for a drop shot &nbsp; hold <kbd>↑</kbd> for a high clear &nbsp; <kbd>P</kbd> pause</p>
          <p><b>Serving:</b> hold <kbd>Space</kbd> and release when the target marker is inside the green service box. Keep your feet still while you serve.</p>
          <p><b>Receiving:</b> stay still until the serve is hit. If a shot is going out, <b>leave it</b> and win the point. Get close to the shuttle before you swing: hits at full stretch often go wrong.</p>
        </div>
        <button class="btn big" data-act="start">Start game ▶</button>
      </div>
      <div class="play-game" hidden>
        <div class="play-score">
          <div class="ps-team a"><span class="ps-name">You</span><span class="ps-games"></span><span class="ps-pts" data-pts="A">0</span></div>
          <div class="ps-mid"><span class="ps-call"></span><span class="ps-sub"></span></div>
          <div class="ps-team b"><span class="ps-pts" data-pts="B">0</span><span class="ps-games"></span><span class="ps-name">CPU</span></div>
        </div>
        <div class="play-canvas-wrap">
          <canvas class="play-canvas" aria-label="Badminton rally game. Use the arrow keys to move and Space to swing."></canvas>
          <div class="play-overlay" hidden></div>
        </div>
        <div class="play-why caption" aria-live="polite"></div>
        <div class="play-touch" aria-hidden="true">
          <button class="pt-btn" data-k="ArrowLeft">◀</button>
          <button class="pt-btn" data-k="ArrowRight">▶</button>
          <button class="pt-btn" data-k="ArrowDown">Drop ▼</button>
          <button class="pt-btn" data-k="ArrowUp">Clear ▲</button>
          <button class="pt-btn swing" data-k="Space">Swing</button>
        </div>
        <div class="play-lower">
          <div class="play-mini"><div class="play-mini-court"></div><p class="play-mini-t"></p></div>
          <div class="btn-row"><button class="btn ghost" data-act="pause">Pause</button><button class="btn ghost" data-act="quit">End game</button></div>
        </div>
      </div>
    </section>`);
  root.appendChild(node);
  const $ = (q) => node.querySelector(q);
  const opts = { disc: 'singles', sys: '1x7', level: 'normal' };
  node.querySelectorAll('[data-opt]').forEach((seg) =>
    seg.querySelectorAll('.seg-btn').forEach((b) =>
      b.addEventListener('click', () => {
        seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        opts[seg.dataset.opt] = b.dataset.v;
      }),
    ),
  );

  const canvas = $('.play-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = $('.play-overlay');
  const why = $('.play-why');
  const mini = new Court($('.play-mini-court'), { label: 'Where everyone stands for the serve' });
  let G = null; // the running game
  let raf = 0;
  let colours = {};
  const keys = new Set();

  /* ------------------------------------------------------------ geometry */
  let W = 0;
  let H = 0;
  let k = 1; // px per metre along the court
  let hk = 1; // px per metre up
  let floorY = 0;
  const X = (m) => 24 + m * k;
  const Y = (hm) => floorY - hm * hk;
  const resize = () => {
    const w = canvas.parentElement.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    W = w;
    H = Math.round(clamp(w * 0.46, 190, 430));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    k = (W - 48) / L;
    floorY = H - 34;
    hk = Math.min(k * 0.8, (floorY - 14) / 6.2);
  };
  const readColours = () => {
    const cs = getComputedStyle(node);
    for (const v of ['bg', 'surface', 'surface-2', 'ink', 'muted', 'court', 'accent', 'a', 'b', 'good', 'bad', 'warn', 'line']) colours[v] = cs.getPropertyValue(`--${v}`).trim();
  };

  /* ------------------------------------------------------------ game setup */
  function start() {
    const level = LEVELS[opts.level];
    const s = createMatch({ system: opts.sys, discipline: opts.disc, players: { A: ['A1', 'A2'], B: ['C1', 'C2'] }, firstServer: 'A', teamNames: { A: 'You', B: 'CPU' } });
    const count = opts.disc === 'doubles' ? 2 : 1;
    const players = [];
    for (const side of ['A', 'B']) for (let i = 0; i < count; i++) players.push({ side, idx: i, x: 0, swing: 0, swingHit: false, label: side === 'A' ? `A${i + 1}` : `C${i + 1}` });
    G = { s, level, players, phase: 'serve', clock: 0, timers: [], sh: null, mark: null, active: 0, charge: null, paused: false, cpuServeAt: 0 };
    $('.play-setup').hidden = true;
    $('.play-game').hidden = false;
    overlay.hidden = true;
    document.activeElement?.blur?.();
    resize();
    readColours();
    renderScore();
    setupServe();
    cancelAnimationFrame(raf);
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (G && !G.paused) step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    canvas.focus?.();
  }

  const player = (side, idx) => G.players.find((p) => p.side === side && p.idx === idx);
  const team = (side) => G.players.filter((p) => p.side === side);
  const later = (ms, fn) => G.timers.push({ at: G.clock + ms / 1000, fn });

  /** Put everyone in their serve positions from the engine, and explain why. */
  function setupServe() {
    const s = G.s;
    const pos = positions(s);
    const doubles = s.discipline === 'doubles';
    for (const p of G.players) {
      const serving = p.side === pos.serverSide;
      const activeIdx = serving ? pos.server : pos.receiver;
      const depth = doubles && p.idx !== activeIdx ? 2.9 : serving ? 1.05 : 1.25;
      p.x = p.side === 'A' ? NET - SHORT - depth : NET + SHORT + depth;
      p.swing = 0;
    }
    G.server = { side: pos.serverSide, idx: pos.server };
    G.receiver = { side: pos.receiverSide, idx: pos.receiver };
    G.active = pos.serverSide === 'A' ? pos.server : pos.receiver;
    G.sh = null;
    G.charge = null;
    G.phase = 'serve';
    G.serveStill = true;
    // Mini court: the same picture as the Learn lessons, with you on the left.
    const shown = { ...s, leftEnd: 'A' };
    const { list, serverEnd } = matchPlayers(shown, { names: false });
    mini.serviceAreas(serverEnd, pos.court, s.discipline);
    mini.setPlayers(list.map((p) => ({ ...p, label: p.team === 'A' ? `A${+p.id[1] + 1}` : `C${+p.id[1] + 1}` })));
    const g = currentGame(s);
    const sc = g[pos.serverSide];
    const who = pos.serverSide === 'A' ? (doubles ? `You (A${pos.server + 1})` : 'You') : doubles ? `CPU (C${pos.server + 1})` : 'CPU';
    $('.play-mini-t').innerHTML = `<b>${who}</b> serve${pos.serverSide === 'A' ? '' : 's'} from the <b>${pos.court}</b> service court: the server’s score is ${sc}, which is <b>${sc % 2 === 0 ? 'even' : 'odd'}</b>.${doubles ? ' The receiver is diagonally opposite. Only the receiver may return the serve.' : ''}`;
    if (pos.serverSide === 'A') {
      say(`<b>Your serve.</b> Hold <kbd>Space</kbd> (or <b>Swing</b>), release when the marker is in the green box. ${s.discipline === 'doubles' ? 'In doubles the box ends at the <b>long service line</b>, 0.76 m before the back line.' : 'In singles the box runs to the <b>back line</b>.'}`);
    } else {
      say('<b>CPU to serve.</b> Stay still until the serve is hit. If it is going to land outside the service box, leave it.');
      G.cpuServeAt = G.clock + rnd(1.1, 1.7);
    }
  }

  const say = (html, tone = '') => {
    why.className = `play-why caption ${tone}`;
    why.innerHTML = html;
  };

  /* ------------------------------------------------------------ serving */
  function serve(side, land, peak, at, ms) {
    const sv = player(side, G.server.idx);
    const from = { x: sv.x + (side === 'A' ? 0.45 : -0.45), h: SERVE_H };
    sv.swing = 0.001;
    G.sh = { f: flight(from, land, peak, at, ms), t: 0, by: side, byIdx: G.server.idx, serve: true, prev: from, falling: null };
    G.phase = 'rally';
    say('<b>Rally.</b> <kbd>←</kbd> <kbd>→</kbd> to get under the shuttle, <kbd>Space</kbd> to hit. If a shot is going out, leave it.');
    planReceive();
  }

  function yourServe(power) {
    const land = NET + 1.0 + power * (L + 0.7 - NET - 1.0);
    serve('A', land, 1.75 + power ** 1.5 * 4.8, 0.6 + 0.1 * power, 1100 + power * 1300);
  }

  function cpuServe() {
    const d = G.s.discipline;
    const box = serviceBox('B', d);
    let land;
    let kind;
    if (Math.random() < G.level.serveFault) {
      kind = 'fault';
      land = Math.random() < 0.5 ? box.to + rnd(0.2, 0.6) : box.from - rnd(0.15, 0.5);
    } else {
      kind = (d === 'singles' ? Math.random() < 0.6 : Math.random() < 0.15) ? 'high' : 'low';
      land = kind === 'high' ? box.from + rnd(0.1, 0.6) : box.to - rnd(0.1, 0.5);
    }
    const dist = Math.abs(NET + SHORT + 1.05 - land);
    const high = land < NET - SHORT - 2.5;
    serve('B', land, high ? (d === 'singles' ? 6 : 3.4) : 1.8, high ? 0.65 : 0.6, high ? (d === 'singles' ? 2300 : 1300) : 1200 + dist * 20);
  }

  /* ------------------------------------------------------------ rally */
  /** Decide who on the receiving side goes for the shuttle, and whether the CPU leaves it. */
  function planReceive() {
    const sh = G.sh;
    const to = sh.by === 'A' ? 'B' : 'A';
    const f = sh.f;
    // Intercept: the last point on the way down where the shuttle is still at a comfortable height.
    let ix = f.land;
    for (let i = 60; i >= 0; i--) {
      const u = i / 60;
      if ((to === 'B' ? f.x(u) > NET : f.x(u) < NET) && f.h(u) >= 1.1) {
        ix = f.x(u);
        break;
      }
    }
    sh.ix = ix;
    const goingOut = f.land < 0 || f.land > L || (sh.serve && !inBox(sh.by, f.land));
    if (to === 'A') {
      if (sh.serve) G.active = G.receiver.idx;
      else if (team('A').length > 1) G.active = team('A').reduce((best, p) => (Math.abs(p.x - ix) < Math.abs(best.x - ix) ? p : best)).idx;
    } else {
      sh.cpu = sh.serve ? G.receiver.idx : team('B').reduce((best, p) => (Math.abs(p.x - ix) < Math.abs(best.x - ix) ? p : best)).idx;
      sh.cpuLeave = goingOut && Math.random() < G.level.leave;
    }
  }

  const inBox = (side, x) => {
    const b = serviceBox(side, G.s.discipline);
    return x >= b.from && x <= b.to;
  };

  function canReach(p, sh, pos) {
    if (!sh || sh.falling || sh.by === p.side) return false;
    const onMySide = p.side === 'A' ? pos.x < NET : pos.x > NET;
    return onMySide && Math.abs(pos.x - p.x) <= REACH_X && pos.h >= 0.12 && pos.h <= REACH_H;
  }

  /** Send the shuttle back from player `p`. kind: 'drop' | 'clear' | 'smash' | 'push' */
  function hit(p, kind, pos) {
    const sh = G.sh;
    const toward = p.side === 'A' ? 1 : -1;
    const near = (m) => NET + toward * m; // m metres past the net on the other side
    const far = (m) => (p.side === 'A' ? L - m : m);
    const stretch = Math.abs(pos.x - p.x) / REACH_X;
    const errChance = p.side === 'A' ? (stretch > 0.78 ? 0.38 : 0.02) : G.level.error;
    const from = { x: pos.x, h: kind === 'smash' ? Math.max(pos.h, 2.6) : pos.h };
    let f;
    if (Math.random() < errChance) {
      if (Math.random() < 0.5) f = flight(from, near(0.4), Math.min(1.25, from.h + 0.2), 0.3, 900); // into the net
      else f = flight(from, far(-rnd(0.3, 0.9)), 5, 0.6, 1800); // long
      sh.err = true;
    } else if (kind === 'smash') {
      const depth = Math.abs(NET - p.x);
      f = flight(from, clamp(near(2 + depth * 0.9), Math.min(near(2), far(0.8)), Math.max(near(2), far(0.8))), from.h, 0.0001, 520, 1.15);
    } else if (kind === 'drop') {
      f = flight(from, near(rnd(0.5, 1.7)), Math.max(from.h + 0.3, 2.1), 0.45, 1150);
    } else if (kind === 'clear') {
      f = flight(from, far(rnd(0.3, 1.2)), 5.8, 0.62, 1900);
    } else {
      f = flight(from, near(rnd(2.4, NET - 1.4)), 3.1, 0.55, 1300);
    }
    p.swing = 0.001;
    p.swingHit = true;
    G.sh = { f, t: 0, by: p.side, byIdx: p.idx, serve: false, prev: from, falling: null };
    planReceive();
  }

  function cpuShot(pos) {
    const you = player('A', G.active);
    const smart = Math.random() < G.level.smart;
    if (pos.h >= 2.0 && Math.random() < 0.55) return 'smash';
    if (smart) return you.x > NET - 2.6 ? 'clear' : you.x < 2.2 ? 'drop' : Math.random() < 0.5 ? 'push' : 'drop';
    const r = Math.random();
    return r < 0.3 ? 'drop' : r < 0.6 ? 'clear' : 'push';
  }

  function award(side, html, tone) {
    if (G.phase === 'point' || G.phase === 'over') return;
    G.phase = 'point';
    G.charge = null;
    G.s = pointTo(G.s, side);
    const call = umpireCall(G.s);
    const ev = G.s.events;
    const extra = ev.includes('interval') || ev.includes('game') ? ` <b>${call.sub}</b>` : '';
    say(`${html} <b>Point to ${side === 'A' ? 'you' : 'the CPU'}.</b>${extra}`, tone || (side === 'A' ? 'tone-good' : 'tone-bad'));
    renderScore();
    if (G.s.winner) {
      later(1400, finish);
      return;
    }
    later(ev.includes('game') ? 3200 : ev.includes('interval') ? 2600 : 1700, setupServe);
  }

  function finish() {
    G.phase = 'over';
    const s = G.s;
    const won = s.winner === 'A';
    const scores = s.games.map((g) => `${g.A}–${g.B}`).join(', ');
    overlay.hidden = false;
    overlay.innerHTML = `<div class="po-card"><b class="po-title ${won ? 'good' : 'bad'}">${won ? 'You win!' : 'CPU wins'}</b><span>${scores}</span><div class="btn-row"><button class="btn" data-act="again">Play again</button><button class="btn ghost" data-act="setup">Change settings</button></div></div>`;
    overlay.querySelector('[data-act=again]').addEventListener('click', start);
    overlay.querySelector('[data-act=setup]').addEventListener('click', toSetup);
  }

  function renderScore() {
    const s = G.s;
    const g = currentGame(s);
    node.querySelector('[data-pts=A]').textContent = g.A;
    node.querySelector('[data-pts=B]').textContent = g.B;
    const sys = SYSTEMS[s.system];
    const games = (side) => (sys.gamesToWin > 1 ? '●'.repeat(s.games.filter((x) => x.winner === side).length) : '');
    node.querySelectorAll('.ps-games')[0].textContent = games('A');
    node.querySelectorAll('.ps-games')[1].textContent = games('B');
    const call = umpireCall(s);
    $('.ps-call').textContent = call.main;
    $('.ps-sub').textContent = s.server === 'A' ? 'You serve' : 'CPU serves';
    node.querySelectorAll('.ps-team').forEach((t) => t.classList.toggle('serving', t.classList.contains(s.server === 'A' ? 'a' : 'b')));
  }

  /* ------------------------------------------------------------ the frame step */
  function step(dt) {
    G.clock += dt;
    const due = G.timers.filter((t) => t.at <= G.clock);
    G.timers = G.timers.filter((t) => t.at > G.clock);
    due.forEach((t) => t.fn());
    for (const p of G.players) {
      if (p.swing > 0) {
        p.swing += dt / 0.28;
        if (p.swing >= 1) {
          p.swing = 0;
          p.swingHit = false;
        }
      }
    }
    const you = player('A', G.active);
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');

    if (G.phase === 'serve') {
      if (G.server.side === 'B' && G.clock >= G.cpuServeAt) cpuServe();
      return;
    }
    if (G.phase !== 'rally') return;

    // You move.
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    you.x = clamp(you.x + dir * YOU_SPEED * dt, -0.6, NET - 0.35);
    // Your partner (doubles) covers the other half of your side.
    for (const p of team('A')) if (p !== you) p.x += clamp((you.x > 3.6 ? 1.9 : 4.6) - p.x, -3 * dt, 3 * dt);

    const sh = G.sh;
    if (!sh) return;
    // The shuttle flies (or drops after hitting the net).
    if (sh.falling) {
      sh.falling.h = Math.max(0, sh.falling.h - dt * 4);
      if (sh.falling.h <= 0 && !sh.done) {
        sh.done = true;
        G.mark = { x: sh.falling.x, ok: false, text: 'NET', until: G.clock + 1.6 };
        award(sh.by === 'A' ? 'B' : 'A', sh.serve ? '<b>Service fault:</b> the serve hit the net.' : sh.by === 'A' ? 'Your shot <b>hit the net</b>.' : 'The CPU’s shot <b>hit the net</b>.');
      }
    } else {
      sh.t += (dt * 1000) / sh.f.ms;
      const u = 1 - (1 - Math.min(1, sh.t)) ** sh.f.decel;
      const pos = { x: sh.f.x(u), h: sh.f.h(u) };
      // Crossing the net below the tape: the shuttle stops and drops on the hitter's side.
      if ((sh.prev.x - NET) * (pos.x - NET) <= 0 && pos.x !== sh.prev.x && pos.h < NET_H) {
        sh.falling = { x: NET + (sh.by === 'A' ? -0.12 : 0.12), h: pos.h };
      } else if (sh.t >= 1) {
        landed(sh, pos.x);
      }
      sh.prev = pos;
      sh.pos = pos;
    }
    if (!G.sh || G.sh.falling || G.sh.done) return;
    const pos = G.sh.pos;
    if (!pos) return;

    // You hit if a swing is under way and the shuttle is within reach.
    if (you.swing > 0 && !you.swingHit && canReach(you, G.sh, pos)) {
      const kind = keys.has('ArrowDown') || keys.has('KeyS') ? 'drop' : keys.has('ArrowUp') || keys.has('KeyW') ? 'clear' : pos.h >= 2.0 ? 'smash' : 'push';
      hit(you, kind, pos);
      return;
    }

    // CPU side.
    const cpuSh = G.sh;
    for (const p of team('B')) {
      const chasing = cpuSh.by === 'A' && cpuSh.cpu === p.idx && !cpuSh.cpuLeave;
      const target = chasing ? cpuSh.ix + 0.25 : team('B').length > 1 ? (p.idx === (cpuSh.cpu ?? 0) ? NET + 2.3 : L - 2.0) : NET + SHORT + 1.6;
      const speed = chasing ? G.level.speed : 3;
      p.x = clamp(p.x + clamp(target - p.x, -speed * dt, speed * dt), NET + 0.35, L + 0.6);
      if (chasing && canReach(p, cpuSh, pos) && (pos.h < 2.3 || Math.abs(pos.x - p.x) < 0.4)) {
        hit(p, cpuShot(pos), pos);
        return;
      }
    }
  }

  function landed(sh, x) {
    sh.done = true;
    const onA = x < NET;
    const hitter = sh.by;
    const otherSide = hitter === 'A' ? 'B' : 'A';
    if (sh.serve) {
      const box = serviceBox(hitter, G.s.discipline);
      const ok = x >= box.from && x <= box.to;
      G.mark = { x, ok, text: ok ? 'IN' : 'FAULT', until: G.clock + 1.8 };
      if (ok) {
        award(hitter, hitter === 'A' ? 'Good serve, and the CPU could not return it.' : 'A good serve that you did not return.');
      } else {
        const tooShort = Math.abs(x - NET) < SHORT;
        const reason = tooShort ? 'it landed <b>before the short service line</b>' : G.s.discipline === 'doubles' ? 'it landed <b>past the doubles long service line</b> (0.76 m inside the back line)' : 'it landed <b>past the back line</b>';
        award(otherSide, `<b>Service fault:</b> ${reason}.${hitter === 'B' ? ' Well left!' : ''}`);
      }
      return;
    }
    const inCourt = x >= 0 && x <= L;
    G.mark = { x, ok: inCourt, text: inCourt ? 'IN' : 'OUT', until: G.clock + 1.8 };
    if (inCourt) {
      award(hitter, onA ? 'The shuttle landed <b>in</b> on your side.' : 'Your shot landed <b>in</b>: the CPU could not reach it.');
    } else {
      award(otherSide, hitter === 'B' ? '<b>Out!</b> The CPU’s shot went past the back line. Good leave.' : '<b>Out!</b> Your shot went past the back line.');
    }
  }

  /* ------------------------------------------------------------ drawing */
  function drawPerson(p, isYou) {
    const x = X(p.x);
    const c = p.side === 'A' ? colours.a : colours.b;
    const faceRight = p.side === 'A';
    const s = hk;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = Math.max(2.5, s * 0.08);
    ctx.lineCap = 'round';
    const hip = Y(0.9);
    const neck = Y(1.45);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.22, floorY);
    ctx.lineTo(x, hip);
    ctx.lineTo(x + s * 0.22, floorY);
    ctx.moveTo(x, hip);
    ctx.lineTo(x, neck);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, Y(1.62), Math.max(4, s * 0.16), 0, Math.PI * 2);
    ctx.fill();
    // Racket arm: swings from behind to in front.
    const dirn = faceRight ? 1 : -1;
    const sw = p.swing > 0 ? p.swing : 0;
    const ang = (-2.2 + sw * 3.2) * dirn; // radians from straight up
    const sx0 = x;
    const sy0 = Y(1.38);
    const arm = s * 0.55;
    const hx = sx0 + Math.sin(ang) * arm;
    const hy = sy0 - Math.cos(ang) * arm;
    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = colours.ink;
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    const rx = hx + Math.sin(ang) * s * 0.5;
    const ry = hy - Math.cos(ang) * s * 0.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(rx + Math.sin(ang) * s * 0.18, ry - Math.cos(ang) * s * 0.18, s * 0.1, s * 0.2, ang, 0, Math.PI * 2);
    ctx.stroke();
    // Labels
    ctx.fillStyle = c;
    ctx.font = `700 ${Math.max(10, s * 0.26)}px Barlow, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    let tag = G.s.discipline === 'doubles' ? p.label : '';
    if (isYou) tag = G.s.discipline === 'doubles' ? `YOU (${p.label})` : 'YOU';
    if (G.phase === 'serve' && G.server.side === p.side && G.server.idx === p.idx) tag += tag ? ' · server' : 'server';
    else if (G.phase === 'serve' && G.receiver.side === p.side && G.receiver.idx === p.idx) tag += tag ? ' · receiver' : 'receiver';
    if (tag) ctx.fillText(tag, x, Y(2.0) - 4);
    if (isYou) {
      ctx.beginPath();
      ctx.moveTo(x - 5, Y(2.0) + 2);
      ctx.lineTo(x + 5, Y(2.0) + 2);
      ctx.lineTo(x, Y(2.0) + 8);
      ctx.fill();
    }
  }

  function draw() {
    if (!G) return;
    if (!colours.ink || G.clock % 1 < 0.02) readColours();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colours['surface-2'];
    ctx.fillRect(0, 0, W, H);
    const d = G.s.discipline;
    // Floor and court lines.
    ctx.fillStyle = colours.court;
    ctx.fillRect(X(0), floorY, X(L) - X(0), 6);
    if (G.phase === 'serve' || (G.sh?.serve && !G.sh.done)) {
      const box = serviceBox(G.server.side, d);
      ctx.fillStyle = colours.good;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(X(box.from), floorY - 7, X(box.to) - X(box.from), 7);
      ctx.globalAlpha = 1;
    }
    const ticks = [
      [0, 'back'],
      [LONG_D, 'long', true],
      [NET - SHORT, 'short'],
      [NET + SHORT, 'short'],
      [L - LONG_D, 'long', true],
      [L, 'back'],
    ];
    ctx.font = `600 ${Math.max(9, k * 0.17)}px Barlow, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const [m, t, dbl] of ticks) {
      ctx.strokeStyle = colours.muted;
      ctx.globalAlpha = dbl && d === 'singles' ? 0.35 : 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(m), floorY);
      ctx.lineTo(X(m), floorY + 9);
      ctx.stroke();
      ctx.fillStyle = colours.muted;
      if (k > 30 || t !== 'long') ctx.fillText(t, X(m), floorY + 21);
      ctx.globalAlpha = 1;
    }
    // Net
    ctx.strokeStyle = colours.muted;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(NET), floorY);
    ctx.lineTo(X(NET), Y(1.55));
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(X(NET) - 3, Y(1.55), 6, 0.76 * hk);
    ctx.setLineDash([]);
    ctx.fillStyle = colours.ink;
    ctx.fillRect(X(NET) - 4, Y(1.55) - 2, 8, 3);

    // Serve aiming marker while charging.
    if (G.phase === 'serve' && G.charge != null) {
      const power = Math.min(1, (performance.now() - G.charge) / 1100);
      const land = NET + 1.0 + power * (L + 0.7 - NET - 1.0);
      const ok = inBox('A', land);
      ctx.fillStyle = ok ? colours.good : colours.bad;
      ctx.beginPath();
      ctx.moveTo(X(land), floorY - 4);
      ctx.lineTo(X(land) - 7, floorY - 18);
      ctx.lineTo(X(land) + 7, floorY - 18);
      ctx.fill();
      ctx.font = `700 ${Math.max(10, k * 0.2)}px Barlow, system-ui, sans-serif`;
      ctx.fillText(ok ? 'release!' : land < NET + SHORT ? 'too short' : 'too long', X(land), floorY - 24);
    }

    // Landing marker
    if (G.mark && G.clock < G.mark.until) {
      ctx.fillStyle = G.mark.ok ? colours.good : colours.bad;
      ctx.beginPath();
      ctx.arc(X(G.mark.x), floorY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `800 ${Math.max(14, k * 0.4)}px 'Barlow Condensed', Barlow, sans-serif`;
      ctx.fillText(G.mark.text, X(clamp(G.mark.x, 0.4, L - 0.4)), floorY - 14);
    }

    for (const p of G.players) drawPerson(p, p.side === 'A' && p.idx === G.active);

    // Shuttle and its shadow.
    const sh = G.sh;
    let pos = null;
    let ang = 0;
    if (sh?.falling) {
      pos = sh.falling;
      ang = Math.PI / 2;
    } else if (sh?.pos) {
      pos = sh.pos;
      const u = 1 - (1 - Math.min(1, sh.t)) ** sh.f.decel;
      const u2 = Math.min(1, u + 0.01);
      ang = Math.atan2(-(sh.f.h(u2) - sh.f.h(u)) * hk, (sh.f.x(u2) - sh.f.x(u)) * k + 1e-6);
    } else if (G.phase === 'serve') {
      const sv = player(G.server.side, G.server.idx);
      pos = { x: sv.x + (G.server.side === 'A' ? 0.45 : -0.45), h: SERVE_H };
      ang = Math.PI / 2;
    }
    if (pos) {
      ctx.fillStyle = colours.ink;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(X(pos.x), floorY, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      const r = Math.max(3.5, k * 0.075);
      ctx.save();
      ctx.translate(X(pos.x), Y(pos.h));
      ctx.rotate(ang + Math.PI);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#15201a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(r * 3, -r * 1.7);
      ctx.lineTo(r * 3, r * 1.7);
      ctx.lineTo(0, r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (G.paused) {
      ctx.fillStyle = colours.ink;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colours.bg;
      ctx.font = `800 ${Math.max(20, k * 0.6)}px 'Barlow Condensed', Barlow, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED · press P', W / 2, H / 2);
    }
  }

  /* ------------------------------------------------------------ input */
  const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
  const press = (code) => {
    if (!G || G.phase === 'over') return;
    if (code === 'KeyP' || code === 'Escape') return togglePause();
    if (G.paused) return;
    if (keys.has(code)) return;
    keys.add(code);
    // Server and receiver must keep their feet still until the serve is hit (a new step is a fault).
    if (G.phase === 'serve' && /Arrow(Left|Right)|Key[AD]/.test(code)) {
      if (G.server.side === 'A' && G.charge != null) award('B', '<b>Service fault:</b> the server’s feet must stay still until the shuttle is hit.');
      else if (G.server.side === 'B') award('B', '<b>Fault:</b> the receiver moved before the serve was hit. Both players keep their feet still until then.');
      else say('The server stands still in the service court. Hold <kbd>Space</kbd> to serve.');
      return;
    }
    if (code !== 'Space') return;
    if (G.phase === 'serve' && G.server.side === 'A') {
      G.charge = performance.now();
    } else if (G.phase === 'rally') {
      const you = player('A', G.active);
      if (you.swing === 0) {
        you.swing = 0.001;
        you.swingHit = false;
      }
    }
  };
  const release = (code) => {
    keys.delete(code);
    if (!G || code !== 'Space' || G.paused) return;
    if (G.phase === 'serve' && G.server.side === 'A' && G.charge != null) {
      const power = Math.min(1, (performance.now() - G.charge) / 1100);
      G.charge = null;
      yourServe(power);
    }
  };
  const onKeyDown = (e) => {
    if (!G || $('.play-game').hidden || e.target.closest?.('input, textarea, select')) return;
    if (GAME_KEYS.has(e.code) || e.code === 'KeyP') e.preventDefault();
    if (e.repeat) return;
    press(e.code);
  };
  const onKeyUp = (e) => {
    if (!G || $('.play-game').hidden) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    release(e.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  node.querySelectorAll('.pt-btn').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      press(b.dataset.k);
    });
    const up = () => release(b.dataset.k);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  function togglePause(force) {
    if (!G || G.phase === 'over') return;
    G.paused = force ?? !G.paused;
    keys.clear();
    if (G.paused && G.charge != null) G.charge = null;
    $('[data-act=pause]').textContent = G.paused ? 'Resume' : 'Pause';
  }
  const onHide = () => G && !$('.play-game').hidden && (document.hidden || !document.hasFocus()) && togglePause(true);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', onHide);

  function toSetup() {
    cancelAnimationFrame(raf);
    G = null;
    keys.clear();
    $('.play-setup').hidden = false;
    $('.play-game').hidden = true;
  }
  $('[data-act=start]').addEventListener('click', start);
  $('[data-act=pause]').addEventListener('click', () => togglePause());
  $('[data-act=quit]').addEventListener('click', toSetup);
  const onResize = () => G && resize();
  window.addEventListener('resize', onResize);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onHide);
    document.removeEventListener('visibilitychange', onHide);
    mini.destroy();
  };
}
