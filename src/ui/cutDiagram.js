const RAD = Math.PI / 180;

const COL = {
  cueFill: 'rgba(242,240,232,.42)',
  cueRim: 'rgba(242,240,232,.92)',
  objHi: '#e2635f',
  objLo: '#b23a3a',
  rim: 'rgba(255,255,255,.35)',
  bound: '#f2f5f8',
  d1: '#4dd0e1',
  d2: '#ffd54a',
  label: '#9aa4af',
  chipBg: 'rgba(13,17,23,.9)',
  warn: '#ff5252',
};

export function drawCutDiagram(cv, result, divisions = 0) {
  const cssW = cv.clientWidth;
  const cssH = cv.clientHeight;
  if (!cssW || !cssH) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(cssW * dpr);
  const H = Math.round(cssH * dpr);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!result || !result.ghost) return;
  const th = Math.min(Math.max(result.cutDeg, 0), 90);
  if (!Number.isFinite(th)) return;
  const ok = !!result.feasible;

  const sinT = Math.sin(th * RAD);
  const topPad = 30;
  const R = Math.max(8, Math.min((cssH - topPad - 62) / 2, (cssW - 18) / (2 + 2 * sinT)));
  const spanW = 2 * R * (1 + sinT);
  const left = (cssW - spanW) / 2;
  const cy = topPad + R;
  const Cx = left + R;
  const Tx = Cx + 2 * R * sinT;
  const xv = Cx + R;
  const yTop = 24;
  const yBot = cy + R + 8;

  const grad = ctx.createRadialGradient(Tx - R * 0.35, cy - R * 0.35, R * 0.15, Tx, cy, R);
  grad.addColorStop(0, COL.objHi);
  grad.addColorStop(1, COL.objLo);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(Tx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COL.rim;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COL.cueFill;
  ctx.beginPath();
  ctx.arc(Cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COL.cueRim;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (divisions >= 2) {
    const gx1 = Tx - R;
    const gx2 = Tx + R;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx1, cy);
    ctx.lineTo(gx2, cy);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.62)';
    const th2 = Math.max(5, R * 0.16);
    ctx.beginPath();
    for (let i = 0; i <= divisions; i++) {
      const x = gx1 + ((gx2 - gx1) * i) / divisions;
      const h = i === 0 || i === divisions ? th2 * 1.5 : th2;
      ctx.moveTo(x, cy - h);
      ctx.lineTo(x, cy + h);
    }
    ctx.stroke();
  }

  const cr = Math.max(2.2, R * 0.055);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(Tx, cy, cr, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.stroke();

  const ch = Math.max(2.5, R * 0.06);
  ctx.strokeStyle = 'rgba(255,209,102,.95)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(Cx - ch, cy);
  ctx.lineTo(Cx + ch, cy);
  ctx.moveTo(Cx, cy - ch);
  ctx.lineTo(Cx, cy + ch);
  ctx.stroke();

  ctx.strokeStyle = ok ? COL.bound : COL.warn;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(xv, yTop);
  ctx.lineTo(xv, yBot);
  ctx.stroke();

  const d1v = 2 * sinT;
  const d2v = 2 * (1 - sinT);

  const y1 = yBot + 16;
  const y2 = y1 + 15;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = COL.d1;
  ctx.setLineDash([4, 3]);
  measureLine(ctx, xv, y1, Tx + R, y1);
  ctx.strokeStyle = COL.d2;
  measureLine(ctx, Tx - R, y2, xv, y2);
  ctx.setLineDash([]);
  ctx.strokeStyle = COL.label;
  tick(ctx, Tx - R, y2);
  tick(ctx, xv, y1);
  tick(ctx, xv, y2);
  tick(ctx, Tx + R, y1);

  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const t1 = `d1 ${d1v.toFixed(2)}R`;
  const t2 = `d2 ${d2v.toFixed(2)}R`;
  ctx.fillStyle = COL.d1;
  ctx.textAlign = 'center';
  ctx.fillText(t1, clampTextX(ctx, (xv + Tx + R) / 2, t1, cssW), y1 - 9);
  ctx.fillStyle = COL.d2;
  ctx.fillText(t2, clampTextX(ctx, (Tx - R + xv) / 2, t2, cssW), y2 + 11);

  const label = (ok ? 'θ ' : '⚠ ') + th.toFixed(1) + '°';
  ctx.font = 'bold 11px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  const bx = Math.min(Math.max(xv - tw / 2 - 6, 4), cssW - tw - 16);
  ctx.fillStyle = COL.chipBg;
  ctx.strokeStyle = ok ? 'rgba(255,255,255,.28)' : COL.warn;
  ctx.lineWidth = 1;
  roundRect(ctx, bx, 5, tw + 12, 17, 8.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ok ? '#e6edf3' : COL.warn;
  ctx.textAlign = 'left';
  ctx.fillText(label, bx + 6, 14);
}

function measureLine(ctx, x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function tick(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.stroke();
}

function clampTextX(ctx, cx, text, cssW) {
  const w = ctx.measureText(text).width / 2;
  return Math.min(Math.max(cx, w + 3), cssW - w - 3);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
