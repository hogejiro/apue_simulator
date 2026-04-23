/**
 * fork-exec visualizer — process lifecycle with tree view + fd diagram
 *
 * Top: process tree (parent-child relationships, state badges)
 * Bottom: kernel data structures (fd table / file table / vnode - reusing fd-table layout)
 */

import { ScenarioEngine } from '../../core/scenario-engine.js';
import { flagsToString } from '../../core/kernel-state.js';
import { SCENARIOS } from './scenarios.js';

export class ForkExecVisualizer {
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
          <div class="code-lines" id="code-lines">
            ${this._renderCodeLines()}
          </div>
        </div>

        <div class="kernel-panel" id="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Process Tree</div>
          <div class="process-tree">
            ${this._renderProcessTree(state, diff)}
          </div>

          <div class="kernel-panel-header" style="margin-top:16px">Kernel Data Structures</div>
          <div class="kernel-diagram" id="kernel-diagram">
            ${this._renderDiagram(state, diff)}
          </div>
          <svg class="arrow-svg" id="arrow-svg"></svg>
        </div>
      </div>
    `;

    this.wireEvents();
    this._scrollToActiveLine();
    requestAnimationFrame(() => this._drawArrows(state));
  }

  // =========================================================================
  // Process Tree
  // =========================================================================

  _renderProcessTree(state, diff) {
    const addedPids = new Set(diff.filter(d => d.type === 'process-added').map(d => d.pid));
    const stateChanged = new Set(diff.filter(d => d.type === 'process-state').map(d => d.pid));
    const execChanged = new Set(diff.filter(d => d.type === 'process-exec').map(d => d.pid));
    const removedPids = new Set(diff.filter(d => d.type === 'process-removed').map(d => d.pid));

    let html = '<div class="ptree-container">';

    for (const [pid, proc] of state.processes) {
      const isNew = addedPids.has(pid);
      const isStateChanged = stateChanged.has(pid);
      const isExecChanged = execChanged.has(pid);

      const stateClass = proc.state === 'ZOMBIE' ? 'zombie' : proc.state === 'RUNNING' ? 'running' : '';
      const animClass = isNew ? 'anim-appear' : (isStateChanged || isExecChanged) ? 'anim-pulse' : '';

      html += `<div class="ptree-node ${stateClass} ${animClass}">`;
      html += `<div class="ptree-pid">PID ${pid}</div>`;
      html += `<div class="ptree-name">${this._escapeHtml(proc.name || proc.program || 'process')}</div>`;
      if (proc.program) {
        html += `<div class="ptree-program">${this._escapeHtml(proc.program)}</div>`;
      }
      html += `<div class="ptree-state-badge ${stateClass}">${proc.state}</div>`;
      if (proc.state === 'ZOMBIE') {
        html += `<div class="ptree-exit">exit(${proc.exitStatus})</div>`;
      }
      html += `<div class="ptree-fds">${proc.fdTable.size} fds</div>`;
      html += `</div>`;
    }

    html += '</div>';
    return html;
  }

  // =========================================================================
  // Code panel with syntax highlighting (shared with fd-table)
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
    s = s.replace(/\b(open|close|dup|dup2|fork|pipe|read|write|lseek|exec|execvp|exit|wait|waitpid|signal|kill)\b/g, '<span class="syn-syscall">$1</span>');
    s = s.replace(/\b(O_RDONLY|O_WRONLY|O_RDWR|O_APPEND|O_CREAT|O_TRUNC|STDOUT_FILENO|STDIN_FILENO|STDERR_FILENO|NULL)\b/g, '<span class="syn-const">$1</span>');
    s = s.replace(/\b(\d+)\b/g, '<span class="syn-num">$1</span>');
    return s;
  }

  // =========================================================================
  // 3-column kernel diagram (reused from fd-table)
  // =========================================================================

  _renderDiagram(state, diff) {
    const addedPids = new Set(diff.filter(d => d.type === 'process-added').map(d => d.pid));
    const addedFds = new Set(diff.filter(d => d.type === 'fd-added').map(d => `${d.pid}:${d.fd}`));
    const changedFds = new Set(diff.filter(d => d.type === 'fd-changed').map(d => `${d.pid}:${d.fd}`));
    const addedFtes = new Set(diff.filter(d => d.type === 'fte-added').map(d => d.id));
    const changedFtes = new Set(diff.filter(d => d.type === 'fte-refcount' || d.type === 'fte-offset').map(d => d.id));
    const addedVnodes = new Set(diff.filter(d => d.type === 'vnode-added').map(d => d.id));

    // Column 1: fd tables
    let col1 = '<div class="diagram-col col-fd">';
    col1 += '<div class="col-title">fd table</div>';
    for (const [pid, proc] of state.processes) {
      if (proc.state === 'ZOMBIE') continue; // zombies have no fds
      const isNew = addedPids.has(pid);
      col1 += `<div class="process-box ${isNew ? 'anim-appear' : ''}">`;
      col1 += `<div class="process-header"><span>${this._escapeHtml(proc.name)}</span><span class="pid-label">PID ${pid}</span></div>`;

      const sortedFds = [...proc.fdTable.entries()].sort((a, b) => a[0] - b[0]);
      for (const [fd, fteId] of sortedFds) {
        const key = `${pid}:${fd}`;
        let cls = '';
        if (addedFds.has(key)) cls = 'added anim-appear';
        else if (changedFds.has(key)) cls = 'changed anim-pulse';

        const fdLabel = fd === 0 ? '0 stdin' : fd === 1 ? '1 stdout' : fd === 2 ? '2 stderr' : String(fd);
        col1 += `<div class="fd-row ${cls}" data-fd-id="fd-${pid}-${fd}" data-fte-id="${fteId}">`;
        col1 += `<span class="fd-num">${fdLabel}</span>`;
        col1 += `<span class="fd-dot" id="fd-dot-${pid}-${fd}"></span>`;
        col1 += `</div>`;
      }
      col1 += `</div>`;
    }
    col1 += '</div>';

    // Column 2: file table
    let col2 = '<div class="diagram-col col-fte">';
    col2 += '<div class="col-title">file table</div>';
    for (const [id, fte] of state.fileTable) {
      let cls = '';
      if (addedFtes.has(id)) cls = 'anim-appear';
      else if (changedFtes.has(id)) cls = 'anim-pulse';

      const refDiff = diff.find(d => d.type === 'fte-refcount' && d.id === id);

      col2 += `<div class="fte-card ${cls}" id="fte-card-${id}">`;
      col2 += `<div class="fte-dot" id="fte-dot-left-${id}"></div>`;
      col2 += `<div class="fte-body">`;
      col2 += `<div class="fte-id">FTE #${id}</div>`;
      col2 += `<div class="fte-field">${flagsToString(fte.flags)}</div>`;
      col2 += `<div class="fte-field ${refDiff ? 'val-changed' : ''}">ref: ${fte.refcount}${refDiff ? ` <span class="diff-from">(was ${refDiff.from})</span>` : ''}</div>`;
      col2 += `</div>`;
      col2 += `<div class="fte-dot" id="fte-dot-right-${id}"></div>`;
      col2 += `</div>`;
    }
    col2 += '</div>';

    // Column 3: vnodes
    let col3 = '<div class="diagram-col col-vnode">';
    col3 += '<div class="col-title">v-node</div>';
    for (const [id, vn] of state.vnodes) {
      const cls = addedVnodes.has(id) ? 'anim-appear' : '';
      col3 += `<div class="vnode-card ${cls}" id="vnode-card-${id}">`;
      col3 += `<div class="vnode-dot" id="vnode-dot-${id}"></div>`;
      col3 += `<div class="vnode-body">`;
      col3 += `<div class="vnode-path">${this._escapeHtml(vn.path)}</div>`;
      col3 += `<div class="fte-field">${vn.type}</div>`;
      col3 += `</div>`;
      col3 += `</div>`;
    }
    col3 += '</div>';

    return col1 + col2 + col3;
  }

  // =========================================================================
  // SVG arrows
  // =========================================================================

  _drawArrows(state) {
    const svg = this.container.querySelector('#arrow-svg');
    const panel = this.container.querySelector('#kernel-panel');
    if (!svg || !panel) return;

    const panelRect = panel.getBoundingClientRect();
    svg.setAttribute('width', panelRect.width);
    svg.setAttribute('height', panelRect.height);
    svg.style.width = panelRect.width + 'px';
    svg.style.height = panelRect.height + 'px';

    let paths = '';

    const fteTargetCount = new Map();
    for (const [pid, proc] of state.processes) {
      if (proc.state === 'ZOMBIE') continue;
      for (const [fd, fteId] of proc.fdTable) {
        const from = this.container.querySelector(`#fd-dot-${pid}-${fd}`);
        const to = this.container.querySelector(`#fte-dot-left-${fteId}`);
        if (from && to) {
          const idx = fteTargetCount.get(fteId) || 0;
          fteTargetCount.set(fteId, idx + 1);
          paths += this._svgArrow(from, to, panelRect, 'var(--accent2)', 0, (idx - 0.5) * 6);
        }
      }
    }

    const vnodeTargetCount = new Map();
    for (const [id, fte] of state.fileTable) {
      const from = this.container.querySelector(`#fte-dot-right-${id}`);
      const to = this.container.querySelector(`#vnode-dot-${fte.vnodeId}`);
      if (from && to) {
        const idx = vnodeTargetCount.get(fte.vnodeId) || 0;
        vnodeTargetCount.set(fte.vnodeId, idx + 1);
        paths += this._svgArrow(from, to, panelRect, 'var(--purple)', 0, (idx - 0.5) * 6);
      }
    }

    svg.innerHTML = `
      <defs>
        <marker id="ah-accent2" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--accent2)" />
        </marker>
        <marker id="ah-purple" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--purple)" />
        </marker>
      </defs>
      ${paths}
    `;
  }

  _svgArrow(fromEl, toEl, panelRect, color, xOff = 0, yOff = 0) {
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const x1 = fr.left + fr.width / 2 - panelRect.left;
    const y1 = fr.top + fr.height / 2 - panelRect.top;
    const x2 = tr.left + tr.width / 2 - panelRect.left + xOff;
    const y2 = tr.top + tr.height / 2 - panelRect.top + yOff;
    const markerId = color.includes('purple') ? 'ah-purple' : 'ah-accent2';
    const dx = x2 - x1;
    const cpx = dx * 0.4;
    return `<path d="M${x1},${y1} C${x1 + cpx},${y1} ${x2 - cpx},${y2} ${x2},${y2}"
      fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.6"
      marker-end="url(#${markerId})" />`;
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
    window.addEventListener('resize', this._onResize);
  }

  _onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'j') { if (this.engine.next()) this.render(); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { if (this.engine.prev()) this.render(); }
  };

  _onResize = () => {
    if (this.engine) this._drawArrows(this.engine.current().state);
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
    window.removeEventListener('resize', this._onResize);
  }
}
