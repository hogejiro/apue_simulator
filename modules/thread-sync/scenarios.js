/**
 * thread-sync scenarios — mutex, condvar, rwlock
 */

export const SCENARIOS = [
  // =========================================================================
  // Mutex: basic lock contention (Figure 11.10)
  // =========================================================================
  {
    label: 'Figure 11.10: mutex ロック競合',
    figure: '11.10',
    description: '2 つのスレッドが同じ mutex をロックしようとすると、一方がブロックされる。unlock すると待っていたスレッドが起床して mutex を取得する。',
    setup: (ts) => {
      ts.addThread('main');
      ts.addThread('worker');
      ts.addMutex('counter_lock');
    },
    steps: [
      {
        code: '[main] pthread_mutex_lock(&counter_lock);',
        apply: (ts) => { ts.mutexLock(1, 'counter_lock'); },
        lesson: 'main スレッドが counter_lock を取得。mutex は「1 つのスレッドだけが保持できる」排他ロック。',
      },
      {
        code: '[worker] pthread_mutex_lock(&counter_lock);',
        apply: (ts) => { ts.mutexLock(2, 'counter_lock'); },
        lesson: 'worker が同じ mutex をロックしようとするが、main が保持中 → BLOCKED。worker はスリープし、CPU を消費しない (スピンロックとの違い)。',
      },
      {
        code: '[main] counter++;\n[main] pthread_mutex_unlock(&counter_lock);',
        apply: (ts) => { ts.mutexUnlock(1, 'counter_lock'); },
        lesson: 'main が unlock。カーネルが wait queue から worker を起床 → worker が mutex を取得して RUNNING に。FIFO 順序で公平にロックが渡される。',
      },
      {
        code: '[worker] counter++;\n[worker] pthread_mutex_unlock(&counter_lock);',
        apply: (ts) => { ts.mutexUnlock(2, 'counter_lock'); },
        lesson: 'worker も操作完了して unlock。mutex は誰も持っていない状態に戻る。mutex なしだと counter++ が race condition を起こす (Figure 11.9)。',
      },
    ],
  },

  // =========================================================================
  // Condvar: producer-consumer (Figure 11.15)
  // =========================================================================
  {
    label: 'Figure 11.15: condvar (生産者-消費者)',
    figure: '11.15',
    description: '条件変数 (condvar) は「条件が成立するまで待つ」を race-free に実現する。mutex と組み合わせて使う。cond_wait は mutex を解放してスリープし、signal で起床して mutex を再取得する。',
    setup: (ts) => {
      ts.addThread('consumer');
      ts.addThread('producer');
      ts.addMutex('queue_lock');
      ts.addCondVar('queue_not_empty');
    },
    steps: [
      {
        code: '[consumer] pthread_mutex_lock(&queue_lock);',
        apply: (ts) => { ts.mutexLock(1, 'queue_lock'); },
        lesson: 'consumer がキューの mutex を取得。',
      },
      {
        code: '[consumer] while (queue_empty)\n    pthread_cond_wait(&cv, &queue_lock);',
        apply: (ts) => { ts.condWait(1, 'queue_not_empty', 'queue_lock'); },
        lesson: 'キューが空なので cond_wait。アトミックに mutex を解放 + condvar で待ち。while ループで条件チェックするのは spurious wakeup 対策 — signal されても条件が成立していない場合がある。',
      },
      {
        code: '[producer] pthread_mutex_lock(&queue_lock);',
        apply: (ts) => { ts.mutexLock(2, 'queue_lock'); },
        lesson: 'producer が mutex を取得 (consumer が cond_wait で解放したので取得可能)。',
      },
      {
        code: '[producer] enqueue(item);\n[producer] pthread_cond_signal(&cv);',
        apply: (ts) => { ts.condSignal(2, 'queue_not_empty', 'queue_lock'); },
        lesson: 'アイテムをキューに追加し、cond_signal で consumer を起床。consumer は mutex の再取得を待つ。',
      },
      {
        code: '[producer] pthread_mutex_unlock(&queue_lock);',
        apply: (ts) => { ts.mutexUnlock(2, 'queue_lock'); },
        lesson: 'producer が unlock → consumer が mutex を再取得して RUNNING に。while ループで条件を再チェックし、今度はキューが空でないので wait を抜ける。',
      },
    ],
  },

  // =========================================================================
  // Reader-Writer Lock (Figure 11.14)
  // =========================================================================
  {
    label: 'Figure 11.14: reader-writer lock',
    figure: '11.14',
    description: '読み取りが多く書き込みが少ないデータに最適。複数の reader が同時にロック可能だが、writer は排他。reader が持っている間は writer は待ち、writer が持っている間は reader も待つ。',
    setup: (ts) => {
      ts.addThread('reader1');
      ts.addThread('reader2');
      ts.addThread('writer');
      ts.addRWLock('data_lock');
    },
    steps: [
      {
        code: '[reader1] pthread_rwlock_rdlock(&data_lock);',
        apply: (ts) => { ts.rwlockRdlock(1, 'data_lock'); },
        lesson: 'reader1 が read lock を取得。共有ロックなので他の reader も同時に取得可能。',
      },
      {
        code: '[reader2] pthread_rwlock_rdlock(&data_lock);',
        apply: (ts) => { ts.rwlockRdlock(2, 'data_lock'); },
        lesson: 'reader2 も read lock を取得。2 つの reader が同時にデータを読める。mutex だとこれは不可能 (1 つずつ順番)。',
      },
      {
        code: '[writer] pthread_rwlock_wrlock(&data_lock);',
        apply: (ts) => { ts.rwlockWrlock(3, 'data_lock'); },
        lesson: 'writer が write lock を要求するが、reader が 2 つ保持中 → BLOCKED。write lock は排他的 — 全ての reader が解放するまで待つ。',
      },
      {
        code: '[reader1] pthread_rwlock_unlock(&data_lock);',
        apply: (ts) => { ts.rwlockUnlock(1, 'data_lock'); },
        lesson: 'reader1 が解放。まだ reader2 が保持中なので writer は待ち続ける。',
      },
      {
        code: '[reader2] pthread_rwlock_unlock(&data_lock);',
        apply: (ts) => { ts.rwlockUnlock(2, 'data_lock'); },
        lesson: '最後の reader が解放 → writer が起床して write lock を取得。データの書き換えが安全にできる。',
      },
      {
        code: '[writer] // modify data\n[writer] pthread_rwlock_unlock(&data_lock);',
        apply: (ts) => { ts.rwlockUnlock(3, 'data_lock'); },
        lesson: 'writer がデータ更新後に unlock。rwlock は「読み取りが多い」ワークロードで mutex より高い並行性を提供する。',
      },
    ],
  },
];
