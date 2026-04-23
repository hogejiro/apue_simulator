/**
 * module-links.js — cross-module relationships
 *
 * Maps module names to related modules for navigation.
 */

export const MODULE_RELATIONS = {
  'fd-table': [
    { module: 'fork-exec', label: 'fork 後の fd 共有' },
    { module: 'pipe-fifo', label: 'パイプの fd' },
  ],
  'fork-exec': [
    { module: 'fd-table', label: 'fd テーブルの 3 層構造' },
    { module: 'session-jobctl', label: 'セッションとジョブ制御' },
    { module: 'pipe-fifo', label: 'パイプライン' },
    { module: 'process-memory', label: 'メモリレイアウト' },
  ],
  'session-jobctl': [
    { module: 'fork-exec', label: 'fork/exec' },
    { module: 'signal-delivery', label: 'SIGINT/SIGTSTP' },
  ],
  'signal-delivery': [
    { module: 'session-jobctl', label: 'ジョブ制御シグナル' },
    { module: 'fork-exec', label: 'SIGCHLD と wait' },
  ],
  'pipe-fifo': [
    { module: 'fd-table', label: 'fd テーブル' },
    { module: 'fork-exec', label: 'fork + パイプ' },
    { module: 'io-multiplexing', label: 'select/poll' },
  ],
  'record-lock': [
    { module: 'fd-table', label: 'fd とファイルテーブル' },
    { module: 'deadlock', label: 'デッドロック' },
  ],
  'thread-sync': [
    { module: 'deadlock', label: 'デッドロック検出' },
  ],
  'deadlock': [
    { module: 'thread-sync', label: 'mutex/condvar' },
    { module: 'record-lock', label: 'レコードロックのデッドロック' },
  ],
  'daemon-steps': [
    { module: 'fork-exec', label: 'fork/exec' },
    { module: 'session-jobctl', label: 'セッション' },
    { module: 'signal-delivery', label: 'SIGHUP' },
  ],
  'process-memory': [
    { module: 'fork-exec', label: 'fork とメモリコピー' },
  ],
  'terminal-modes': [
    { module: 'pty-dataflow', label: 'PTY' },
  ],
  'pty-dataflow': [
    { module: 'terminal-modes', label: 'termios' },
    { module: 'pipe-fifo', label: 'パイプとの比較' },
    { module: 'session-jobctl', label: 'セッションと PTY' },
  ],
  'socket-api': [
    { module: 'fd-table', label: 'ソケットも fd' },
    { module: 'io-multiplexing', label: 'select/poll' },
    { module: 'fork-exec', label: 'fork + accept' },
  ],
  'io-multiplexing': [
    { module: 'pipe-fifo', label: 'パイプの多重化' },
    { module: 'socket-api', label: 'ソケット' },
  ],
};

/**
 * Render related module links as HTML.
 * Call from visualizer render() to show cross-links.
 */
export function renderRelatedLinks(currentModule) {
  const links = MODULE_RELATIONS[currentModule];
  if (!links || links.length === 0) return '';

  return `<div class="related-links">
    <span class="related-label">Related:</span>
    ${links.map(l => `<button class="related-btn" data-goto-module="${l.module}">${l.label}</button>`).join('')}
  </div>`;
}
