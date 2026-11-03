// Rally Point scoring engine.
// Pure functions only: every call returns a new state, so the UI can keep a
// simple undo stack of past states. Laws of Badminton references are to the
// BWF Laws as amended for the 3x15 system (effective 4 January 2027).

export const SYSTEMS = {
  '3x15': {
    id: '3x15',
    label: '3 × 15',
    note: 'BWF standard from 4 January 2027',
    target: 15, // points needed to win a game
    cap: 21, // at 20-all the next point wins
    interval: 8, // 60s interval when the leading score reaches this; ends change here in game 3
    gamesToWin: 2,
  },
  '3x21': {
    id: '3x21',
    label: '3 × 21',
    note: 'Classic system, still an approved alternate',
    target: 21,
    cap: 30,
    interval: 11,
    gamesToWin: 2,
  },
  '1x7': {
    id: '1x7',
    label: '1 × 7',
    note: 'Short game for practice and warm-ups',
    target: 7,
    cap: 11,
    interval: 4,
    gamesToWin: 1,
  },
};

export const other = (side) => (side === 'A' ? 'B' : 'A');
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Create a new match.
 * @param {object} opts
 * @param {'3x15'|'3x21'} opts.system
 * @param {'singles'|'doubles'} opts.discipline
 * @param {{A: string[], B: string[]}} opts.players  one name (singles) or two names (doubles) per side
 * @param {'A'|'B'} opts.firstServer
 */
export function createMatch({ system = '3x15', discipline = 'singles', players, firstServer = 'A', teamNames } = {}) {
  if (!SYSTEMS[system]) throw new Error(`Unknown scoring system ${system}`);
  const count = discipline === 'doubles' ? 2 : 1;
  const fallback = { A: ['Player A1', 'Player A2'], B: ['Player B1', 'Player B2'] };
  const p = {
    A: (players?.A || fallback.A).slice(0, count).map((n, i) => n || fallback.A[i]),
    B: (players?.B || fallback.B).slice(0, count).map((n, i) => n || fallback.B[i]),
  };
  return {
    v: 1,
    system,
    discipline,
    players: p,
    teamNames: teamNames || { A: p.A.join(' / '), B: p.B.join(' / ') },
    games: [{ A: 0, B: 0, winner: null }],
    server: firstServer,
    // index of the player standing in the RIGHT service court, per side (doubles only matters)
    right: { A: 0, B: 0 },
    leftEnd: 'A', // which side is at the left end of the court as the umpire sees it
    intervalTaken: false,
    rallies: 0,
    winner: null,
    startedAt: null,
    events: ['start'],
    lastWinner: null,
    serviceOver: false,
  };
}

export const currentGame = (s) => s.games[s.games.length - 1];
export const gameNumber = (s) => s.games.length;
export const gamesWon = (s, side) => s.games.filter((g) => g.winner === side).length;
export const isDeciding = (s) => s.games.length === SYSTEMS[s.system].gamesToWin * 2 - 1;

/** Would `side` win the current game if they won the next rally? */
export function wouldWinGame(sys, a, b) {
  const s = a + 1;
  return (s >= sys.target && s - b >= 2) || s === sys.cap;
}

export function isGameWon(sys, a, b) {
  return (a >= sys.target && a - b >= 2) || a === sys.cap;
}

/** Status of a bare score, used by the Learn mode as well. */
export function gameStatus(systemId, a, b) {
  const sys = SYSTEMS[systemId];
  if (isGameWon(sys, a, b)) return { done: true, winner: 'A', reason: a === sys.cap && b === sys.cap - 1 ? 'cap' : 'won' };
  if (isGameWon(sys, b, a)) return { done: true, winner: 'B', reason: b === sys.cap && a === sys.cap - 1 ? 'cap' : 'won' };
  const setting = a >= sys.target - 1 && b >= sys.target - 1;
  const capPoint = a === sys.cap - 1 && b === sys.cap - 1;
  return {
    done: false,
    setting,
    capPoint,
    gamePointFor: wouldWinGame(sys, a, b) ? 'A' : wouldWinGame(sys, b, a) ? 'B' : null,
  };
}

/**
 * Where everyone stands for the next serve.
 * Singles: both players stand in the court matching the SERVER's score parity
 * (even = right, odd = left). Law 10.
 * Doubles: the server is whichever serving-side player stands in the court that
 * matches their side's score; the receiver is diagonally opposite, which is the
 * receiving player in the court of the same name. Law 11.
 */
export function positions(s) {
  const g = currentGame(s);
  const srv = s.server;
  const rcv = other(srv);
  const court = g[srv] % 2 === 0 ? 'right' : 'left';
  if (s.discipline === 'singles') {
    return {
      serverSide: srv,
      receiverSide: rcv,
      court,
      server: 0,
      receiver: 0,
      courts: { [srv]: { right: court === 'right' ? 0 : null, left: court === 'left' ? 0 : null }, [rcv]: { right: court === 'right' ? 0 : null, left: court === 'left' ? 0 : null } },
    };
  }
  const inCourt = (side, c) => (c === 'right' ? s.right[side] : 1 - s.right[side]);
  return {
    serverSide: srv,
    receiverSide: rcv,
    court,
    server: inCourt(srv, court),
    receiver: inCourt(rcv, court),
    courts: {
      A: { right: s.right.A, left: 1 - s.right.A },
      B: { right: s.right.B, left: 1 - s.right.B },
    },
  };
}

/** Award the rally to `side`. Returns a new state with `events` describing what happened. */
export function pointTo(state, side) {
  if (state.winner) return state;
  const s = clone(state);
  const sys = SYSTEMS[s.system];
  const g = currentGame(s);
  const events = [];
  s.rallies += 1;
  s.lastWinner = side;
  if (!s.startedAt) s.startedAt = Date.now();

  g[side] += 1;
  if (side === s.server) {
    // Serving side wins: in doubles the same server changes service court.
    if (s.discipline === 'doubles') s.right[side] = 1 - s.right[side];
    s.serviceOver = false;
  } else {
    // Receiving side wins: they become the serving side. Nobody moves.
    s.server = side;
    s.serviceOver = true;
    events.push('service-over');
  }

  const a = g[side];
  const b = g[other(side)];
  if (isGameWon(sys, a, b)) {
    g.winner = side;
    events.push('game');
    if (gamesWon(s, side) >= sys.gamesToWin) {
      s.winner = side;
      s.endedAt = Date.now();
      events.push('match');
    } else {
      // New game: winner of the game serves first (Law 7.6), players change ends (Law 8.1).
      s.games.push({ A: 0, B: 0, winner: null });
      s.server = side;
      s.serviceOver = false;
      s.intervalTaken = false;
      s.leftEnd = other(s.leftEnd);
      events.push('change-ends', 'interval-game');
    }
  } else {
    const lead = Math.max(a, b);
    if (!s.intervalTaken && lead === sys.interval) {
      s.intervalTaken = true;
      events.push('interval');
      if (isDeciding(s)) {
        s.leftEnd = other(s.leftEnd);
        events.push('change-ends');
      }
    }
    if (a === b && a >= sys.target - 1) events.push(a === sys.cap - 1 ? 'cap-point' : 'setting');
    const gp = wouldWinGame(sys, g.A, g.B) ? 'A' : wouldWinGame(sys, g.B, g.A) ? 'B' : null;
    if (gp) {
      const wouldBeMatch = gamesWon(s, gp) + 1 >= sys.gamesToWin;
      events.push(wouldBeMatch ? `match-point-${gp}` : `game-point-${gp}`);
    }
  }
  s.events = events;
  return s;
}

/** Doubles only, before the first rally of a game: swap which partner stands in the right court. */
export function swapPositions(state, side) {
  const s = clone(state);
  const g = currentGame(s);
  if (s.discipline !== 'doubles' || g.A + g.B > 0) return state;
  s.right[side] = 1 - s.right[side];
  s.events = ['swap'];
  return s;
}

const spoken = (n) => (n === 0 ? 'Love' : String(n));

/**
 * The words an umpire would call after the last rally.
 * The server's score is always called first.
 */
export function umpireCall(s) {
  const g = currentGame(s);
  const ev = s.events || [];
  const name = (side) => s.teamNames[side];
  if (ev.includes('match')) {
    const last = s.games[s.games.length - 1];
    const w = s.winner;
    const scores = s.games.map((x) => `${x[w]}–${x[other(w)]}`).join(', ');
    return { main: `Match won by ${name(w)}`, sub: scores, tone: 'match' };
  }
  if (ev.includes('game')) {
    const done = s.games[s.games.length - 2];
    const w = done.winner;
    const ordinal = ['First', 'Second', 'Third'][s.games.length - 2];
    return { main: `${ordinal} game won by ${name(w)}, ${done[w]}–${done[other(w)]}`, sub: 'Two minute interval. Players change ends.', tone: 'game' };
  }
  const srv = s.server;
  const ss = g[srv];
  const rs = g[other(srv)];
  let score = ss === rs ? `${spoken(ss)} all` : `${spoken(ss)}–${spoken(rs)}`;
  if (s.rallies === 0 || (g.A === 0 && g.B === 0)) {
    return { main: 'Love all, play', sub: `${name(srv)} to serve`, tone: 'start' };
  }
  const parts = [];
  if (ev.includes('service-over')) parts.push('Service over');
  parts.push(score);
  const gp = ev.find((e) => e.startsWith('game-point') || e.startsWith('match-point'));
  if (gp) parts.push(gp.startsWith('match') ? 'match point' : 'game point');
  let sub = '';
  if (ev.includes('interval')) sub = ev.includes('change-ends') ? 'Interval. Players change ends.' : 'Interval (60 seconds)';
  else if (ev.includes('cap-point')) sub = 'Next point wins the game';
  else if (ev.includes('setting')) sub = 'Two clear points needed';
  return { main: parts.join(', '), sub, tone: ev.includes('interval') ? 'interval' : 'score' };
}

export function summary(s) {
  return {
    system: s.system,
    discipline: s.discipline,
    teamNames: s.teamNames,
    players: s.players,
    games: s.games,
    server: s.server,
    winner: s.winner,
    leftEnd: s.leftEnd,
    right: s.right,
    call: umpireCall(s),
  };
}
