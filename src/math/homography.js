import { solveLinearSystem } from './linalg.js';

function normalizationTransform(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let m = 0;
  for (const p of pts) m += Math.hypot(p[0] - cx, p[1] - cy);
  m /= n;
  if (m < 1e-12) throw new Error('degenerate points');
  const s = Math.SQRT2 / m;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function applyAffine(T, p) {
  return [T[0] * p[0] + T[1] * p[1] + T[2], T[3] * p[0] + T[4] * p[1] + T[5]];
}

export function mul3(A, B) {
  const R = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += A[r * 3 + k] * B[k * 3 + c];
      R[r * 3 + c] = v;
    }
  }
  return R;
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-300) throw new Error('singular homography');
  const inv = [
    e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

function refineGeometric(h0, S, D, iters) {
  const cost = (hh) => {
    let c = 0;
    for (let i = 0; i < S.length; i++) {
      const [u, v] = applyHN(hh, S[i][0], S[i][1]);
      c += (u - D[i][0]) ** 2 + (v - D[i][1]) ** 2;
    }
    return c;
  };
  let h = h0.slice();
  let best = cost(h);
  for (let it = 0; it < iters; it++) {
    const JtJ = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const Jtr = new Array(8).fill(0);
    for (let i = 0; i < S.length; i++) {
      const [x, y] = S[i];
      const w = h[6] * x + h[7] * y + 1;
      const u = (h[0] * x + h[1] * y + h[2]) / w;
      const v = (h[3] * x + h[4] * y + h[5]) / w;
      const J = [
        [x / w, y / w, 1 / w, 0, 0, 0, (-u * x) / w, (-u * y) / w],
        [0, 0, 0, x / w, y / w, 1 / w, (-v * x) / w, (-v * y) / w],
      ];
      const r = [u - D[i][0], v - D[i][1]];
      for (let a = 0; a < 8; a++) {
        for (let c = a; c < 8; c++) JtJ[a][c] += J[0][a] * J[0][c] + J[1][a] * J[1][c];
        Jtr[a] += J[0][a] * r[0] + J[1][a] * r[1];
      }
    }
    for (let a = 0; a < 8; a++) for (let c = 0; c < a; c++) JtJ[a][c] = JtJ[c][a];
    let delta;
    try {
      delta = solveLinearSystem(JtJ, Jtr.map((v) => -v));
    } catch {
      break;
    }
    const cand = h.map((v, i) => v + delta[i]);
    const cc = cost(cand);
    if (!(cc < best)) break;
    h = cand;
    best = cc;
  }
  return h;
}

function applyHN(h, x, y) {
  const w = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function computeHomography(src, dst) {
  if (src.length !== dst.length || src.length < 4) {
    throw new Error('need at least 4 point pairs');
  }
  const T1 = normalizationTransform(src);
  const T2 = normalizationTransform(dst);
  const S = src.map((p) => applyAffine(T1, p));
  const D = dst.map((p) => applyAffine(T2, p));
  const A = [];
  const b = [];
  for (let i = 0; i < S.length; i++) {
    const [x, y] = S[i];
    const [u, v] = D[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h0 = S.length === 4 ? solveLinearSystem(A, b) : solveNormalEquations(A, b);
  const h = S.length > 4 ? refineGeometric(h0, S, D, 5) : h0;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const H = mul3(invert3(T2), mul3(Hn, T1));
  const k = 1 / H[8];
  return H.map((v) => v * k);
}

function solveNormalEquations(A, b) {
  const m = A[0].length;
  const AtA = Array.from({ length: m }, () => new Array(m).fill(0));
  const Atb = new Array(m).fill(0);
  for (let r = 0; r < m; r++) {
    for (let c = r; c < m; c++) {
      let v = 0;
      for (const row of A) v += row[r] * row[c];
      AtA[r][c] = AtA[c][r] = v;
    }
    for (let i = 0; i < A.length; i++) Atb[r] += A[i][r] * b[i];
  }
  return solveLinearSystem(AtA, Atb);
}

export function reprojectionErrors(H, src, dst) {
  return src.map((p, i) => {
    const [ux, uy] = applyH(H, p[0], p[1]);
    return Math.hypot(ux - dst[i][0], uy - dst[i][1]);
  });
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-300) throw new Error('point at infinity');
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}
