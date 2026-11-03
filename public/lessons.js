// Learn mode: each lesson renders text plus an animated, interactive court.
import { Court, wait, spot, serviceCourtRect, L, W, NET, SHORT, LONG_D, SIDE_S, MID } from './court.js';
import { createMatch, pointTo, positions, gameStatus, SYSTEMS, currentGame, umpireCall } from './engine.js';
import { matchPlayers, showServe } from './scene.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shell(root, { intro, controls = '', notes = '' }) {
  const node = h(`
    <div class="lesson-body">
      <div class="lesson-text">${intro}</div>
      <div class="stage">
        <div class="court-wrap"></div>
        <div class="caption" aria-live="polite"></div>
        <div class="controls">${controls}</div>
      </div>
      ${notes ? `<div class="lesson-notes">${notes}</div>` : ''}
    </div>`);
  root.appendChild(node);
  const court = new Court(node.querySelector('.court-wrap'));
  const caption = node.querySelector('.caption');
  const say = (html, tone = '') => {
    caption.className = `caption ${tone}`;
    caption.innerHTML = html;
    caption.animate?.([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
  };
  return { node, court, say, $: (q) => node.querySelector(q), $$: (q) => [...node.querySelectorAll(q)] };
}

// A guard so async animations stop when the lesson is left or restarted.
function runner() {
  let token = 0;
  return {
    start() {
      token += 1;
      return token;
    },
    alive(t) {
      return t === token;
    },
    stop() {
      token += 1;
    },
  };
}

const singlesPair = (court, roleA = 'server') => {
  const a = spot('left', 'right', 'serve');
  const b = spot('right', 'right', 'receive');
  court.setPlayers([
    { id: 'A0', team: 'A', label: 'A', ...a, role: roleA === 'server' ? 'server' : '' },
    { id: 'B0', team: 'B', label: 'B', ...b, role: roleA === 'server' ? 'receiver' : '' },
  ]);
};

/* ---------------------------------------------------------------- 1. Court */
const courtLesson = {
  id: 'court',
  title: 'The court',
  blurb: 'Lines, boxes and which ones count in singles vs doubles.',
  render(root) {
    const tour = [
      {
        lines: ['doubles-side', 'singles-side', 'back', 'short', 'long-d', 'centre'],
        text: 'A full court is <b>13.4 m long</b> and <b>6.1 m wide</b>. The net is 1.55 m high at the posts and 1.524 m in the middle.',
      },
      {
        lines: ['singles-side'],
        tags: [[3.4, SIDE_S + 0.42, 'singles sideline'], [3.4, W - SIDE_S - 0.18, 'singles sideline']],
        text: '<b>Singles sidelines</b>: the inner lines along the length. In singles the court is long and narrow — only the inner <b>5.18 m</b> width counts for rallies and serves.',
        textD: '<b>Singles sidelines (inner)</b>: in a doubles <em>rally</em> the area between these and the outer lines is <em>in</em> — the full width is used. These lines only matter as the side boundary of the service boxes.',
      },
      {
        lines: ['doubles-side'],
        tags: [[3.4, 0.42, 'doubles sideline'], [3.4, W - 0.18, 'doubles sideline']],
        text: '<b>Doubles sidelines</b>: the outer lines along the length. In singles, landing between these and the inner lines is out.',
        textD: '<b>Doubles sidelines</b>: the outer boundary. In doubles the full <b>6.1 m width</b> is in play for every rally.',
      },
      {
        lines: ['back'],
        tags: [[0.42, MID, 'back line', -90], [L - 0.1, MID, 'back line', -90]],
        text: '<b>Back boundary line</b>: the end of the court in a rally, for both singles and doubles.',
      },
      {
        lines: ['short'],
        tags: [[NET - SHORT - 0.1, MID, 'short service line', -90], [NET + SHORT + 0.42, MID, 'short service line', -90]],
        text: '<b>Short service line</b>: 1.98 m from the net. A serve must reach at least this far. In singles the service box is long and narrow.',
        textD: '<b>Short service line</b>: 1.98 m from the net. A serve must land at or beyond this line. In doubles the service box is <b>short and wide</b> — this is the back edge.',
      },
      {
        lines: ['long-d'],
        tags: [[LONG_D + 0.42, MID, 'doubles long service', -90], [L - LONG_D - 0.1, MID, 'doubles long service', -90]],
        text: '<b>Doubles long service line</b>: 0.76 m inside the back line. In singles this line is <em>ignored</em> — singles serves can go all the way to the back.',
        textD: '<b>Doubles long service line</b>: 0.76 m inside the back line. In doubles, a serve must land <em>before</em> this line. Only applies to the serve — during rallies the full back line is in play.',
      },
      {
        lines: ['centre'],
        tags: [[(NET - SHORT) / 2, MID - 0.2, 'centre line'], [L - (L - NET - SHORT) / 2, MID - 0.2, 'centre line']],
        text: '<b>Centre line</b>: splits each half into a right and left service court.',
      },
    ];
    const ui = shell(root, {
      intro: `<p>Every line belongs to the court it marks out, so <b>a shuttle that lands on a line is in</b>.</p>
              <p>The same court is used for singles and doubles. What changes is which lines count.</p>`,
      controls: `
        <div class="seg" role="tablist" aria-label="Discipline">
          <button class="seg-btn on" data-d="singles">Singles</button>
          <button class="seg-btn" data-d="doubles">Doubles</button>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-act="prev">◀ Back</button>
          <button class="btn" data-act="next">Next line ▶</button>
        </div>`,
    });
    const { court, say } = ui;
    let i = 0;
    let disc = 'singles';
    const show = () => {
      court.clearLabels();
      if (i === 0) {
        const active = disc === 'singles'
          ? ['singles-side', 'back', 'short', 'long-d', 'centre']
          : ['doubles-side', 'back', 'short', 'long-d', 'centre'];
        court.highlightLines(active, 'hl');
        court.dimension(0, -0.72, L, -0.72, '13.4 m');
        if (disc === 'singles') {
          court.dimension(-0.75, SIDE_S, -0.75, W - SIDE_S, '5.18 m');
          court.label(NET, MID, 'singles: long & narrow', { cls: 'big' });
        } else {
          court.dimension(-0.75, 0, -0.75, W, '6.1 m');
          court.label(NET, MID, 'doubles: full width', { cls: 'big' });
        }
      } else {
        court.highlightLines(tour[i].lines, 'hl');
        for (const [x, y, t, rotate = 0] of tour[i].tags) court.label(x, y, t, { cls: 'shout tag', rotate });
        if (i === 1) court.dimension(-0.75, SIDE_S, -0.75, W - SIDE_S, '5.18 m');
        else if (i === 2) court.dimension(-0.75, 0, -0.75, W, '6.1 m');
        else if (i === 4) {
          court.dimension(NET - SHORT, W + 0.52, NET, W + 0.52, '1.98 m');
          court.dimension(NET, W + 0.52, NET + SHORT, W + 0.52, '1.98 m');
        } else if (i === 5) {
          court.dimension(0, W + 0.52, LONG_D, W + 0.52, '0.76 m');
          court.dimension(L - LONG_D, W + 0.52, L, W + 0.52, '0.76 m');
        }
      }
      const text = disc === 'doubles' && tour[i].textD ? tour[i].textD : tour[i].text;
      say(`<span class="step">${i + 1}/${tour.length}</span> ${text}`);
    };
    // Step 1 shades the playing area; the other steps show only the yellow line being described.
    const showDisc = () => {
      if (i === 0) court.playArea(disc);
      else court.clearAreas();
      court.svg.classList.toggle('focus-lines', i > 0);
    };
    court.drawLines();
    showDisc();
    show();
    ui.$$('.seg-btn').forEach((b) =>
      b.addEventListener('click', () => {
        ui.$$('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        disc = b.dataset.d;
        showDisc();
        show();
      }),
    );
    ui.$('[data-act=next]').addEventListener('click', () => {
      i = (i + 1) % tour.length;
      showDisc();
      show();
    });
    ui.$('[data-act=prev]').addEventListener('click', () => {
      i = (i - 1 + tour.length) % tour.length;
      showDisc();
      show();
    });
    return () => court.destroy();
  },
};

/* ---------------------------------------------------------------- 2. Rally scoring */
async function playRally(court, r, t, { ending } = {}) {
  // Two singles players exchange shots; the last shot decides the rally.
  const pA = spot('left', 'right', 'serve');
  const pB = spot('right', 'right', 'receive');
  court.clearMarks();
  court.setPlayers([
    { id: 'A0', team: 'A', label: 'A', ...pA, role: 'server' },
    { id: 'B0', team: 'B', label: 'B', ...pB },
  ]);
  await wait(350);
  let from = { x: pA.x + 0.4, y: pA.y };
  let hitter = 'A';
  const shots = 2 + Math.floor(Math.random() * 4);
  for (let k = 0; k < shots; k++) {
    if (!r.alive(t)) return null;
    const recv = hitter === 'A' ? 'B' : 'A';
    const to = recv === 'B' ? { x: rnd(NET + 1.6, L - 1.2), y: rnd(SIDE_S + 0.6, W - SIDE_S - 0.6) } : { x: rnd(1.2, NET - 1.6), y: rnd(SIDE_S + 0.6, W - SIDE_S - 0.6) };
    court.movePlayer(`${recv}0`, to.x + (recv === 'B' ? 0.35 : -0.35), to.y);
    await court.shuttle(from, to, { duration: rnd(650, 950), height: rnd(0.25, 0.9) });
    from = to;
    hitter = recv;
  }
  if (!r.alive(t)) return null;
  // Final shot
  const recv = hitter === 'A' ? 'B' : 'A';
  const kind = ending || pick(['in', 'in', 'out', 'net']);
  const towardsB = recv === 'B';
  let to;
  if (kind === 'in') to = towardsB ? { x: rnd(NET + 2.5, L - 0.4), y: pick([SIDE_S + 0.25, W - SIDE_S - 0.25, rnd(1.5, 4.5)]) } : { x: rnd(0.4, NET - 2.5), y: pick([SIDE_S + 0.25, W - SIDE_S - 0.25, rnd(1.5, 4.5)]) };
  if (kind === 'out') to = towardsB ? { x: L + 0.45, y: rnd(1.5, 4.5) } : { x: -0.45, y: rnd(1.5, 4.5) };
  if (kind === 'net') to = { x: NET, y: rnd(1.2, 4.9) };
  await court.shuttle(from, to, { duration: 800, height: kind === 'net' ? 0.15 : 0.6 });
  if (kind === 'net') {
    court.flashNet();
    await court.drop(towardsB ? -0.3 : 0.3);
  }
  if (!r.alive(t)) return null;
  const winner = kind === 'in' ? hitter : recv;
  if (kind !== 'net') court.landing(to.x, to.y, kind === 'in', kind === 'in' ? 'IN' : 'OUT');
  return { winner, kind, hitter };
}

const rallyLesson = {
  id: 'rally',
  title: 'Every rally scores',
  blurb: 'Rally point scoring: win the rally, win the point, take the serve.',
  render(root) {
    const ui = shell(root, {
      intro: `<p>Badminton uses <b>rally point scoring</b>. Every rally ends with a point for someone, no matter who served.</p>
              <ul><li>Win the rally and you score a point.</li><li>The side that won the rally <b>serves next</b>.</li>
              <li>A rally is lost when the shuttle lands in your court, you hit it out or into the net, or you commit a fault.</li></ul>`,
      controls: `
        <div class="mini-score"><span class="ms a">A <b data-s="A">0</b></span><span class="ms b"><b data-s="B">0</b> B</span></div>
        <div class="btn-row"><button class="btn" data-act="play">▶ Play a rally</button><button class="btn ghost" data-act="reset">Reset</button></div>`,
    });
    const { court, say } = ui;
    const r = runner();
    const score = { A: 0, B: 0 };
    singlesPair(court);
    court.playArea('singles');
    say('Press <b>Play a rally</b> and watch who wins the point.');
    const play = async () => {
      const t = r.start();
      say('Rally in progress…');
      ui.$('[data-act=play]').disabled = true;
      const res = await playRally(court, r, t);
      ui.$('[data-act=play]').disabled = false;
      if (!res || !r.alive(t)) return;
      score[res.winner] += 1;
      ui.$(`[data-s=${res.winner}]`).textContent = score[res.winner];
      ui.$(`[data-s=${res.winner}]`).animate?.([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 400 });
      const why = res.kind === 'in' ? `${res.hitter}'s shot landed in` : res.kind === 'out' ? `${res.hitter} hit it out` : `${res.hitter} hit it into the net`;
      say(`<b>Point to ${res.winner}.</b> ${why}. ${res.winner} serves the next rally.`, res.winner === 'A' ? 'tone-a' : 'tone-b');
    };
    ui.$('[data-act=play]').addEventListener('click', play);
    ui.$('[data-act=reset]').addEventListener('click', () => {
      r.stop();
      score.A = score.B = 0;
      ui.$('[data-s=A]').textContent = '0';
      ui.$('[data-s=B]').textContent = '0';
      court.clearMarks();
      court.hideShuttle();
      singlesPair(court);
      say('Scores reset.');
    });
    return () => {
      r.stop();
      court.destroy();
    };
  },
};

/* ---------------------------------------------------------------- 3. Winning a game */
const winLesson = {
  id: 'winning',
  title: 'Winning a game',
  blurb: 'First to 15, two clear, capped at 21. Best of three games.',
  render(root) {
    const node = h(`
      <div class="lesson-body">
        <div class="lesson-text">
          <p>A match is the <b>best of three games</b>. From <b>4 January 2027</b> the BWF standard is <b>3 × 15</b>:</p>
          <ul>
            <li>The first side to <b>15 points</b> wins the game.</li>
            <li>At <b>14 all</b>, you need a <b>two point lead</b> (16–14, 17–15…).</li>
            <li>There is a <b>cap at 21</b>: at 20 all, the next point wins.</li>
          </ul>
          <p>Clubs and leagues can still choose the classic <b>3 × 21</b> (setting at 20 all, cap at 30). Switch below to compare.</p>
        </div>
        <div class="stage">
          <div class="seg" aria-label="Scoring system">
            <button class="seg-btn on" data-sys="3x15">3 × 15</button>
            <button class="seg-btn" data-sys="3x21">3 × 21</button>
          </div>
          <div class="race">
            <div class="track" data-side="A"><span class="who a">A</span><div class="bar"><div class="fill"></div><div class="ticks"></div></div><b class="val">0</b>
              <span class="step-btns"><button class="btn sm ghost" data-d="-1" aria-label="A minus one">−</button><button class="btn sm" data-d="1" aria-label="A plus one">+1</button></span></div>
            <div class="track" data-side="B"><span class="who b">B</span><div class="bar"><div class="fill"></div><div class="ticks"></div></div><b class="val">0</b>
              <span class="step-btns"><button class="btn sm ghost" data-d="-1" aria-label="B minus one">−</button><button class="btn sm" data-d="1" aria-label="B plus one">+1</button></span></div>
            <div class="track scale"><span></span><div class="bar-scale marks"></div><span></span></div>
          </div>
          <div class="caption" aria-live="polite"></div>
          <div class="btn-row">
            <button class="btn ghost" data-jump="setting">Jump to setting</button>
            <button class="btn ghost" data-jump="cap">Jump to cap</button>
            <button class="btn ghost" data-jump="reset">Reset</button>
          </div>
        </div>
      </div>`);
    root.appendChild(node);
    let sys = '3x15';
    const sc = { A: 0, B: 0 };
    const cap = () => SYSTEMS[sys].cap;
    const caption = node.querySelector('.caption');
    const marks = node.querySelector('.marks');
    const render = () => {
      const S = SYSTEMS[sys];
      const pct = (n) => (n / S.cap) * 100;
      marks.innerHTML = `<span style="left:${pct(S.interval)}%">${S.interval}<i>interval</i></span><span style="left:${pct(S.target)}%">${S.target}<i>target</i></span><span style="left:100%" class="end">${S.cap}<i>cap</i></span>`;
      node.querySelectorAll('.ticks').forEach((t) => (t.innerHTML = [S.interval, S.target].map((n) => `<i style="left:${pct(n)}%"></i>`).join('')));
      for (const side of ['A', 'B']) {
        const tr = node.querySelector(`.track[data-side=${side}]`);
        tr.querySelector('.fill').style.width = `${(sc[side] / S.cap) * 100}%`;
        tr.querySelector('.val').textContent = sc[side];
      }
      const st = gameStatus(sys, sc.A, sc.B);
      let msg;
      let tone = '';
      if (st.done) {
        msg = st.reason === 'cap' ? `<b>Game to ${st.winner}</b>, ${sc[st.winner]}–${sc[st.winner === 'A' ? 'B' : 'A']}. The cap: at ${S.cap - 1} all the next point won it.` : `<b>Game to ${st.winner}</b>, ${sc[st.winner]}–${sc[st.winner === 'A' ? 'B' : 'A']}.`;
        tone = st.winner === 'A' ? 'tone-a' : 'tone-b';
      } else if (st.capPoint) {
        msg = `<b>${S.cap - 1} all.</b> Cap point: whoever wins the next rally wins the game.`;
        tone = 'tone-warn';
      } else if (st.setting && sc.A === sc.B) {
        msg = `<b>${sc.A} all.</b> Nobody can win by one now. The game goes on until someone is two clear (or reaches ${S.cap}).`;
        tone = 'tone-warn';
      } else if (st.gamePointFor) {
        msg = `<b>Game point to ${st.gamePointFor}.</b> One more rally and they win the game.`;
      } else {
        const lead = Math.max(sc.A, sc.B);
        msg = lead >= S.interval ? `Past the interval. First to ${S.target}.` : `First to ${S.target}. When the leader reaches ${S.interval}, players get a 60 second interval.`;
      }
      caption.className = `caption ${tone}`;
      caption.innerHTML = msg;
    };
    node.querySelectorAll('.track').forEach((tr) =>
      tr.querySelectorAll('[data-d]').forEach((b) =>
        b.addEventListener('click', () => {
          const side = tr.dataset.side;
          const st = gameStatus(sys, sc.A, sc.B);
          const d = +b.dataset.d;
          if (d > 0 && st.done) return;
          sc[side] = Math.max(0, Math.min(cap(), sc[side] + d));
          render();
        }),
      ),
    );
    node.querySelectorAll('[data-sys]').forEach((b) =>
      b.addEventListener('click', () => {
        node.querySelectorAll('[data-sys]').forEach((x) => x.classList.toggle('on', x === b));
        sys = b.dataset.sys;
        sc.A = sc.B = 0;
        render();
      }),
    );
    node.querySelectorAll('[data-jump]').forEach((b) =>
      b.addEventListener('click', () => {
        const S = SYSTEMS[sys];
        if (b.dataset.jump === 'setting') sc.A = sc.B = S.target - 1;
        if (b.dataset.jump === 'cap') sc.A = sc.B = S.cap - 1;
        if (b.dataset.jump === 'reset') sc.A = sc.B = 0;
        render();
      }),
    );
    render();
    return () => {};
  },
};

/* ---------------------------------------------------------------- 4/5. Serving */
function serveLesson({ id, title, blurb, discipline, intro }) {
  return {
    id,
    title,
    blurb,
    render(root) {
      const ui = shell(root, {
        intro,
        controls: `
          <div class="mini-score"><span class="ms a">A <b data-s="A">0</b></span><span class="ms b"><b data-s="B">0</b> B</span></div>
          <div class="btn-row">
            <button class="btn team-a" data-win="A">A wins the rally</button>
            <button class="btn team-b" data-win="B">B wins the rally</button>
          </div>
          <div class="btn-row"><button class="btn ghost" data-act="undo">Undo</button><button class="btn ghost" data-act="reset">Reset</button></div>`,
      });
      const { court, say } = ui;
      const names = discipline === 'doubles' ? { A: ['A1', 'A2'], B: ['B1', 'B2'] } : { A: ['A'], B: ['B'] };
      let s = createMatch({ discipline, players: names });
      const hist = [];
      const explain = (prev, cur, winner) => {
        const g = currentGame(cur);
        const p = positions(cur);
        const srvName = cur.players[p.serverSide][p.server];
        const parity = g[p.serverSide] % 2 === 0 ? 'even' : 'odd';
        const courtWord = p.court === 'right' ? 'right' : 'left';
        let what = '';
        if (prev) {
          const kept = prev.server === winner;
          if (discipline === 'singles') {
            what = kept ? `${winner} won their own serve, so they serve again. ` : `${winner} won the rally against the serve, so the serve passes to ${winner} (“service over”). `;
          } else {
            what = kept
              ? `${winner} won the rally on their own serve. <b>The same server serves again</b> and the pair <b>swap courts</b>. `
              : `${winner} won the rally while receiving. <b>Nobody moves.</b> ${winner} take the serve, from whoever is standing in the court that matches their score. `;
          }
        }
        say(`${what}<b>${srvName}</b> serves on <b>${g[p.serverSide]}</b> (${parity}) from the <b>${courtWord}</b> service court, diagonally to <b>${cur.players[p.receiverSide][p.receiver]}</b>.`, p.serverSide === 'A' ? 'tone-a' : 'tone-b');
        ui.$('[data-s=A]').textContent = g.A;
        ui.$('[data-s=B]').textContent = g.B;
      };
      const r = runner();
      const draw = async (prev, winner) => {
        const t = r.start();
        explain(prev, s, winner);
        if (!r.alive(t)) return;
        await showServe(court, s, { names: discipline === 'doubles' });
      };
      draw(null);
      ui.$$('[data-win]').forEach((b) =>
        b.addEventListener('click', () => {
          const prev = s;
          hist.push(s);
          s = pointTo(s, b.dataset.win);
          if (s.games.length > 1) {
            // keep the lesson inside a single game
            s = createMatch({ discipline, players: names });
            say('Game over. Starting again from love all.');
          }
          draw(prev, b.dataset.win);
        }),
      );
      ui.$('[data-act=undo]').addEventListener('click', () => {
        if (!hist.length) return;
        s = hist.pop();
        draw(null);
      });
      ui.$('[data-act=reset]').addEventListener('click', () => {
        hist.length = 0;
        s = createMatch({ discipline, players: names });
        draw(null);
      });
      return () => {
        r.stop();
        court.destroy();
      };
    },
  };
}

const singlesServe = serveLesson({
  id: 'serve-singles',
  title: 'Serving in singles',
  blurb: 'Even score: serve from the right. Odd: from the left.',
  discipline: 'singles',
  intro: `<p>The server's own score decides where they stand:</p>
    <ul><li><b>Even</b> (0, 2, 4…): serve from the <b>right</b> service court.</li>
    <li><b>Odd</b> (1, 3, 5…): serve from the <b>left</b>.</li></ul>
    <p>The serve goes <b>diagonally</b> into the opposite service court. In singles that box is <b>long and narrow</b>: up to the back line, inside the singles sidelines.</p>
    <p>Tap who wins each rally and watch the players move.</p>`,
});

const doublesServe = serveLesson({
  id: 'serve-doubles',
  title: 'Serving in doubles',
  blurb: 'Who serves next, and why partners swap courts.',
  discipline: 'doubles',
  intro: `<p>Doubles uses the same even-right, odd-left idea, but with two rules about who moves:</p>
    <ul><li><b>Serving side wins the rally</b>: the same player serves again and the pair <b>swap service courts</b>.</li>
    <li><b>Receiving side wins</b>: they gain the serve but <b>nobody moves</b>. The server is whoever is already standing in the court that matches their new score.</li></ul>
    <p>The doubles service box is <b>short and wide</b>: the full width, but not past the doubles long service line. Only the receiver may return the serve.</p>`,
});

/* ---------------------------------------------------------------- 6. Legal serve (side view) */
// Side view in centimetres: 1.2 px per cm, floor at y = 210. The server faces the net on the right.
const CM = 1.2;
const FLOOR = 210;
const yAt = (cm) => FLOOR - cm * CM;
function tween(ms, fn) {
  return new Promise((res) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fn(1);
      return res();
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const legalServe = {
  id: 'legal-serve',
  title: 'A legal serve',
  blurb: 'Below 1.15 m, hit the cork first, feet still, one smooth swing.',
  render(root) {
    const rules = [
      { k: 'height', t: 'Below 1.15 m', d: 'The whole shuttle must be below <b>1.15 m</b> from the floor at the moment it is hit. Watch the dashed line. (Some club and school games still use the older “below the waist” wording.)', fault: 'The shuttle was hit above 1.15 m: <b>service fault</b>. Point to the receiver.' },
      { k: 'cork', t: 'Hit the cork first', d: 'The racket must first hit the <b>base (cork)</b> of the shuttle, not the feathers.', fault: 'The racket hit the feathers first: <b>service fault</b>.' },
      { k: 'feet', t: 'Feet on the floor, still', d: 'Server and receiver keep <b>part of both feet</b> on the floor, not moving, until the shuttle is hit. Neither may stand on a court line.', fault: 'The server’s back foot left the floor before the hit: <b>service fault</b>.' },
      { k: 'swing', t: 'One forward swing', d: 'Once the racket starts moving forward it must keep going until the shuttle is hit. <b>No stopping or feinting</b> to trick the receiver.', fault: 'The racket stopped mid swing, then carried on: <b>service fault</b>.' },
      { k: 'delay', t: 'No undue delay', d: 'Once both players are ready, the server must serve without holding things up.', fault: 'The server held the serve to unsettle the receiver: <b>service fault</b>.' },
      { k: 'spin', t: 'No deliberate spin', d: 'You cannot deliberately spin or flutter the shuttle on the serve. The racket must contact the <b>cork cleanly</b> so it flies cork-first and stable. Brushing the feathers or twisting the wrist to add rotation is a fault.', fault: 'The server deliberately spun the shuttle — it tumbled in flight: <b>service fault</b>. Point to the receiver.' },
    ];
    const S = { x: 150, y: yAt(140) }; // shoulder
    const ARM = 112; // shoulder to racket head centre
    const node = h(`
      <div class="lesson-body">
        <div class="lesson-text">
          <p>Five things make a serve legal. Pick one, then watch a <b>legal</b> serve and the <b>fault</b>.</p>
          <p>This is a side view: the server is on the left, the net on the right.</p>
        </div>
        <div class="stage">
          <div class="chips">${rules.map((r, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-k="${r.k}">${r.t}</button>`).join('')}</div>
          <svg class="side-view" viewBox="0 0 400 240" role="img" aria-label="Side view of a serve">
            <rect x="0" y="0" width="400" height="240" class="sv-bg"/>
            <line x1="0" y1="${yAt(115)}" x2="400" y2="${yAt(115)}" class="sv-limit"/>
            <text x="8" y="${yAt(115) - 6}" class="sv-limit-t">1.15 m</text>
            <g class="sv-net"><line x1="362" y1="${FLOOR}" x2="362" y2="${yAt(155)}"/><rect x="358" y="${yAt(155)}" width="8" height="${76 * CM}" class="sv-mesh"/></g>
            <line x1="0" y1="${FLOOR}" x2="400" y2="${FLOOR}" class="sv-floor"/>
            <g class="sv-person">
              <line class="leg back" x1="150" y1="${yAt(92)}" x2="126" y2="${FLOOR - 3}"/>
              <line class="leg front" x1="150" y1="${yAt(92)}" x2="178" y2="${FLOOR - 3}"/>
              <line x1="150" y1="${yAt(92)}" x2="150" y2="${yAt(145)}"/>
              <circle cx="150" cy="${yAt(162)}" r="13"/>
              <line class="arm-hold" x1="150" y1="${yAt(138)}" x2="200" y2="${yAt(110)}"/>
              <g class="arm"><line x1="0" y1="0" x2="0" y2="52"/><line x1="0" y1="52" x2="0" y2="${ARM - 16}" class="shaft"/><ellipse cx="0" cy="${ARM}" rx="9" ry="16" class="head"/></g>
            </g>
            <g class="sv-shuttle"><path d="M0,-4 L16,-9 L16,9 L0,4 Z" class="skirt"/><circle r="5" class="cork"/></g>
            <text x="392" y="30" text-anchor="end" class="sv-verdict"></text>
          </svg>
          <div class="caption" aria-live="polite"></div>
          <div class="btn-row"><button class="btn" data-play="ok">▶ Legal serve</button><button class="btn danger" data-play="fault">▶ Show the fault</button></div>
        </div>
      </div>`);
    root.appendChild(node);
    const svg = node.querySelector('svg');
    const arm = svg.querySelector('.arm');
    const hold = svg.querySelector('.arm-hold');
    const sh = svg.querySelector('.sv-shuttle');
    const backLeg = svg.querySelector('.leg.back');
    const verdict = svg.querySelector('.sv-verdict');
    const caption = node.querySelector('.caption');
    let key = 'height';
    let run = 0;
    const ruleOf = () => rules.find((r) => r.k === key);
    // theta: 0 = racket hanging straight down, positive = swung back (left), negative = forward (right).
    const setArm = (deg) => arm.setAttribute('transform', `translate(${S.x} ${S.y}) rotate(${deg})`);
    const headAt = (deg) => {
      const r = (deg * Math.PI) / 180;
      return { x: S.x - Math.sin(r) * ARM, y: S.y + Math.cos(r) * ARM };
    };
    const setShuttle = (x, y, rot) => sh.setAttribute('transform', `translate(${x} ${y}) rotate(${rot})`);
    const setLeg = (lift) => backLeg.setAttribute('x2', 126 - lift * 14) || backLeg.setAttribute('y2', FLOOR - 3 - lift * 26);
    const describe = () => {
      caption.className = 'caption';
      caption.innerHTML = ruleOf().d;
    };
    const play = async (mode) => {
      const me = ++run;
      const alive = () => me === run;
      const fault = mode === 'fault';
      verdict.textContent = '';
      verdict.setAttribute('class', 'sv-verdict');
      const back = 55;
      const contact = fault && key === 'height' ? -82 : -38;
      const hit = headAt(contact);
      // Shuttle held by the feathers, cork pointing down to the racket (or the wrong way round).
      const holdRot = fault && key === 'cork' ? 90 : -90;
      const shY = hit.y - 6;
      setArm(back);
      setLeg(0);
      setShuttle(hit.x + 4, shY, holdRot);
      hold.setAttribute('x2', hit.x + 4);
      hold.setAttribute('y2', shY - 18);
      hold.style.opacity = 1;
      await tween(fault && key === 'delay' ? 2200 : 500, (t) => {
        if (fault && key === 'delay') verdict.textContent = t < 1 ? 'waiting…' : '';
      });
      if (!alive()) return;
      if (fault && key === 'swing') {
        await tween(420, (t) => setArm(back + (8 - back) * ease(t)));
        if (!alive()) return;
        verdict.textContent = 'pause…';
        await tween(700, () => {});
        verdict.textContent = '';
        await tween(260, (t) => setArm(8 + (contact - 8) * ease(t)));
      } else {
        await tween(620, (t) => {
          setArm(back + (contact - back) * ease(t));
          if (fault && key === 'feet') setLeg(Math.min(1, t * 1.6));
        });
      }
      if (!alive()) return;
      hold.style.opacity = 0.0;
      // Flight: up and over the net.
      const p0 = { x: hit.x + 4, y: shY };
      const p1 = { x: 290, y: yAt(205) };
      const p2 = { x: 410, y: yAt(150) };
      await tween(900, (t) => {
        const x = (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        const rot = fault && key === 'spin' ? 180 + t * 540 : 180 + (1 - t) * (holdRot - 180) * 0.4 - t * 20;
        setShuttle(x, y, rot);
      });
      if (!alive()) return;
      verdict.textContent = fault ? 'FAULT' : 'GOOD SERVE';
      verdict.setAttribute('class', `sv-verdict ${fault ? 'bad' : 'good'}`);
      caption.className = `caption ${fault ? 'tone-bad' : 'tone-good'}`;
      caption.innerHTML = fault ? ruleOf().fault : `<b>Legal.</b> ${ruleOf().d}`;
    };
    node.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
        key = c.dataset.k;
        describe();
        play('fault');
      }),
    );
    node.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => play(b.dataset.play)));
    describe();
    play('ok');
    return () => {
      run++;
    };
  },
};

/* ---------------------------------------------------------------- 7. Types of serve (side view, whole court) */
// Side view of the full court length. 46 px per metre along the court, 30 px per metre up (height is squashed).
const PXM = 46;
const PXH = 30;
const SV_FLOOR = 238;
const sx = (m) => 32 + m * PXM;
const sy = (hm) => SV_FLOOR - hm * PXH;

const serveTypes = {
  id: 'serve-types',
  title: 'Types of serve',
  blurb: 'Low, high, flick and drive: how each one flies and when to use it.',
  render(root) {
    const SERVER_X = NET - SHORT - 1.0;
    const RECV_X = NET + SHORT + 1.25;
    const HIT = { x: SERVER_X + 0.45, h: 0.95 };
    // land(d): where it lands in metres from the left back line. peak: highest point (m). at: where along the flight the peak is (0..1).
    const types = [
      {
        k: 'low',
        t: 'Low serve',
        land: () => NET + SHORT + 0.25,
        peak: 1.78,
        at: 0.62,
        ms: 1300,
        use: { singles: 'Sometimes, to stop an attacking receiver.', doubles: 'The main serve in doubles.' },
        d: 'Pushed gently so it <b>just skims over the net</b> and drops right behind the <b>short service line</b>. The receiver has to lift it or play a tight net shot, so they cannot attack straight away.',
      },
      {
        k: 'high',
        t: 'High serve',
        land: (disc) => (disc === 'singles' ? L - 0.25 : L - LONG_D - 0.3),
        peak: 6.4,
        at: 0.68,
        ms: 2500,
        use: { singles: 'The main serve in singles.', doubles: 'Rarely: in doubles it must land before the long service line, so it is easy to smash.' },
        d: 'Hit <b>high and deep</b> so it falls almost straight down at the back of the box. A vertical drop is hard to time, and the receiver is pushed to the back of the court.',
      },
      {
        k: 'flick',
        t: 'Flick serve',
        land: (disc) => (disc === 'singles' ? L - 0.35 : L - LONG_D - 0.25),
        peak: 3.3,
        at: 0.72,
        ms: 1150,
        use: { singles: 'A surprise against a receiver who rushes the net.', doubles: 'A surprise against a receiver who rushes the net.' },
        d: 'Starts exactly like a low serve, then a quick <b>flick of the wrist</b> sends it up just <b>over the receiver’s reach</b> to the back of the box. It works because it looks like a low serve until the last moment.',
      },
      {
        k: 'drive',
        t: 'Drive serve',
        land: (disc) => (disc === 'singles' ? RECV_X + 1.9 : RECV_X + 1.4),
        peak: 1.95,
        at: 0.32,
        ms: 750,
        use: { singles: 'Occasionally, as a surprise.', doubles: 'Occasionally, aimed at the receiver’s body or backhand.' },
        d: 'A <b>fast, flat</b> serve aimed at the receiver’s body or shoulder. The racket must still meet the shuttle <b>below 1.15 m</b>, so the flight rises only a little: hard to do legally, and risky if the receiver is ready.',
      },
    ];
    const figure = (x, cls) => {
      const X = sx(x);
      return `<g class="st-person ${cls}">
        <line x1="${X - 9}" y1="${SV_FLOOR - 2}" x2="${X}" y2="${sy(0.9)}"/>
        <line x1="${X + 9}" y1="${SV_FLOOR - 2}" x2="${X}" y2="${sy(0.9)}"/>
        <line x1="${X}" y1="${sy(0.9)}" x2="${X}" y2="${sy(1.45)}"/>
        <circle cx="${X}" cy="${sy(1.62)}" r="6"/>
      </g>`;
    };
    const node = h(`
      <div class="lesson-body">
        <div class="lesson-text">
          <p>Every serve follows the rules in the last lesson: hit <b>below 1.15 m</b>, cork first, one smooth swing. Within those rules there are <b>four main serves</b>. Pick one to watch it fly.</p>
          <p>This is a side view of the whole court: the server is on the left, the receiver on the right. The <b>green band</b> on the floor is where the serve must land. Heights are squashed so everything fits.</p>
        </div>
        <div class="stage">
          <div class="seg" role="tablist" aria-label="Discipline">
            <button class="seg-btn on" data-d="singles">Singles</button>
            <button class="seg-btn" data-d="doubles">Doubles</button>
          </div>
          <div class="chips">${types.map((s, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-k="${s.k}">${s.t}</button>`).join('')}</div>
          <svg class="side-view st-view" viewBox="0 0 680 290" role="img" aria-label="Side view of the court showing a serve's flight">
            <rect x="0" y="0" width="680" height="290" class="sv-bg"/>
            <rect class="st-zone" y="${SV_FLOOR - 6}" height="6"/>
            <line x1="${sx(0)}" y1="${SV_FLOOR}" x2="${sx(L)}" y2="${SV_FLOOR}" class="sv-floor"/>
            <line x1="${sx(SERVER_X) - 40}" y1="${sy(1.15)}" x2="${sx(SERVER_X) + 52}" y2="${sy(1.15)}" class="sv-limit"/>
            <text x="${sx(SERVER_X) - 44}" y="${sy(1.15) + 4}" text-anchor="end" class="sv-limit-t">1.15 m</text>
            <g class="st-ticks">
              ${[
                [0, 'back line'],
                [NET - SHORT, 'short'],
                [NET + SHORT, 'short'],
                [L - LONG_D, 'long (dbl)'],
                [L, 'back line'],
              ]
                .map(([m, t]) => {
                  const lg = t === 'long (dbl)';
                  const anchor = m === 0 ? 'start' : m === L || lg ? 'end' : 'middle';
                  const tx = m === 0 ? sx(m) - 4 : m === L ? sx(m) + 4 : lg ? sx(m) + 3 : sx(m);
                  return `<line x1="${sx(m)}" y1="${SV_FLOOR}" x2="${sx(m)}" y2="${SV_FLOOR + (lg ? 26 : 10)}" class="st-tick ${lg ? 'st-long' : ''}"/><text x="${tx}" y="${SV_FLOOR + (lg ? 40 : 24)}" text-anchor="${anchor}" class="st-tick-t ${lg ? 'st-long' : ''}">${lg ? 'doubles long service line' : t === 'short' ? 'short service' : t}</text>`;
                })
                .join('')}
            </g>
            <g class="sv-net"><line x1="${sx(NET)}" y1="${SV_FLOOR}" x2="${sx(NET)}" y2="${sy(1.55)}"/><rect x="${sx(NET) - 3}" y="${sy(1.55)}" width="6" height="${0.76 * PXH}" class="sv-mesh"/></g>
            <text x="${sx(NET)}" y="${SV_FLOOR + 24}" text-anchor="middle" class="st-net-t">net (1.55 m)</text>
            <g class="st-legend" opacity="0">${types.map((t, i) => `<g class="st-${t.k}" transform="translate(16 ${18 + i * 18})"><line x1="0" y1="0" x2="22" y2="0" class="st-trail st-${t.k}"/><text x="28" y="4">${t.t}</text></g>`).join('')}</g>
            ${figure(SERVER_X, 'server')}
            <g class="st-racket"><line x1="${sx(SERVER_X)}" y1="${sy(1.35)}" x2="${sx(SERVER_X) + 10}" y2="${sy(0.85)}" class="st-arm"/><line x1="${sx(SERVER_X) + 10}" y1="${sy(0.85)}" x2="${sx(HIT.x) - 6}" y2="${sy(HIT.h)}"/><ellipse cx="${sx(HIT.x) - 3}" cy="${sy(HIT.h)}" rx="3" ry="7" transform="rotate(-20 ${sx(HIT.x) - 3} ${sy(HIT.h)})"/></g>
            ${figure(RECV_X, 'receiver')}
            <line class="st-reach" x1="${sx(RECV_X) - 34}" y1="${sy(2.6)}" x2="${sx(RECV_X) + 34}" y2="${sy(2.6)}"/>
            <text class="st-reach-t" x="${sx(RECV_X) + 38}" y="${sy(2.6) + 4}">reach</text>
            <g class="st-trails"></g>
            <g class="st-land"></g>
            <g class="sv-shuttle st-shuttle" opacity="0"><path d="M0,-3 L12,-7 L12,7 L0,3 Z" class="skirt"/><circle r="4" class="cork"/></g>
            <text x="668" y="28" text-anchor="end" class="sv-verdict"></text>
          </svg>
          <div class="caption" aria-live="polite"></div>
          <div class="btn-row"><button class="btn" data-act="play">▶ Play serve</button><button class="btn ghost" data-act="all">Compare all four</button></div>
        </div>
      </div>`);
    root.appendChild(node);
    const svg = node.querySelector('svg');
    const sh = svg.querySelector('.st-shuttle');
    const trails = svg.querySelector('.st-trails');
    const lands = svg.querySelector('.st-land');
    const zone = svg.querySelector('.st-zone');
    const verdict = svg.querySelector('.sv-verdict');
    const caption = node.querySelector('.caption');
    const NSV = 'http://www.w3.org/2000/svg';
    let disc = 'singles';
    let key = 'low';
    let run = 0;
    const typeOf = (k) => types.find((s) => s.k === k);

    // Height (m) at fraction u of the way from hit to landing: rises to the peak, then falls to the floor.
    const flight = (s) => {
      const x1 = s.land(disc);
      return (u) => {
        const x = HIT.x + (x1 - HIT.x) * u;
        const hgt = u < s.at ? HIT.h + (s.peak - HIT.h) * (1 - (1 - u / s.at) ** 2) : s.peak * (1 - ((u - s.at) / (1 - s.at)) ** 2);
        return { x, h: hgt };
      };
    };
    const pathOf = (s) => {
      const f = flight(s);
      let d = '';
      for (let i = 0; i <= 60; i++) {
        const p = f(i / 60);
        d += `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.h).toFixed(1)}`;
      }
      return d;
    };
    const addTrail = (s, cls = '') => {
      const p = document.createElementNS(NSV, 'path');
      p.setAttribute('d', pathOf(s));
      p.setAttribute('class', `st-trail st-${s.k} ${cls}`);
      trails.appendChild(p);
      return p;
    };
    const legend = svg.querySelector('.st-legend');
    const addLanding = (s) => {
      const x = sx(s.land(disc));
      const g = document.createElementNS(NSV, 'g');
      g.setAttribute('class', `st-mark st-${s.k}`);
      g.innerHTML = `<circle cx="${x}" cy="${SV_FLOOR}" r="5"/>`;
      lands.appendChild(g);
    };
    const setZone = () => {
      const x0 = sx(NET + SHORT);
      const x1 = sx(disc === 'singles' ? L : L - LONG_D);
      zone.setAttribute('x', x0);
      zone.setAttribute('width', x1 - x0);
      svg.classList.toggle('is-doubles', disc === 'doubles');
    };
    const clear = () => {
      trails.replaceChildren();
      lands.replaceChildren();
      sh.setAttribute('opacity', 0);
      legend.setAttribute('opacity', 0);
      verdict.textContent = '';
      verdict.setAttribute('class', 'sv-verdict');
    };
    const describe = (s) => {
      caption.className = 'caption';
      caption.innerHTML = `<b>${s.t}.</b> ${s.d}<br><b>${disc === 'singles' ? 'Singles' : 'Doubles'}:</b> ${s.use[disc]}`;
    };
    const play = async () => {
      const me = ++run;
      const s = typeOf(key);
      clear();
      describe(s);
      const f = flight(s);
      const trail = addTrail(s, 'drawing');
      const len = trail.getTotalLength();
      trail.style.strokeDasharray = `${len} ${len}`;
      trail.style.strokeDashoffset = len;
      sh.setAttribute('opacity', 1);
      let prev = f(0);
      // The shuttle slows down as it flies: fast off the racket, slow at the end.
      await tween(s.ms, (t) => {
        if (me !== run) return;
        const u = 1 - (1 - t) ** 1.7;
        const p = f(u);
        const ang = (Math.atan2(-(p.h - prev.h) * PXH, (p.x - prev.x) * PXM + 1e-6) * 180) / Math.PI;
        sh.setAttribute('transform', `translate(${sx(p.x)} ${sy(p.h)}) rotate(${ang + 180})`);
        trail.style.strokeDashoffset = len * (1 - u);
        prev = p;
      });
      if (me !== run) return;
      trail.style.strokeDashoffset = 0;
      addLanding(s);
      verdict.textContent = s.t.toUpperCase();
      verdict.setAttribute('class', 'sv-verdict good');
    };
    const compare = () => {
      run++;
      clear();
      types.forEach((s) => {
        addTrail(s);
        addLanding(s);
      });
      legend.setAttribute('opacity', 1);
      caption.className = 'caption';
      caption.innerHTML =
        disc === 'singles'
          ? 'All four serves in <b>singles</b>. The box runs all the way to the <b>back line</b>, so the high serve can go really deep. The low serve barely clears the net; the flick and drive go fast and flat by comparison.'
          : 'All four serves in <b>doubles</b>. The box is shorter: every serve must land <b>before the long service line</b>, 0.76 m in from the back. That is why doubles players mostly serve low.';
    };
    node.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        node.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
        key = c.dataset.k;
        play();
      }),
    );
    node.querySelectorAll('.seg-btn').forEach((b) =>
      b.addEventListener('click', () => {
        node.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        disc = b.dataset.d;
        setZone();
        play();
      }),
    );
    node.querySelector('[data-act="play"]').addEventListener('click', play);
    node.querySelector('[data-act="all"]').addEventListener('click', compare);
    setZone();
    play();
    return () => {
      run++;
    };
  },
};

/* ---------------------------------------------------------------- 7. In or out */
const inOut = {
  id: 'in-out',
  title: 'In or out?',
  blurb: 'Tap the court to drop a shuttle. Lines count as in.',
  render(root) {
    const modes = {
      'rally-s': { t: 'Singles rally', area: () => [{ x: 0, y: SIDE_S, w: L, h: W - 2 * SIDE_S }] },
      'rally-d': { t: 'Doubles rally', area: () => [{ x: 0, y: 0, w: L, h: W }] },
      'serve-s': { t: 'Singles serve', area: () => [serviceCourtRect('right', 'right', 'singles')] },
      'serve-d': { t: 'Doubles serve', area: () => [serviceCourtRect('right', 'right', 'doubles')] },
    };
    const ui = shell(root, {
      intro: `<p>A shuttle is <b>in</b> if it lands inside the court <b>or on any boundary line</b> of that court. Only where it first touches the floor counts.</p>
              <p>Which lines count depends on whether it is singles or doubles, and whether it is a serve or a rally. <b>Tap anywhere on the court</b> to test it.</p>`,
      controls: `<div class="seg wrap">${Object.entries(modes)
        .map(([k, m], i) => `<button class="seg-btn ${i === 0 ? 'on' : ''}" data-m="${k}">${m.t}</button>`)
        .join('')}</div>`,
    });
    const { court, say } = ui;
    let mode = 'rally-s';
    const setMode = () => {
      court.clearAreas();
      court.clearMarks();
      modes[mode].area().forEach((r) => court.area(r, mode.startsWith('serve') ? 'serve-to' : 'play'));
      if (mode.startsWith('serve')) {
        const d = mode.endsWith('s') ? 'singles' : 'doubles';
        court.area(serviceCourtRect('left', 'right', d), 'serve-from');
        court.setPlayers([{ id: 'A0', team: 'A', label: 'S', ...spot('left', 'right', 'serve'), role: 'server' }]);
        say(`The serve comes from the server's right court and must land in the shaded box ${d === 'singles' ? '(long and narrow)' : '(short and wide)'}. A serve that lands short of the short service line is out.`);
      } else {
        court.setPlayers([]);
        say(mode === 'rally-s' ? 'In a singles rally the inner sidelines count. The back line is the back line.' : 'In a doubles rally the outer sidelines count, and the very back line.');
      }
    };
    const inside = (p) => modes[mode].area().some((r) => p.x >= r.x - 0.02 && p.x <= r.x + r.w + 0.02 && p.y >= r.y - 0.02 && p.y <= r.y + r.h + 0.02);
    const r = runner();
    court.svg.classList.add('tappable');
    court.svg.addEventListener('click', async (e) => {
      const p = court.toCourt(e);
      if (p.x < -0.9 || p.x > L + 0.9 || p.y < -0.95 || p.y > W + 0.95) return;
      const t = r.start();
      const from = mode.startsWith('serve') ? { x: spot('left', 'right').x + 0.4, y: spot('left', 'right').y } : { x: p.x < NET ? L - 1 : 1, y: MID };
      court.clearMarks();
      await court.shuttle(from, p, { duration: 700, height: 0.7 });
      if (!r.alive(t)) return;
      const ok = inside(p);
      const nearLine = modes[mode].area().some((rc) => [rc.x, rc.x + rc.w].some((v) => Math.abs(p.x - v) < 0.15) || [rc.y, rc.y + rc.h].some((v) => Math.abs(p.y - v) < 0.15));
      court.landing(p.x, p.y, ok, ok ? 'IN' : 'OUT');
      say(ok ? (nearLine ? '<b>IN.</b> On or right next to the line still counts as in.' : '<b>IN.</b>') : '<b>OUT.</b> It landed outside the lines that count here.', ok ? 'tone-good' : 'tone-bad');
    });
    ui.$$('[data-m]').forEach((b) =>
      b.addEventListener('click', () => {
        ui.$$('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
        mode = b.dataset.m;
        r.stop();
        court.hideShuttle();
        setMode();
      }),
    );
    setMode();
    return () => {
      r.stop();
      court.destroy();
    };
  },
};

/* ---------------------------------------------------------------- 8. Faults */
const faults = {
  id: 'faults',
  title: 'Faults in a rally',
  blurb: 'Net touches, double hits, reaching over and more.',
  render(root) {
    const list = [
      { k: 'out', t: 'Lands out' },
      { k: 'net', t: 'Fails to cross the net' },
      { k: 'touch', t: 'Touches the net' },
      { k: 'over', t: 'Reaches over the net' },
      { k: 'body', t: 'Shuttle hits a player' },
      { k: 'twice', t: 'Hit twice' },
      { k: 'partner', t: 'Wrong player returns serve' },
      { k: 'ceiling', t: 'Hits the ceiling' },
      { k: 'distract', t: 'Shouting or obstructing' },
    ];
    const ui = shell(root, {
      intro: `<p>A <b>fault</b> ends the rally and the <b>other side</b> wins the point. Pick one to see it happen.</p>`,
      controls: `<div class="chips">${list.map((f, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-k="${f.k}">${f.t}</button>`).join('')}</div>
                 <div class="btn-row"><button class="btn" data-act="replay">▶ Replay</button></div>`,
    });
    const { court, say } = ui;
    const r = runner();
    let key = 'out';
    const base = (doubles = false) => {
      court.clearMarks();
      court.clearAreas();
      court.hideShuttle();
      court.playArea(doubles ? 'doubles' : 'singles');
      if (!doubles) {
        court.setPlayers([
          { id: 'A0', team: 'A', label: 'A', x: 3.4, y: MID },
          { id: 'B0', team: 'B', label: 'B', x: 10, y: MID },
        ]);
      } else {
        court.setPlayers([
          { id: 'A0', team: 'A', label: 'A1', ...spot('left', 'right', 'serve'), role: 'server' },
          { id: 'A1', team: 'A', label: 'A2', ...spot('left', 'left', 'base') },
          { id: 'B0', team: 'B', label: 'B1', ...spot('right', 'right', 'receive'), role: 'receiver' },
          { id: 'B1', team: 'B', label: 'B2', ...spot('right', 'left', 'base') },
        ]);
      }
    };
    const scripts = {
      async out(t) {
        base();
        say('A hits it long. It lands beyond the back line.');
        await court.shuttle({ x: 3.8, y: MID }, { x: L + 0.45, y: 2 }, { duration: 1100, height: 1 });
        if (!r.alive(t)) return;
        court.landing(L + 0.45, 2, false, 'OUT');
        say('<b>Fault by A</b>: the shuttle landed outside the court. <b>Point to B.</b>', 'tone-bad');
      },
      async net(t) {
        base();
        say('A plays a drop shot…');
        await court.shuttle({ x: 3.8, y: MID }, { x: NET, y: 2.4 }, { duration: 650, height: 0.15 });
        if (!r.alive(t)) return;
        court.flashNet();
        await court.drop(-0.3);
        say('<b>Fault by A</b>: the shuttle did not pass over the net (hitting the net and dropping back, or going under it). <b>Point to B.</b>', 'tone-bad');
      },
      async touch(t) {
        base();
        say('B dashes in for a net shot…');
        await court.shuttle({ x: 3.8, y: MID }, { x: NET + 0.6, y: 3.6 }, { duration: 700, height: 0.2 });
        court.movePlayer('B0', NET + 0.35, 3.6);
        await wait(450);
        if (!r.alive(t)) return;
        court.flashNet();
        court.flashPlayer('B0');
        say('<b>Fault by B</b>: a player touched the net (with racket, body or clothing) while the shuttle was in play. <b>Point to A.</b>', 'tone-bad');
      },
      async over(t) {
        base();
        say('The shuttle is still on A’s side. B reaches across…');
        court.movePlayer('B0', NET + 0.45, 2.6);
        await court.shuttle({ x: 1.5, y: 2 }, { x: NET - 0.5, y: 2.6 }, { duration: 800, height: 0.4 });
        if (!r.alive(t)) return;
        court.movePlayer('B0', NET - 0.25, 2.6);
        court.flashPlayer('B0');
        await wait(300);
        say('<b>Fault by B</b>: you may not hit the shuttle before it crosses to your side, and your racket or body must not go over the net into the opponent’s court (a follow-through after a legal hit is fine). <b>Point to A.</b>', 'tone-bad');
      },
      async body(t) {
        base();
        say('A smashes straight at B…');
        await court.shuttle({ x: 3.8, y: MID }, { x: 10, y: MID }, { duration: 450, height: 0.1 });
        if (!r.alive(t)) return;
        court.flashPlayer('B0');
        await court.drop(0.2);
        say('<b>Point to A.</b> If the shuttle touches a player’s body or clothing, that player loses the rally, even if they are standing outside the court.', 'tone-bad');
      },
      async twice(t) {
        base();
        say('B plays the shuttle, then hits it again…');
        await court.shuttle({ x: 3.8, y: MID }, { x: 9.8, y: MID }, { duration: 700, height: 0.5 });
        if (!r.alive(t)) return;
        await court.shuttle({ x: 9.8, y: MID }, { x: 9.6, y: 2.6 }, { duration: 350, height: 0.3 });
        court.movePlayer('B0', 9.9, 2.6);
        await court.shuttle({ x: 9.6, y: 2.6 }, { x: 3, y: 2.8 }, { duration: 800, height: 0.6 });
        if (!r.alive(t)) return;
        court.flashPlayer('B0');
        say('<b>Fault by B</b>: the same player hit it twice in a row. In doubles, both partners hitting it one after the other is also a fault. Each side gets one hit. <b>Point to A.</b>', 'tone-bad');
      },
      async partner(t) {
        base(true);
        court.serviceAreas('left', 'right', 'doubles');
        say('A1 serves to B1. B2 steps across and returns it…');
        const a = spot('left', 'right', 'serve');
        const b = spot('right', 'right', 'receive');
        await court.shuttle({ x: a.x + 0.4, y: a.y }, { x: b.x - 0.6, y: b.y }, { duration: 800, height: 0.5 });
        if (!r.alive(t)) return;
        court.movePlayer('B1', b.x + 0.3, b.y - 0.9);
        court.flashPlayer('B1');
        say('<b>Fault by B</b>: only the receiver may return the serve. If the receiver’s partner hits it, that side loses the rally. <b>Point to A.</b>', 'tone-bad');
      },
      async ceiling(t) {
        base();
        say('A plays a very high clear…');
        await court.shuttle({ x: 3.8, y: MID }, { x: 8.5, y: MID }, { duration: 900, height: 2.2, stopAt: 0.55 });
        if (!r.alive(t)) return;
        court.landing(6.4, MID - 1.4, false, 'CEILING');
        await court.drop(0.2);
        say('<b>Fault by A</b>: the shuttle touched the ceiling (or the side walls, or anything outside the court). <b>Point to B.</b>', 'tone-bad');
      },
      async distract(t) {
        base();
        say('B shouts “mine!” at A just as A plays the shot…');
        court.flashPlayer('B0');
        court.label(10, 1.3, '“HEY!”', { cls: 'shout' });
        await wait(900);
        if (!r.alive(t)) return;
        say('<b>Fault by B</b>: deliberately distracting an opponent (shouting, gestures) or obstructing their legal stroke is a fault. Calling to your own partner is fine. <b>Point to A.</b>', 'tone-bad');
      },
    };
    const run = () => {
      const t = r.start();
      court.clearLabels();
      scripts[key](t);
    };
    ui.$$('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        ui.$$('.chip').forEach((x) => x.classList.toggle('on', x === c));
        key = c.dataset.k;
        run();
      }),
    );
    ui.$('[data-act=replay]').addEventListener('click', run);
    run();
    return () => {
      r.stop();
      court.destroy();
    };
  },
};

/* ---------------------------------------------------------------- 9. Lets */
const lets = {
  id: 'lets',
  title: 'Lets: replay the rally',
  blurb: 'When nobody wins the point and the rally is played again.',
  render(root) {
    const list = [
      { k: 'ready', t: 'Receiver not ready' },
      { k: 'caught', t: 'Shuttle caught on the net' },
      { k: 'apart', t: 'Shuttle comes apart' },
      { k: 'interrupt', t: 'Something interrupts play' },
      { k: 'both', t: 'Server and receiver both fault' },
    ];
    const ui = shell(root, {
      intro: `<p>A <b>let</b> stops play. <b>No point is scored</b> and the rally is replayed, with the same server serving from the same court.</p>`,
      controls: `<div class="chips">${list.map((f, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-k="${f.k}">${f.t}</button>`).join('')}</div>
                 <div class="btn-row"><button class="btn" data-act="replay">▶ Replay</button></div>`,
    });
    const { court, say } = ui;
    const r = runner();
    let key = 'ready';
    const a = spot('left', 'right', 'serve');
    const b = spot('right', 'right', 'receive');
    const base = () => {
      court.clearMarks();
      court.clearLabels();
      court.hideShuttle();
      court.serviceAreas('left', 'right', 'singles');
      court.setPlayers([
        { id: 'A0', team: 'A', label: 'A', ...a, role: 'server' },
        { id: 'B0', team: 'B', label: 'B', ...b, role: 'receiver' },
      ]);
    };
    const scripts = {
      async ready(t) {
        base();
        court.movePlayer('B0', b.x + 1.2, b.y - 1.6);
        court.label(b.x + 1.2, b.y - 2.4, 'not ready', { cls: 'shout' });
        say('B is still walking back into position when A serves…');
        await wait(500);
        await court.shuttle({ x: a.x + 0.4, y: a.y }, { x: b.x, y: b.y }, { duration: 800, height: 0.5 });
        if (!r.alive(t)) return;
        court.landing(b.x, b.y, true, 'LET');
        say('<b>Let.</b> The server served before the receiver was ready, and the receiver did not try to return it. Replay. (If the receiver tries to hit it, they were ready.)', 'tone-warn');
      },
      async caught(t) {
        base();
        say('A rally shot clips the tape, goes over, and stays caught on top of the net…');
        await court.shuttle({ x: 3.6, y: MID }, { x: NET + 0.05, y: 3.6 }, { duration: 700, height: 0.2 });
        if (!r.alive(t)) return;
        court.flashNet();
        court.landing(NET + 0.05, 3.6, true, 'LET');
        say('<b>Let.</b> In a rally, if the shuttle is caught in the net after passing over, or stays balanced on top of the net, the rally is replayed. On the <b>serve</b>, the same thing is a fault instead.', 'tone-warn');
      },
      async apart(t) {
        base();
        say('The shuttle breaks mid-flight and the cork separates from the feathers…');
        await court.shuttle({ x: a.x + 0.4, y: a.y }, { x: b.x, y: b.y }, { duration: 900, height: 0.6, stopAt: 0.6 });
        if (!r.alive(t)) return;
        await court.drop(0.4);
        court.landing(court.playerPos('A0').x + 4, a.y - 0.6, true, 'LET');
        say('<b>Let.</b> If the shuttle comes apart during play, the rally is replayed with a new shuttle.', 'tone-warn');
      },
      async interrupt(t) {
        base();
        say('A shuttle from the next court flies across mid-rally…');
        court.shuttle({ x: 3.6, y: MID }, { x: 10, y: MID }, { duration: 1100, height: 0.8 });
        await wait(300);
        court.label(6.7, -0.45, 'stray shuttle', { cls: 'shout' });
        court.landing(8.2, 1.2, false, '');
        await wait(900);
        if (!r.alive(t)) return;
        say('<b>Let.</b> Play is stopped for an unforeseen disturbance, such as a shuttle from another court or someone walking on. The umpire can also call a let if they or the line judge could not see where it landed.', 'tone-warn');
      },
      async both(t) {
        base();
        court.flashPlayer('A0');
        court.flashPlayer('B0');
        say('A serves too high, and at the same time B moves early…');
        await court.shuttle({ x: a.x + 0.4, y: a.y }, { x: b.x, y: b.y }, { duration: 800, height: 0.5 });
        if (!r.alive(t)) return;
        court.landing(b.x, b.y, true, 'LET');
        say('<b>Let.</b> If server and receiver are both at fault on the serve at the same time, the serve is replayed.', 'tone-warn');
      },
    };
    const run = () => scripts[key](r.start());
    ui.$$('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        ui.$$('.chip').forEach((x) => x.classList.toggle('on', x === c));
        key = c.dataset.k;
        run();
      }),
    );
    ui.$('[data-act=replay]').addEventListener('click', run);
    run();
    return () => {
      r.stop();
      court.destroy();
    };
  },
};

/* ---------------------------------------------------------------- 10. Intervals and ends */
const intervals = {
  id: 'intervals',
  title: 'Intervals and changing ends',
  blurb: '60 seconds at 8, 2 minutes between games, ends change in game three.',
  render(root) {
    const ui = shell(root, {
      intro: `<p>In <b>3 × 15</b>:</p>
        <ul><li>When the leading score reaches <b>8</b>: a <b>60 second interval</b>.</li>
        <li>Between games: a <b>120 second interval</b>, and players <b>change ends</b>.</li>
        <li>In the <b>third game</b>, players also change ends when the leader reaches <b>8</b>.</li>
        <li>The winner of a game serves first in the next game.</li></ul>
        <p>(In 3 × 21 the same happens at 11.) Press play to watch a sped-up match.</p>`,
      controls: `<div class="mini-score wide"><span class="ms a">A <b data-s="A">0</b></span><span class="games" data-g>Game 1</span><span class="ms b"><b data-s="B">0</b> B</span></div>
                 <div class="timeline" data-tl></div>
                 <div class="btn-row"><button class="btn" data-act="play">▶ Play match</button><button class="btn ghost" data-act="stop">Stop</button></div>`,
    });
    const { court, say } = ui;
    const r = runner();
    const tl = ui.$('[data-tl]');
    let s = createMatch({ players: { A: ['A'], B: ['B'] } });
    const drawState = () => {
      const { list } = matchPlayers(s, { names: false });
      court.clearAreas();
      court.playArea('singles');
      court.setPlayers(list);
      const g = currentGame(s);
      ui.$('[data-s=A]').textContent = g.A;
      ui.$('[data-s=B]').textContent = g.B;
      ui.$('[data-g]').textContent = s.winner ? 'Match over' : `Game ${s.games.length}`;
    };
    const chip = (text, cls) => {
      const c = document.createElement('span');
      c.className = `tl-chip ${cls}`;
      c.textContent = text;
      tl.appendChild(c);
      c.scrollIntoView?.({ block: 'nearest', inline: 'end' });
    };
    // Game 1 to A, game 2 to B, game 3 to A, with realistic-ish swings.
    const script = () => {
      const seq = [];
      const add = (winner, a, b) => {
        // generate a rally sequence that ends a game a–b for `winner`
        const pts = [];
        let x = 0;
        let y = 0;
        while (!(x === a && y === b)) {
          const giveA = y >= b || (x < a && Math.random() < a / (a + b));
          if (giveA) x++;
          else y++;
          pts.push(giveA ? 'A' : 'B');
        }
        // ensure the winner takes the last point
        const last = pts.lastIndexOf(winner);
        pts.push(pts.splice(last, 1)[0]);
        seq.push(...pts);
      };
      add('A', 15, 11);
      add('B', 12, 15);
      add('A', 15, 13);
      return seq;
    };
    drawState();
    say('Press <b>Play match</b>.');
    ui.$('[data-act=play]').addEventListener('click', async () => {
      const t = r.start();
      s = createMatch({ players: { A: ['A'], B: ['B'] } });
      tl.replaceChildren();
      drawState();
      for (const w of script()) {
        if (!r.alive(t) || s.winner) break;
        s = pointTo(s, w);
        drawState();
        const ev = s.events;
        if (ev.includes('game')) {
          const done = s.games[s.games.length - (s.winner ? 1 : 2)];
          chip(`Game ${s.winner ? s.games.length : s.games.length - 1}: ${done.A}–${done.B}`, 'game');
          if (s.winner) {
            say(`<b>Match to ${s.winner}</b>, two games to one.`, 'tone-good');
            break;
          }
          chip('2 min · change ends', 'ends');
          say('<b>Game over.</b> 120 second interval. Watch the players swap ends. The game winner serves first.', 'tone-warn');
          await wait(2600);
        } else if (ev.includes('interval')) {
          chip(ev.includes('change-ends') ? '8 · 60 s · change ends' : '8 · 60 s', ev.includes('change-ends') ? 'ends' : 'int');
          say(ev.includes('change-ends') ? '<b>Interval at 8 in the deciding game.</b> 60 seconds, and players change ends so neither side has the better end for longer.' : '<b>Interval.</b> The leader reached 8: 60 seconds of rest.', 'tone-warn');
          await wait(2200);
        } else {
          say(umpireCall(s).main);
          await wait(260);
        }
      }
    });
    ui.$('[data-act=stop]').addEventListener('click', () => r.stop());
    return () => {
      r.stop();
      court.destroy();
    };
  },
};

/* ---------------------------------------------------------------- 11. Quiz */
const quiz = {
  id: 'quiz',
  title: 'Quiz: who serves next?',
  blurb: 'Tap the player who serves the next rally.',
  render(root) {
    const ui = shell(root, {
      intro: `<p>Test yourself. You see the positions before a rally and who wins it. <b>Tap the player who will serve next.</b></p>`,
      controls: `<div class="seg"><button class="seg-btn on" data-d="doubles">Doubles</button><button class="seg-btn" data-d="singles">Singles</button></div>
                 <div class="quiz-score">Score: <b data-q>0 / 0</b></div>
                 <div class="btn-row"><button class="btn" data-act="next">Next question ▶</button></div>`,
    });
    const { court, say } = ui;
    let disc = 'doubles';
    let s;
    let next;
    let answered = false;
    let right = 0;
    let total = 0;
    const names = () => (disc === 'doubles' ? { A: ['A1', 'A2'], B: ['B1', 'B2'] } : { A: ['A'], B: ['B'] });
    const question = () => {
      answered = false;
      s = createMatch({ discipline: disc, players: names(), firstServer: pick(['A', 'B']) });
      const n = 3 + Math.floor(Math.random() * 12);
      for (let i = 0; i < n; i++) {
        const t = pointTo(s, pick(['A', 'B']));
        if (t.games.length > 1) break;
        s = t;
      }
      const winner = pick(['A', 'B']);
      next = pointTo(s, winner);
      const g = currentGame(s);
      const p = positions(s);
      court.clearMarks();
      court.hideShuttle();
      const { list, serverEnd, pos } = matchPlayers(s, { names: false });
      court.serviceAreas(serverEnd, pos.court, disc);
      court.setPlayers(list);
      say(`Score <b>A ${g.A} – ${g.B} B</b>. <b>${s.players[p.serverSide][p.server]}</b> is serving. <b>${winner} wins the rally.</b> Who serves next?`);
    };
    court.svg.classList.add('tappable');
    court.svg.addEventListener('click', async (e) => {
      if (answered) return;
      const node = e.target.closest('.player');
      if (!node) return;
      const id = [...court.players.entries()].find(([, n]) => n === node)?.[0];
      if (!id) return;
      answered = true;
      total++;
      const p = positions(next);
      const want = `${p.serverSide}${p.server}`;
      const ok = id === want;
      if (ok) right++;
      ui.$('[data-q]').textContent = `${right} / ${total}`;
      court.flashPlayer(id, ok ? 'flash-good' : 'flash-bad');
      const g = currentGame(next);
      const kept = s.server === next.server;
      const why =
        disc === 'singles'
          ? `${next.players[p.serverSide][0]} serves on ${g[p.serverSide]}, so from the ${p.court} court.`
          : kept
            ? `The serving side won, so the same server serves again and the pair swap courts.`
            : `The receiving side won, so nobody moves. Their score is now ${g[p.serverSide]} (${g[p.serverSide] % 2 ? 'odd' : 'even'}), so whoever stands in their ${p.court} court serves: ${next.players[p.serverSide][p.server]}.`;
      say(`${ok ? '<b>Correct!</b>' : `<b>Not quite.</b> It's ${next.players[p.serverSide][p.server]}.`} ${why}`, ok ? 'tone-good' : 'tone-bad');
      await wait(900);
      s = next;
      await showServe(court, s, { names: false });
    });
    ui.$$('[data-d]').forEach((b) =>
      b.addEventListener('click', () => {
        ui.$$('[data-d]').forEach((x) => x.classList.toggle('on', x === b));
        disc = b.dataset.d;
        question();
      }),
    );
    ui.$('[data-act=next]').addEventListener('click', question);
    question();
    return () => court.destroy();
  },
};

export const LESSONS = [courtLesson, rallyLesson, winLesson, singlesServe, doublesServe, legalServe, serveTypes, inOut, faults, lets, intervals, quiz];
