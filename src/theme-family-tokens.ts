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

/** Sort key: lower = earlier in the palette strip. Unknown families sort last. */
export function paletteOrderIndex(familyName: string): number {
  const normalized = familyName.trim().toLowerCase();
  const idx = PALETTE_FAMILY_ORDER.findIndex(n => n.toLowerCase() === normalized);
  return idx === -1 ? 999 : idx;
}

export function cssVarRef(token: string): string {
  return `var(${token})`;
}
