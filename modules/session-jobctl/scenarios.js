/**
 * session-jobctl scenarios — session, process group, job control
 */

export const SCENARIOS = [
  // =========================================================================
  // Login session structure (Figure 9.7)
  // =========================================================================
  {
    label: 'Figure 9.7: ログインセッションの構造',
    figure: '9.7',
    description: 'ログインすると 1 つのセッションが作られ、シェルがセッションリーダーになる。コマンドを実行するたびにプロセスグループが作られる。',
    setup: (state) => { state.createSession('bash'); },
    steps: [
      {
        code: '$ cat file1 | grep pattern',
        apply: (s) => {
          const p2 = s.fork(1, 'cat');
          const p3 = s.fork(1, 'grep');
          s.setpgid(p2, p2);
          s.setpgid(p3, p2); // pipeline = 1 PG
          s.tcsetpgrp(p2);
        },
        lesson: 'シェルが cat | grep パイプラインを実行。cat と grep は同じプロセスグループ (PG) に入る。このPGがフォアグラウンドになり、シェルはバックグラウンドで待つ。^C を押すとこの PG の全プロセスに SIGINT が送られる。',
      },
      {
        code: '// cat | grep が終了',
        apply: (s) => {
          s.exit(2); s.exit(3);
          s.tcsetpgrp(1); // shell back to fg
        },
        lesson: 'パイプラインの全プロセスが終了。シェルが再びフォアグラウンドになり、プロンプトを表示する。',
      },
      {
        code: '$ sleep 100 &',
        apply: (s) => {
          s.reap(2); s.reap(3);
          const p4 = s.fork(1, 'sleep');
          s.setpgid(p4, p4);
          s.exec(p4, 'sleep 100');
          // shell stays in fg (background job)
        },
        lesson: '& 付きでバックグラウンド実行。sleep は自分だけのPGに入るが、フォアグラウンドにはならない。シェルはすぐにプロンプトに戻る。これがジョブ制御の基本。',
      },
      {
        code: '$ vim report.txt',
        apply: (s) => {
          const p5 = s.fork(1, 'vim');
          s.setpgid(p5, p5);
          s.exec(p5, 'vim');
          s.tcsetpgrp(p5);
        },
        lesson: 'vim をフォアグラウンドで実行。vim のPGがフォアグラウンドになる。同時に sleep はバックグラウンドで動き続けている。1 セッション内に複数の PG (ジョブ) が共存。',
      },
    ],
  },

  // =========================================================================
  // Job control: ^Z, bg, fg (Figure 9.11)
  // =========================================================================
  {
    label: 'Figure 9.11: ジョブ制御 (^Z, bg, fg)',
    figure: '9.11',
    description: '^Z (SIGTSTP) でフォアグラウンドジョブを停止し、bg で再開 (バックグラウンド)、fg でフォアグラウンドに戻す。',
    setup: (state) => { state.createSession('bash'); },
    steps: [
      {
        code: '$ find / -name "*.log"',
        apply: (s) => {
          const p = s.fork(1, 'find');
          s.setpgid(p, p);
          s.exec(p, 'find');
          s.tcsetpgrp(p);
        },
        lesson: 'find をフォアグラウンドで実行。時間がかかる処理。',
      },
      {
        code: '^Z  (SIGTSTP)',
        apply: (s) => {
          s.signalForeground('SIGTSTP');
          s.tcsetpgrp(1);
        },
        lesson: '^Z を押すと SIGTSTP がフォアグラウンド PG に送られる。find が STOPPED 状態になる。シェルがフォアグラウンドに戻り「[1]+ Stopped find / -name ...」と表示。',
      },
      {
        code: '$ bg %1',
        apply: (s) => {
          s.resumePG(2, false);
        },
        lesson: 'bg コマンドで SIGCONT を送り、find をバックグラウンドで再開。find は実行を続けるが、端末入力は受け付けない (stdin を読もうとすると SIGTTIN で停止)。',
      },
      {
        code: '$ jobs',
        apply: () => {},
        lesson: 'jobs コマンドでジョブ一覧を表示。[1]+ Running find / -name ... &。シェルは各 PG をジョブ番号で管理している。',
      },
      {
        code: '$ fg %1',
        apply: (s) => {
          s.resumePG(2, true);
        },
        lesson: 'fg コマンドで find をフォアグラウンドに戻す。tcsetpgrp で find の PG をフォアグラウンドに設定し、SIGCONT を送る。',
      },
      {
        code: '^C  (SIGINT)',
        apply: (s) => {
          s.signalForeground('SIGINT');
          s.tcsetpgrp(1);
        },
        lesson: '^C で SIGINT を送信。find が終了 (ZOMBIE)。シェルがフォアグラウンドに戻る。SIGINT はフォアグラウンド PG の全プロセスに届くが、シェルは別 PG なので影響を受けない。',
      },
    ],
  },

  // =========================================================================
  // Pipeline as a single job
  // =========================================================================
  {
    label: 'パイプライン = 1 つのジョブ',
    figure: '9.8',
    description: 'シェルはパイプラインの全プロセスを 1 つのプロセスグループにまとめる。^C で全部止まるのはこのため。',
    setup: (state) => { state.createSession('bash'); },
    steps: [
      {
        code: '$ cat /var/log/syslog | grep error | wc -l',
        apply: (s) => {
          const p2 = s.fork(1, 'cat');
          const p3 = s.fork(1, 'grep');
          const p4 = s.fork(1, 'wc');
          s.setpgid(p2, p2);
          s.setpgid(p3, p2);
          s.setpgid(p4, p2);
          s.exec(p2, 'cat');
          s.exec(p3, 'grep');
          s.exec(p4, 'wc');
          s.tcsetpgrp(p2);
        },
        lesson: '3 つのプロセス (cat, grep, wc) が同じ PG に入る。PG リーダーは最初のプロセス (cat)。シェルは setpgid で各プロセスのPGを統一する。',
      },
      {
        code: '^C  (SIGINT → PG 全体)',
        apply: (s) => {
          s.signalForeground('SIGINT');
          s.tcsetpgrp(1);
        },
        lesson: '^C を押すと SIGINT がフォアグラウンド PG の全プロセス (cat, grep, wc) に届く。3 つとも終了。これが「パイプラインが 1 つのジョブ」である理由 — PG 単位でシグナルが配送されるから。',
      },
    ],
  },
];
