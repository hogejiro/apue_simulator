/**
 * pty-dataflow scenarios — pseudo terminal master/slave data flow
 */

export const SCENARIOS = [
  {
    label: 'Figure 19.1: PTY の基本構造',
    figure: '19.1',
    description: '擬似端末は master/slave のペアで構成される。master に書いたものが slave の入力に、slave に書いたものが master から読める。slave 側に line discipline があるため、パイプと違って端末のように振る舞う。',
    initialState: () => ({
      master: { label: 'PTY Master', fd: 'fd 3', data: '', owner: 'parent process' },
      slave: { label: 'PTY Slave', fd: 'fd 0,1,2', data: '', owner: 'child process', lineDisc: true },
      lineDiscState: { echo: true, canon: true },
      dataFlow: [],
      events: [],
    }),
    steps: [
      {
        code: 'fdm = ptym_open(pts_name);',
        apply: (s) => {
          s.events.push('ptym_open: master fd allocated');
          s.events.push('posix_openpt → grantpt → unlockpt → ptsname');
        },
        lesson: 'PTY master を open。posix_openpt が空いている PTY を見つけ、grantpt で slave のパーミッションを設定、unlockpt でロック解除、ptsname で slave の名前 (例: /dev/pts/5) を取得。',
      },
      {
        code: 'pid = fork();\n[child] setsid();\n[child] fds = ptys_open(pts_name);',
        apply: (s) => {
          s.slave.owner = 'child (new session leader)';
          s.events.push('fork → child calls setsid (new session)');
          s.events.push('child opens slave → becomes controlling terminal');
        },
        lesson: 'fork して子プロセスで setsid (新セッション作成)。slave を open すると制御端末になる。子の stdin/stdout/stderr を slave に dup2。これで子プロセスは「端末に繋がっている」と思って動作する。',
      },
      {
        code: '[child] dup2(fds, 0);\n[child] dup2(fds, 1);\n[child] dup2(fds, 2);\n[child] exec("bash");',
        apply: (s) => {
          s.slave.owner = 'bash (child)';
          s.events.push('child: stdin/stdout/stderr → PTY slave');
          s.events.push('child: exec("bash") — bash thinks it has a terminal');
        },
        lesson: '子の fd 0,1,2 を slave に繋ぎ、bash を exec。bash は isatty(0) が true を返すので、対話モードで動作する (プロンプト表示、ヒストリー、ジョブ制御)。',
      },
      {
        code: '[parent] write(fdm, "ls\\n", 3);',
        apply: (s) => {
          s.master.data = 'ls\\n';
          s.dataFlow.push({ dir: 'master→slave', data: 'ls\\n' });
          s.events.push('parent writes "ls\\n" to master');
          s.events.push('→ appears as keyboard input to bash (via slave)');
          s.events.push('→ line discipline echoes "ls" back to master');
        },
        lesson: 'master に書いたデータが slave の入力になる。bash は stdin から "ls\\n" を受け取り、コマンドとして実行する。line discipline の ECHO が ON なので、入力が master 側にもエコーバックされる。',
      },
      {
        code: '[parent] n = read(fdm, buf, 1024);',
        apply: (s) => {
          s.master.data = '';
          s.slave.data = 'ls\\nfile1.txt\\nfile2.txt\\n';
          s.dataFlow.push({ dir: 'slave→master', data: 'ls\\nfile1.txt\\nfile2.txt\\n' });
          s.events.push('parent reads from master:');
          s.events.push('  "ls\\n" (echo) + "file1.txt\\nfile2.txt\\n" (ls output)');
        },
        lesson: 'master から read すると、slave 側の出力が読める。ここには (1) echo された入力 "ls\\n" と (2) bash/ls の出力 "file1.txt\\nfile2.txt\\n" の両方が含まれる。script(1) はこのデータを typescript ファイルに記録する。',
      },
    ],
  },
  {
    label: 'Figure 19.5: script プログラム',
    figure: '19.5',
    description: 'script(1) は PTY を使って端末セッションを記録する。ユーザーの入力とプログラムの出力が全て PTY master を通るので、typescript ファイルにコピーできる。',
    initialState: () => ({
      master: { label: 'PTY Master', fd: 'fdm', data: '', owner: 'script process' },
      slave: { label: 'PTY Slave', fd: 'fd 0,1,2', data: '', owner: 'shell', lineDisc: true },
      lineDiscState: { echo: true, canon: true },
      dataFlow: [],
      events: [],
      typescript: '',
    }),
    steps: [
      {
        code: '#!/bin/sh\npty "${SHELL:-/bin/sh}" | tee typescript',
        apply: (s) => {
          s.events.push('script starts: pty fork → shell on slave');
          s.events.push('pty output piped to tee → typescript file + stdout');
        },
        lesson: 'script の実装は驚くほどシンプル: pty プログラムでシェルを PTY 上で実行し、出力を tee で typescript ファイルに記録。pty の stdout がパイプで tee に繋がる。',
      },
      {
        code: '// user types "date"',
        apply: (s) => {
          s.dataFlow.push({ dir: 'terminal→master→slave', data: '"date\\n"' });
          s.events.push('user types "date" → terminal → pty master → slave (bash)');
          s.events.push('echo: "date" appears on screen + in typescript');
        },
        lesson: 'ユーザーの入力はまず実際の端末の line discipline を通り、pty の master に渡される。master から slave (bash) に流れる。echo により入力が master に戻り、tee 経由で typescript に記録される。',
      },
      {
        code: '// bash executes "date"',
        apply: (s) => {
          s.dataFlow.push({ dir: 'slave→master→tee', data: '"Thu Apr 17 10:30:00 JST 2026\\n"' });
          s.typescript = 'date\\nThu Apr 17 10:30:00 JST 2026\\n';
          s.events.push('bash output → slave → master → tee → typescript + stdout');
        },
        lesson: 'date の出力は slave (bash の stdout) に書かれ、line discipline を通って master に到達。pty プロセスが master から読んで stdout (パイプ) に書く → tee が typescript ファイルと画面の両方に出力。',
      },
    ],
  },
  {
    label: 'Figure 19.6: コプロセスのバッファリング問題解決',
    figure: '19.6',
    description: '15 章のコプロセスで起きた stdio バッファリング問題 (パイプ経由だと fully buffered) を PTY で解決する。PTY を間に挟むと stdio が line buffered になる。',
    initialState: () => ({
      master: { label: 'PTY Master', fd: 'pipe to pty', data: '', owner: 'driving program' },
      slave: { label: 'PTY Slave', fd: 'fd 0,1', data: '', owner: 'coprocess (add2)', lineDisc: true },
      lineDiscState: { echo: false, canon: true },
      dataFlow: [],
      events: [],
    }),
    steps: [
      {
        code: '// Problem: pipe to coprocess\n// stdio is fully buffered → deadlock',
        apply: (s) => {
          s.events.push('Problem: coprocess uses stdio (fgets/printf)');
          s.events.push('pipe → isatty()=false → fully buffered');
          s.events.push('coprocess buffers output → parent waits → deadlock');
        },
        lesson: '15 章の Figure 15.19 で遭遇した問題: パイプ経由で coprocess と通信すると、coprocess の stdout が fully buffered になる (isatty()=false)。printf の出力が 4KB バッファに溜まったまま flush されず、親が read でブロック → デッドロック。',
      },
      {
        code: '// Solution: interpose a PTY\nexecl("./pty", "pty", "-e", "add2", NULL);',
        apply: (s) => {
          s.events.push('Solution: run coprocess under pty');
          s.events.push('pty -e: echo off (prevent double echo)');
          s.events.push('coprocess sees PTY slave as terminal');
        },
        lesson: 'exec で coprocess を直接起動する代わりに pty プログラム経由で起動。-e でエコー OFF (二重エコー防止)。coprocess の stdin/stdout は PTY slave に接続される → isatty()=true → stdio が line buffered に。',
      },
      {
        code: '[parent] write(pipe, "1 2\\n", 4);',
        apply: (s) => {
          s.dataFlow.push({ dir: 'parent→pipe→pty→slave', data: '"1 2\\n"' });
          s.events.push('parent writes "1 2\\n" → pipe → pty master → slave');
          s.events.push('coprocess reads from stdin (PTY slave)');
        },
        lesson: '親がパイプに書く → pty が master に転送 → slave 経由で coprocess の stdin に届く。',
      },
      {
        code: '[coprocess] printf("%d\\n", 1+2);\n// line buffered → flushed at \\n!',
        apply: (s) => {
          s.dataFlow.push({ dir: 'slave→master→pipe→parent', data: '"3\\n"' });
          s.events.push('coprocess printf → line buffered → flush at \\n');
          s.events.push('output: slave → master → pipe → parent');
          s.events.push('parent read succeeds! No deadlock.');
        },
        lesson: 'coprocess の printf("3\\n") — PTY slave に接続されているので line buffered。\\n で flush される → 即座に master に届く → パイプ経由で親に返る。デッドロック解消! ソースコードの変更なしに、pty を間に挟むだけで解決できるのが PTY の力。',
      },
    ],
  },
];
