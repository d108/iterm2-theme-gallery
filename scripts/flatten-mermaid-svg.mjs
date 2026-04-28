#!/usr/bin/env node
/**
 * Mermaid SVG output uses foreignObject + HTML for labels; many viewers (e.g. GitHub) drop or
 * mis-render those. Replace each foreignObject with a centered <text> when content is a single <p>.
 */
import fs from 'fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/flatten-mermaid-svg.mjs <file.svg>');
  process.exit(1);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textFromInner(inner) {
  const p = inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) {
    return p[1]
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const stripped = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped || null;
}

function fontSizeForHeight(h) {
  const hh = Number(h);
  if (hh <= 26) return 12;
  if (hh <= 40) return 12;
  if (hh <= 52) return 11;
  return 10;
}

let svg = fs.readFileSync(path, 'utf8');
const foRe = /<foreignObject\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*>([\s\S]*?)<\/foreignObject>/g;
svg = svg.replace(foRe, (_, w, h, inner) => {
  const label = textFromInner(inner);
  if (!label) return '';
  const x = (Number(w) / 2).toFixed(2);
  const y = (Number(h) / 2).toFixed(2);
  const fsz = fontSizeForHeight(h);
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fsz}" fill="#111111">${escapeXml(label)}</text>`;
});

if (svg.includes('foreignObject')) {
  console.warn('[flatten-mermaid-svg] warning: some foreignObject nodes were not replaced');
}

const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
if (vb) {
  const w = Math.ceil(Number(vb[1]));
  const h = Math.ceil(Number(vb[2]));
  svg = svg.replace(/<svg id="([^"]+)" width="100%"/, `<svg id="$1" width="${w}" height="${h}"`);
  svg = svg.replace(/style="max-width:[^"]*"/, 'style="max-width: 100%; height: auto;"');
}

fs.writeFileSync(path, svg);
