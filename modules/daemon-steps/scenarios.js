/**
 * daemon-steps scenarios — daemonize process step by step (Figure 13.1)
 *
 * State is a plain object representing process attributes.
 * No dedicated core engine needed — simple enough to inline.
 */

export const SCENARIOS = [
  {
    label: 'Figure 13.1: daemonize の 6 ステップ',
    figure: '13.1',
    description: 'デーモンプロセスを作る標準手順。umask → fork+exit → setsid → chdir → close fds → /dev/null。各ステップでプロセスの属性がどう変わるかを観察する。',
    initialState: () => ({
      pid: 1234,
      ppid: 1000,
      sid: 1000,
      pgid: 1234,
      umask: '022',
      cwd: '/home/user/project',
      ctty: '/dev/pts/0',
      fds: ['0: /dev/pts/0 (stdin)', '1: /dev/pts/0 (stdout)', '2: /dev/pts/0 (stderr)', '3: config.conf', '4: socket'],
      isSessionLeader: false,
      isPGLeader: true,
      name: 'mydaemon',
      status: 'foreground process',
    }),
    steps: [
      {
        code: 'umask(0);',
        apply: (s) => { s.umask = '000'; },
        lesson: 'Step 1: umask を 0 にクリア。デーモンが作成するファイルのパーミッションを、継承された umask に左右されずに明示的に制御するため。親シェルの umask が 077 だと、デーモンが作るファイルが意図せず制限される。',
      },
      {
        code: 'pid = fork();\nif (pid > 0) exit(0);  // parent exits',
        apply: (s) => {
          s.ppid = 1; // init becomes parent
          s.pid = 1235; // child gets new PID
          s.pgid = 1234; // inherits parent's PG
          s.isPGLeader = false;
          s.status = 'orphan (parent exited)';
        },
        lesson: 'Step 2: fork して親が exit。(a) シェルにコマンド完了を通知、(b) 子は新 PID で PG リーダーではない → setsid の前提条件を満たす。PPID が 1 (init) になる — 孤児プロセスは init に引き取られる。',
      },
      {
        code: 'setsid();',
        apply: (s) => {
          s.sid = s.pid;
          s.pgid = s.pid;
          s.isSessionLeader = true;
          s.isPGLeader = true;
          s.ctty = '(none)';
          s.status = 'session leader, no controlling terminal';
        },
        lesson: 'Step 3: setsid() で新セッション作成。3 つのことが起きる: (a) 新セッションのリーダーになる (SID=PID)、(b) 新 PG のリーダーになる (PGID=PID)、(c) 制御端末が切り離される。これ以降 ^C や ^Z はこのプロセスに届かない。',
      },
      {
        code: 'chdir("/");',
        apply: (s) => {
          s.cwd = '/';
        },
        lesson: 'Step 4: 作業ディレクトリを / に変更。デーモンが特定ディレクトリに留まると、そのファイルシステムを umount できなくなる。/ なら常にマウントされている。',
      },
      {
        code: 'for (fd = 0; fd < maxfd; fd++)\n    close(fd);',
        apply: (s) => {
          s.fds = ['(all closed)'];
        },
        lesson: 'Step 5: 全 fd を close。親から継承した不要な fd (端末、ソケット等) を閉じる。getrlimit(RLIMIT_NOFILE) で最大 fd 数を取得してループ。',
      },
      {
        code: 'fd0 = open("/dev/null", O_RDWR);\ndup(fd0);  // fd 1\ndup(fd0);  // fd 2',
        apply: (s) => {
          s.fds = ['0: /dev/null (stdin)', '1: /dev/null (stdout)', '2: /dev/null (stderr)'];
          s.status = 'daemon (ready)';
        },
        lesson: 'Step 6: fd 0,1,2 を /dev/null に open。ライブラリが stdin/stdout/stderr に読み書きしても無害。これで daemonize 完了 — 制御端末なし、背景で動き続けるプロセス。',
      },
    ],
  },
  {
    label: 'SIGHUP で設定ファイル再読み込み',
    figure: '13.7',
    description: 'デーモンは制御端末がないので SIGHUP が届くことはない。この「使われないシグナル」を設定ファイル再読み込みの合図として再利用する慣習。',
    initialState: () => ({
      pid: 500,
      ppid: 1,
      sid: 500,
      pgid: 500,
      umask: '000',
      cwd: '/',
      ctty: '(none)',
      fds: ['0: /dev/null', '1: /dev/null', '2: /dev/null', '3: /var/run/mydaemon.pid'],
      isSessionLeader: true,
      isPGLeader: true,
      name: 'mydaemon',
      status: 'daemon (running)',
      config: '/etc/mydaemon.conf (v1)',
      sighupHandler: 'reread_config()',
    }),
    steps: [
      {
        code: 'signal(SIGHUP, reread_config);',
        apply: (s) => { s.sighupHandler = 'reread_config()'; },
        lesson: 'デーモン起動時に SIGHUP のハンドラを設定。制御端末がないデーモンには SIGHUP が自然に届くことはないので、管理者が明示的に送る合図として安全に再利用できる。',
      },
      {
        code: '// admin: kill -HUP 500',
        apply: (s) => {
          s.config = '/etc/mydaemon.conf (v2 — reloaded)';
          s.status = 'daemon (config reloaded)';
        },
        lesson: '管理者が kill -HUP でシグナルを送信。ハンドラ reread_config() が呼ばれ、設定ファイルを再読み込み。デーモンを再起動せずに設定変更を反映できる。syslogd, httpd, inetd 等多くのデーモンがこの慣習に従う。',
      },
    ],
  },
  {
    label: 'Figure 13.6: PID ファイルで単一インスタンス保証',
    figure: '13.6',
    description: 'cron 等のデーモンは 1 つしか動いてはいけない。PID ファイル + ファイルロックで排他制御する。',
    initialState: () => ({
      pid: 500,
      ppid: 1,
      sid: 500,
      pgid: 500,
      umask: '000',
      cwd: '/',
      ctty: '(none)',
      fds: ['0: /dev/null', '1: /dev/null', '2: /dev/null'],
      isSessionLeader: true,
      isPGLeader: true,
      name: 'mydaemon',
      status: 'starting...',
      pidFile: null,
      lockStatus: null,
    }),
    steps: [
      {
        code: 'fd = open("/var/run/daemon.pid",\n    O_RDWR | O_CREAT, 0644);',
        apply: (s) => {
          s.fds.push('3: /var/run/daemon.pid');
          s.pidFile = '/var/run/daemon.pid';
          s.status = 'opening PID file';
        },
        lesson: 'PID ファイルを open (なければ作成)。このファイルに自分の PID を書き込み、ファイルロックで排他制御する。慣習的に /var/run/<name>.pid に置く。',
      },
      {
        code: 'if (lockfile(fd) < 0) {\n    // EACCES or EAGAIN\n    syslog(LOG_ERR, "already running");\n    exit(1);\n}',
        apply: (s) => {
          s.lockStatus = 'write lock acquired';
          s.status = 'lock acquired (single instance OK)';
        },
        lesson: 'fcntl で write lock を取得 (F_SETLK)。成功 → 他のインスタンスは動いていない。失敗 (EACCES/EAGAIN) → 既に別のインスタンスがロックを持っている → 重複起動なので exit。プロセス終了時にロックは自動解放される。',
      },
      {
        code: 'ftruncate(fd, 0);\nsprintf(buf, "%ld", (long)getpid());\nwrite(fd, buf, strlen(buf));',
        apply: (s) => {
          s.status = 'daemon (PID 500 written to pidfile)';
          s.pidFile = '/var/run/daemon.pid → "500"';
        },
        lesson: 'ftruncate で既存の内容をクリアしてから PID を書き込む。ftruncate が必要な理由: 前のデーモンの PID (例: 12345) が今回 (例: 500) より長い場合、上書きすると "50045" になる。管理者は cat /var/run/daemon.pid で PID を確認できる。',
      },
    ],
  },
];
