import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SignalState, computeSignalDiff,
  SIGNALS, SIG_DFL, SIG_IGN, DEFAULT_ACTIONS,
} from '../core/signal-state.js';

let ss;

beforeEach(() => {
  ss = new SignalState();
});

// ===========================================================================
// Initial state
// ===========================================================================

test('initial state: all signals have SIG_DFL disposition', () => {
  for (const sig of SIGNALS) {
    assert.equal(ss.disposition.get(sig), SIG_DFL);
  }
});

test('initial state: mask and pending are empty', () => {
  assert.equal(ss.mask.size, 0);
  assert.equal(ss.pending.size, 0);
});

// ===========================================================================
// sigaction
// ===========================================================================

test('sigaction sets disposition and returns previous', () => {
  const prev = ss.sigaction('SIGINT', 'my_handler');
  assert.equal(prev, SIG_DFL);
  assert.equal(ss.disposition.get('SIGINT'), 'my_handler');
});

test('sigaction: cannot change SIGKILL', () => {
  assert.throws(() => ss.sigaction('SIGKILL', SIG_IGN), /Cannot change/);
});

test('sigaction: cannot change SIGSTOP', () => {
  assert.throws(() => ss.sigaction('SIGSTOP', SIG_IGN), /Cannot change/);
});

// ===========================================================================
// block / unblock
// ===========================================================================

test('block adds signals to mask', () => {
  ss.block(['SIGINT', 'SIGTERM']);
  assert.ok(ss.mask.has('SIGINT'));
  assert.ok(ss.mask.has('SIGTERM'));
});

test('block: SIGKILL and SIGSTOP are silently ignored', () => {
  ss.block(['SIGKILL', 'SIGSTOP', 'SIGINT']);
  assert.ok(!ss.mask.has('SIGKILL'));
  assert.ok(!ss.mask.has('SIGSTOP'));
  assert.ok(ss.mask.has('SIGINT'));
});

test('unblock removes signals from mask', () => {
  ss.block(['SIGINT', 'SIGTERM']);
  ss.unblock(['SIGINT']);
  assert.ok(!ss.mask.has('SIGINT'));
  assert.ok(ss.mask.has('SIGTERM'));
});

// ===========================================================================
// kill (send signal)
// ===========================================================================

test('kill: unblocked signal with SIG_DFL is delivered immediately', () => {
  const result = ss.kill('SIGINT');
  assert.equal(result.action, 'default');
  assert.equal(result.defaultAction, 'terminate');
});

test('kill: unblocked signal with custom handler invokes handler', () => {
  ss.sigaction('SIGINT', 'catch_int');
  const result = ss.kill('SIGINT');
  assert.equal(result.action, 'handler');
  assert.equal(result.handler, 'catch_int');
});

test('kill: signal with SIG_IGN is ignored', () => {
  ss.sigaction('SIGINT', SIG_IGN);
  const result = ss.kill('SIGINT');
  assert.equal(result.action, 'ignored');
});

test('kill: blocked signal goes to pending', () => {
  ss.block(['SIGINT']);
  const result = ss.kill('SIGINT');
  assert.equal(result.action, 'pending');
  assert.ok(ss.pending.has('SIGINT'));
});

test('kill: SIGKILL cannot be blocked', () => {
  ss.block(['SIGKILL']);
  const result = ss.kill('SIGKILL');
  assert.equal(result.action, 'default');
  assert.equal(result.defaultAction, 'terminate');
});

test('kill: multiple pending signals of same type coalesce', () => {
  ss.block(['SIGUSR1']);
  ss.kill('SIGUSR1');
  ss.kill('SIGUSR1');
  ss.kill('SIGUSR1');
  // Standard signal: only one instance pending
  assert.equal(ss.pending.size, 1);
});

// ===========================================================================
// unblock delivers pending signals
// ===========================================================================

test('unblock delivers pending signal', () => {
  ss.sigaction('SIGINT', 'my_handler');
  ss.block(['SIGINT']);
  ss.kill('SIGINT');
  assert.ok(ss.pending.has('SIGINT'));

  const delivered = ss.unblock(['SIGINT']);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].action, 'handler');
  assert.equal(delivered[0].handler, 'my_handler');
  assert.ok(!ss.pending.has('SIGINT'));
});

test('setmask delivers newly unblocked pending signals', () => {
  ss.block(['SIGINT', 'SIGTERM']);
  ss.kill('SIGTERM');
  assert.ok(ss.pending.has('SIGTERM'));

  // Set mask to only SIGINT (unblocking SIGTERM)
  const delivered = ss.setmask(['SIGINT']);
  assert.ok(delivered.some(d => d.signo === 'SIGTERM'));
  assert.ok(!ss.pending.has('SIGTERM'));
  assert.ok(ss.mask.has('SIGINT'));
  assert.ok(!ss.mask.has('SIGTERM'));
});

// ===========================================================================
// sigpending
// ===========================================================================

test('sigpending returns pending set', () => {
  ss.block(['SIGINT', 'SIGTERM']);
  ss.kill('SIGINT');
  const p = ss.sigpending();
  assert.ok(p.has('SIGINT'));
  assert.ok(!p.has('SIGTERM'));
});

// ===========================================================================
// SIGCHLD default is ignore
// ===========================================================================

test('SIGCHLD default action is ignore', () => {
  assert.equal(DEFAULT_ACTIONS['SIGCHLD'], 'ignore');
});

// ===========================================================================
// clone
// ===========================================================================

test('clone creates independent copy', () => {
  ss.block(['SIGINT']);
  ss.sigaction('SIGTERM', 'handler');
  const copy = ss.clone();

  ss.unblock(['SIGINT']);
  assert.ok(copy.mask.has('SIGINT'));
  assert.ok(!ss.mask.has('SIGINT'));
});

// ===========================================================================
// computeSignalDiff
// ===========================================================================

test('diff detects mask addition', () => {
  const before = ss.clone();
  ss.block(['SIGINT']);
  const diff = computeSignalDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'mask-added' && d.signo === 'SIGINT'));
});

test('diff detects mask removal', () => {
  ss.block(['SIGINT']);
  const before = ss.clone();
  ss.unblock(['SIGINT']);
  const diff = computeSignalDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'mask-removed' && d.signo === 'SIGINT'));
});

test('diff detects pending addition', () => {
  ss.block(['SIGINT']);
  const before = ss.clone();
  ss.kill('SIGINT');
  const diff = computeSignalDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'pending-added' && d.signo === 'SIGINT'));
});

test('diff detects disposition change', () => {
  const before = ss.clone();
  ss.sigaction('SIGINT', 'my_handler');
  const diff = computeSignalDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'disposition-changed' && d.signo === 'SIGINT' && d.to === 'my_handler'));
});

test('diff detects log entries', () => {
  const before = ss.clone();
  ss.kill('SIGINT');
  const diff = computeSignalDiff(before, ss);
  assert.ok(diff.some(d => d.type === 'log-entry'));
});
