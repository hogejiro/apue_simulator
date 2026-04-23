import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockTable, computeLockDiff, F_RDLCK, F_WRLCK, F_UNLCK } from '../core/lock-table.js';

let lt;

beforeEach(() => {
  lt = new LockTable();
});

// ===========================================================================
// Basic locking
// ===========================================================================

test('write lock on empty table succeeds', () => {
  const result = lt.setLock(1, F_WRLCK, 0, 99);
  assert.equal(result.ok, true);
  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].type, F_WRLCK);
  assert.equal(lt.locks[0].start, 0);
  assert.equal(lt.locks[0].end, 99);
});

test('read lock on empty table succeeds', () => {
  const result = lt.setLock(1, F_RDLCK, 0, 99);
  assert.equal(result.ok, true);
});

test('multiple read locks from different processes coexist', () => {
  lt.setLock(1, F_RDLCK, 0, 99);
  const result = lt.setLock(2, F_RDLCK, 0, 99);
  assert.equal(result.ok, true);
  assert.equal(lt.locks.length, 2);
});

test('write lock conflicts with existing read lock from another process', () => {
  lt.setLock(1, F_RDLCK, 0, 99);
  const result = lt.setLock(2, F_WRLCK, 50, 150);
  assert.equal(result.ok, false);
  assert.equal(result.conflict.pid, 1);
});

test('write lock conflicts with existing write lock from another process', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  const result = lt.setLock(2, F_WRLCK, 50, 60);
  assert.equal(result.ok, false);
});

test('read lock conflicts with existing write lock from another process', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  const result = lt.setLock(2, F_RDLCK, 50, 60);
  assert.equal(result.ok, false);
});

test('same process can upgrade read lock to write lock', () => {
  lt.setLock(1, F_RDLCK, 0, 99);
  const result = lt.setLock(1, F_WRLCK, 0, 99);
  assert.equal(result.ok, true);
  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].type, F_WRLCK);
});

test('non-overlapping locks from different processes coexist', () => {
  lt.setLock(1, F_WRLCK, 0, 49);
  const result = lt.setLock(2, F_WRLCK, 50, 99);
  assert.equal(result.ok, true);
  assert.equal(lt.locks.length, 2);
});

// ===========================================================================
// Unlock (Figure 14.5 — splitting)
// ===========================================================================

test('unlock entire range removes lock', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  lt.setLock(1, F_UNLCK, 0, 99);
  assert.equal(lt.locks.length, 0);
});

test('unlock middle splits lock into two (Figure 14.5)', () => {
  lt.setLock(1, F_WRLCK, 100, 199);
  lt.setLock(1, F_UNLCK, 150, 150);

  assert.equal(lt.locks.length, 2);
  const sorted = lt.locks.sort((a, b) => a.start - b.start);
  assert.equal(sorted[0].start, 100);
  assert.equal(sorted[0].end, 149);
  assert.equal(sorted[1].start, 151);
  assert.equal(sorted[1].end, 199);
});

test('unlock left portion shrinks lock', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  lt.setLock(1, F_UNLCK, 0, 49);

  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].start, 50);
  assert.equal(lt.locks[0].end, 99);
});

test('unlock right portion shrinks lock', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  lt.setLock(1, F_UNLCK, 50, 99);

  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].start, 0);
  assert.equal(lt.locks[0].end, 49);
});

// ===========================================================================
// Coalescing
// ===========================================================================

test('adjacent locks of same type coalesce', () => {
  lt.setLock(1, F_WRLCK, 0, 49);
  lt.setLock(1, F_WRLCK, 50, 99);

  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].start, 0);
  assert.equal(lt.locks[0].end, 99);
});

test('overlapping locks of same type coalesce', () => {
  lt.setLock(1, F_RDLCK, 0, 60);
  lt.setLock(1, F_RDLCK, 40, 99);

  assert.equal(lt.locks.length, 1);
  assert.equal(lt.locks[0].start, 0);
  assert.equal(lt.locks[0].end, 99);
});

test('non-adjacent locks of same type do NOT coalesce', () => {
  lt.setLock(1, F_WRLCK, 0, 40);
  lt.setLock(1, F_WRLCK, 60, 99);

  assert.equal(lt.locks.length, 2);
});

test('different types do NOT coalesce', () => {
  lt.setLock(1, F_RDLCK, 0, 49);
  lt.setLock(1, F_WRLCK, 50, 99);

  assert.equal(lt.locks.length, 2);
});

// ===========================================================================
// EOF locks (-1)
// ===========================================================================

test('lock to EOF works', () => {
  const result = lt.setLock(1, F_WRLCK, 100, -1);
  assert.equal(result.ok, true);
  assert.equal(lt.locks[0].end, -1);
});

test('EOF lock conflicts with any later byte', () => {
  lt.setLock(1, F_WRLCK, 100, -1);
  const result = lt.setLock(2, F_WRLCK, 200, 300);
  assert.equal(result.ok, false);
});

// ===========================================================================
// getLock (F_GETLK)
// ===========================================================================

test('getLock returns null if no conflict', () => {
  lt.setLock(1, F_RDLCK, 0, 99);
  const result = lt.getLock(2, F_RDLCK, 0, 99);
  assert.equal(result, null); // read + read = compatible
});

test('getLock returns conflicting lock', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  const result = lt.getLock(2, F_RDLCK, 50, 60);
  assert.ok(result);
  assert.equal(result.pid, 1);
  assert.equal(result.type, F_WRLCK);
});

// ===========================================================================
// computeLockDiff
// ===========================================================================

test('diff detects lock-added', () => {
  const before = lt.clone();
  lt.setLock(1, F_WRLCK, 0, 99);
  const diff = computeLockDiff(before, lt);
  assert.ok(diff.some(d => d.type === 'lock-added'));
});

test('diff detects lock-removed on unlock', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  const before = lt.clone();
  lt.setLock(1, F_UNLCK, 0, 99);
  const diff = computeLockDiff(before, lt);
  assert.ok(diff.some(d => d.type === 'lock-removed'));
});

test('diff detects split (1 removed, 2 added)', () => {
  lt.setLock(1, F_WRLCK, 100, 199);
  const before = lt.clone();
  lt.setLock(1, F_UNLCK, 150, 150);
  const diff = computeLockDiff(before, lt);

  const removed = diff.filter(d => d.type === 'lock-removed');
  const added = diff.filter(d => d.type === 'lock-added');
  assert.equal(removed.length, 1);
  assert.equal(added.length, 2);
});

// ===========================================================================
// clone
// ===========================================================================

test('clone is independent', () => {
  lt.setLock(1, F_WRLCK, 0, 99);
  const copy = lt.clone();
  lt.setLock(1, F_UNLCK, 0, 99);

  assert.equal(lt.locks.length, 0);
  assert.equal(copy.locks.length, 1);
});
