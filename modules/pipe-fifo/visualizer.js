/**
 * pipe-fifo visualizer — pipe buffer data flow visualization
 *
 * Shows pipe buffers as horizontal bar charts with data chunks,
 * plus writer/reader process connections.
 */

import { ScenarioEngine } from '../../core/scenario-engine.js';
import { flagsToString } from '../../core/kernel-state.js';
import { SCENARIOS } from './scenarios.js';

export class PipeFifoVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new ScenarioEngine(SCENARIOS[index]);
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
          <div class="kernel-panel-header">Pipe Data Flow</div>
          ${this._renderPipes(state, diff)}
          ${this._renderProcessList(state, diff)}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  // =========================================================================
  // Pipe buffer visualization
  // =========================================================================

  _renderPipes(state, diff) {
    const pipeWrites = new Set(diff.filter(d => d.type === 'pipe-write').map(d => d.vnodeId));
    const pipeReads = new Set(diff.filter(d => d.type === 'pipe-read').map(d => d.vnodeId));
    const pipeCloses = diff.filter(d => d.type === 'pipe-close');

    let html = '';
    let pipeIndex = 0;

    for (const [id, vn] of state.vnodes) {
      if (vn.type !== 'FIFO') continue;
      pipeIndex++;

      const hasWrite = pipeWrites.has(id);
      const hasRead = pipeReads.has(id);

      // Find writer and reader processes
      const writers = [];
      const readers = [];
      for (const [pid, proc] of state.processes) {
        if (proc.state === 'ZOMBIE') continue;
        for (const [fd, fteId] of proc.fdTable) {
          const fte = state.fileTable.get(fteId);
          if (fte && fte.vnodeId === id) {
            if (fte.flags === 0) readers.push({ pid, fd, name: proc.name });
            else writers.push({ pid, fd, name: proc.name });
          }
        }
      }

      const used = vn.bufferUsed;
      const pct = vn.capacity > 0 ? (used / vn.capacity * 100) : 0;

      html += `<div class="pipe-diagram ${hasWrite ? 'pipe-wrote' : ''} ${hasRead ? 'pipe-read-anim' : ''}">`;

      // Header
      html += `<div class="pipe-header">`;
      html += `<span class="pipe-label">Pipe ${pipeIndex}</span>`;
      html += `<span class="pipe-usage">${used} / ${vn.capacity} bytes (${Math.round(pct)}%)</span>`;
      if (vn.writeClosed) html += `<span class="pipe-badge pipe-badge-closed">write end closed</span>`;
      if (vn.readClosed) html += `<span class="pipe-badge pipe-badge-closed">read end closed</span>`;
      html += `</div>`;

      // Writer processes
      html += `<div class="pipe-flow">`;
      html += `<div class="pipe-endpoints">`;
      if (writers.length > 0) {
        html += writers.map(w => `<div class="pipe-endpoint writer">${this._escapeHtml(w.name)}<br><span class="pipe-fd">fd ${w.fd}</span></div>`).join('');
      } else {
        html += `<div class="pipe-endpoint closed">no writer</div>`;
      }
      html += `</div>`;

      // Arrow in
      html += `<div class="pipe-arrow">&#9654;</div>`;

      // Buffer bar
      html += `<div class="pipe-buffer-container">`;
      html += `<div class="pipe-buffer">`;
      if (vn.buffer.length > 0) {
        for (const chunk of vn.buffer) {
          const chunkPct = vn.capacity > 0 ? (chunk.size / vn.capacity * 100) : 0;
          html += `<div class="pipe-chunk anim-appear" style="width:${Math.max(chunkPct, 3)}%" title="${chunk.size} bytes">`;
          html += `<span class="chunk-label">${this._escapeHtml(chunk.label)}</span>`;
          html += `</div>`;
        }
      }
      html += `</div>`;
      html += `</div>`;

      // Arrow out
      html += `<div class="pipe-arrow">&#9654;</div>`;

      // Reader processes
      html += `<div class="pipe-endpoints">`;
      if (readers.length > 0) {
        html += readers.map(r => `<div class="pipe-endpoint reader">${this._escapeHtml(r.name)}<br><span class="pipe-fd">fd ${r.fd}</span></div>`).join('');
      } else {
        html += `<div class="pipe-endpoint closed">no reader</div>`;
      }
      html += `</div>`;

      html += `</div>`; // pipe-flow
      html += `</div>`; // pipe-diagram
    }

    if (pipeIndex === 0) {
      html += `<div class="pipe-empty">No pipes created yet. Press Next to start.</div>`;
    }

    return html;
  }

  // =========================================================================
  // Process list (compact)
  // =========================================================================

  _renderProcessList(state, diff) {
    const addedPids = new Set(diff.filter(d => d.type === 'process-added').map(d => d.pid));

    let html = '<div class="pipe-process-list">';
    html += '<div class="col-title" style="margin-top:16px">Processes</div>';

    for (const [pid, proc] of state.processes) {
      const isNew = addedPids.has(pid);
      const fds = [...proc.fdTable.keys()].sort((a, b) => a - b);
      html += `<div class="pipe-proc ${isNew ? 'anim-appear' : ''} ${proc.state === 'ZOMBIE' ? 'zombie' : ''}">`;
      html += `<span class="pipe-proc-name">${this._escapeHtml(proc.name)}</span>`;
      html += `<span class="pipe-proc-pid">PID ${pid}</span>`;
      html += `<span class="pipe-proc-fds">fds: [${fds.join(', ')}]</span>`;
      if (proc.state === 'ZOMBIE') html += `<span class="ptree-state-badge zombie">ZOMBIE</span>`;
      html += `</div>`;
    }

    html += '</div>';
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
    s = s.replace(/(&quot;[^&]*?&quot;)/g, '<span class="syn-string">$1</span>');
    s = s.replace(/\b(int|pid_t|char|void|const|struct)\b/g, '<span class="syn-type">$1</span>');
    s = s.replace(/\b(open|close|dup|dup2|fork|pipe|read|write|lseek|exec|execvp|exit|wait|waitpid)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(O_RDONLY|O_WRONLY|O_RDWR|STDOUT_FILENO|STDIN_FILENO|STDERR_FILENO|NULL|EOF|SIGPIPE)\b/g, '<span class="syn-const">$1</span>');
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
