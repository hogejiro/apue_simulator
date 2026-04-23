/**
 * record-lock visualizer — byte-range lock visualization
 *
 * Shows a file as a horizontal bar with colored lock ranges per process.
 * Read locks = blue/shared, Write locks = red/exclusive.
 */

import { LockScenarioEngine } from '../../core/lock-scenario-engine.js';
import { F_RDLCK, F_WRLCK } from '../../core/lock-table.js';
import { SCENARIOS } from './scenarios.js';

const FILE_SIZE = 200; // visual file size for display

export class RecordLockVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new LockScenarioEngine(SCENARIOS[index]);
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
          <div class="code-lines">
            ${this._renderCodeLines()}
          </div>
        </div>

        <div class="kernel-panel" id="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Record Locks</div>
          ${this._renderLockDiagram(state, diff)}
          ${this._renderLegend()}
          ${this._renderLockList(state, diff)}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  // =========================================================================
  // Lock diagram: file bar with colored lock ranges
  // =========================================================================

  _renderLockDiagram(state, diff) {
    const addedLocks = diff.filter(d => d.type === 'lock-added').map(d => d.lock);
    const removedLocks = diff.filter(d => d.type === 'lock-removed').map(d => d.lock);

    // Find all unique PIDs
    const pids = [...new Set(state.locks.map(l => l.pid))].sort();
    const pidColors = ['var(--accent2)', 'var(--green)', 'var(--accent)', 'var(--yellow)', 'var(--purple)'];

    // Byte ruler
    let html = '<div class="lock-diagram">';

    // Ruler
    html += '<div class="lock-ruler">';
    for (let i = 0; i <= FILE_SIZE; i += 50) {
      const pct = (i / FILE_SIZE) * 100;
      html += `<span class="ruler-mark" style="left:${pct}%">${i}</span>`;
    }
    html += '</div>';

    // One row per PID
    if (pids.length === 0 && state.locks.length === 0) {
      html += '<div class="lock-row"><div class="lock-pid">No locks</div><div class="lock-bar"></div></div>';
    }

    for (const pid of pids) {
      const color = pidColors[(pid - 1) % pidColors.length];
      const pidLocks = state.locks.filter(l => l.pid === pid);

      html += `<div class="lock-row">`;
      html += `<div class="lock-pid" style="color:${color}">PID ${pid}</div>`;
      html += `<div class="lock-bar">`;

      for (const lock of pidLocks) {
        const start = lock.start;
        const end = lock.end === -1 ? FILE_SIZE : Math.min(lock.end, FILE_SIZE);
        const leftPct = (start / FILE_SIZE) * 100;
        const widthPct = ((end - start + 1) / FILE_SIZE) * 100;

        const isNew = addedLocks.some(a => a.pid === lock.pid && a.start === lock.start && a.end === lock.end);
        const typeLabel = lock.type === F_RDLCK ? 'R' : 'W';
        const typeCls = lock.type === F_RDLCK ? 'lock-read' : 'lock-write';

        html += `<div class="lock-range ${typeCls} ${isNew ? 'anim-appear' : ''}" `
          + `style="left:${leftPct}%;width:${Math.max(widthPct, 1)}%" `
          + `title="PID ${pid}: ${lock.type} [${lock.start}-${lock.end === -1 ? 'EOF' : lock.end}]">`;
        html += `<span class="lock-type-label">${typeLabel}</span>`;
        html += `</div>`;
      }

      html += `</div></div>`;
    }

    // Show removed locks as ghost
    for (const lock of removedLocks) {
      if (!pids.includes(lock.pid)) {
        // PID row was already shown, skip
      }
    }

    html += '</div>';
    return html;
  }

  _renderLegend() {
    return `<div class="lock-legend">
      <span class="lock-legend-item"><span class="lock-range lock-read" style="position:static;display:inline-block;width:30px;height:14px"><span class="lock-type-label">R</span></span> Read (shared)</span>
      <span class="lock-legend-item"><span class="lock-range lock-write" style="position:static;display:inline-block;width:30px;height:14px"><span class="lock-type-label">W</span></span> Write (exclusive)</span>
    </div>`;
  }

  _renderLockList(state, diff) {
    if (state.locks.length === 0) return '';

    let html = '<div class="lock-list-section">';
    html += '<div class="col-title" style="margin-top:12px">Lock Table</div>';
    html += '<table class="lock-list-table">';
    html += '<tr><th>PID</th><th>Type</th><th>Start</th><th>End</th></tr>';

    for (const lock of state.locks) {
      const isNew = diff.some(d => d.type === 'lock-added' && d.lock.start === lock.start && d.lock.end === lock.end && d.lock.pid === lock.pid);
      html += `<tr class="${isNew ? 'added' : ''}">`;
      html += `<td>${lock.pid}</td>`;
      html += `<td class="${lock.type === F_RDLCK ? 'lock-type-r' : 'lock-type-w'}">${lock.type}</td>`;
      html += `<td>${lock.start}</td>`;
      html += `<td>${lock.end === -1 ? 'EOF' : lock.end}</td>`;
      html += `</tr>`;
    }

    html += '</table></div>';
    return html;
  }

  // =========================================================================
  // Code panel
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
    s = s.replace(/\b(int|struct|void)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(fcntl|open|close|flock)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(F_SETLK|F_SETLKW|F_GETLK|F_RDLCK|F_WRLCK|F_UNLCK|SEEK_SET|EDEADLK|EAGAIN|EACCES)\b/g, '<span class="syn-const">$1</span>');
    s = s.replace(/\b(\d+)\b/g, '<span class="syn-num">$1</span>');
    return s;
  }

  // =========================================================================
  // Events
  // =========================================================================

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
