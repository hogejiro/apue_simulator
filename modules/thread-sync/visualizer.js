/**
 * thread-sync visualizer — swimlane display for thread states + lock status
 */

import { ThreadScenarioEngine } from '../../core/thread-scenario-engine.js';
import { SCENARIOS } from './scenarios.js';

export class ThreadSyncVisualizer {
  constructor(container) {
    this.container = container;
    this.engine = null;
    this.currentScenarioIndex = 0;
  }

  init() { this.loadScenario(0); }

  loadScenario(index) {
    this.currentScenarioIndex = index;
    this.engine = new ThreadScenarioEngine(SCENARIOS[index]);
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

        <div class="kernel-panel">
          ${lesson ? `<div class="lesson-panel">${lesson}</div>` : ''}
          <div class="kernel-panel-header">Thread State</div>
          ${this._renderThreads(state, diff)}
          ${this._renderSyncObjects(state, diff)}
          ${this._renderLog(state, diff)}
        </div>
      </div>

    `;

    this.wireEvents();
    this._scrollToActiveLine();
  }

  _renderThreads(state, diff) {
    const stateChanged = new Set(diff.filter(d => d.type === 'thread-state').map(d => d.tid));

    let html = '<div class="thread-lanes">';
    for (const [tid, t] of state.threads) {
      const isChanged = stateChanged.has(tid);
      const stateCls = t.state === 'BLOCKED' ? 'thr-blocked' : t.state === 'TERMINATED' ? 'thr-terminated' : 'thr-running';
      const animCls = isChanged ? 'anim-pulse' : '';

      html += `<div class="thread-lane ${stateCls} ${animCls}">`;
      html += `<div class="thr-header">`;
      html += `<span class="thr-name">T${tid} ${this._escapeHtml(t.name)}</span>`;
      html += `<span class="thr-state-badge ${stateCls}">${t.state}</span>`;
      html += `</div>`;
      if (t.blockedOn) {
        html += `<div class="thr-blocked-on">waiting: ${this._escapeHtml(t.blockedOn)}</div>`;
      }
      html += `</div>`;
    }
    html += '</div>';
    return html;
  }

  _renderSyncObjects(state, diff) {
    const mutexChanged = new Set(diff.filter(d => d.type === 'mutex-owner').map(d => d.name));

    let html = '<div class="sync-objects">';

    // Mutexes
    for (const [name, m] of state.mutexes) {
      const isChanged = mutexChanged.has(name);
      html += `<div class="sync-obj ${isChanged ? 'anim-pulse' : ''}">`;
      html += `<div class="sync-icon">&#128274;</div>`;
      html += `<div class="sync-body">`;
      html += `<div class="sync-name">${this._escapeHtml(name)}</div>`;
      html += m.owner
        ? `<div class="sync-status sync-locked">locked by T${m.owner}</div>`
        : `<div class="sync-status sync-free">free</div>`;
      if (m.waitQueue.length > 0) {
        html += `<div class="sync-wait">waiting: ${m.waitQueue.map(t => 'T' + t).join(', ')}</div>`;
      }
      html += `</div></div>`;
    }

    // Condvars
    for (const [name, c] of state.condvars) {
      html += `<div class="sync-obj">`;
      html += `<div class="sync-icon">&#9203;</div>`;
      html += `<div class="sync-body">`;
      html += `<div class="sync-name">${this._escapeHtml(name)}</div>`;
      html += c.waitQueue.length > 0
        ? `<div class="sync-wait">waiting: ${c.waitQueue.map(t => 'T' + t).join(', ')}</div>`
        : `<div class="sync-status sync-free">no waiters</div>`;
      html += `</div></div>`;
    }

    // RW Locks
    for (const [name, rw] of state.rwlocks) {
      html += `<div class="sync-obj">`;
      html += `<div class="sync-icon">&#128218;</div>`;
      html += `<div class="sync-body">`;
      html += `<div class="sync-name">${this._escapeHtml(name)}</div>`;
      if (rw.writer) {
        html += `<div class="sync-status sync-locked">write-locked by T${rw.writer}</div>`;
      } else if (rw.readers.length > 0) {
        html += `<div class="sync-status sync-shared">read-locked by ${rw.readers.map(t => 'T' + t).join(', ')}</div>`;
      } else {
        html += `<div class="sync-status sync-free">free</div>`;
      }
      if (rw.writeWaitQueue.length > 0) html += `<div class="sync-wait">write-wait: ${rw.writeWaitQueue.map(t => 'T' + t).join(', ')}</div>`;
      if (rw.readWaitQueue.length > 0) html += `<div class="sync-wait">read-wait: ${rw.readWaitQueue.map(t => 'T' + t).join(', ')}</div>`;
      html += `</div></div>`;
    }

    html += '</div>';
    return html;
  }

  _renderLog(state, diff) {
    if (state.log.length === 0) return '';
    const newCount = diff.filter(d => d.type === 'log-entry').length;

    let html = '<div class="signal-log-section"><div class="col-title" style="margin-top:12px">Event Log</div>';
    html += '<div class="signal-log">';
    html += state.log.map((entry, i) => {
      const isNew = i >= state.log.length - newCount;
      return `<div class="log-entry ${isNew ? 'log-new' : ''}">${this._escapeHtml(entry)}</div>`;
    }).join('');
    html += '</div></div>';
    return html;
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
    s = s.replace(/\b(pthread_mutex_lock|pthread_mutex_unlock|pthread_cond_wait|pthread_cond_signal|pthread_cond_broadcast|pthread_rwlock_rdlock|pthread_rwlock_wrlock|pthread_rwlock_unlock)\b/g, '<span class="syn-syscall">$1</span>');
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
