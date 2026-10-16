import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHomography, applyH, invert3, mul3, reprojectionErrors } from '../src/math/homography.js';
import { computeAim, overlapLabel, difficultyLabel } from '../src/math/aiming.js';
import { computeKick } from '../src/math/kick.js';
import { getSpec, rotateSpec, pocketWorldPoints, worldCorners } from '../src/specs.js';
import { Calibrator } from '../src/ui/calibrator.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('单应性矩阵还原已知射影变换', () => {
  const Ht = [1.2, 0.1, 30, -0.05, 0.9, 20, 0.0002, 0.0001, 1];
  const src = [
    [0, 0],
    [100, 0],
    [100, 80],
    [0, 80],
  ];
  const dst = src.map(([x, y]) => applyH(Ht, x, y));
  const H = computeHomography(src, dst);
  for (const [x, y] of [
    [50, 40],
    [10, 10],
    [97, 3],
    [33, 77],
  ]) {
    const [ux, uy] = applyH(Ht, x, y);
    const [vx, vy] = applyH(H, x, y);
    assert.ok(close(ux, vx, 1e-4) && close(uy, vy, 1e-4), `点 (${x},${y}) 重投影偏差过大`);
  }
});

test('强透视球台四边形：图像→世界映射精度', () => {
  const Ht = [1, 0.15, 200, -0.1, 0.8, 150, 0.00012, 0.00018, 1];
  const world = worldCorners(getSpec('chinese8')).map((p) => [p.x, p.y]);
  const img = world.map(([x, y]) => applyH(Ht, x, y));
  const H = computeHomography(img, world);
  for (const [wx, wy] of [
    [1270, 635],
    [500, 200],
    [2400, 1100],
    [100, 100],
  ]) {
    const p = applyH(Ht, wx, wy);
    const q = applyH(H, p[0], p[1]);
    assert.ok(close(q[0], wx, 1e-3) && close(q[1], wy, 1e-3), `(${wx},${wy}) → (${q[0]},${q[1]})`);
  }
});

test('invert3 × mul3 = I', () => {
  const H = [2, 1, 3, 0, 1, 4, 0.001, 0.002, 1];
  const I = mul3(H, invert3(H));
  for (let i = 0; i < 9; i++) assert.ok(close(I[i], i % 4 === 0 ? 1 : 0, 1e-9));
});

test('直球：θ=0，重合度=100%，假想球位置正确', () => {
  const r = computeAim({
    cue: { x: 0, y: 0 },
    target: { x: 100, y: 0 },
    pocket: { x: 400, y: 0 },
    ballRadius: 10,
  });
  assert.equal(r.feasible, true);
  assert.ok(close(r.cutDeg, 0, 1e-9));
  assert.ok(close(r.overlap, 1, 1e-9));
  assert.ok(close(r.ghost.x, 80, 1e-9) && close(r.ghost.y, 0, 1e-9));
});

test('半球：θ=30°，重合度=50%', () => {
  const rBall = 10;
  const ghost = { x: 100, y: 0 };
  const u = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
  const target = { x: ghost.x + 2 * rBall * u.x, y: ghost.y + 2 * rBall * u.y };
  const pocket = { x: target.x + 500 * u.x, y: target.y + 500 * u.y };
  const r = computeAim({ cue: { x: 0, y: 0 }, target, pocket, ballRadius: rBall });
  assert.ok(close(r.cutDeg, 30, 1e-6), `θ=${r.cutDeg}`);
  assert.ok(close(r.overlap, 0.5, 1e-9), `overlap=${r.overlap}`);
  assert.ok(close(r.ghost.x, 100, 1e-9) && close(r.ghost.y, 0, 1e-9));
});

test('1/4 球：sinθ=0.75 → 重合度=25%', () => {
  const rBall = 20;
  const theta = Math.asin(0.75);
  const ghost = { x: 100, y: 0 };
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const target = { x: ghost.x + 2 * rBall * u.x, y: ghost.y + 2 * rBall * u.y };
  const pocket = { x: target.x + 500 * u.x, y: target.y + 500 * u.y };
  const r = computeAim({ cue: { x: 0, y: 0 }, target, pocket, ballRadius: rBall });
  assert.ok(close(r.overlap, 0.25, 1e-9), `overlap=${r.overlap}`);
  assert.ok(close(r.cutDeg, (theta * 180) / Math.PI, 1e-6));
});

test('θ≥90° 判定为不可行', () => {
  const rBall = 10;
  const target = { x: 100, y: 2 * rBall };
  const pocket = { x: 100, y: 2 * rBall + 500 };
  const r = computeAim({ cue: { x: 0, y: 0 }, target, pocket, ballRadius: rBall });
  assert.equal(r.feasible, false);
});

test('端到端：图像坐标 → 世界坐标 → 瞄准结果与真值一致', () => {
  const spec = getSpec('snooker');
  const Ht = [1.1, 0.12, 260, -0.08, 0.85, 180, 0.00009, 0.00013, 1];
  const toImg = (p) => applyH(Ht, p.x, p.y);
  const cornersImg = worldCorners(spec).map(toImg);
  const H = computeHomography(cornersImg, worldCorners(spec).map((p) => [p.x, p.y]));
  const fromImgPt = (p) => {
    const [ix, iy] = toImg(p);
    const [wx, wy] = applyH(H, ix, iy);
    return { x: wx, y: wy };
  };
  const cueW = { x: 800, y: 1200 };
  const targetW = { x: 2200, y: 700 };
  const pocket = pocketWorldPoints(spec)[2];
  const truth = computeAim({ cue: cueW, target: targetW, pocket, ballRadius: spec.ballD / 2 });
  const recovered = computeAim({
    cue: fromImgPt(cueW),
    target: fromImgPt(targetW),
    pocket,
    ballRadius: spec.ballD / 2,
  });
  assert.ok(close(truth.cutDeg, recovered.cutDeg, 1e-6), `${truth.cutDeg} vs ${recovered.cutDeg}`);
  assert.ok(close(truth.overlap, recovered.overlap, 1e-9));
  assert.ok(close(truth.ghost.x, recovered.ghost.x, 1e-3));
  assert.ok(close(truth.ghost.y, recovered.ghost.y, 1e-3));
});

test('袋口布局：6 袋，中袋位于长边中点且外移', () => {
  const s = getSpec('chinese8');
  const pts = pocketWorldPoints(s);
  assert.equal(pts.length, 6);
  assert.ok(close(pts[1].x, s.tableL / 2) && close(pts[4].x, s.tableL / 2));
  assert.ok(pts[1].y < 0 && pts[4].y > s.tableW);
  const sn = pocketWorldPoints(getSpec('snooker'));
  assert.equal(sn.length, 6);
});

test('旋转规格：长宽互换，中袋位于左右长边中点且外移', () => {
  const base = getSpec('chinese8');
  const s = rotateSpec(base);
  assert.equal(s.tableL, base.tableW);
  assert.equal(s.tableW, base.tableL);
  assert.equal(s.ballD, base.ballD);
  const pts = pocketWorldPoints(s);
  assert.equal(pts.length, 6);
  assert.ok(close(pts[2].y, s.tableW / 2) && close(pts[5].y, s.tableW / 2));
  assert.ok(pts[2].x > s.tableL && pts[5].x < 0);
  assert.equal(pocketWorldPoints(base).find((p) => p.name === '上中袋').y, -base.sidePocketOut);
});

test('端到端：竖拍（旋转规格）单应性恢复瞄准真值', () => {
  const spec = rotateSpec(getSpec('chinese8'));
  const Ht = [0.9, -0.1, 180, 0.12, 1.05, 40, 0.00013, -0.00009, 1];
  const toImg = (p) => applyH(Ht, p.x, p.y);
  const cornersImg = worldCorners(spec).map(toImg);
  const H = computeHomography(cornersImg, worldCorners(spec).map((p) => [p.x, p.y]));
  const fromImgPt = (p) => {
    const [ix, iy] = toImg(p);
    const [wx, wy] = applyH(H, ix, iy);
    return { x: wx, y: wy };
  };
  const pocket = pocketWorldPoints(spec)[2];
  const truth = computeAim({
    cue: { x: 500, y: 1600 },
    target: { x: 600, y: 900 },
    pocket,
    ballRadius: spec.ballD / 2,
  });
  const recovered = computeAim({
    cue: fromImgPt({ x: 500, y: 1600 }),
    target: fromImgPt({ x: 600, y: 900 }),
    pocket,
    ballRadius: spec.ballD / 2,
  });
  assert.ok(close(truth.cutDeg, recovered.cutDeg, 1e-6), `${truth.cutDeg} vs ${recovered.cutDeg}`);
  assert.ok(close(truth.overlap, recovered.overlap, 1e-9));
});

test('术语标签', () => {
  assert.equal(overlapLabel(1, 0.5), '直球（整球）');
  assert.equal(overlapLabel(0.5, 30), '1/2 球');
  assert.equal(overlapLabel(0.76, 13.5), '3/4 球');
  assert.equal(overlapLabel(0.24, 50), '1/4 球');
  assert.equal(overlapLabel(0.1, 80), '薄球');
  assert.equal(difficultyLabel(10), '简单');
  assert.equal(difficultyLabel(30), '中等');
  assert.equal(difficultyLabel(55), '困难');
  assert.equal(difficultyLabel(80), '极难');
});

test('最小二乘 DLT：6 点精确数据零残差恢复', () => {
  const Ht = [1.15, 0.08, 40, -0.06, 0.92, 25, 0.00015, 0.00011, 1];
  const src = [
    [0, 0],
    [800, 0],
    [800, 600],
    [0, 600],
    [400, 300],
    [200, 150],
  ];
  const dst = src.map(([x, y]) => applyH(Ht, x, y));
  const H = computeHomography(src, dst);
  const errs = reprojectionErrors(H, src, dst);
  for (const e of errs) assert.ok(e < 1e-5, `残差 ${e} 过大`);
});

test('带噪数据：6 点最小二乘总残差低于 4 点解', () => {
  const Ht = [1, 0.12, 150, -0.09, 0.85, 120, 0.00013, 0.00017, 1];
  const src = [
    [0, 0],
    [900, 0],
    [900, 700],
    [0, 700],
    [450, 350],
    [250, 600],
  ];
  const dst = src.map(([x, y]) => applyH(Ht, x, y));
  const noisy = dst.map(([x, y], i) => (i === 2 ? [x + 4, y - 3] : i === 4 ? [x - 3, y + 4] : [x, y]));
  const H4 = computeHomography(src.slice(0, 4), noisy.slice(0, 4));
  const H6 = computeHomography(src, noisy);
  const q4 = reprojectionErrors(H4, src, noisy).reduce((a, e) => a + e * e, 0);
  const q6 = reprojectionErrors(H6, src, noisy).reduce((a, e) => a + e * e, 0);
  assert.ok(q6 < q4, `LS 平方残差 ${q6.toFixed(2)} 应小于 4 点解 ${q4.toFixed(2)}`);
  assert.ok(q6 < 50, `LS 平方残差 ${q6.toFixed(2)} 应低于注入噪声能量 50`);
});

test('几何校验：标准四边形 + 袋口投影通过', () => {
  const c = new Calibrator();
  c.points = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 700 },
    { x: 100, y: 700 },
  ];
  assert.deepEqual(c.issues(900, 700, getSpec('chinese8')), []);
});

test('几何校验：逆时针点序报错', () => {
  const c = new Calibrator();
  c.points = [
    { x: 100, y: 700 },
    { x: 900, y: 700 },
    { x: 900, y: 100 },
    { x: 100, y: 100 },
  ];
  const iss = c.issues(900, 700, getSpec('chinese8'));
  assert.equal(iss.length, 1);
  assert.ok(iss[0].includes('顺时针'), `消息: ${iss[0]}`);
});

test('几何校验：两点过近报错', () => {
  const c = new Calibrator();
  c.points = [
    { x: 100, y: 100 },
    { x: 120, y: 100 },
    { x: 900, y: 100 },
    { x: 500, y: 900 },
  ];
  const iss = c.issues(1000, 1000, getSpec('chinese8'));
  assert.ok(iss[0].includes('太近'), `消息: ${iss[0]}`);
});

test('几何校验：面积过小报错', () => {
  const c = new Calibrator();
  c.points = [
    { x: 100, y: 100 },
    { x: 140, y: 100 },
    { x: 140, y: 140 },
    { x: 100, y: 140 },
  ];
  const iss = c.issues(1000, 1000, getSpec('chinese8'));
  assert.ok(iss[0].includes('面积'), `消息: ${iss[0]}`);
});

test('几何校验：袋口投影越界报错', () => {
  const c = new Calibrator();
  c.points = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 700 },
    { x: 100, y: 700 },
  ];
  const iss = c.issues(300, 300, getSpec('chinese8'));
  assert.equal(iss.length, 1);
  assert.ok(iss[0].includes('袋口投影'), `消息: ${iss[0]}`);
});

test('解球：单库镜像法反弹点与折叠点一致', () => {
  const spec = getSpec('chinese8');
  const pocket = pocketWorldPoints(spec)[3];
  const cue = { x: 1100, y: 800 };
  const target = { x: 2100, y: 1000 };
  const kick = computeKick({ cue, target, pocket, ballRadius: spec.ballD / 2, spec, maxCushions: 1 });
  assert.ok(kick.solutions.length >= 1, '应至少找到一条解球路线');
  const bottom = kick.solutions.find((s) => s.rails[0] === 'bottom');
  assert.ok(bottom, '应存在下库解球方案');
  const aim = { x: kick.ghost.x, y: 2 * spec.tableW - kick.ghost.y };
  const s = (spec.tableW - cue.y) / (aim.y - cue.y);
  const bx = cue.x + s * (aim.x - cue.x);
  assert.ok(close(bottom.bounces[0].point.x, bx, 1e-6), `反弹点 x ${bottom.bounces[0].point.x} ≠ 折叠预测 ${bx}`);
  assert.ok(close(bottom.bounces[0].point.y, spec.tableW, 1e-6));
  const gl = Math.hypot(kick.ghost.x - bx, kick.ghost.y - spec.tableW);
  assert.ok(close(bottom.arrivalDir.x, (kick.ghost.x - bx) / gl, 1e-9));
  assert.ok(close(bottom.arrivalDir.y, (kick.ghost.y - spec.tableW) / gl, 1e-9));
  assert.ok(bottom.cutDeg < 89.5, `解球切割角 ${bottom.cutDeg} 应小于 89.5°`);
  const step = spec.tableL / 8;
  const k = Math.min(7, Math.max(1, Math.round(bx / step)));
  assert.equal(bottom.bounces[0].diamond.k, k);
  assert.equal(bottom.label, `1库·下${k}`);
  assert.ok(close(bottom.aimPoint.x, bx, 1e-9));
  assert.ok(close(bottom.aimPoint.y, spec.tableW, 1e-9));
});

test('解球：多库枚举、验证链与最优排序', () => {
  const spec = getSpec('chinese8');
  const pocket = pocketWorldPoints(spec)[3];
  const cue = { x: 1100, y: 800 };
  const target = { x: 2100, y: 1000 };
  const kick = computeKick({ cue, target, pocket, ballRadius: spec.ballD / 2, spec, maxCushions: 3 });
  assert.ok(kick.solutions.length >= 1, '应找到多库解球方案');
  for (const s of kick.solutions) {
    assert.ok(s.cushions >= 1 && s.cushions <= 3);
    assert.ok(s.rails.every((r, i) => i === 0 || r !== s.rails[i - 1]));
    assert.ok(s.cutDeg < 89.5, `切割角 ${s.cutDeg} 应小于 89.5°`);
    assert.match(s.label, /^\d库·[上下左右]\d(-[上下左右]\d)*$/);
    assert.equal(s.label.split('-').length, s.cushions);
  }
  for (let i = 1; i < kick.solutions.length; i++) {
    assert.ok(kick.solutions[i - 1].score <= kick.solutions[i].score + 1e-9, '方案应按分数升序排列');
  }
  assert.equal(kick.best, kick.solutions[0]);
});

test('解球：退化输入返回空结果', () => {
  const spec = getSpec('chinese8');
  const empty = computeKick({ spec, ballRadius: spec.ballD / 2 });
  assert.equal(empty.solutions.length, 0);
  assert.equal(empty.best, null);
  const p = pocketWorldPoints(spec)[3];
  const same = computeKick({ cue: p, target: p, pocket: p, ballRadius: spec.ballD / 2, spec });
  assert.equal(same.solutions.length, 0);
});
