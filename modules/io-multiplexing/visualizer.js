/**
 * io-multiplexing visualizer — fd readiness grid
 */
import { SCENARIOS } from './scenarios.js';

class IoMuxEngine {
  constructor(scenario) { this.scenario = scenario; this.snapshots = []; this.currentStep = 0; this._init(); }
  _init() {
    const initial = this.scenario.initialState();
    this.snapshots = [{ state: JSON.parse(JSON.stringify(initial)), code: '// initial state', lesson: this.scenario.description, diff: [] }];
    this.currentStep = 0;
    const current = JSON.parse(JSON.stringify(initial));
    for (const step of this.scenario.steps) {
      const before = JSON.parse(JSON.stringify(current));
      step.apply(current);
      const diff = [];
      for (const key of Object.keys(current)) if (JSON.stringify(before[key]) !== JSON.stringify(current[key])) diff.push({ key });
      this.snapshots.push({ state: JSON.parse(JSON.stringify(current)), code: step.code, lesson: step.lesson, diff });
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

export class IoMultiplexingVisualizer {
  constructor(container) { this.container = container; this.engine = null; this.currentScenarioIndex = 0; }
  init() { this.loadScenario(0); }
  loadScenario(index) { this.currentScenarioIndex = index; this.engine = new IoMuxEngine(SCENARIOS[index]); this.render(); }

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
        <div class="code-panel"><div class="code-panel-header">C Code</div><div class="code-lines">${this._renderCodeLines()}</div></div>
        <div class="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">fd Readiness</div>
          ${state.selectState ? `<div class="daemon-status ${changed.has('selectState') ? 'anim-pulse' : ''}">${this._esc(state.selectState)}</div>` : ''}
          <table class="sig-table">
            <tr class="sig-header"><th>fd</th><th>Name</th><th>Watching</th><th>State</th></tr>
            ${state.fds.map(f => {
              const stateColor = f.state === 'READY' ? 'var(--green)' : f.state === 'processing' ? 'var(--accent2)' : 'var(--text-dim)';
              const isChanged = changed.has('fds');
              return `<tr class="${f.state === 'READY' ? 'sig-active' : ''} ${isChanged ? '' : ''}">
                <td class="sig-name">${f.fd}</td>
                <td>${this._esc(f.name)}</td>
                <td>${f.watching}</td>
                <td style="color:${stateColor};font-weight:600">${f.state.toUpperCase()}</td>
              </tr>`;
            }).join('')}
          </table>
          ${state.events.length > 0 ? `<div class="signal-log-section"><div class="col-title" style="margin-top:12px">Events</div>
          <div class="signal-log">${state.events.map((e, i) => `<div class="log-entry ${i >= state.events.length - (changed.has('events') ? 3 : 0) ? 'log-new' : ''}">${this._esc(e)}</div>`).join('')}</div></div>` : ''}
        </div>
      </div>
    `;
    this.wireEvents(); this._scrollToActiveLine();
  }

  _renderCodeLines() {
    return this.engine.codeLines().map((line, i) => {
      const cls = line.active ? 'active' : (i < this.engine.currentStep ? 'past' : '');
      let s = this._esc(line.code);
      s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
      s = s.replace(/\b(int|struct)\b/g, '<span class="syn-type">$1</span>');
      s = s.replace(/\b(select|poll|FD_ZERO|FD_SET|FD_ISSET|read|write)\b/g, '<span class="syn-syscall">$1</span>');
      s = s.replace(/\b(POLLIN|POLLOUT|NULL|readfds|revents|events)\b/g, '<span class="syn-const">$1</span>');
      s = s.replace(/\b(\d+)\b/g, '<span class="syn-num">$1</span>');
      return `<div class="code-line ${cls}" data-step="${i}"><span class="line-num">${i === 0 ? '' : i}</span><span class="line-code">${s}</span></div>`;
    }).join('');
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
  _esc(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  destroy() { document.removeEventListener('keydown', this._onKeyDown); }
}
