/**
 * scenario-engine.js — Step-through engine for APUE scenarios
 *
 * A Scenario is an array of steps. Each step has:
 *   - code: C code string (display only, not interpreted)
 *   - apply: function(KernelState) that mutates the state
 *   - lesson: explanation text
 *
 * The engine manages snapshots for prev/next navigation and diff computation.
 */

import { KernelState, computeDiff, resetIdSequences } from './kernel-state.js';

export class ScenarioEngine {
  /**
   * @param {object} scenario
   * @param {string} scenario.label
   * @param {string} [scenario.figure]
   * @param {function(KernelState): number} scenario.setup - initializes state, returns main pid
   * @param {Array<{code: string, apply: function(KernelState, number): void, lesson: string}>} scenario.steps
   */
  constructor(scenario) {
    this.scenario = scenario;
    this.snapshots = [];   // array of { state: KernelState, code, lesson, diff }
    this.currentStep = -1; // -1 = initial state (before any step)
    this._init();
  }

  _init() {
    resetIdSequences();
    const state = new KernelState();
    const mainPid = this.scenario.setup(state);
    this.mainPid = mainPid;

    // Snapshot 0: initial state (before any step)
    this.snapshots = [{
      state: state.clone(),
      code: '// initial state',
      lesson: this.scenario.description || '',
      diff: [],
    }];
    this.currentStep = 0;

    // Pre-compute all steps
    const current = state;
    for (const step of this.scenario.steps) {
      const before = current.clone();
      step.apply(current, mainPid);
      const after = current.clone();
      const diff = computeDiff(before, after);
      this.snapshots.push({
        state: after,
        code: step.code,
        lesson: step.lesson || '',
        diff,
      });
    }
  }

  /** Reset and re-run from scratch */
  reset() {
    this._init();
  }

  /** Total number of steps (including initial state) */
  get totalSteps() {
    return this.snapshots.length;
  }

  /** Go to next step. Returns false if already at end. */
  next() {
    if (this.currentStep >= this.snapshots.length - 1) return false;
    this.currentStep++;
    return true;
  }

  /** Go to previous step. Returns false if already at start. */
  prev() {
    if (this.currentStep <= 0) return false;
    this.currentStep--;
    return true;
  }

  /** Jump to a specific step index */
  goTo(index) {
    if (index < 0 || index >= this.snapshots.length) return false;
    this.currentStep = index;
    return true;
  }

  /** Get current snapshot */
  current() {
    return this.snapshots[this.currentStep];
  }

  /** Get all code lines with current line highlighted */
  codeLines() {
    return this.snapshots.map((snap, i) => ({
      code: snap.code,
      active: i === this.currentStep,
      index: i,
    }));
  }
}
