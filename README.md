# APUE Simulator

Interactive visualizer for kernel data structures from **Advanced Programming in the UNIX Environment** (Stevens & Rago, 3rd Edition).

C code is shown as a "script" on the left — step through it with prev/next, and the kernel state diagram on the right updates accordingly.

## Demo

https://hogejiro.github.io/apue_simulator/

## Features

- **15 modules / 49 scenarios** — covers 15 of 21 APUE chapters
- **Step execution** — prev/next (←→ or j/k) to trace kernel state changes line by line
- **SVG arrows** — visualizes fd table → file table → vnode 3-layer connections
- **Diff highlighting** — green (added) / yellow (changed) at each step
- **Syntax highlighting** — syscalls, types, and constants in C code
- **Lesson text** — educational explanation tied to each step
- **Cross-module links** — navigate to related modules
- **Progress tracker** — ✓ when you reach the last step of a scenario
- **Dark/Light theme** — toggle with 🌙 button

## Modules

| Category | Module | Scenarios | APUE Chapter |
|---|---|---|---|
| File I/O | fd Table | 5 | Ch 3-4 |
| Process | Memory Layout | 3 | Ch 7 |
| Process | fork/exec | 4 | Ch 7-8 |
| Process | Session & Jobs | 3 | Ch 9 |
| Threads | Thread Sync | 3 | Ch 11-12 |
| Threads | Deadlock | 3 | Ch 11 |
| Signals | Signal Delivery | 5 | Ch 10 |
| IPC | Pipe & FIFO | 4 | Ch 15 |
| Advanced I/O | Record Lock | 4 | Ch 14 |
| Advanced I/O | I/O Multiplexing | 3 | Ch 14 |
| Terminal | Terminal Modes | 3 | Ch 18 |
| Terminal | PTY Dataflow | 3 | Ch 19 |
| Network | Socket API | 3 | Ch 16 |
| Daemon | Daemon Steps | 3 | Ch 13 |
| Reference | Syscall Reference | - | All |

## Tech Stack

- Vanilla JS (ES modules) — no frameworks
- SVG for arrows and diagrams
- CSS variables for theming
- Node 22 `node --test` for testing (140 tests)

## Run Locally

```bash
python3 -m http.server 8766
open http://localhost:8766
```

## Run Tests

```bash
node --test test/*.test.mjs
```

## Architecture

```
core/           Engine (DOM-independent, testable with Node)
modules/<name>/ visualizer.js + scenarios.js per module
test/           node --test
index.html      MODULE_REGISTRY + module switching
style.css       CSS variables + dark/light theme
```

Each module follows the pattern:

1. **Scenario** — preset C code steps + `apply(state)` function
2. **Engine** — pre-computes all snapshots with diffs
3. **Visualizer** — renders state + highlights changes

## License

MIT
