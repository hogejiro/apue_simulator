import { SessionState, computeSessionDiff } from './session-state.js';

export class SessionScenarioEngine {
  constructor(scenario) {
    this.scenario = scenario;
    this.snapshots = [];
    this.currentStep = -1;
    this._init();
  }

  _init() {
    const state = new SessionState();
    if (this.scenario.setup) this.scenario.setup(state);

    this.snapshots = [{
      state: state.clone(),
      code: '// initial state',
      lesson: this.scenario.description || '',
      diff: [],
    }];
    this.currentStep = 0;

    const current = state;
    for (const step of this.scenario.steps) {
      const before = current.clone();
      step.apply(current);
      const after = current.clone();
      this.snapshots.push({
        state: after,
        code: step.code,
        lesson: step.lesson || '',
        diff: computeSessionDiff(before, after),
      });
    }
  }

  reset() { this._init(); }
  get totalSteps() { return this.snapshots.length; }
  next() { if (this.currentStep >= this.snapshots.length - 1) return false; this.currentStep++; return true; }
  prev() { if (this.currentStep <= 0) return false; this.currentStep--; return true; }
  goTo(i) { if (i < 0 || i >= this.snapshots.length) return false; this.currentStep = i; return true; }
  current() { return this.snapshots[this.currentStep]; }
  codeLines() { return this.snapshots.map((s, i) => ({ code: s.code, active: i === this.currentStep, index: i })); }
}
