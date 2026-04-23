/**
 * signal-delivery visualizer — mask / pending / disposition bitmap display
 *
 * Layout:
 *   [Code Panel] | [Signal State: 3-column bitmap + event log]
 */

import { SignalScenarioEngine } from '../../core/signal-scenario-engine.js';
import { SIGNALS, SIG_DFL, SIG_IGN } from '../../core/signal-state.js';
import { SCENARIOS } from './scenarios.js';

export class SignalDeliveryVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() {
    this.loadScenario(0);
  }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new SignalScenarioEngine(SCENARIOS[index]);
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
          <div class="code-panel-header">C Code</div>
          <div class="code-lines" id="code-lines">
            ${this._renderCodeLines()}
          </div>
        </div>

        <div class="kernel-panel" id="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Signal State</div>
          <div class="signal-grid">
            ${this._renderSignalGrid(state, diff)}
          </div>

          ${state.log.length > 0 ? `
          <div class="signal-log-section">
            <div class="col-title">Event Log</div>
            <div class="signal-log">
              ${this._renderLog(state, diff)}
            </div>
          </div>
          ` : ''}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  // =========================================================================
  // Signal grid: rows of signals, columns for mask/pending/disposition
  // =========================================================================

  _renderSignalGrid(state, diff) {
    const maskAdded = new Set(diff.filter(d => d.type === 'mask-added').map(d => d.signo));
    const maskRemoved = new Set(diff.filter(d => d.type === 'mask-removed').map(d => d.signo));
    const pendingAdded = new Set(diff.filter(d => d.type === 'pending-added').map(d => d.signo));
    const pendingRemoved = new Set(diff.filter(d => d.type === 'pending-removed').map(d => d.signo));
    const dispChanged = new Set(diff.filter(d => d.type === 'disposition-changed').map(d => d.signo));

    let html = '<table class="sig-table">';
    html += '<tr class="sig-header">';
    html += '<th>Signal</th>';
    html += '<th>Blocked</th>';
    html += '<th>Pending</th>';
    html += '<th>Disposition</th>';
    html += '</tr>';

    for (const sig of SIGNALS) {
      const isMasked = state.mask.has(sig);
      const isPending = state.pending.has(sig);
      const disp = state.disposition.get(sig) || SIG_DFL;

      const maskCls = maskAdded.has(sig) ? 'cell-added' : maskRemoved.has(sig) ? 'cell-removed' : '';
      const pendCls = pendingAdded.has(sig) ? 'cell-added' : pendingRemoved.has(sig) ? 'cell-removed' : '';
      const dispCls = dispChanged.has(sig) ? 'cell-changed' : '';

      const isActive = isMasked || isPending || disp !== SIG_DFL;
      const rowCls = isActive ? 'sig-active' : '';

      html += `<tr class="${rowCls}">`;
      html += `<td class="sig-name">${sig}</td>`;
      html += `<td class="sig-cell ${maskCls}">${this._renderBit(isMasked, 'mask')}</td>`;
      html += `<td class="sig-cell ${pendCls}">${this._renderBit(isPending, 'pending')}</td>`;
      html += `<td class="sig-cell sig-disp ${dispCls}">${this._renderDisposition(disp)}</td>`;
      html += `</tr>`;
    }

    html += '</table>';
    return html;
  }

  _renderBit(on, type) {
    if (!on) return '<span class="bit-off"></span>';
    const color = type === 'mask' ? 'var(--yellow)' : 'var(--accent)';
    return `<span class="bit-on" style="background:${color}"></span>`;
  }

  _renderDisposition(disp) {
    if (disp === SIG_DFL) return `<span class="disp-default">SIG_DFL</span>`;
    if (disp === SIG_IGN) return `<span class="disp-ignore">SIG_IGN</span>`;
    return `<span class="disp-handler">${this._escapeHtml(disp)}()</span>`;
  }

  // =========================================================================
  // Event log
  // =========================================================================

  _renderLog(state, diff) {
    const newLogStart = diff.filter(d => d.type === 'log-entry').length;
    const logLen = state.log.length;

    return state.log.map((entry, i) => {
      const isNew = i >= logLen - newLogStart;
      return `<div class="log-entry ${isNew ? 'log-new' : ''}">${this._escapeHtml(entry)}</div>`;
    }).join('');
  }

  // =========================================================================
  // Code panel (shared pattern)
  // =========================================================================

  _renderCodeLines() {
    const lines = this.engine.codeLines();
    return lines.map((line, i) => {
      const cls = line.active ? 'active' : (i < this.engine.currentStep ? 'past' : '');
      const lineNum = i === 0 ? '' : i;
      return `<div class="code-line ${cls}" data-step="${i}">` +
        `<span class="line-num">${lineNum}</span>` +
        `<span class="line-code">${this._highlightSyntax(line.code)}</span>` +
        `</div>`;
    }).join('');
  }

  _highlightSyntax(code) {
    let s = this._escapeHtml(code);
    s = s.replace(/\[([^\]]+)\]/g, '<span class="syn-tag">[$1]</span>');
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    s = s.replace(/(&quot;[^&]*?&quot;)/g, '<span class="syn-string">$1</span>');
    s = s.replace(/\b(int|pid_t|sigset_t|void|const|struct)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(sigaction|sigprocmask|sigsuspend|sigpending|kill|raise|alarm|pause|signal)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(SIG_BLOCK|SIG_UNBLOCK|SIG_SETMASK|SIG_DFL|SIG_IGN|SIGINT|SIGTERM|SIGQUIT|SIGCHLD|SIGALRM|SIGKILL|SIGSTOP|SIGUSR1|SIGUSR2|SIGHUP|SIGPIPE)\b/g, '<span class="syn-const">$1</span>');
    return s;
  }

  // =========================================================================
  // Events
  // =========================================================================

  wireEvents() {
    this.container.querySelector('#scenario-select')?.addEventListener('change', (e) => {
      this.loadScenario(parseInt(e.target.value));
    });
    this.container.querySelector('#btn-prev')?.addEventListener('click', () => {
      if (this.engine.prev()) this.render();
    });
    this.container.querySelector('#btn-next')?.addEventListener('click', () => {
      if (this.engine.next()) this.render();
    });
    this.container.querySelector('#btn-reset')?.addEventListener('click', () => {
      this.engine.reset();
      this.render();
    });
    this.container.querySelectorAll('.code-line').forEach(el => {
      el.addEventListener('click', () => {
        const step = parseInt(el.dataset.step);
        if (this.engine.goTo(step)) this.render();
      });
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

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
  }
}
