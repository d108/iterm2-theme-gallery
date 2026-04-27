/**
 * Oklab (Björn Ottosson) — perceptually uniform space; Euclidean distance ≈ ΔE_OK for small steps.
 * Pipeline: sRGB → linear sRGB → LMS → cbrt → Oklab (CSS Color 4 / OKLab paper).
 */

export type Oklab = readonly [number, number, number];

export function oklabDeltaE(a: Oklab, b: Oklab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Chroma in the a–b plane (distance from neutral axis). */
export function oklabChroma(lab: Oklab): number {
  return Math.hypot(lab[1], lab[2]);
}

/** Max − min sRGB channel (0–255). `#f8f9fa` has spread 2; pure grays 0. */
export function rgbChannelSpreadFromHex(hex: string): number | null {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

export function rgbChannelSpreadFromHsl(h: number, s: number, l: number): number {
  const [r, g, b] = hslToSrgb01(h, s, l);
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  return Math.max(R, G, B) - Math.min(R, G, B);
}

/** HSL (deg, 0–100, 0–100) → Oklab via sRGB. */
export function hslToOklab(h: number, s: number, l: number): Oklab {
  const [r, g, b] = hslToSrgb01(h, s, l);
  return linearSrgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

/** `#RGB` / `#RRGGBB` → Oklab, or null if invalid. */
export function hexToOklab(hex: string): Oklab | null {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  return linearSrgbToOklab(
    srgbToLinear(rgb[0] / 255),
    srgbToLinear(rgb[1] / 255),
    srgbToLinear(rgb[2] / 255)
  );
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslToSrgb01(h: number, s: number, l: number): [number, number, number] {
  let hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [rp + m, gp + m, bp + m];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearSrgbToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
