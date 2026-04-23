/**
 * signal-delivery scenarios — signal mask / pending / handler state transitions
 */

import { SIG_DFL, SIG_IGN } from '../../core/signal-state.js';

export const SCENARIOS = [
  // =========================================================================
  // Basic: sigaction + kill
  // =========================================================================
  {
    label: 'シグナルハンドラの基本',
    figure: '10.14',
    description: 'sigaction でハンドラを設定し、シグナルを受信すると、デフォルト動作の代わりにハンドラが呼ばれる。',
    steps: [
      {
        code: 'sigaction(SIGINT, &act);  // handler = catch_int',
        apply: (ss) => { ss.sigaction('SIGINT', 'catch_int'); },
        lesson: 'SIGINT の disposition を SIG_DFL から catch_int ハンドラに変更。これ以降 ^C を押しても「終了」ではなく catch_int() が呼ばれる。',
      },
      {
        code: 'sigaction(SIGTERM, &act);  // handler = catch_term',
        apply: (ss) => { ss.sigaction('SIGTERM', 'catch_term'); },
        lesson: 'SIGTERM にもハンドラを設定。kill コマンドのデフォルトシグナルを捕捉できる。',
      },
      {
        code: '// SIGINT received (Ctrl+C)',
        apply: (ss) => { ss.kill('SIGINT'); },
        lesson: 'SIGINT が到着。マスクされていないので即座に配送 → catch_int() が呼ばれる。プロセスは終了しない。',
      },
      {
        code: '// SIGQUIT received (Ctrl+\\)',
        apply: (ss) => { ss.kill('SIGQUIT'); },
        lesson: 'SIGQUIT は disposition が SIG_DFL のまま。デフォルト動作は core dump → プロセス終了。ハンドラを設定していないシグナルは依然として致命的。',
      },
    ],
  },

  // =========================================================================
  // Block + Pending + Unblock
  // =========================================================================
  {
    label: 'Figure 10.19-10.20: mask と pending',
    figure: '10.19',
    description: 'sigprocmask でシグナルをブロックすると、送信されたシグナルは pending に溜まる。unblock すると pending から配送される。',
    steps: [
      {
        code: 'sigaction(SIGINT, &act);  // handler = catch_int',
        apply: (ss) => { ss.sigaction('SIGINT', 'catch_int'); },
        lesson: 'まずハンドラを設定。',
      },
      {
        code: 'sigprocmask(SIG_BLOCK, &set);  // block SIGINT',
        apply: (ss) => { ss.block(['SIGINT']); },
        lesson: 'SIGINT をマスク (ブロック)。以降 SIGINT は配送されず pending に溜まる。クリティカルセクションの保護に使う。',
      },
      {
        code: '// === critical section ===\n// SIGINT received during critical section',
        apply: (ss) => { ss.kill('SIGINT'); },
        lesson: 'SIGINT が到着するがブロック中 → pending に追加。ハンドラは呼ばれない。クリティカルセクションのコードは中断されずに完了できる。',
      },
      {
        code: '// another SIGINT received',
        apply: (ss) => { ss.kill('SIGINT'); },
        lesson: '2 回目の SIGINT。しかし通常シグナルは pending で合体する (1 つにまとまる)。pending セットのサイズは変わらない。これが「通常シグナルは信頼性がない」と言われる理由。',
      },
      {
        code: 'sigprocmask(SIG_UNBLOCK, &set);  // unblock SIGINT',
        apply: (ss) => { ss.unblock(['SIGINT']); },
        lesson: 'SIGINT を unblock。pending にあった SIGINT が即座に配送 → catch_int() が呼ばれる。2 回送ったが、ハンドラは 1 回だけ呼ばれる (通常シグナルの合体)。',
      },
    ],
  },

  // =========================================================================
  // SIG_IGN
  // =========================================================================
  {
    label: 'SIG_IGN: シグナルの無視',
    figure: '10.14',
    description: 'SIG_IGN に設定すると、シグナルは完全に無視される (pending にも溜まらない)。SIGKILL と SIGSTOP は無視できない。',
    steps: [
      {
        code: 'sigaction(SIGINT, SIG_IGN);',
        apply: (ss) => { ss.sigaction('SIGINT', SIG_IGN); },
        lesson: 'SIGINT を SIG_IGN に設定。^C を押してもシグナルは捨てられる。',
      },
      {
        code: '// SIGINT received → ignored',
        apply: (ss) => { ss.kill('SIGINT'); },
        lesson: 'SIGINT が送られるが SIG_IGN なので完全に無視。pending にも入らない。',
      },
      {
        code: '// SIGKILL received → cannot be ignored',
        apply: (ss) => { ss.kill('SIGKILL'); },
        lesson: 'SIGKILL は SIG_IGN にできない。常にデフォルト動作 (terminate) で配送される。これが kill -9 が「最後の手段」である理由。SIGSTOP も同様に捕捉/無視不可。',
      },
    ],
  },

  // =========================================================================
  // Critical section protection pattern (Figure 10.22)
  // =========================================================================
  {
    label: 'Figure 10.22: クリティカルセクション保護',
    figure: '10.22',
    description: 'クリティカルセクションの前に sigprocmask で SIGINT をブロックし、完了後に元のマスクを復元する。これにより、データ構造の操作中にシグナルハンドラが呼ばれて不整合が生じることを防ぐ。',
    steps: [
      {
        code: 'sigaction(SIGINT, &act);  // handler = update_display',
        apply: (ss) => { ss.sigaction('SIGINT', 'update_display'); },
        lesson: 'SIGINT のハンドラを設定。このハンドラはグローバルなデータ構造を読む。',
      },
      {
        code: 'sigaction(SIGALRM, &act);  // handler = tick',
        apply: (ss) => { ss.sigaction('SIGALRM', 'tick'); },
        lesson: 'SIGALRM のハンドラも設定。',
      },
      {
        code: '// save old mask\nsigprocmask(SIG_BLOCK, {SIGINT, SIGALRM});',
        apply: (ss) => { ss.block(['SIGINT', 'SIGALRM']); },
        lesson: 'クリティカルセクション開始。SIGINT と SIGALRM をブロック。両方のハンドラがデータ構造にアクセスするので、操作中は配送を遅延させる。',
      },
      {
        code: '// modify shared data structure\n// SIGINT arrives during modification',
        apply: (ss) => { ss.kill('SIGINT'); },
        lesson: 'データ構造を操作中に SIGINT が到着。ブロック中なので pending に。ハンドラは呼ばれず、データ構造は不整合なく操作できる。',
      },
      {
        code: '// SIGALRM also arrives',
        apply: (ss) => { ss.kill('SIGALRM'); },
        lesson: 'SIGALRM も到着して pending に。2 つのシグナルが溜まっている。',
      },
      {
        code: '// restore old mask\nsigprocmask(SIG_SETMASK, {});  // unblock all',
        apply: (ss) => { ss.setmask([]); },
        lesson: '元のマスク (空) を復元。pending だった SIGINT と SIGALRM が配送される。ハンドラはデータ構造の操作完了後に安全に実行される。配送の順序は不定 (POSIX は順序を保証しない)。',
      },
    ],
  },

  // =========================================================================
  // SIGCHLD handling (Figure 10.26)
  // =========================================================================
  {
    label: 'Figure 10.26: SIGCHLD ハンドラ',
    figure: '10.26',
    description: '子プロセスが終了すると親に SIGCHLD が送られる。ハンドラ内で waitpid をループで呼び、全ゾンビを回収する。',
    steps: [
      {
        code: 'sigaction(SIGCHLD, &act);  // handler = sig_chld',
        apply: (ss) => { ss.sigaction('SIGCHLD', 'sig_chld'); },
        lesson: 'SIGCHLD のハンドラを設定。デフォルトは ignore なので、明示的に設定しないと子の終了を見逃す。',
      },
      {
        code: '// child 1 exits → SIGCHLD',
        apply: (ss) => { ss.kill('SIGCHLD'); },
        lesson: '子プロセスが終了し SIGCHLD が配送 → sig_chld() ハンドラ内で waitpid(-1, ..., WNOHANG) をループで呼び、全ゾンビを回収。',
      },
      {
        code: 'sigprocmask(SIG_BLOCK, {SIGCHLD});',
        apply: (ss) => { ss.block(['SIGCHLD']); },
        lesson: '複数の子を fork する前に SIGCHLD をブロック。fork 中に子が即座に終了しても、ハンドラがまだ存在しない子の waitpid を呼ぶ race condition を防ぐ。',
      },
      {
        code: '// fork children...\n// child 2 exits → SIGCHLD (pending)',
        apply: (ss) => { ss.kill('SIGCHLD'); },
        lesson: '子 2 が終了。SIGCHLD はブロック中なので pending に溜まる。',
      },
      {
        code: '// child 3 also exits → SIGCHLD (coalesces)',
        apply: (ss) => { ss.kill('SIGCHLD'); },
        lesson: '子 3 も終了して SIGCHLD が送られるが、通常シグナルは合体 → pending には 1 つだけ。これが sig_chld ハンドラ内で waitpid を while ループで呼ぶ理由: シグナル 1 回で複数のゾンビを回収する必要がある。',
      },
      {
        code: 'sigprocmask(SIG_UNBLOCK, {SIGCHLD});',
        apply: (ss) => { ss.unblock(['SIGCHLD']); },
        lesson: 'SIGCHLD を unblock。pending の SIGCHLD が 1 回配送 → sig_chld() 内の waitpid ループで子 2 と子 3 の両方を回収。',
      },
    ],
  },
];
