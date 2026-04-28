/**
 * Canonical order for the 15 family groups — navigator, jump buttons, and gallery sorting
 * all follow this sequence (dark neutrals → dark hues → light neutrals → light hues).
 */
export const PALETTE_FAMILY_ORDER: readonly string[] = [
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

/** Maps gallery family labels to CSS custom property names (palette is defined in theme-palette.scss). */
const FAMILY_SEMANTIC_VAR: Record<string, string> = {
  'dark neutral': '--theme-dark-neutral',
  'dark red': '--theme-dark-red',
  'dark orange/brown': '--theme-dark-orange-brown',
  'dark yellow/olive': '--theme-dark-yellow-olive',
  'dark green': '--theme-dark-green',
  'dark cyan': '--theme-dark-cyan',
  'dark blue': '--theme-dark-blue',
  'dark purple': '--theme-dark-purple',
  'light neutral': '--theme-light-neutral',
  'light red/orange': '--theme-light-red-orange',
  'light cream': '--theme-light-cream',
  'light yellow': '--theme-light-yellow',
  'light blue': '--theme-light-blue',
  'light pink/purple': '--theme-light-pink-purple',
  'light green': '--theme-light-green',
};

export function semanticVarForFamily(familyName: string): string {
  const key = familyName.trim().toLowerCase();
  return FAMILY_SEMANTIC_VAR[key] ?? '--theme-light-neutral';
}

/**
 * Fill for UI swatches that represent a **named palette family** (navigator, card strip, training table).
 * Matches `theme-palette.scss` — not theme background hex, not ML anchor HSL, not computed colors.
 */
const PALETTE_FAMILY_SWATCH_HSL: Readonly<Record<string, string>> = {
  'dark neutral': 'hsl(0 0% 0%)',
  'dark red': 'hsl(0 100% 12%)',
  'dark orange/brown': 'hsl(30 40% 15%)',
  'dark yellow/olive': 'hsl(60 40% 15%)',
  'dark green': 'hsl(120 50% 15%)',
  'dark cyan': 'hsl(180 50% 15%)',
  'dark blue': 'hsl(220 60% 15%)',
  'dark purple': 'hsl(280 50% 15%)',
  'light neutral': 'hsl(0 0% 85%)',
  'light red/orange': 'hsl(25 80% 85%)',
  'light cream': 'hsl(40 50% 98%)',
  'light yellow': 'hsl(60 60% 90%)',
  'light blue': 'hsl(210 50% 90%)',
  'light pink/purple': 'hsl(330 70% 90%)',
  'light green': 'hsl(120 40% 90%)',
};

export function swatchHslForFamily(familyName: string): string {
  const key = familyName.trim().toLowerCase();
  return PALETTE_FAMILY_SWATCH_HSL[key] ?? 'hsl(0 0% 85%)';
}

/** Sort key: lower = earlier in the palette strip. Unknown families sort last. */
export function paletteOrderIndex(familyName: string): number {
  const normalized = familyName.trim().toLowerCase();
  const idx = PALETTE_FAMILY_ORDER.findIndex(n => n.toLowerCase() === normalized);
  return idx === -1 ? 999 : idx;
}

/**
 * Whether a name belongs in the **dark** half of the fixed 15-slot palette (indices 0–7).
 * Use for navigator rows / filters — not `MLService` HSL metadata (avoids drift from ML mode).
 */
export function isPaletteFamilyDark(familyName: string): boolean {
  const i = paletteOrderIndex(familyName);
  return i !== 999 && i <= 7;
}

export function cssVarRef(token: string): string {
  return `var(${token})`;
}
