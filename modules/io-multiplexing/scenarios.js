/**
 * io-multiplexing scenarios — select/poll fd readiness
 */

export const SCENARIOS = [
  {
    label: 'Figure 14.16: select による多重 I/O',
    figure: '14.16',
    description: 'select は複数の fd を同時に監視し、いずれかが ready になると返る。1 つのプロセス/スレッドで複数の I/O ソースを処理できる。',
    initialState: () => ({
      fds: [
        { fd: 0, name: 'stdin', watching: 'read', state: 'waiting' },
        { fd: 3, name: 'client1 socket', watching: 'read', state: 'waiting' },
        { fd: 4, name: 'client2 socket', watching: 'read', state: 'waiting' },
        { fd: 5, name: 'listen socket', watching: 'read', state: 'waiting' },
      ],
      selectState: 'not called',
      events: [],
    }),
    steps: [
      {
        code: 'FD_ZERO(&readfds);\nFD_SET(0, &readfds);\nFD_SET(3, &readfds);\nFD_SET(4, &readfds);\nFD_SET(5, &readfds);',
        apply: (s) => {
          s.events.push('fd_set configured: {0, 3, 4, 5} for reading');
        },
        lesson: 'FD_SET で監視する fd を登録。readfds はビットマスク — 各 fd に 1 ビット対応。maxfd+1 (=6) を select の第 1 引数に渡す。',
      },
      {
        code: 'n = select(6, &readfds, NULL, NULL, NULL);\n// blocks until one or more fds are ready',
        apply: (s) => {
          s.selectState = 'BLOCKED (waiting for any fd)';
          s.events.push('select() called — process blocks');
          s.events.push('kernel monitors all 4 fds simultaneously');
        },
        lesson: 'select がブロック。カーネルが 4 つの fd を同時に監視する。どれか 1 つでも読み取り可能になれば返る。タイムアウトに NULL を指定 → 無期限待ち。',
      },
      {
        code: '// client1 sends data → fd 3 becomes readable',
        apply: (s) => {
          s.fds[1].state = 'READY';
          s.selectState = 'returned (n=1)';
          s.events.push('client1 data arrives → fd 3 ready');
          s.events.push('select returns 1 (one fd ready)');
          s.events.push('readfds now = {3} (only ready fds remain set)');
        },
        lesson: 'client1 からデータが到着。select が返り、readfds が変更される — ready な fd (3) だけがセットされたまま残り、他 (0,4,5) はクリアされる。戻り値 n=1 (ready な fd の数)。',
      },
      {
        code: 'if (FD_ISSET(3, &readfds)) {\n    n = read(3, buf, sizeof(buf));\n    // process client1 data\n}',
        apply: (s) => {
          s.fds[1].state = 'processing';
          s.events.push('FD_ISSET(3) → true: read from client1');
        },
        lesson: 'FD_ISSET で各 fd をチェック。fd 3 が ready なので read。read はブロックしない — データがあることが保証されている。select + read の組み合わせで nonblocking I/O を実現。',
      },
      {
        code: '// loop back to select()\n// now stdin and client2 also ready',
        apply: (s) => {
          s.fds[0].state = 'READY';
          s.fds[1].state = 'waiting';
          s.fds[2].state = 'READY';
          s.selectState = 'returned (n=2)';
          s.events.push('next select() → stdin and client2 ready (n=2)');
        },
        lesson: 'ループの先頭に戻って再度 select。今度は stdin と client2 が同時に ready。select は全 ready fd を一度に報告するので、ループ内で全てを処理する。',
      },
    ],
  },
  {
    label: 'select vs poll の比較',
    figure: '14.17',
    description: 'poll は select の改良版。fd_set のサイズ制限 (FD_SETSIZE=1024) がなく、入力/出力が別の構造体で管理される。',
    initialState: () => ({
      fds: [
        { fd: 3, name: 'socket', watching: 'POLLIN', state: 'waiting' },
        { fd: 4, name: 'pipe', watching: 'POLLIN', state: 'waiting' },
      ],
      events: [],
    }),
    steps: [
      {
        code: 'struct pollfd fds[2];\nfds[0] = {.fd=3, .events=POLLIN};\nfds[1] = {.fd=4, .events=POLLIN};',
        apply: (s) => {
          s.events.push('pollfd array configured');
          s.events.push('select: fd_set is input AND output (must rebuild each call)');
          s.events.push('poll: events=input, revents=output (no rebuild needed)');
        },
        lesson: 'poll は pollfd 構造体の配列を使う。events (監視したいイベント) と revents (発生したイベント) が分離しているので、select のように毎回 fd_set を再構築する必要がない。',
      },
      {
        code: 'n = poll(fds, 2, -1);  // -1 = no timeout',
        apply: (s) => {
          s.fds[0].state = 'READY';
          s.events.push('poll() → fd 3 ready (revents = POLLIN)');
          s.events.push('fd 4 not ready (revents = 0)');
          s.events.push('key difference: poll has no FD_SETSIZE limit');
        },
        lesson: 'poll が返ると、各要素の revents にイベントがセットされる。events は変更されないので再利用可能。select の FD_SETSIZE (通常 1024) の制限がなく、大量の fd を扱えるサーバに適する。ただし現代では epoll (Linux) / kqueue (BSD) がさらに高性能。',
      },
    ],
  },
  {
    label: 'select + タイムアウト',
    figure: '14.16',
    description: 'select にタイムアウトを指定すると、fd が ready にならなくても一定時間後に返る。定期的なポーリングや、入力がない時のハートビート送信に使う。',
    initialState: () => ({
      fds: [
        { fd: 0, name: 'stdin', watching: 'read', state: 'waiting' },
        { fd: 3, name: 'network socket', watching: 'read', state: 'waiting' },
      ],
      selectState: 'not called',
      events: [],
    }),
    steps: [
      {
        code: 'struct timeval tv;\ntv.tv_sec = 5;\ntv.tv_usec = 0;',
        apply: (s) => {
          s.events.push('timeout set to 5 seconds');
        },
        lesson: 'timeval 構造体でタイムアウトを設定。tv_sec=5, tv_usec=0 で 5 秒。NULL だと無期限、{0,0} だと即座に返る (ポーリング)。',
      },
      {
        code: 'n = select(4, &readfds, NULL, NULL, &tv);\n// blocks up to 5 seconds',
        apply: (s) => {
          s.selectState = 'BLOCKED (timeout: 5 sec)';
          s.events.push('select() called with 5 sec timeout');
        },
        lesson: 'select がブロック。5 秒以内に fd が ready にならなければタイムアウトで返る (n=0)。Linux では tv が残り時間に更新されるが、他の OS では不定 — 移植性のために毎回再設定する。',
      },
      {
        code: '// 5 seconds pass, no data arrives\n// n = 0 (timeout)',
        apply: (s) => {
          s.selectState = 'returned (n=0, timeout)';
          s.events.push('timeout! select returns 0');
          s.events.push('no fd is ready — readfds is all zeros');
        },
        lesson: 'n=0 はタイムアウトを意味する。readfds は全てクリアされる。アプリケーションはこのタイミングでハートビートを送ったり、アイドル処理を行ったりできる。n=-1 はエラー (EINTR でシグナル割り込み等)。',
      },
      {
        code: '// retry: data arrives on socket this time\nn = select(4, &readfds, NULL, NULL, &tv);\n// n = 1',
        apply: (s) => {
          s.fds[1].state = 'READY';
          s.selectState = 'returned (n=1)';
          s.events.push('network data arrives → fd 3 ready');
          s.events.push('select returns 1 before timeout');
        },
        lesson: '今度はタイムアウト前にデータが到着。n=1 で即座に返る。pselect はシグナルマスクも同時に設定でき、シグナルと I/O の race condition を防げる (APUE §14.4.2)。',
      },
    ],
  },
];
