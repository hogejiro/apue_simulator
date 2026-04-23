/**
 * pipe-fifo scenarios — pipe buffer data flow visualization
 */

import { O_RDONLY, O_WRONLY } from '../../core/kernel-state.js';

export const SCENARIOS = [
  // =========================================================================
  // Basic pipe: parent writes, child reads
  // =========================================================================
  {
    label: '基本パイプ: 親が書き子が読む',
    figure: '15.2',
    description: 'pipe() で作ったパイプを fork で共有し、親が write end に書き、子が read end から読む。パイプバッファの中をデータが流れる様子を観察する。',
    setup: (state) => {
      const pid = state.createProcess('parent');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'int pipefd[2];\npipe(pipefd);',
        apply: (state, pid) => { state.pipe(pid); },
        lesson: 'パイプ作成。fd 3 (read end) と fd 4 (write end)。バッファ容量は 4096 バイト。中身は空。',
      },
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'fork で子プロセス作成。パイプの両端が親子で共有される。',
      },
      {
        code: '[parent] close(pipefd[0]);',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: '親は read end を close。親は write 専用。',
      },
      {
        code: '[child] close(pipefd[1]);',
        apply: (state, pid) => { state.close(pid + 1, 4); },
        lesson: '子は write end を close。子は read 専用。片方向パイプ完成。',
      },
      {
        code: '[parent] write(pipefd[1], "Hello", 5);',
        apply: (state, pid) => { state.write(pid, 4, 5, '"Hello"'); },
        lesson: '親が "Hello" (5 バイト) をパイプに書き込み。データがバッファに入る。子はまだ読んでいない。',
      },
      {
        code: '[parent] write(pipefd[1], " World!\\n", 8);',
        apply: (state, pid) => { state.write(pid, 4, 8, '" World!\\n"'); },
        lesson: '2 回目の write。バッファに 2 つのチャンクが溜まる (合計 13 バイト)。',
      },
      {
        code: '[child] n = read(pipefd[0], buf, 1024);',
        apply: (state, pid) => { state.read(pid + 1, 3, 1024); },
        lesson: '子が read。バッファの全データ (13 バイト) を一度に読み取る。バッファは空になる。read は実際に読めたバイト数 (13) を返す。',
      },
    ],
  },

  // =========================================================================
  // Pipe EOF
  // =========================================================================
  {
    label: 'パイプの EOF',
    figure: '15.2',
    description: '全ての writer が write end を close すると、reader は EOF (read が 0 を返す) を受け取る。これがパイプの終了シグナル。',
    setup: (state) => {
      const pid = state.createProcess('writer');
      return pid;
    },
    steps: [
      {
        code: 'pipe(pipefd);\npid_t pid = fork();',
        apply: (state, pid) => {
          state.pipe(pid);
          state.fork(pid);
        },
        lesson: 'パイプ + fork。親子両方が read/write end を持つ。',
      },
      {
        code: '[parent] close(pipefd[0]);',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: '親は read end を close。',
      },
      {
        code: '[child] close(pipefd[1]);',
        apply: (state, pid) => { state.close(pid + 1, 4); },
        lesson: '子は write end を close。',
      },
      {
        code: '[parent] write(pipefd[1], "data", 4);',
        apply: (state, pid) => { state.write(pid, 4, 4, '"data"'); },
        lesson: '親が 4 バイト書き込み。',
      },
      {
        code: '[parent] close(pipefd[1]);',
        apply: (state, pid) => {
          state.close(pid, 4);
          // Mark write end as closed on the vnode
          for (const vn of state.vnodes.values()) {
            if (vn.type === 'FIFO') vn.writeClosed = true;
          }
        },
        lesson: '親が write end を close。これで全ての writer がいなくなった。パイプの write end が「閉じた」状態になる。',
      },
      {
        code: '[child] n = read(pipefd[0], buf, 1024);  // n = 4',
        apply: (state, pid) => { state.read(pid + 1, 3, 1024); },
        lesson: '子が read → バッファにある 4 バイトを読み取る。',
      },
      {
        code: '[child] n = read(pipefd[0], buf, 1024);  // n = 0 (EOF)',
        apply: (state, pid) => { state.read(pid + 1, 3, 1024); },
        lesson: '子が再度 read → バッファは空で、write end も閉じている → 0 を返す (EOF)。これがパイプの「もうデータは来ない」という合図。cat や wc はこの EOF を受け取って終了する。',
      },
    ],
  },

  // =========================================================================
  // SIGPIPE
  // =========================================================================
  {
    label: 'SIGPIPE: 読み手がいないパイプへの書き込み',
    figure: '15.2',
    description: '全ての reader が read end を close した状態で write すると、カーネルが writer に SIGPIPE を送る。デフォルト動作はプロセス終了。',
    setup: (state) => {
      const pid = state.createProcess('writer');
      return pid;
    },
    steps: [
      {
        code: 'pipe(pipefd);\npid_t pid = fork();',
        apply: (state, pid) => {
          state.pipe(pid);
          state.fork(pid);
        },
        lesson: 'パイプ + fork。',
      },
      {
        code: '[parent] close(pipefd[0]);',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: '親は read end を close。親は writer。',
      },
      {
        code: '[child] close(pipefd[1]);',
        apply: (state, pid) => { state.close(pid + 1, 4); },
        lesson: '子は write end を close。子は reader。',
      },
      {
        code: '[child] close(pipefd[0]);',
        apply: (state, pid) => {
          state.close(pid + 1, 3);
          for (const vn of state.vnodes.values()) {
            if (vn.type === 'FIFO') vn.readClosed = true;
          }
        },
        lesson: '子が read end も close。これで全ての reader がいなくなった。パイプの読み手が消えた状態。',
      },
      {
        code: '[parent] write(pipefd[1], "data", 4);  // → SIGPIPE!',
        apply: (state, pid) => { state.write(pid, 4, 4, '"data"'); },
        lesson: '親がパイプに write しようとするが、読み手がいない → SIGPIPE が送られる。デフォルトではプロセスが終了する。これを避けるには SIGPIPE を SIG_IGN するか、ハンドラを設定する (write は EPIPE エラーを返す)。',
      },
    ],
  },

  // =========================================================================
  // 3-stage pipeline data flow
  // =========================================================================
  {
    label: 'パイプラインのデータフロー: ls | grep | wc',
    figure: '15.2',
    description: '3 段パイプラインでデータがどう流れるか。ls の出力 → pipe1 → grep のフィルタ → pipe2 → wc のカウント。',
    setup: (state) => {
      const pid = state.createProcess('shell');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'pipe(pipe1);  // ls → grep\npipe(pipe2);  // grep → wc',
        apply: (state, pid) => {
          state.pipe(pid); // fd 3,4
          state.pipe(pid); // fd 5,6
        },
        lesson: '2 本のパイプを作成。pipe1 (fd 3,4) は ls→grep 間、pipe2 (fd 5,6) は grep→wc 間。',
      },
      {
        code: '// fork 3 children + setup redirections\n// (ls=child1, grep=child2, wc=child3)',
        apply: (state, pid) => {
          // child1 (ls): stdout=pipe1 write
          const c1 = state.fork(pid);
          state.dup2(c1, 4, 1);
          state.close(c1, 3); state.close(c1, 4);
          state.close(c1, 5); state.close(c1, 6);
          state.exec(c1, 'ls');

          // child2 (grep): stdin=pipe1 read, stdout=pipe2 write
          const c2 = state.fork(pid);
          state.dup2(c2, 3, 0);
          state.dup2(c2, 6, 1);
          state.close(c2, 3); state.close(c2, 4);
          state.close(c2, 5); state.close(c2, 6);
          state.exec(c2, 'grep');

          // child3 (wc): stdin=pipe2 read
          const c3 = state.fork(pid);
          state.dup2(c3, 5, 0);
          state.close(c3, 3); state.close(c3, 4);
          state.close(c3, 5); state.close(c3, 6);
          state.exec(c3, 'wc');

          // shell closes all pipe fds
          state.close(pid, 3); state.close(pid, 4);
          state.close(pid, 5); state.close(pid, 6);
        },
        lesson: '3 つの子プロセスを fork し、それぞれ stdin/stdout をパイプにリダイレクト。シェルはパイプの fd を全て close。',
      },
      {
        code: '[ls] writes file listing to stdout (pipe1)',
        apply: (state, pid) => {
          state.write(pid + 1, 1, 120, 'file listing');
        },
        lesson: 'ls がファイル一覧 (120 バイト) を stdout に出力。stdout は pipe1 の write end にリダイレクトされているので、データは pipe1 バッファに入る。',
      },
      {
        code: '[grep] reads from stdin (pipe1), filters',
        apply: (state, pid) => {
          state.read(pid + 2, 0, 4096);
        },
        lesson: 'grep が stdin (pipe1 の read end) から全データを読む。pipe1 のバッファが空になる。grep はマッチする行だけを出力に書く。',
      },
      {
        code: '[grep] writes filtered lines to stdout (pipe2)',
        apply: (state, pid) => {
          state.write(pid + 2, 1, 35, 'filtered lines');
        },
        lesson: 'grep がフィルタ結果 (35 バイト) を stdout (pipe2 の write end) に書き込み。pipe2 バッファにデータが入る。120→35 に減った — grep がフィルタした結果。',
      },
      {
        code: '[wc] reads from stdin (pipe2), counts',
        apply: (state, pid) => {
          state.read(pid + 3, 0, 4096);
        },
        lesson: 'wc が stdin (pipe2 の read end) から読む。pipe2 のバッファが空になる。wc は行数をカウントして結果を stdout (/dev/tty) に出力する。',
      },
    ],
  },
];
