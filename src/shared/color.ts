// Color science utilities: RGB <-> HEX, RGB -> CIELAB, and Delta E distances
// (CIE76 + CIEDE2000). Figma colors are normalized floats in the 0..1 range.

export interface RGB {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
}

export interface LAB {
  L: number;
  a: number;
  b: number;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// sRGB (D65) -> CIELAB
export function rgbToLab({ r, g, b }: RGB): LAB {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);

  // Linear sRGB -> XYZ (D65)
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;

  // Normalize by D65 reference white
  X /= 0.95047;
  Y /= 1.0;
  Z /= 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE76(a: LAB, b: LAB): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// CIEDE2000 — the perceptually accurate distance used for clustering by default.
export function deltaE2000(lab1: LAB, lab2: LAB): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const kL = 1, kC = 1, kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = hpf(b1, a1p);
  const h2p = hpf(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dhp = dhpf(C1p, C2p, h1p, h2p);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  const hbarp = ahpf(C1p, C2p, h1p, h2p);

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));

  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dtheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
      Math.pow(dCp / (kC * Sc), 2) +
      Math.pow(dHp / (kH * Sh), 2) +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function hpf(b: number, ap: number): number {
  if (b === 0 && ap === 0) return 0;
  const h = (Math.atan2(b, ap) * 180) / Math.PI;
  return h >= 0 ? h : h + 360;
}

function dhpf(C1p: number, C2p: number, h1p: number, h2p: number): number {
  if (C1p * C2p === 0) return 0;
  let d = h2p - h1p;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

function ahpf(C1p: number, C2p: number, h1p: number, h2p: number): number {
  if (C1p * C2p === 0) return h1p + h2p;
  let s = h1p + h2p;
  if (Math.abs(h1p - h2p) > 180) {
    if (s < 360) s += 360;
    else s -= 360;
  }
  return s / 2;
}

// Default distance used by the clustering algorithm.
export function deltaE(a: LAB, b: LAB, metric: 'cie76' | 'ciede2000' = 'ciede2000'): number {
  return metric === 'cie76' ? deltaE76(a, b) : deltaE2000(a, b);
}
