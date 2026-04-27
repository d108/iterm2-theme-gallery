import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NeuralNetwork, type NeuralNetworkState } from './nn';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { paletteOrderIndex, semanticVarForFamily } from '../../theme-family-tokens';
import {
  hexToOklab,
  hslToOklab,
  oklabChroma,
  oklabDeltaE,
  rgbChannelSpreadFromHex,
  rgbChannelSpreadFromHsl,
  type Oklab,
} from './oklab';

/** Gradient-descent passes over the full synthetic set (matches training loop). */
export const ML_TRAINING_EPOCHS = 1500;

/**
 * Badge + console + macrotask yield only every N epochs. All ML_TRAINING_EPOCHS still run;
 * this avoids thousands of setTimeout/UI ticks per run.
 */
export const ML_TRAINING_UI_EVERY = 100;

/** Below this Oklab chroma, may treat as achromatic if RGB channel spread is also tiny. */
const CHROMA_ACHROMATIC = 0.018;
/** True gray / near-gray: max RGB − min RGB ≤ this (e.g. `#f8f9fa` spread 2 still gets hue bucket). */
const RGB_SPREAD_NEUTRAL = 1;
/**
 * Between CHROMA_ACHROMATIC and this, nearest family by HSL hue vs anchor hues (near-black tints are
 * unreliable in ΔE to saturated anchors — e.g. #020f01 reads “green” by hue but was classifying as Dark Blue).
 */
const CHROMA_HUE_BUCKET = 0.068;

/** Canonical hue angles (deg) aligned with `semanticColors` / color-training.txt. */
const DARK_HUE_ANCHORS: readonly { family: string; hue: number }[] = [
  { family: 'Dark Red', hue: 0 },
  { family: 'Dark Orange/Brown', hue: 30 },
  { family: 'Dark Yellow/Olive', hue: 60 },
  { family: 'Dark Green', hue: 120 },
  { family: 'Dark Cyan', hue: 180 },
  { family: 'Dark Blue', hue: 220 },
  { family: 'Dark Purple', hue: 280 },
];

const LIGHT_HUE_ANCHORS: readonly { family: string; hue: number }[] = [
  { family: 'Light Red/Orange', hue: 25 },
  { family: 'Light Cream', hue: 40 },
  { family: 'Light Yellow', hue: 60 },
  { family: 'Light Green', hue: 120 },
  { family: 'Light Blue', hue: 210 },
  { family: 'Light Pink/Purple', hue: 330 },
];

/** H from `semanticColors` / color-training — used to reject Oklab wins that disagree with hue (e.g. C64 → Dark Cyan). */
const ANCHOR_HUE_BY_FAMILY: Readonly<Record<string, number>> = {
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

/** If Oklab’s winner differs this much from `theme.hue`, trust circular hue buckets instead (55 was loose: Ocean ~222° stayed Dark Cyan vs 180°). */
const HUE_MISMATCH_MAX_DEG = 40;

interface TrainingSample {
  family: string;
  hsl: [number, number, number];
  themeName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MLService {
  private http = inject(HttpClient);
  private nn: NeuralNetwork | null = null;
  private families: string[] = [];
  private isReady$ = new BehaviorSubject<boolean>(false);
  private storageKey = 'iterm2_ml_custom_anchors';
  private weightsStorageKey = 'iterm2_ml_nn_weights_v1';

  // Semantic color mapping [H, S, L] — shared palette for ML on/off (navigator + theme accents)
  private semanticColors: Record<string, [number, number, number]> = {
    'black': [0, 0, 0],
    'dark red': [0, 100, 12],
    'dark brown': [30, 40, 15],
    'dark olive': [60, 40, 15],
    'dark green': [120, 50, 15],
    'dark teal': [180, 50, 15],
    'dark blue': [220, 60, 15],
    'dark purple': [280, 50, 15],
    'light gray': [0, 0, 85],
    'peach': [25, 80, 85],
    'cream': [40, 50, 98],
    'pale yellow': [60, 60, 90],
    'light blue': [210, 50, 90],
    'light pink': [330, 70, 90],
    'light green': [120, 40, 90]
  };

  private familyToSemantic: Record<string, string> = {};

  /** Bumped when anchor metadata changes so UI computeds re-read getFamilyMetadata(). */
  readonly anchorsRevision = signal(0);

  /** Current epoch while `loadAndTrain()` runs (1 … ML_TRAINING_EPOCHS); null when idle. */
  readonly trainingEpoch = signal<number | null>(null);

  readonly trainingEpochTotal = ML_TRAINING_EPOCHS;

  public ready$ = this.isReady$.asObservable();

  constructor() {
    this.init();
  }

  private async init() {
    await this.loadMetadataOnly();
  }

  public async loadMetadataOnly() {
    const text = await firstValueFrom(this.http.get('ml/color-training.txt', { responseType: 'text' }));
    const anchors = this.parseTrainingData(text);
    this.baseAnchors = anchors;
    const customAnchors = this.getCustomAnchors();
    const allAnchors = [...anchors, ...customAnchors];
    this.families = Array.from(new Set(allAnchors.map(s => s.family)));
    this.anchorsRevision.update(n => n + 1);
    this.tryRestoreSavedModel();
  }

  private isTraining = false;

  /** Stable hash of base file + custom anchors so saved weights stay valid only for matching training data. */
  private computeTrainingFingerprint(): string {
    const baseSig = this.baseAnchors
      .map(a => `${a.family}\t${a.hsl.join(',')}`)
      .sort()
      .join('\n');
    const customSig = this.getCustomAnchors()
      .map(a => `${a.themeName}\t${a.family}\t${a.hsl.join(',')}`)
      .sort()
      .join('\n');
    return `${baseSig}|${customSig}|${this.families.join('>')}`;
  }

  private tryRestoreSavedModel(): void {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(this.weightsStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { fingerprint: string; state: NeuralNetworkState };
      if (parsed.fingerprint !== this.computeTrainingFingerprint()) {
        localStorage.removeItem(this.weightsStorageKey);
        return;
      }
      const st = parsed.state;
      if (st.inputSize !== 3 || st.hiddenSize !== 12 || st.outputSize !== this.families.length) {
        localStorage.removeItem(this.weightsStorageKey);
        return;
      }
      this.nn = new NeuralNetwork(st.inputSize, st.hiddenSize, st.outputSize, st);
      this.isReady$.next(true);
      this.anchorsRevision.update(n => n + 1);
    } catch {
      localStorage.removeItem(this.weightsStorageKey);
    }
  }

  private saveWeightsToStorage(): void {
    if (!this.nn || typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        this.weightsStorageKey,
        JSON.stringify({
          fingerprint: this.computeTrainingFingerprint(),
          state: this.nn.getState(),
        })
      );
    } catch (e) {
      console.warn('[ML] could not persist weights', e);
    }
  }

  public async loadAndTrain(onEpoch?: (epoch: number, total: number) => void): Promise<void> {
    if (this.isTraining) return;
    this.isTraining = true;
    try {
      // Refresh anchors in case of custom changes
      const customAnchors = this.getCustomAnchors();
      const allAnchors = [...this.baseAnchors, ...customAnchors];
      this.families = Array.from(new Set(allAnchors.map(s => s.family)));
      this.anchorsRevision.update(n => n + 1);

      // Generate synthetic training data around anchors
    const trainingData: TrainingSample[] = [];
    for (const anchor of allAnchors) {
      const userPicked = !!anchor.themeName;
      // Base file: one canonical HSL per family. User override: one real theme should pull in every nearby HSL.
      const sampleCount = userPicked ? 700 : 240;
      trainingData.push(
        ...this.generateSyntheticSamples(anchor, sampleCount, { userPickedTheme: userPicked })
      );
    }

    // 3 inputs (H, S, L), 12 hidden neurons, families.length outputs
    const newNn = new NeuralNetwork(3, 12, this.families.length);

    console.info('[ML] training started', {
      epochs: ML_TRAINING_EPOCHS,
      families: this.families.length,
      trainingSamples: trainingData.length,
      uiEvery: ML_TRAINING_UI_EVERY,
    });

    for (let epoch = 0; epoch < ML_TRAINING_EPOCHS; epoch++) {
      for (const sample of trainingData) {
        const inputs = this.normalizeHSL(sample.hsl);
        const targets = this.families.map(f => (f === sample.family ? 1 : 0));
        newNn.train(inputs, targets);
      }
      const current = epoch + 1;
      const showProgress =
        current === 1 ||
        current % ML_TRAINING_UI_EVERY === 0 ||
        current === ML_TRAINING_EPOCHS;
      if (showProgress) {
        this.trainingEpoch.set(current);
        onEpoch?.(current, ML_TRAINING_EPOCHS);
        console.info(`[ML] training epoch ${current} / ${ML_TRAINING_EPOCHS}`);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    this.nn = newNn;
    this.saveWeightsToStorage();
    this.isReady$.next(true);
    this.anchorsRevision.update(n => n + 1); // nn is not a signal; bump so UI resort uses new weights
    console.info('[ML] training complete', {
      families: this.families.length,
      epochs: ML_TRAINING_EPOCHS,
    });
    } finally {
      this.isTraining = false;
      this.trainingEpoch.set(null);
    }
  }

  private baseAnchors: TrainingSample[] = [];

  public getAnchors() {
    return {
      base: this.baseAnchors,
      custom: this.getCustomAnchors()
    };
  }

  public predict(h: number, s: number, l: number): string {
    return this.classify(h, s, l);
  }

  /**
   * Nearest of the 15 semantic families: Oklab ΔE when chroma is high; achromatic → Neutral; low chroma → hue buckets.
   * `isDark` defaults from `l` when omitted (JSON `isDark` is more reliable for edge themes).
   */
  public classifyThemeColor(hex: string, h: number, s: number, l: number, isDark?: boolean): string {
    const lab: Oklab = hexToOklab(hex) ?? hslToOklab(h, s, l);
    const dark = isDark ?? l < 50;
    const spread = rgbChannelSpreadFromHex(hex) ?? rgbChannelSpreadFromHsl(h, s, l);
    return this.classifyFromLab(lab, h, dark, spread);
  }

  private classifyFromLab(lab: Oklab, hue: number, isDark: boolean, rgbSpread: number): string {
    const chroma = oklabChroma(lab);
    if (chroma < CHROMA_ACHROMATIC && rgbSpread <= RGB_SPREAD_NEUTRAL) {
      return isDark ? 'Dark Neutral' : 'Light Neutral';
    }
    if (chroma < CHROMA_HUE_BUCKET) {
      return this.nearestFamilyByHue(hue, isDark);
    }
    let pick = this.nearestFamilyOklab(lab);
    pick = this.reconcileOklabPickWithHue(pick, hue, isDark);
    /** JSON `isDark` vs vivid bg (e.g. Hot Dog Stand `#ea3323`) — Oklab can land on a light family; trust hue into dark families. */
    if (isDark && this.isLightFamilyLabel(pick)) {
      return this.nearestFamilyByHue(hue, true);
    }
    if (!isDark && this.isDarkFamilyLabel(pick)) {
      return this.nearestFamilyByHue(hue, false);
    }
    return pick;
  }

  /** When ΔE ties across anchors, Oklab can pick the wrong hue sector (e.g. indigo `#40318d` → Dark Cyan). */
  private reconcileOklabPickWithHue(oklabPick: string, hue: number, isDark: boolean): string {
    if (oklabPick === 'Dark Neutral' || oklabPick === 'Light Neutral') {
      return oklabPick;
    }
    const anchorHue = ANCHOR_HUE_BY_FAMILY[oklabPick];
    if (anchorHue === undefined) {
      return oklabPick;
    }
    if (this.hueDistanceDeg(hue, anchorHue) <= HUE_MISMATCH_MAX_DEG) {
      return oklabPick;
    }
    return this.nearestFamilyByHue(hue, isDark);
  }

  private isLightFamilyLabel(name: string): boolean {
    const i = paletteOrderIndex(name);
    if (i === 999) return false;
    return i >= 8;
  }

  private isDarkFamilyLabel(name: string): boolean {
    const i = paletteOrderIndex(name);
    if (i === 999) return false;
    return i <= 7;
  }

  private hueDistanceDeg(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  }

  /** When Oklab chroma is tiny, circular hue distance to semantic anchor hues (see CHROMA_HUE_BUCKET). */
  private nearestFamilyByHue(hue: number, isDark: boolean): string {
    const table = isDark ? DARK_HUE_ANCHORS : LIGHT_HUE_ANCHORS;
    let best = table[0];
    let bestDist = this.hueDistanceDeg(hue, best.hue);
    let bestOrder = paletteOrderIndex(best.family);
    for (const row of table) {
      const d = this.hueDistanceDeg(hue, row.hue);
      const ord = paletteOrderIndex(row.family);
      if (d < bestDist || (d === bestDist && ord < bestOrder)) {
        bestDist = d;
        best = row;
        bestOrder = ord;
      }
    }
    return best.family;
  }

  private generateSyntheticSamples(
    anchor: TrainingSample,
    count: number,
    opts: { userPickedTheme: boolean }
  ): TrainingSample[] {
    const samples: TrainingSample[] = [anchor];
    const [h, s, l] = anchor.hsl;
    const isLightClass = l > 50;
    const u = opts.userPickedTheme;
    /** Base anchors: tight jitter so global families do not bleed. User-picked: wide cloud around that theme’s HSL so one label covers neighbors. */
    const hueJitter = u ? 28 : 14;
    const satSpan = u ? 44 : 30;
    const satHalf = satSpan / 2;

    for (let i = 0; i < count - 1; i++) {
      const newH = (h + (Math.random() * (2 * hueJitter) - hueJitter) + 360) % 360;
      const newS = Math.max(0, Math.min(100, s + (Math.random() * satSpan - satHalf)));

      let newL: number;
      if (isLightClass) {
        const lSpan = u ? 38 : 30;
        newL = Math.max(70, Math.min(100, l + (Math.random() * lSpan - lSpan / 2)));
      } else {
        const lSpan = u ? 26 : 20;
        newL = Math.max(0, Math.min(35, l + (Math.random() * lSpan - lSpan / 2)));
      }

      samples.push({
        family: anchor.family,
        hsl: [newH, newS, newL]
      });
    }
    return samples;
  }

  private parseTrainingData(text: string): TrainingSample[] {
    const anchors: TrainingSample[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [family, semanticName] = trimmed.split(':');
      if (!family || !semanticName) continue;

      const sName = semanticName.trim().toLowerCase();
      const hsl = this.semanticColors[sName];
      if (hsl) {
        const fName = family.trim();
        this.familyToSemantic[fName] = sName;
        anchors.push({ family: fName, hsl });
      } else {
        // Check if it's an HSL definition
        const values = semanticName.split(',').map(v => parseFloat(v.trim()));
        if (values.length === 3 && !values.some(isNaN)) {
          anchors.push({ family: family.trim(), hsl: values as [number, number, number] });
        }
      }
    }
    return anchors;
  }

  private normalizeHSL(hsl: [number, number, number]): number[] {
    return [hsl[0] / 360, hsl[1] / 100, hsl[2] / 100];
  }

  /** Smallest ΔE in Oklab to base + custom anchor HSLs (anchors converted to Oklab the same way). */
  private nearestFamilyOklab(lab: Oklab): string {
    if (this.baseAnchors.length === 0) return 'Unknown';
    const candidates: TrainingSample[] = [...this.baseAnchors, ...this.getCustomAnchors()];
    let bestFamily = candidates[0].family;
    let bestD = Infinity;
    for (const a of candidates) {
      const [ah, as, al] = a.hsl;
      const alab = hslToOklab(ah, as, al);
      const d = oklabDeltaE(lab, alab);
      if (d < bestD) {
        bestD = d;
        bestFamily = a.family;
      }
    }
    return bestFamily;
  }

  /** HSL-only path (no hex) — same rules as `classifyThemeColor`. */
  public classify(h: number, s: number, l: number): string {
    const lab = hslToOklab(h, s, l);
    const spread = rgbChannelSpreadFromHsl(h, s, l);
    return this.classifyFromLab(lab, h, l < 50, spread);
  }

  public getFamilyMetadata() {
    return this.families.map(name => {
      const hsl = this.semanticColors[this.familyToSemantic[name]] || [0, 0, 50];
      return {
        name,
        semanticVar: semanticVarForFamily(name),
        isDark: hsl[2] < 50
      };
    });
  }

  // Custom User Anchors Persistence
  public addCustomAnchor(themeName: string, family: string, hsl: [number, number, number]) {
    if (typeof window === 'undefined') return;
    const anchors = this.getCustomAnchors();
    const existingIdx = anchors.findIndex(a => a.themeName === themeName);
    if (existingIdx !== -1) {
      anchors[existingIdx] = { themeName, family, hsl };
    } else {
      anchors.push({ themeName, family, hsl });
    }
    localStorage.setItem(this.storageKey, JSON.stringify(anchors));
    localStorage.removeItem(this.weightsStorageKey);
  }

  public removeCustomAnchor(themeName: string) {
    if (typeof window === 'undefined') return;
    const anchors = this.getCustomAnchors();
    const filtered = anchors.filter(a => a.themeName !== themeName);
    localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    localStorage.removeItem(this.weightsStorageKey);
  }

  public getCustomAnchorFamily(themeName: string): string | null {
    const anchors = this.getCustomAnchors();
    return anchors.find(a => a.themeName === themeName)?.family || null;
  }

  private getCustomAnchors(): TrainingSample[] {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public clearCustomData() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.weightsStorageKey);
    this.nn = null;
    this.families = Array.from(new Set(this.baseAnchors.map(s => s.family)));
    this.isReady$.next(false);
    this.anchorsRevision.update(n => n + 1);
  }
}
