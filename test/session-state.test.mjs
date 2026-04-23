import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionState, computeSessionDiff } from '../core/session-state.js';

let ss;

beforeEach(() => {
  ss = new SessionState();
  ss.createSession('bash');
});

test('createSession sets up session leader', () => {
  assert.equal(ss.sid, 1);
  assert.equal(ss.foregroundPgid, 1);
  assert.equal(ss.processes.size, 1);
  const shell = ss.processes.get(1);
  assert.equal(shell.pgid, 1);
  assert.equal(shell.name, 'bash');
});

test('fork creates child in same PG', () => {
  const pid = ss.fork(1, 'child');
  assert.equal(pid, 2);
  const child = ss.processes.get(2);
  assert.equal(child.pgid, 1);
  assert.equal(child.ppid, 1);
});

test('setpgid changes process group', () => {
  const pid = ss.fork(1, 'cat');
  ss.setpgid(pid, pid);
  assert.equal(ss.processes.get(pid).pgid, pid);
});

test('tcsetpgrp changes foreground PG', () => {
  const pid = ss.fork(1, 'cat');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  assert.equal(ss.foregroundPgid, pid);
});

test('signalForeground SIGINT terminates foreground PG', () => {
  const pid = ss.fork(1, 'cat');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  ss.signalForeground('SIGINT');

  assert.equal(ss.processes.get(pid).state, 'ZOMBIE');
  assert.equal(ss.processes.get(1).state, 'RUNNING'); // shell not in fg
});

test('signalForeground SIGTSTP stops foreground PG', () => {
  const pid = ss.fork(1, 'vim');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  ss.signalForeground('SIGTSTP');

  assert.equal(ss.processes.get(pid).state, 'STOPPED');
});

test('resumePG with foreground=true brings to foreground', () => {
  const pid = ss.fork(1, 'vim');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  ss.signalForeground('SIGTSTP');
  ss.tcsetpgrp(1); // shell back to fg

  ss.resumePG(pid, true); // fg
  assert.equal(ss.processes.get(pid).state, 'RUNNING');
  assert.equal(ss.foregroundPgid, pid);
});

test('resumePG with foreground=false keeps in background', () => {
  const pid = ss.fork(1, 'sleep');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  ss.signalForeground('SIGTSTP');
  ss.tcsetpgrp(1);

  ss.resumePG(pid, false); // bg
  assert.equal(ss.processes.get(pid).state, 'RUNNING');
  assert.equal(ss.foregroundPgid, 1); // shell stays fg
});

test('getProcessGroups returns grouped processes', () => {
  const p2 = ss.fork(1, 'cat');
  const p3 = ss.fork(1, 'grep');
  ss.setpgid(p2, p2);
  ss.setpgid(p3, p2); // same PG as cat

  const groups = ss.getProcessGroups();
  assert.equal(groups.size, 2);
  assert.equal(groups.get(1).length, 1); // shell
  assert.equal(groups.get(p2).length, 2); // cat + grep
});

test('pipeline: processes in same PG', () => {
  const p2 = ss.fork(1, 'ls');
  const p3 = ss.fork(1, 'grep');
  ss.setpgid(p2, p2);
  ss.setpgid(p3, p2);
  ss.tcsetpgrp(p2);

  // ^C kills both
  ss.signalForeground('SIGINT');
  assert.equal(ss.processes.get(p2).state, 'ZOMBIE');
  assert.equal(ss.processes.get(p3).state, 'ZOMBIE');
  assert.equal(ss.processes.get(1).state, 'RUNNING');
});

test('diff detects foreground PG change', () => {
  const pid = ss.fork(1, 'cat');
  ss.setpgid(pid, pid);
  const before = ss.clone();
  ss.tcsetpgrp(pid);
  const diff = computeSessionDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'fg-changed'));
});

test('diff detects process state change', () => {
  const pid = ss.fork(1, 'cat');
  ss.setpgid(pid, pid);
  ss.tcsetpgrp(pid);
  const before = ss.clone();
  ss.signalForeground('SIGTSTP');
  const diff = computeSessionDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'state-changed' && d.to === 'STOPPED'));
});

test('clone is independent', () => {
  const copy = ss.clone();
  ss.fork(1, 'test');
  assert.equal(ss.processes.size, 2);
  assert.equal(copy.processes.size, 1);
});
