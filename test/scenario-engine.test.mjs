import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioEngine } from '../core/scenario-engine.js';
import { SCENARIOS } from '../modules/fd-table/scenarios.js';
import { SCENARIOS as FORK_SCENARIOS } from '../modules/fork-exec/scenarios.js';

test('ScenarioEngine loads Figure 3.7-3.8 scenario', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);

  assert.equal(engine.totalSteps, 4); // initial + 3 steps
  assert.equal(engine.currentStep, 0);

  const initial = engine.current();
  assert.equal(initial.code, '// initial state');
  // Initial: 1 process, 3 fds (0,1,2)
  assert.equal(initial.state.processes.size, 1);
});

test('ScenarioEngine next/prev navigation', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);

  assert.ok(engine.next());  // step 1: open
  assert.equal(engine.currentStep, 1);

  assert.ok(engine.next());  // step 2: dup
  assert.equal(engine.currentStep, 2);

  assert.ok(engine.prev());  // back to step 1
  assert.equal(engine.currentStep, 1);

  assert.ok(engine.prev());  // back to initial
  assert.equal(engine.currentStep, 0);

  assert.ok(!engine.prev()); // can't go before initial
  assert.equal(engine.currentStep, 0);
});

test('ScenarioEngine: open step adds fd 3', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);
  engine.next(); // open

  const snap = engine.current();
  const proc = [...snap.state.processes.values()][0];
  assert.ok(proc.fdTable.has(3));
  assert.equal(snap.diff.length > 0, true);
});

test('ScenarioEngine: dup step adds fd 4 sharing same fte', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);
  engine.next(); // open
  engine.next(); // dup

  const snap = engine.current();
  const proc = [...snap.state.processes.values()][0];
  assert.ok(proc.fdTable.has(4));
  assert.equal(proc.fdTable.get(3), proc.fdTable.get(4)); // same fte
});

test('ScenarioEngine: Figure 8.2 fork scenario creates child', () => {
  const engine = new ScenarioEngine(SCENARIOS[2]); // Figure 8.2
  engine.next(); // open
  engine.next(); // fork

  const snap = engine.current();
  assert.equal(snap.state.processes.size, 2);

  // Check diff includes process-added
  assert.ok(snap.diff.some(d => d.type === 'process-added'));
});

test('ScenarioEngine: goTo jumps to specific step', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);

  engine.goTo(2); // jump to dup step
  assert.equal(engine.currentStep, 2);

  const snap = engine.current();
  const proc = [...snap.state.processes.values()][0];
  assert.ok(proc.fdTable.has(4)); // dup already applied
});

test('ScenarioEngine: codeLines returns all lines with active flag', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);
  engine.next();

  const lines = engine.codeLines();
  assert.equal(lines.length, 4); // initial + 3 steps
  assert.equal(lines[0].active, false);
  assert.equal(lines[1].active, true);  // current
  assert.equal(lines[2].active, false);
});

test('ScenarioEngine: reset returns to initial state', () => {
  const engine = new ScenarioEngine(SCENARIOS[0]);
  engine.next();
  engine.next();

  engine.reset();
  assert.equal(engine.currentStep, 0);
  assert.equal(engine.current().code, '// initial state');
});

test('ScenarioEngine: pipe scenario creates 2 processes with correct fds', () => {
  const engine = new ScenarioEngine(SCENARIOS[4]); // pipe scenario
  engine.next(); // pipe
  engine.next(); // fork
  engine.next(); // parent close read
  engine.next(); // child close write

  const snap = engine.current();
  const procs = [...snap.state.processes.values()];
  const parent = procs[0];
  const child = procs[1];

  // Parent has fd 4 (write), not fd 3 (read)
  assert.ok(!parent.fdTable.has(3));
  assert.ok(parent.fdTable.has(4));

  // Child has fd 3 (read), not fd 4 (write)
  assert.ok(child.fdTable.has(3));
  assert.ok(!child.fdTable.has(4));
});

test('all fd-table scenarios load without error', () => {
  for (const scenario of SCENARIOS) {
    const engine = new ScenarioEngine(scenario);
    while (engine.next()) { /* advance */ }
    assert.ok(engine.currentStep > 0, `${scenario.label} has steps`);
  }
});

test('all fork-exec scenarios load without error', () => {
  for (const scenario of FORK_SCENARIOS) {
    const engine = new ScenarioEngine(scenario);
    while (engine.next()) { /* advance */ }
    assert.ok(engine.currentStep > 0, `${scenario.label} has steps`);
  }
});

test('fork-exec: basic fork+exit+wait lifecycle', () => {
  const engine = new ScenarioEngine(FORK_SCENARIOS[0]);

  engine.next(); // fork
  assert.equal(engine.current().state.processes.size, 2);

  engine.next(); // child exit
  const child = [...engine.current().state.processes.values()].find(p => p.ppid > 0);
  assert.equal(child.state, 'ZOMBIE');

  engine.next(); // waitpid
  assert.equal(engine.current().state.processes.size, 1);
});

test('fork-exec: exec changes program name', () => {
  const engine = new ScenarioEngine(FORK_SCENARIOS[1]); // fork+exec

  engine.next(); // fork
  engine.next(); // exec cat

  const procs = [...engine.current().state.processes.values()];
  const child = procs.find(p => p.program === '/bin/cat');
  assert.ok(child);
});

test('fork-exec: pipeline scenario creates correct structure', () => {
  const engine = new ScenarioEngine(FORK_SCENARIOS[3]); // ls | wc -l

  // Walk through all steps
  while (engine.next()) { /* advance */ }

  const state = engine.current().state;
  // Shell should have closed pipe fds
  const shell = [...state.processes.values()].find(p => p.program === '/bin/sh');
  assert.ok(!shell.fdTable.has(3));
  assert.ok(!shell.fdTable.has(4));
});
