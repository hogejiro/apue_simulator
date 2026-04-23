import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  KernelState, resetIdSequences, computeDiff,
  O_RDONLY, O_WRONLY,
} from '../core/kernel-state.js';

let state;
let pid;

beforeEach(() => {
  resetIdSequences();
  state = new KernelState();
  pid = state.createProcess('shell');
});

// ===========================================================================
// Pipe buffer basics
// ===========================================================================

test('pipe creates vnode with capacity 4096', () => {
  const { readFd, writeFd } = state.pipe(pid);
  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const vnode = state.vnodes.get(readFte.vnodeId);

  assert.equal(vnode.capacity, 4096);
  assert.equal(vnode.buffer.length, 0);
  assert.equal(vnode.bufferUsed, 0);
});

test('write to pipe adds data to buffer', () => {
  const { writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 100, 'hello');

  const proc = state.processes.get(pid);
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));
  const vnode = state.vnodes.get(writeFte.vnodeId);

  assert.equal(vnode.buffer.length, 1);
  assert.equal(vnode.buffer[0].label, 'hello');
  assert.equal(vnode.buffer[0].size, 100);
  assert.equal(vnode.bufferUsed, 100);
});

test('multiple writes accumulate in buffer', () => {
  const { writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 50, 'chunk1');
  state.write(pid, writeFd, 75, 'chunk2');

  const proc = state.processes.get(pid);
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));
  const vnode = state.vnodes.get(writeFte.vnodeId);

  assert.equal(vnode.buffer.length, 2);
  assert.equal(vnode.bufferUsed, 125);
});

test('read from pipe consumes data from buffer', () => {
  const { readFd, writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 100, 'data');
  const bytesRead = state.read(pid, readFd, 100);

  assert.equal(bytesRead, 100);

  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const vnode = state.vnodes.get(readFte.vnodeId);

  assert.equal(vnode.buffer.length, 0);
  assert.equal(vnode.bufferUsed, 0);
});

test('partial read leaves remaining data in buffer', () => {
  const { readFd, writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 100, 'data');
  const bytesRead = state.read(pid, readFd, 40);

  assert.equal(bytesRead, 40);

  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const vnode = state.vnodes.get(readFte.vnodeId);

  assert.equal(vnode.buffer.length, 1);
  assert.equal(vnode.buffer[0].size, 60); // 100 - 40
});

test('read from empty pipe with writer returns blocked', () => {
  const { readFd } = state.pipe(pid);
  const result = state.read(pid, readFd, 100);

  assert.deepEqual(result, { blocked: true, bytes: 0 });
});

test('read from empty pipe with writeClosed returns 0 (EOF)', () => {
  const { readFd } = state.pipe(pid);

  // Mark write end as closed
  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const vnode = state.vnodes.get(readFte.vnodeId);
  vnode.writeClosed = true;

  const result = state.read(pid, readFd, 100);
  assert.equal(result, 0); // EOF
});

test('write to pipe with readClosed returns SIGPIPE', () => {
  const { writeFd } = state.pipe(pid);

  // Mark read end as closed
  const proc = state.processes.get(pid);
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));
  const vnode = state.vnodes.get(writeFte.vnodeId);
  vnode.readClosed = true;

  const result = state.write(pid, writeFd, 100, 'data');
  assert.deepEqual(result, { error: 'SIGPIPE', bytes: 0 });
});

// ===========================================================================
// Pipe buffer with fork
// ===========================================================================

test('pipe write in parent, read in child', () => {
  const { readFd, writeFd } = state.pipe(pid);
  const childPid = state.fork(pid);

  // Parent writes
  state.write(pid, writeFd, 50, 'message');

  // Child reads
  const bytesRead = state.read(childPid, readFd, 50);
  assert.equal(bytesRead, 50);

  // Buffer should be empty now
  const proc = state.processes.get(pid);
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));
  const vnode = state.vnodes.get(writeFte.vnodeId);
  assert.equal(vnode.bufferUsed, 0);
});

// ===========================================================================
// computeDiff for pipe buffer
// ===========================================================================

test('computeDiff detects pipe-write', () => {
  const { writeFd } = state.pipe(pid);
  const before = state.clone();
  state.write(pid, writeFd, 100, 'data');
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'pipe-write' && d.bytes === 100));
});

test('computeDiff detects pipe-read', () => {
  const { readFd, writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 100, 'data');
  const before = state.clone();
  state.read(pid, readFd, 100);
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'pipe-read' && d.bytes === 100));
});

test('computeDiff detects pipe-close', () => {
  const { readFd } = state.pipe(pid);
  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const vnode = state.vnodes.get(readFte.vnodeId);

  const before = state.clone();
  vnode.writeClosed = true;
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'pipe-close' && d.end === 'write'));
});

// ===========================================================================
// clone preserves pipe buffer
// ===========================================================================

test('clone preserves pipe buffer independently', () => {
  const { writeFd } = state.pipe(pid);
  state.write(pid, writeFd, 50, 'data');
  const snapshot = state.clone();

  state.write(pid, writeFd, 75, 'more');

  // Original has 2 chunks
  const proc = state.processes.get(pid);
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));
  const vnode = state.vnodes.get(writeFte.vnodeId);
  assert.equal(vnode.buffer.length, 2);

  // Snapshot still has 1 chunk
  const snapVnode = snapshot.vnodes.get(writeFte.vnodeId);
  assert.equal(snapVnode.buffer.length, 1);
});
