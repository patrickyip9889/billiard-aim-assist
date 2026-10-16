const CV_URL = './vendor/opencv.js';
const CV_FALLBACK_BYTES = 10964323;
const STALL_MS = 15000;
const MAX_ATTEMPTS = 3;
const INIT_TIMEOUT_MS = 30000;

let loadPromise = null;
let progressCb = null;

function readyCv() {
  const cv = window.cv;
  if (typeof cv.then === 'function') {
    try {
      delete cv.then;
    } catch {
      cv.then = undefined;
    }
  }
  return cv;
}

function emitProgress(p, msg) {
  if (progressCb) progressCb(p, msg);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadEngine(signal) {
  const res = await fetch(CV_URL, { signal });
  if (!res.ok) throw new Error('脚本请求失败 HTTP ' + res.status);
  const total =
    Number(res.headers.get('X-Original-Length')) ||
    Number(res.headers.get('Content-Length')) ||
    CV_FALLBACK_BYTES;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    emitProgress(0.9, '');
    return new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    let timer;
    const stall = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('下载停滞超过 ' + Math.round(STALL_MS / 1000) + ' 秒')), STALL_MS);
    });
    let chunk;
    try {
      chunk = await Promise.race([reader.read(), stall]);
    } finally {
      clearTimeout(timer);
    }
    if (chunk.done) break;
    chunks.push(chunk.value);
    received += chunk.value.length;
    if (total > 0) emitProgress(Math.min((received / total) * 0.9, 0.9), '');
    else emitProgress(-1, (received / 1048576).toFixed(1) + ' MB');
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function execEngine(bytes) {
  return new Promise((resolve, reject) => {
    let url = '';
    let s = null;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (s) s.remove();
      if (url) URL.revokeObjectURL(url);
      reject(err);
    };
    try {
      window.Module = Object.assign(window.Module || {}, {
        locateFile: (p) => './vendor/' + p,
      });
      url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
      s = document.createElement('script');
      s.async = true;
      s.onerror = () => fail(new Error('脚本执行失败'));
      s.onload = () => {
        const t0 = Date.now();
        const poll = () => {
          if (settled) return;
          if (window.cv && typeof window.cv.Mat === 'function') {
            settled = true;
            s.remove();
            URL.revokeObjectURL(url);
            resolve();
          } else if (Date.now() - t0 > INIT_TIMEOUT_MS) {
            fail(new Error('初始化超时'));
          } else {
            setTimeout(poll, 120);
          }
        };
        poll();
      };
      s.src = url;
      document.head.appendChild(s);
    } catch (e) {
      fail(e);
    }
  });
}

export function loadOpenCV(onProgress) {
  if (onProgress) progressCb = onProgress;
  if (window.cv && typeof window.cv.Mat === 'function') {
    emitProgress(1, '');
    return Promise.resolve(readyCv());
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        emitProgress(0, attempt > 1 ? '自动重试 ' + attempt + '/' + MAX_ATTEMPTS : '');
        const bytes = await downloadEngine(ac ? ac.signal : undefined);
        emitProgress(0.92, '解压并初始化…');
        await execEngine(bytes);
        emitProgress(1, '');
        return readyCv();
      } catch (e) {
        lastErr = e;
        if (ac) {
          try {
            ac.abort();
          } catch {}
        }
        if (attempt < MAX_ATTEMPTS) await delay(400 * attempt);
      }
    }
    loadPromise = null;
    throw lastErr || new Error('引擎加载失败');
  })();
  return loadPromise;
}

export function snapshotCanvas(source, maxSide = 640) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

const HSV_STAGES = [
  { lo: [25, 40, 15], hi: [98, 255, 255] },
  { lo: [18, 22, 8], hi: [98, 255, 255] },
];

export async function detectTable(canvas) {
  const cv = await loadOpenCV();
  const src = cv.imread(canvas);
  const hsv = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  let result = null;
  try {
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    for (let stage = 0; stage < HSV_STAGES.length && !result; stage++) {
      const cfg = HSV_STAGES[stage];
      const lo = new cv.Mat(src.rows, src.cols, cv.CV_8UC3, [...cfg.lo, 0]);
      const hi = new cv.Mat(src.rows, src.cols, cv.CV_8UC3, [...cfg.hi, 255]);
      const mask = new cv.Mat();
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      try {
        cv.inRange(hsv, lo, hi, mask);
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
        cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let best = -1;
        let bestA = 0;
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const a = cv.contourArea(c);
          c.delete();
          if (a > bestA) {
            bestA = a;
            best = i;
          }
        }
        const fill = bestA / (src.rows * src.cols);
        if (best >= 0 && fill >= 0.1) {
          const bc = contours.get(best);
          result = { corners: contourToQuad(cv, bc), fill, adapted: stage > 0 };
          bc.delete();
        }
      } finally {
        lo.delete();
        hi.delete();
        mask.delete();
        contours.delete();
        hierarchy.delete();
      }
    }
  } finally {
    src.delete();
    hsv.delete();
    kernel.delete();
  }
  if (!result) {
    throw new Error('未找到绿色台面');
  }
  return result;
}

export async function detectBalls(canvas, spec, corners) {
  const cv = await loadOpenCV();
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const hsv = new cv.Mat();
  const mask = new cv.Mat(src.rows, src.cols, cv.CV_8UC1, new cv.Scalar(0));
  const quad = cv.matFromArray(
    4,
    1,
    cv.CV_32SC2,
    corners.flatMap((p) => [Math.round(p.x), Math.round(p.y)])
  );
  const polys = new cv.MatVector();
  const circles = new cv.Mat();
  polys.push_back(quad);
  cv.fillPoly(mask, polys, new cv.Scalar(255));
  const wTop = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const wBot = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
  const r = Math.max(6, (((wTop + wBot) / 2) * (spec.ballD / spec.tableL)) / 2);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const pad = Math.ceil(r * 2);
    const ox = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - pad);
    const oy = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - pad);
    const rw = Math.min(gray.cols, Math.ceil(Math.max(...corners.map((p) => p.x))) + pad) - ox;
    const rh = Math.min(gray.rows, Math.ceil(Math.max(...corners.map((p) => p.y))) + pad) - oy;
    const roi = gray.roi(new cv.Rect(ox, oy, Math.max(1, rw), Math.max(1, rh)));
    try {
      cv.HoughCircles(roi, circles, cv.HOUGH_GRADIENT, 1, r * 2.4, 70, 15, r * 0.55, r * 1.6);
    } finally {
      roi.delete();
    }
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const found = [];
    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3] + ox;
      const y = circles.data32F[i * 3 + 1] + oy;
      const cr = circles.data32F[i * 3 + 2];
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= mask.cols || yi >= mask.rows) continue;
      if (mask.ucharPtr(yi, xi)[0] === 0) continue;
      const m = meanSV(hsv, x, y, cr * 0.55);
      found.push({ x, y, r: cr, s: m.s, v: m.v, score: m.v - m.s });
    }
    let cue = null;
    let rest = found;
    const whites = found.filter((b) => b.score > 150 && b.v > 160).sort((a, b) => b.score - a.score);
    if (whites.length) {
      cue = { x: whites[0].x, y: whites[0].y, r: whites[0].r };
      rest = found.filter((b) => b !== whites[0]);
    }
    const ref = cue || { x: src.cols / 2, y: src.rows / 2 };
    rest.sort((a, b) => dist(a, ref) - dist(b, ref));
    return {
      cue,
      targets: rest.map((b) => ({ x: b.x, y: b.y, r: b.r })),
      radius: r,
      total: found.length,
    };
  } finally {
    src.delete();
    gray.delete();
    hsv.delete();
    mask.delete();
    quad.delete();
    polys.delete();
    circles.delete();
  }
}

export async function refineBallCenter(source, p, radius) {
  const cv = await loadOpenCV();
  const src = cv.imread(source);
  const gray = new cv.Mat();
  const circles = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    const pad = Math.ceil(radius * 2.2);
    const ox = Math.max(0, Math.floor(p.x) - pad);
    const oy = Math.max(0, Math.floor(p.y) - pad);
    const rw = Math.min(src.cols - ox, pad * 2);
    const rh = Math.min(src.rows - oy, pad * 2);
    if (rw < radius || rh < radius) return null;
    const roi = gray.roi(new cv.Rect(ox, oy, Math.max(1, rw), Math.max(1, rh)));
    try {
      cv.HoughCircles(roi, circles, cv.HOUGH_GRADIENT, 1, radius * 0.9, 55, 15, radius * 0.5, radius * 1.6);
    } finally {
      roi.delete();
    }
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3] + ox;
      const y = circles.data32F[i * 3 + 1] + oy;
      const cr = circles.data32F[i * 3 + 2];
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y, r: cr };
      }
    }
    return best;
  } finally {
    src.delete();
    gray.delete();
    circles.delete();
  }
}

export function detectPockets(source, predictPts, ballR) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const snap = snapshotCanvas(source, 640);
  const k = snap.width / w;
  const W = snap.width;
  const Hh = snap.height;
  const g = snap.getContext('2d').getImageData(0, 0, W, Hh).data;
  const pts = [];
  let ok = true;
  for (let i = 0; i < predictPts.length; i++) {
    const br = ballR[i] * k;
    const sr = br * 2.6;
    const cx = predictPts[i].x * k;
    const cy = predictPts[i].y * k;
    const x0 = Math.max(0, Math.floor(cx - sr));
    const x1 = Math.min(W - 1, Math.ceil(cx + sr));
    const y0 = Math.max(0, Math.floor(cy - sr));
    const y1 = Math.min(Hh - 1, Math.ceil(cy + sr));
    const lums = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * W + x) * 4;
        lums.push(0.299 * g[o] + 0.587 * g[o + 1] + 0.114 * g[o + 2]);
      }
    }
    let p = null;
    if (lums.length >= 60) {
      const hist = new Array(256).fill(0);
      for (const l of lums) hist[Math.min(255, Math.max(0, l | 0))]++;
      const total = lums.length;
      let sumAll = 0;
      for (let t = 0; t < 256; t++) sumAll += t * hist[t];
      let wB = 0;
      let sumB = 0;
      let bestV = -1;
      let thr = 0;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const v = wB * wF * (mB - mF) * (mB - mF);
        if (v > bestV) {
          bestV = v;
          thr = t;
        }
      }
      let sx = 0;
      let sy = 0;
      let sw = 0;
      let dark = 0;
      let idx = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const wgt = thr - lums[idx++];
          if (wgt > 0) {
            dark++;
            sx += wgt * x;
            sy += wgt * y;
            sw += wgt;
          }
        }
      }
      if (sw > 0 && dark >= Math.max(8, 0.35 * Math.PI * br * br)) {
        p = { x: sx / sw / k, y: sy / sw / k };
        if (Math.hypot(p.x - predictPts[i].x, p.y - predictPts[i].y) > ballR[i] * 2.2) p = null;
      }
    }
    if (!p) ok = false;
    pts.push(p);
  }
  return { pts, ok };
}

function contourToQuad(cv, contour) {
  const peri = cv.arcLength(contour, true);
  const approx = new cv.Mat();
  let pts = null;
  try {
    for (const eps of [0.02, 0.035, 0.05, 0.08]) {
      cv.approxPolyDP(contour, approx, eps * peri, true);
      if (approx.rows === 4) break;
    }
    if (approx.rows === 4) {
      pts = [];
      for (let i = 0; i < 4; i++) {
        pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
      }
    } else {
      pts = rectCorners(cv.minAreaRect(contour));
    }
  } finally {
    approx.delete();
  }
  return orderQuad(pts);
}

function rectCorners(rect) {
  const a = (rect.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hx = rect.size.width / 2;
  const hy = rect.size.height / 2;
  return [
    { x: rect.center.x + hx * c - hy * s, y: rect.center.y + hx * s + hy * c },
    { x: rect.center.x - hx * c - hy * s, y: rect.center.y - hx * s + hy * c },
    { x: rect.center.x - hx * c + hy * s, y: rect.center.y - hx * s - hy * c },
    { x: rect.center.x + hx * c + hy * s, y: rect.center.y + hx * s - hy * c },
  ];
}

function orderQuad(pts) {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

function meanSV(hsv, cx, cy, r) {
  const x0 = Math.max(0, Math.round(cx - r));
  const x1 = Math.min(hsv.cols - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r));
  const y1 = Math.min(hsv.rows - 1, Math.round(cy + r));
  let s = 0;
  let v = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const row = hsv.ucharPtr(y);
    for (let x = x0; x <= x1; x++) {
      s += row[x * 3 + 1];
      v += row[x * 3 + 2];
      n++;
    }
  }
  return { s: n ? s / n : 255, v: n ? v / n : 0 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
