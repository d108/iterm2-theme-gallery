/**
 * Recompute theme.family + theme.bucket from Oklab nearest-anchor (same rules as MLService).
 * Regenerates families[].startIndex as first index per label in themes[] order.
 * Usage: node scripts/apply-oklab-families.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

/** Must match src/theme-family-tokens.ts PALETTE_FAMILY_ORDER */
const PALETTE_FAMILY_ORDER = [
  'Dark Neutral',
  'Dark Red',
  'Dark Orange/Brown',
  'Dark Yellow/Olive',
  'Dark Green',
  'Dark Cyan',
  'Dark Blue',
  'Dark Purple',
  'Light Neutral',
  'Light Red/Orange',
  'Light Cream',
  'Light Yellow',
  'Light Blue',
  'Light Pink/Purple',
  'Light Green',
];

/** Must match legacy screenshots.json bucket convention */
const FAMILY_TO_BUCKET = {
  'Dark Neutral': 1,
  'Dark Red': 2,
  'Dark Orange/Brown': 3,
  'Dark Yellow/Olive': 4,
  'Dark Green': 5,
  'Dark Cyan': 6,
  'Dark Blue': 7,
  'Dark Purple': 8,
  'Light Red/Orange': 101,
  'Light Cream': 102,
  'Light Neutral': 103,
  'Light Yellow': 104,
  'Light Blue': 105,
  'Light Pink/Purple': 106,
  'Light Green': 107,
};

/** Must match ml.service.ts semanticColors */
const SEMANTIC = {
  black: [0, 0, 0],
  'dark red': [0, 100, 12],
  'dark brown': [30, 40, 15],
  'dark olive': [60, 40, 15],
  'dark green': [120, 50, 15],
  'dark teal': [180, 50, 15],
  'dark blue': [220, 60, 15],
  'dark purple': [280, 50, 15],
  'light gray': [0, 0, 85],
  peach: [25, 80, 85],
  cream: [40, 50, 98],
  'pale yellow': [60, 60, 90],
  'light blue': [210, 50, 90],
  'light pink': [330, 70, 90],
  'light green': [120, 40, 90],
};

function parseAnchors(text) {
  const anchors = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const family = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    const sName = rest.toLowerCase();
    const hsl = SEMANTIC[sName];
    if (hsl) {
      anchors.push({ family, hsl });
    } else {
      const values = rest.split(',').map(v => parseFloat(v.trim()));
      if (values.length === 3 && !values.some(Number.isNaN)) {
        anchors.push({ family, hsl: values });
      }
    }
  }
  return anchors;
}

/** Must match ml.service.ts */
const CHROMA_ACHROMATIC = 0.018;
const CHROMA_HUE_BUCKET = 0.068;
const RGB_SPREAD_NEUTRAL = 1;

const DARK_HUE_ANCHORS = [
  { family: 'Dark Red', hue: 0 },
  { family: 'Dark Orange/Brown', hue: 30 },
  { family: 'Dark Yellow/Olive', hue: 60 },
  { family: 'Dark Green', hue: 120 },
  { family: 'Dark Cyan', hue: 180 },
  { family: 'Dark Blue', hue: 220 },
  { family: 'Dark Purple', hue: 280 },
];

const LIGHT_HUE_ANCHORS = [
  { family: 'Light Red/Orange', hue: 25 },
  { family: 'Light Cream', hue: 40 },
  { family: 'Light Yellow', hue: 60 },
  { family: 'Light Green', hue: 120 },
  { family: 'Light Blue', hue: 210 },
  { family: 'Light Pink/Purple', hue: 330 },
];

const ANCHOR_HUE_BY_FAMILY = {
  'Dark Neutral': 0,
  'Dark Red': 0,
  'Dark Orange/Brown': 30,
  'Dark Yellow/Olive': 60,
  'Dark Green': 120,
  'Dark Cyan': 180,
  'Dark Blue': 220,
  'Dark Purple': 280,
  'Light Neutral': 0,
  'Light Red/Orange': 25,
  'Light Cream': 40,
  'Light Yellow': 60,
  'Light Blue': 210,
  'Light Pink/Purple': 330,
  'Light Green': 120,
};

const HUE_MISMATCH_MAX_DEG = 40;

function paletteOrderIndex(name) {
  const n = name.trim().toLowerCase();
  const idx = PALETTE_FAMILY_ORDER.findIndex(x => x.toLowerCase() === n);
  return idx === -1 ? 999 : idx;
}

function hueDistanceDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function oklabChroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

function oklabDeltaE(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function hslToSrgb01(h, s, l) {
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

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearSrgbToOklab(r, g, b) {
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

function hslToOklab(h, s, l) {
  const [r, g, b] = hslToSrgb01(h, s, l);
  return linearSrgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

function parseHexRgb(hex) {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToOklab(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  return linearSrgbToOklab(
    srgbToLinear(rgb[0] / 255),
    srgbToLinear(rgb[1] / 255),
    srgbToLinear(rgb[2] / 255)
  );
}

function rgbChannelSpreadFromHex(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

function rgbChannelSpreadFromHsl(h, s, l) {
  const [r, g, b] = hslToSrgb01(h, s, l);
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  return Math.max(R, G, B) - Math.min(R, G, B);
}

function nearestFamilyOklab(lab, anchors) {
  let bestFamily = anchors[0].family;
  let bestD = Infinity;
  for (const a of anchors) {
    const alab = hslToOklab(a.hsl[0], a.hsl[1], a.hsl[2]);
    const d = oklabDeltaE(lab, alab);
    if (d < bestD) {
      bestD = d;
      bestFamily = a.family;
    }
  }
  return bestFamily;
}

function nearestFamilyByHue(hue, isDark) {
  const table = isDark ? DARK_HUE_ANCHORS : LIGHT_HUE_ANCHORS;
  let best = table[0];
  let bestDist = hueDistanceDeg(hue, best.hue);
  let bestOrder = paletteOrderIndex(best.family);
  for (const row of table) {
    const d = hueDistanceDeg(hue, row.hue);
    const ord = paletteOrderIndex(row.family);
    if (d < bestDist || (d === bestDist && ord < bestOrder)) {
      bestDist = d;
      best = row;
      bestOrder = ord;
    }
  }
  return best.family;
}

function isLightFamilyLabel(name) {
  const i = paletteOrderIndex(name);
  if (i === 999) return false;
  return i >= 8;
}

function isDarkFamilyLabel(name) {
  const i = paletteOrderIndex(name);
  if (i === 999) return false;
  return i <= 7;
}

function reconcileOklabPickWithHue(oklabPick, hue, isDark) {
  if (oklabPick === 'Dark Neutral' || oklabPick === 'Light Neutral') {
    return oklabPick;
  }
  const anchorHue = ANCHOR_HUE_BY_FAMILY[oklabPick];
  if (anchorHue === undefined) {
    return oklabPick;
  }
  const dh = hueDistanceDeg(hue, anchorHue);
  if (dh <= HUE_MISMATCH_MAX_DEG) {
    return oklabPick;
  }
  return nearestFamilyByHue(hue, isDark);
}

function classifyFromLab(lab, hue, isDark, rgbSpread, anchors) {
  const chroma = oklabChroma(lab);
  if (chroma < CHROMA_ACHROMATIC && rgbSpread <= RGB_SPREAD_NEUTRAL) {
    return isDark ? 'Dark Neutral' : 'Light Neutral';
  }
  if (chroma < CHROMA_HUE_BUCKET) {
    return nearestFamilyByHue(hue, isDark);
  }
  let pick = nearestFamilyOklab(lab, anchors);
  pick = reconcileOklabPickWithHue(pick, hue, isDark);
  if (isDark && isLightFamilyLabel(pick)) {
    return nearestFamilyByHue(hue, true);
  }
  if (!isDark && isDarkFamilyLabel(pick)) {
    return nearestFamilyByHue(hue, false);
  }
  return pick;
}

function classifyTheme(theme, anchors) {
  const lab = hexToOklab(theme.colors.bg) ?? hslToOklab(theme.hue, theme.sat, theme.light);
  const spread = rgbChannelSpreadFromHex(theme.colors.bg) ?? rgbChannelSpreadFromHsl(theme.hue, theme.sat, theme.light);
  return classifyFromLab(lab, theme.hue, theme.isDark, spread, anchors);
}

const trainingPath = path.join(root, 'public/ml/color-training.txt');
const jsonPath = path.join(root, 'public/screenshots.json');

const anchors = parseAnchors(fs.readFileSync(trainingPath, 'utf8'));
if (anchors.length === 0) {
  console.error('No anchors parsed from color-training.txt');
  process.exit(1);
}

const raw = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(raw);

const oldFamilies = new Map(data.families.map(f => [f.label, f]));

let changed = 0;
for (const t of data.themes) {
  const next = classifyTheme(t, anchors);
  const bucket = FAMILY_TO_BUCKET[next];
  if (!bucket) {
    console.error('Unknown family label:', next);
    process.exit(1);
  }
  if (t.family !== next || t.bucket !== bucket) {
    changed++;
  }
  t.family = next;
  t.bucket = bucket;
}

const themes = data.themes;
const familiesOut = [];
for (const label of PALETTE_FAMILY_ORDER) {
  const prev = oldFamilies.get(label);
  if (!prev) {
    console.error('Missing family metadata for', label);
    process.exit(1);
  }
  const startIndex = themes.findIndex(th => th.family === label);
  familiesOut.push({
    id: prev.id,
    label,
    startIndex: startIndex === -1 ? 0 : startIndex,
    color: prev.color,
    isDark: prev.isDark,
  });
}

data.families = familiesOut;

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

const counts = {};
for (const t of themes) {
  counts[t.family] = (counts[t.family] || 0) + 1;
}

console.log('Themes updated:', themes.length, '| rows changed:', changed);
console.log('Counts by family:', counts);
