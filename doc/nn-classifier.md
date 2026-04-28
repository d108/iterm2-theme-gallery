# Optional “smart guess” for theme colors (ML mode)

Think of this as a **small automatic helper** inside the browser—not a big AI model. You turn it on with **`?ml=1`**, click **Train** once, and the gallery can use that helper to pick which **color family** (e.g. Dark Blue, Light Neutral) a theme belongs to.

## Plain English

1. **Input:** The theme’s **background color** (usually the `#hex` from the theme file).
2. **Same color language as the rest of the app:** That color is turned into **Oklab**—three numbers that describe lightness and tint in a way that matches human perception better than raw RGB.
3. **Tiny network:** Those three numbers go into a **very small** stack of layers (like a mini spreadsheet with weighted sums). Each **family** gets a score between 0 and 1. The family with the **highest score** is the first guess.
4. **Safety net:** That guess is **checked with simple rules** so it cannot violate obvious facts: a bright blue cannot be filed as “light gray,” and a dark theme cannot stay in a “light-only” bucket. **Your own picks** for a theme (custom anchors) always win and never go through the helper.

**Training** colors many **neighbor samples** in **Oklab** near every textbook swatch in `color-training.txt`, lets Train teach the miniature network which families those samples resemble, then records the tuned parameters in browser **localStorage**.

**Anchors steer training.** After you attach a dropdown override (anchor) and rerun **Train / Relearn**, sampled colors thicken around **that palette’s measured background**, not purely the cookbook swatches. Dark families mix preset palette hues so reds stay reddish; pastel families cling near your tweaks so pale grays do not bleed into unrelated hues. Starter anchors shipped with `color-training.txt` still participate—you primarily add richness where corrections matter—which is why a later re-learn can subtly resort themes you personally never touched.

You do **not** need to know neural networks to use this: train, then browse. If you skip training, the gallery keeps using the **hand-written** Oklab + hue rules only.

## Diagram

<div align="center">

<figure>
  <img src="assets/nn-classifier-flow.svg" width="880" alt="Diagram: colored boxes show how a theme picks a family—automatic helper down the middle, picker shortcut plus training beside it">
  <figcaption>
    <p><strong>Figure.</strong> The last box—<strong>Gallery family label</strong>—is what each theme ends up grouped under everywhere in the gallery. The upright stack of bold arrows is “let the helper pick.” Use that path when training has finished <em>and</em> you have <em>not</em> chosen a family yourself in the dropdown.</p>
    <p><strong>Solid arrows</strong> are the automatic guessing path whenever the assistant should classify a palette. <strong>Dashed arcs</strong> show two sidelines: Train updates saved weights beside that stack, while the picker bypasses the stacked steps altogether when your choice replaces the classifier.</p>
    <p><strong>Down the automatic stack.</strong> Read <strong>background hex</strong> from the palette file → convert it into perceptual coordinates (<strong>Oklab lightness tint</strong>) → scale it for network input (<strong>scale inputs</strong>) → run <strong>Mini net … scores</strong> → take the strongest label (<strong>best score wins</strong>) → run <strong>rule checks … pins</strong> so obvious mistakes bounce off (neutral vs saturated, dark buckets vs light, hue versus each family anchor). The last box prints the <strong>Gallery family label</strong> you sort and browse by.</p>
    <p><strong>Manual dropdown wins</strong> (dashed <em>skip NN plus rules</em>). Saves your choice without running the stacked steps—you see “picker path” beside “helper path,” but never two separate rule passes.</p>
    <p><strong>Training when Train clicked.</strong> The <em>Teaches</em> arrow reminds you Train builds labeled examples tailored to exactly the miniature network pictured here. Rows read top-down: blend default anchors from `color-training.txt` with any themes you already tagged, jitter values then clip unrealistic colors, keep dark practice colors separate from light practice colors inside Train, stash learned weights in browser storage (<strong>Save weights … localStorage</strong>). The dotted <strong>weights reload</strong> hop pointing back toward <strong>Mini net</strong> simply notes that browsing always loads whichever weights Train most recently saved.</p>
  </figcaption>
</figure>

</div>

- **Source (Mermaid):** [`doc/mermaid/nn-classifier-flow.mmd`](mermaid/nn-classifier-flow.mmd)
- **Rendered asset:** [`doc/assets/nn-classifier-flow.svg`](assets/nn-classifier-flow.svg) — regenerate with `npm run render:diagram` (runs `@mermaid-js/mermaid-cli`, then replaces `foreignObject` labels with plain SVG text for reliable preview on GitHub and elsewhere).

## If you want the technical labels

| Plain phrase | What it maps to in code |
|--------------|-------------------------|
| Three Oklab numbers, scaled | Normalized $(L,a,b)$ input |
| Mini stack of layers | 3 → 12 → N sigmoid MLP in `nn.ts` |
| Highest score wins | Argmax over outputs |
| Safety net | `reconcileNeuralPickWithRules` + same ideas as `classifyFromLab` |
| Slightly varied colors | Synthetic Oklab jitter + sRGB clip + lightness gates |

## Source code

- `src/app/ml/nn.ts` — the small network math.
- `src/app/ml/ml.service.ts` — training data, train button behavior, prediction + safety net.
- `src/app/ml/oklab.ts` — converting colors to Oklab.
