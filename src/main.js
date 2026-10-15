import { SPECS, getSpec, rotateSpec, worldCorners, pocketWorldPoints } from './specs.js';
import { computeHomography, applyH, invert3, reprojectionErrors } from './math/homography.js';
import { computeAim, overlapLabel, difficultyLabel } from './math/aiming.js';
import { renderOverlay } from './ui/overlay.js';
import { Magnifier } from './ui/magnifier.js';
import { Calibrator } from './ui/calibrator.js';
import { BallPicker } from './ui/picker.js';
import { clampPt, pickHandle } from './ui/util.js';
import { drawCutDiagram } from './ui/cutDiagram.js';
import { detectTable, detectBalls, snapshotCanvas, loadOpenCV, refineBallCenter, detectPockets } from './vision/detector.js';
import { buildDemoFile } from './demo/scene.js';

const $ = (id) => document.getElementById(id);
const els = {
  specSel: $('specSel'),
  wrap: $('stageWrap'),
  stage: $('stage'),
  base: $('base'),
  overlayCv: $('overlayCv'),
  loupe: $('loupe'),
  hint: $('hint'),
  toolbar: $('toolbar'),
  panel: $('panel'),
  calibDoneBtn: $('calibDoneBtn'),
  pocketBtn: $('pocketBtn'),
  backCalibBtn: $('backCalibBtn'),
  backBallsBtn: $('backBallsBtn'),
  resetBtn: $('resetBtn'),
  demoBtn: $('demoBtn'),
  autoBtn: $('autoBtn'),
  arBtn: $('arBtn'),
  arShotBtn: $('arShotBtn'),
  arCancelBtn: $('arCancelBtn'),
  arVideo: $('arVideo'),
  shotInput: $('shotInput'),
  fileInput: $('fileInput'),
  vCut: $('vCut'),
  vOverlap: $('vOverlap'),
  vStyle: $('vStyle'),
  vDiff: $('vDiff'),
  vCueT: $('vCueT'),
  vTargetT: $('vTargetT'),
  vPocket: $('vPocket'),
  refineBtn: $('refineBtn'),
  refineDoneBtn: $('refineDoneBtn'),
  rotBtn: $('rotBtn'),
  nudgeGroup: $('nudgeGroup'),
  nudgeLabel: $('nudgeLabel'),
  warn: $('warn'),
  cutCv: $('cutCv'),
  cutFig: $('cutFig'),
  figToggle: $('figToggle'),
  divSel: $('divSel'),
};

const calibrator = new Calibrator();
const picker = new BallPicker();

const state = {
  specKey: 'chinese8',
  img: null,
  imgW: 0,
  imgH: 0,
  scale: 1,
  dpr: 1,
  cssW: 0,
  cssH: 0,
  mode: 'empty',
  pocketIdx: -1,
  result: null,
  divisions: 8,
  refinePts: null,
  rotated: false,
  selIdx: -1,
  selKind: null,
  detBalls: null,
  snapTo: null,
  picker,
};

const magnifier = new Magnifier(els.loupe);
const bctx = els.base.getContext('2d');
const octx = els.overlayCv.getContext('2d');
const HINTS = {
  empty: '📷 拍照 / 选择台面照片开始，或点击「示例图」快速体验',
  calibrate: '按顺时针顺序，把 1-4 号绿点拖到台面四角（横拍/竖拍均可），完成后点「完成标定」',
  balls: '把 ⚪母球、🔴目标球 拖到对应位置（松手自动吸附球心），然后点「选择袋口」',
  pocket: '点击要进攻的袋口（1-6 号圆圈）',
  done: '✅ 拖动球或点击其他袋口可实时更新；也可回退上一步或用「🎯 袋口精化」',
  refine: '🎯 拖动 6 个袋口点到图中实际袋口，数字为残差(mm)，完成后点「完成精化」',
  ar: '🎬 对准台面，点「定格」拍下画面进入标定',
};

const spec = () => (state.rotated ? rotateSpec(getSpec(state.specKey)) : getSpec(state.specKey));

function detectOrientation() {
  const [p0, p1, , p3] = calibrator.points;
  const r =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) /
    Math.max(1e-6, Math.hypot(p3.x - p0.x, p3.y - p0.y));
  const base = getSpec(state.specKey);
  return (
    Math.abs(r - base.tableW / base.tableL) < Math.abs(r - base.tableL / base.tableW)
  );
}

const ROT_MAP = {
  d2r: { 0: 0, 1: -1, 2: 1, 3: 3, 4: -1, 5: 4 },
  r2d: { 0: 0, 1: 2, 2: -1, 3: 3, 4: 5, 5: -1 },
};

function nudgeStep() {
  return Math.max(1, 2 / state.scale);
}

function nudge(dir) {
  if (state.selIdx < 0) return;
  const step = nudgeStep();
  const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
  const dy = dir === 'up' ? -step : dir === 'down' ? step : 0;
  if (state.mode === 'calibrate' && state.selKind === 'corner') {
    const p = calibrator.points[state.selIdx];
    calibrator.move(state.selIdx, clampPt({ x: p.x + dx, y: p.y + dy }, state.imgW, state.imgH));
    state.result = null;
  } else if (state.mode === 'refine' && state.selKind === 'refine') {
    const p = state.refinePts[state.selIdx];
    state.refinePts[state.selIdx] = clampPt({ x: p.x + dx, y: p.y + dy }, state.imgW, state.imgH);
  } else if (state.selKind === 'ball') {
    const cur = picker.list()[state.selIdx];
    picker.move(
      state.selIdx,
      clampPt({ x: cur.x + dx, y: cur.y + dy }, state.imgW, state.imgH),
    );
    if (state.pocketIdx >= 0) recompute();
    else state.result = null;
  } else {
    return;
  }
  render();
}

function homography() {
  if (!calibrator.valid(state.imgW, state.imgH, spec())) return null;
  try {
    const src = calibrator.points.map((p) => [p.x, p.y]);
    const dst = worldCorners(spec()).map((p) => [p.x, p.y]);
    if (state.refinePts && state.refinePts.length === 6) {
      src.push(...state.refinePts.map((p) => [p.x, p.y]));
      dst.push(...pocketWorldPoints(spec()).map((p) => [p.x, p.y]));
    }
    const iw = computeHomography(src, dst);
    return { iw, wi: invert3(iw) };
  } catch {
    return null;
  }
}

const makeWorldOf = (H) => (p) => {
  const [x, y] = applyH(H.iw, p.x, p.y);
  return { x, y };
};
const makeImageOf = (H) => (q) => {
  const [x, y] = applyH(H.wi, q.x, q.y);
  return { x, y };
};

function recompute() {
  state.result = null;
  const H = homography();
  if (!H || state.pocketIdx < 0 || !picker.cue || !picker.target) return;
  const pw = pocketWorldPoints(spec())[state.pocketIdx];
  const f = makeWorldOf(H);
  try {
    state.result = computeAim({
      cue: f(picker.cue),
      target: f(picker.target),
      pocket: pw,
      ballRadius: spec().ballD / 2,
    });
  } catch {
    state.result = null;
  }
  updatePanel(pw);
}

function updatePanel(pw) {
  const r = state.result;
  if (!r) {
    els.panel.hidden = true;
    return;
  }
  els.panel.hidden = false;
  els.vCut.textContent = r.cutDeg.toFixed(1) + '°';
  els.vOverlap.textContent = Math.round(r.overlap * 100) + '%';
  els.vStyle.textContent = overlapLabel(r.overlap, r.cutDeg);
  els.vDiff.textContent = r.feasible ? difficultyLabel(r.cutDeg) : '—';
  els.vCueT.textContent = (r.cueTravel / 1000).toFixed(2) + ' m';
  els.vTargetT.textContent = (r.targetTravel / 1000).toFixed(2) + ' m';
  els.vPocket.textContent = pw ? pw.name : '—';
  els.warn.hidden = r.feasible;
  els.warn.textContent = r.feasible ? '' : '⚠ ' + r.reason;
  drawCutFigure();
}

function drawCutFigure() {
  if (els.panel.hidden || els.cutFig.hidden || !state.result) return;
  drawCutDiagram(els.cutCv, state.result, state.divisions);
}

function syncUI() {
  const m = state.mode;
  els.hint.textContent = HINTS[m] || '';
  els.hint.classList.toggle('warn', false);
  els.demoBtn.hidden = m !== 'empty';
  els.shotInput.parentElement.hidden = m !== 'empty';
  els.fileInput.parentElement.hidden = m !== 'empty';
  els.arBtn.hidden = m !== 'empty';
  els.arShotBtn.hidden = m !== 'ar';
  els.arCancelBtn.hidden = m !== 'ar';
  els.autoBtn.hidden = !(m === 'calibrate' || m === 'balls');
  els.calibDoneBtn.hidden = m !== 'calibrate';
  els.pocketBtn.hidden = m !== 'balls';
  els.refineBtn.hidden = m !== 'done';
  els.refineDoneBtn.hidden = m !== 'refine';
  els.rotBtn.hidden = !(m === 'balls' || m === 'pocket' || m === 'done');
  const nudging =
    state.selIdx >= 0 &&
    ((m === 'calibrate' && state.selKind === 'corner') ||
      (m === 'refine' && state.selKind === 'refine') ||
      ((m === 'balls' || m === 'pocket' || m === 'done') && state.selKind === 'ball'));
  for (const b of els.nudgeGroup.querySelectorAll('.nudgeBtn')) b.hidden = !nudging;
  els.nudgeLabel.hidden = !nudging;
  if (nudging) {
    els.nudgeLabel.textContent =
      state.selKind === 'ball'
        ? `微调 ${state.selIdx === 0 ? '母球' : '目标球'} · 长按连动`
        : `微调 ${state.selIdx + 1} 号点 · 长按连动`;
  }
  els.backCalibBtn.hidden = !(m === 'balls' || m === 'pocket' || m === 'done');
  els.backBallsBtn.hidden = !(m === 'pocket' || m === 'done');
  els.resetBtn.hidden = m === 'empty' || m === 'ar';
  els.stage.classList.toggle('empty', m === 'empty');
  els.stage.classList.toggle('ar-live', m === 'ar');
  if (m === 'ar') {
    const r = els.wrap.getBoundingClientRect();
    els.stage.style.width = Math.max(50, r.width - 4) + 'px';
    els.stage.style.height = Math.max(50, r.height - 40) + 'px';
  } else if (m === 'empty') {
    els.stage.style.width = '';
    els.stage.style.height = '';
  }
  for (const g of els.toolbar.querySelectorAll('.tgroup')) {
    g.hidden = ![...g.querySelectorAll('.btn')].some((b) => !b.hidden);
  }
}

function render() {
  const H = homography();
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, els.base.width, els.base.height);
  if (state.img) {
    bctx.setTransform(state.dpr * state.scale, 0, 0, state.dpr * state.scale, 0, 0);
    bctx.drawImage(state.img, 0, 0);
  }
  renderOverlay(octx, {
    state,
    calibrator,
    spec: spec(),
    scale: state.scale,
    dpr: state.dpr,
    cssW: state.cssW,
    cssH: state.cssH,
    homography: !!H,
    pocketsImg: H ? pocketsImg(H) : [],
    imageOf: H ? makeImageOf(H) : null,
    worldOf: H ? makeWorldOf(H) : null,
    pocketWorld:
      state.pocketIdx >= 0 ? pocketWorldPoints(spec())[state.pocketIdx] : null,
    result: state.result,
    refine:
      state.mode === 'refine' && state.refinePts
        ? { pts: state.refinePts, residuals: refineResiduals() }
        : null,
  });
}

function pocketsImg(H) {
  const f = makeImageOf(H);
  return pocketWorldPoints(spec()).map((p) => f(p));
}

function refineResiduals() {
  const H = homography();
  if (!H || !state.refinePts) return null;
  const f = makeWorldOf(H);
  const wp = pocketWorldPoints(spec());
  return state.refinePts.map((p, i) => {
    const w = f(p);
    return Math.hypot(w.x - wp[i].x, w.y - wp[i].y);
  });
}

function enterRefine() {
  const H = homography();
  if (!H) {
    toast('标定无效，无法精化袋口');
    return;
  }
  state.refinePts = pocketsImg(H).map((p) => ({ ...p }));
  state.selIdx = -1;
  state.selKind = null;
  state.mode = 'refine';
  syncUI();
  layout();
}

function exitRefine() {
  const res = refineResiduals();
  state.mode = 'done';
  recompute();
  syncUI();
  layout();
  if (res) {
    const avg = res.reduce((a, b) => a + b, 0) / res.length;
    toast(`精化完成：平均残差 ${avg.toFixed(0)}mm，最大 ${Math.max(...res).toFixed(0)}mm`);
  }
}

function autoRefine() {
  const H = homography();
  if (!H || !state.img) return null;
  const pred = pocketsImg(H);
  const det = detectPockets(state.img, pred, pred.map((p) => ballRadiusAt(p)));
  if (!det.ok) return null;
  state.refinePts = det.pts;
  const res = refineResiduals();
  const avg = res ? res.reduce((a, b) => a + b, 0) / res.length : Infinity;
  const mx = res ? Math.max(...res) : Infinity;
  if (avg > 45 || mx > 90) {
    state.refinePts = null;
    return null;
  }
  return { avg, max: mx };
}

let availHCache = 0;

function layout() {
  if (!state.img) return;
  els.wrap.style.flexShrink = '0';
  const availW = Math.max(els.wrap.clientWidth - 4, 50);
  if (els.panel.hidden || !availHCache) availHCache = els.wrap.clientHeight;
  const availH = Math.max(availHCache - els.hint.offsetHeight - 8, 110);
  const s = Math.min(availW / state.imgW, availH / state.imgH);
  state.scale = s;
  state.dpr = Math.min(window.devicePixelRatio || 1, 3);
  state.cssW = state.imgW * s;
  state.cssH = state.imgH * s;
  els.stage.style.width = state.cssW + 'px';
  els.stage.style.height = state.cssH + 'px';
  for (const cv of [els.base, els.overlayCv]) {
    cv.style.width = state.cssW + 'px';
    cv.style.height = state.cssH + 'px';
    cv.width = Math.max(1, Math.round(state.cssW * state.dpr));
    cv.height = Math.max(1, Math.round(state.cssH * state.dpr));
  }
  render();
}

function startCalibration() {
  state.mode = 'calibrate';
  state.pocketIdx = -1;
  state.result = null;
  state.refinePts = null;
  state.rotated = false;
  state.selIdx = -1;
  state.selKind = null;
  calibrator.preset(state.imgW, state.imgH);
  picker.preset(state.imgW, state.imgH);
  updatePanel(null);
  syncUI();
  render();
}

async function loadImage(file) {
  let src;
  let w;
  let h;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    src = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    src = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  applyImage(src, w, h);
}

function applyImage(src, w, h) {
  if (Math.max(w, h) > 2048) {
    const k = 2048 / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    src = c;
    w = c.width;
    h = c.height;
  }
  state.img = src;
  state.imgW = w;
  state.imgH = h;
  state.detBalls = null;
  state.snapTo = null;
  startCalibration();
  layout();
}

async function autoDetect() {
  if (!state.img) return null;
  const snap = snapshotCanvas(state.img);
  const k = state.imgW / snap.width;
  const t = await detectTable(snap);
  const corners = t.corners.map((p) => ({ x: p.x * k, y: p.y * k }));
  calibrator.points = corners;
  state.rotated = detectOrientation();
  let det = null;
  try {
    det = await detectBalls(snap, spec(), t.corners);
    if (det.cue) picker.cue = { x: det.cue.x * k, y: det.cue.y * k };
    if (det.targets.length) {
      picker.target = { x: det.targets[0].x * k, y: det.targets[0].y * k };
    }
    state.detBalls = [...(det.cue ? [det.cue] : []), ...det.targets].map((p) => ({
      x: p.x * k,
      y: p.y * k,
    }));
  } catch {
    det = null;
    state.detBalls = null;
  }
  state.result = null;
  recompute();
  render();
  return { corners, det };
}

function getImgPos(e) {
  const rect = els.overlayCv.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / state.scale,
    y: (e.clientY - rect.top) / state.scale,
  };
}

function showLoupe(e, p) {
  const rect = els.stage.getBoundingClientRect();
  const size = 132;
  const gap = 20;
  const fx = e.clientX - rect.left;
  const fy = e.clientY - rect.top;
  const below = fy < rect.height / 2;
  let left = fx - size / 2;
  let top = below ? fy + gap : fy - size - gap;
  left = Math.min(Math.max(left, 4), Math.max(4, rect.width - size - 4));
  top = Math.min(Math.max(top, 4), Math.max(4, rect.height - size - 4));
  els.loupe.style.left = left + 'px';
  els.loupe.style.top = top + 'px';
  magnifier.draw(state.img, p, state.scale, 2);
  els.loupe.classList.add('on');
}

function hideLoupe() {
  els.loupe.classList.remove('on');
}

let drag = null;
const HIT_R_CSS = 22;

function ballRadiusAt(p) {
  const H = homography();
  if (!H) return Math.max(10, HIT_R_CSS / state.scale);
  const w = makeWorldOf(H)(p);
  const q1 = makeImageOf(H)({ x: w.x - spec().ballD / 2, y: w.y });
  const q2 = makeImageOf(H)({ x: w.x + spec().ballD / 2, y: w.y });
  return Math.max(6, Math.hypot(q2.x - q1.x, q2.y - q1.y) / 2);
}

function snapRadiusAt(p) {
  return Math.max(ballRadiusAt(p) * 1.6, HIT_R_CSS / state.scale);
}

function updateSnapPreview(p) {
  state.snapTo = null;
  const snapR = snapRadiusAt(p);
  let bd = snapR * snapR;
  for (const c of state.detBalls || []) {
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      state.snapTo = c;
    }
  }
}

async function snapBall(idx, p) {
  let q = state.snapTo;
  state.snapTo = null;
  if (!q) {
    try {
      const hit = await refineBallCenter(state.img, p, ballRadiusAt(p));
      if (hit && Math.hypot(hit.x - p.x, hit.y - p.y) <= snapRadiusAt(p)) q = hit;
    } catch {
      q = null;
    }
  }
  if (q) {
    picker.move(idx, q);
    if (state.pocketIdx >= 0) recompute();
    toast('🧲 已吸附到球心');
  }
  render();
}

function nearestPocket(p) {
  const H = homography();
  if (!H) return -1;
  const pts = pocketsImg(H);
  let best = -1;
  let bd = ((HIT_R_CSS + 8) / state.scale) ** 2;
  pts.forEach((q, i) => {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

els.overlayCv.addEventListener('pointerdown', (e) => {
  if (!state.img) return;
  const p = getImgPos(e);
  const rImg = HIT_R_CSS / state.scale;
  if (state.mode === 'refine') {
    const i = pickHandle(state.refinePts || [], p, rImg);
    if (i >= 0) {
      drag = { kind: 'refine', idx: i };
      state.selIdx = i;
      state.selKind = 'refine';
      syncUI();
    } else {
      state.selIdx = -1;
      state.selKind = null;
      syncUI();
    }
  } else if (state.mode === 'calibrate') {
    const i = calibrator.hit(p, rImg);
    if (i >= 0) {
      drag = { kind: 'corner', idx: i };
      state.selIdx = i;
      state.selKind = 'corner';
      syncUI();
    } else {
      state.selIdx = -1;
      state.selKind = null;
      syncUI();
    }
  } else if (state.mode === 'balls' || state.mode === 'pocket' || state.mode === 'done') {
    const i = picker.hit(p, rImg);
    if (i >= 0) {
      drag = { kind: 'ball', idx: i };
      state.selIdx = i;
      state.selKind = 'ball';
      syncUI();
    } else {
      state.selIdx = -1;
      state.selKind = null;
      syncUI();
      if (state.mode === 'pocket' || state.mode === 'done') {
        const pk = nearestPocket(p);
        if (pk >= 0) {
          state.pocketIdx = pk;
          state.mode = 'done';
          recompute();
          syncUI();
          render();
        }
      }
    }
  }
  if (drag) {
    els.overlayCv.setPointerCapture(e.pointerId);
    showLoupe(
      e,
      drag.kind === 'corner'
        ? calibrator.points[drag.idx]
        : drag.kind === 'refine'
          ? state.refinePts[drag.idx]
          : picker.list()[drag.idx],
    );
  }
});

els.overlayCv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const raw = getImgPos(e);
  const np = clampPt(raw, state.imgW, state.imgH);
  if (drag.kind === 'corner') {
    calibrator.move(drag.idx, np);
    state.result = null;
  } else if (drag.kind === 'refine') {
    state.refinePts[drag.idx] = np;
  } else {
    picker.move(drag.idx, np);
    updateSnapPreview(np);
    if (state.pocketIdx >= 0) recompute();
  }
  showLoupe(e, np);
  render();
});

const endDrag = () => {
  if (drag && drag.kind === 'ball') {
    const { idx } = drag;
    const p = picker.list()[idx];
    drag = null;
    hideLoupe();
    snapBall(idx, p);
    return;
  }
  drag = null;
  hideLoupe();
};
const cancelDrag = () => {
  state.snapTo = null;
  drag = null;
  hideLoupe();
};
els.overlayCv.addEventListener('pointerup', endDrag);
els.overlayCv.addEventListener('pointercancel', cancelDrag);

let hintTimer = null;
function toast(msg) {
  els.hint.textContent = msg;
  els.hint.classList.toggle('warn', true);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    els.hint.textContent = HINTS[state.mode];
    els.hint.classList.toggle('warn', false);
  }, 2600);
}

els.calibDoneBtn.addEventListener('click', () => {
  state.rotated = detectOrientation();
  let iss = calibrator.issues(state.imgW, state.imgH, spec());
  if (iss.length) {
    const keep = state.rotated;
    state.rotated = !keep;
    const iss2 = calibrator.issues(state.imgW, state.imgH, spec());
    if (iss2.length < iss.length) {
      iss = iss2;
    } else {
      state.rotated = keep;
    }
  }
  if (iss.length) {
    toast('标定无效：' + iss[0]);
    return;
  }
  const ar = autoRefine();
  state.mode = 'balls';
  syncUI();
  layout();
  if (ar) toast(`已自动精化袋口：平均残差 ${ar.avg.toFixed(0)}mm`);
});
els.pocketBtn.addEventListener('click', () => {
  state.mode = 'pocket';
  syncUI();
  render();
});
els.refineBtn.addEventListener('click', () => {
  enterRefine();
});
els.refineDoneBtn.addEventListener('click', () => {
  exitRefine();
});

const ROT_LABEL = {
  on: '已切换为竖拍方向：中袋在左右两侧',
  off: '已切换为横拍方向：中袋在上下两侧',
};
els.rotBtn.addEventListener('click', () => {
  state.rotated = !state.rotated;
  state.refinePts = null;
  if (state.mode === 'refine') state.mode = 'done';
  if (state.pocketIdx >= 0) {
    const map = state.rotated ? ROT_MAP.d2r : ROT_MAP.r2d;
    state.pocketIdx = map[state.pocketIdx] ?? -1;
  }
  state.result = null;
  updatePanel(null);
  recompute();
  syncUI();
  render();
  toast(state.rotated ? ROT_LABEL.on : ROT_LABEL.off);
});

let nudgeTimer = null;
let nudgeRepeat = null;
const clearNudgeTimers = () => {
  clearTimeout(nudgeTimer);
  clearInterval(nudgeRepeat);
  nudgeTimer = null;
  nudgeRepeat = null;
};
for (const b of els.nudgeGroup.querySelectorAll('.nudgeBtn')) {
  const dir = b.dataset.dir;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    nudge(dir);
    clearNudgeTimers();
    nudgeTimer = setTimeout(() => {
      nudgeRepeat = setInterval(() => nudge(dir), 70);
    }, 320);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    b.addEventListener(ev, clearNudgeTimers);
  }
}
els.backCalibBtn.addEventListener('click', () => {
  state.mode = 'calibrate';
  state.result = null;
  state.refinePts = null;
  updatePanel(null);
  syncUI();
  layout();
});
els.backBallsBtn.addEventListener('click', () => {
  state.mode = 'balls';
  syncUI();
  render();
});
els.resetBtn.addEventListener('click', () => {
  stopAR();
  state.img = null;
  state.mode = 'empty';
  state.pocketIdx = -1;
  state.result = null;
  state.refinePts = null;
  state.rotated = false;
  state.selIdx = -1;
  state.selKind = null;
  state.detBalls = null;
  state.snapTo = null;
  els.wrap.style.flexShrink = '';
  els.shotInput.value = '';
  els.fileInput.value = '';
  updatePanel(null);
  syncUI();
  render();
});
els.specSel.addEventListener('change', () => {
  state.specKey = els.specSel.value;
  state.refinePts = null;
  if (state.mode !== 'empty') {
    if (state.mode === 'refine') state.mode = 'done';
    recompute();
    syncUI();
    render();
  }
});
els.shotInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});
els.fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});
els.demoBtn.addEventListener('click', () => runDemo(false));

let autoBusy = false;
els.autoBtn.addEventListener('click', async () => {
  if (autoBusy) return;
  autoBusy = true;
  els.autoBtn.disabled = true;
  const label = els.autoBtn.textContent;
  const engineReady = window.cv && typeof window.cv.Mat === 'function';
  if (!engineReady) {
    els.autoBtn.textContent = '⏳ 引擎加载中…';
    toast('识别引擎首次加载中（约几秒到十几秒），请稍候');
  } else {
    els.autoBtn.textContent = '⏳ 识别中…';
  }
  try {
    const r = await autoDetect();
    state.mode = 'calibrate';
    state.refinePts = null;
    syncUI();
    layout();
    if (!r || !r.corners) toast('自动识别失败，请手动拖动绿点');
    else if (!r.det || !r.det.cue) toast('台面已自动识别，可拖动绿点微调，再点「完成标定」');
    else toast(`已识别台面、白球和 ${r.det.targets.length} 个候选球，可拖动绿点微调后再点「完成标定」`);
  } catch (e) {
    state.mode = 'calibrate';
    state.refinePts = null;
    syncUI();
    toast('自动识别失败：' + (e && e.message ? e.message : '未知错误') + '，请手动拖动绿点');
  } finally {
    els.autoBtn.disabled = false;
    els.autoBtn.textContent = label;
    autoBusy = false;
  }
});

let arStream = null;

async function startAR() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('当前环境不支持摄像头（需 HTTPS）');
    return;
  }
  try {
    arStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    els.arVideo.srcObject = arStream;
    await els.arVideo.play().catch(() => {});
    state.mode = 'ar';
    syncUI();
  } catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? '权限被拒绝' : (e && e.message) || '未知错误';
    toast('无法打开摄像头：' + msg);
  }
}

function stopAR() {
  if (arStream) {
    arStream.getTracks().forEach((t) => t.stop());
    arStream = null;
  }
  els.arVideo.srcObject = null;
}

function captureAR() {
  const v = els.arVideo;
  if (!v.videoWidth) {
    toast('相机尚未就绪，请稍候');
    return;
  }
  const k = Math.min(1, 2048 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k);
  c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  stopAR();
  applyImage(c, c.width, c.height);
  autoDetect()
    .then(() => {
      state.mode = 'balls';
      syncUI();
      layout();
      toast('已定格并自动标定，可微调球位后选袋口');
    })
    .catch(() => toast('已定格，请手动拖动绿点完成标定'));
}

function cancelAR() {
  stopAR();
  state.mode = 'empty';
  syncUI();
}

els.arBtn.addEventListener('click', startAR);
els.arShotBtn.addEventListener('click', captureAR);
els.arCancelBtn.addEventListener('click', cancelAR);

els.figToggle.addEventListener('click', () => {
  const show = els.cutFig.hidden;
  els.cutFig.hidden = !show;
  els.figToggle.textContent = show ? '▴ 收起重合法示意' : '▾ 展开重合法示意';
  if (show) requestAnimationFrame(drawCutFigure);
});

els.divSel.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-v]');
  if (!btn) return;
  state.divisions = Number(btn.dataset.v) || 0;
  for (const b of els.divSel.querySelectorAll('button')) {
    b.classList.toggle('on', b === btn);
  }
  drawCutFigure();
});

async function runDemo(auto) {
  els.demoBtn.disabled = true;
  try {
    const scene = await buildDemoFile(state.specKey);
    await loadImage(scene.file);
    calibrator.points = scene.corners.map((p) => ({ ...p }));
    picker.cue = { ...scene.cue };
    picker.target = { ...scene.target };
    state.pocketIdx = scene.pocketIdx;
    state.mode = 'done';
    const ar = autoRefine();
    if (ar) console.log(`[demo] auto-refine avg=${ar.avg.toFixed(1)}mm max=${ar.max.toFixed(1)}mm`);
    recompute();
    layout();
    syncUI();
    render();
    if (auto) {
      const line = `[demo] 期望 θ=${scene.expected.cutDeg.toFixed(3)}° overlap=${scene.expected.overlap.toFixed(3)} | 实得 θ=${state.result ? state.result.cutDeg.toFixed(3) : 'N/A'}° overlap=${state.result ? state.result.overlap.toFixed(3) : 'N/A'}`;
      console.log(line);
      window.__demoCheck = {
        expectedCut: scene.expected.cutDeg,
        gotCut: state.result ? state.result.cutDeg : null,
        pass:
          state.result &&
          Math.abs(state.result.cutDeg - scene.expected.cutDeg) < 0.5 &&
          Math.abs(state.result.overlap - scene.expected.overlap) < 0.02,
      };
      console.log('[demo] pass =', window.__demoCheck.pass);
    }
  } finally {
    els.demoBtn.disabled = false;
  }
}

window.__billiards = { state, calibrator, picker };
window.__autoDetect = autoDetect;
window.__vision = { detectTable, detectBalls, snapshotCanvas, detectPockets };

new ResizeObserver(() => {
  if (state.img) layout();
}).observe(els.wrap);

window.addEventListener('resize', () => {
  if (!state.img) return;
  if (els.panel.hidden) availHCache = 0;
  layout();
});

new ResizeObserver(() => {
  drawCutFigure();
}).observe(els.cutCv);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadCtrl = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCtrl || reloading) return;
    reloading = true;
    location.reload();
  });
}

const idleLoad = window.requestIdleCallback || ((f) => setTimeout(f, 300));
idleLoad(() => {
  loadOpenCV().catch(() => {});
});

if (new URLSearchParams(location.search).get('demo')) {
  runDemo(true);
} else {
  syncUI();
  render();
}
