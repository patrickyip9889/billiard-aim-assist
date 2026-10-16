import { pocketWorldPoints } from '../specs.js';

const SIDES = ['top', 'bottom', 'left', 'right'];
const SIDE_NAME = { top: '上', bottom: '下', left: '左', right: '右' };
const CONTACT_TOL = 0.5;

function railLine(spec, side) {
  if (side === 'top') return { side, nAxis: 'y', at: 0, min: 0, max: spec.tableL };
  if (side === 'bottom') return { side, nAxis: 'y', at: spec.tableW, min: 0, max: spec.tableL };
  if (side === 'left') return { side, nAxis: 'x', at: 0, min: 0, max: spec.tableW };
  return { side, nAxis: 'x', at: spec.tableL, min: 0, max: spec.tableW };
}

function reflectPt(p, line) {
  return line.nAxis === 'y'
    ? { x: p.x, y: 2 * line.at - p.y }
    : { x: 2 * line.at - p.x, y: p.y };
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

function segCircleMin(p, q, c) {
  const vx = q.x - p.x;
  const vy = q.y - p.y;
  const wx = c.x - p.x;
  const wy = c.y - p.y;
  const l2 = vx * vx + vy * vy;
  const s = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / l2));
  return Math.hypot(wx - s * vx, wy - s * vy);
}

export function computeBank({ cue, target, pocket, ballRadius, spec }) {
  const empty = { solutions: [], best: null };
  if (!cue || !target || !pocket || !spec || !(ballRadius > 0)) return empty;
  const pdx = pocket.x - target.x;
  const pdy = pocket.y - target.y;
  if (Math.hypot(pdx, pdy) < 1e-6) return empty;
  const solutions = [];
  for (const side of SIDES) {
    const line = railLine(spec, side);
    const rp = reflectPt(pocket, line);
    const dx = rp.x - target.x;
    const dy = rp.y - target.y;
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-6) continue;
    const ux = dx / dl;
    const uy = dy / dl;
    const dc = line.nAxis === 'y' ? uy : ux;
    if (Math.abs(dc) < 1e-9) continue;
    const fc = line.nAxis === 'y' ? target.y : target.x;
    const s = (line.at - fc) / dc;
    if (s <= 1e-6) continue;
    const B = { x: target.x + ux * s, y: target.y + uy * s };
    const t = line.nAxis === 'y' ? B.x : B.y;
    if (!cushionSpans(spec, side).some(([a, b]) => t >= a && t <= b)) continue;
    const bdx = B.x - target.x;
    const bdy = B.y - target.y;
    const bdl = Math.hypot(bdx, bdy);
    if (bdl < 1e-6) continue;
    const dirx = bdx / bdl;
    const diry = bdy / bdl;
    const ghost = {
      x: target.x - 2 * ballRadius * dirx,
      y: target.y - 2 * ballRadius * diry,
    };
    const agx = ghost.x - cue.x;
    const agy = ghost.y - cue.y;
    const cueTravel = Math.hypot(agx, agy);
    if (cueTravel < 1e-6) continue;
    const aimx = agx / cueTravel;
    const aimy = agy / cueTravel;
    const dot = aimx * dirx + aimy * diry;
    const cutDeg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    if (cutDeg >= 89.5) continue;
    const cutSide = dirx >= 0 ? 1 : -1;
    const reach = 2 * ballRadius;
    if (segCircleMin(cue, ghost, target) < reach - CONTACT_TOL) continue;
    const pocketTravel = Math.hypot(pocket.x - B.x, pocket.y - B.y);
    const totalTargetTravel = bdl + pocketTravel;
    solutions.push({
      cushions: 1,
      rails: [side],
      bounces: [{ point: B, rail: side }],
      ghost,
      aimDir: { x: aimx, y: aimy },
      cutDeg,
      cutSide,
      cueTravel,
      targetTravel: totalTargetTravel,
      label: '翻袋·' + SIDE_NAME[side],
      aimPoint: B,
      score: cutDeg + (totalTargetTravel / 1000) * 5,
    });
  }
  solutions.sort((a, b) => a.score - b.score || a.cueTravel - b.cueTravel);
  return { solutions, best: solutions[0] || null };
}
