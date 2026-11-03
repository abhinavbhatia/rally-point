// Turns an engine state into player positions on the Court.
import { positions, other } from './engine.js';
import { spot } from './court.js';

export const endOf = (s, side) => (s.leftEnd === side ? 'left' : 'right');

const initials = (name) =>
  (name.length <= 3 ? name.toUpperCase() : null) ||
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export function matchPlayers(s, { names = true } = {}) {
  const p = positions(s);
  const list = [];
  for (const side of ['A', 'B']) {
    const end = endOf(s, side);
    const isServer = side === p.serverSide;
    if (s.discipline === 'singles') {
      const at = spot(end, p.court, isServer ? 'serve' : 'receive');
      list.push({ id: `${side}0`, team: side, label: initials(s.players[side][0]), name: names ? s.players[side][0] : '', role: isServer ? 'server' : 'receiver', ...at });
    } else {
      const active = isServer ? p.server : p.receiver;
      for (const idx of [0, 1]) {
        const courtName = p.courts[side].right === idx ? 'right' : 'left';
        const isActive = idx === active;
        const at = spot(end, courtName, isActive ? (isServer ? 'serve' : 'receive') : 'base');
        list.push({
          id: `${side}${idx}`,
          team: side,
          label: initials(s.players[side][idx]),
          name: names ? s.players[side][idx] : '',
          role: isActive ? (isServer ? 'server' : 'receiver') : '',
          ...at,
        });
      }
    }
  }
  return { list, pos: p, serverEnd: endOf(s, p.serverSide) };
}

/** Animate the serve for the current state: highlight courts, place players, fly shuttle. */
export async function showServe(court, s, opts = {}) {
  const { list, pos, serverEnd } = matchPlayers(s, opts);
  court.serviceAreas(serverEnd, pos.court, s.discipline);
  court.setPlayers(list);
  const srv = list.find((x) => x.role === 'server');
  const rcv = list.find((x) => x.role === 'receiver');
  if (opts.fly === false || !srv || !rcv) {
    court.hideShuttle();
    return;
  }
  court.hideShuttle();
  await new Promise((r) => setTimeout(r, 420));
  await court.shuttle({ x: srv.x + (serverEnd === 'left' ? 0.4 : -0.4), y: srv.y }, { x: rcv.x + (serverEnd === 'left' ? -0.3 : 0.3), y: rcv.y }, { duration: 850, height: 0.55 });
}

export { other };
