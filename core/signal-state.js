/**
 * signal-state.js — Signal delivery mechanism model
 *
 * Models APUE Chapter 10:
 *   - Per-process signal mask (blocked signals)
 *   - Per-process pending signals
 *   - Per-process signal disposition (handler/SIG_DFL/SIG_IGN)
 *   - Signal delivery: send → pending → unblock → handler invoked
 *
 * Signals are identified by name (SIGINT, SIGCHLD, etc.) for readability.
 */

// Standard signals (subset relevant for visualization)
export const SIGNALS = [
  'SIGHUP',  'SIGINT',  'SIGQUIT', 'SIGABRT',
  'SIGKILL', 'SIGPIPE', 'SIGALRM', 'SIGTERM',
  'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP',
  'SIGUSR1', 'SIGUSR2',
];

// Dispositions
export const SIG_DFL = 'SIG_DFL';
export const SIG_IGN = 'SIG_IGN';

// Default actions
export const DEFAULT_ACTIONS = {
  SIGHUP:  'terminate',
  SIGINT:  'terminate',
  SIGQUIT: 'core dump',
  SIGABRT: 'core dump',
  SIGKILL: 'terminate',  // cannot be caught or ignored
  SIGPIPE: 'terminate',
  SIGALRM: 'terminate',
  SIGTERM: 'terminate',
  SIGCHLD: 'ignore',
  SIGCONT: 'continue',
  SIGSTOP: 'stop',       // cannot be caught or ignored
  SIGTSTP: 'stop',
  SIGUSR1: 'terminate',
  SIGUSR2: 'terminate',
};

export class SignalState {
  constructor() {
    /** @type {Set<string>} blocked signals */
    this.mask = new Set();
    /** @type {Set<string>} pending signals (sent but not yet delivered) */
    this.pending = new Set();
    /** @type {Map<string, string>} signal -> disposition (SIG_DFL, SIG_IGN, or handler name) */
    this.disposition = new Map();
    /** @type {Array<string>} log of events for visualization */
    this.log = [];

    // Initialize all signals to SIG_DFL
    for (const sig of SIGNALS) {
      this.disposition.set(sig, SIG_DFL);
    }
  }

  clone() {
    const s = new SignalState();
    s.mask = new Set(this.mask);
    s.pending = new Set(this.pending);
    s.disposition = new Map(this.disposition);
    s.log = [...this.log];
    return s;
  }

  // -- sigaction / signal -----------------------------------------------------

  /**
   * Set disposition for a signal.
   * Returns previous disposition.
   */
  sigaction(signo, handler) {
    if (signo === 'SIGKILL' || signo === 'SIGSTOP') {
      throw new Error(`Cannot change disposition of ${signo}`);
    }
    const prev = this.disposition.get(signo) || SIG_DFL;
    this.disposition.set(signo, handler);
    this.log.push(`sigaction(${signo}, ${handler})`);
    return prev;
  }

  // -- sigprocmask ------------------------------------------------------------

  /**
   * Block signals (add to mask).
   * @param {string[]} signals
   */
  block(signals) {
    for (const sig of signals) {
      if (sig === 'SIGKILL' || sig === 'SIGSTOP') continue; // cannot block
      this.mask.add(sig);
    }
    this.log.push(`sigprocmask(SIG_BLOCK, {${signals.join(', ')}})`);
  }

  /**
   * Unblock signals (remove from mask).
   * Returns array of signals that were delivered as a result.
   * @param {string[]} signals
   */
  unblock(signals) {
    const delivered = [];
    for (const sig of signals) {
      this.mask.delete(sig);
      // If signal was pending and now unblocked, deliver it
      if (this.pending.has(sig)) {
        this.pending.delete(sig);
        delivered.push(this._deliver(sig));
      }
    }
    this.log.push(`sigprocmask(SIG_UNBLOCK, {${signals.join(', ')}})`);
    return delivered;
  }

  /**
   * Set mask to exactly these signals.
   * Returns array of signals that were delivered as a result.
   * @param {string[]} signals
   */
  setmask(signals) {
    const newMask = new Set(signals.filter(s => s !== 'SIGKILL' && s !== 'SIGSTOP'));
    const oldMask = this.mask;
    this.mask = newMask;

    // Check for newly unblocked pending signals
    const delivered = [];
    for (const sig of oldMask) {
      if (!newMask.has(sig) && this.pending.has(sig)) {
        this.pending.delete(sig);
        delivered.push(this._deliver(sig));
      }
    }
    this.log.push(`sigprocmask(SIG_SETMASK, {${signals.join(', ')}})`);
    return delivered;
  }

  // -- kill (send signal) -----------------------------------------------------

  /**
   * Send a signal to this process.
   * If blocked, goes to pending. If not blocked, delivered immediately.
   * Returns delivery result or null if pending.
   */
  kill(signo) {
    this.log.push(`signal ${signo} received`);

    // Check disposition first
    const disp = this.disposition.get(signo) || SIG_DFL;
    if (disp === SIG_IGN && signo !== 'SIGKILL' && signo !== 'SIGSTOP') {
      this.log.push(`${signo} ignored (SIG_IGN)`);
      return { action: 'ignored', signo };
    }

    // If blocked (and blockable), add to pending
    if (this.mask.has(signo) && signo !== 'SIGKILL' && signo !== 'SIGSTOP') {
      this.pending.add(signo);  // standard signals: only one pending per type
      this.log.push(`${signo} blocked → added to pending`);
      return { action: 'pending', signo };
    }

    // Deliver immediately
    return this._deliver(signo);
  }

  // -- sigpending -------------------------------------------------------------

  /**
   * Returns set of currently pending signals.
   */
  sigpending() {
    return new Set(this.pending);
  }

  // -- internal ---------------------------------------------------------------

  _deliver(signo) {
    const disp = this.disposition.get(signo) || SIG_DFL;

    if (disp === SIG_DFL) {
      const action = DEFAULT_ACTIONS[signo] || 'terminate';
      this.log.push(`${signo} delivered → default action: ${action}`);
      return { action: 'default', signo, defaultAction: action };
    }

    if (disp === SIG_IGN) {
      this.log.push(`${signo} delivered → ignored`);
      return { action: 'ignored', signo };
    }

    // Custom handler
    this.log.push(`${signo} delivered → handler: ${disp}()`);
    return { action: 'handler', signo, handler: disp };
  }
}

// ---------------------------------------------------------------------------
// Diff computation between two SignalState snapshots
// ---------------------------------------------------------------------------
export function computeSignalDiff(before, after) {
  const changes = [];

  // Mask changes
  for (const sig of after.mask) {
    if (!before.mask.has(sig)) {
      changes.push({ type: 'mask-added', signo: sig });
    }
  }
  for (const sig of before.mask) {
    if (!after.mask.has(sig)) {
      changes.push({ type: 'mask-removed', signo: sig });
    }
  }

  // Pending changes
  for (const sig of after.pending) {
    if (!before.pending.has(sig)) {
      changes.push({ type: 'pending-added', signo: sig });
    }
  }
  for (const sig of before.pending) {
    if (!after.pending.has(sig)) {
      changes.push({ type: 'pending-removed', signo: sig });
    }
  }

  // Disposition changes
  for (const [sig, disp] of after.disposition) {
    const oldDisp = before.disposition.get(sig);
    if (oldDisp !== disp) {
      changes.push({ type: 'disposition-changed', signo: sig, from: oldDisp, to: disp });
    }
  }

  // Log changes (new entries)
  if (after.log.length > before.log.length) {
    const newEntries = after.log.slice(before.log.length);
    for (const entry of newEntries) {
      changes.push({ type: 'log-entry', text: entry });
    }
  }

  return changes;
}
