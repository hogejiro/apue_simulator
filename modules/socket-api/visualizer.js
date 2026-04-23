/**
 * socket-api visualizer — client-server communication diagram
 *
 * Left: server state, Right: client state, Center: connection events
 */

import { SCENARIOS } from './scenarios.js';

class SocketEngine {
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
      for (const key of ['server', 'client', 'timeWait']) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff.push({ key });
      }
      if (after.events.length > before.events.length) diff.push({ key: 'events', count: after.events.length - before.events.length });
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

export class SocketApiVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new SocketEngine(SCENARIOS[index]);
    this.render();
  }

  render() {
    const snap = this.engine.current();
    const { state, diff, lesson } = snap;
    const scenario = SCENARIOS[this.currentScenarioIndex];
    const changedKeys = new Set(diff.map(d => d.key));
    const newEventCount = diff.find(d => d.key === 'events')?.count || 0;

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
          <div class="kernel-panel-header">Socket State</div>
          <div class="socket-diagram">
            ${this._renderEndpoint('Server', state.server, changedKeys.has('server'))}
            <div class="socket-connection">
              <div class="socket-conn-label">TCP Connection</div>
              ${state.server.connState === 'ESTABLISHED' || state.client.state === 'ESTABLISHED'
                ? '<div class="socket-conn-line socket-connected"></div>'
                : '<div class="socket-conn-line"></div>'
              }
            </div>
            ${this._renderEndpoint('Client', state.client, changedKeys.has('client'))}
          </div>

          ${state.timeWait ? `<div class="socket-timewait ${changedKeys.has('timeWait') ? 'anim-pulse' : ''}">${this._escapeHtml(state.timeWait)}</div>` : ''}

          ${state.events.length > 0 ? `
          <div class="signal-log-section">
            <div class="col-title" style="margin-top:12px">Events</div>
            <div class="signal-log">
              ${state.events.map((e, i) => {
                const isNew = i >= state.events.length - newEventCount;
                const isData = e.includes('→') && (e.includes('bytes') || e.includes('HTTP'));
                return `<div class="log-entry ${isNew ? 'log-new' : ''} ${isData ? 'log-data-flow' : ''}">${this._escapeHtml(e)}</div>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  _renderEndpoint(label, ep, changed) {
    const stateColor = ep.state === 'ESTABLISHED' ? 'var(--green)' :
      ep.state === 'LISTEN' ? 'var(--accent2)' :
      ep.state.includes('CLOSED') ? 'var(--text-dim)' : 'var(--text)';

    return `<div class="socket-endpoint ${changed ? 'anim-pulse' : ''}">
      <div class="socket-ep-label">${label}</div>
      ${ep.fd !== null ? `<div class="socket-ep-field">fd: <span>${ep.fd}</span></div>` : ''}
      <div class="socket-ep-state" style="color:${stateColor}">${ep.state}</div>
      ${ep.addr ? `<div class="socket-ep-field">addr: <span>${ep.addr}</span></div>` : ''}
      ${ep.connFd ? `<div class="socket-ep-field">connfd: <span>${ep.connFd}</span></div>` : ''}
      ${ep.connState ? `<div class="socket-ep-field">conn: <span>${ep.connState}</span></div>` : ''}
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
    s = s.replace(/\[([^\]]+)\]/g, '<span class="syn-tag">[$1]</span>');
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    s = s.replace(/\b(int|struct|void|socklen_t)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(socket|bind|listen|accept|connect|read|write|close|setsockopt|send|recv)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(AF_INET|SOCK_STREAM|SOL_SOCKET|SO_REUSEADDR|EADDRINUSE|SOCK_DGRAM)\b/g, '<span class="syn-const">$1</span>');
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
