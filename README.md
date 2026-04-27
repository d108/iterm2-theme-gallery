# iTerm2 Color Schemes Gallery

<div align="center">
  <table align="center" style="margin: 0 auto;">
    <tr valign="top">
      <td width="65%" rowspan="2" align="center">
        <img src="public/images/desktop-preview.png" alt="Desktop Preview">
      </td>
      <td width="30%" align="center">
        <img src="public/images/mobile-preview-portrait.png" alt="Mobile Portrait Preview">
      </td>
    </tr>
    <tr valign="top">
      <td width="30%" align="center">
        <img src="public/images/mobile-preview-landscape.png" alt="Mobile Landscape Preview">
      </td>
    </tr>
    <tr>
      <td colspan="2" align="center">
        <em>Desktop, Mobile Portrait, and Mobile Landscape optimized views</em>
      </td>
    </tr>
  </table>
</div>

A responsive visual gallery for exploring iTerm2 color schemes by text and background color.

**Live site:** [https://d108.github.io/iterm2-theme-gallery/](https://d108.github.io/iterm2-theme-gallery/)

## Motivation

I am very appreciative of the work that has gone into iTerm2 and the color schemes at [iterm2colorschemes.com](https://iterm2colorschemes.com/).

I found it difficult to match a scheme preview to what it actually looks like in a terminal, and I am primarily interested in choosing themes by background color.

This project is intended to reduce the UI friction around browsing, sorting, selecting, and installing color schemes.

## Color Classification

The gallery uses deterministic color rules rather than neural-network inference:

1. A direct custom override for that exact theme.
2. Oklab nearest-anchor matching for high-chroma colors.
3. Hue buckets for low-chroma colors.
4. Neutral, light, and dark consistency rules.

## Features

- Browse rendered previews and screenshots of iTerm2 color schemes.
- Sort and group themes by background color using Oklab and hue-based rules.
- [Build and patch iTerm2 preferences from the gallery](#build-and-patch-workflow): Select themes from **Rendered** card checkboxes or **Index** row checkboxes and generate an iTerm2 plist report (The GitHub Pages site is preview-only).
    - Run locally with `npm run build && npm run serve:ssr:iterm-gallery`
    - Open `http://localhost:4000` in your browser.
- Patch iTerm2 preferences to import selected color schemes, bypassing manual imports.
    - Guided installation with `make patch`
- iTerm2 requires a restart to see newly imported color schemes.

## Neural Network

- An attempt was made to use a neural network to classify the background colors into a fixed classification scheme, but Oklab-based color rules turned out to match the desired behavior better.
- There is a training UI that can save custom anchors and retrain a small demo model using synthetic HSL samples around those anchors, if you want to experiment with the neural network approach.
- Otherwise, gallery sorting, badges, and generated JSON use a deterministic Oklab and hue classifier, not neural-network predictions.

### Neural network (ML) UI

There is no separate command for the ML UI: run the same dev server as the gallery (`npm install`, then `npm start`), then open the app with **`?ml=1`** (or `?ml=true` / `?ml=yes`) on the URL so ML mode turns on—for example:

```bash
npm start
# In the browser: http://localhost:4200/?ml=1
```

The query parameter is removed from the address bar after load, but ML stays active. You should see **ML Active**, **Train Model** / **Relearn**, and a **Training Set** view next to Rendered / Screenshot / Index. Use **ML Active** to turn the experiment off again.

On the [live GitHub Pages site](https://d108.github.io/iterm2-theme-gallery/), append the same query (for example []`…/iterm2-theme-gallery/?ml=1`).

## Installation

1.  Navigate to the app directory:
    ```bash
    cd iterm2-theme-gallery
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm start
    ```
4.  Open `http://localhost:4200` in your browser.

## Build and Patch Workflow

To write generated plist reports to `user_data`, run the built SSR app:

```bash
npm run build && npm run serve:ssr:iterm-gallery
```

Then select themes in the gallery and run:

```bash
make patch
```

The patcher saves a backup under `user_data/backups/` before overwriting the live iTerm2 plist.

See [doc/sample_theme_patch.md](doc/sample_theme_patch.md) for a sample patch run.

## Source Data

The gallery renders screenshots from the `mbadolato/iTerm2-Color-Schemes` repository, which are processed and served from the `public/screenshots` directory. The canonical web reference for the broader scheme collection is [https://iterm2colorschemes.com/](https://iterm2colorschemes.com/).

## License

This project is released under the [MIT License](LICENSE).
