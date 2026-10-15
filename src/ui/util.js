export function pickHandle(points, p, radiusImg) {
  let best = -1;
  let bestD = radiusImg * radiusImg;
  points.forEach((q, i) => {
    if (!q) return;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function clampPt(p, w, h) {
  return {
    x: Math.min(Math.max(p.x, 0), w),
    y: Math.min(Math.max(p.y, 0), h),
  };
}

export function quadArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
