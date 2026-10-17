export const SPECS = [
  {
    key: 'chinese8',
    name: '中式八球',
    tableL: 2540,
    tableW: 1270,
    ballD: 57.15,
    cornerPocketOut: 40,
    sidePocketOut: 26,
    pocketR: 62,
    cushion: 55,
  },
  {
    key: 'snooker',
    name: '斯诺克',
    tableL: 3569,
    tableW: 1778,
    ballD: 52.5,
    cornerPocketOut: 42,
    sidePocketOut: 24,
    pocketR: 60,
    cushion: 52,
  },
];

export function getSpec(key) {
  return SPECS.find((s) => s.key === key) ?? SPECS[0];
}

export function rotateSpec(spec) {
  return {
    ...spec,
    tableL: spec.tableW,
    tableW: spec.tableL,
    rotated: true,
  };
}

export function worldCorners(spec) {
  const { tableL: L, tableW: W } = spec;
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
}

export function pocketWorldPoints(spec) {
  const { tableL: L, tableW: W, cornerPocketOut: co, sidePocketOut: so } = spec;
  const dc = co / Math.SQRT2;
  if (spec.rotated) {
    return [
      { x: -dc, y: -dc, name: '1号袋' },
      { x: L + dc, y: -dc, name: '2号袋' },
      { x: L + so, y: W / 2, name: '3号袋' },
      { x: L + dc, y: W + dc, name: '4号袋' },
      { x: -dc, y: W + dc, name: '5号袋' },
      { x: -so, y: W / 2, name: '6号袋' },
    ];
  }
  return [
    { x: -dc, y: -dc, name: '1号袋' },
    { x: L / 2, y: -so, name: '2号袋' },
    { x: L + dc, y: -dc, name: '3号袋' },
    { x: L + dc, y: W + dc, name: '4号袋' },
    { x: L / 2, y: W + so, name: '5号袋' },
    { x: -dc, y: W + dc, name: '6号袋' },
  ];
}
