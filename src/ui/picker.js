import { pickHandle } from './util.js';

export class BallPicker {
  constructor() {
    this.cue = null;
    this.target = null;
  }

  preset(w, h) {
    this.cue = { x: w * 0.35, y: h * 0.62 };
    this.target = { x: w * 0.6, y: h * 0.45 };
  }

  list() {
    return [this.cue, this.target];
  }

  hit(p, radiusImg) {
    return pickHandle(this.list(), p, radiusImg);
  }

  move(idx, p) {
    if (idx === 0) this.cue = p;
    else if (idx === 1) this.target = p;
  }
}
