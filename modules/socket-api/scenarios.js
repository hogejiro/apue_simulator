/**
 * socket-api scenarios — TCP client-server communication flow
 */

export const SCENARIOS = [
  // =========================================================================
  // TCP server + client (Figure 16.9/16.10)
  // =========================================================================
  {
    label: 'Figure 16.9-16.10: TCP クライアント-サーバ',
    figure: '16.9',
    description: 'TCP 通信の標準パターン。サーバ: socket → bind → listen → accept。クライアント: socket → connect。accept で新しい fd が生まれ、1 対 1 の接続が確立する。',
    initialState: () => ({
      server: { fd: null, state: '(not created)', addr: '', connFd: null, connState: '' },
      client: { fd: null, state: '(not created)', addr: '' },
      events: [],
    }),
    steps: [
      {
        code: '[server] int sockfd = socket(\n    AF_INET, SOCK_STREAM, 0);',
        apply: (s) => {
          s.server.fd = 3;
          s.server.state = 'CLOSED';
          s.events.push('server: socket created (fd 3)');
        },
        lesson: 'サーバがソケットを作成。AF_INET (IPv4) + SOCK_STREAM (TCP)。この時点では誰とも繋がっていない。',
      },
      {
        code: '[server] bind(sockfd,\n    {port: 8080}, ...);',
        apply: (s) => {
          s.server.addr = '0.0.0.0:8080';
          s.events.push('server: bound to 0.0.0.0:8080');
        },
        lesson: 'bind でアドレス (IP + ポート) を割り当てる。0.0.0.0 は全インターフェースで listen する意味。well-known ポート (< 1024) は root 権限が必要。',
      },
      {
        code: '[server] listen(sockfd, 5);',
        apply: (s) => {
          s.server.state = 'LISTEN';
          s.events.push('server: listening (backlog=5)');
        },
        lesson: 'listen でソケットを受動的 (passive) ソケットに変換。backlog=5 は保留中の接続キューの最大長。カーネルが TCP 3-way handshake を自動処理する。',
      },
      {
        code: '[client] int sockfd = socket(\n    AF_INET, SOCK_STREAM, 0);',
        apply: (s) => {
          s.client.fd = 3;
          s.client.state = 'CLOSED';
          s.events.push('client: socket created (fd 3)');
        },
        lesson: 'クライアントもソケットを作成。bind は通常不要 (カーネルがエフェメラルポートを自動割り当て)。',
      },
      {
        code: '[client] connect(sockfd,\n    {host: "server", port: 8080});',
        apply: (s) => {
          s.client.state = 'ESTABLISHED';
          s.client.addr = '192.168.1.10:54321';
          s.events.push('client: connect → 3-way handshake (SYN → SYN+ACK → ACK)');
          s.events.push('client: ESTABLISHED');
        },
        lesson: 'connect が TCP 3-way handshake を開始: SYN → SYN+ACK → ACK。成功すると ESTABLISHED 状態に。connect は接続完了まで (またはタイムアウトまで) ブロックする。',
      },
      {
        code: '[server] int connfd = accept(\n    sockfd, &addr, &len);',
        apply: (s) => {
          s.server.connFd = 4;
          s.server.connState = 'ESTABLISHED';
          s.events.push('server: accept → new fd 4 (connected to client)');
          s.events.push('server: sockfd (fd 3) still LISTEN for more clients');
        },
        lesson: 'accept は完了した接続をキューから取り出し、新しい fd (connfd=4) を返す。元の sockfd (fd 3) は LISTEN のまま — 次のクライアントを受け付けられる。これが「1 つの listen ソケットで複数クライアントを処理できる」仕組み。',
      },
      {
        code: '[client] write(sockfd, "GET / HTTP/1.1\\r\\n", 16);',
        apply: (s) => {
          s.events.push('client → server: "GET / HTTP/1.1\\r\\n" (16 bytes)');
        },
        lesson: 'クライアントがデータ送信。TCP がバイトストリームとして信頼性のある配送を保証する。メッセージ境界は保持されない (SOCK_STREAM)。',
      },
      {
        code: '[server] n = read(connfd, buf, 1024);',
        apply: (s) => {
          s.events.push('server: read 16 bytes from client');
        },
        lesson: 'サーバが connfd (fd 4) から読む。listen ソケット (fd 3) ではなく、accept で返された接続済みソケットを使う。',
      },
      {
        code: '[server] write(connfd, response, len);',
        apply: (s) => {
          s.events.push('server → client: HTTP response (256 bytes)');
        },
        lesson: 'サーバがレスポンスを送信。双方向通信 — 読み書き両方に同じ fd を使える (full-duplex)。',
      },
      {
        code: '[server] close(connfd);',
        apply: (s) => {
          s.server.connState = 'CLOSED (FIN sent)';
          s.server.connFd = null;
          s.events.push('server: close connfd → FIN sent to client');
        },
        lesson: 'サーバが接続を閉じる。TCP FIN パケットが送られる。listen ソケット (fd 3) はまだ開いている。',
      },
      {
        code: '[client] n = read(sockfd, buf, 1024);\n// n = 0 (EOF)',
        apply: (s) => {
          s.client.state = 'CLOSED';
          s.events.push('client: read returns 0 (EOF) → connection closed');
        },
        lesson: 'クライアントの read が 0 を返す (EOF)。サーバが FIN を送ったことを意味する。パイプの EOF と同じパターン。',
      },
    ],
  },

  // =========================================================================
  // SO_REUSEADDR
  // =========================================================================
  {
    label: 'SO_REUSEADDR: アドレス再利用',
    figure: '16.6',
    description: 'サーバを再起動すると bind が EADDRINUSE で失敗することがある。SO_REUSEADDR オプションで回避する。',
    initialState: () => ({
      server: { fd: null, state: '(not created)', addr: '', connFd: null, connState: '' },
      client: { fd: null, state: '(not created)', addr: '' },
      events: [],
      timeWait: null,
    }),
    steps: [
      {
        code: '// previous server closed,\n// TIME_WAIT state remains',
        apply: (s) => {
          s.timeWait = '0.0.0.0:8080 (TIME_WAIT, 2MSL wait)';
          s.events.push('previous connection in TIME_WAIT state');
          s.events.push('kernel holds address for 2*MSL (60-240 sec)');
        },
        lesson: 'TCP 接続を閉じた側は TIME_WAIT 状態に入り、2*MSL (Maximum Segment Lifetime) の間アドレスを保持する。遅延パケットの誤配送を防ぐため。',
      },
      {
        code: '[server] bind(sockfd, {port: 8080});\n// EADDRINUSE!',
        apply: (s) => {
          s.server.fd = 3;
          s.server.state = 'CLOSED';
          s.events.push('server: bind → EADDRINUSE (address already in use)');
        },
        lesson: 'TIME_WAIT のアドレスに bind しようとすると EADDRINUSE。サーバを再起動できない — 60 秒以上待つ必要がある。',
      },
      {
        code: 'setsockopt(sockfd, SOL_SOCKET,\n    SO_REUSEADDR, &on, sizeof(on));\nbind(sockfd, {port: 8080});',
        apply: (s) => {
          s.server.state = 'CLOSED';
          s.server.addr = '0.0.0.0:8080';
          s.timeWait = '0.0.0.0:8080 (TIME_WAIT — overridden by SO_REUSEADDR)';
          s.events.push('server: SO_REUSEADDR set → bind succeeds');
        },
        lesson: 'SO_REUSEADDR を設定すると TIME_WAIT 中でも bind できる。ほぼ全てのサーバプログラムがこのオプションを使う。安全な理由: 新しい接続は別の TCP シーケンス番号を使うので衝突しない。',
      },
    ],
  },
  {
    label: 'fork + accept: 並行サーバ',
    figure: '16.17',
    description: 'accept のたびに fork して子プロセスでクライアントを処理する。最も基本的な並行サーバのパターン。',
    initialState: () => ({
      server: { fd: 3, state: 'LISTEN', addr: '0.0.0.0:8080', connFd: null, connState: '' },
      client: { fd: 3, state: 'ESTABLISHED', addr: '192.168.1.10:54321' },
      events: ['server listening on port 8080', 'client connected'],
    }),
    steps: [
      {
        code: '[server] connfd = accept(sockfd, ...);',
        apply: (s) => {
          s.server.connFd = 4;
          s.server.connState = 'ESTABLISHED';
          s.events.push('accept → connfd=4 (new connection)');
        },
        lesson: 'accept で新しい接続を受け付け。connfd=4 が返る。listen ソケット (fd 3) はまだ LISTEN のまま。',
      },
      {
        code: '[server] pid = fork();',
        apply: (s) => {
          s.events.push('fork → child handles this client');
          s.events.push('parent continues to accept next client');
        },
        lesson: 'fork で子プロセスを作る。子は connfd (fd 4) でクライアントと通信し、親は次の accept に戻る。子は listen ソケットを close、親は connfd を close する。',
      },
      {
        code: '[parent] close(connfd);\n// continue accept loop',
        apply: (s) => {
          s.server.connFd = null;
          s.server.connState = '';
          s.events.push('parent: close connfd, back to accept()');
        },
        lesson: '親は connfd を close して accept ループに戻る。connfd の refcount は 2 (親+子) だったので、親が close しても接続は切れない (子がまだ持っている)。',
      },
      {
        code: '[child] close(sockfd);\n// handle client on connfd\n// ... read, write, process ...\nclose(connfd);\nexit(0);',
        apply: (s) => {
          s.server.connState = '';
          s.client.state = 'CLOSED';
          s.events.push('child: close listen sock, handle client, exit');
          s.events.push('connection fully closed when child exits');
        },
        lesson: '子は listen ソケットを close (使わない)。connfd でクライアントと通信し、完了後に close + exit。このパターンは inetd, sshd, Apache (prefork) で使われている。スレッドベース (pthread_create) やイベント駆動 (epoll + nonblocking) と比較される。',
      },
    ],
  },
];
