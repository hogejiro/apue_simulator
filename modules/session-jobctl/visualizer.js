/**
 * session-jobctl visualizer — session / process group / job control
 *
 * Shows nested boxes: Session → Process Groups → Processes
 * Foreground PG is highlighted. Stopped processes are dimmed.
 */

import { SessionScenarioEngine } from '../../core/session-scenario-engine.js';
import { SCENARIOS } from './scenarios.js';

export class SessionJobctlVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new SessionScenarioEngine(SCENARIOS[index]);
    this.render();
  }

  render() {
    const snap = this.engine.current();
    const { state, diff, lesson } = snap;
    const scenario = SCENARIOS[this.currentScenarioIndex];

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
          <div class="code-panel-header">Shell Commands</div>
          <div class="code-lines">
            ${this._renderCodeLines()}
          </div>
        </div>

        <div class="kernel-panel" id="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Session / Process Groups</div>
          ${this._renderSession(state, diff)}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  _renderSession(state, diff) {
    const groups = state.getProcessGroups();
    const fgPgid = state.foregroundPgid;
    const addedPids = new Set(diff.filter(d => d.type === 'process-added').map(d => d.pid));
    const stateChanged = new Set(diff.filter(d => d.type === 'state-changed').map(d => d.pid));
    const fgChanged = diff.some(d => d.type === 'fg-changed');

    let html = `<div class="session-box">`;
    html += `<div class="session-header">Session ${state.sid} <span class="session-tty">${state.controllingTTY}</span></div>`;

    // Sort PGs: foreground first, then by pgid
    const sortedPgids = [...groups.keys()].sort((a, b) => {
      if (a === fgPgid) return -1;
      if (b === fgPgid) return 1;
      return a - b;
    });

    for (const pgid of sortedPgids) {
      const procs = groups.get(pgid);
      const isFg = pgid === fgPgid;
      const pgHasNewProc = procs.some(p => addedPids.has(p.pid));
      const animCls = (fgChanged && isFg) ? 'anim-pulse' : pgHasNewProc ? 'anim-appear' : '';

      html += `<div class="pg-box ${isFg ? 'pg-foreground' : 'pg-background'} ${animCls}">`;
      html += `<div class="pg-header">`;
      html += `<span class="pg-label">PG ${pgid}</span>`;
      html += isFg
        ? `<span class="pg-badge pg-fg-badge">FOREGROUND</span>`
        : `<span class="pg-badge pg-bg-badge">background</span>`;
      html += `</div>`;

      html += `<div class="pg-processes">`;
      for (const proc of procs) {
        const isNew = addedPids.has(proc.pid);
        const isChanged = stateChanged.has(proc.pid);
        const stateCls = proc.state === 'STOPPED' ? 'proc-stopped' : proc.state === 'ZOMBIE' ? 'proc-zombie' : 'proc-running';
        const animProcCls = isNew ? 'anim-appear' : isChanged ? 'anim-pulse' : '';

        html += `<div class="session-proc ${stateCls} ${animProcCls}">`;
        html += `<div class="session-proc-name">${this._escapeHtml(proc.name)}</div>`;
        html += `<div class="session-proc-pid">PID ${proc.pid}</div>`;
        html += `<div class="session-proc-state ${stateCls}">${proc.state}</div>`;
        if (proc.pid === state.sid) html += `<div class="session-proc-leader">session leader</div>`;
        if (proc.pid === pgid) html += `<div class="session-proc-leader">PG leader</div>`;
        html += `</div>`;
      }
      html += `</div></div>`;
    }

    html += `</div>`;
    return html;
  }

  _renderCodeLines() {
    const lines = this.engine.codeLines();
    return lines.map((line, i) => {
      const cls = line.active ? 'active' : (i < this.engine.currentStep ? 'past' : '');
      const lineNum = i === 0 ? '' : i;
      return `<div class="code-line ${cls}" data-step="${i}">` +
        `<span class="line-num">${lineNum}</span>` +
        `<span class="line-code">${this._highlightShell(line.code)}</span>` +
        `</div>`;
    }).join('');
  }

  _highlightShell(code) {
    let s = this._escapeHtml(code);
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    s = s.replace(/(\$\s)/g, '<span class="syn-const">$1</span>');
    s = s.replace(/(\^[CZ])/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(SIGINT|SIGTSTP|SIGCONT|SIGTTIN|SIGTTOU|SIGCHLD)\b/g, '<span class="syn-const">$1</span>');
    s = s.replace(/\b(fg|bg|jobs|kill)\b/g, '<span class="syn-syscall">$1</span>');
    return s;
  }

  wireEvents() {
    this.container.querySelector('#scenario-select')?.addEventListener('change', (e) => {
      this.loadScenario(parseInt(e.target.value));
    });
    this.container.querySelector('#btn-prev')?.addEventListener('click', () => { if (this.engine.prev()) this.render(); });
    this.container.querySelector('#btn-next')?.addEventListener('click', () => { if (this.engine.next()) this.render(); });
    this.container.querySelector('#btn-reset')?.addEventListener('click', () => { this.engine.reset(); this.render(); });
    this.container.querySelectorAll('.code-line').forEach(el => {
      el.addEventListener('click', () => { if (this.engine.goTo(parseInt(el.dataset.step))) this.render(); });
    });
    document.addEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'j') { if (this.engine.next()) this.render(); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { if (this.engine.prev()) this.render(); }
  };

  _scrollToActiveLine() {
    const active = this.container.querySelector('.code-line.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  destroy() { document.removeEventListener('keydown', this._onKeyDown); }
}
