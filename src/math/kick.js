import { pocketWorldPoints } from '../specs.js';

const SIDES = ['top', 'bottom', 'left', 'right'];
const SIDE_NAME = { top: '上', bottom: '下', left: '左', right: '右' };
const SIN_MIN_INCIDENT = Math.sin((12 * Math.PI) / 180);
const COS_MAX_CUT = Math.cos((89.5 * Math.PI) / 180);
const CONTACT_TOL = 0.5;

function railLine(spec, side) {
  if (side === 'top') return { side, nAxis: 'y', at: 0, min: 0, max: spec.tableL };
  if (side === 'bottom') return { side, nAxis: 'y', at: spec.tableW, min: 0, max: spec.tableL };
  if (side === 'left') return { side, nAxis: 'x', at: 0, min: 0, max: spec.tableW };
  return { side, nAxis: 'x', at: spec.tableL, min: 0, max: spec.tableW };
}

function cushionSpans(spec, side) {
  const line = railLine(spec, side);
  const clear = spec.pocketR + spec.ballD / 2;
  const blocks = [];
  for (const p of pocketWorldPoints(spec)) {
    const perp = line.nAxis === 'y' ? p.y : p.x;
    const t = line.nAxis === 'y' ? p.x : p.y;
    const d = Math.abs(perp - line.at);
    if (d >= clear) continue;
    const half = Math.sqrt(clear * clear - d * d);
    blocks.push([t - half, t + half]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cur = line.min;
  for (const [a, b] of blocks) {
    if (a > cur) spans.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < line.max) spans.push([cur, line.max]);
  return spans.filter(([a, b]) => b - a > spec.ballD);
}

export function diamondInfo(spec, side, t) {
  const long = side === 'top' || side === 'bottom';
  const step = long ? spec.tableL / 8 : spec.tableW / 4;
  const maxK = long ? 8 : 4;
  const k = Math.min(maxK - 1, Math.max(1, Math.round(t / step)));
  return { k, label: SIDE_NAME[side] + k };
}

function reflectPt(p, line) {
  return line.nAxis === 'y'
    ? { x: p.x, y: 2 * line.at - p.y }
    : { x: 2 * line.at - p.x, y: p.y };
}

function reflectDir(d, line) {
  return line.nAxis === 'y' ? { x: d.x, y: -d.y } : { x: -d.x, y: d.y };
}

function rayHit(from, dir, line) {
  const dc = line.nAxis === 'y' ? dir.y : dir.x;
  if (Math.abs(dc) < 1e-9) return null;
  const fc = line.nAxis === 'y' ? from.y : from.x;
  const s = (line.at - fc) / dc;
  if (s <= 1e-6) return null;
  return { s, point: { x: from.x + dir.x * s, y: from.y + dir.y * s } };
}

function segCircleMin(p, q, c) {
  const vx = q.x - p.x;
  const vy = q.y - p.y;
  const wx = c.x - p.x;
  const wy = c.y - p.y;
  const l2 = vx * vx + vy * vy;
  const s = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / l2));
  return Math.hypot(wx - s * vx, wy - s * vy);
}

export function computeKick({ cue, target, pocket, ballRadius, spec, maxCushions = 3 }) {
  const empty = { solutions: [], best: null, ghost: null, pocketDir: null, targetTravel: 0 };
  if (!cue || !target || !pocket || !spec || !(ballRadius > 0)) return empty;
  const pdx = pocket.x - target.x;
  const pdy = pocket.y - target.y;
  const targetTravel = Math.hypot(pdx, pdy);
  if (targetTravel < 1e-6) return empty;
  const ux = pdx / targetTravel;
  const uy = pdy / targetTravel;
  const ghost = { x: target.x - 2 * ballRadius * ux, y: target.y - 2 * ballRadius * uy };
  const spans = {};
  for (const side of SIDES) spans[side] = cushionSpans(spec, side);

  const seqs = [];
  const rec = (prefix) => {
    if (prefix.length >= 1) seqs.push(prefix);
    if (prefix.length >= maxCushions) return;
    for (const side of SIDES) {
      if (side === prefix[prefix.length - 1]) continue;
      rec([...prefix, side]);
    }
  };
  for (const side of SIDES) rec([side]);

  const reach = 2 * ballRadius;
  const solutions = [];
  for (const rails of seqs) {
    let aim = ghost;
    for (let i = rails.length - 1; i >= 0; i--) {
      aim = reflectPt(aim, railLine(spec, rails[i]));
    }
    let dx = aim.x - cue.x;
    let dy = aim.y - cue.y;
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-6) continue;
    dx /= dl;
    dy /= dl;
    const bounces = [];
    let cx = cue.x;
    let cy = cue.y;
    let ok = true;
    for (const side of rails) {
      const line = railLine(spec, side);
      const hit = rayHit({ x: cx, y: cy }, { x: dx, y: dy }, line);
      if (!hit) {
        ok = false;
        break;
      }
      const t = line.nAxis === 'y' ? hit.point.x : hit.point.y;
      if (!spans[side].some(([a, b]) => t >= a && t <= b)) {
        ok = false;
        break;
      }
      const nComp = line.nAxis === 'y' ? Math.abs(dy) : Math.abs(dx);
      if (nComp < SIN_MIN_INCIDENT) {
        ok = false;
        break;
      }
      bounces.push({ point: hit.point, rail: side, free: t, diamond: diamondInfo(spec, side, t) });
      const nd = reflectDir({ x: dx, y: dy }, line);
      cx = hit.point.x;
      cy = hit.point.y;
      dx = nd.x;
      dy = nd.y;
    }
    if (!ok) continue;
    const gx = ghost.x - cx;
    const gy = ghost.y - cy;
    const gl = Math.hypot(gx, gy);
    if (gl < ballRadius) continue;
    if (Math.abs(gx * dy - gy * dx) > 1e-3) continue;
    if (gx * dx + gy * dy <= 0) continue;
    const cutCos = dx * ux + dy * uy;
    if (cutCos <= COS_MAX_CUT) continue;
    const cutDeg = (Math.acos(Math.min(1, Math.max(-1, cutCos))) * 180) / Math.PI;
    let prev = { x: cue.x, y: cue.y };
    let travel = 0;
    let blocked = false;
    for (const q of [...bounces.map((b) => b.point), ghost]) {
      if (segCircleMin(prev, q, target) < reach - CONTACT_TOL) {
        blocked = true;
        break;
      }
      travel += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    if (blocked) continue;
    solutions.push({
      cushions: rails.length,
      rails,
      bounces,
      arrivalDir: { x: dx, y: dy },
      cutDeg,
      cueTravel: travel,
      label: `${rails.length}库·${bounces.map((b) => b.diamond.label).join('-')}`,
      aimPoint: bounces[0].point,
      score: cutDeg + rails.length * 30 + (travel / 1000) * 5,
    });
  }
  solutions.sort((a, b) => a.score - b.score || a.cueTravel - b.cueTravel);
  return { solutions, best: solutions[0] || null, ghost, pocketDir: { x: ux, y: uy }, targetTravel };
}
