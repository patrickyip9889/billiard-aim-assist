import { getSpec, worldCorners, pocketWorldPoints } from '../specs.js';
import { computeHomography, applyH, invert3 } from '../math/homography.js';
import { computeAim } from '../math/aiming.js';

export async function buildDemoFile(specKey = 'chinese8') {
  const W = 1600;
  const H = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const spec = getSpec(specKey);

  const imgCorners = [
    { x: 300, y: 330 },
    { x: 1330, y: 240 },
    { x: 1450, y: 820 },
    { x: 200, y: 700 },
  ];
  const wc = worldCorners(spec).map((p) => [p.x, p.y]);
  const ic = imgCorners.map((p) => [p.x, p.y]);
  const H_wi = computeHomography(wc, ic);
  const toImg = (x, y) => {
    const [px, py] = applyH(H_wi, x, y);
    return { x: px, y: py };
  };

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#242b34');
  bg.addColorStop(1, '#12161b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const R = 150;
  const railQuad = [
    toImg(-R, -R),
    toImg(spec.tableL + R, -R),
    toImg(spec.tableL + R, spec.tableW + R),
    toImg(-R, spec.tableW + R),
  ];
  ctx.fillStyle = '#5a3d26';
  poly(ctx, railQuad);
  ctx.fill();

  const cloth = ctx.createLinearGradient(
    imgCorners[0].x,
    imgCorners[0].y,
    imgCorners[2].x,
    imgCorners[2].y
  );
  cloth.addColorStop(0, '#1d8a48');
  cloth.addColorStop(1, '#12592e');
  ctx.fillStyle = cloth;
  poly(ctx, imgCorners);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.lineWidth = 3;
  poly(ctx, imgCorners);
  ctx.stroke();

  for (const p of pocketWorldPoints(spec)) {
    const c = toImg(p.x, p.y);
    const r = radiusAt(ctx, toImg, p.x, p.y, spec.pocketR);
    ctx.fillStyle = '#0a0d10';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const cueW = { x: spec.tableL * 0.35, y: spec.tableW * 0.66 };
  const targetW = { x: spec.tableL * 0.69, y: spec.tableW * 0.41 };
  const pocketIdx = 2;
  drawBall(ctx, toImg(cueW.x, cueW.y), radiusAt(ctx, toImg, cueW.x, cueW.y, spec.ballD / 2), '#f2f2ea');
  drawBall(ctx, toImg(targetW.x, targetW.y), radiusAt(ctx, toImg, targetW.x, targetW.y, spec.ballD / 2), '#d2322c');

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
    cue: toImg(cueW.x, cueW.y),
    target: toImg(targetW.x, targetW.y),
    pocketIdx,
    expected,
  };
}

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
