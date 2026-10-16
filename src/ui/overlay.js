const COLORS = {
  corner: '#69f0ae',
  quad: 'rgba(105,240,174,.45)',
  aim: '#ffd54a',
  pocket: 'rgba(255,255,255,.65)',
  pocketSel: '#4dd0e1',
  snap: '#4dd0e1',
  warn: '#ff5252',
};

export function renderOverlay(ctx, env) {
  const { state, scale, dpr, cssW, cssH } = env;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!state.img) return;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  const env2 = {
    ...env,
    ctx,
    lw: (px) => px / scale,
    font: (px) => `${px / scale}px system-ui, sans-serif`,
    dash: (px) => [px / scale, (px * 0.8) / scale],
    cs: (px) => px / scale,
  };

  if (env.calibrator.points.length === 4) {
    drawQuad(env2);
  }
  if (env.refine) {
    drawRefineHandles(env2);
  } else if (env.homography && state.mode !== 'calibrate') {
    drawPockets(env2);
    drawBalls(env2);
    if (env.kick && env.imageOf) drawKickPath(env2);
  }
  if (state.mode === 'calibrate') drawCornerHandles(env2);
}

function drawQuad(env) {
  const { ctx, lw } = env;
  const pts = env.calibrator.points;
  ctx.lineWidth = lw(env.state.mode === 'calibrate' ? 2 : 1.2);
  ctx.strokeStyle = COLORS.quad;
  ctx.setLineDash(env.state.mode === 'calibrate' ? [] : env.dash(7));
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCornerHandles(env) {
  const { ctx, lw, font } = env;
  env.calibrator.points.forEach((p, i) => {
    const r = env.cs(17);
    if (env.state.selIdx === i) {
      ctx.lineWidth = env.lw(2);
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + env.cs(4.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = lw(2.5);
    ctx.strokeStyle = 'rgba(0,51,0,.8)';
    ctx.fillStyle = 'rgba(105,240,174,.4)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawCross(env, p, r * 0.5);
    ctx.font = font(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = env.lw(3);
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.fillStyle = '#fff';
    ctx.strokeText(String(i + 1), p.x, p.y + r + env.cs(3));
    ctx.fillText(String(i + 1), p.x, p.y + r + env.cs(3));
  });
}

function drawRefineHandles(env) {
  const { ctx, lw, font } = env;
  env.refine.pts.forEach((p, i) => {
    const res = env.refine.residuals ? env.refine.residuals[i] : null;
    const r = env.cs(14);
    if (env.state.selIdx === i) {
      ctx.lineWidth = env.lw(2);
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + env.cs(4.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = lw(2.5);
    ctx.strokeStyle = '#003300';
    ctx.fillStyle = 'rgba(77,208,225,.4)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawCross(env, p, r * 0.5);
    ctx.font = font(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = env.lw(3);
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.fillStyle = '#fff';
    ctx.strokeText(String(i + 1), p.x, p.y + r + env.cs(3));
    ctx.fillText(String(i + 1), p.x, p.y + r + env.cs(3));
    if (res != null) {
      const text = res < 10 ? `${res.toFixed(1)}mm` : `${Math.round(res)}mm`;
      const ly = p.y - r - env.cs(5);
      ctx.font = font(13);
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = env.lw(3);
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(text, p.x, ly);
      ctx.fillStyle = res <= 30 ? COLORS.corner : res <= 80 ? COLORS.aim : COLORS.warn;
      ctx.fillText(text, p.x, ly);
    }
  });
}

function ballHandleRadius(env, p) {
  const r = projectedRadius(env, env.imageOf, env.worldOf(p), env.spec.ballD / 2);
  return Math.max(r, 14 / env.scale);
}

function drawPockets(env) {
  const { ctx, state, lw, font } = env;
  env.pocketsImg.forEach((p, i) => {
    const sel = i === state.pocketIdx;
    const r = env.cs(14);
    ctx.lineWidth = lw(sel ? 3 : 2);
    ctx.strokeStyle = sel ? COLORS.pocketSel : COLORS.pocket;
    ctx.fillStyle = sel ? 'rgba(77,208,225,.35)' : 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = sel ? '#fff' : 'rgba(255,255,255,.8)';
    ctx.font = font(12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y + 1);
  });
}

function drawBalls(env) {
  const { ctx, lw, font } = env;
  const items = [
    { p: env.state.picker.cue, fill: 'rgba(250,250,250,.25)', ring: '#222', label: '母球' },
    { p: env.state.picker.target, fill: 'rgba(229,57,53,.25)', ring: '#300', label: '目标球' },
  ];
  items.forEach(({ p, fill, ring, label }) => {
    if (!p) return;
    const r = ballHandleRadius(env, p);
    ctx.lineWidth = lw(2);
    ctx.strokeStyle = ring;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawCross(env, p, r * 0.5, 0.55);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.lineWidth = lw(3);
    ctx.font = font(12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const ly = p.y - r - env.cs(4);
    ctx.strokeText(label, p.x, ly);
    ctx.fillText(label, p.x, ly);
  });
  if (env.state.snapTo) drawSnapRing(env, env.state.snapTo);
}

function drawSnapRing(env, p) {
  const { ctx, lw, font } = env;
  const r = ballHandleRadius(env, p);
  ctx.setLineDash(env.dash(6));
  ctx.lineWidth = lw(2.4);
  ctx.strokeStyle = COLORS.snap;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + env.cs(5), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawCross(env, p, r * 0.5);
  ctx.fillStyle = COLORS.snap;
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.lineWidth = lw(3);
  ctx.font = font(11);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ly = p.y + r + env.cs(8);
  ctx.strokeText('🧲 松手吸附', p.x, ly);
  ctx.fillText('🧲 松手吸附', p.x, ly);
}

function drawKickPath(env) {
  const { ctx, lw, dash, cs } = env;
  const kick = env.kick;
  const sol = kick.solutions[env.kickSel] || kick.best;
  if (!sol) return;
  const imageOf = env.imageOf;
  const cue = env.state.picker.cue;
  const ghost = imageOf(kick.ghost);
  const pts = [cue, ...sol.bounces.map((b) => imageOf(b.point)), ghost];
  ctx.setLineDash(dash(9));
  ctx.lineWidth = lw(2.4);
  ctx.strokeStyle = COLORS.aim;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  const gr = projectedRadius(env, imageOf, kick.ghost, env.spec.ballD / 2);
  ctx.setLineDash(dash(5));
  ctx.lineWidth = lw(2);
  ctx.beginPath();
  ctx.arc(ghost.x, ghost.y, gr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  sol.bounces.forEach((b) => {
    const p = imageOf(b.point);
    ctx.fillStyle = COLORS.aim;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cs(7), 0, Math.PI * 2);
    ctx.fill();
  });
}

function projectedRadius(env, imageOf, centerW, rW) {
  const c = imageOf(centerW);
  const ax = imageOf({ x: centerW.x + rW, y: centerW.y });
  const ay = imageOf({ x: centerW.x, y: centerW.y + rW });
  return (Math.hypot(ax.x - c.x, ax.y - c.y) + Math.hypot(ay.x - c.x, ay.y - c.y)) / 2;
}

function drawCross(env, p, arm, alpha = 1) {
  const { ctx } = env;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x - arm, p.y);
  ctx.lineTo(p.x + arm, p.y);
  ctx.moveTo(p.x, p.y - arm);
  ctx.lineTo(p.x, p.y + arm);
  ctx.lineWidth = env.lw(3.2);
  ctx.strokeStyle = `rgba(0,0,0,${0.55 * alpha})`;
  ctx.stroke();
  ctx.lineWidth = env.lw(1.4);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.stroke();
  ctx.lineCap = 'butt';
}
