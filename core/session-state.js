/**
 * session-state.js — Session / Process Group / Job Control model
 *
 * Models APUE Chapter 9:
 *   - Session = { sid, controllingTTY, processGroups }
 *   - Process Group = { pgid, processes }
 *   - Foreground PG receives terminal signals (SIGINT, SIGTSTP)
 *   - Background PG gets SIGTTIN/SIGTTOU on terminal access
 */

export class SessionProcess {
  constructor({ pid, ppid = 0, pgid, name = 'process', state = 'RUNNING' }) {
    this.pid = pid;
    this.ppid = ppid;
    this.pgid = pgid;
    this.name = name;
    this.state = state; // RUNNING, STOPPED, ZOMBIE
  }

  clone() {
    return new SessionProcess({ ...this });
  }
}

export class SessionState {
  constructor() {
    this.sid = 0;
    this.foregroundPgid = 0;
    this.controllingTTY = '/dev/tty';
    /** @type {Map<number, SessionProcess>} pid -> process */
    this.processes = new Map();
    /** @type {string[]} */
    this.log = [];
  }

  clone() {
    const s = new SessionState();
    s.sid = this.sid;
    s.foregroundPgid = this.foregroundPgid;
    s.controllingTTY = this.controllingTTY;
    for (const [pid, proc] of this.processes) {
      s.processes.set(pid, proc.clone());
    }
    s.log = [...this.log];
    return s;
  }

  /** Create login session with shell as session leader */
  createSession(shellName = 'bash') {
    const pid = 1;
    this.sid = pid;
    const proc = new SessionProcess({ pid, pgid: pid, name: shellName });
    this.processes.set(pid, proc);
    this.foregroundPgid = pid;
    this.log.push(`login → ${shellName} (PID ${pid}, session leader, foreground PG ${pid})`);
    return pid;
  }

  /** Fork a child in the same process group */
  fork(parentPid, name = '') {
    const parent = this.processes.get(parentPid);
    if (!parent) throw new Error(`No such process: ${parentPid}`);
    const pid = this._nextPid();
    const child = new SessionProcess({
      pid,
      ppid: parentPid,
      pgid: parent.pgid,
      name: name || `${parent.name} (child)`,
    });
    this.processes.set(pid, child);
    this.log.push(`fork: PID ${pid} (${child.name}), PG ${child.pgid}`);
    return pid;
  }

  /** Set process group (used by shell to create job PGs) */
  setpgid(pid, pgid) {
    const proc = this.processes.get(pid);
    if (!proc) throw new Error(`No such process: ${pid}`);
    proc.pgid = pgid;
    this.log.push(`setpgid(${pid}, ${pgid})`);
  }

  /** Set foreground process group (tcsetpgrp) */
  tcsetpgrp(pgid) {
    const old = this.foregroundPgid;
    this.foregroundPgid = pgid;
    this.log.push(`tcsetpgrp(${pgid}) — foreground PG: ${old} → ${pgid}`);
  }

  /** Execute a program (just changes name) */
  exec(pid, program) {
    const proc = this.processes.get(pid);
    if (!proc) throw new Error(`No such process: ${pid}`);
    proc.name = program;
    this.log.push(`exec: PID ${pid} → ${program}`);
  }

  /** Send signal to foreground PG (e.g. ^C → SIGINT) */
  signalForeground(signal) {
    const targets = [];
    for (const [pid, proc] of this.processes) {
      if (proc.pgid === this.foregroundPgid && proc.state === 'RUNNING') {
        if (signal === 'SIGTSTP') {
          proc.state = 'STOPPED';
          targets.push(pid);
        } else if (signal === 'SIGCONT') {
          proc.state = 'RUNNING';
          targets.push(pid);
        } else {
          // SIGINT etc → terminate
          proc.state = 'ZOMBIE';
          targets.push(pid);
        }
      }
    }
    this.log.push(`${signal} → foreground PG ${this.foregroundPgid}: PIDs [${targets.join(', ')}]`);
  }

  /** Resume a stopped PG (bg/fg command) */
  resumePG(pgid, foreground = false) {
    for (const [pid, proc] of this.processes) {
      if (proc.pgid === pgid && proc.state === 'STOPPED') {
        proc.state = 'RUNNING';
      }
    }
    if (foreground) {
      this.foregroundPgid = pgid;
      this.log.push(`fg: PG ${pgid} → foreground, SIGCONT sent`);
    } else {
      this.log.push(`bg: PG ${pgid} → background, SIGCONT sent`);
    }
  }

  /** Process exits */
  exit(pid) {
    const proc = this.processes.get(pid);
    if (!proc) return;
    proc.state = 'ZOMBIE';
    this.log.push(`exit: PID ${pid} (${proc.name})`);
  }

  /** Reap zombie */
  reap(pid) {
    this.processes.delete(pid);
    this.log.push(`reap: PID ${pid}`);
  }

  /** Get process groups as a map: pgid → [processes] */
  getProcessGroups() {
    const groups = new Map();
    for (const [pid, proc] of this.processes) {
      if (!groups.has(proc.pgid)) groups.set(proc.pgid, []);
      groups.get(proc.pgid).push(proc);
    }
    return groups;
  }

  _nextPid() {
    let max = 0;
    for (const pid of this.processes.keys()) {
      if (pid > max) max = pid;
    }
    return max + 1;
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------
export function computeSessionDiff(before, after) {
  const changes = [];

  for (const [pid, proc] of after.processes) {
    if (!before.processes.has(pid)) {
      changes.push({ type: 'process-added', pid, name: proc.name, pgid: proc.pgid });
    } else {
      const old = before.processes.get(pid);
      if (old.pgid !== proc.pgid) changes.push({ type: 'pgid-changed', pid, from: old.pgid, to: proc.pgid });
      if (old.state !== proc.state) changes.push({ type: 'state-changed', pid, from: old.state, to: proc.state });
      if (old.name !== proc.name) changes.push({ type: 'name-changed', pid, from: old.name, to: proc.name });
    }
  }
  for (const [pid] of before.processes) {
    if (!after.processes.has(pid)) changes.push({ type: 'process-removed', pid });
  }

  if (before.foregroundPgid !== after.foregroundPgid) {
    changes.push({ type: 'fg-changed', from: before.foregroundPgid, to: after.foregroundPgid });
  }

  if (after.log.length > before.log.length) {
    for (const entry of after.log.slice(before.log.length)) {
      changes.push({ type: 'log-entry', text: entry });
    }
  }

  return changes;
}
