import { pickHandle, quadArea } from './util.js';
import { computeHomography, applyH } from '../math/homography.js';
import { worldCorners, pocketWorldPoints } from '../specs.js';

export class Calibrator {
  constructor() {
    this.points = [];
  }

  preset(w, h) {
    this.points = [
      { x: w * 0.12, y: h * 0.12 },
      { x: w * 0.88, y: h * 0.12 },
      { x: w * 0.88, y: h * 0.88 },
      { x: w * 0.12, y: h * 0.88 },
    ];
  }

  hit(p, radiusImg) {
    return pickHandle(this.points, p, radiusImg);
  }

  move(i, p) {
    this.points[i] = p;
  }

  issues(imgW, imgH, spec) {
    const pts = this.points;
    if (pts.length !== 4) return ['需要 4 个标定点'];
    const minD = Math.hypot(imgW, imgH) * 0.02;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < minD) {
          return ['标定点彼此太近，请把 4 个点分放在台面四个角'];
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % 4];
      const p2 = pts[(i + 2) % 4];
      const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
      if (cross <= 0) {
        return quadArea(pts) <= 0
          ? ['点的顺序应按 1→2→3→4 顺时针排列']
          : ['四个点未构成凸四边形，请检查是否交叉错位'];
      }
    }
    if (Math.abs(quadArea(pts)) <= 0.02 * imgW * imgH) {
      return ['四边形面积太小，请把点拖到台面真正的四角'];
    }
    if (spec) {
      try {
        const Hi = computeHomography(
          worldCorners(spec).map((p) => [p.x, p.y]),
          pts.map((p) => [p.x, p.y])
        );
        const margin = 0.25 * Math.max(imgW, imgH);
        for (const p of pocketWorldPoints(spec)) {
          const [ix, iy] = applyH(Hi, p.x, p.y);
          if (ix < -margin || ix > imgW + margin || iy < -margin || iy > imgH + margin) {
            return ['袋口投影大幅超出画面，请检查角点是否拖错位置'];
          }
        }
      } catch {
        return ['无法从当前四点解出有效标定，请调整点位'];
      }
    }
    return [];
  }

  valid(imgW, imgH, spec) {
    return this.issues(imgW, imgH, spec).length === 0;
  }
}
