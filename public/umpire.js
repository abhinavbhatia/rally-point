// Umpire mode: set up a match, score it rally by rally, with calls, intervals and undo.
import { createMatch, pointTo, swapPositions, umpireCall, currentGame, gamesWon, SYSTEMS, summary, positions, other } from './engine.js';
import { Court } from './court.js';
import { showServe, endOf } from './scene.js';
import * as live from './live.js';

const KEY = 'rp.current';
const HIST = 'rp.history';
const store = {
  get(k, d = null) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
const vibrate = (p) => {
  try {
    navigator.vibrate?.(p);
  } catch {}
};

export function renderUmpire(root) {
  const saved = store.get(KEY);
  if (saved?.state && !saved.state.winner) return renderMatch(root, saved);
  return renderSetup(root, saved);
}

/* ------------------------------------------------------------------ Setup */
function renderSetup(root, saved) {
  const last = store.get('rp.lastSetup', { system: '3x15', discipline: 'singles', A: ['', ''], B: ['', ''] });
  const node = h(`
    <section class="setup">
      <h1 class="page-title">New match</h1>
      <form class="setup-form" autocomplete="off">
        <fieldset>
          <legend>Event</legend>
          <div class="seg">
            <label class="seg-btn"><input type="radio" name="discipline" value="singles"> Singles</label>
            <label class="seg-btn"><input type="radio" name="discipline" value="doubles"> Doubles</label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Scoring</legend>
          <div class="seg">
            ${Object.values(SYSTEMS)
              .map((s) => `<label class="seg-btn"><input type="radio" name="system" value="${s.id}"> ${s.label}</label>`)
              .join('')}
          </div>
          <p class="hint" data-sys-note></p>
        </fieldset>
        <div class="teams">
          ${['A', 'B']
            .map(
              (side) => `
            <fieldset class="team team-${side}">
              <legend>Side ${side}</legend>
              <input name="${side}0" placeholder="${side === 'A' ? 'Player 1' : 'Player 1'}" maxlength="24" aria-label="Side ${side} player 1">
              <input name="${side}1" class="doubles-only" placeholder="Player 2" maxlength="24" aria-label="Side ${side} player 2">
            </fieldset>`,
            )
            .join('')}
        </div>
        <fieldset>
          <legend>Who serves first?</legend>
          <div class="toss">
            <div class="coin" aria-hidden="true"><span class="face a">A</span><span class="face b">B</span></div>
            <div class="seg">
              <label class="seg-btn"><input type="radio" name="first" value="A" checked> Side A</label>
              <label class="seg-btn"><input type="radio" name="first" value="B"> Side B</label>
            </div>
            <button type="button" class="btn ghost" data-act="toss">Toss a coin</button>
          </div>
          <p class="hint">The toss winner chooses to serve, receive or pick an end. Side A starts at the left end of the court on screen.</p>
        </fieldset>
        <button class="btn big" type="submit">Start match ▶</button>
      </form>
      <div class="history"></div>
    </section>`);
  root.appendChild(node);
  const form = node.querySelector('form');
  form.discipline.value = last.discipline;
  form.system.value = last.system;
  ['A', 'B'].forEach((s) => [0, 1].forEach((i) => (form[`${s}${i}`].value = last[s]?.[i] || '')));
  const sync = () => {
    form.classList.toggle('is-doubles', form.discipline.value === 'doubles');
    node.querySelectorAll('.seg-btn').forEach((l) => l.classList.toggle('on', l.querySelector('input')?.checked));
    node.querySelector('[data-sys-note]').textContent = SYSTEMS[form.system.value].note + `: first to ${SYSTEMS[form.system.value].target}, cap at ${SYSTEMS[form.system.value].cap}.`;
  };
  form.addEventListener('change', sync);
  sync();

  node.querySelector('[data-act=toss]').addEventListener('click', () => {
    const coin = node.querySelector('.coin');
    const win = Math.random() < 0.5 ? 'A' : 'B';
    coin.classList.remove('flip-A', 'flip-B');
    void coin.offsetWidth;
    coin.classList.add(`flip-${win}`);
    setTimeout(() => {
      form.first.value = win;
      sync();
    }, 1200);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const discipline = form.discipline.value;
    const players = {
      A: [form.A0.value.trim() || (discipline === 'singles' ? 'Side A' : 'A1'), form.A1.value.trim() || 'A2'],
      B: [form.B0.value.trim() || (discipline === 'singles' ? 'Side B' : 'B1'), form.B1.value.trim() || 'B2'],
    };
    store.set('rp.lastSetup', { system: form.system.value, discipline, A: [form.A0.value, form.A1.value], B: [form.B0.value, form.B1.value] });
    const state = createMatch({ system: form.system.value, discipline, players, firstServer: form.first.value });
    const data = { state, past: [], log: [], liveId: null };
    store.set(KEY, data);
    root.replaceChildren();
    renderMatch(root, data);
  });

  // Finished matches
  const hist = store.get(HIST, []);
  const hEl = node.querySelector('.history');
  if (saved?.state?.winner) hist.unshift(finished(saved));
  if (saved?.state?.winner) {
    store.set(HIST, hist.slice(0, 30));
    store.del(KEY);
  }
  if (hist.length) {
    hEl.innerHTML = `<h2>Recent matches</h2><ul class="hist-list">${hist
      .slice(0, 10)
      .map(
        (m) => `<li><span class="hist-when">${new Date(m.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
           <span class="hist-names"><b class="${m.winner === 'A' ? 'w' : ''}">${esc(m.names.A)}</b> v <b class="${m.winner === 'B' ? 'w' : ''}">${esc(m.names.B)}</b></span>
           <span class="hist-scores">${m.games.map((g) => `${g.A}–${g.B}`).join(', ')}</span>
           <span class="hist-dur">${m.duration}</span></li>`,
      )
      .join('')}</ul><button class="btn ghost sm" data-act="clear-hist">Clear history</button>`;
    hEl.querySelector('[data-act=clear-hist]').addEventListener('click', () => {
      store.del(HIST);
      hEl.replaceChildren();
    });
  }
  return () => {};
}

function finished(data) {
  const s = data.state;
  return {
    at: s.endedAt || Date.now(),
    names: s.teamNames,
    games: s.games.map((g) => ({ A: g.A, B: g.B })),
    winner: s.winner,
    system: s.system,
    duration: s.startedAt ? fmtTime((s.endedAt || Date.now()) - s.startedAt) : '',
  };
}

/* ------------------------------------------------------------------ Match */
function renderMatch(root, data) {
  let { state, past = [], log = [] } = data;
  const node = h(`
    <section class="match" data-disc="${state.discipline}">
      <div class="match-top">
        <div class="games-strip" data-games></div>
        <div class="match-meta"><span class="badge">${SYSTEMS[state.system].label}</span><span class="clock" data-clock>0:00</span></div>
      </div>
      <div class="board">
        <div class="board-side" data-end="left"></div>
        <div class="board-side" data-end="right"></div>
      </div>
      <div class="call" aria-live="assertive"><div class="call-main"></div><div class="call-sub"></div></div>
      <div class="court-wrap match-court"></div>
      <div class="point-btns">
        <button class="point-btn" data-end="left"><span class="pb-label">Point</span><span class="pb-name"></span></button>
        <button class="point-btn" data-end="right"><span class="pb-label">Point</span><span class="pb-name"></span></button>
      </div>
      <div class="tools">
        <button class="btn ghost" data-act="undo" title="Undo last rally">↶ Undo</button>
        <button class="btn ghost" data-act="let" title="Replay the rally, no point">Let</button>
        <button class="btn ghost swap" data-act="swap-left">⇅ Swap <span></span></button>
        <button class="btn ghost swap" data-act="swap-right">⇅ Swap <span></span></button>
        <button class="btn ghost" data-act="live">● Live link</button>
        <button class="btn ghost" data-act="log">Log</button>
        <button class="btn ghost danger-text" data-act="end">End</button>
      </div>
      <div class="live-panel" hidden></div>
      <ol class="rally-log" hidden></ol>
      <div class="overlay" hidden></div>
    </section>`);
  root.appendChild(node);
  const court = new Court(node.querySelector('.court-wrap'), { label: 'Match court showing player positions' });
  const $ = (q) => node.querySelector(q);
  const $$ = (q) => [...node.querySelectorAll(q)];
  const overlay = $('.overlay');
  let liveId = data.liveId || null;
  let pushTimer = null;
  let timerId = null;

  const save = () => {
    store.set(KEY, { state, past: past.slice(-400), log: log.slice(-400), liveId });
    if (liveId) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => live.push(liveId, summary(state)).catch((e) => console.warn('live push failed', e)), 250);
    }
  };

  const sideAt = (end) => (state.leftEnd === 'A' ? (end === 'left' ? 'A' : 'B') : end === 'left' ? 'B' : 'A');

  const renderBoard = () => {
    const g = currentGame(state);
    const pos = positions(state);
    for (const end of ['left', 'right']) {
      const side = sideAt(end);
      const el = $(`.board-side[data-end=${end}]`);
      const won = gamesWon(state, side);
      const serving = pos.serverSide === side && !state.winner;
      el.className = `board-side team-${side} ${serving ? 'serving' : ''}`;
      el.innerHTML = `
        <div class="bs-name">${esc(state.teamNames[side])}</div>
        <div class="bs-score" data-score>${g[side]}</div>
        <div class="bs-games">${Array.from({ length: 2 }, (_, i) => `<i class="${i < won ? 'on' : ''}"></i>`).join('')}</div>
        <div class="bs-serve">${serving ? `<span class="shuttle-ico" aria-hidden="true"></span> serving · ${pos.court} court` : ''}</div>`;
      const btn = $(`.point-btn[data-end=${end}]`);
      btn.className = `point-btn team-${side}`;
      btn.dataset.end = end;
      btn.querySelector('.pb-name').textContent = state.teamNames[side];
      btn.disabled = !!state.winner;
    }
    $('[data-games]').innerHTML = state.games
      .map((x, i) => `<span class="gchip ${i === state.games.length - 1 && !state.winner ? 'cur' : ''}">G${i + 1} <b>${x.A}–${x.B}</b></span>`)
      .join('');
    // Swap buttons (doubles, start of a game only)
    const fresh = g.A + g.B === 0 && state.discipline === 'doubles' && !state.winner;
    for (const end of ['left', 'right']) {
      const b = $(`[data-act=swap-${end}]`);
      b.hidden = !fresh;
      b.querySelector('span').textContent = state.teamNames[sideAt(end)].split(' / ')[0].slice(0, 10) + '…';
      b.title = `Swap ${state.teamNames[sideAt(end)]} between right and left courts`;
    }
    $('[data-act=undo]').disabled = !past.length;
    $('[data-act=live]').classList.toggle('on', !!liveId);
  };

  const renderCall = (extra) => {
    const c = umpireCall(state);
    $('.call').className = `call tone-${c.tone}`;
    $('.call-main').textContent = extra || c.main;
    $('.call-sub').textContent = c.sub || (state.winner ? '' : `${state.players[positions(state).serverSide][positions(state).server]} to serve`);
  };

  const renderLog = () => {
    $('.rally-log').innerHTML = log
      .slice()
      .reverse()
      .map((l) => `<li><span class="lg-g">G${l.g}</span> <b>${l.A}–${l.B}</b> <span>${esc(l.text)}</span></li>`)
      .join('') || '<li>No rallies yet.</li>';
  };

  const draw = (fly = true) => {
    renderBoard();
    renderCall();
    renderLog();
    if (state.winner) {
      court.clearAreas();
      court.hideShuttle();
      return;
    }
    showServe(court, state, { names: true, fly });
  };

  const bump = (side) => {
    const end = endOf(state, side);
    const el = $(`.board-side[data-end=${end}] [data-score]`);
    el?.animate?.([{ transform: 'scale(1.35)', color: 'var(--accent-ink)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.6,.4,1)' });
  };

  const showOverlay = (html, { seconds, onDone } = {}) => {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="ov-card">${html}${seconds ? `<div class="countdown"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="cd-track"/><circle cx="50" cy="50" r="44" class="cd-ring" style="animation-duration:${seconds}s"/></svg><b data-cd>${fmtTime(seconds * 1000)}</b></div>` : ''}
      <div class="btn-row"><button class="btn" data-ov="close">${seconds ? 'Resume play' : 'Close'}</button></div></div>`;
    const end = Date.now() + (seconds || 0) * 1000;
    let iv;
    const close = () => {
      clearInterval(iv);
      overlay.hidden = true;
      overlay.replaceChildren();
      onDone?.();
    };
    if (seconds) {
      iv = setInterval(() => {
        const left = end - Date.now();
        const cd = overlay.querySelector('[data-cd]');
        if (cd) cd.textContent = fmtTime(left + 999);
        if (left <= 20000 && left > 19000) overlay.querySelector('.ov-card')?.classList.add('warn');
        if (left <= 0) {
          vibrate([200, 100, 200]);
          clearInterval(iv);
          overlay.querySelector('[data-cd]').textContent = 'Play!';
        }
      }, 250);
    }
    overlay.querySelector('[data-ov=close]').addEventListener('click', close);
  };

  const award = (side) => {
    if (state.winner) return;
    past.push(state);
    const prev = state;
    state = pointTo(state, side);
    const g = state.events.includes('game') && !state.winner ? state.games[state.games.length - 2] : currentGame(state);
    log.push({ g: state.events.includes('game') && !state.winner ? state.games.length - 1 : state.games.length, A: g.A, B: g.B, text: `${state.teamNames[side]} won the rally${prev.server !== side ? ' (service over)' : ''}` });
    vibrate(15);
    save();
    draw();
    bump(side);
    const ev = state.events;
    if (ev.includes('match')) {
      const w = state.winner;
      showOverlay(
        `<div class="ov-kicker">Match over</div><h2>${esc(state.teamNames[w])} win</h2>
         <p class="ov-scores">${state.games.map((x) => `<span>${x[w]}–${x[other(w)]}</span>`).join('')}</p>
         <p>Duration ${fmtTime(state.endedAt - state.startedAt)} · ${state.rallies} rallies</p>
         <button class="btn big" data-act="new">New match</button>`,
      );
      overlay.querySelector('[data-act=new]').addEventListener('click', newMatch);
    } else if (ev.includes('game')) {
      const done = state.games[state.games.length - 2];
      showOverlay(
        `<div class="ov-kicker">Interval · 2 minutes</div><h2>Game ${state.games.length - 1} to ${esc(state.teamNames[side])}</h2>
         <p class="ov-scores"><span>${done[side]}–${done[other(side)]}</span></p>
         <p>Players change ends. ${esc(state.teamNames[side])} serve first in game ${state.games.length}.${state.discipline === 'doubles' ? ' Use <b>Swap</b> if a pair wants a different server or receiver.' : ''}</p>`,
        { seconds: 120 },
      );
    } else if (ev.includes('interval')) {
      showOverlay(
        `<div class="ov-kicker">Interval · 60 seconds</div><h2>${esc(umpireCall(state).main)}</h2>
         <p>${ev.includes('change-ends') ? '<b>Players change ends</b> (deciding game).' : 'The leading score reached ' + SYSTEMS[state.system].interval + '.'}</p>`,
        { seconds: 60 },
      );
    }
  };

  const newMatch = () => {
    if (liveId) live.push(liveId, summary(state)).catch(() => {});
    const hist = store.get(HIST, []);
    hist.unshift(finished({ state }));
    store.set(HIST, hist.slice(0, 30));
    store.del(KEY);
    cleanup();
    root.replaceChildren();
    renderSetup(root, null);
  };

  $$('.point-btn').forEach((b) => b.addEventListener('click', () => award(sideAt(b.dataset.end))));
  $('[data-act=undo]').addEventListener('click', () => {
    if (!past.length) return;
    state = past.pop();
    log.pop();
    overlay.hidden = true;
    save();
    draw(false);
    renderCall(`Undone. ${umpireCall(state).main}`);
  });
  $('[data-act=let]').addEventListener('click', () => {
    const g = currentGame(state);
    log.push({ g: state.games.length, A: g.A, B: g.B, text: 'Let: rally replayed' });
    save();
    renderLog();
    renderCall('Let');
    showServe(court, state, { names: true });
  });
  ['left', 'right'].forEach((end) =>
    $(`[data-act=swap-${end}]`).addEventListener('click', () => {
      state = swapPositions(state, sideAt(end));
      save();
      draw();
    }),
  );
  $('[data-act=log]').addEventListener('click', () => {
    const l = $('.rally-log');
    l.hidden = !l.hidden;
    $('[data-act=log]').classList.toggle('on', !l.hidden);
  });
  $('[data-act=end]').addEventListener('click', () => {
    showOverlay(`<h2>End this match?</h2><p>The score so far is kept in Recent matches.</p><button class="btn danger big" data-act="confirm-end">End match</button>`);
    overlay.querySelector('[data-act=confirm-end]').addEventListener('click', () => {
      state = { ...state, endedAt: Date.now() };
      newMatch();
    });
  });

  // Live link
  const livePanel = $('.live-panel');
  const showLive = () => {
    const url = `${location.origin}${location.pathname}#/live/${liveId}`;
    livePanel.hidden = false;
    livePanel.innerHTML = `<div><b>Live link</b>: anyone with this link can watch the score.</div>
      <div class="live-row"><input readonly value="${url}" aria-label="Live link"><button class="btn sm" data-act="copy">Copy</button>${navigator.share ? '<button class="btn sm ghost" data-act="share">Share</button>' : ''}</div>`;
    livePanel.querySelector('[data-act=copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        livePanel.querySelector('[data-act=copy]').textContent = 'Copied';
      } catch {
        livePanel.querySelector('input').select();
      }
    });
    livePanel.querySelector('[data-act=share]')?.addEventListener('click', () => navigator.share({ title: 'Live badminton score', url }).catch(() => {}));
  };
  $('[data-act=live]').addEventListener('click', async () => {
    if (liveId) {
      livePanel.hidden ? showLive() : (livePanel.hidden = true);
      return;
    }
    const btn = $('[data-act=live]');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      liveId = await live.create(summary(state));
      save();
      showLive();
    } catch (e) {
      livePanel.hidden = false;
      livePanel.innerHTML = `<div class="err">Couldn't start a live link: ${esc(e.message || e)}. Scoring still works offline.</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '● Live link';
      renderBoard();
    }
  });

  // Keyboard shortcuts for laptop umpiring: ← / → award, Backspace/U undo.
  const onKey = (e) => {
    if (e.target.closest('input, textarea') || !overlay.hidden) return;
    if (e.key === 'ArrowLeft') award(sideAt('left'));
    if (e.key === 'ArrowRight') award(sideAt('right'));
    if (e.key === 'Backspace' || e.key === 'u') $('[data-act=undo]').click();
  };
  document.addEventListener('keydown', onKey);

  timerId = setInterval(() => {
    const t = state.startedAt ? (state.endedAt || Date.now()) - state.startedAt : 0;
    $('[data-clock]').textContent = fmtTime(t);
  }, 1000);

  draw();
  if (liveId) live.push(liveId, summary(state)).catch(() => {});

  const cleanup = () => {
    clearInterval(timerId);
    document.removeEventListener('keydown', onKey);
    court.destroy();
  };
  return cleanup;
}

/* ------------------------------------------------------------------ Spectator */
export function renderLive(root, id) {
  const node = h(`
    <section class="spectate">
      <div class="live-badge"><span class="dot"></span> LIVE</div>
      <div class="board spect-board">
        <div class="board-side" data-end="left"></div>
        <div class="board-side" data-end="right"></div>
      </div>
      <div class="games-strip" data-games></div>
      <div class="call"><div class="call-main">Connecting…</div><div class="call-sub"></div></div>
      <div class="court-wrap"></div>
      <p class="hint" data-updated></p>
    </section>`);
  root.appendChild(node);
  const court = new Court(node.querySelector('.court-wrap'));
  const $ = (q) => node.querySelector(q);
  let last = null;
  let lastAt = 0;
  const tick = setInterval(() => {
    if (lastAt) $('[data-updated]').textContent = `Updated ${Math.round((Date.now() - lastAt) / 1000)}s ago`;
  }, 1000);
  const unsub = live.watch(
    id,
    (d) => {
      if (!d) {
        $('.call-main').textContent = 'Match not found';
        return;
      }
      lastAt = Date.now();
      const st = { ...d, rallies: 1, events: [] };
      const g = st.games[st.games.length - 1];
      const pos = positions(st);
      for (const end of ['left', 'right']) {
        const side = st.leftEnd === 'A' ? (end === 'left' ? 'A' : 'B') : end === 'left' ? 'B' : 'A';
        const won = st.games.filter((x) => x.winner === side).length;
        const serving = pos.serverSide === side && !st.winner;
        const el = $(`.board-side[data-end=${end}]`);
        el.className = `board-side team-${side} ${serving ? 'serving' : ''} ${st.winner === side ? 'winner' : ''}`;
        el.innerHTML = `<div class="bs-name">${esc(st.teamNames[side])}</div><div class="bs-score" data-score>${g[side]}</div>
          <div class="bs-games">${[0, 1].map((i) => `<i class="${i < won ? 'on' : ''}"></i>`).join('')}</div>
          <div class="bs-serve">${serving ? '<span class="shuttle-ico"></span> serving' : st.winner === side ? 'Winner' : ''}</div>`;
        if (last && last.games.length === st.games.length && last.games.at(-1)[side] !== g[side]) {
          el.querySelector('[data-score]').animate?.([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 450 });
        }
      }
      $('[data-games]').innerHTML = st.games.map((x, i) => `<span class="gchip">G${i + 1} <b>${x.A}–${x.B}</b></span>`).join('');
      $('.call-main').textContent = d.call?.main || '';
      $('.call-sub').textContent = d.call?.sub || '';
      if (st.winner) {
        court.clearAreas();
        court.hideShuttle();
      } else {
        showServe(court, st, { names: true, fly: !!last });
      }
      last = st;
    },
    (err) => {
      $('.call-main').textContent = 'Live scores are unavailable right now';
      $('.call-sub').textContent = String(err.message || err);
    },
  );
  return () => {
    clearInterval(tick);
    Promise.resolve(unsub).then((u) => typeof u === 'function' && u());
    court.destroy();
  };
}
