/**
 * thread-state.js — Thread synchronization model
 *
 * Models APUE Chapter 11:
 *   - Threads with states (RUNNING, BLOCKED, TERMINATED)
 *   - Mutex (owner, wait queue)
 *   - Condition Variable (wait queue, associated mutex)
 *   - Reader-Writer Lock (readers set, writer, wait queues)
 */

let _tidSeq = 0;

export class Thread {
  constructor({ tid, name = 'thread', state = 'RUNNING', blockedOn = null }) {
    this.tid = tid ?? ++_tidSeq;
    this.name = name;
    this.state = state;     // RUNNING, BLOCKED, TERMINATED
    this.blockedOn = blockedOn; // what resource is blocking this thread
  }
  clone() { return new Thread({ ...this }); }
}

export class Mutex {
  constructor({ name = 'mutex' }) {
    this.name = name;
    this.owner = null;      // tid of owner, null if unlocked
    this.waitQueue = [];    // tids waiting to acquire
  }
  clone() { return Object.assign(Object.create(Mutex.prototype), { ...this, waitQueue: [...this.waitQueue] }); }
}

export class CondVar {
  constructor({ name = 'cond' }) {
    this.name = name;
    this.waitQueue = [];    // tids waiting on this condvar
  }
  clone() { return Object.assign(Object.create(CondVar.prototype), { ...this, waitQueue: [...this.waitQueue] }); }
}

export class RWLock {
  constructor({ name = 'rwlock' }) {
    this.name = name;
    this.readers = [];      // tids holding read lock
    this.writer = null;     // tid holding write lock
    this.readWaitQueue = [];
    this.writeWaitQueue = [];
  }
  clone() {
    return Object.assign(Object.create(RWLock.prototype), {
      ...this, readers: [...this.readers],
      readWaitQueue: [...this.readWaitQueue], writeWaitQueue: [...this.writeWaitQueue],
    });
  }
}

export class ThreadState {
  constructor() {
    /** @type {Map<number, Thread>} */
    this.threads = new Map();
    /** @type {Map<string, Mutex>} */
    this.mutexes = new Map();
    /** @type {Map<string, CondVar>} */
    this.condvars = new Map();
    /** @type {Map<string, RWLock>} */
    this.rwlocks = new Map();
    /** @type {string[]} */
    this.log = [];
  }

  clone() {
    const s = new ThreadState();
    for (const [id, t] of this.threads) s.threads.set(id, t.clone());
    for (const [n, m] of this.mutexes) s.mutexes.set(n, m.clone());
    for (const [n, c] of this.condvars) s.condvars.set(n, c.clone());
    for (const [n, r] of this.rwlocks) s.rwlocks.set(n, r.clone());
    s.log = [...this.log];
    return s;
  }

  // -- Setup ----------------------------------------------------------------

  addThread(name) {
    const t = new Thread({ name });
    this.threads.set(t.tid, t);
    return t.tid;
  }

  addMutex(name) { this.mutexes.set(name, new Mutex({ name })); }
  addCondVar(name) { this.condvars.set(name, new CondVar({ name })); }
  addRWLock(name) { this.rwlocks.set(name, new RWLock({ name })); }

  // -- Mutex ----------------------------------------------------------------

  mutexLock(tid, mutexName) {
    const t = this.threads.get(tid);
    const m = this.mutexes.get(mutexName);
    if (!t || !m) throw new Error(`Invalid tid or mutex: ${tid}, ${mutexName}`);

    if (m.owner === null) {
      m.owner = tid;
      this.log.push(`T${tid} (${t.name}): mutex_lock(${mutexName}) → acquired`);
    } else {
      m.waitQueue.push(tid);
      t.state = 'BLOCKED';
      t.blockedOn = `mutex:${mutexName}`;
      this.log.push(`T${tid} (${t.name}): mutex_lock(${mutexName}) → BLOCKED (owner: T${m.owner})`);
    }
  }

  mutexUnlock(tid, mutexName) {
    const t = this.threads.get(tid);
    const m = this.mutexes.get(mutexName);
    if (!t || !m) throw new Error(`Invalid tid or mutex`);

    m.owner = null;
    this.log.push(`T${tid} (${t.name}): mutex_unlock(${mutexName})`);

    // Wake up next waiter
    if (m.waitQueue.length > 0) {
      const nextTid = m.waitQueue.shift();
      const nextT = this.threads.get(nextTid);
      m.owner = nextTid;
      if (nextT) {
        nextT.state = 'RUNNING';
        nextT.blockedOn = null;
      }
      this.log.push(`  → T${nextTid} wakes up, acquires ${mutexName}`);
    }
  }

  // -- Condition Variable ---------------------------------------------------

  condWait(tid, condName, mutexName) {
    const t = this.threads.get(tid);
    const c = this.condvars.get(condName);
    const m = this.mutexes.get(mutexName);
    if (!t || !c || !m) throw new Error(`Invalid args`);

    // Release mutex atomically
    m.owner = null;
    // Wake up mutex waiter if any
    if (m.waitQueue.length > 0) {
      const nextTid = m.waitQueue.shift();
      const nextT = this.threads.get(nextTid);
      m.owner = nextTid;
      if (nextT) { nextT.state = 'RUNNING'; nextT.blockedOn = null; }
    }

    // Block on condvar
    c.waitQueue.push(tid);
    t.state = 'BLOCKED';
    t.blockedOn = `cond:${condName}`;
    this.log.push(`T${tid} (${t.name}): cond_wait(${condName}, ${mutexName}) → release mutex, BLOCKED`);
  }

  condSignal(tid, condName, mutexName) {
    const t = this.threads.get(tid);
    const c = this.condvars.get(condName);
    const m = this.mutexes.get(mutexName);
    if (!t || !c) throw new Error(`Invalid args`);

    this.log.push(`T${tid} (${t.name}): cond_signal(${condName})`);

    if (c.waitQueue.length > 0) {
      const wakerTid = c.waitQueue.shift();
      const wakerT = this.threads.get(wakerTid);
      if (wakerT) {
        // Waker needs to re-acquire mutex
        if (m && m.owner === null) {
          m.owner = wakerTid;
          wakerT.state = 'RUNNING';
          wakerT.blockedOn = null;
          this.log.push(`  → T${wakerTid} wakes up, re-acquires ${mutexName}`);
        } else if (m) {
          m.waitQueue.push(wakerTid);
          wakerT.blockedOn = `mutex:${mutexName}`;
          this.log.push(`  → T${wakerTid} wakes up, waits for ${mutexName}`);
        }
      }
    }
  }

  condBroadcast(tid, condName, mutexName) {
    const t = this.threads.get(tid);
    const c = this.condvars.get(condName);
    const m = this.mutexes.get(mutexName);
    if (!t || !c) throw new Error(`Invalid args`);

    this.log.push(`T${tid} (${t.name}): cond_broadcast(${condName})`);

    while (c.waitQueue.length > 0) {
      const wakerTid = c.waitQueue.shift();
      const wakerT = this.threads.get(wakerTid);
      if (wakerT && m) {
        if (m.owner === null) {
          m.owner = wakerTid;
          wakerT.state = 'RUNNING';
          wakerT.blockedOn = null;
          this.log.push(`  → T${wakerTid} wakes up, re-acquires ${mutexName}`);
        } else {
          m.waitQueue.push(wakerTid);
          wakerT.blockedOn = `mutex:${mutexName}`;
          this.log.push(`  → T${wakerTid} wakes up, waits for ${mutexName}`);
        }
      }
    }
  }

  // -- Reader-Writer Lock ---------------------------------------------------

  rwlockRdlock(tid, lockName) {
    const t = this.threads.get(tid);
    const rw = this.rwlocks.get(lockName);
    if (!t || !rw) throw new Error(`Invalid args`);

    if (rw.writer === null && rw.writeWaitQueue.length === 0) {
      rw.readers.push(tid);
      this.log.push(`T${tid} (${t.name}): rwlock_rdlock(${lockName}) → acquired (readers: ${rw.readers.length})`);
    } else {
      rw.readWaitQueue.push(tid);
      t.state = 'BLOCKED';
      t.blockedOn = `rwlock:${lockName}(read)`;
      this.log.push(`T${tid} (${t.name}): rwlock_rdlock(${lockName}) → BLOCKED`);
    }
  }

  rwlockWrlock(tid, lockName) {
    const t = this.threads.get(tid);
    const rw = this.rwlocks.get(lockName);
    if (!t || !rw) throw new Error(`Invalid args`);

    if (rw.writer === null && rw.readers.length === 0) {
      rw.writer = tid;
      this.log.push(`T${tid} (${t.name}): rwlock_wrlock(${lockName}) → acquired`);
    } else {
      rw.writeWaitQueue.push(tid);
      t.state = 'BLOCKED';
      t.blockedOn = `rwlock:${lockName}(write)`;
      this.log.push(`T${tid} (${t.name}): rwlock_wrlock(${lockName}) → BLOCKED`);
    }
  }

  rwlockUnlock(tid, lockName) {
    const t = this.threads.get(tid);
    const rw = this.rwlocks.get(lockName);
    if (!t || !rw) throw new Error(`Invalid args`);

    if (rw.writer === tid) {
      rw.writer = null;
      this.log.push(`T${tid} (${t.name}): rwlock_unlock(${lockName}) — write released`);
    } else {
      rw.readers = rw.readers.filter(r => r !== tid);
      this.log.push(`T${tid} (${t.name}): rwlock_unlock(${lockName}) — read released (readers: ${rw.readers.length})`);
    }

    // Wake up waiters: prefer writers (to avoid starvation)
    if (rw.writer === null && rw.readers.length === 0) {
      if (rw.writeWaitQueue.length > 0) {
        const wTid = rw.writeWaitQueue.shift();
        const wT = this.threads.get(wTid);
        rw.writer = wTid;
        if (wT) { wT.state = 'RUNNING'; wT.blockedOn = null; }
        this.log.push(`  → T${wTid} wakes up, acquires write lock`);
      } else {
        // Wake all read waiters
        while (rw.readWaitQueue.length > 0) {
          const rTid = rw.readWaitQueue.shift();
          const rT = this.threads.get(rTid);
          rw.readers.push(rTid);
          if (rT) { rT.state = 'RUNNING'; rT.blockedOn = null; }
          this.log.push(`  → T${rTid} wakes up, acquires read lock`);
        }
      }
    }
  }
}

export function resetThreadIds() { _tidSeq = 0; }

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------
export function computeThreadDiff(before, after) {
  const changes = [];

  for (const [tid, t] of after.threads) {
    if (!before.threads.has(tid)) {
      changes.push({ type: 'thread-added', tid, name: t.name });
    } else {
      const old = before.threads.get(tid);
      if (old.state !== t.state) changes.push({ type: 'thread-state', tid, from: old.state, to: t.state });
    }
  }

  for (const [name, m] of after.mutexes) {
    const old = before.mutexes.get(name);
    if (old && old.owner !== m.owner) changes.push({ type: 'mutex-owner', name, from: old.owner, to: m.owner });
  }

  if (after.log.length > before.log.length) {
    for (const entry of after.log.slice(before.log.length)) {
      changes.push({ type: 'log-entry', text: entry });
    }
  }

  return changes;
}
