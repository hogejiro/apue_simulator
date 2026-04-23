/**
 * fork-exec scenarios — process lifecycle visualizations
 */

import { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC } from '../../core/kernel-state.js';

export const SCENARIOS = [
  // =========================================================================
  // Basic fork + exit + wait
  // =========================================================================
  {
    label: 'Figure 8.1: fork の基本',
    figure: '8.1',
    description: 'fork() は呼び出しプロセスのコピーを作る。親には子の PID が返り、子には 0 が返る。',
    setup: (state) => {
      const pid = state.createProcess('shell');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'fork() でプロセスの完全なコピーが作られる。子は親と同じプログラム (/bin/sh) を実行し、同じ fd テーブルを持つ。ファイルテーブルエントリは共有 (refcount+1)。fork の戻り値だけが異なる: 親には子の PID、子には 0。',
      },
      {
        code: '[child] exit(0);',
        apply: (state, pid) => {
          state.exit(pid + 1, 0);
        },
        lesson: '子プロセスが exit(0) で終了。全 fd が close され、状態が ZOMBIE になる。プロセステーブルのエントリは残る — 親が wait するまで終了状態を保持する必要があるため。',
      },
      {
        code: '[parent] waitpid(childPid, &status, 0);',
        apply: (state, pid) => {
          state.waitpid(pid, pid + 1);
        },
        lesson: 'waitpid() で親がゾンビ子プロセスを回収。子のプロセステーブルエントリが削除される。これで子のリソースが完全に解放された。wait しないとゾンビが残り続ける。',
      },
    ],
  },

  // =========================================================================
  // fork + exec (Figure 8.15 パターン)
  // =========================================================================
  {
    label: 'Figure 8.15: fork + exec パターン',
    figure: '8.15',
    description: 'UNIX でプログラムを実行する標準パターン: fork で子を作り、子で exec して別のプログラムに置き換える。シェルがコマンドを実行する仕組みそのもの。',
    setup: (state) => {
      const pid = state.createProcess('shell');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'シェルが fork。子プロセスも /bin/sh を実行中。fd テーブルは親と共有。',
      },
      {
        code: '[child] execvp("cat", argv);',
        apply: (state, pid) => {
          state.exec(pid + 1, '/bin/cat');
        },
        lesson: 'exec() は子のプロセスイメージを /bin/cat に置き換える。PID は変わらない。fd テーブルも保持される (close-on-exec フラグが立っていない限り)。text/data/heap/stack は新しいプログラムのもので上書きされる。',
      },
      {
        code: '[child] exit(0);',
        apply: (state, pid) => {
          state.exit(pid + 1, 0);
        },
        lesson: 'cat が終了。ZOMBIE 状態になり、親 (シェル) の wait を待つ。',
      },
      {
        code: '[parent] waitpid(pid, &status, 0);',
        apply: (state, pid) => {
          state.waitpid(pid, pid + 1);
        },
        lesson: 'シェルが waitpid で子を回収。status から終了コードを取得できる。シェルはプロンプトを再表示して次のコマンドを待つ。これが「シェルがコマンドを実行する」仕組みの全体像。',
      },
    ],
  },

  // =========================================================================
  // fork + exec with I/O redirection
  // =========================================================================
  {
    label: 'シェルの I/O リダイレクション: cat < in > out',
    figure: '8.2, 3.8',
    description: 'シェルが cat < input.txt > output.txt を実行する手順: fork → 子で stdin/stdout をリダイレクト → exec。リダイレクションは exec の前に行う (exec は fd テーブルを引き継ぐため)。',
    setup: (state) => {
      const pid = state.createProcess('shell');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'シェルが fork。子もシェルと同じ fd 0,1,2 を持つ。',
      },
      {
        code: '[child] int fd_in = open("input.txt", O_RDONLY);',
        apply: (state, pid) => {
          state.open(pid + 1, 'input.txt', O_RDONLY);
        },
        lesson: '子プロセスで input.txt を open。fd 3 が割り当てられる。',
      },
      {
        code: '[child] dup2(fd_in, STDIN_FILENO);',
        apply: (state, pid) => {
          state.dup2(pid + 1, 3, 0);
        },
        lesson: 'dup2(3, 0) で stdin を input.txt にリダイレクト。fd 0 が /dev/tty ではなく input.txt を指すようになる。',
      },
      {
        code: '[child] close(fd_in);',
        apply: (state, pid) => {
          state.close(pid + 1, 3);
        },
        lesson: 'fd 3 はもう不要なので close。fd 0 (stdin) だけが input.txt を指す。',
      },
      {
        code: '[child] int fd_out = open("output.txt",\n        O_WRONLY | O_CREAT | O_TRUNC);',
        apply: (state, pid) => {
          state.open(pid + 1, 'output.txt', O_WRONLY | O_CREAT | O_TRUNC);
        },
        lesson: 'output.txt を open。fd 3 が再利用される (先ほど close したため)。',
      },
      {
        code: '[child] dup2(fd_out, STDOUT_FILENO);',
        apply: (state, pid) => {
          state.dup2(pid + 1, 3, 1);
        },
        lesson: 'dup2(3, 1) で stdout を output.txt にリダイレクト。',
      },
      {
        code: '[child] close(fd_out);',
        apply: (state, pid) => {
          state.close(pid + 1, 3);
        },
        lesson: 'fd 3 を close。これで子の fd 0=input.txt, fd 1=output.txt, fd 2=/dev/tty。リダイレクション完了。',
      },
      {
        code: '[child] execvp("cat", argv);',
        apply: (state, pid) => {
          state.exec(pid + 1, '/bin/cat');
        },
        lesson: 'exec で cat を実行。cat は fd 0 (stdin=input.txt) から読み、fd 1 (stdout=output.txt) に書く。cat 自身はリダイレクションを知らない — fd テーブルが exec で引き継がれることで「透過的に」動く。これが UNIX のリダイレクションの美しさ。',
      },
    ],
  },

  // =========================================================================
  // Pipeline: cmd1 | cmd2
  // =========================================================================
  {
    label: 'パイプライン: ls | wc -l',
    figure: '15.2',
    description: 'シェルが ls | wc -l を実行する手順: pipe → fork(子1) → fork(子2) → 子1 で stdout=pipe write, exec ls → 子2 で stdin=pipe read, exec wc。',
    setup: (state) => {
      const pid = state.createProcess('shell');
      state.processes.get(pid).program = '/bin/sh';
      return pid;
    },
    steps: [
      {
        code: 'int pipefd[2];\npipe(pipefd);',
        apply: (state, pid) => { state.pipe(pid); },
        lesson: 'シェルがパイプを作成。fd 3 (read end) と fd 4 (write end)。',
      },
      {
        code: 'pid_t pid1 = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: '子プロセス 1 を fork。パイプの fd 3,4 も子にコピーされる。',
      },
      {
        code: '[child1] dup2(pipefd[1], STDOUT_FILENO);',
        apply: (state, pid) => {
          state.dup2(pid + 1, 4, 1);
        },
        lesson: '子 1 の stdout をパイプの write end にリダイレクト。',
      },
      {
        code: '[child1] close(pipefd[0]); close(pipefd[1]);',
        apply: (state, pid) => {
          state.close(pid + 1, 3);
          state.close(pid + 1, 4);
        },
        lesson: '子 1 はパイプの元の fd 3,4 を close。stdout (fd 1) だけがパイプ write end を指す。',
      },
      {
        code: '[child1] execvp("ls", argv);',
        apply: (state, pid) => {
          state.exec(pid + 1, '/bin/ls');
        },
        lesson: '子 1 で ls を exec。ls の出力はパイプに流れる。',
      },
      {
        code: 'pid_t pid2 = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'シェルから子プロセス 2 を fork。シェルはまだ fd 3,4 (パイプ) を持っている。',
      },
      {
        code: '[child2] dup2(pipefd[0], STDIN_FILENO);',
        apply: (state, pid) => {
          state.dup2(pid + 2, 3, 0);
        },
        lesson: '子 2 の stdin をパイプの read end にリダイレクト。',
      },
      {
        code: '[child2] close(pipefd[0]); close(pipefd[1]);',
        apply: (state, pid) => {
          state.close(pid + 2, 3);
          state.close(pid + 2, 4);
        },
        lesson: '子 2 もパイプの元の fd を close。stdin (fd 0) だけがパイプ read end を指す。',
      },
      {
        code: '[child2] execvp("wc", argv);',
        apply: (state, pid) => {
          state.exec(pid + 2, '/usr/bin/wc');
        },
        lesson: '子 2 で wc を exec。wc は stdin (パイプ) から読む。',
      },
      {
        code: '[shell] close(pipefd[0]); close(pipefd[1]);',
        apply: (state, pid) => {
          state.close(pid, 3);
          state.close(pid, 4);
        },
        lesson: 'シェルもパイプの fd を close。これが重要 — シェルが write end を持ったままだと、wc が EOF を受け取れない。全ての writer が close して初めてパイプの reader に EOF が届く。',
      },
    ],
  },
];
