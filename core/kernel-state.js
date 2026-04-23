/**
 * kernel-state.js — APUE simulator core
 *
 * Models the kernel data structures that appear in APUE Figures 3.7, 3.8, 8.2:
 *   - Per-process fd table (array of pointers to file table entries)
 *   - System-wide file table (offset, flags, refcount, pointer to vnode)
 *   - Vnode table (inode info, file size, type)
 *
 * All mutations return a new KernelState (immutable snapshots for prev/next).
 */

// ---------------------------------------------------------------------------
// Vnode (represents an on-disk inode — shared across all opens of the same file)
// ---------------------------------------------------------------------------
let _vnodeIdSeq = 0;

export class Vnode {
  constructor({ path, type = 'REG', size = 0, inode = null, capacity = 0 }) {
    this.id = ++_vnodeIdSeq;
    this.path = path;
    this.type = type;   // REG, DIR, FIFO, SOCK, CHR, BLK
    this.size = size;
    this.inode = inode ?? this.id;
    // Pipe buffer (FIFO only)
    this.buffer = [];       // [{label, size}] — data chunks in the pipe
    this.capacity = capacity; // 0 for regular files, 4096 for pipes
    this.readClosed = false;
    this.writeClosed = false;
  }

  /** Current bytes in the pipe buffer */
  get bufferUsed() {
    return this.buffer.reduce((sum, chunk) => sum + chunk.size, 0);
  }

  clone() {
    const v = Object.create(Vnode.prototype);
    Object.assign(v, this);
    v.buffer = this.buffer.map(c => ({ ...c }));
    return v;
  }
}

// ---------------------------------------------------------------------------
// FileTableEntry (one per open() call — shared after fork / dup)
// ---------------------------------------------------------------------------
let _ftIdSeq = 0;

export class FileTableEntry {
  constructor({ flags, offset = 0, vnodeId, refcount = 1 }) {
    this.id = ++_ftIdSeq;
    this.flags = flags;       // O_RDONLY=0, O_WRONLY=1, O_RDWR=2, O_APPEND=8, ...
    this.offset = offset;
    this.vnodeId = vnodeId;
    this.refcount = refcount;
  }

  clone() {
    const f = Object.create(FileTableEntry.prototype);
    Object.assign(f, this);
    return f;
  }
}

// ---------------------------------------------------------------------------
// Process (per-process state: fd table + metadata)
// ---------------------------------------------------------------------------
let _pidSeq = 0;

export class Process {
  /**
   * @param {object} opts
   * @param {number} [opts.pid]
   * @param {number} [opts.ppid]
   * @param {string} [opts.name]
   * @param {string} [opts.program] - executable name (changes on exec)
   * @param {string} [opts.state] - RUNNING, STOPPED, ZOMBIE, EXITED
   * @param {number|null} [opts.exitStatus]
   * @param {Map<number,number>} [opts.fdTable] - fd -> fileTableEntryId
   */
  constructor({ pid, ppid = 0, name = 'process', program = '', state = 'RUNNING', exitStatus = null, fdTable } = {}) {
    this.pid = pid ?? ++_pidSeq;
    this.ppid = ppid;
    this.name = name;
    this.program = program;
    this.state = state;
    this.exitStatus = exitStatus;
    // fd -> fileTableEntry.id
    this.fdTable = fdTable ? new Map(fdTable) : new Map();
  }

  clone() {
    return new Process({
      pid: this.pid,
      ppid: this.ppid,
      name: this.name,
      program: this.program,
      state: this.state,
      exitStatus: this.exitStatus,
      fdTable: new Map(this.fdTable),
    });
  }

  /** Find the lowest available fd >= minFd */
  lowestAvailableFd(minFd = 0) {
    let fd = minFd;
    while (this.fdTable.has(fd)) fd++;
    return fd;
  }
}

// ---------------------------------------------------------------------------
// Flag constants (simplified subset)
// ---------------------------------------------------------------------------
export const O_RDONLY  = 0;
export const O_WRONLY  = 1;
export const O_RDWR   = 2;
export const O_APPEND  = 0x0008;
export const O_CREAT   = 0x0100;
export const O_TRUNC   = 0x0200;

export function flagsToString(flags) {
  const base = flags & 3;
  const parts = [];
  if (base === O_RDONLY) parts.push('O_RDONLY');
  else if (base === O_WRONLY) parts.push('O_WRONLY');
  else if (base === O_RDWR) parts.push('O_RDWR');
  if (flags & O_APPEND) parts.push('O_APPEND');
  if (flags & O_CREAT) parts.push('O_CREAT');
  if (flags & O_TRUNC) parts.push('O_TRUNC');
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// KernelState — the immutable snapshot of the entire kernel
// ---------------------------------------------------------------------------
export class KernelState {
  constructor() {
    /** @type {Map<number, Process>} pid -> Process */
    this.processes = new Map();
    /** @type {Map<number, FileTableEntry>} id -> FileTableEntry */
    this.fileTable = new Map();
    /** @type {Map<number, Vnode>} id -> Vnode */
    this.vnodes = new Map();
  }

  // -- snapshot (deep clone) ------------------------------------------------

  clone() {
    const s = new KernelState();
    for (const [pid, proc] of this.processes) {
      s.processes.set(pid, proc.clone());
    }
    for (const [id, fte] of this.fileTable) {
      s.fileTable.set(id, fte.clone());
    }
    for (const [id, vn] of this.vnodes) {
      s.vnodes.set(id, vn.clone());
    }
    return s;
  }

  // -- helpers --------------------------------------------------------------

  _getProcess(pid) {
    const p = this.processes.get(pid);
    if (!p) throw new Error(`No such process: ${pid}`);
    return p;
  }

  _findOrCreateVnode(path) {
    for (const vn of this.vnodes.values()) {
      if (vn.path === path) return vn;
    }
    const vn = new Vnode({ path });
    this.vnodes.set(vn.id, vn);
    return vn;
  }

  // -- system calls ---------------------------------------------------------

  /**
   * open(path, flags) in process pid.
   * Returns { fd, fileTableEntryId, vnodeId }.
   */
  open(pid, path, flags = O_RDONLY) {
    const proc = this._getProcess(pid);
    const vnode = this._findOrCreateVnode(path);

    const fte = new FileTableEntry({ flags, offset: 0, vnodeId: vnode.id });
    this.fileTable.set(fte.id, fte);

    const fd = proc.lowestAvailableFd();
    proc.fdTable.set(fd, fte.id);

    return { fd, fileTableEntryId: fte.id, vnodeId: vnode.id };
  }

  /**
   * close(fd) in process pid.
   */
  close(pid, fd) {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(fd);
    if (fteId === undefined) throw new Error(`Bad fd: ${fd}`);

    proc.fdTable.delete(fd);

    const fte = this.fileTable.get(fteId);
    if (fte) {
      fte.refcount--;
      if (fte.refcount <= 0) {
        this.fileTable.delete(fteId);
      }
    }
  }

  /**
   * dup(fd) in process pid — duplicates fd to lowest available.
   * Returns newFd.
   */
  dup(pid, fd) {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(fd);
    if (fteId === undefined) throw new Error(`Bad fd: ${fd}`);

    const newFd = proc.lowestAvailableFd();
    proc.fdTable.set(newFd, fteId);

    const fte = this.fileTable.get(fteId);
    if (fte) fte.refcount++;

    return newFd;
  }

  /**
   * dup2(oldfd, newfd) in process pid.
   * If newfd is already open, it is closed first.
   * Returns newfd.
   */
  dup2(pid, oldFd, newFd) {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(oldFd);
    if (fteId === undefined) throw new Error(`Bad fd: ${oldFd}`);

    if (oldFd === newFd) return newFd;

    // Close newFd if open
    if (proc.fdTable.has(newFd)) {
      this.close(pid, newFd);
    }

    proc.fdTable.set(newFd, fteId);
    const fte = this.fileTable.get(fteId);
    if (fte) fte.refcount++;

    return newFd;
  }

  /**
   * lseek(fd, offset) in process pid.
   * Simplified: just sets the offset directly.
   */
  lseek(pid, fd, offset) {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(fd);
    if (fteId === undefined) throw new Error(`Bad fd: ${fd}`);

    const fte = this.fileTable.get(fteId);
    if (!fte) throw new Error(`No file table entry: ${fteId}`);

    fte.offset = offset;
    return offset;
  }

  /**
   * write(fd, nbytes, label) in process pid.
   * For pipes: pushes data into the pipe buffer.
   * For regular files: advances offset, updates vnode size.
   */
  write(pid, fd, nbytes, label = '') {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(fd);
    if (fteId === undefined) throw new Error(`Bad fd: ${fd}`);

    const fte = this.fileTable.get(fteId);
    if (!fte) throw new Error(`No file table entry: ${fteId}`);

    const vnode = this.vnodes.get(fte.vnodeId);

    // Pipe write
    if (vnode && vnode.type === 'FIFO') {
      if (vnode.readClosed) {
        return { error: 'SIGPIPE', bytes: 0 };
      }
      vnode.buffer.push({ label: label || `${nbytes}B`, size: nbytes });
      vnode.size += nbytes;
      return nbytes;
    }

    // Regular file write
    if (fte.flags & O_APPEND) {
      if (vnode) fte.offset = vnode.size;
    }

    fte.offset += nbytes;

    if (vnode && fte.offset > vnode.size) {
      vnode.size = fte.offset;
    }

    return nbytes;
  }

  /**
   * read(fd, nbytes) in process pid.
   * For pipes: consumes data from the pipe buffer.
   * For regular files: advances offset, returns bytes read.
   */
  read(pid, fd, nbytes) {
    const proc = this._getProcess(pid);
    const fteId = proc.fdTable.get(fd);
    if (fteId === undefined) throw new Error(`Bad fd: ${fd}`);

    const fte = this.fileTable.get(fteId);
    if (!fte) throw new Error(`No file table entry: ${fteId}`);

    const vnode = this.vnodes.get(fte.vnodeId);

    // Pipe read
    if (vnode && vnode.type === 'FIFO') {
      if (vnode.buffer.length === 0) {
        if (vnode.writeClosed) return 0; // EOF
        return { blocked: true, bytes: 0 }; // would block
      }
      let bytesRead = 0;
      while (vnode.buffer.length > 0 && bytesRead < nbytes) {
        const chunk = vnode.buffer[0];
        const take = Math.min(chunk.size, nbytes - bytesRead);
        bytesRead += take;
        chunk.size -= take;
        if (chunk.size <= 0) {
          vnode.buffer.shift();
        }
      }
      return bytesRead;
    }

    // Regular file read
    const available = vnode ? Math.max(0, vnode.size - fte.offset) : 0;
    const bytesRead = Math.min(nbytes, available);
    fte.offset += bytesRead;

    return bytesRead;
  }

  /**
   * fork(parentPid) — creates child with copied fd table.
   * All shared file table entries get refcount++.
   * Returns childPid.
   */
  fork(parentPid) {
    const parent = this._getProcess(parentPid);

    const child = new Process({
      ppid: parent.pid,
      name: `${parent.name} (child)`,
      program: parent.program,
      fdTable: new Map(parent.fdTable),
    });

    // Increment refcounts
    for (const fteId of child.fdTable.values()) {
      const fte = this.fileTable.get(fteId);
      if (fte) fte.refcount++;
    }

    this.processes.set(child.pid, child);
    return child.pid;
  }

  /**
   * exec(pid, program) — replaces process image.
   * fd table is preserved (except close-on-exec fds, not modeled here).
   * program name and process name change.
   */
  exec(pid, program) {
    const proc = this._getProcess(pid);
    proc.program = program;
    proc.name = program;
  }

  /**
   * exit(pid, status) — process terminates, becomes zombie.
   * All fds are closed, but process entry remains until parent calls waitpid.
   */
  exit(pid, status = 0) {
    const proc = this._getProcess(pid);

    // Close all fds
    for (const [fd] of [...proc.fdTable]) {
      this.close(pid, fd);
    }

    proc.state = 'ZOMBIE';
    proc.exitStatus = status;
  }

  /**
   * waitpid(parentPid, childPid) — parent collects zombie child.
   * Returns { pid, exitStatus }. Removes child from process table.
   */
  waitpid(parentPid, childPid) {
    const child = this._getProcess(childPid);
    if (child.state !== 'ZOMBIE') {
      throw new Error(`Process ${childPid} is not a zombie (state: ${child.state})`);
    }

    const result = { pid: child.pid, exitStatus: child.exitStatus };
    this.processes.delete(childPid);
    return result;
  }

  /**
   * pipe(pid) — creates a pipe (two fd entries sharing internal vnode).
   * Returns { readFd, writeFd }.
   */
  pipe(pid) {
    const proc = this._getProcess(pid);

    const vnode = new Vnode({ path: '<pipe>', type: 'FIFO', size: 0, capacity: 4096 });
    this.vnodes.set(vnode.id, vnode);

    const readFte = new FileTableEntry({ flags: O_RDONLY, vnodeId: vnode.id });
    const writeFte = new FileTableEntry({ flags: O_WRONLY, vnodeId: vnode.id });
    this.fileTable.set(readFte.id, readFte);
    this.fileTable.set(writeFte.id, writeFte);

    const readFd = proc.lowestAvailableFd();
    proc.fdTable.set(readFd, readFte.id);

    const writeFd = proc.lowestAvailableFd();
    proc.fdTable.set(writeFd, writeFte.id);

    return { readFd, writeFd };
  }

  // -- create initial process -----------------------------------------------

  /**
   * Creates a process with stdin(0), stdout(1), stderr(2) connected to /dev/tty.
   */
  createProcess(name = 'shell') {
    const proc = new Process({ name });
    this.processes.set(proc.pid, proc);

    const ttyVnode = this._findOrCreateVnode('/dev/tty');

    // stdin
    const fte0 = new FileTableEntry({ flags: O_RDONLY, vnodeId: ttyVnode.id });
    this.fileTable.set(fte0.id, fte0);
    proc.fdTable.set(0, fte0.id);

    // stdout
    const fte1 = new FileTableEntry({ flags: O_WRONLY, vnodeId: ttyVnode.id });
    this.fileTable.set(fte1.id, fte1);
    proc.fdTable.set(1, fte1.id);

    // stderr
    const fte2 = new FileTableEntry({ flags: O_WRONLY, vnodeId: ttyVnode.id });
    this.fileTable.set(fte2.id, fte2);
    proc.fdTable.set(2, fte2.id);

    return proc.pid;
  }
}

// ---------------------------------------------------------------------------
// Reset ID sequences (for testing)
// ---------------------------------------------------------------------------
export function resetIdSequences() {
  _vnodeIdSeq = 0;
  _ftIdSeq = 0;
  _pidSeq = 0;
}

// ---------------------------------------------------------------------------
// Diff computation between two KernelState snapshots
// ---------------------------------------------------------------------------
export function computeDiff(before, after) {
  const changes = [];

  // Process changes
  for (const [pid, proc] of after.processes) {
    if (!before.processes.has(pid)) {
      changes.push({ type: 'process-added', pid, name: proc.name });
    } else {
      const oldProc = before.processes.get(pid);
      // Process metadata changes
      if (proc.state !== oldProc.state) {
        changes.push({ type: 'process-state', pid, from: oldProc.state, to: proc.state });
      }
      if (proc.name !== oldProc.name || proc.program !== oldProc.program) {
        changes.push({ type: 'process-exec', pid, from: oldProc.program, to: proc.program });
      }
      // fd table changes
      for (const [fd, fteId] of proc.fdTable) {
        if (!oldProc.fdTable.has(fd)) {
          changes.push({ type: 'fd-added', pid, fd, fteId });
        } else if (oldProc.fdTable.get(fd) !== fteId) {
          changes.push({ type: 'fd-changed', pid, fd, fteId, oldFteId: oldProc.fdTable.get(fd) });
        }
      }
      for (const [fd] of oldProc.fdTable) {
        if (!proc.fdTable.has(fd)) {
          changes.push({ type: 'fd-removed', pid, fd });
        }
      }
    }
  }
  for (const [pid] of before.processes) {
    if (!after.processes.has(pid)) {
      changes.push({ type: 'process-removed', pid });
    }
  }

  // File table entry changes
  for (const [id, fte] of after.fileTable) {
    if (!before.fileTable.has(id)) {
      changes.push({ type: 'fte-added', id });
    } else {
      const oldFte = before.fileTable.get(id);
      if (fte.refcount !== oldFte.refcount) {
        changes.push({ type: 'fte-refcount', id, from: oldFte.refcount, to: fte.refcount });
      }
      if (fte.offset !== oldFte.offset) {
        changes.push({ type: 'fte-offset', id, from: oldFte.offset, to: fte.offset });
      }
    }
  }
  for (const [id] of before.fileTable) {
    if (!after.fileTable.has(id)) {
      changes.push({ type: 'fte-removed', id });
    }
  }

  // Vnode changes
  for (const [id, vn] of after.vnodes) {
    if (!before.vnodes.has(id)) {
      changes.push({ type: 'vnode-added', id, path: vn.path });
    } else {
      const oldVn = before.vnodes.get(id);
      // Pipe buffer changes
      if (vn.type === 'FIFO') {
        const oldUsed = oldVn.buffer.reduce((s, c) => s + c.size, 0);
        const newUsed = vn.buffer.reduce((s, c) => s + c.size, 0);
        if (newUsed > oldUsed) {
          changes.push({ type: 'pipe-write', vnodeId: id, bytes: newUsed - oldUsed });
        } else if (newUsed < oldUsed) {
          changes.push({ type: 'pipe-read', vnodeId: id, bytes: oldUsed - newUsed });
        }
        if (vn.readClosed !== oldVn.readClosed) {
          changes.push({ type: 'pipe-close', vnodeId: id, end: 'read' });
        }
        if (vn.writeClosed !== oldVn.writeClosed) {
          changes.push({ type: 'pipe-close', vnodeId: id, end: 'write' });
        }
      }
    }
  }

  return changes;
}
