const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function computeAim({ cue, target, pocket, ballRadius }) {
  const pdx = pocket.x - target.x;
  const pdy = pocket.y - target.y;
  const targetTravel = Math.hypot(pdx, pdy);
  if (targetTravel < 1e-9) {
    return { feasible: false, reason: '目标球已在袋口位置' };
  }
  const ux = pdx / targetTravel;
  const uy = pdy / targetTravel;
  const ghost = {
    x: target.x - 2 * ballRadius * ux,
    y: target.y - 2 * ballRadius * uy,
  };
  const contact = {
    x: target.x - ballRadius * ux,
    y: target.y - ballRadius * uy,
  };
  const agx = ghost.x - cue.x;
  const agy = ghost.y - cue.y;
  const cueTravel = Math.hypot(agx, agy);
  if (cueTravel < 1e-9) {
    return { feasible: false, reason: '母球已位于假想球位置' };
  }
  const vx = agx / cueTravel;
  const vy = agy / cueTravel;
  const dot = clamp(vx * ux + vy * uy, -1, 1);
  const cutDeg = (Math.acos(dot) * 180) / Math.PI;
  const overlap = clamp(1 - Math.sin((cutDeg * Math.PI) / 180), 0, 1);
  const feasible = cutDeg < 89.5;
  return {
    feasible,
    reason: feasible ? null : '切割角达到或超过 90°，几何上无法进球',
    ghost,
    contact,
    aimDir: { x: vx, y: vy },
    pocketDir: { x: ux, y: uy },
    cutDeg,
    overlap,
    cueTravel,
    targetTravel,
  };
}

export function overlapLabel(overlap, cutDeg) {
  if (cutDeg < 3) return '直球（整球）';
  const table = [
    [1, '整球'],
    [0.75, '3/4 球'],
    [0.5, '1/2 球'],
    [0.25, '1/4 球'],
  ];
  for (const [v, label] of table) {
    if (Math.abs(overlap - v) <= 0.05) return label;
  }
  return overlap >= 0.06 ? '薄球' : '极薄球';
}

export function difficultyLabel(cutDeg) {
  if (cutDeg < 20) return '简单';
  if (cutDeg < 45) return '中等';
  if (cutDeg < 65) return '困难';
  return '极难';
}
