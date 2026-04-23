import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  KernelState, resetIdSequences, computeDiff,
  O_RDONLY, O_WRONLY, O_RDWR, O_APPEND, O_CREAT, O_TRUNC,
  flagsToString,
} from '../core/kernel-state.js';

let state;
let pid;

beforeEach(() => {
  resetIdSequences();
  state = new KernelState();
  pid = state.createProcess('shell');
});

// ===========================================================================
// createProcess
// ===========================================================================

test('createProcess sets up fd 0,1,2 pointing to /dev/tty', () => {
  const proc = state.processes.get(pid);
  assert.equal(proc.fdTable.size, 3);
  assert.ok(proc.fdTable.has(0));
  assert.ok(proc.fdTable.has(1));
  assert.ok(proc.fdTable.has(2));

  // All point to /dev/tty vnode
  for (const fteId of proc.fdTable.values()) {
    const fte = state.fileTable.get(fteId);
    assert.ok(fte);
    const vnode = state.vnodes.get(fte.vnodeId);
    assert.equal(vnode.path, '/dev/tty');
  }
});

test('createProcess: stdin is O_RDONLY, stdout/stderr are O_WRONLY', () => {
  const proc = state.processes.get(pid);
  const stdinFte = state.fileTable.get(proc.fdTable.get(0));
  const stdoutFte = state.fileTable.get(proc.fdTable.get(1));
  const stderrFte = state.fileTable.get(proc.fdTable.get(2));

  assert.equal(stdinFte.flags, O_RDONLY);
  assert.equal(stdoutFte.flags, O_WRONLY);
  assert.equal(stderrFte.flags, O_WRONLY);
});

// ===========================================================================
// open
// ===========================================================================

test('open allocates lowest available fd', () => {
  const { fd } = state.open(pid, '/etc/passwd', O_RDONLY);
  assert.equal(fd, 3);
});

test('open creates new file table entry and vnode', () => {
  const { fd, fileTableEntryId, vnodeId } = state.open(pid, '/etc/passwd', O_RDONLY);
  const fte = state.fileTable.get(fileTableEntryId);
  assert.ok(fte);
  assert.equal(fte.offset, 0);
  assert.equal(fte.refcount, 1);
  assert.equal(fte.flags, O_RDONLY);

  const vnode = state.vnodes.get(vnodeId);
  assert.equal(vnode.path, '/etc/passwd');
});

test('opening same file twice creates two file table entries but one vnode', () => {
  const r1 = state.open(pid, '/tmp/data', O_RDONLY);
  const r2 = state.open(pid, '/tmp/data', O_RDWR);

  assert.notEqual(r1.fileTableEntryId, r2.fileTableEntryId);
  assert.equal(r1.vnodeId, r2.vnodeId);
  assert.equal(r1.fd, 3);
  assert.equal(r2.fd, 4);
});

// ===========================================================================
// close
// ===========================================================================

test('close removes fd from process and decrements refcount', () => {
  const { fd, fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 1);

  state.close(pid, fd);

  const proc = state.processes.get(pid);
  assert.ok(!proc.fdTable.has(fd));
  // refcount dropped to 0 -> entry removed
  assert.ok(!state.fileTable.has(fileTableEntryId));
});

test('close with shared refcount does not remove file table entry', () => {
  const { fd, fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);
  state.dup(pid, fd); // refcount = 2

  state.close(pid, fd);
  assert.ok(state.fileTable.has(fileTableEntryId));
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 1);
});

test('close throws on bad fd', () => {
  assert.throws(() => state.close(pid, 99), /Bad fd/);
});

// ===========================================================================
// dup
// ===========================================================================

test('dup returns lowest available fd and increments refcount', () => {
  const { fd, fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);
  const newFd = state.dup(pid, fd);

  assert.equal(newFd, 4); // 0,1,2,3 taken
  const proc = state.processes.get(pid);
  assert.equal(proc.fdTable.get(fd), proc.fdTable.get(newFd));
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 2);
});

test('dup: after closing fd 0, dup fills the gap', () => {
  state.close(pid, 0);
  const { fd } = state.open(pid, '/tmp/file', O_RDONLY);
  assert.equal(fd, 0); // lowest available
});

// ===========================================================================
// dup2
// ===========================================================================

test('dup2 redirects newfd to same file table entry', () => {
  const { fd, fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);

  // dup2(3, 1) — redirect stdout to file
  state.dup2(pid, fd, 1);

  const proc = state.processes.get(pid);
  assert.equal(proc.fdTable.get(1), fileTableEntryId);
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 2);
});

test('dup2 closes existing newfd first', () => {
  const proc = state.processes.get(pid);
  const oldStdoutFteId = proc.fdTable.get(1);

  const { fd, fileTableEntryId } = state.open(pid, '/tmp/out', O_WRONLY);
  state.dup2(pid, fd, 1);

  // Old stdout file table entry should be gone (refcount was 1)
  assert.ok(!state.fileTable.has(oldStdoutFteId));
  assert.equal(proc.fdTable.get(1), fileTableEntryId);
});

test('dup2 with same fd is a no-op', () => {
  const { fd, fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);
  const result = state.dup2(pid, fd, fd);
  assert.equal(result, fd);
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 1); // no increment
});

// ===========================================================================
// fork (Figure 8.2)
// ===========================================================================

test('fork creates child with copied fd table', () => {
  state.open(pid, '/tmp/data', O_RDWR);

  const childPid = state.fork(pid);
  const parent = state.processes.get(pid);
  const child = state.processes.get(childPid);

  assert.equal(child.ppid, pid);
  assert.equal(child.fdTable.size, parent.fdTable.size);

  // Same file table entry IDs
  for (const [fd, fteId] of parent.fdTable) {
    assert.equal(child.fdTable.get(fd), fteId);
  }
});

test('fork increments refcount on all shared file table entries', () => {
  const { fileTableEntryId } = state.open(pid, '/tmp/data', O_RDWR);
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 1);

  state.fork(pid);

  // fd 0,1,2 each had refcount 1 -> now 2
  // fd 3 had refcount 1 -> now 2
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 2);
});

test('fork: parent write advances shared offset, child sees it', () => {
  const { fd } = state.open(pid, '/tmp/data', O_RDWR);
  const childPid = state.fork(pid);

  // Parent writes 100 bytes
  state.write(pid, fd, 100);

  // Both parent and child share the same file table entry
  const parent = state.processes.get(pid);
  const child = state.processes.get(childPid);
  const parentFteId = parent.fdTable.get(fd);
  const childFteId = child.fdTable.get(fd);
  assert.equal(parentFteId, childFteId);
  assert.equal(state.fileTable.get(parentFteId).offset, 100);
});

// ===========================================================================
// pipe
// ===========================================================================

test('pipe creates two fds: read and write', () => {
  const { readFd, writeFd } = state.pipe(pid);
  assert.equal(readFd, 3);
  assert.equal(writeFd, 4);

  const proc = state.processes.get(pid);
  const readFte = state.fileTable.get(proc.fdTable.get(readFd));
  const writeFte = state.fileTable.get(proc.fdTable.get(writeFd));

  assert.equal(readFte.flags, O_RDONLY);
  assert.equal(writeFte.flags, O_WRONLY);
  assert.equal(readFte.vnodeId, writeFte.vnodeId); // same pipe vnode

  const vnode = state.vnodes.get(readFte.vnodeId);
  assert.equal(vnode.type, 'FIFO');
  assert.equal(vnode.path, '<pipe>');
});

// ===========================================================================
// lseek, read, write
// ===========================================================================

test('lseek sets offset', () => {
  const { fd } = state.open(pid, '/tmp/data', O_RDWR);
  state.lseek(pid, fd, 42);

  const proc = state.processes.get(pid);
  const fte = state.fileTable.get(proc.fdTable.get(fd));
  assert.equal(fte.offset, 42);
});

test('write advances offset and grows vnode size', () => {
  const { fd, vnodeId } = state.open(pid, '/tmp/data', O_RDWR);
  state.write(pid, fd, 50);

  const proc = state.processes.get(pid);
  const fte = state.fileTable.get(proc.fdTable.get(fd));
  assert.equal(fte.offset, 50);
  assert.equal(state.vnodes.get(vnodeId).size, 50);
});

test('write with O_APPEND seeks to end first', () => {
  const { fd, vnodeId } = state.open(pid, '/tmp/log', O_WRONLY | O_APPEND);
  const vnode = state.vnodes.get(vnodeId);
  vnode.size = 100; // simulate existing file

  state.write(pid, fd, 20);

  const proc = state.processes.get(pid);
  const fte = state.fileTable.get(proc.fdTable.get(fd));
  assert.equal(fte.offset, 120);
  assert.equal(vnode.size, 120);
});

test('read advances offset, limited by file size', () => {
  const { fd, vnodeId } = state.open(pid, '/tmp/data', O_RDONLY);
  state.vnodes.get(vnodeId).size = 30;

  const n = state.read(pid, fd, 100);
  assert.equal(n, 30);

  const proc = state.processes.get(pid);
  const fte = state.fileTable.get(proc.fdTable.get(fd));
  assert.equal(fte.offset, 30);
});

// ===========================================================================
// clone (snapshot)
// ===========================================================================

test('clone creates independent copy', () => {
  state.open(pid, '/tmp/file', O_RDONLY);
  const snapshot = state.clone();

  // Mutate original
  state.open(pid, '/tmp/another', O_RDWR);

  // Snapshot should be unaffected
  const origProc = state.processes.get(pid);
  const snapProc = snapshot.processes.get(pid);
  assert.equal(origProc.fdTable.size, 5); // 0,1,2,3,4
  assert.equal(snapProc.fdTable.size, 4); // 0,1,2,3
});

// ===========================================================================
// computeDiff
// ===========================================================================

test('computeDiff detects fd addition', () => {
  const before = state.clone();
  state.open(pid, '/tmp/new', O_RDONLY);
  const diff = computeDiff(before, state);

  const fdAdded = diff.filter(d => d.type === 'fd-added');
  assert.equal(fdAdded.length, 1);
  assert.equal(fdAdded[0].fd, 3);
});

test('computeDiff detects fork (new process + refcount changes)', () => {
  state.open(pid, '/tmp/file', O_RDONLY);
  const before = state.clone();
  state.fork(pid);
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'process-added'));
  assert.ok(diff.some(d => d.type === 'fte-refcount'));
});

test('computeDiff detects fd removal on close', () => {
  const { fd } = state.open(pid, '/tmp/file', O_RDONLY);
  const before = state.clone();
  state.close(pid, fd);
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'fd-removed' && d.fd === fd));
  assert.ok(diff.some(d => d.type === 'fte-removed'));
});

// ===========================================================================
// flagsToString
// ===========================================================================

test('flagsToString formats flags correctly', () => {
  assert.equal(flagsToString(O_RDONLY), 'O_RDONLY');
  assert.equal(flagsToString(O_WRONLY), 'O_WRONLY');
  assert.equal(flagsToString(O_RDWR), 'O_RDWR');
  assert.equal(flagsToString(O_WRONLY | O_APPEND), 'O_WRONLY | O_APPEND');
  assert.equal(flagsToString(O_RDWR | O_CREAT | O_TRUNC), 'O_RDWR | O_CREAT | O_TRUNC');
});

// ===========================================================================
// Compound scenario: Figure 8.2 — fork + independent close
// ===========================================================================

test('Figure 8.2 scenario: fork, child closes, parent unaffected', () => {
  const { fd } = state.open(pid, '/etc/passwd', O_RDONLY);
  const childPid = state.fork(pid);

  // Child closes the file
  state.close(childPid, fd);

  // Parent still has fd 3
  const parent = state.processes.get(pid);
  assert.ok(parent.fdTable.has(fd));

  // File table entry still exists (refcount 1)
  const fteId = parent.fdTable.get(fd);
  assert.equal(state.fileTable.get(fteId).refcount, 1);

  // Child no longer has it
  const child = state.processes.get(childPid);
  assert.ok(!child.fdTable.has(fd));
});

// ===========================================================================
// Compound scenario: shell redirection — open + dup2 + close + fork + exec
// ===========================================================================

test('shell redirection: cmd > file', () => {
  // open("file", O_WRONLY|O_CREAT|O_TRUNC)
  const { fd } = state.open(pid, '/tmp/output', O_WRONLY | O_CREAT | O_TRUNC);
  assert.equal(fd, 3);

  // dup2(3, 1) — redirect stdout
  state.dup2(pid, 3, 1);

  // close(3) — no longer need the extra fd
  state.close(pid, 3);

  // Verify: fd 1 now points to /tmp/output
  const proc = state.processes.get(pid);
  const fteId = proc.fdTable.get(1);
  const fte = state.fileTable.get(fteId);
  const vnode = state.vnodes.get(fte.vnodeId);
  assert.equal(vnode.path, '/tmp/output');
  assert.equal(fte.flags, O_WRONLY | O_CREAT | O_TRUNC);
  assert.ok(!proc.fdTable.has(3));
});

// ===========================================================================
// Compound scenario: pipe between parent and child
// ===========================================================================

test('pipe scenario: parent writes, child reads', () => {
  const { readFd, writeFd } = state.pipe(pid);
  const childPid = state.fork(pid);

  // Parent closes read end
  state.close(pid, readFd);
  // Child closes write end
  state.close(childPid, writeFd);

  // Parent writes
  state.write(pid, writeFd, 42);

  // Both share same pipe vnode
  const parentProc = state.processes.get(pid);
  const childProc = state.processes.get(childPid);

  assert.ok(!parentProc.fdTable.has(readFd));
  assert.ok(!childProc.fdTable.has(writeFd));
  assert.ok(parentProc.fdTable.has(writeFd));
  assert.ok(childProc.fdTable.has(readFd));
});

// ===========================================================================
// exec
// ===========================================================================

test('exec changes process name and program', () => {
  const childPid = state.fork(pid);
  state.exec(childPid, '/bin/cat');

  const child = state.processes.get(childPid);
  assert.equal(child.program, '/bin/cat');
  assert.equal(child.name, '/bin/cat');
});

test('exec preserves fd table', () => {
  state.open(pid, '/tmp/file', O_RDONLY);
  const childPid = state.fork(pid);
  state.exec(childPid, '/bin/cat');

  const child = state.processes.get(childPid);
  assert.equal(child.fdTable.size, 4); // 0,1,2,3
});

// ===========================================================================
// exit
// ===========================================================================

test('exit closes all fds and sets state to ZOMBIE', () => {
  const childPid = state.fork(pid);
  state.exit(childPid, 42);

  const child = state.processes.get(childPid);
  assert.equal(child.state, 'ZOMBIE');
  assert.equal(child.exitStatus, 42);
  assert.equal(child.fdTable.size, 0);
});

test('exit decrements refcounts on shared file table entries', () => {
  const { fileTableEntryId } = state.open(pid, '/tmp/file', O_RDONLY);
  const childPid = state.fork(pid);

  // refcount is 2 (parent + child)
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 2);

  state.exit(childPid);

  // refcount back to 1
  assert.equal(state.fileTable.get(fileTableEntryId).refcount, 1);
});

// ===========================================================================
// waitpid
// ===========================================================================

test('waitpid collects zombie child and removes from process table', () => {
  const childPid = state.fork(pid);
  state.exit(childPid, 7);

  const result = state.waitpid(pid, childPid);
  assert.equal(result.pid, childPid);
  assert.equal(result.exitStatus, 7);
  assert.ok(!state.processes.has(childPid));
});

test('waitpid throws on non-zombie process', () => {
  const childPid = state.fork(pid);
  assert.throws(() => state.waitpid(pid, childPid), /not a zombie/);
});

// ===========================================================================
// computeDiff: exec and exit
// ===========================================================================

test('computeDiff detects exec (process-exec)', () => {
  const childPid = state.fork(pid);
  const before = state.clone();
  state.exec(childPid, '/usr/bin/wc');
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'process-exec' && d.pid === childPid && d.to === '/usr/bin/wc'));
});

test('computeDiff detects exit (process-state)', () => {
  const childPid = state.fork(pid);
  const before = state.clone();
  state.exit(childPid, 0);
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'process-state' && d.pid === childPid && d.to === 'ZOMBIE'));
});

test('computeDiff detects waitpid (process-removed)', () => {
  const childPid = state.fork(pid);
  state.exit(childPid, 0);
  const before = state.clone();
  state.waitpid(pid, childPid);
  const diff = computeDiff(before, state);

  assert.ok(diff.some(d => d.type === 'process-removed' && d.pid === childPid));
});
