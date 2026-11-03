import { LESSONS } from './lessons.js';
import { renderUmpire, renderLive } from './umpire.js';
import { renderPlay } from './play.js';
import { Court, spot, NET, L, W, SIDE_S, wait } from './court.js';

const main = document.querySelector('main');
let cleanup = null;

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

function setNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
}

/* ------------------------------------------------------------------ Home */
function renderHome(root) {
  const node = h(`
    <section class="home">
      <div class="hero">
        <div class="hero-copy">
          <span class="pill">Updated for 3 × 15 scoring · from 4 Jan 2027</span>
          <h1>Badminton rules you can <em>see</em>, and a scorer an umpire can trust.</h1>
          <p>Animated lessons for every rule, from the serve to the cap at 21. Then umpire a real match: tap who won the rally and the app tracks the score, the server, positions, intervals and change of ends.</p>
          <div class="btn-row">
            <a class="btn big" href="#/learn">Learn the rules</a>
            <a class="btn big alt" href="#/umpire">Umpire a match</a>
          </div>
        </div>
        <div class="hero-court"></div>
      </div>
      <div class="feature-grid">
        <a class="feature" href="#/learn/serve-doubles"><b>Doubles serving, finally clear</b><span>Who serves next and why partners swap. Step through it rally by rally.</span></a>
        <a class="feature" href="#/learn/in-out"><b>In or out?</b><span>Tap the court and drop a shuttle. Singles vs doubles, serve vs rally.</span></a>
        <a class="feature" href="#/learn/quiz"><b>Quiz yourself</b><span>Pick who serves next. The court shows you why.</span></a>
        <a class="feature" href="#/play"><b>Play a rally game</b><span>Singles or doubles against the computer, scored by the real rules.</span></a>
        <a class="feature" href="#/umpire"><b>Live link for spectators</b><span>Share a link and anyone can follow the score on their phone.</span></a>
      </div>
    </section>`);
  root.appendChild(node);
  const court = new Court(node.querySelector('.hero-court'), { label: 'Animated rally' });
  court.playArea('singles');
  let alive = true;
  (async () => {
    const pa = spot('left', 'right', 'serve');
    const pb = spot('right', 'right', 'receive');
    court.setPlayers([
      { id: 'A0', team: 'A', label: 'A', ...pa },
      { id: 'B0', team: 'B', label: 'B', ...pb },
    ]);
    let from = { x: pa.x + 0.4, y: pa.y };
    let toB = true;
    while (alive) {
      const to = toB ? { x: 8.6 + Math.random() * 3.6, y: SIDE_S + 0.6 + Math.random() * (W - 2 * SIDE_S - 1.2) } : { x: 0.8 + Math.random() * 3.6, y: SIDE_S + 0.6 + Math.random() * (W - 2 * SIDE_S - 1.2) };
      court.movePlayer(toB ? 'B0' : 'A0', to.x + (toB ? 0.35 : -0.35), to.y);
      await court.shuttle(from, to, { duration: 700 + Math.random() * 400, height: 0.2 + Math.random() * 0.8 });
      from = to;
      toB = !toB;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) await wait(1500);
    }
  })();
  return () => {
    alive = false;
    court.destroy();
  };
}

/* ------------------------------------------------------------------ Learn */
function renderLearnIndex(root) {
  const node = h(`
    <section class="learn">
      <h1 class="page-title">Learn the rules</h1>
      <p class="lead">${LESSONS.length} short, animated lessons. Each one has something to tap.</p>
      <ol class="lesson-grid">
        ${LESSONS.map((l, i) => `<li><a class="lesson-card" href="#/learn/${l.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${l.title}</b><span>${l.blurb}</span></a></li>`).join('')}
      </ol>
    </section>`);
  root.appendChild(node);
  return () => {};
}

function renderLesson(root, id) {
  const i = LESSONS.findIndex((l) => l.id === id);
  if (i < 0) return renderLearnIndex(root);
  const l = LESSONS[i];
  const prev = LESSONS[i - 1];
  const next = LESSONS[i + 1];
  const node = h(`
    <article class="lesson">
      <a class="crumb" href="#/learn">← All lessons</a>
      <h1 class="page-title"><span class="num">${String(i + 1).padStart(2, '0')}</span> ${l.title}</h1>
      <div class="lesson-mount"></div>
      <nav class="lesson-nav">
        ${prev ? `<a class="btn ghost" href="#/learn/${prev.id}">◀ ${prev.title}</a>` : '<span></span>'}
        ${next ? `<a class="btn" href="#/learn/${next.id}">${next.title} ▶</a>` : '<a class="btn" href="#/umpire">Umpire a match ▶</a>'}
      </nav>
    </article>`);
  root.appendChild(node);
  return l.render(node.querySelector('.lesson-mount'));
}

/* ------------------------------------------------------------------ Router */
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    cleanup?.();
  } catch (e) {
    console.warn(e);
  }
  main.replaceChildren();
  window.scrollTo({ top: 0 });
  const [a, b] = parts;
  if (a === 'learn') {
    setNav('learn');
    cleanup = b ? renderLesson(main, b) : renderLearnIndex(main);
  } else if (a === 'umpire') {
    setNav('umpire');
    cleanup = renderUmpire(main);
  } else if (a === 'play') {
    setNav('play');
    cleanup = renderPlay(main);
  } else if (a === 'live' && b) {
    setNav('');
    cleanup = renderLive(main, b);
  } else {
    setNav('home');
    cleanup = renderHome(main);
  }
  main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
route();

// Theme toggle (remembered per device)
const themeBtn = document.querySelector('[data-theme-toggle]');
const applyTheme = (t) => {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
};
try {
  applyTheme(localStorage.getItem('rp.theme'));
} catch {}
themeBtn?.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const t = dark ? 'light' : 'dark';
  applyTheme(t);
  try {
    localStorage.setItem('rp.theme', t);
  } catch {}
});

// Offline support
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
