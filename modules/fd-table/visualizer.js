/**
 * fd-table visualizer — 3-column layout with SVG arrows
 *
 * Layout:
 *   [Code Panel] | [fd table | file table | vnode] 3-column kernel diagram
 *                  ~~~~~~~~ SVG arrows connect them ~~~~~~~~
 */

import { ScenarioEngine } from '../../core/scenario-engine.js';
import { flagsToString } from '../../core/kernel-state.js';
import { SCENARIOS } from './scenarios.js';

export class FdTableVisualizer {
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
          <div class="kernel-panel-header">Kernel Data Structures</div>
          <div class="kernel-diagram" id="kernel-diagram">
            ${this._renderDiagram(state, diff)}
          </div>
          <svg class="arrow-svg" id="arrow-svg"></svg>
        </div>
      </div>
    `;

    this.wireEvents();
    this._scrollToActiveLine();
    // Draw arrows after DOM is rendered
    requestAnimationFrame(() => this._drawArrows(state));
  }

  // =========================================================================
  // Code panel with syntax highlighting
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
    // Process tags: [child], [parent], [shell], etc.
    s = s.replace(/\[([^\]]+)\]/g, '<span class="syn-tag">[$1]</span>');
    // Comments
    s = s.replace(/(\/\/.*)/g, '<span class="syn-comment">$1</span>');
    // Strings
    s = s.replace(/(&quot;[^&]*?&quot;)/g, '<span class="syn-string">$1</span>');
    // Types and keywords
    s = s.replace(/\b(int|pid_t|char|void|const|struct)\b/g, '<span class="syn-type">$1</span>');
    // Syscall / important functions
    s = s.replace(/\b(open|close|dup|dup2|fork|pipe|read|write|lseek|exec|execvp|wait|waitpid|exit|signal|kill)\b/g, '<span class="syn-syscall">$1</span>');
    // Constants
    s = s.replace(/\b(O_RDONLY|O_WRONLY|O_RDWR|O_APPEND|O_CREAT|O_TRUNC|STDOUT_FILENO|STDIN_FILENO|STDERR_FILENO|NULL)\b/g, '<span class="syn-const">$1</span>');
    // Numbers
    s = s.replace(/\b(\d+)\b/g, '<span class="syn-num">$1</span>');
    return s;
  }

  // =========================================================================
  // 3-column kernel diagram
  // =========================================================================

  _renderDiagram(state, diff) {
    const addedPids = new Set(diff.filter(d => d.type === 'process-added').map(d => d.pid));
    const addedFds = new Set(diff.filter(d => d.type === 'fd-added').map(d => `${d.pid}:${d.fd}`));
    const changedFds = new Set(diff.filter(d => d.type === 'fd-changed').map(d => `${d.pid}:${d.fd}`));
    const addedFtes = new Set(diff.filter(d => d.type === 'fte-added').map(d => d.id));
    const changedFtes = new Set(diff.filter(d => d.type === 'fte-refcount' || d.type === 'fte-offset').map(d => d.id));
    const addedVnodes = new Set(diff.filter(d => d.type === 'vnode-added').map(d => d.id));

    // Column 1: fd tables (per process)
    let col1 = '<div class="diagram-col col-fd">';
    col1 += '<div class="col-title">fd table (per process)</div>';
    for (const [pid, proc] of state.processes) {
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

    // Column 2: file table entries
    let col2 = '<div class="diagram-col col-fte">';
    col2 += '<div class="col-title">file table</div>';
    for (const [id, fte] of state.fileTable) {
      let cls = '';
      if (addedFtes.has(id)) cls = 'anim-appear';
      else if (changedFtes.has(id)) cls = 'anim-pulse';

      const refDiff = diff.find(d => d.type === 'fte-refcount' && d.id === id);
      const offDiff = diff.find(d => d.type === 'fte-offset' && d.id === id);

      col2 += `<div class="fte-card ${cls}" id="fte-card-${id}" data-vnode-id="${fte.vnodeId}">`;
      col2 += `<div class="fte-dot" id="fte-dot-left-${id}"></div>`;
      col2 += `<div class="fte-body">`;
      col2 += `<div class="fte-id">FTE #${id}</div>`;
      col2 += `<div class="fte-field">${flagsToString(fte.flags)}</div>`;
      col2 += `<div class="fte-field ${offDiff ? 'val-changed' : ''}">offset: ${fte.offset}${offDiff ? ` <span class="diff-from">(was ${offDiff.from})</span>` : ''}</div>`;
      col2 += `<div class="fte-field ${refDiff ? 'val-changed' : ''}">refcount: ${fte.refcount}${refDiff ? ` <span class="diff-from">(was ${refDiff.from})</span>` : ''}</div>`;
      col2 += `</div>`;
      col2 += `<div class="fte-dot" id="fte-dot-right-${id}"></div>`;
      col2 += `</div>`;
    }
    col2 += '</div>';

    // Column 3: vnodes
    let col3 = '<div class="diagram-col col-vnode">';
    col3 += '<div class="col-title">v-node table</div>';
    for (const [id, vn] of state.vnodes) {
      const cls = addedVnodes.has(id) ? 'anim-appear' : '';
      col3 += `<div class="vnode-card ${cls}" id="vnode-card-${id}">`;
      col3 += `<div class="vnode-dot" id="vnode-dot-${id}"></div>`;
      col3 += `<div class="vnode-body">`;
      col3 += `<div class="vnode-path">${this._escapeHtml(vn.path)}</div>`;
      col3 += `<div class="fte-field">${vn.type} | inode ${vn.inode}</div>`;
      col3 += `<div class="fte-field">size: ${vn.size}</div>`;
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

    // fd -> fte arrows (offset arrows targeting same FTE)
    const fteTargetCount = new Map(); // fteId -> count of arrows arriving
    for (const [pid, proc] of state.processes) {
      for (const [fd, fteId] of proc.fdTable) {
        const from = this.container.querySelector(`#fd-dot-${pid}-${fd}`);
        const to = this.container.querySelector(`#fte-dot-left-${fteId}`);
        if (from && to) {
          const idx = fteTargetCount.get(fteId) || 0;
          fteTargetCount.set(fteId, idx + 1);
          const yOff = (idx - 0.5) * 6; // spread arrows vertically
          paths += this._svgArrow(from, to, panelRect, 'var(--accent2)', 0, yOff);
        }
      }
    }

    // fte -> vnode arrows (offset arrows targeting same vnode)
    const vnodeTargetCount = new Map();
    for (const [id, fte] of state.fileTable) {
      const from = this.container.querySelector(`#fte-dot-right-${id}`);
      const to = this.container.querySelector(`#vnode-dot-${fte.vnodeId}`);
      if (from && to) {
        const idx = vnodeTargetCount.get(fte.vnodeId) || 0;
        vnodeTargetCount.set(fte.vnodeId, idx + 1);
        const yOff = (idx - 0.5) * 6;
        paths += this._svgArrow(from, to, panelRect, 'var(--purple)', 0, yOff);
      }
    }

    svg.innerHTML = `
      <defs>
        <marker id="arrowhead-accent2" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--accent2)" />
        </marker>
        <marker id="arrowhead-purple" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
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

    const markerColor = color.includes('purple') ? 'purple' : 'accent2';

    // Bezier curve for smooth arrows
    const dx = x2 - x1;
    const cpx = dx * 0.4;

    return `<path d="M${x1},${y1} C${x1 + cpx},${y1} ${x2 - cpx},${y2} ${x2},${y2}"
      fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.6"
      marker-end="url(#arrowhead-${markerColor})" />`;
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

    // Redraw arrows on resize
    window.addEventListener('resize', this._onResize);
  }

  _onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'j') {
      if (this.engine.next()) this.render();
    } else if (e.key === 'ArrowLeft' || e.key === 'k') {
      if (this.engine.prev()) this.render();
    }
  };

  _onResize = () => {
    if (this.engine) {
      const state = this.engine.current().state;
      this._drawArrows(state);
    }
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
