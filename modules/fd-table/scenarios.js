/**
 * fd-table scenarios — preset C code snippets mapped to kernel state mutations.
 * Each scenario corresponds to a Figure in APUE.
 */

import { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } from '../../core/kernel-state.js';

export const SCENARIOS = [
  // =========================================================================
  // Figure 3.7/3.8: open + dup
  // =========================================================================
  {
    label: 'Figure 3.7-3.8: open & dup',
    figure: '3.7, 3.8',
    description: 'open() で新しい fd が割り当てられ、3 層構造 (fd table → file table → vnode) が構築される。dup() は fd テーブルのエントリを複製し、同じファイルテーブルエントリを共有する。',
    setup: (state) => state.createProcess('shell'),
    steps: [
      {
        code: 'int fd = open("/etc/passwd", O_RDONLY);',
        apply: (state, pid) => { state.open(pid, '/etc/passwd', O_RDONLY); },
        lesson: 'open() は 3 つのことを行う: (1) vnode を探す/作る、(2) ファイルテーブルエントリを作る (offset=0, refcount=1)、(3) プロセスの fd テーブルで最小の空き番号 (=3) を割り当てる。',
      },
      {
        code: 'int fd2 = dup(fd);  // fd2 = 4',
        apply: (state, pid) => { state.dup(pid, 3); },
        lesson: 'dup() は新しい fd (=4) を割り当てるが、同じファイルテーブルエントリを指す。refcount が 1→2 に増加。fd 3 と fd 4 はオフセットを共有する — 片方で read すると、もう片方のオフセットも進む。',
      },
      {
        code: 'close(fd);  // fd 3 を閉じる',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: 'close() は fd テーブルからエントリを削除し、ファイルテーブルの refcount を 2→1 に減らす。fd 4 はまだ有効。refcount が 0 になるまでファイルテーブルエントリは解放されない。',
      },
    ],
  },

  // =========================================================================
  // Figure 3.9: 2 processes open same file independently
  // =========================================================================
  {
    label: 'Figure 3.9: 2 プロセスが同じファイルを独立に open',
    figure: '3.9',
    description: '2 つのプロセスが同じファイルを独立に open すると、別々のファイルテーブルエントリ (別々のオフセット) を持つが、同じ vnode を共有する。',
    setup: (state) => {
      const pid1 = state.createProcess('process A');
      state.createProcess('process B');
      return pid1;
    },
    steps: [
      {
        code: '[Process A] int fd = open("/data/log", O_RDWR);',
        apply: (state, pid) => { state.open(1, '/data/log', O_RDWR); },
        lesson: 'Process A が /data/log を open。ファイルテーブルエントリが作られ、offset=0 で始まる。',
      },
      {
        code: '[Process B] int fd = open("/data/log", O_RDWR);',
        apply: (state, pid) => { state.open(2, '/data/log', O_RDWR); },
        lesson: 'Process B も同じファイルを open。新しいファイルテーブルエントリ (offset=0) が作られるが、vnode は Process A と同じものを共有。各プロセスは独立したオフセットを持つ。',
      },
      {
        code: '[Process A] write(fd, buf, 100);',
        apply: (state, pid) => { state.write(1, 3, 100); },
        lesson: 'Process A が 100 バイト書き込み。A のオフセットは 100 に進むが、B のオフセットは 0 のまま。ファイルテーブルエントリが別々なので、互いのオフセットに影響しない。',
      },
    ],
  },

  // =========================================================================
  // Figure 8.2: fork — shared file table entries
  // =========================================================================
  {
    label: 'Figure 8.2: fork 後の fd 共有',
    figure: '8.2',
    description: 'fork() は子プロセスの fd テーブルを親からコピーするが、ファイルテーブルエントリは共有する (refcount が増加)。親子はオフセットを共有するので、一方の write がもう一方に影響する。',
    setup: (state) => state.createProcess('parent'),
    steps: [
      {
        code: 'int fd = open("/tmp/data", O_RDWR);',
        apply: (state, pid) => { state.open(pid, '/tmp/data', O_RDWR); },
        lesson: 'open() で fd 3 が /tmp/data を指す。ファイルテーブルエントリの refcount=1。',
      },
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'fork() で子プロセスが作られる。子の fd テーブルは親のコピー — fd 0,1,2,3 が同じファイルテーブルエントリを指す。全エントリの refcount が +1。これが Figure 8.2 の核心: fd テーブルはコピーされるが、ファイルテーブルエントリは共有。',
      },
      {
        code: '[parent] write(fd, buf, 50);',
        apply: (state, pid) => { state.write(pid, 3, 50); },
        lesson: '親が 50 バイト書き込み → オフセットが 0→50 に。子も同じファイルテーブルエントリを共有しているので、子が read/write するときはオフセット 50 から始まる。',
      },
      {
        code: '[child] write(fd, buf, 30);',
        apply: (state, pid) => {
          // child pid is pid+1 (second process created)
          const childPid = pid + 1;
          state.write(childPid, 3, 30);
        },
        lesson: '子が 30 バイト書き込み → 共有オフセットが 50→80 に進む。親が次に write すると 80 から書き込まれる。これが「fork 後にファイルオフセットが共有される」という APUE の重要ポイント。',
      },
    ],
  },

  // =========================================================================
  // Shell redirection: cmd > file
  // =========================================================================
  {
    label: 'シェルリダイレクション: cmd > file',
    figure: '3.8',
    description: 'シェルが stdout をファイルにリダイレクトする手順: open → dup2 → close。dup2 は「fd 1 (stdout) の向き先を変える」操作。',
    setup: (state) => state.createProcess('shell'),
    steps: [
      {
        code: 'int fd = open("output.txt",\n    O_WRONLY | O_CREAT | O_TRUNC);',
        apply: (state, pid) => { state.open(pid, 'output.txt', O_WRONLY | O_CREAT | O_TRUNC); },
        lesson: 'ファイルを open。fd 3 が割り当てられる。この時点では stdout (fd 1) はまだ /dev/tty を指している。',
      },
      {
        code: 'dup2(fd, STDOUT_FILENO);  // dup2(3, 1)',
        apply: (state, pid) => { state.dup2(pid, 3, 1); },
        lesson: 'dup2(3, 1) は fd 1 を閉じてから fd 3 と同じファイルテーブルエントリを指すようにする。これで stdout が output.txt に向く。refcount は 2 (fd 1 と fd 3 が同じエントリを指す)。',
      },
      {
        code: 'close(fd);  // close(3)',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: 'fd 3 を閉じる。refcount 2→1。fd 1 (stdout) だけが output.txt を指す。これ以降の printf/write(1,...) は全て output.txt に書かれる。',
      },
    ],
  },

  // =========================================================================
  // Pipe: parent → child
  // =========================================================================
  {
    label: 'Figure 15.2: パイプ (親→子)',
    figure: '15.2',
    description: 'pipe() でパイプを作り、fork() で子プロセスにコピー。親が write end を使い、子が read end を使う。不要な端を close するのが重要。',
    setup: (state) => state.createProcess('parent'),
    steps: [
      {
        code: 'int pipefd[2];\npipe(pipefd);  // pipefd[0]=read, [1]=write',
        apply: (state, pid) => { state.pipe(pid); },
        lesson: 'pipe() で 2 つの fd が作られる: fd 3 (read end) と fd 4 (write end)。両方とも同じパイプ vnode (FIFO) を指すが、ファイルテーブルエントリは別々 (片方 O_RDONLY、片方 O_WRONLY)。',
      },
      {
        code: 'pid_t pid = fork();',
        apply: (state, pid) => { state.fork(pid); },
        lesson: 'fork() で子プロセスが作られる。子も fd 3 (read) と fd 4 (write) を持つ。各ファイルテーブルエントリの refcount が 2 に。親子両方がパイプの両端を持っている状態。',
      },
      {
        code: '[parent] close(pipefd[0]);',
        apply: (state, pid) => { state.close(pid, 3); },
        lesson: '親は read end を使わないので close。read end の refcount 2→1。親は write end (fd 4) だけを持つ。',
      },
      {
        code: '[child] close(pipefd[1]);',
        apply: (state, pid) => {
          const childPid = pid + 1;
          state.close(childPid, 4);
        },
        lesson: '子は write end を使わないので close。write end の refcount 2→1。子は read end (fd 3) だけを持つ。これで「親→子」の片方向パイプが完成。親が write(4,...) すると、子が read(3,...) で受け取れる。',
      },
    ],
  },
];
