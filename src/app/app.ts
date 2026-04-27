import { ApplicationRef, Component, computed, inject, OnInit, signal, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { MLService, ML_TRAINING_EPOCHS } from './ml/ml.service';
import {
  cssVarRef,
  PALETTE_FAMILY_ORDER,
  paletteOrderIndex,
  semanticVarForFamily,
} from '../theme-family-tokens';

interface ThemePalette {
  bg: string; fg: string;
  cursor: string; cursorText: string;
  selection: string; selectionText: string;
  ansi0: string; ansi1: string; ansi2: string; ansi3: string; 
  ansi4: string; ansi5: string; ansi6: string; ansi7: string;
  ansi8: string; ansi9: string; ansi10: string; ansi11: string; 
  ansi12: string; ansi13: string; ansi14: string; ansi15: string;
}

interface Theme {
  name: string;
  filename: string;
  colors: ThemePalette;
  isDark: boolean;
  hue: number;
  sat: number;
  light: number;
  family: string;
}

interface Family {
  id: string;
  startIndex: number;
  label: string;
  isDark: boolean;
  semanticVar: string;
}

interface FamilyJson {
  id: string;
  startIndex: number;
  label: string;
  color: string;
  isDark: boolean;
}

interface DataResponse {
  themes: Theme[];
  families: FamilyJson[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header [class.collapsed]="isHeaderCollapsed()">
      <h1>iTerm2 Color Schemes Gallery</h1>
      <p class="plist-help">
        <span class="desktop-only">
          To prepare schemes for <strong>iTerm2 on macOS</strong>, use the <strong>checkbox</strong> on each card in <strong>Rendered</strong> view or each row in <strong>Index</strong> view to choose themes (Screenshot view is preview-only), then click <strong>Make Plist</strong> for an <strong>iTerm2 plist</strong> report you can use for installation.
        </span>
        <span class="phone-only">
          Browse through hundreds of color schemes for iTerm2. To install themes on your Mac, use this gallery on a desktop browser to select schemes and generate a Plist report.
        </span>
      </p>
      <div class="nav-bar">
        <div class="color-navigator desktop-palette">
          @for (fam of activeFamilies(); track fam.id) {
            <button 
              class="family-btn" 
              [style.background-color]="cssVarRefFn(fam.semanticVar)" 
              [title]="'Jump to ' + fam.label"
              (click)="scrollToIndex(fam.startIndex)">
            </button>
          }
        </div>
        <div class="color-navigator phone-palette">
          <div class="palette-row">
            @for (fam of darkFamilies(); track fam.id) {
              <button 
                class="family-btn" 
                [style.background-color]="cssVarRefFn(fam.semanticVar)" 
                [title]="'Jump to ' + fam.label"
                (click)="scrollToIndex(fam.startIndex)">
              </button>
            }
          </div>
          <div class="palette-row">
            @for (fam of lightFamilies(); track fam.id) {
              <button 
                class="family-btn" 
                [style.background-color]="cssVarRefFn(fam.semanticVar)" 
                [title]="'Jump to ' + fam.label"
                (click)="scrollToIndex(fam.startIndex)">
              </button>
            }
          </div>
        </div>
      </div>

      <div class="controls-row">
        <div class="control-group filter-group">
          <span class="group-label">Filter:</span>
          <button (click)="filterMode.set('all')" [class.active]="filterMode() === 'all'">All</button>
          <button (click)="filterMode.set('dark')" [class.active]="filterMode() === 'dark'">Dark Only</button>
          <button (click)="filterMode.set('light')" [class.active]="filterMode() === 'light'">Light Only</button>
        </div>

        <div class="control-group hide-on-phone">
          <span class="group-label">View:</span>
          <button (click)="viewMode.set('data')" [class.active]="viewMode() === 'data'">Rendered</button>
          <button (click)="viewMode.set('screenshot')" [class.active]="viewMode() === 'screenshot'">Screenshot</button>
          <button (click)="viewMode.set('index')" [class.active]="viewMode() === 'index'">Index</button>
          @if (useML()) {
            <button (click)="viewMode.set('training')" [class.active]="viewMode() === 'training'">Training Set</button>
          }
        </div>

        <div class="control-group hide-on-phone">
          <span class="group-label">Report:</span>
          <button (click)="generatePlistReport()" [disabled]="selectedThemes().size === 0" [title]="'Generate iTerm2 (macOS) plist for ' + selectedThemes().size + ' selected theme(s)'">
            Make Plist ({{ selectedThemes().size }})
          </button>
        </div>

        @if (useML()) {
          <div class="control-group">
            <span class="group-label">ML:</span>
            <button (click)="onToggleML()" [class.active]="true" title="Turn ML mode off">
              ML Active
            </button>

            @if (!mlReady()) {
              @if (isTraining()) {
                <div class="ml-status-badge learning">
                  <span class="dot"></span>
                  <span class="ml-epoch-text">Training {{ trainingEpochLabel() }}</span>
                </div>
              } @else {
                <button (click)="relearn()" class="active">Train Model</button>
              }
            } @else {
              @if (isTraining()) {
                <div class="ml-status-badge learning">
                  <span class="dot"></span>
                  <span class="ml-epoch-text">Training {{ trainingEpochLabel() }}</span>
                </div>
              } @else {
                <button (click)="relearn()">Relearn</button>
                <button (click)="clearCustomTraining()" title="Clear browser training data">Reset</button>
              }
            }
          </div>
        }

        @if (showDebugControl()) {
          <div class="control-group">
            <button (click)="debugMode.set(!debugMode())" [class.debug-active]="debugMode()">
              {{ debugMode() ? 'Hide Grid' : 'Debug Grid' }}
            </button>
          </div>
        }
      </div>
    </header>

    @if (reportContent()) {
      <div id="plist-report" class="report-section">
        <div class="report-header">
          <div class="report-title-group">
            <h3>Generated iTerm2 Plist Dictionary</h3>
            <span class="save-status" [class]="saveStatus()">
              @if (saveStatus() === 'saving') { ⏳ Saving for CLI... }
              @if (saveStatus() === 'saved') { ✅ Ready for 'make patch' }
              @if (saveStatus() === 'error') { ❌ Failed to save for CLI (Make sure server is running) }
            </span>
          </div>
          <div class="report-actions">
            <button (click)="copyReport()">Copy to Clipboard</button>
            <button (click)="clearReport()">Clear</button>
          </div>
        </div>
        <pre class="report-code"><code>{{ reportContent() }}</code></pre>
      </div>
    }

    @if (viewMode() === 'index') {
      <div class="index-list">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" disabled title="Use the checkboxes in each row to include themes in the iTerm2 plist report"></th>
              <th>#</th>
              <th>Name</th>
              <th>BG Hex</th>
              <th>Swatch</th>
              <th>Group</th>
              <th>HSL</th>
            </tr>
          </thead>
          <tbody>
            @for (theme of filteredThemes(); track theme.name; let i = $index) {
              <tr class="index-row" [class.selected]="isThemeSelected(theme.name)">
                <td>
                  <input type="checkbox"
                    title="Include this theme in the iTerm2 (macOS) plist report"
                    [checked]="isThemeSelected(theme.name)"
                    (click)="toggleSelection(theme, $event)">
                </td>
                <td (click)="goToTheme(theme)">{{ i + 1 }}</td>
                <td (click)="goToTheme(theme)"><strong>{{ theme.name }}</strong></td>
                <td (click)="goToTheme(theme)"><code>{{ theme.colors.bg }}</code></td>
                <td (click)="goToTheme(theme)">
                  <div class="swatch-large" [style.background-color]="theme.colors.bg"></div>
                </td>
                <td>
                  @if (useML()) {
                    <div style="font-size: 0.7rem; color: #aaa; font-weight: 500;">ML: {{ getPrediction(theme) }}</div>
                    <select class="family-select" 
                      [disabled]="isTraining()"
                      [value]="getCustomFamily(theme)"
                      (change)="onFamilyChange(theme, $event)">
                      <option value="none">-- Use ML --</option>
                      @for (fam of getMLFamilies(); track fam) {
                        <option [value]="fam">{{ fam }}</option>
                      }
                    </select>
                  } @else {
                    {{ theme.family }}
                  }
                </td>
                <td>H:{{ theme.hue | number:'1.0-0' }} S:{{ theme.sat | number:'1.0-0' }} L:{{ theme.light | number:'1.0-0' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else if (viewMode() === 'training') {
      <div class="index-list">
        <h2>Base Training Set (from color-training.txt)</h2>
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th>HSL</th>
              <th>Swatch</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            @for (anchor of getAnchors().base; track $index) {
              <tr class="index-row">
                <td><strong>{{ anchor.family }}</strong></td>
                <td>H:{{ anchor.hsl[0] | number:'1.0-0' }} S:{{ anchor.hsl[1] | number:'1.0-0' }} L:{{ anchor.hsl[2] | number:'1.0-0' }}</td>
                <td>
                  <div class="swatch-large" [style.background-color]="anchorSwatchStyle(anchor.family)"></div>
                </td>
                <td>Base</td>
              </tr>
            }
          </tbody>
        </table>

        <div class="training-custom-header">
          <h2>Custom User Anchors (from Browser)</h2>
          <button
            type="button"
            class="btn-remove-all-custom"
            [disabled]="getAnchors().custom.length === 0"
            [title]="getAnchors().custom.length === 0 ? 'Add overrides from the gallery first' : 'Clear every custom theme override and retrain from base set'"
            (click)="removeAllCustomAnchors()">
            Remove all custom anchors
          </button>
        </div>
        @if (getAnchors().custom.length === 0) {
          <p style="color: #666; padding: 1rem;">No custom anchors set. Classify themes in the gallery to add some!</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Theme</th>
                <th>Family</th>
                <th>HSL</th>
                <th>Swatch</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              @for (anchor of getAnchors().custom; track anchor.themeName) {
                <tr class="index-row">
                  <td><strong>{{ anchor.themeName }}</strong></td>
                  <td>{{ anchor.family }}</td>
                  <td>H:{{ anchor.hsl[0] | number:'1.0-0' }} S:{{ anchor.hsl[1] | number:'1.0-0' }} L:{{ anchor.hsl[2] | number:'1.0-0' }}</td>
                  <td>
                    <div class="swatch-large" [style.background-color]="anchorSwatchStyle(anchor.family)"></div>
                  </td>
                  <td>
                    <button (click)="removeAnchor(anchor)">
                      Remove
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    } @else {
      <main class="gallery" [class.screenshot-view]="viewMode() === 'screenshot'" [class.debug]="debugMode()">
        @for (theme of filteredThemes(); track theme.name) {
          <div class="card" [id]="'theme-' + theme.name" [style.background-color]="theme.colors.bg">
            @if (viewMode() === 'data') {
              <div class="card-header-overlay">
                <input type="checkbox"
                  [checked]="isThemeSelected(theme.name)"
                  (click)="toggleSelection(theme, $event)"
                  title="Include this theme in the iTerm2 (macOS) plist report">
              </div>
            }
            <div class="family-indicator" [style.background-color]="getThemeFamilyColor(theme)"></div>
            @if (viewMode() === 'data') {
              <div class="terminal" [style.color]="theme.colors.fg">
                <div class="terminal-grid">
                  <div class="header-col-1">
                    <div class="box" [style.background-color]="theme.colors.cursor" [style.color]="theme.colors.cursorText">Cur</div>
                    <div class="box" [style.background-color]="theme.colors.selection" [style.color]="theme.colors.selectionText">Sel</div>
                  </div>
                  <div></div>

                  <span class="code">m</span><span class="sample" [style.color]="theme.colors.fg">qYw</span>
                  <span class="code">1;m</span><span class="sample" [style.color]="theme.colors.fg" style="font-weight: bold;">qYw</span>
                  <div class="row-divider"></div>
                  <span class="code">30m</span><span class="sample" [style.color]="theme.colors.ansi0">qYw</span>
                  <span class="code">1;30m</span><span class="sample" [style.color]="theme.colors.ansi8">qYw</span>
                  <span class="code">31m</span><span class="sample" [style.color]="theme.colors.ansi1">qYw</span>
                  <span class="code">1;31m</span><span class="sample" [style.color]="theme.colors.ansi9">qYw</span>
                  <span class="code">32m</span><span class="sample" [style.color]="theme.colors.ansi2">qYw</span>
                  <span class="code">1;32m</span><span class="sample" [style.color]="theme.colors.ansi10">qYw</span>
                  <span class="code">33m</span><span class="sample" [style.color]="theme.colors.ansi3">qYw</span>
                  <span class="code">1;33m</span><span class="sample" [style.color]="theme.colors.ansi11">qYw</span>
                  <span class="code">34m</span><span class="sample" [style.color]="theme.colors.ansi4">qYw</span>
                  <span class="code">1;34m</span><span class="sample" [style.color]="theme.colors.ansi12">qYw</span>
                  <span class="code">35m</span><span class="sample" [style.color]="theme.colors.ansi5">qYw</span>
                  <span class="code">1;35m</span><span class="sample" [style.color]="theme.colors.ansi13">qYw</span>
                  <span class="code">36m</span><span class="sample" [style.color]="theme.colors.ansi6">qYw</span>
                  <span class="code">1;36m</span><span class="sample" [style.color]="theme.colors.ansi14">qYw</span>
                  <span class="code">37m</span><span class="sample" [style.color]="theme.colors.ansi7">qYw</span>
                  <span class="code">1;37m</span><span class="sample" [style.color]="theme.colors.ansi15">qYw</span>
                </div>
              </div>
            }

            @if (viewMode() === 'screenshot') {
              <div class="screenshot-container">
                <img [src]="'screenshots/' + theme.filename" [alt]="theme.name" loading="lazy">
              </div>
            }

            <div class="footer" [class.light-footer]="!theme.isDark">
              <div class="name" [title]="theme.name">{{ theme.name }}</div>
              <div class="family-name" style="text-align: center; margin-top: 4px;">
                @if (useML()) {
                  <div class="predicted-class" style="font-size: 0.6rem; color: #aaa; margin-bottom: 2px; font-weight: 500;">
                    ML: {{ getPrediction(theme) }}
                  </div>
                  <select class="family-select" 
                    [disabled]="isTraining()"
                    [value]="getCustomFamily(theme)"
                    (change)="onFamilyChange(theme, $event)">
                    <option value="none">-- Use ML --</option>
                    @for (fam of getMLFamilies(); track fam) {
                      <option [value]="fam">{{ fam }}</option>
                    }
                  </select>
                } @else {
                  <span style="font-size: 0.55rem; color: #666;">{{ theme.family }}</span>
                }
              </div>
              <div class="card-hsl">
                H:{{ theme.hue | number:'1.0-0' }} S:{{ theme.sat | number:'1.0-0' }} L:{{ theme.light | number:'1.0-0' }}
              </div>
              <div class="card-rgb">
                {{ cardBgRgbLine(theme) }}
              </div>
            </div>
          </div>
        }
      </main>
    }

    <footer class="app-footer">
      <div>&copy; 2026 Daniel Zhang. MIT License.</div>
      <div class="credit">
        Schemes from <a href="https://iterm2colorschemes.com/" target="_blank" rel="noopener noreferrer">iTerm2 Color Schemes</a>.
        <br>
        Repository: <a href="https://github.com/d108/iterm2-theme-gallery" target="_blank" rel="noopener noreferrer">github.com/d108/iterm2-theme-gallery</a>
      </div>
    </footer>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #000;
      color: #e0e0e0;
      min-height: 100vh;
    }

    header {
      padding: 1rem;
      text-align: center;
      background: #111;
      box-shadow: 0 2px 20px rgba(0,0,0,0.8);
      margin-bottom: 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      h1 { margin: 0 0 0.75rem; font-weight: 300; font-size: 1.5rem; color: #fff; }
      .plist-help {
        margin: 0 auto 1rem;
        max-width: 42rem;
        font-size: 0.85rem;
        line-height: 1.45;
        color: #c4c4c4;
        font-weight: 400;
        strong { color: #eee; font-weight: 600; }
      }
    }

    .app-footer {
      margin-top: auto;
      padding: 0.8rem;
      text-align: center;
      background: #111;
      border-top: 1px solid #222;
      font-size: 0.75rem;
      color: #666;
      position: sticky;
      bottom: 0;
      z-index: 100;
      box-shadow: 0 -2px 20px rgba(0,0,0,0.8);
      display: flex;
      flex-direction: column;
      gap: 0.2rem;

      a {
        color: #888;
        text-decoration: none;
        &:hover { color: #fff; text-decoration: underline; }
      }
    }

    .nav-bar { margin-bottom: 1rem; display: flex; justify-content: center; }
    .color-navigator { display: flex; gap: 4px; padding: 4px; background: #222; border-radius: 8px; border: 1px solid #333; }
    .phone-palette { display: none; flex-direction: column; }
    .palette-row { display: flex; gap: 4px; padding: 2px; justify-content: center; }
    .family-btn { width: 24px; height: 24px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: transform 0.1s; }
    .family-btn:hover { transform: scale(1.2); border-color: #fff; }

    .plist-help {
      transition: all 0.3s ease-in-out;
      max-height: 200px;
      opacity: 1;
      margin: 0 auto 1rem;
      overflow: hidden;
    }
    header.collapsed .plist-help {
      max-height: 0;
      opacity: 0;
      margin-bottom: 0;
      pointer-events: none;
    }

    @media (max-width: 768px), (pointer: coarse) {
      .hide-on-phone { display: none !important; }
      .desktop-palette { display: none !important; }
      .phone-palette { display: flex !important; }
      .phone-only { display: block !important; }
      .desktop-only { display: none !important; }
      .gallery { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)) !important; padding: 0 1rem 1rem !important; gap: 1rem !important; }
      header h1 { font-size: 1.2rem !important; }
      .plist-help { margin: 0 auto 0.5rem !important; }
    }

    @media (max-width: 950px) and (orientation: landscape) {
      header { padding: 0.4rem 1rem !important; margin-bottom: 0.5rem !important; }
      header h1 { font-size: 1rem !important; margin: 0 0 0.4rem 0 !important; }
      .plist-help, .filter-group { display: none !important; }
      .nav-bar { margin-bottom: 0.4rem !important; }
      .phone-palette { display: flex !important; flex-direction: row !important; gap: 4px !important; }
      .palette-row { display: contents !important; }
      .family-btn { width: 20px !important; height: 20px !important; }
      .gallery { padding-top: 0.5rem !important; }
      .app-footer { padding: 0.4rem !important; }
      .app-footer .credit { display: none !important; }
    }

    .controls-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 1rem; align-items: center; }
    .control-group { display: flex; align-items: center; gap: 0.4rem; background: #222; padding: 0.3rem 0.6rem; border-radius: 8px; border: 1px solid #333; }
    .group-label { font-size: 0.7rem; text-transform: uppercase; color: #666; margin-right: 0.3rem; }

    .ml-status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #330;
      color: #ff0;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      border: 1px solid #660;
      
      &.learning {
        animation: pulse-bg 1.5s infinite;
        .dot {
          width: 6px;
          height: 6px;
          background: #ff0;
          border-radius: 50%;
          box-shadow: 0 0 8px #ff0;
        }
      }
      .ml-epoch-text {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    }

    @keyframes pulse-bg {
      0% { background: #220; border-color: #440; }
      50% { background: #440; border-color: #aa0; }
      100% { background: #220; border-color: #440; }
    }

    button {
      background: #222; color: #888; border: 1px solid transparent; padding: 0.3rem 0.7rem; border-radius: 4px; cursor: pointer; transition: all 0.2s; font-size: 0.8rem;
      &:hover { background: #333; color: #eee; }
      &.active { background: #444; color: #fff; border-color: #666; }
      &.debug-active { background: #600; color: #fff; border-color: #a00; }
    }

    .family-select {
      background: #333; color: #ccc; border: 1px solid #444; font-size: 0.6rem; border-radius: 3px; padding: 1px 4px; width: 90%; cursor: pointer;
      &:hover { background: #444; color: #fff; }
    }

    .training-custom-header {
      margin-top: 3rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem;
      h2 { margin: 0; flex: 1; min-width: 12rem; }
      .btn-remove-all-custom {
        flex-shrink: 0;
        border: 1px solid #666 !important;
        color: #e0e0e0 !important;
        background: #2a2a2a !important;
        font-size: 0.85rem;
        padding: 0.4rem 0.85rem;
        &:hover:not(:disabled) {
          background: #3a3a3a !important;
          color: #fff !important;
          border-color: #888 !important;
        }
        &:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      }
    }

    .index-list {
      padding: 0 2rem 4rem;
      table { width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; overflow: hidden; }
      th { text-align: left; padding: 12px; background: #222; color: #888; font-size: 0.8rem; text-transform: uppercase; }
      td { padding: 12px; border-bottom: 1px solid #222; font-size: 0.9rem; }
      code { background: #000; padding: 2px 6px; border-radius: 4px; color: #00ff00; }
      .swatch-large { width: 60px; height: 30px; border-radius: 4px; border: 1px solid #333; }
      .index-row { transition: background 0.2s; &:hover { background: #1a1a1a; } }
      .index-row.selected { background: #223; }
    }

    .report-section {
      margin: 0 2rem 2rem;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }

    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      h3 { margin: 0; font-size: 1rem; color: #fff; }
    }

    .report-title-group {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .save-status {
      font-size: 0.7rem;
      &.saved { color: #0f0; }
      &.error { color: #f55; }
      &.saving { color: #ff0; }
    }

    .report-actions {
      display: flex;
      gap: 0.5rem;
    }

    .report-code {
      background: #000;
      color: #0f0;
      padding: 1rem;
      border-radius: 4px;
      max-height: 400px;
      overflow-y: auto;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      white-space: pre;
    }

    .gallery {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1.5rem; padding: 0 2rem 2rem;
      &.screenshot-view {
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        .card { .screenshot-container { aspect-ratio: 2 / 5; } }
      }
    }

    .gallery.debug {
      .card { outline: 1px solid rgba(255, 0, 0, 0.5); }
      .terminal-grid > * { outline: 1px solid rgba(0, 255, 255, 0.3); }
    }

    .card {
      border-radius: 4px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.5); transition: transform 0.15s; display: flex; flex-direction: column;
      scroll-margin-top: 180px;
      position: relative;
      &:hover { transform: translateY(-4px); z-index: 10; }
    }

    .card-header-overlay {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 20;
      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: #00ff00;
      }
    }

    .family-indicator { height: 4px; width: 100%; }

    .terminal {
      padding: 0.6rem; font-family: 'SFMono-Regular', monospace; font-size: 11px; flex-grow: 1; display: flex; flex-direction: column; line-height: 1.2;
    }

    .terminal-grid {
      display: grid; grid-template-columns: 1fr 1fr; row-gap: 2px; column-gap: 8px; align-items: baseline;
      .row-divider { grid-column: 1 / span 2; height: 2px; }
    }

    .header-col-1 {
      display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 4px;
      .box { padding: 1px 4px; border-radius: 2px; font-size: 10px; font-weight: bold; min-width: 24px; text-align: center; }
    }

    .code { opacity: 0.5; text-align: right; font-size: 10px; }
    .sample { font-weight: bold; text-align: left; }

    .screenshot-container {
      width: 100%; overflow: hidden;
      img { width: 100%; height: 100%; object-fit: cover; object-position: left; }
    }

    .footer { 
      background: rgba(0,0,0,0.5); padding: 0.4rem; border-top: 1px solid rgba(255,255,255,0.03);
      &.light-footer { background: rgba(255,255,255,0.8); border-top: 1px solid rgba(0,0,0,0.1); .name { color: #333; } }
    }
    .name { text-align: center; font-size: 0.65rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #999; }

    .phone-only { display: none; }
    .desktop-only { display: block; }

    .card-hsl, .card-rgb {
      text-align: center;
      font-size: 0.55rem;
      margin-top: 6px;
      color: #888;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }
    .card-rgb { margin-top: 3px; }
    .footer.light-footer .card-hsl,
    .footer.light-footer .card-rgb { color: #555; }

    :host.training-lock {
      cursor: wait;
      header,
      .index-list,
      main.gallery,
      .app-footer {
        pointer-events: none;
        user-select: none;
      }
    }
    .family-select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
  host: {
    '[class.training-lock]': 'isTraining()',
    '[attr.aria-busy]': 'isTraining() ? "true" : null',
  },
})
export class App implements OnInit {
  private http = inject(HttpClient);
  private mlService = inject(MLService);
  private appRef = inject(ApplicationRef);
  /** Expose for template: `var(--theme-*)` from token name. */
  protected readonly cssVarRefFn = cssVarRef;
  protected readonly themes = signal<Theme[]>([]);
  protected readonly families = signal<Family[]>([]);
  protected readonly viewMode = signal<'data' | 'screenshot' | 'index' | 'training'>('data');
  protected readonly filterMode = signal<'all' | 'dark' | 'light'>('all');
  protected readonly debugMode = signal(false);
  protected readonly showDebugControl = signal(false);
  protected readonly useML = signal(false);
  protected readonly mlReady = signal(false);
  protected readonly isTraining = signal(false);
  
  protected readonly selectedThemes = signal<Set<string>>(new Set());
  protected readonly reportContent = signal<string | null>(null);
  protected readonly saveStatus = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  private lastScrollY = 0;
  protected readonly isHeaderCollapsed = signal(false);

  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (typeof window === 'undefined') return;
    const currentScrollY = window.scrollY;
    
    // Show description only at the very top of the page
    // threshold of 20px for a bit of breathing room
    this.isHeaderCollapsed.set(currentScrollY > 20);
    
    this.lastScrollY = currentScrollY;
  }

  /** Shown in the training badge; lives on the component so each epoch triggers a view refresh. */
  protected readonly trainingEpochUi = signal<number | null>(null);
  protected readonly trainingEpochLabel = computed(() => {
    const n = this.trainingEpochUi();
    return n !== null ? `${n} / ${ML_TRAINING_EPOCHS}` : '…';
  });

  toggleSelection(theme: Theme, event: Event) {
    event.stopPropagation();
    const next = new Set(this.selectedThemes());
    if (next.has(theme.name)) {
      next.delete(theme.name);
    } else {
      next.add(theme.name);
    }
    this.selectedThemes.set(next);
  }

  isThemeSelected(themeName: string): boolean {
    return this.selectedThemes().has(themeName);
  }

  generatePlistReport() {
    const selected = this.themes().filter(t => this.selectedThemes().has(t.name));
    if (selected.length === 0) {
      alert('Please select at least one theme.');
      return;
    }

    const reportObj: Record<string, any> = {};

    for (const theme of selected) {
      const themeDict: Record<string, any> = {};
      
      const colorMap: Record<string, string> = {
        'Ansi 0 Color': theme.colors.ansi0,
        'Ansi 1 Color': theme.colors.ansi1,
        'Ansi 2 Color': theme.colors.ansi2,
        'Ansi 3 Color': theme.colors.ansi3,
        'Ansi 4 Color': theme.colors.ansi4,
        'Ansi 5 Color': theme.colors.ansi5,
        'Ansi 6 Color': theme.colors.ansi6,
        'Ansi 7 Color': theme.colors.ansi7,
        'Ansi 8 Color': theme.colors.ansi8,
        'Ansi 9 Color': theme.colors.ansi9,
        'Ansi 10 Color': theme.colors.ansi10,
        'Ansi 11 Color': theme.colors.ansi11,
        'Ansi 12 Color': theme.colors.ansi12,
        'Ansi 13 Color': theme.colors.ansi13,
        'Ansi 14 Color': theme.colors.ansi14,
        'Ansi 15 Color': theme.colors.ansi15,
        'Background Color': theme.colors.bg,
        'Foreground Color': theme.colors.fg,
        'Cursor Color': theme.colors.cursor,
        'Cursor Text Color': theme.colors.cursorText,
        'Selection Color': theme.colors.selection,
        'Selected Text Color': theme.colors.selectionText,
      };

      for (const [key, hex] of Object.entries(colorMap)) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) continue;
        themeDict[key] = {
          'Alpha Component': 1,
          'Blue Component': parseFloat((rgb.b / 255).toFixed(16)),
          'Color Space': 'P3',
          'Green Component': parseFloat((rgb.g / 255).toFixed(16)),
          'Red Component': parseFloat((rgb.r / 255).toFixed(16)),
        };
      }

      const defaults = [
        { key: 'Badge Color', r: 1, g: 0.1, b: 0.1, a: 0.5 },
        { key: 'Bold Color', r: 1, g: 1, b: 1, a: 1 },
        { key: 'Cursor Guide Color', r: 0.7, g: 0.85, b: 1, a: 0.25 },
        { key: 'Link Color', r: 0.2, g: 0.5, b: 1, a: 1 },
        { key: 'Match Background Color', r: 1, g: 1, b: 0, a: 1 }
      ];

      for (const d of defaults) {
        themeDict[d.key] = {
          'Alpha Component': d.a,
          'Blue Component': d.b,
          'Color Space': 'P3',
          'Green Component': d.g,
          'Red Component': d.r,
        };
      }

      reportObj[theme.name] = themeDict;
    }

    // Update display (OpenStep style as requested)
    this.reportContent.set(this.formatOpenStep(reportObj));
    
    // Save to local file via API (as JSON for reliability)
    this.saveStatus.set('saving');
    this.http.post('/api/save-report', { report: JSON.stringify(reportObj) }).subscribe({
      next: () => {
        console.log('Theme report saved to user_data/last-generated-report.json');
        this.saveStatus.set('saved');
      },
      error: (err) => {
        console.error('Failed to save report to disk:', err);
        this.saveStatus.set('error');
      }
    });

    // Scroll to report if needed or just show it
    setTimeout(() => {
      document.getElementById('plist-report')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }

  /**
   * Formats a JS object into the OpenStep plist format for display
   */
  private formatOpenStep(obj: any, indent = 0): string {
    const pad = '    '.repeat(indent);
    const innerPad = '    '.repeat(indent + 1);
    
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') return `"${obj}"`;
      return String(obj);
    }

    let result = '{\n';
    for (const [key, val] of Object.entries(obj)) {
      result += `${innerPad}"${key}" = `;
      if (typeof val === 'object') {
        result += this.formatOpenStep(val, indent + 1);
      } else {
        const valStr = typeof val === 'string' ? `"${val}"` : val;
        result += `${valStr};`;
      }
      result += '\n';
    }
    result += `${pad}}${indent === 0 ? '' : ';'}`;
    return result;
  }

  clearReport() {
    this.reportContent.set(null);
  }

  copyReport() {
    const content = this.reportContent();
    if (content) {
      navigator.clipboard.writeText(content).then(() => {
        alert('Report copied to clipboard!');
      });
    }
  }

  protected readonly activeFamilies = computed(() => {
    this.mlService.anchorsRevision();
    const themes = this.filteredThemes();
    const mode = this.filterMode();
    const mlMeta = this.mlService.getFamilyMetadata();
    
    // If we have ML metadata (usually after first loadAndTrain or on startup from base anchors)
    // we use that for the palette as it contains the 15 semantic colors the user wants.
    if (mlMeta.length > 0) {
      const results: Family[] = [];
      for (const name of PALETTE_FAMILY_ORDER) {
        const meta = mlMeta.find(m => m.name === name);
        if (!meta) continue;
        if (mode === 'dark' && !meta.isDark) continue;
        if (mode === 'light' && meta.isDark) continue;

        let index: number;
        if (this.useML()) {
          index = themes.findIndex(
            t => this.sortFamilyForTheme(t).toLowerCase() === meta.name.toLowerCase()
          );
        } else {
          index = themes.findIndex(t => t.family.toLowerCase() === meta.name.toLowerCase());
        }

        if (index !== -1) {
          results.push({
            id: meta.name,
            label: meta.name,
            semanticVar: meta.semanticVar,
            startIndex: index,
            isDark: meta.isDark
          });
        }
      }
      return results;
    }

    const baseFamilies = this.families();
    return baseFamilies
      .filter(fam => {
        if (mode === 'dark' && !fam.isDark) return false;
        if (mode === 'light' && fam.isDark) return false;
        return themes.some(t => t.family === fam.label);
      })
      .map(fam => ({
        ...fam,
        startIndex: themes.findIndex(t => t.family === fam.label)
      }))
      .filter(fam => fam.startIndex !== -1)
      .sort((a, b) => paletteOrderIndex(a.label) - paletteOrderIndex(b.label));
  });

  protected readonly darkFamilies = computed(() => this.activeFamilies().filter(f => f.isDark));
  protected readonly lightFamilies = computed(() => this.activeFamilies().filter(f => !f.isDark));


  protected readonly filteredThemes = computed(() => {
    this.mlService.anchorsRevision();
    const all = this.themes();
    const mode = this.filterMode();
    let filtered = mode === 'all' ? all : all.filter(t => mode === 'dark' ? t.isDark : !t.isDark);
    
    const themeToFamily = new Map(
      filtered.map(t => [t, this.sortFamilyForTheme(t)] as const)
    );

    return [...filtered].sort((a, b) => {
      const famA = themeToFamily.get(a)!;
      const famB = themeToFamily.get(b)!;
      const idxA = paletteOrderIndex(famA);
      const idxB = paletteOrderIndex(famB);
      if (idxA !== idxB) return idxA - idxB;
      return this.compareThemeHsl(a, b);
    });
  });

  /** Default is ML and Debug off; open with ?ml=1 or ?debug=1 to enable (query is then stripped). */
  private applyQueryOptions(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    
    let changed = false;
    const mlRaw = params.get('ml');
    if (mlRaw !== null) {
      const on = mlRaw === '1' || mlRaw.toLowerCase() === 'true' || mlRaw.toLowerCase() === 'yes';
      if (on) this.useML.set(true);
      params.delete('ml');
      changed = true;
    }

    const debugRaw = params.get('debug');
    if (debugRaw !== null) {
      const on = debugRaw === '1' || debugRaw.toLowerCase() === 'true' || debugRaw.toLowerCase() === 'yes';
      if (on) this.showDebugControl.set(true);
      params.delete('debug');
      changed = true;
    }

    if (changed) {
      const qs = params.toString();
      const nextUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', nextUrl);
    }
  }

  onToggleML() {
    const next = !this.useML();
    this.useML.set(next);
    if (!next && this.viewMode() === 'training') {
      this.viewMode.set('data');
    }
  }

  ngOnInit() {
    this.applyQueryOptions();

    this.http.get<DataResponse>('screenshots.json').subscribe(data => {
      this.themes.set(data.themes);
      this.families.set(
        data.families.map(f => ({
          id: f.id,
          startIndex: f.startIndex,
          label: f.label,
          isDark: f.isDark,
          semanticVar: semanticVarForFamily(f.label),
        }))
      );
    });

    this.mlService.ready$.subscribe(ready => {
      this.mlReady.set(ready);
    });
  }

  relearn() {
    this.isTraining.set(true);
    this.trainingEpochUi.set(null);
    const start = () => {
      this.mlService
        .loadAndTrain((epoch) => {
          this.trainingEpochUi.set(epoch);
          this.appRef.tick();
        })
        .then(() => {
          this.mlReady.set(true);
        })
        .finally(() => {
          this.isTraining.set(false);
          this.trainingEpochUi.set(null);
        });
    };
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(start, 0);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(start));
    }
  }

  onFamilyChange(theme: Theme, event: Event) {
    if (this.isTraining()) return;
    const newFamily = (event.target as HTMLSelectElement).value;
    if (newFamily === 'none') {
      this.mlService.removeCustomAnchor(theme.name);
    } else {
      this.mlService.addCustomAnchor(theme.name, newFamily, [theme.hue, theme.sat, theme.light]);
    }
  }

  clearCustomTraining() {
    if (confirm('Are you sure you want to clear all browser training data?')) {
      this.mlService.clearCustomData();
      this.relearn();
    }
  }

  removeAllCustomAnchors() {
    if (this.getAnchors().custom.length === 0) return;
    if (
      confirm(
        'Remove all custom anchors? Saved weights will be cleared and the model will retrain using only the base training set.'
      )
    ) {
      this.mlService.clearCustomData();
      this.relearn();
    }
  }

  getCustomFamily(theme: Theme): string {
    return this.mlService.getCustomAnchorFamily(theme.name) || 'none';
  }

  getMLFamilies(): string[] {
    return this.mlService.getFamilyMetadata().map(m => m.name);
  }

  /**
   * When ML is on, ordering and accents use nearest family in Oklab (ΔE) from `theme.colors.bg`
   * (fallback HSL), not the trained NN — see `MLService.classifyThemeColor`. Unknown only before anchors load.
   */
  private sortFamilyForTheme(theme: Theme): string {
    if (!this.useML()) return theme.family;
    const ml = this.getMLFamily(theme);
    return ml === 'Unknown' ? theme.family : ml;
  }

  getMLFamily(theme: Theme): string {
    const custom = this.mlService.getCustomAnchorFamily(theme.name);
    if (custom) return custom;
    return this.mlService.classifyThemeColor(
      theme.colors.bg,
      theme.hue,
      theme.sat,
      theme.light,
      theme.isDark
    );
  }

  /** Same family as sort / navigator (Oklab + custom overrides); keeps the ML line aligned with placement. */
  getPrediction(theme: Theme): string {
    return this.getMLFamily(theme);
  }

  getAnchors() {
    return this.mlService.getAnchors();
  }

  anchorSwatchStyle(family: string): string {
    return cssVarRef(semanticVarForFamily(family));
  }

  removeAnchor(anchor: any) {
    if (this.isTraining()) return;
    this.mlService.removeCustomAnchor(anchor.themeName);
    this.relearn();
  }

  scrollToIndex(index: number) {
    if (this.isTraining()) return;
    const themes = this.filteredThemes();
    const targetTheme = themes[index];
    if (targetTheme) {
      const element = document.getElementById('theme-' + targetTheme.name);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  goToTheme(theme: Theme) {
    if (this.isTraining()) return;
    const mode = this.filterMode();
    if (mode === 'dark' && !theme.isDark) this.filterMode.set('all');
    if (mode === 'light' && theme.isDark) this.filterMode.set('all');

    if (this.viewMode() === 'index') {
      this.viewMode.set('data');
    }

    setTimeout(() => {
      const element = document.getElementById('theme-' + theme.name);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  /** Secondary order within a family: hue → saturation → lightness, then name. */
  private compareThemeHsl(a: Theme, b: Theme): number {
    if (a.hue !== b.hue) return a.hue - b.hue;
    if (a.sat !== b.sat) return a.sat - b.sat;
    if (a.light !== b.light) return a.light - b.light;
    return a.name.localeCompare(b.name);
  }

  /** RGB from theme background hex (for card footer). */
  cardBgRgbLine(theme: Theme): string {
    const rgb = this.hexToRgb(theme.colors.bg);
    if (!rgb) return '';
    return `R:${rgb.r} G:${rgb.g} B:${rgb.b}`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) {
      h = h.split('').map(c => c + c).join('');
    }
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  getThemeFamilyColor(theme: Theme): string {
    const familyName = this.sortFamilyForTheme(theme);
    const meta = this.mlService.getFamilyMetadata().find(
      m => m.name.toLowerCase() === familyName.toLowerCase()
    );
    if (meta) return cssVarRef(meta.semanticVar);
    const fam = this.families().find(f => f.label === familyName);
    if (fam) return cssVarRef(fam.semanticVar);
    return cssVarRef('--theme-light-neutral');
  }
}
