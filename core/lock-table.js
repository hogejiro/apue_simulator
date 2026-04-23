/**
 * lock-table.js — Record (byte-range) locking model
 *
 * Models APUE Chapter 14.3:
 *   - F_RDLCK (shared), F_WRLCK (exclusive), F_UNLCK
 *   - Lock splitting: unlock middle of a locked range → two locks
 *   - Lock coalescing: adjacent locks of same type merge
 *   - Lock compatibility: multiple read locks OK, write lock exclusive
 */

export const F_RDLCK = 'F_RDLCK';
export const F_WRLCK = 'F_WRLCK';
export const F_UNLCK = 'F_UNLCK';

export class Lock {
  constructor({ pid, type, start, end }) {
    this.pid = pid;
    this.type = type;    // F_RDLCK or F_WRLCK
    this.start = start;  // inclusive
    this.end = end;      // inclusive (-1 = EOF)
  }

  clone() {
    return new Lock({ pid: this.pid, type: this.type, start: this.start, end: this.end });
  }

  /** Check if two ranges overlap */
  overlaps(other) {
    const thisEnd = this.end === -1 ? Infinity : this.end;
    const otherEnd = other.end === -1 ? Infinity : other.end;
    return this.start <= otherEnd && other.start <= thisEnd;
  }

  /** Check if two ranges are adjacent (can be merged) */
  adjacentTo(other) {
    if (this.pid !== other.pid || this.type !== other.type) return false;
    const thisEnd = this.end === -1 ? Infinity : this.end;
    const otherEnd = other.end === -1 ? Infinity : other.end;
    return thisEnd + 1 === other.start || otherEnd + 1 === this.start;
  }
}

export class LockTable {
  constructor() {
    /** @type {Lock[]} */
    this.locks = [];
    /** @type {string[]} */
    this.log = [];
  }

  clone() {
    const lt = new LockTable();
    lt.locks = this.locks.map(l => l.clone());
    lt.log = [...this.log];
    return lt;
  }

  /**
   * fcntl F_SETLK — set, clear, or change a lock.
   * Implements POSIX semantics:
   *   - A process can have only one lock per byte (new replaces old)
   *   - F_UNLCK removes locks in the specified range (may split)
   *   - Adjacent/overlapping locks of same type coalesce
   *
   * Returns { ok: true } or { ok: false, conflict: Lock }
   */
  setLock(pid, type, start, end) {
    if (type === F_UNLCK) {
      return this._unlock(pid, start, end);
    }

    // Check for conflicts with other processes
    const conflict = this._findConflict(pid, type, start, end);
    if (conflict) {
      this.log.push(`fcntl(F_SETLK, ${type}, ${start}-${end}) BLOCKED by PID ${conflict.pid}`);
      return { ok: false, conflict };
    }

    // Remove own locks in this range (will be replaced)
    this._removeOwnLocks(pid, start, end);

    // Add new lock
    this.locks.push(new Lock({ pid, type, start, end }));

    // Coalesce adjacent locks of same type/pid
    this._coalesce(pid);

    this.log.push(`fcntl(F_SETLK, ${type}, ${start}-${end === -1 ? 'EOF' : end}) OK`);
    return { ok: true };
  }

  /**
   * fcntl F_GETLK — test if a lock would conflict.
   * Returns null if no conflict, or the conflicting Lock.
   */
  getLock(pid, type, start, end) {
    return this._findConflict(pid, type, start, end);
  }

  /**
   * Get all locks for visualization.
   */
  getLocksForRange(start, end) {
    return this.locks.filter(l => {
      const lockEnd = l.end === -1 ? Infinity : l.end;
      const rangeEnd = end === -1 ? Infinity : end;
      return l.start <= rangeEnd && start <= lockEnd;
    });
  }

  // -- internal ---------------------------------------------------------------

  _findConflict(pid, type, start, end) {
    const reqEnd = end === -1 ? Infinity : end;

    for (const lock of this.locks) {
      if (lock.pid === pid) continue; // own locks don't conflict

      const lockEnd = lock.end === -1 ? Infinity : lock.end;
      if (lock.start > reqEnd || start > lockEnd) continue; // no overlap

      // Read locks are compatible with each other
      if (type === F_RDLCK && lock.type === F_RDLCK) continue;

      // All other combinations conflict
      return lock;
    }
    return null;
  }

  _removeOwnLocks(pid, start, end) {
    const reqEnd = end === -1 ? Infinity : end;
    const kept = [];

    for (const lock of this.locks) {
      if (lock.pid !== pid) {
        kept.push(lock);
        continue;
      }

      const lockEnd = lock.end === -1 ? Infinity : lock.end;

      // No overlap → keep
      if (lock.start > reqEnd || start > lockEnd) {
        kept.push(lock);
        continue;
      }

      // Partial overlap left: lock starts before request
      if (lock.start < start) {
        kept.push(new Lock({ pid, type: lock.type, start: lock.start, end: start - 1 }));
      }

      // Partial overlap right: lock extends beyond request
      if (lockEnd > reqEnd) {
        const newStart = end === -1 ? end : end + 1; // shouldn't happen with -1 end
        if (end !== -1) {
          kept.push(new Lock({ pid, type: lock.type, start: end + 1, end: lock.end }));
        }
      }
    }

    this.locks = kept;
  }

  _unlock(pid, start, end) {
    this._removeOwnLocks(pid, start, end);
    this.log.push(`fcntl(F_SETLK, F_UNLCK, ${start}-${end === -1 ? 'EOF' : end}) OK`);
    return { ok: true };
  }

  _coalesce(pid) {
    // Sort locks by pid, type, start
    const own = this.locks.filter(l => l.pid === pid);
    const others = this.locks.filter(l => l.pid !== pid);

    // Group by type
    for (const type of [F_RDLCK, F_WRLCK]) {
      const typed = own.filter(l => l.type === type).sort((a, b) => a.start - b.start);
      const merged = [];

      for (const lock of typed) {
        if (merged.length === 0) {
          merged.push(lock.clone());
          continue;
        }

        const prev = merged[merged.length - 1];
        const prevEnd = prev.end === -1 ? Infinity : prev.end;

        // Adjacent or overlapping
        if (lock.start <= prevEnd + 1) {
          const lockEnd = lock.end === -1 ? Infinity : lock.end;
          if (lockEnd > prevEnd) {
            prev.end = lock.end;
          }
          // else: lock is contained in prev, skip
        } else {
          merged.push(lock.clone());
        }
      }

      // Remove old typed locks and add merged
      const remaining = own.filter(l => l.type !== type);
      own.length = 0;
      own.push(...remaining, ...merged);
    }

    this.locks = [...others, ...own];
  }
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------
export function computeLockDiff(before, after) {
  const changes = [];

  // Find added locks
  for (const lock of after.locks) {
    const existed = before.locks.some(l =>
      l.pid === lock.pid && l.type === lock.type && l.start === lock.start && l.end === lock.end
    );
    if (!existed) {
      changes.push({ type: 'lock-added', lock });
    }
  }

  // Find removed locks
  for (const lock of before.locks) {
    const exists = after.locks.some(l =>
      l.pid === lock.pid && l.type === lock.type && l.start === lock.start && l.end === lock.end
    );
    if (!exists) {
      changes.push({ type: 'lock-removed', lock });
    }
  }

  // New log entries
  if (after.log.length > before.log.length) {
    for (const entry of after.log.slice(before.log.length)) {
      changes.push({ type: 'log-entry', text: entry });
    }
  }

  return changes;
}
