/**
 * daemon-steps visualizer — shows process attributes changing at each step
 */

import { SCENARIOS } from './scenarios.js';

class DaemonEngine {
  constructor(scenario) {
    this.scenario = scenario;
    this.snapshots = [];
    this.currentStep = 0;
    this._init();
  }

  _init() {
    const initial = this.scenario.initialState();
    this.snapshots = [{ state: { ...initial }, code: '// initial state', lesson: this.scenario.description, diff: [] }];
    this.currentStep = 0;

    const current = { ...initial };
    for (const step of this.scenario.steps) {
      const before = { ...current };
      step.apply(current);
      const after = { ...current };
      // Compute diff as list of changed keys
      const diff = [];
      for (const key of Object.keys(after)) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
          diff.push({ key, from: before[key], to: after[key] });
        }
      }
      this.snapshots.push({ state: { ...after }, code: step.code, lesson: step.lesson, diff });
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

export class DaemonStepsVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new DaemonEngine(SCENARIOS[index]);
    this.render();
  }

  render() {
    const snap = this.engine.current();
    const { state, diff, lesson } = snap;
    const scenario = SCENARIOS[this.currentScenarioIndex];
    const changedKeys = new Set(diff.map(d => d.key));

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
          <div class="kernel-panel-header">Process Attributes</div>
          <div class="daemon-grid">
            ${this._renderAttr('PID', state.pid, changedKeys.has('pid'))}
            ${this._renderAttr('PPID', state.ppid, changedKeys.has('ppid'))}
            ${this._renderAttr('SID', state.sid, changedKeys.has('sid'))}
            ${this._renderAttr('PGID', state.pgid, changedKeys.has('pgid'))}
            ${this._renderAttr('umask', state.umask, changedKeys.has('umask'))}
            ${this._renderAttr('CWD', state.cwd, changedKeys.has('cwd'))}
            ${this._renderAttr('Controlling TTY', state.ctty, changedKeys.has('ctty'))}
            ${this._renderAttr('Session Leader', state.isSessionLeader ? 'Yes' : 'No', changedKeys.has('isSessionLeader'))}
            ${this._renderAttr('PG Leader', state.isPGLeader ? 'Yes' : 'No', changedKeys.has('isPGLeader'))}
            ${state.config ? this._renderAttr('Config', state.config, changedKeys.has('config')) : ''}
          </div>

          <div class="daemon-status ${changedKeys.has('status') ? 'anim-pulse' : ''}">
            ${this._escapeHtml(state.status)}
          </div>

          <div class="daemon-fds-section">
            <div class="col-title" style="margin-top:12px">File Descriptors</div>
            <div class="daemon-fds ${changedKeys.has('fds') ? 'anim-appear' : ''}">
              ${Array.isArray(state.fds) ? state.fds.map(f => `<div class="daemon-fd">${this._escapeHtml(String(f))}</div>`).join('') : ''}
            </div>
          </div>
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  _renderAttr(label, value, changed) {
    return `<div class="daemon-attr ${changed ? 'daemon-attr-changed anim-pulse' : ''}">
      <div class="daemon-attr-label">${label}</div>
      <div class="daemon-attr-value">${this._escapeHtml(String(value))}</div>
    </div>`;
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
    s = s.replace(/(&quot;[^&]*?&quot;)/g, '<span class="syn-string">$1</span>');
    s = s.replace(/\b(umask|fork|exit|setsid|chdir|close|open|dup|signal|kill)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(O_RDWR|SIGHUP|pid|fd|maxfd)\b/g, '<span class="syn-const">$1</span>');
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
