/**
 * syscall-ref — system call quick reference, searchable
 */

const SYSCALLS = [
  { name: 'open', ch: 3, sig: 'int open(const char *path, int oflag, ...)', ret: 'fd or -1', desc: 'ファイルを開く。O_RDONLY/O_WRONLY/O_RDWR + O_CREAT/O_TRUNC/O_APPEND', cat: 'File I/O' },
  { name: 'close', ch: 3, sig: 'int close(int fd)', ret: '0 or -1', desc: 'fd を閉じる。ファイルテーブルエントリの refcount を減らす', cat: 'File I/O' },
  { name: 'read', ch: 3, sig: 'ssize_t read(int fd, void *buf, size_t n)', ret: 'bytes read, 0=EOF, -1=error', desc: 'fd から読む。実際に読めたバイト数を返す (要求より少ない場合あり)', cat: 'File I/O' },
  { name: 'write', ch: 3, sig: 'ssize_t write(int fd, const void *buf, size_t n)', ret: 'bytes written or -1', desc: 'fd に書く。ディスク I/O はブロックし得る', cat: 'File I/O' },
  { name: 'lseek', ch: 3, sig: 'off_t lseek(int fd, off_t offset, int whence)', ret: 'new offset or -1', desc: 'ファイルオフセットを移動。SEEK_SET/SEEK_CUR/SEEK_END', cat: 'File I/O' },
  { name: 'dup', ch: 3, sig: 'int dup(int fd)', ret: 'new fd or -1', desc: 'fd を複製 (最小の空き番号)。同じファイルテーブルエントリを共有', cat: 'File I/O' },
  { name: 'dup2', ch: 3, sig: 'int dup2(int fd, int fd2)', ret: 'fd2 or -1', desc: 'fd を fd2 に複製。fd2 が開いていれば先に close', cat: 'File I/O' },
  { name: 'stat', ch: 4, sig: 'int stat(const char *path, struct stat *buf)', ret: '0 or -1', desc: 'ファイル情報を取得。シンボリックリンクは辿る', cat: 'File I/O' },
  { name: 'fcntl', ch: 3, sig: 'int fcntl(int fd, int cmd, ...)', ret: 'depends on cmd', desc: 'fd の属性操作。F_DUPFD, F_GETFL/F_SETFL, F_GETLK/F_SETLK (ロック)', cat: 'File I/O' },
  { name: 'fork', ch: 8, sig: 'pid_t fork(void)', ret: '子PID(親), 0(子), -1(error)', desc: 'プロセスをコピー。fd テーブルは独立コピー、ファイルテーブルは共有', cat: 'Process' },
  { name: 'exec', ch: 8, sig: 'int execvp(const char *file, char *const argv[])', ret: '-1 on error only', desc: 'プロセスイメージを置換。成功すると戻らない。fd は保持', cat: 'Process' },
  { name: 'wait', ch: 8, sig: 'pid_t waitpid(pid_t pid, int *status, int opts)', ret: 'child PID or -1', desc: '子プロセスの終了を待つ。ゾンビを回収', cat: 'Process' },
  { name: 'exit', ch: 7, sig: 'void exit(int status)', ret: '(does not return)', desc: 'プロセス終了。atexit ハンドラ実行、stdio バッファ flush', cat: 'Process' },
  { name: '_exit', ch: 7, sig: 'void _exit(int status)', ret: '(does not return)', desc: '即座に終了。atexit/flush なし。fork 後の子で使う', cat: 'Process' },
  { name: 'setsid', ch: 9, sig: 'pid_t setsid(void)', ret: 'new SID or -1', desc: '新セッション作成。セッションリーダー+新PG+制御端末なし', cat: 'Process' },
  { name: 'setpgid', ch: 9, sig: 'int setpgid(pid_t pid, pid_t pgid)', ret: '0 or -1', desc: 'プロセスグループを設定。ジョブ制御用', cat: 'Process' },
  { name: 'pipe', ch: 15, sig: 'int pipe(int fd[2])', ret: '0 or -1', desc: 'パイプ作成。fd[0]=read, fd[1]=write', cat: 'IPC' },
  { name: 'socket', ch: 16, sig: 'int socket(int domain, int type, int proto)', ret: 'fd or -1', desc: 'ソケット作成。AF_INET+SOCK_STREAM=TCP', cat: 'Network' },
  { name: 'bind', ch: 16, sig: 'int bind(int fd, const struct sockaddr *addr, ...)', ret: '0 or -1', desc: 'ソケットにアドレスを割り当て', cat: 'Network' },
  { name: 'listen', ch: 16, sig: 'int listen(int fd, int backlog)', ret: '0 or -1', desc: 'ソケットを受動的に (接続待ち状態に)', cat: 'Network' },
  { name: 'accept', ch: 16, sig: 'int accept(int fd, struct sockaddr *addr, ...)', ret: 'new fd or -1', desc: '接続を受け付け新 fd を返す。元の fd は LISTEN のまま', cat: 'Network' },
  { name: 'connect', ch: 16, sig: 'int connect(int fd, const struct sockaddr *addr, ...)', ret: '0 or -1', desc: 'サーバに接続。TCP 3-way handshake', cat: 'Network' },
  { name: 'sigaction', ch: 10, sig: 'int sigaction(int signo, const struct sigaction *act, ...)', ret: '0 or -1', desc: 'シグナルの disposition を設定。signal() より信頼性が高い', cat: 'Signal' },
  { name: 'sigprocmask', ch: 10, sig: 'int sigprocmask(int how, const sigset_t *set, ...)', ret: '0 or -1', desc: 'シグナルマスク操作。SIG_BLOCK/UNBLOCK/SETMASK', cat: 'Signal' },
  { name: 'kill', ch: 10, sig: 'int kill(pid_t pid, int signo)', ret: '0 or -1', desc: 'プロセスにシグナル送信。pid=0 で同一PG、pid=-1 で全プロセス', cat: 'Signal' },
  { name: 'select', ch: 14, sig: 'int select(int maxfdp1, fd_set *readfds, ...)', ret: 'ready count or -1', desc: '複数 fd の I/O 多重化。ready な fd の数を返す', cat: 'Advanced I/O' },
  { name: 'poll', ch: 14, sig: 'int poll(struct pollfd fds[], nfds_t nfds, int timeout)', ret: 'ready count or -1', desc: 'select の改良版。FD_SETSIZE 制限なし', cat: 'Advanced I/O' },
  { name: 'mmap', ch: 14, sig: 'void *mmap(void *addr, size_t len, int prot, int flags, int fd, off_t off)', ret: 'addr or MAP_FAILED', desc: 'ファイルをメモリにマップ。MAP_SHARED/MAP_PRIVATE', cat: 'Advanced I/O' },
  { name: 'pthread_create', ch: 11, sig: 'int pthread_create(pthread_t *tid, ...)', ret: '0 or error number', desc: 'スレッド作成。errno ではなくエラー番号を返す', cat: 'Thread' },
  { name: 'pthread_mutex_lock', ch: 11, sig: 'int pthread_mutex_lock(pthread_mutex_t *mutex)', ret: '0 or error', desc: 'mutex 取得。保持中の場合ブロック', cat: 'Thread' },
  { name: 'pthread_cond_wait', ch: 11, sig: 'int pthread_cond_wait(pthread_cond_t *cond, pthread_mutex_t *mutex)', ret: '0 or error', desc: 'mutex 解放+condvar 待ち。起床時に mutex 再取得', cat: 'Thread' },
  { name: 'tcgetattr', ch: 18, sig: 'int tcgetattr(int fd, struct termios *tp)', ret: '0 or -1', desc: '端末属性を取得', cat: 'Terminal' },
  { name: 'tcsetattr', ch: 18, sig: 'int tcsetattr(int fd, int opt, const struct termios *tp)', ret: '0 or -1', desc: '端末属性を設定。TCSANOW/TCSADRAIN/TCSAFLUSH', cat: 'Terminal' },
];

export class SyscallRefVisualizer {
  constructor(container) { this.container = container; }

  init() { this.render(''); }

  render(filter) {
    const filtered = filter
      ? SYSCALLS.filter(s => s.name.includes(filter) || s.desc.includes(filter) || s.cat.toLowerCase().includes(filter.toLowerCase()))
      : SYSCALLS;

    const cats = [...new Set(filtered.map(s => s.cat))];

    this.container.innerHTML = `
      <div class="scenario-selector">
        <label>Search:</label>
        <input type="text" id="syscall-search" placeholder="syscall name or keyword..." value="${this._esc(filter || '')}" style="background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font-mono);font-size:12px;flex:1;max-width:300px">
        <span class="step-info">${filtered.length} / ${SYSCALLS.length}</span>
      </div>
      <div class="kernel-panel" style="margin-top:12px;overflow-y:auto;max-height:calc(100vh - 160px)">
        ${cats.map(cat => `
          <div class="col-title" style="margin-top:12px">${cat}</div>
          <table class="lock-list-table">
            <tr><th>Name</th><th>Ch</th><th>Signature</th><th>Returns</th><th>Description</th></tr>
            ${filtered.filter(s => s.cat === cat).map(s => `
              <tr>
                <td style="color:var(--accent);font-weight:600">${s.name}</td>
                <td style="color:var(--text-dim)">${s.ch}</td>
                <td style="font-size:10px;color:var(--text)">${this._esc(s.sig)}</td>
                <td style="font-size:10px;color:var(--accent2)">${this._esc(s.ret)}</td>
                <td style="font-size:10px;color:var(--text-dim)">${this._esc(s.desc)}</td>
              </tr>
            `).join('')}
          </table>
        `).join('')}
      </div>
    `;

    this.container.querySelector('#syscall-search')?.addEventListener('input', (e) => {
      this.render(e.target.value);
      // Re-focus and restore cursor
      const input = this.container.querySelector('#syscall-search');
      if (input) { input.focus(); input.selectionStart = input.selectionEnd = e.target.value.length; }
    });
  }

  _esc(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  destroy() {}
}
