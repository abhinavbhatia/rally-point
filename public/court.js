// Animated top-down badminton court, drawn in SVG using real dimensions in metres.
// The court is shown landscape: one end on the left, one on the right, net in the middle.

const NS = 'http://www.w3.org/2000/svg';
export const L = 13.4; // length (m)
export const W = 6.1; // doubles width (m)
export const NET = L / 2;
export const SHORT = 1.98; // short service line distance from net
export const LONG_D = 0.76; // doubles long service line inside the back line
export const SIDE_S = 0.46; // singles sideline inside the doubles sideline
export const MID = W / 2;

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Rectangle of a service court for a player at `end` ('left'|'right') standing in `court` ('right'|'left'). */
export function serviceCourtRect(end, court, discipline = 'doubles') {
  // Facing the net from the left end, your right hand side is the bottom half of the drawing.
  const bottom = (end === 'left') === (court === 'right');
  const y0 = bottom ? MID : discipline === 'singles' ? SIDE_S : 0;
  const y1 = bottom ? (discipline === 'singles' ? W - SIDE_S : W) : MID;
  const back = discipline === 'singles' ? 0 : LONG_D;
  const x0 = end === 'left' ? back : NET + SHORT;
  const x1 = end === 'left' ? NET - SHORT : L - back;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where a player stands. role: 'serve' | 'receive' | 'base' (partner) */
export function spot(end, court, role = 'serve') {
  const bottom = (end === 'left') === (court === 'right');
  const y = bottom ? MID + 1.45 : MID - 1.45;
  const depth = role === 'base' ? 2.9 : role === 'receive' ? 1.25 : 1.05;
  const x = end === 'left' ? NET - SHORT - depth : NET + SHORT + depth;
  return { x, y };
}

export class Court {
  constructor(container, { label = 'Badminton court' } = {}) {
    this.container = container;
    this.svg = el('svg', {
      viewBox: `-0.9 -0.95 ${L + 1.8} ${W + 1.9}`,
      class: 'court-svg',
      role: 'img',
      'aria-label': label,
    });
    container.appendChild(this.svg);
    this.players = new Map();
    this._build();
  }

  _build() {
    const s = this.svg;
    const defs = el('defs', {}, s);
    defs.innerHTML = `
      <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.06"/></filter>
      <pattern id="hatch" width="0.25" height="0.25" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="0.25" height="0.25" fill="transparent"/><line x1="0" y1="0" x2="0" y2="0.25" stroke="rgba(255,255,255,.35)" stroke-width="0.08"/>
      </pattern>
      <marker id="dim-arr" markerWidth="0.3" markerHeight="0.18" refX="0" refY="0.09" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0,0 L0.3,0.09 L0,0.18" fill="rgba(255,255,255,0.6)" stroke="none"/>
      </marker>`;
    el('rect', { x: -0.9, y: -0.95, width: L + 1.8, height: W + 1.9, rx: 0.3, class: 'court-surround' }, s);
    el('rect', { x: 0, y: 0, width: L, height: W, class: 'court-floor' }, s);

    this.areaLayer = el('g', { class: 'area-layer' }, s);
    this.lineLayer = el('g', { class: 'court-lines' }, s);
    const line = (x1, y1, x2, y2, cls) => el('line', { x1, y1, x2, y2, class: `cl ${cls}` }, this.lineLayer);
    // Boundary + lines. Classes let lessons highlight specific lines.
    line(0, 0, L, 0, 'doubles-side');
    line(0, W, L, W, 'doubles-side');
    line(0, 0, 0, W, 'back');
    line(L, 0, L, W, 'back');
    line(0, SIDE_S, L, SIDE_S, 'singles-side');
    line(0, W - SIDE_S, L, W - SIDE_S, 'singles-side');
    line(NET - SHORT, 0, NET - SHORT, W, 'short');
    line(NET + SHORT, 0, NET + SHORT, W, 'short');
    line(LONG_D, 0, LONG_D, W, 'long-d');
    line(L - LONG_D, 0, L - LONG_D, W, 'long-d');
    line(0, MID, NET - SHORT, MID, 'centre');
    line(NET + SHORT, MID, L, MID, 'centre');

    this.markLayer = el('g', { class: 'mark-layer' }, s);
    // Net (seen from above) with posts.
    this.net = el('g', { class: 'net' }, s);
    el('line', { x1: NET, y1: -0.12, x2: NET, y2: W + 0.12, class: 'net-band' }, this.net);
    el('line', { x1: NET, y1: -0.12, x2: NET, y2: W + 0.12, class: 'net-mesh' }, this.net);
    el('circle', { cx: NET, cy: -0.16, r: 0.09, class: 'post' }, this.net);
    el('circle', { cx: NET, cy: W + 0.16, r: 0.09, class: 'post' }, this.net);

    this.labelLayer = el('g', { class: 'label-layer' }, s);
    this.playerLayer = el('g', { class: 'player-layer' }, s);
    this.fxLayer = el('g', { class: 'fx-layer' }, s);

    // Shuttle: a shadow on the floor and the shuttle itself above it.
    this.shadow = el('ellipse', { rx: 0.16, ry: 0.1, class: 'shuttle-shadow', opacity: 0 }, this.fxLayer);
    this.shuttleG = el('g', { class: 'shuttle', opacity: 0 }, this.fxLayer);
    const sh = el('g', { class: 'shuttle-body' }, this.shuttleG);
    el('path', { d: 'M -0.02 -0.13 L 0.26 -0.2 L 0.26 0.2 L -0.02 0.13 Z', class: 'skirt' }, sh);
    el('line', { x1: 0.26, y1: -0.2, x2: 0.26, y2: 0.2, class: 'skirt-edge' }, sh);
    el('circle', { cx: -0.05, cy: 0, r: 0.12, class: 'cork' }, sh);
  }

  /** Highlight lines by class name, e.g. ['singles-side','back']. Pass [] to clear. */
  highlightLines(classes = [], tone = 'hl') {
    this.lineLayer.querySelectorAll('.cl').forEach((n) => n.classList.remove('hl', 'hl-alt', 'dim'));
    if (!classes.length) return;
    this.lineLayer.querySelectorAll('.cl').forEach((n) => {
      const hit = classes.some((c) => n.classList.contains(c));
      n.classList.add(hit ? tone : 'dim');
    });
  }

  /** Animate drawing of the lines (used on the court lesson). */
  drawLines() {
    if (prefersReduced()) return;
    this.lineLayer.querySelectorAll('.cl').forEach((n, i) => {
      const len = Math.hypot(n.x2.baseVal.value - n.x1.baseVal.value, n.y2.baseVal.value - n.y1.baseVal.value);
      n.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], {
        duration: 700,
        delay: i * 90,
        easing: 'cubic-bezier(.6,0,.2,1)',
        fill: 'backwards',
      });
    });
  }

  clearAreas() {
    this.areaLayer.replaceChildren();
  }

  /** Shade a rectangle. kind: 'play' | 'serve-from' | 'serve-to' | 'out' */
  area(rect, kind = 'play', { animate = true } = {}) {
    const r = el('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, class: `area area-${kind}` }, this.areaLayer);
    if (animate && !prefersReduced()) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
    return r;
  }

  playArea(discipline) {
    this.clearAreas();
    const y0 = discipline === 'singles' ? SIDE_S : 0;
    this.area({ x: 0, y: y0, w: L, h: W - 2 * y0 }, 'play');
  }

  /** Show where the server stands and where the serve must land. */
  serviceAreas(serverEnd, courtName, discipline) {
    this.clearAreas();
    const recvEnd = serverEnd === 'left' ? 'right' : 'left';
    this.area(serviceCourtRect(serverEnd, courtName, discipline), 'serve-from');
    this.area(serviceCourtRect(recvEnd, courtName, discipline), 'serve-to');
  }

  clearLabels() {
    this.labelLayer.replaceChildren();
  }

  label(x, y, text, { anchor = 'middle', cls = '', rotate = 0 } = {}) {
    const t = el('text', { x, y, 'text-anchor': anchor, class: `court-label ${cls}` }, this.labelLayer);
    if (rotate) t.setAttribute('transform', `rotate(${rotate},${x},${y})`);
    t.textContent = text;
    if (!prefersReduced()) t.animate(rotate ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(0.15px)' }, { opacity: 1, transform: 'none' }], { duration: 350, fill: 'backwards' });
    return t;
  }

  /**
   * Draw a dimension annotation (arrow ←→ with label) between two points.
   * Automatically handles horizontal or vertical orientation.
   */
  dimension(x1, y1, x2, y2, text) {
    const g = el('g', {}, this.labelLayer);
    el('line', { x1, y1, x2, y2, class: 'dim-line', 'marker-start': 'url(#dim-arr)', 'marker-end': 'url(#dim-arr)' }, g);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const vert = Math.abs(y2 - y1) > Math.abs(x2 - x1);
    const t = el('text', { x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'court-label meas' }, g);
    if (vert) t.setAttribute('transform', `rotate(-90,${mx},${my})`);
    t.textContent = text;
    if (!prefersReduced()) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, fill: 'backwards' });
    return g;
  }

  /**
   * Place or move players. Each: { id, label, team: 'A'|'B', x, y, role?: 'server'|'receiver'|'', name? }
   * Players not in the list are removed.
   */
  setPlayers(list) {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, node] of this.players) {
      if (!keep.has(id)) {
        node.remove();
        this.players.delete(id);
      }
    }
    for (const p of list) {
      let node = this.players.get(p.id);
      if (!node) {
        node = el('g', { class: `player team-${p.team}` }, this.playerLayer);
        el('circle', { r: 0.78, class: 'ring' }, node);
        el('circle', { r: 0.55, class: 'body' }, node);
        const t = el('text', { class: 'initial', 'text-anchor': 'middle', dy: '0.17' }, node);
        const n = el('text', { class: 'pname', 'text-anchor': 'middle', y: 1.05 }, node);
        node._t = t;
        node._n = n;
        node.style.transform = `translate(${p.x}px, ${p.y}px)`;
        this.players.set(p.id, node);
        if (!prefersReduced()) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      }
      node._t.textContent = p.label;
      node._n.textContent = p.name || '';
      node.classList.toggle('server', p.role === 'server');
      node.classList.toggle('receiver', p.role === 'receiver');
      node.classList.toggle('faded', !!p.faded);
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;
      node._pos = { x: p.x, y: p.y };
    }
  }

  playerPos(id) {
    return this.players.get(id)?._pos;
  }

  /**
   * Fly the shuttle from a to b. height: peak scale bump (0 = flat drive, 1 = high clear).
   * Resolves when it lands. Options: { duration, height, stopAt (0..1 fraction to stop early), drop }
   */
  async shuttle(a, b, { duration = 900, height = 0.6, stopAt = 1 } = {}) {
    const reduced = prefersReduced();
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 180; // cork leads
    const steps = 24;
    const frames = [];
    const shadowFrames = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * stopAt;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const lift = Math.sin(Math.PI * Math.min(t, 1)) * height;
      frames.push({ transform: `translate(${x}px, ${y - lift * 0.9}px) rotate(${angle}deg) scale(${1 + lift * 0.9})` });
      shadowFrames.push({ transform: `translate(${x}px, ${y}px) scale(${1 - lift * 0.4})`, opacity: 0.5 - lift * 0.25 });
    }
    this.shuttleG.setAttribute('opacity', 1);
    this.shadow.setAttribute('opacity', 1);
    if (reduced) {
      this.shuttleG.style.transform = frames.at(-1).transform;
      this.shadow.style.transform = shadowFrames.at(-1).transform;
      return;
    }
    const opts = { duration: duration * stopAt, easing: 'linear', fill: 'forwards' };
    const an = this.shuttleG.animate(frames, opts);
    this.shadow.animate(shadowFrames, opts);
    await an.finished.catch(() => {});
    this.shuttleG.style.transform = frames.at(-1).transform;
    this.shadow.style.transform = shadowFrames.at(-1).transform;
  }

  /** Shuttle drops straight down at its current spot (hits the net, etc). */
  async drop(dx = 0.25) {
    if (prefersReduced()) return;
    const cur = this.shuttleG.style.transform;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(cur);
    if (!m) return;
    const x = +m[1];
    const y = +m[2];
    const an = this.shuttleG.animate(
      [{ transform: cur }, { transform: `translate(${x + dx}px, ${y + 0.2}px) rotate(90deg) scale(1)` }],
      { duration: 380, easing: 'cubic-bezier(.5,0,1,.5)', fill: 'forwards' },
    );
    await an.finished.catch(() => {});
    this.shuttleG.style.transform = `translate(${x + dx}px, ${y + 0.2}px) rotate(90deg) scale(1)`;
  }

  hideShuttle() {
    this.shuttleG.getAnimations().forEach((a) => a.cancel());
    this.shadow.getAnimations().forEach((a) => a.cancel());
    this.shuttleG.setAttribute('opacity', 0);
    this.shadow.setAttribute('opacity', 0);
  }

  /** Show a landing marker. ok: true (in) / false (out). */
  landing(x, y, ok, text) {
    const g = el('g', { class: `landing ${ok ? 'in' : 'out'}` }, this.markLayer);
    g.style.transform = `translate(${x}px, ${y}px)`;
    el('circle', { r: 0.28, class: 'pulse' }, g);
    el('circle', { r: 0.1, class: 'dot' }, g);
    if (text) {
      const t = el('text', { y: -0.42, 'text-anchor': 'middle', class: 'landing-text' }, g);
      t.textContent = text;
    }
    return g;
  }

  clearMarks() {
    this.markLayer.replaceChildren();
  }

  flashNet() {
    this.net.classList.remove('flash');
    void this.net.getBBox();
    this.net.classList.add('flash');
    setTimeout(() => this.net.classList.remove('flash'), 1200);
  }

  flashPlayer(id, cls = 'flash-bad') {
    const n = this.players.get(id);
    if (!n) return;
    n.classList.remove(cls);
    void n.getBBox();
    n.classList.add(cls);
    setTimeout(() => n.classList.remove(cls), 1300);
  }

  /** Move one player by animation (e.g. to the net). */
  movePlayer(id, x, y) {
    const n = this.players.get(id);
    if (!n) return;
    n.style.transform = `translate(${x}px, ${y}px)`;
    n._pos = { x, y };
  }

  /** Convert a pointer event to court metres. */
  toCourt(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  reset() {
    this.clearAreas();
    this.clearLabels();
    this.clearMarks();
    this.hideShuttle();
    this.highlightLines([]);
    this.setPlayers([]);
  }

  destroy() {
    this.svg.remove();
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, prefersReduced() ? Math.min(ms, 50) : ms));
