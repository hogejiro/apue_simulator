/**
 * process-memory visualizer — vertical memory layout diagram (Figure 7.6)
 */

import { SCENARIOS } from './scenarios.js';

class MemoryEngine {
  constructor(scenario) {
    this.scenario = scenario;
    this.snapshots = [];
    this.currentStep = 0;
    this._init();
  }

  _init() {
    const initial = this.scenario.initialState();
    this.snapshots = [{ state: JSON.parse(JSON.stringify(initial)), code: '// initial state', lesson: this.scenario.description, diff: [] }];
    this.currentStep = 0;

    const current = JSON.parse(JSON.stringify(initial));
    for (const step of this.scenario.steps) {
      const before = JSON.parse(JSON.stringify(current));
      step.apply(current);
      const after = JSON.parse(JSON.stringify(current));
      const diff = [];
      for (let i = 0; i < after.segments.length; i++) {
        if (JSON.stringify(before.segments[i]) !== JSON.stringify(after.segments[i])) {
          diff.push({ index: i, name: after.segments[i].name });
        }
      }
      this.snapshots.push({ state: after, code: step.code, lesson: step.lesson, diff });
    }
  }

  reset() { this._init(); }
  get totalSteps() { return this.snapshots.length; }
  next() { if (this.currentStep >= this.snapshots.length - 1) return false; this.currentStep++; return true; }
  prev() { if (this.currentStep <= 0) return false; this.currentStep--; return true; }
  goTo(i) { if (i < 0 || i >= this.snapshots.length) return false; this.currentStep = i; return true; }
  current() { return this.snapshots[this.currentStep]; }
  codeLines() { return this.snapshots.map((s, i) => ({ code: s.code, active: i === this.currentStep, index: i })); }
}

export class ProcessMemoryVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new MemoryEngine(SCENARIOS[index]);
    this.render();
  }

  render() {
    const snap = this.engine.current();
    const { state, diff, lesson } = snap;
    const scenario = SCENARIOS[this.currentScenarioIndex];
    const changedNames = new Set(diff.map(d => d.name));

    const totalSize = state.segments.reduce((s, seg) => s + Math.max(seg.size, 10), 0);

    this.container.innerHTML = `
      <div class="scenario-selector">
        <label>Scenario:</label>
        <select id="scenario-select">
          ${SCENARIOS.map((s, i) => `<option value="${i}" ${i === this.currentScenarioIndex ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        ${scenario.figure ? `<span class="figure-badge">Fig. ${scenario.figure}</span>` : ''}
      </div>

      <div class="controls">
        <button class="btn" id="btn-prev" ${this.engine.currentStep <= 0 ? 'disabled' : ''}>&#9664; Prev</button>
        <button class="btn" id="btn-next" ${this.engine.currentStep >= this.engine.totalSteps - 1 ? 'disabled' : ''}>Next &#9654;</button>
        <button class="btn" id="btn-reset">Reset</button>
        <span class="step-info">Step ${this.engine.currentStep} / ${this.engine.totalSteps - 1}</span>
        <span class="key-hint">&#8592;&#8594; or j/k</span>
      </div>

      <div class="split-pane">
        <div class="code-panel">
          <div class="code-panel-header">C Code</div>
          <div class="code-lines">
            ${this._renderCodeLines()}
          </div>
        </div>

        <div class="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Memory Layout</div>
          <div class="mem-layout-container">
            <div class="mem-addr-label">High address</div>
            <div class="mem-layout">
              <div class="mem-segment mem-env">
                <div class="mem-seg-label">env / argv</div>
                <div class="mem-seg-items">${state.envArgs.map(e => `<span>${this._escapeHtml(e)}</span>`).join('')}</div>
              </div>
              ${state.segments.slice().reverse().map(seg => {
                const pct = Math.max((seg.size / totalSize) * 100, seg.name === 'gap' ? 15 : 8);
                const isChanged = changedNames.has(seg.name);
                return `<div class="mem-segment ${isChanged ? 'mem-changed' : ''}" style="height:${pct}%;${seg.color !== 'transparent' ? `border-left:4px solid ${seg.color};background:${seg.color}11` : 'border-left:4px dashed var(--border);opacity:0.4'}">
                  <div class="mem-seg-label" ${seg.color !== 'transparent' ? `style="color:${seg.color}"` : ''}>${seg.label}</div>
                  ${seg.items.length > 0 ? `<div class="mem-seg-items">${seg.items.map(it => `<span>${this._escapeHtml(it)}</span>`).join('')}</div>` : ''}
                </div>`;
              }).join('')}
            </div>
            <div class="mem-addr-label">Low address (0)</div>
          </div>
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  _renderCodeLines() {
    const lines = this.engine.codeLines();
    return lines.map((line, i) => {
      const cls = line.active ? 'active' : (i < this.engine.currentStep ? 'past' : '');
      const lineNum = i === 0 ? '' : i;
      return `<div class="code-line ${cls}" data-step="${i}"><span class="line-num">${lineNum}</span><span class="line-code">${this._highlightSyntax(line.code)}</span></div>`;
    }).join('');
  }

  _highlightSyntax(code) {
    let s = this._escapeHtml(code);
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    s = s.replace(/\b(int|char|long|void)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(malloc|realloc|free|main|calc)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(\d+)\b/g, '<span class="syn-num">$1</span>');
    return s;
  }

  wireEvents() {
    this.container.querySelector('#scenario-select')?.addEventListener('change', (e) => { this.loadScenario(parseInt(e.target.value)); });
    this.container.querySelector('#btn-prev')?.addEventListener('click', () => { if (this.engine.prev()) this.render(); });
    this.container.querySelector('#btn-next')?.addEventListener('click', () => { if (this.engine.next()) this.render(); });
    this.container.querySelector('#btn-reset')?.addEventListener('click', () => { this.engine.reset(); this.render(); });
    this.container.querySelectorAll('.code-line').forEach(el => { el.addEventListener('click', () => { if (this.engine.goTo(parseInt(el.dataset.step))) this.render(); }); });
    document.addEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'j') { if (this.engine.next()) this.render(); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { if (this.engine.prev()) this.render(); }
  };

  _scrollToActiveLine() { const a = this.container.querySelector('.code-line.active'); if (a) a.scrollIntoView({ block: 'nearest' }); }
  _escapeHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  destroy() { document.removeEventListener('keydown', this._onKeyDown); }
}
