import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NeuralNetwork, type NeuralNetworkState } from './nn';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { paletteOrderIndex, semanticVarForFamily } from '../../theme-family-tokens';
import {
  clampOklabToSrgbGamut,
  hexToOklab,
  hslToOklab,
  linearSrgb01ToHsl,
  oklabChroma,
  oklabDeltaE,
  oklabToLinearSrgb01,
  rgbChannelSpreadFromHex,
  rgbChannelSpreadFromHsl,
  type Oklab,
} from './oklab';

/**
 * Full passes over the synthetic set. 600 is enough for this 3→12→N net; 1500 was overkill and
 * over-fit custom clouds when users add a few anchors.
 */
export const ML_TRAINING_EPOCHS = 600;

/** Emitted when `loadAndTrain()` finishes; use with gallery histogram for a full picture. */
export interface MlTrainingRunStats {
  finishedAt: string;
  durationMs: number;
  epochs: number;
  classCount: number;
  /** NN output column order (matches `targets` indices). */
  classOrder: readonly string[];
  trainingRowsByFamily: Record<string, number>;
  gradientStepsByFamily: Record<string, number>;
  totalTrainingRows: number;
  totalGradientSteps: number;
  customAnchorCount: number;
  /** Distinct family labels that have at least one per-theme custom anchor. */
  familiesWithCustomAnchors: readonly string[];
}

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

/** Scale Oklab a/b into ~[−1, 1] for the NN (typical sRGB a,b magnitude ≈ 0.22). */
const NN_OKLAB_AB_SCALE = 0.32;

/** After Oklab jitter + sRGB clip, require HSL lightness in these bands so dark/light families stay separated. */
const SYNTH_DARK_HSL_L_MAX = 44;
const SYNTH_LIGHT_HSL_L_MIN = 62;

interface TrainingSample {
  family: string;
  hsl: [number, number, number];
  themeName?: string;
  /** Theme background hex when user-picked — matches `predictNeuralFamily` (hex-first Oklab). */
  bgHex?: string;
}

interface OklabTrainingSample {
  family: string;
  lab: Oklab;
  /** Extra gradient steps per epoch (custom rows train the net harder). */
  trainReps?: number;
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
  private weightsStorageKey = 'iterm2_ml_nn_weights_v2';

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
      .map(
        a =>
          `${a.themeName}\t${a.family}\t${a.hsl.join(',')}\t${a.bgHex ?? ''}`
      )
      .sort()
      .join('\n');
    return `${baseSig}|${customSig}|${this.families.join('>')}`;
  }

  private tryRestoreSavedModel(): void {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(this.weightsStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        fingerprint: string;
        inputKind?: string;
        state: NeuralNetworkState;
      };
      if (parsed.inputKind !== 'oklab') {
        localStorage.removeItem(this.weightsStorageKey);
        return;
      }
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
          inputKind: 'oklab',
          state: this.nn.getState(),
        })
      );
    } catch (e) {
      console.warn('[ML] could not persist weights', e);
    }
  }

  public async loadAndTrain(
    onEpoch?: (epoch: number, total: number) => void
  ): Promise<MlTrainingRunStats | null> {
    if (this.isTraining) return null;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.isTraining = true;
    try {
      // Refresh anchors in case of custom changes
      const customAnchors = this.getCustomAnchors();
      const allAnchors = [...this.baseAnchors, ...customAnchors];
      this.families = Array.from(new Set(allAnchors.map(s => s.family)));
      this.anchorsRevision.update(n => n + 1);

      // Synthetic Oklab clouds: base rows stay on file centroids only; custom rows are a tight cloud around that theme (no shifting base clouds — avoids sucking in unrelated themes).
    const trainingData: OklabTrainingSample[] = [];
    for (const anchor of allAnchors) {
      const userPicked = !!anchor.themeName;
      const sampleCount = userPicked ? 320 : 240;
      trainingData.push(
        ...this.generateSyntheticOklabSamples(anchor, sampleCount, {
          userPickedTheme: userPicked,
        })
      );
    }

    // 3 inputs (Oklab L, a, b — normalized), 12 hidden, one logit per family
    const newNn = new NeuralNetwork(3, 12, this.families.length);

    console.info('[ML] training started', {
      epochs: ML_TRAINING_EPOCHS,
      families: this.families.length,
      trainingSamples: trainingData.length,
      customAnchorFamilies: new Set(customAnchors.map(c => c.family)).size,
      uiEvery: ML_TRAINING_UI_EVERY,
      inputSpace: 'oklab',
    });

    for (let epoch = 0; epoch < ML_TRAINING_EPOCHS; epoch++) {
      for (const sample of trainingData) {
        const inputs = this.normalizeOklabForNn(sample.lab);
        const targets = this.families.map(f => (f === sample.family ? 1 : 0));
        const reps = sample.trainReps ?? 1;
        for (let r = 0; r < reps; r++) {
          newNn.train(inputs, targets);
        }
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

    const trainingRowsByFamily: Record<string, number> = {};
    const gradientStepsByFamily: Record<string, number> = {};
    let totalGradientSteps = 0;
    for (const s of trainingData) {
      trainingRowsByFamily[s.family] = (trainingRowsByFamily[s.family] ?? 0) + 1;
      const reps = s.trainReps ?? 1;
      gradientStepsByFamily[s.family] = (gradientStepsByFamily[s.family] ?? 0) + reps;
      totalGradientSteps += reps;
    }
    const stats: MlTrainingRunStats = {
      finishedAt: new Date().toISOString(),
      durationMs:
        typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0,
      epochs: ML_TRAINING_EPOCHS,
      classCount: this.families.length,
      classOrder: [...this.families],
      trainingRowsByFamily,
      gradientStepsByFamily,
      totalTrainingRows: trainingData.length,
      totalGradientSteps,
      customAnchorCount: customAnchors.length,
      familiesWithCustomAnchors: [
        ...new Set(customAnchors.map(c => c.family)),
      ].sort(),
    };

    this.nn = newNn;
    this.saveWeightsToStorage();
    this.isReady$.next(true);
    this.anchorsRevision.update(n => n + 1); // nn is not a signal; bump so UI resort uses new weights
    console.info('[ML] training complete', {
      families: this.families.length,
      epochs: ML_TRAINING_EPOCHS,
      report: stats,
    });
    return stats;
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
    if (!this.nn) return this.classify(h, s, l);
    return this.familyFromNnOutputs(this.nn.predict(this.normalizeOklabForNn(hslToOklab(h, s, l))));
  }

  /**
   * Argmax over trained outputs; null if no weights loaded. Uses Oklab from hex when available.
   * Reconciles with the same physics as `classifyFromLab`: neutrals require low chroma + low RGB spread;
   * dark themes cannot stay on light-only families (and vice versa). Without this, a small net can
   * map saturated blues (e.g. Borland `#0000a4`) to Light Neutral even though ΔE to light anchors is huge.
   */
  public predictNeuralFamily(
    hex: string,
    h: number,
    s: number,
    l: number,
    isDark?: boolean
  ): string | null {
    if (!this.nn) return null;
    const lab = hexToOklab(hex) ?? hslToOklab(h, s, l);
    const spread = rgbChannelSpreadFromHex(hex) ?? rgbChannelSpreadFromHsl(h, s, l);
    const dark = isDark ?? l < 50;
    const raw = this.familyFromNnOutputs(this.nn.predict(this.normalizeOklabForNn(lab)));
    return this.reconcileNeuralPickWithRules(raw, lab, h, dark, spread);
  }

  /** Apply rule-based sanity checks to an NN label so training noise cannot violate color physics. */
  private reconcileNeuralPickWithRules(
    nnPick: string,
    lab: Oklab,
    hue: number,
    isDark: boolean,
    rgbSpread: number
  ): string {
    const chroma = oklabChroma(lab);
    const achromatic = chroma < CHROMA_ACHROMATIC && rgbSpread <= RGB_SPREAD_NEUTRAL;
    if ((nnPick === 'Dark Neutral' || nnPick === 'Light Neutral') && !achromatic) {
      return this.classifyFromLab(lab, hue, isDark, rgbSpread);
    }
    if (isDark && this.isLightFamilyLabel(nnPick)) {
      return this.nearestFamilyByHue(hue, true);
    }
    if (!isDark && this.isDarkFamilyLabel(nnPick)) {
      return this.nearestFamilyByHue(hue, false);
    }
    return nnPick;
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

  /** Oklab of the canonical swatch in `color-training.txt` for this family, if known. */
  private canonicalOklabForFamily(family: string): Oklab | null {
    const sem = this.familyToSemantic[family];
    if (!sem) return null;
    const hsl = this.semanticColors[sem];
    if (!hsl) return null;
    return hslToOklab(hsl[0], hsl[1], hsl[2]);
  }

  private lerpOklab(a: Oklab, b: Oklab, t: number): Oklab {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  /**
   * Light vs dark lane for synthetic HSL gates must follow the **label** (semantic family), not
   * `anchor.hsl` lightness. Otherwise a vivid dark-theme red (e.g. Hot Dog Stand L≈53) trains
   * “Dark Red” only on pale reds (L≥62) and never pulls in true dark reds like Red Alert.
   */
  private synthHslLightnessGate(anchor: TrainingSample, hslL: number): boolean {
    const ord = paletteOrderIndex(anchor.family);
    if (ord >= 8) return hslL >= SYNTH_LIGHT_HSL_L_MIN;
    if (ord <= 7) return hslL <= SYNTH_DARK_HSL_L_MAX;
    return anchor.hsl[2] > 50
      ? hslL >= SYNTH_LIGHT_HSL_L_MIN
      : hslL <= SYNTH_DARK_HSL_L_MAX;
  }

  /** Oklab for an anchor; custom rows prefer bg hex so training matches NN inference. */
  private anchorToOklab(anchor: TrainingSample): Oklab {
    const [h, sl, ll] = anchor.hsl;
    if (anchor.bgHex) {
      const fromHex = hexToOklab(anchor.bgHex);
      if (fromHex) return fromHex;
    }
    return hslToOklab(h, sl, ll);
  }

  private generateSyntheticOklabSamples(
    anchor: TrainingSample,
    count: number,
    opts: { userPickedTheme: boolean }
  ): OklabTrainingSample[] {
    const [h, s, l] = anchor.hsl;
    const anchorLab = this.anchorToOklab(anchor);
    const u = opts.userPickedTheme;
    const samples: OklabTrainingSample[] = [{ family: anchor.family, lab: anchorLab }];
    const centroid = this.canonicalOklabForFamily(anchor.family);
    let jitterOrigin = anchorLab;
    /** Dark: small blend toward file centroid (helps maroons vs bright reds). Light: stay on the anchored theme only — blending toward e.g. light gray balloons the class. */
    if (u && centroid && this.isDarkFamilyLabel(anchor.family)) {
      jitterOrigin = this.lerpOklab(anchorLab, centroid, 0.42);
    }
    /** Tight cloud for user anchors so one correction does not relabel the whole gallery. */
    const dL = u ? 0.045 : 0.052;
    const chromaR = u ? 0.048 : 0.056;
    const maxAttempts = (count - 1) * 14;
    let accepted = 0;
    for (let attempt = 0; attempt < maxAttempts && accepted < count - 1; attempt++) {
      const dl = (Math.random() * 2 - 1) * dL;
      const ang = Math.random() * Math.PI * 2;
      const cr = Math.random() * chromaR;
      const da = Math.cos(ang) * cr;
      const db = Math.sin(ang) * cr;
      const raw: Oklab = [jitterOrigin[0] + dl, jitterOrigin[1] + da, jitterOrigin[2] + db];
      const lab = clampOklabToSrgbGamut(raw);
      if (!lab) continue;
      const [r01, g01, b01] = oklabToLinearSrgb01(lab);
      if (![r01, g01, b01].every(Number.isFinite)) continue;
      const [, , hslL] = linearSrgb01ToHsl(r01, g01, b01);
      if (!this.synthHslLightnessGate(anchor, hslL)) continue;
      samples.push({ family: anchor.family, lab });
      accepted++;
    }
    while (samples.length < count) {
      samples.push({ family: anchor.family, lab: anchorLab });
    }
    return samples;
  }

  private normalizeOklabForNn(lab: Oklab): number[] {
    return [
      Math.min(1, Math.max(0, lab[0])),
      Math.max(-1.25, Math.min(1.25, lab[1] / NN_OKLAB_AB_SCALE)),
      Math.max(-1.25, Math.min(1.25, lab[2] / NN_OKLAB_AB_SCALE)),
    ];
  }

  private familyFromNnOutputs(outputs: number[]): string {
    let best = 0;
    for (let i = 1; i < outputs.length; i++) {
      if (outputs[i] > outputs[best]) best = i;
    }
    return this.families[best] ?? 'Unknown';
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

  /** Smallest ΔE in Oklab to base + custom anchors (hex-first for customs, same as training / predict). */
  private nearestFamilyOklab(lab: Oklab): string {
    if (this.baseAnchors.length === 0) return 'Unknown';
    const candidates: TrainingSample[] = [...this.baseAnchors, ...this.getCustomAnchors()];
    let bestFamily = candidates[0].family;
    let bestD = Infinity;
    for (const a of candidates) {
      const alab = this.anchorToOklab(a);
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
    return [...this.families]
      .sort((a, b) => paletteOrderIndex(a) - paletteOrderIndex(b))
      .map(name => {
        const hsl = this.semanticColors[this.familyToSemantic[name]] || [0, 0, 50];
        return {
          name,
          semanticVar: semanticVarForFamily(name),
          isDark: hsl[2] < 50
        };
      });
  }

  // Custom User Anchors Persistence
  public addCustomAnchor(
    themeName: string,
    family: string,
    hsl: [number, number, number],
    bgHex: string
  ) {
    if (typeof window === 'undefined') return;
    const anchors = this.getCustomAnchors();
    const row: TrainingSample = { themeName, family, hsl, bgHex };
    const existingIdx = anchors.findIndex(a => a.themeName === themeName);
    if (existingIdx !== -1) {
      anchors[existingIdx] = row;
    } else {
      anchors.push(row);
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
