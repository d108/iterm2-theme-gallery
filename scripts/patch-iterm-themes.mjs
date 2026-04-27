#!/usr/bin/env node

import { execSync, execFileSync } from 'node:child_process';
import { readFile, writeFile, copyFile, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

const DEFAULT_PLIST = resolve(homedir(), 'Library/Preferences/com.googlecode.iterm2.plist');
const GALLERY_DATA = resolve(process.cwd(), 'public/screenshots.json');
const USER_DATA = resolve(process.cwd(), 'user_data');
const LAST_REPORT = join(USER_DATA, 'last-generated-report.json');
const WORK_DIR = join(USER_DATA, 'work');
const BACKUP_DIR = join(USER_DATA, 'backups');

/** Reads only Custom Color Presets (JSON-safe); missing key → {} */
function readCustomColorPresetsFromPlist(plistPath) {
  try {
    const out = execFileSync(
      'plutil',
      ['-extract', 'Custom Color Presets', 'json', '-o', '-', plistPath],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out);
  } catch {
    return {};
  }
}

async function main() {
  console.log('\n🛡️  iTerm2 Theme Patcher (Safe Mode)');
  console.log('====================================');

  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const hasLastReport = existsSync(LAST_REPORT);
  if (hasLastReport) {
    const stats = await stat(LAST_REPORT);
    console.log(`✨ Detected generated report: user_data/last-generated-report.json`);
    console.log(`   (Generated: ${stats.mtime.toLocaleString()})\n`);
  }

  try {
    // 1. Locate and Verify Target
    let plistPath = await ask(`📂 Target iTerm2 plist [${DEFAULT_PLIST}]: `);
    plistPath = resolve(plistPath.trim() || DEFAULT_PLIST);

    if (!existsSync(plistPath)) {
      console.error(`❌ Error: File not found at ${plistPath}`);
      process.exit(1);
    }

    // 2. Load Source Themes
    console.log('\nSelect theme source:');
    if (hasLastReport) {
      console.log('1. Last Generated Report (from web gallery) [DEFAULT]');
      console.log('2. Gallery (from screenshots.json)');
      console.log('3. Custom File (.itermcolors or .plist)');
    } else {
      console.log('1. Gallery (from screenshots.json) [DEFAULT]');
      console.log('2. Custom File (.itermcolors or .plist)');
    }
    
    const choice = (await ask('Choice [1]: ')).trim() || '1';
    let themesToApply = {};

    if (hasLastReport && choice === '1') {
      themesToApply = await loadAndNormalize(LAST_REPORT);
    } else if ((hasLastReport && choice === '2') || (!hasLastReport && choice === '1')) {
      const data = JSON.parse(await readFile(GALLERY_DATA, 'utf8'));
      const query = await ask('🔎 Search for themes (comma separated): ');
      const qs = query.split(',').map(q => q.trim().toLowerCase()).filter(q => q);
      const matches = data.themes.filter(t => qs.some(q => t.name.toLowerCase().includes(q)));
      if (matches.length === 0) { console.log('No matches.'); process.exit(0); }
      matches.forEach(m => themesToApply[m.name] = validateAndConvertGalleryTheme(m));
    } else {
      const path = await ask('📄 Path to theme file: ');
      themesToApply = await loadAndNormalize(resolve(path.trim()));
    }

    // 3. TRIAL RUN: Perform work on a copy
    console.log('\n🧪 Starting Trial Run...');
    const trialPlist = join(WORK_DIR, 'trial_run.plist');
    await copyFile(plistPath, trialPlist);
    // Only touch Custom Color Presets: the full iTerm plist contains types
    // (e.g. NSData) that cannot round-trip through JSON; converting the whole
    // file would fail or strip unrelated settings.
    const existingPresets = readCustomColorPresetsFromPlist(trialPlist);
    const originalCount = Object.keys(existingPresets).length;
    const mergedPresets = { ...existingPresets, ...themesToApply };
    const finalCount = Object.keys(mergedPresets).length;
    const mergedJson = JSON.stringify(mergedPresets);
    execFileSync('plutil', [
      '-replace',
      'Custom Color Presets',
      '-json',
      mergedJson,
      trialPlist,
    ]);

    // 4. VERIFICATION of the Trial File
    console.log('🧐 Verifying generated file integrity...');
    try {
      execSync(`plutil -lint "${trialPlist}"`);
      console.log('   ✅ Integrity check passed.');
    } catch (e) {
      console.error('   ❌ FATAL: Generated file is invalid! Trial run aborted.');
      process.exit(1);
    }

    // 5. User Preview & Final Approval
    console.log(`\n📊 Trial Results:`);
    console.log(`   - Original themes: ${originalCount}`);
    console.log(`   - New/Updated themes: ${Object.keys(themesToApply).length}`);
    console.log(`   - Final total: ${finalCount}`);
    
    console.log('\nPreview of themes to be added:');
    Object.entries(themesToApply).forEach(([name, dict]) => printThemePreview(name, dict));

    const confirm = await ask(`\n⚠️  Verification complete. Ready to overwrite live plist? (y/N): `);
    if (confirm.toLowerCase() === 'y') {
      // Create permanent backup first
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(BACKUP_DIR, `com.googlecode.iterm2.${ts}.plist.bak`);
      await copyFile(plistPath, backupPath);
      
      // Overwrite live file
      await copyFile(trialPlist, plistPath);
      console.log(`\n✨ SUCCESS! Live plist updated. Backup saved to user_data/backups/`);
    } else {
      console.log('\n🚫 Update cancelled. Your live plist was NOT touched.');
      console.log(`   You can inspect the trial file at: ${trialPlist}`);
    }

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
  } finally {
    rl.close();
  }
}

/**
 * Parses legacy NeXTSTEP / OpenStep ASCII plist text (as produced by the gallery
 * display formatter). macOS plutil no longer accepts this format reliably.
 */
export function parseOpenStepAsciiPlist(input) {
  let i = 0;
  const len = input.length;
  const skipWs = () => {
    while (i < len && /\s/.test(input[i])) i++;
  };
  const parseString = () => {
    if (input[i] !== '"') throw new Error('Expected string');
    i++;
    let s = '';
    while (i < len && input[i] !== '"') {
      if (input[i] === '\\' && i + 1 < len) i++;
      s += input[i++];
    }
    if (input[i] !== '"') throw new Error('Unterminated string');
    i++;
    return s;
  };
  const parseNumber = () => {
    const start = i;
    if (input[i] === '-') i++;
    while (i < len && /[0-9.]/.test(input[i])) i++;
    if (start === i) throw new Error('Expected number');
    return parseFloat(input.slice(start, i));
  };
  const parseIdentifier = () => {
    const start = i;
    while (i < len && /[A-Za-z0-9_]/.test(input[i])) i++;
    if (start === i) throw new Error('Expected identifier');
    return input.slice(start, i);
  };
  const parseValue = () => {
    skipWs();
    const c = input[i];
    if (c === '{') return parseDict();
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    return parseIdentifier();
  };
  const parseDict = () => {
    if (input[i] !== '{') throw new Error('Expected {');
    i++;
    const obj = {};
    skipWs();
    while (i < len && input[i] !== '}') {
      skipWs();
      if (input[i] !== '"') throw new Error('Expected dict key');
      const key = parseString();
      skipWs();
      if (input[i] !== '=') throw new Error('Expected =');
      i++;
      skipWs();
      obj[key] = parseValue();
      skipWs();
      if (input[i] === ';') i++;
      skipWs();
    }
    if (input[i] !== '}') throw new Error('Expected }');
    i++;
    skipWs();
    if (input[i] === ';') i++;
    return obj;
  };
  skipWs();
  const root = parseDict();
  skipWs();
  if (i !== len) {
    throw new Error('Unexpected content after property list');
  }
  return root;
}

export function coerceItermColorDicts(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const isLeaf =
        'Alpha Component' in v ||
        'Red Component' in v ||
        'Blue Component' in v;
      if (isLeaf) {
        const leaf = { ...v };
        for (const ck of Object.keys(leaf)) {
          const val = leaf[ck];
          if (typeof val === 'string' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) {
            leaf[ck] = parseFloat(val);
          }
        }
        out[k] = leaf;
      } else {
        out[k] = coerceItermColorDicts(v);
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadAndNormalize(filePath) {
  const content = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (e) {
    try {
      return coerceItermColorDicts(parseOpenStepAsciiPlist(content));
    } catch (e2) {
      const temp = join(WORK_DIR, 'normalize.plist');
      await writeFile(temp, content);
      try {
        const json = execSync(`plutil -convert json -o - "${temp}"`).toString();
        return JSON.parse(json);
      } finally {
        try {
          await unlink(temp);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function validateAndConvertGalleryTheme(theme) {
  const dict = {};
  const map = {
    'Ansi 0 Color': theme.colors.ansi0, 'Ansi 1 Color': theme.colors.ansi1,
    'Ansi 2 Color': theme.colors.ansi2, 'Ansi 3 Color': theme.colors.ansi3,
    'Ansi 4 Color': theme.colors.ansi4, 'Ansi 5 Color': theme.colors.ansi5,
    'Ansi 6 Color': theme.colors.ansi6, 'Ansi 7 Color': theme.colors.ansi7,
    'Ansi 8 Color': theme.colors.ansi8, 'Ansi 9 Color': theme.colors.ansi9,
    'Ansi 10 Color': theme.colors.ansi10, 'Ansi 11 Color': theme.colors.ansi11,
    'Ansi 12 Color': theme.colors.ansi12, 'Ansi 13 Color': theme.colors.ansi13,
    'Ansi 14 Color': theme.colors.ansi14, 'Ansi 15 Color': theme.colors.ansi15,
    'Background Color': theme.colors.bg, 'Foreground Color': theme.colors.fg,
    'Cursor Color': theme.colors.cursor, 'Cursor Text Color': theme.colors.cursorText,
    'Selection Color': theme.colors.selection, 'Selected Text Color': theme.colors.selectionText,
  };
  for (const [k, h] of Object.entries(map)) {
    const rgb = hexToRgb(h);
    dict[k] = { 'Alpha Component': 1, 'Blue Component': rgb.b / 255, 'Color Space': 'P3', 'Green Component': rgb.g / 255, 'Red Component': rgb.r / 255 };
  }
  const defaults = { 'Badge Color': { r: 1, g: 0.1, b: 0.1, a: 0.5 }, 'Bold Color': { r: 1, g: 1, b: 1, a: 1 }, 'Cursor Guide Color': { r: 0.7, g: 0.85, b: 1, a: 0.25 }, 'Link Color': { r: 0.2, g: 0.5, b: 1, a: 1 }, 'Match Background Color': { r: 1, g: 1, b: 0, a: 1 } };
  for (const [k, v] of Object.entries(defaults)) {
    dict[k] = { 'Alpha Component': v.a, 'Blue Component': v.b, 'Color Space': 'P3', 'Green Component': v.g, 'Red Component': v.r };
  }
  return dict;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function printThemePreview(name, dict) {
  const c2h = (c) => {
    if (!c) return 'N/A';
    const r = Math.round((c['Red Component'] || 0) * 255);
    const g = Math.round((c['Green Component'] || 0) * 255);
    const b = Math.round((c['Blue Component'] || 0) * 255);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
  };
  console.log(`   🎨 ${name.padEnd(25)} BG:${c2h(dict['Background Color'])} FG:${c2h(dict['Foreground Color'])}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
