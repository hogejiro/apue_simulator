/**
 * terminal-modes scenarios — termios, canonical/noncanonical, special chars
 */

export const SCENARIOS = [
  {
    label: 'Figure 18.19: canonical vs noncanonical',
    figure: '18.19',
    description: 'canonical モードでは行単位で read に返る (ERASE/KILL で編集可能)。noncanonical モードでは MIN/TIME で read の返却条件を細かく制御する。',
    initialState: () => ({
      mode: 'canonical',
      echo: true,
      isig: true,
      icanon: true,
      min: 1, time: 0,
      inputBuffer: '',
      readResult: '',
      specialChars: { ERASE: '^H', KILL: '^U', EOF: '^D', INTR: '^C', SUSP: '^Z' },
      events: [],
    }),
    steps: [
      {
        code: '// canonical mode (default)\n// user types: "hello"',
        apply: (s) => {
          s.inputBuffer = 'hello';
          s.events.push('user types "hello" → buffered in line discipline');
          s.events.push('echo: "hello" displayed on terminal');
        },
        lesson: 'canonical モード (デフォルト)。ユーザーの入力は line discipline でバッファされる。ERASE (Backspace) や KILL (^U) で編集できる。Enter を押すまで read には返らない。',
      },
      {
        code: '// user presses Backspace (ERASE)',
        apply: (s) => {
          s.inputBuffer = 'hell';
          s.events.push('ERASE (^H): delete last char → "hell"');
        },
        lesson: 'ERASE 文字 (通常 Backspace/^H) で最後の 1 文字を削除。line discipline がバッファを編集する。プログラムはこの編集を知らない — 完成した行だけが read に返る。',
      },
      {
        code: '// user presses Enter (NL)',
        apply: (s) => {
          s.readResult = 'hell\\n';
          s.inputBuffer = '';
          s.events.push('NL (Enter): line complete → read returns "hell\\n" (5 bytes)');
        },
        lesson: 'Enter (NL) で行が完成。read が "hell\\n" (5 バイト) を返す。NL は行区切り文字としてバッファに残る。EOF (^D) は行区切り後に破棄される (read に含まれない)。',
      },
      {
        code: 'struct termios raw;\ntcgetattr(fd, &raw);\nraw.c_lflag &= ~(ICANON | ECHO);\nraw.c_cc[VMIN] = 1;\nraw.c_cc[VTIME] = 0;\ntcsetattr(fd, TCSAFLUSH, &raw);',
        apply: (s) => {
          s.mode = 'noncanonical';
          s.echo = false;
          s.icanon = false;
          s.readResult = '';
          s.events.push('switch to noncanonical mode (raw-like)');
          s.events.push('ECHO off, ICANON off, MIN=1, TIME=0');
        },
        lesson: 'noncanonical モードに切替。ICANON off → 行編集なし、ERASE/KILL/EOF 無効。ECHO off → 入力が画面に表示されない。MIN=1, TIME=0 → 最低 1 バイト受信で即座に read が返る (Case B)。',
      },
      {
        code: '// user presses "a"',
        apply: (s) => {
          s.readResult = 'a';
          s.events.push('key "a" → read returns immediately (1 byte)');
          s.events.push('no echo (ECHO off) — nothing displayed');
        },
        lesson: '1 キー押すだけで read が即座に返る。バッファリングなし。vi や less などのフルスクリーンアプリはこのモードを使う。ECHO off なのでアプリ自身が表示を制御する。',
      },
      {
        code: '// user presses ^C',
        apply: (s) => {
          s.readResult = '\\x03';
          s.events.push('^C → read returns 0x03 (not SIGINT — ISIG is on but...)');
          s.events.push('wait — ISIG is still on, so ^C generates SIGINT!');
        },
        lesson: '注意: ISIG がまだ ON なら ^C は SIGINT を生成する。完全な raw モードにするには ISIG も OFF にする必要がある (tty_raw)。cbreak モードは ISIG ON のまま — シグナル文字は処理される。',
      },
    ],
  },
  {
    label: 'Figure 18.20: cbreak vs raw モード',
    figure: '18.20',
    description: 'cbreak: 1 文字単位入力 + エコー OFF + シグナルは処理。raw: 全て OFF で生バイト。',
    initialState: () => ({
      mode: 'canonical',
      echo: true,
      isig: true,
      icanon: true,
      iexten: true,
      opost: true,
      icrnl: true,
      min: 1, time: 0,
      events: [],
    }),
    steps: [
      {
        code: 'tty_cbreak(STDIN_FILENO);',
        apply: (s) => {
          s.mode = 'cbreak';
          s.echo = false;
          s.icanon = false;
          s.min = 1; s.time = 0;
          s.events.push('cbreak: ECHO off, ICANON off');
          s.events.push('ISIG still ON — ^C/^Z work');
          s.events.push('MIN=1, TIME=0 (1 byte at a time)');
        },
        lesson: 'cbreak モード: ECHO と ICANON を OFF。1 文字単位で read が返る。ただし ISIG は ON のまま — ^C で SIGINT、^Z で SIGTSTP が送られる。more, less 等のページャが使うモード。',
      },
      {
        code: 'tty_raw(STDIN_FILENO);',
        apply: (s) => {
          s.mode = 'raw';
          s.echo = false;
          s.icanon = false;
          s.isig = false;
          s.iexten = false;
          s.opost = false;
          s.icrnl = false;
          s.events.push('raw: ECHO, ICANON, ISIG, IEXTEN off');
          s.events.push('OPOST off (no output processing)');
          s.events.push('ICRNL, INPCK, ISTRIP, IXON off');
          s.events.push('^C is just byte 0x03, not SIGINT');
        },
        lesson: 'raw モード: 全ての入出力処理を OFF。^C は SIGINT ではなく 0x03 バイトとして read に返る。CR→NL 変換もなし。NL→CR+NL 変換 (OPOST/ONLCR) もなし。端末エミュレータや ssh が使うモード。',
      },
      {
        code: 'tty_reset(STDIN_FILENO);',
        apply: (s) => {
          s.mode = 'canonical';
          s.echo = true;
          s.isig = true;
          s.icanon = true;
          s.iexten = true;
          s.opost = true;
          s.icrnl = true;
          s.events.push('reset to saved termios (canonical mode)');
        },
        lesson: 'tty_reset で保存していた元の termios を復元。プログラム終了時に必ず呼ぶ — 呼ばないと端末が raw モードのまま残る (reset(1) コマンドで復旧可能)。atexit(tty_atexit) で安全に。',
      },
    ],
  },
  {
    label: 'Figure 18.17: getpass の実装',
    figure: '18.17',
    description: 'パスワード入力関数 getpass の実装パターン: /dev/tty を open → エコー OFF → シグナルブロック → 読み取り → 全部元に戻す。端末制御の教科書的な例。',
    initialState: () => ({
      mode: 'canonical',
      echo: true,
      isig: true,
      icanon: true,
      min: 1, time: 0,
      inputBuffer: '',
      readResult: '',
      events: [],
      sigBlocked: false,
      ttyFd: null,
    }),
    steps: [
      {
        code: 'fp = fopen(ctermid(NULL), "r+");',
        apply: (s) => {
          s.ttyFd = '/dev/tty (read+write)';
          s.events.push('open /dev/tty directly (not stdin)');
          s.events.push('works even if stdin is redirected');
        },
        lesson: 'stdin ではなく /dev/tty を直接 open。stdin がリダイレクトされていても制御端末から読める。ctermid() は制御端末のパス名 (通常 /dev/tty) を返す。',
      },
      {
        code: 'sigprocmask(SIG_BLOCK,\n    {SIGINT, SIGTSTP});',
        apply: (s) => {
          s.sigBlocked = true;
          s.events.push('block SIGINT and SIGTSTP');
          s.events.push('prevent ^C/^Z during password input');
        },
        lesson: 'SIGINT と SIGTSTP をブロック。エコー OFF 中に ^C で中断されると、端末がエコーなしのまま残ってしまう。シグナルを遅延させることで安全に復元できる。',
      },
      {
        code: 'tcgetattr(fd, &ts);\nots = ts;  // save copy\nts.c_lflag &= ~(ECHO|ECHOE|ECHOK|ECHONL);\ntcsetattr(fd, TCSAFLUSH, &ts);',
        apply: (s) => {
          s.echo = false;
          s.events.push('save original termios');
          s.events.push('turn off all echo flags');
          s.events.push('TCSAFLUSH: flush input queue too');
        },
        lesson: 'エコーを OFF に。ECHO だけでなく ECHOE (backspace エコー), ECHOK (kill エコー), ECHONL (NL エコー) も全て OFF。TCSAFLUSH で設定変更前の入力キューも破棄 (先行入力のエコー漏れ防止)。',
      },
      {
        code: 'fputs(prompt, fp);\n// user types password (not echoed)\nfgets(buf, MAX_PASS_LEN, fp);',
        apply: (s) => {
          s.inputBuffer = '********';
          s.readResult = 'secret123';
          s.events.push('"Enter password:" displayed');
          s.events.push('user types — nothing echoed');
          s.events.push('Enter → fgets returns password');
        },
        lesson: 'プロンプトを表示し、パスワードを読む。ICANON は ON のままなので行単位入力 — Backspace で編集可能。ECHO が OFF なので画面には何も表示されない。',
      },
      {
        code: 'tcsetattr(fd, TCSAFLUSH, &ots);\nsigprocmask(SIG_SETMASK, &osig);\nfclose(fp);',
        apply: (s) => {
          s.echo = true;
          s.sigBlocked = false;
          s.ttyFd = null;
          s.events.push('restore original termios');
          s.events.push('unblock signals');
          s.events.push('close /dev/tty');
        },
        lesson: '元の termios を復元 → シグナルを unblock → /dev/tty を close。この順序が重要: 端末を復元してからシグナルを許可する。使用後はパスワードをゼロクリア (core dump 対策)。',
      },
    ],
  },
];
