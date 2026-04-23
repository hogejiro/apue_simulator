/**
 * terminal-modes visualizer — termios flags + input/output processing
 */

import { SCENARIOS } from './scenarios.js';

class TermEngine {
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
      for (const key of Object.keys(after)) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff.push({ key });
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

export class TerminalModesVisualizer {
  constructor(container) { this.container = container; this.engine = null; this.currentScenarioIndex = 0; }
  init() { this.loadScenario(0); }
  loadScenario(index) { this.currentScenarioIndex = index; this.engine = new TermEngine(SCENARIOS[index]); this.render(); }

  render() {
    const snap = this.engine.current();
    const { state, diff, lesson } = snap;
    const scenario = SCENARIOS[this.currentScenarioIndex];
    const changed = new Set(diff.map(d => d.key));

    this.container.innerHTML = `
      <div class="scenario-selector">
        <label>Scenario:</label>
        <select id="scenario-select">${SCENARIOS.map((s, i) => `<option value="${i}" ${i === this.currentScenarioIndex ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
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
          <div class="code-lines">${this._renderCodeLines()}</div>
        </div>
        <div class="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Terminal State</div>
          <div class="term-mode-badge ${changed.has('mode') ? 'anim-pulse' : ''}" style="background:${state.mode === 'canonical' ? 'var(--green)' : state.mode === 'cbreak' ? 'var(--yellow)' : 'var(--accent)'}22;color:${state.mode === 'canonical' ? 'var(--green)' : state.mode === 'cbreak' ? 'var(--yellow)' : 'var(--accent)'}">
            ${state.mode.toUpperCase()} MODE
          </div>
          <div class="daemon-grid">
            ${this._flag('ICANON', state.icanon, changed.has('icanon'))}
            ${this._flag('ECHO', state.echo, changed.has('echo'))}
            ${this._flag('ISIG', state.isig, changed.has('isig'))}
            ${state.iexten !== undefined ? this._flag('IEXTEN', state.iexten, changed.has('iexten')) : ''}
            ${state.opost !== undefined ? this._flag('OPOST', state.opost, changed.has('opost')) : ''}
            ${state.icrnl !== undefined ? this._flag('ICRNL', state.icrnl, changed.has('icrnl')) : ''}
            ${this._attr('MIN', state.min, changed.has('min'))}
            ${this._attr('TIME', state.time, changed.has('time'))}
          </div>
          ${state.inputBuffer !== undefined ? `
          <div class="term-buffer-section">
            <div class="col-title">Input Buffer</div>
            <div class="term-buffer ${changed.has('inputBuffer') ? 'anim-pulse' : ''}">${state.inputBuffer ? this._escapeHtml(state.inputBuffer) : '(empty)'}</div>
          </div>` : ''}
          ${state.readResult !== undefined && state.readResult ? `
          <div class="term-buffer-section">
            <div class="col-title">read() result</div>
            <div class="term-read-result ${changed.has('readResult') ? 'anim-appear' : ''}">${this._escapeHtml(state.readResult)}</div>
          </div>` : ''}
          ${state.events.length > 0 ? `
          <div class="signal-log-section"><div class="col-title" style="margin-top:12px">Events</div>
          <div class="signal-log">${state.events.map((e, i) => {
            const newCount = diff.find(d => d.key === 'events') ? state.events.length - (JSON.parse(JSON.stringify(this.engine.snapshots[Math.max(0, this.engine.currentStep - 1)].state)).events?.length || 0) : 0;
            const isNew = i >= state.events.length - newCount;
            return `<div class="log-entry ${isNew ? 'log-new' : ''}">${this._escapeHtml(e)}</div>`;
          }).join('')}</div></div>` : ''}
        </div>
      </div>
    `;
    this.wireEvents();
    this._scrollToActiveLine();
  }

  _flag(name, on, changed) {
    return `<div class="daemon-attr ${changed ? 'daemon-attr-changed anim-pulse' : ''}">
      <div class="daemon-attr-label">${name}</div>
      <div class="daemon-attr-value" style="color:${on ? 'var(--green)' : 'var(--accent)'}">${on ? 'ON' : 'OFF'}</div>
    </div>`;
  }

  _attr(name, val, changed) {
    return `<div class="daemon-attr ${changed ? 'daemon-attr-changed anim-pulse' : ''}">
      <div class="daemon-attr-label">${name}</div>
      <div class="daemon-attr-value">${val}</div>
    </div>`;
  }

  _renderCodeLines() {
    const lines = this.engine.codeLines();
    return lines.map((line, i) => {
      const cls = line.active ? 'active' : (i < this.engine.currentStep ? 'past' : '');
      return `<div class="code-line ${cls}" data-step="${i}"><span class="line-num">${i === 0 ? '' : i}</span><span class="line-code">${this._hl(line.code)}</span></div>`;
    }).join('');
  }

  _hl(code) {
    let s = this._escapeHtml(code);
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    s = s.replace(/\b(struct|int|char)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(tcgetattr|tcsetattr|tty_cbreak|tty_raw|tty_reset)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(ICANON|ECHO|ISIG|IEXTEN|OPOST|ICRNL|VMIN|VTIME|TCSAFLUSH|STDIN_FILENO|ERASE|KILL|EOF|NL)\b/g, '<span class="syn-const">$1</span>');
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
  _onKeyDown = (e) => { if ('INPUT TEXTAREA SELECT'.includes(e.target.tagName)) return; if (e.key === 'ArrowRight' || e.key === 'j') { if (this.engine.next()) this.render(); } else if (e.key === 'ArrowLeft' || e.key === 'k') { if (this.engine.prev()) this.render(); } };
  _scrollToActiveLine() { const a = this.container.querySelector('.code-line.active'); if (a) a.scrollIntoView({ block: 'nearest' }); }
  _escapeHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  destroy() { document.removeEventListener('keydown', this._onKeyDown); }
}
