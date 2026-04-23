/**
 * deadlock scenarios — lock ordering, trylock, dependency graph
 */

export const SCENARIOS = [
  {
    label: 'Figure 11.11: 逆順ロックでデッドロック',
    figure: '11.11',
    description: '2 つの mutex を逆の順序でロックすると、互いに相手を待つ循環待ち (デッドロック) が発生する。',
    initialState: () => ({
      threads: [
        { tid: 1, name: 'Thread A', state: 'RUNNING', holds: [], waitsFor: null },
        { tid: 2, name: 'Thread B', state: 'RUNNING', holds: [], waitsFor: null },
      ],
      mutexes: [
        { name: 'mutex1', owner: null },
        { name: 'mutex2', owner: null },
      ],
      deadlocked: false,
      events: [],
    }),
    steps: [
      {
        code: '[Thread A] pthread_mutex_lock(&mutex1);',
        apply: (s) => {
          s.threads[0].holds = ['mutex1'];
          s.mutexes[0].owner = 1;
          s.events.push('A locks mutex1 ✓');
        },
        lesson: 'Thread A が mutex1 を取得。ここまでは問題なし。',
      },
      {
        code: '[Thread B] pthread_mutex_lock(&mutex2);',
        apply: (s) => {
          s.threads[1].holds = ['mutex2'];
          s.mutexes[1].owner = 2;
          s.events.push('B locks mutex2 ✓');
        },
        lesson: 'Thread B が mutex2 を取得。A は mutex1、B は mutex2 を持っている。',
      },
      {
        code: '[Thread A] pthread_mutex_lock(&mutex2);\n// BLOCKED — B holds mutex2',
        apply: (s) => {
          s.threads[0].state = 'BLOCKED';
          s.threads[0].waitsFor = 'mutex2';
          s.events.push('A tries mutex2 → BLOCKED (held by B)');
        },
        lesson: 'A が mutex2 を要求するが B が保持中 → A はブロック。A は mutex1 を持ったまま mutex2 を待つ。',
      },
      {
        code: '[Thread B] pthread_mutex_lock(&mutex1);\n// BLOCKED — A holds mutex1\n// → DEADLOCK!',
        apply: (s) => {
          s.threads[1].state = 'BLOCKED';
          s.threads[1].waitsFor = 'mutex1';
          s.deadlocked = true;
          s.events.push('B tries mutex1 → BLOCKED (held by A)');
          s.events.push('DEADLOCK: A→mutex2→B→mutex1→A (cycle!)');
        },
        lesson: 'B が mutex1 を要求するが A が保持中 → B もブロック。循環依存: A は B (の mutex2) を待ち、B は A (の mutex1) を待つ。誰も進めない = デッドロック。pthread mutex はデッドロックを検出しない — プログラムが永久に停止する。',
      },
    ],
  },
  {
    label: 'Figure 11.12: ロック順序の統一で回避',
    figure: '11.12',
    description: '全てのスレッドが同じ順序 (mutex1 → mutex2) でロックすれば、デッドロックは発生しない。',
    initialState: () => ({
      threads: [
        { tid: 1, name: 'Thread A', state: 'RUNNING', holds: [], waitsFor: null },
        { tid: 2, name: 'Thread B', state: 'RUNNING', holds: [], waitsFor: null },
      ],
      mutexes: [
        { name: 'mutex1', owner: null },
        { name: 'mutex2', owner: null },
      ],
      deadlocked: false,
      events: [],
    }),
    steps: [
      {
        code: '[Thread A] pthread_mutex_lock(&mutex1);',
        apply: (s) => {
          s.threads[0].holds = ['mutex1'];
          s.mutexes[0].owner = 1;
          s.events.push('A locks mutex1 ✓');
        },
        lesson: 'A が mutex1 を取得 (順序: 1→2)。',
      },
      {
        code: '[Thread B] pthread_mutex_lock(&mutex1);\n// BLOCKED — A holds mutex1',
        apply: (s) => {
          s.threads[1].state = 'BLOCKED';
          s.threads[1].waitsFor = 'mutex1';
          s.events.push('B tries mutex1 → BLOCKED (held by A)');
        },
        lesson: 'B も mutex1 から取得しようとする (順序: 1→2)。A が保持中なのでブロック。だが B はまだ何も持っていないので、循環依存は発生しない。',
      },
      {
        code: '[Thread A] pthread_mutex_lock(&mutex2);',
        apply: (s) => {
          s.threads[0].holds = ['mutex1', 'mutex2'];
          s.mutexes[1].owner = 1;
          s.events.push('A locks mutex2 ✓ (no deadlock — B holds nothing)');
        },
        lesson: 'A が mutex2 も取得。B は mutex1 を待っているだけで、mutex2 は持っていない → 競合なし。',
      },
      {
        code: '[Thread A] // critical section\n[Thread A] pthread_mutex_unlock(&mutex2);\n[Thread A] pthread_mutex_unlock(&mutex1);',
        apply: (s) => {
          s.threads[0].holds = [];
          s.mutexes[0].owner = 2;
          s.mutexes[1].owner = null;
          s.threads[1].state = 'RUNNING';
          s.threads[1].waitsFor = null;
          s.threads[1].holds = ['mutex1'];
          s.events.push('A unlocks both → B wakes up, gets mutex1');
        },
        lesson: 'A が両方 unlock。B が起床して mutex1 を取得。ロック順序を統一するだけでデッドロックを完全に防げる。ルール: 「常に小さい番号/アドレスの mutex から取得する」。',
      },
    ],
  },
  {
    label: 'trylock によるバックオフ',
    figure: '11.11',
    description: 'pthread_mutex_trylock で取得を試み、失敗したら保持中のロックを全て解放してリトライ。デッドロックを回避するもう 1 つの方法。',
    initialState: () => ({
      threads: [
        { tid: 1, name: 'Thread A', state: 'RUNNING', holds: [], waitsFor: null },
        { tid: 2, name: 'Thread B', state: 'RUNNING', holds: [], waitsFor: null },
      ],
      mutexes: [
        { name: 'mutex1', owner: null },
        { name: 'mutex2', owner: null },
      ],
      deadlocked: false,
      events: [],
    }),
    steps: [
      {
        code: '[Thread A] pthread_mutex_lock(&mutex1);',
        apply: (s) => {
          s.threads[0].holds = ['mutex1'];
          s.mutexes[0].owner = 1;
          s.events.push('A locks mutex1 ✓');
        },
        lesson: 'A が mutex1 を取得。',
      },
      {
        code: '[Thread B] pthread_mutex_lock(&mutex2);',
        apply: (s) => {
          s.threads[1].holds = ['mutex2'];
          s.mutexes[1].owner = 2;
          s.events.push('B locks mutex2 ✓');
        },
        lesson: 'B が mutex2 を取得。',
      },
      {
        code: '[Thread A] if (pthread_mutex_trylock(&mutex2)\n    == EBUSY) {\n    pthread_mutex_unlock(&mutex1);\n    // backoff and retry\n}',
        apply: (s) => {
          s.threads[0].holds = [];
          s.mutexes[0].owner = null;
          s.events.push('A trylock mutex2 → EBUSY');
          s.events.push('A backs off: unlocks mutex1, will retry');
        },
        lesson: 'A が trylock で mutex2 を試みるが EBUSY → デッドロック回避のため mutex1 を解放してバックオフ。trylock はブロックせずに即座に結果を返すので、保持中のロックを解放する機会がある。',
      },
      {
        code: '[Thread A] // retry: lock mutex1, then mutex2',
        apply: (s) => {
          s.threads[0].holds = ['mutex1', 'mutex2'];
          s.mutexes[0].owner = 1;
          s.mutexes[1].owner = 1;
          s.threads[1].holds = [];
          s.events.push('(B finishes and unlocks mutex2)');
          s.events.push('A retries: locks mutex1, then mutex2 ✓');
        },
        lesson: 'B が mutex2 を解放した後、A がリトライして両方取得。trylock + backoff はロック順序が統一できない場合の代替手段。ただしライブロックのリスクがある (互いにバックオフし続ける)。',
      },
    ],
  },
];
