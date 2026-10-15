export class Magnifier {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
  }

  draw(source, p, cssScale, dpr, zoom = 2.2) {
    const { ctx, size } = this;
    const srcSpan = size / (dpr * zoom * cssScale);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      source,
      p.x - srcSpan / 2,
      p.y - srcSpan / 2,
      srcSpan,
      srcSpan,
      0,
      0,
      size,
      size
    );
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 18);
    ctx.lineTo(size / 2, size / 2 + 18);
    ctx.moveTo(size / 2 - 18, size / 2);
    ctx.lineTo(size / 2 + 18, size / 2);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}
