type RGB = [number, number, number];

const toRgb = (h: string): RGB => {
  let x = h.replace('#', '');
  if (x.length === 3) x = x.split('').map(ch => ch + ch).join('');
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return toHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
// Shade towards a warm near-black so shadows never look dead-black.
export const darken = (c: string, t: number) => mix(c, '#1c1410', t);

/** Desaturate towards a dry brown-grey. */
export function deadify(c: string): string {
  const [r, g, b] = toRgb(c);
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return mix(mix(c, toHex([l, l, l]), 0.75), '#8a7352', 0.4);
}
