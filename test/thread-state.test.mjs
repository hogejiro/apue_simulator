import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ThreadState, resetThreadIds, computeThreadDiff } from '../core/thread-state.js';

let ts;

beforeEach(() => {
  resetThreadIds();
  ts = new ThreadState();
});

// ===========================================================================
// Mutex
// ===========================================================================

test('mutex lock on free mutex succeeds', () => {
  const t1 = ts.addThread('worker1');
  ts.addMutex('m');
  ts.mutexLock(t1, 'm');

  assert.equal(ts.mutexes.get('m').owner, t1);
  assert.equal(ts.threads.get(t1).state, 'RUNNING');
});

test('mutex lock on held mutex blocks', () => {
  const t1 = ts.addThread('worker1');
  const t2 = ts.addThread('worker2');
  ts.addMutex('m');

  ts.mutexLock(t1, 'm');
  ts.mutexLock(t2, 'm');

  assert.equal(ts.mutexes.get('m').owner, t1);
  assert.equal(ts.threads.get(t2).state, 'BLOCKED');
  assert.equal(ts.mutexes.get('m').waitQueue.length, 1);
});

test('mutex unlock wakes blocked thread', () => {
  const t1 = ts.addThread('worker1');
  const t2 = ts.addThread('worker2');
  ts.addMutex('m');

  ts.mutexLock(t1, 'm');
  ts.mutexLock(t2, 'm'); // blocked

  ts.mutexUnlock(t1, 'm');

  assert.equal(ts.mutexes.get('m').owner, t2);
  assert.equal(ts.threads.get(t2).state, 'RUNNING');
});

test('mutex FIFO ordering', () => {
  const t1 = ts.addThread('t1');
  const t2 = ts.addThread('t2');
  const t3 = ts.addThread('t3');
  ts.addMutex('m');

  ts.mutexLock(t1, 'm');
  ts.mutexLock(t2, 'm');
  ts.mutexLock(t3, 'm');

  ts.mutexUnlock(t1, 'm');
  assert.equal(ts.mutexes.get('m').owner, t2); // t2 first

  ts.mutexUnlock(t2, 'm');
  assert.equal(ts.mutexes.get('m').owner, t3); // then t3
});

// ===========================================================================
// Condition Variable
// ===========================================================================

test('cond_wait releases mutex and blocks', () => {
  const t1 = ts.addThread('producer');
  const t2 = ts.addThread('consumer');
  ts.addMutex('m');
  ts.addCondVar('cv');

  ts.mutexLock(t2, 'm');
  ts.condWait(t2, 'cv', 'm');

  assert.equal(ts.threads.get(t2).state, 'BLOCKED');
  assert.equal(ts.mutexes.get('m').owner, null); // mutex released
  assert.equal(ts.condvars.get('cv').waitQueue.length, 1);
});

test('cond_signal wakes one waiter', () => {
  const t1 = ts.addThread('producer');
  const t2 = ts.addThread('consumer');
  ts.addMutex('m');
  ts.addCondVar('cv');

  ts.mutexLock(t2, 'm');
  ts.condWait(t2, 'cv', 'm');

  // Producer signals
  ts.mutexLock(t1, 'm');
  ts.condSignal(t1, 'cv', 'm');
  ts.mutexUnlock(t1, 'm');

  // Consumer should be re-acquiring mutex
  assert.equal(ts.threads.get(t2).state, 'RUNNING');
  assert.equal(ts.mutexes.get('m').owner, t2);
});

test('cond_broadcast wakes all waiters', () => {
  const t1 = ts.addThread('producer');
  const t2 = ts.addThread('consumer1');
  const t3 = ts.addThread('consumer2');
  ts.addMutex('m');
  ts.addCondVar('cv');

  ts.mutexLock(t2, 'm');
  ts.condWait(t2, 'cv', 'm');

  ts.mutexLock(t3, 'm');
  ts.condWait(t3, 'cv', 'm');

  ts.mutexLock(t1, 'm');
  ts.condBroadcast(t1, 'cv', 'm');
  ts.mutexUnlock(t1, 'm');

  // First wakes and gets mutex, second waits for mutex
  assert.equal(ts.condvars.get('cv').waitQueue.length, 0);
});

// ===========================================================================
// Reader-Writer Lock
// ===========================================================================

test('rwlock: multiple readers coexist', () => {
  const t1 = ts.addThread('reader1');
  const t2 = ts.addThread('reader2');
  ts.addRWLock('rw');

  ts.rwlockRdlock(t1, 'rw');
  ts.rwlockRdlock(t2, 'rw');

  assert.equal(ts.rwlocks.get('rw').readers.length, 2);
  assert.equal(ts.threads.get(t1).state, 'RUNNING');
  assert.equal(ts.threads.get(t2).state, 'RUNNING');
});

test('rwlock: writer blocks when readers hold', () => {
  const t1 = ts.addThread('reader');
  const t2 = ts.addThread('writer');
  ts.addRWLock('rw');

  ts.rwlockRdlock(t1, 'rw');
  ts.rwlockWrlock(t2, 'rw');

  assert.equal(ts.threads.get(t2).state, 'BLOCKED');
});

test('rwlock: reader blocks when writer holds', () => {
  const t1 = ts.addThread('writer');
  const t2 = ts.addThread('reader');
  ts.addRWLock('rw');

  ts.rwlockWrlock(t1, 'rw');
  ts.rwlockRdlock(t2, 'rw');

  assert.equal(ts.threads.get(t2).state, 'BLOCKED');
});

test('rwlock: writer unlock wakes readers', () => {
  const t1 = ts.addThread('writer');
  const t2 = ts.addThread('reader1');
  const t3 = ts.addThread('reader2');
  ts.addRWLock('rw');

  ts.rwlockWrlock(t1, 'rw');
  ts.rwlockRdlock(t2, 'rw');
  ts.rwlockRdlock(t3, 'rw');

  ts.rwlockUnlock(t1, 'rw');

  assert.equal(ts.rwlocks.get('rw').readers.length, 2);
  assert.equal(ts.threads.get(t2).state, 'RUNNING');
  assert.equal(ts.threads.get(t3).state, 'RUNNING');
});

// ===========================================================================
// Diff
// ===========================================================================

test('diff detects mutex owner change', () => {
  const t1 = ts.addThread('t1');
  ts.addMutex('m');
  const before = ts.clone();
  ts.mutexLock(t1, 'm');
  const diff = computeThreadDiff(before, ts);
  assert.ok(diff.some(d => d.type === 'mutex-owner' && d.to === t1));
});

test('diff detects thread state change', () => {
  const t1 = ts.addThread('t1');
  const t2 = ts.addThread('t2');
  ts.addMutex('m');
  ts.mutexLock(t1, 'm');
  const before = ts.clone();
  ts.mutexLock(t2, 'm');
  const diff = computeThreadDiff(before, ts);
  assert.ok(diff.some(d => d.type === 'thread-state' && d.tid === t2 && d.to === 'BLOCKED'));
});

test('clone is independent', () => {
  const t1 = ts.addThread('t1');
  ts.addMutex('m');
  const copy = ts.clone();
  ts.mutexLock(t1, 'm');

  assert.equal(ts.mutexes.get('m').owner, t1);
  assert.equal(copy.mutexes.get('m').owner, null);
});
