import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { detectTable, detectBalls, refineBallCenter } from '../src/vision/detector.js';

const SPEC = { tableL: 2540, ballD: 57.15 };

let cvReady = null;

function loadCv() {
  if (cvReady) return cvReady;
  cvReady = (async () => {
    const req = createRequire(import.meta.url);
    const dst = `${tmpdir()}/opencv-test-${process.pid}.cjs`;
    copyFileSync(new URL('../vendor/opencv.js', import.meta.url).pathname, dst);
    globalThis.Module = {};
    const cv = req(dst);
    if (typeof cv.then === 'function') {
      try {
        delete cv.then;
      } catch {
        cv.then = undefined;
      }
    }
    if (!cv.Mat) {
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('cv init timeout')), 90000);
        cv.onRuntimeInitialized = () => {
          clearTimeout(timer);
          res();
        };
      });
    }
    globalThis.window = { cv };
    cv.imread = (el) => cv.matFromImageData(el.getContext('2d').getImageData(0, 0, el.width, el.height));
    return cv;
  })();
  return cvReady;
}

function makeScene() {
  const W = 640;
  const H = 360;
  const d = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, r, g, b) => {
    const i = (y * W + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) set(x, y, 34, 34, 38);
  }
  for (let y = 36; y <= 324; y++) {
    for (let x = 48; x <= 592; x++) set(x, y, 40, 118, 54);
  }
  const ball = (cx, cy, rad, r, g, b) => {
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd <= rad * rad) {
          const t = Math.sqrt(dd) / rad;
          const hl = Math.max(0, 1 - Math.hypot(x - (cx - 2), y - (cy - 2)) / (rad * 0.9));
          const k = 1 - 0.45 * t * t + 0.55 * hl * hl;
          set(x, y, Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k));
        }
      }
    }
  };
  ball(200, 180, 7, 248, 248, 246);
  ball(430, 140, 7, 205, 45, 48);
  ball(465, 225, 7, 214, 190, 62);
  return {
    width: W,
    height: H,
    getContext: () => ({ getImageData: () => ({ data: d, width: W, height: H }) }),
  };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('opencv runtime loads and exposes core ops', async () => {
  const cv = await loadCv();
  assert.equal(typeof cv.Mat, 'function');
  assert.equal(typeof cv.HoughCircles, 'function');
  assert.equal(typeof cv.findContours, 'function');
  assert.equal(typeof cv.inRange, 'function');
});

test('detectTable finds synthetic green table quad', async () => {
  await loadCv();
  const canvas = makeScene();
  const { corners, fill } = await detectTable(canvas);
  assert.ok(fill > 0.5, `fill=${fill.toFixed(2)}`);
  const expect = [
    [48, 36],
    [592, 36],
    [592, 324],
    [48, 324],
  ];
  assert.equal(corners.length, 4);
  expect.forEach(([ex, ey], i) => {
    assert.ok(near(corners[i].x, ex, 5) && near(corners[i].y, ey, 5), `corner#${i} got (${Math.round(corners[i].x)},${Math.round(corners[i].y)}) expect (${ex},${ey})`);
  });
});

test('detectBalls finds white cue ball first and colored balls as targets', async () => {
  await loadCv();
  const canvas = makeScene();
  const { corners } = await detectTable(canvas);
  const det = await detectBalls(canvas, SPEC, corners);
  assert.ok(det.cue, 'cue ball not found');
  assert.ok(near(det.cue.x, 200, 6) && near(det.cue.y, 180, 6), `cue got (${Math.round(det.cue.x)},${Math.round(det.cue.y)})`);
  assert.ok(det.radius >= 5 && det.radius <= 8, `radius=${det.radius}`);
  const truth = [
    [430, 140],
    [465, 225],
  ];
  for (const [tx, ty] of truth) {
    const hit = det.targets.find((p) => near(p.x, tx, 9) && near(p.y, ty, 9));
    assert.ok(hit, `target at (${tx},${ty}) not found; got ${JSON.stringify(det.targets.map((p) => [Math.round(p.x), Math.round(p.y)]))}`);
  }
  const cueInTargets = det.targets.find((p) => near(p.x, 200, 8) && near(p.y, 180, 8));
  assert.ok(!cueInTargets, 'cue ball must not appear in targets');
});

test('refineBallCenter snaps dropped point to nearby ball center', async () => {
  await loadCv();
  const canvas = makeScene();
  const hit = await refineBallCenter(canvas, { x: 205, y: 184 }, 7);
  assert.ok(hit, 'local hough found no circle near drop point');
  assert.ok(near(hit.x, 200, 4) && near(hit.y, 180, 4), `got (${hit.x.toFixed(1)},${hit.y.toFixed(1)}) expect (200,180)`);
  assert.ok(hit.r >= 4 && hit.r <= 12, `r=${hit.r.toFixed(1)}`);
});

test('refineBallCenter returns null on blank felt', async () => {
  await loadCv();
  const canvas = makeScene();
  const hit = await refineBallCenter(canvas, { x: 300, y: 300 }, 7);
  assert.equal(hit, null);
});
