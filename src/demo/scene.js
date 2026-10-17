import { getSpec, worldCorners, pocketWorldPoints } from '../specs.js';
import { computeHomography, applyH, invert3 } from '../math/homography.js';
import { computeAim } from '../math/aiming.js';

export async function buildDemoFile(specKey = 'chinese8') {
  const CW = 1000;
  const CH = 1500;
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const spec = getSpec(specKey);
  const L = spec.tableL;
  const Wd = spec.tableW;

  const imgCorners = [
    { x: 140, y: 1230 },
    { x: 260, y: 310 },
    { x: 740, y: 310 },
    { x: 860, y: 1230 },
  ];
  const wc = worldCorners(spec).map((p) => [p.x, p.y]);
  const ic = imgCorners.map((p) => [p.x, p.y]);
  const H_wi = computeHomography(wc, ic);
  const toImg = (x, y) => {
    const [px, py] = applyH(H_wi, x, y);
    return { x: px, y: py };
  };

  const bg = ctx.createLinearGradient(0, 0, 0, CH);
  bg.addColorStop(0, '#242b34');
  bg.addColorStop(1, '#10141a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CW, CH);
  const amb = ctx.createRadialGradient(CW / 2, CH * 0.42, 120, CW / 2, CH * 0.42, 950);
  amb.addColorStop(0, 'rgba(255,255,255,.07)');
  amb.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, CW, CH);

  const R = 170;
  const woodQuad = [
    toImg(-R, -R),
    toImg(L + R, -R),
    toImg(L + R, Wd + R),
    toImg(-R, Wd + R),
  ];
  const woodFar = toImg(L / 2, -R);
  const woodNear = toImg(L / 2, Wd + R);
  const wood = ctx.createLinearGradient(woodFar.x, woodFar.y, woodNear.x, woodNear.y);
  wood.addColorStop(0, '#63452a');
  wood.addColorStop(1, '#3d2814');
  ctx.fillStyle = wood;
  poly(ctx, woodQuad);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.5)';
  ctx.lineWidth = 3;
  poly(ctx, woodQuad);
  ctx.stroke();

  const feltNear = toImg(L / 2, Wd);
  const feltFar = toImg(L / 2, 0);
  const cloth = ctx.createLinearGradient(feltNear.x, feltNear.y, feltFar.x, feltFar.y);
  cloth.addColorStop(0, '#1f9e55');
  cloth.addColorStop(1, '#0c4f27');
  ctx.fillStyle = cloth;
  poly(ctx, imgCorners);
  ctx.fill();

  const cushPolys = [
    [[jaw, 0], [L / 2 - sg, 0], [L / 2 - sg, -C], [jaw - C, -C]],
    [[L / 2 + sg, 0], [L - jaw, 0], [L - jaw + C, -C], [L / 2 + sg, -C]],
    [[jaw, Wd], [L / 2 - sg, Wd], [L / 2 - sg, Wd + C], [jaw - C, Wd + C]],
    [[L / 2 + sg, Wd], [L - jaw, Wd], [L - jaw + C, Wd + C], [L / 2 + sg, Wd + C]],
    [[L, jaw], [L, Wd - jaw], [L + C, Wd - jaw + C], [L + C, jaw - C]],
    [[0, jaw], [0, Wd - jaw], [-C, Wd - jaw + C], [-C, jaw - C]],
  ];
  ctx.fillStyle = '#158043';
  ctx.strokeStyle = 'rgba(0,0,0,.3)';
  ctx.lineWidth = 1.5;
  for (const cp of cushPolys) {
    poly(ctx, cp.map(([x, y]) => toImg(x, y)));
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.32)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const cp of cushPolys) {
    const a = toImg(cp[0][0], cp[0][1]);
    const b = toImg(cp[1][0], cp[1][1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const p of pocketWorldPoints(spec)) {
    const c = toImg(p.x, p.y);
    const r = radiusAt(ctx, toImg, p.x, p.y, spec.pocketR);
    ctx.fillStyle = '#04060a';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const dR = 10;
  const dotW = (x, y, alpha = 0.9, rw = dR) => {
    const c = toImg(x, y);
    const r = Math.max(2, radiusAt(ctx, toImg, x, y, rw));
    ctx.fillStyle = `rgba(245,245,240,${alpha})`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const k of [1, 2, 3, 5, 6, 7]) {
    dotW((k * L) / 8, -R * 0.5);
    dotW((k * L) / 8, Wd + R * 0.5);
  }
  for (const k of [1, 2, 3]) {
    dotW(-R * 0.5, (k * Wd) / 4);
    dotW(L + R * 0.5, (k * Wd) / 4);
  }
  dotW(L / 2, Wd / 2, 0.4, 9);
  dotW(L * 0.75, Wd / 2, 0.4, 9);

  const cueW = { x: spec.tableL * 0.35, y: spec.tableW * 0.66 };
  const targetW = { x: spec.tableL * 0.69, y: spec.tableW * 0.41 };
  const pocketIdx = 2;
  const cueI = toImg(cueW.x, cueW.y);
  const cueR = radiusAt(ctx, toImg, cueW.x, cueW.y, spec.ballD / 2);
  const targetI = toImg(targetW.x, targetW.y);
  const targetR = radiusAt(ctx, toImg, targetW.x, targetW.y, spec.ballD / 2);
  ballShadow(ctx, cueI, cueR);
  ballShadow(ctx, targetI, targetR);
  drawBall(ctx, cueI, cueR, '#f2f2ea');
  drawBall(ctx, targetI, targetR, '#d2322c');

  const expected = computeAim({
    cue: cueW,
    target: targetW,
    pocket: pocketWorldPoints(spec)[pocketIdx],
    ballRadius: spec.ballD / 2,
  });

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], 'demo.png', { type: 'image/png' });
  return {
    file,
    corners: imgCorners,
    cue: cueI,
    target: targetI,
    pocketIdx,
    expected,
  };
}

const C = 55;
const jaw = 62;
const sg = 55;

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function radiusAt(ctx, toImg, x, y, rWorld) {
  const c = toImg(x, y);
  const ax = toImg(x + rWorld, y);
  const ay = toImg(x, y + rWorld);
  return (Math.hypot(ax.x - c.x, ax.y - c.y) + Math.hypot(ay.x - c.x, ay.y - c.y)) / 2;
}

function ballShadow(ctx, c, r) {
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.beginPath();
  ctx.ellipse(c.x + r * 0.16, c.y + r * 0.5, r * 1.04, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall(ctx, c, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(
    c.x - r * 0.35,
    c.y - r * 0.4,
    r * 0.05,
    c.x - r * 0.35,
    c.y - r * 0.4,
    r * 1.15
  );
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,.25)');
  g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
}
