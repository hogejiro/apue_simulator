/**
 * record-lock scenarios — byte-range locking visualizations
 */

import { F_RDLCK, F_WRLCK, F_UNLCK } from '../../core/lock-table.js';

export const SCENARIOS = [
  // =========================================================================
  // Basic read/write lock compatibility (Figure 14.3)
  // =========================================================================
  {
    label: 'Figure 14.3: ロックの互換性',
    figure: '14.3',
    description: 'Read lock (共有) は複数プロセスが同時取得可能。Write lock (排他) は他のどのロックとも共存できない。',
    steps: [
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_RDLCK, 0, 99});',
        apply: (lt) => { lt.setLock(1, F_RDLCK, 0, 99); },
        lesson: 'Process A がバイト 0-99 に read lock を取得。共有ロックなので、他のプロセスも同じ範囲を read lock できる。',
      },
      {
        code: '[Process B] fcntl(fd, F_SETLK,\n    {F_RDLCK, 50, 150});',
        apply: (lt) => { lt.setLock(2, F_RDLCK, 50, 150); },
        lesson: 'Process B もバイト 50-150 に read lock を取得。read + read = 互換なので成功。範囲が重なっていても問題ない。',
      },
      {
        code: '[Process C] fcntl(fd, F_SETLK,\n    {F_WRLCK, 80, 120});  // BLOCKED!',
        apply: (lt) => { lt.setLock(3, F_WRLCK, 80, 120); },
        lesson: 'Process C がバイト 80-120 に write lock を要求。しかし A (0-99) と B (50-150) の read lock と競合 → EAGAIN/EACCES で失敗。write lock は排他的 — 同じ範囲に他のどんなロックがあっても取得できない。',
      },
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_UNLCK, 0, 99});',
        apply: (lt) => { lt.setLock(1, F_UNLCK, 0, 99); },
        lesson: 'Process A が unlock。A のロックが消える。',
      },
      {
        code: '[Process C] fcntl(fd, F_SETLK,\n    {F_WRLCK, 0, 49});',
        apply: (lt) => { lt.setLock(3, F_WRLCK, 0, 49); },
        lesson: 'Process C がバイト 0-49 に write lock。B の read lock (50-150) とは重ならないので成功。ロック範囲を正確に指定することで並行性を高められる。',
      },
    ],
  },

  // =========================================================================
  // Lock splitting (Figure 14.5)
  // =========================================================================
  {
    label: 'Figure 14.5: ロックの分割と結合',
    figure: '14.5',
    description: 'ロック範囲の途中を unlock すると 2 つに分割される。隣接するロックを追加すると自動的に結合される。',
    steps: [
      {
        code: 'fcntl(fd, F_SETLK,\n    {F_WRLCK, 100, 199});',
        apply: (lt) => { lt.setLock(1, F_WRLCK, 100, 199); },
        lesson: 'バイト 100-199 に write lock。100 バイトの連続した範囲。',
      },
      {
        code: 'fcntl(fd, F_SETLK,\n    {F_UNLCK, 150, 150});',
        apply: (lt) => { lt.setLock(1, F_UNLCK, 150, 150); },
        lesson: 'バイト 150 だけを unlock。元のロック (100-199) が 2 つに分割: 100-149 と 151-199。カーネルが自動的にロックテーブルのエントリを分ける。',
      },
      {
        code: 'fcntl(fd, F_SETLK,\n    {F_WRLCK, 150, 150});',
        apply: (lt) => { lt.setLock(1, F_WRLCK, 150, 150); },
        lesson: 'バイト 150 を再度 write lock → 100-149 + 150 + 151-199 が隣接しているので自動的に結合。元の 100-199 に戻る。カーネルは隣接する同種ロックを自動的に merge する。',
      },
    ],
  },

  // =========================================================================
  // Lock upgrade (read → write)
  // =========================================================================
  {
    label: 'ロックのアップグレード: read → write',
    figure: '14.3',
    description: '同じプロセスが read lock を write lock に変更 (アップグレード) できる。ただし他プロセスが同じ範囲を read lock していると失敗。',
    steps: [
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_RDLCK, 0, 99});',
        apply: (lt) => { lt.setLock(1, F_RDLCK, 0, 99); },
        lesson: 'Process A が read lock を取得。',
      },
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_WRLCK, 0, 99});  // upgrade',
        apply: (lt) => { lt.setLock(1, F_WRLCK, 0, 99); },
        lesson: '同じプロセスが同じ範囲を write lock に変更。自分自身のロックは置き換えられるので成功。read lock が write lock になった。',
      },
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_RDLCK, 0, 99});  // downgrade',
        apply: (lt) => { lt.setLock(1, F_RDLCK, 0, 99); },
        lesson: 'ダウングレードも可能。write → read に戻す。排他性を下げることで他プロセスの read lock を許可する。',
      },
    ],
  },

  // =========================================================================
  // Deadlock scenario
  // =========================================================================
  {
    label: 'デッドロック: 2 プロセスの逆順ロック',
    figure: '14.8',
    description: '2 つのプロセスが逆の順序でロックを取ると、互いに相手を待つデッドロックが発生する。fcntl F_SETLKW は EDEADLK を返す。',
    steps: [
      {
        code: '[Process A] fcntl(fd, F_SETLK,\n    {F_WRLCK, 0, 0});',
        apply: (lt) => { lt.setLock(1, F_WRLCK, 0, 0); },
        lesson: 'Process A がバイト 0 を write lock。',
      },
      {
        code: '[Process B] fcntl(fd, F_SETLK,\n    {F_WRLCK, 1, 1});',
        apply: (lt) => { lt.setLock(2, F_WRLCK, 1, 1); },
        lesson: 'Process B がバイト 1 を write lock。ここまでは問題なし。',
      },
      {
        code: '[Process A] fcntl(fd, F_SETLKW,\n    {F_WRLCK, 1, 1});  // waits for B...',
        apply: (lt) => { lt.setLock(1, F_WRLCK, 1, 1); },
        lesson: 'Process A がバイト 1 を要求 → Process B が持っているので待ち (F_SETLKW)。',
      },
      {
        code: '[Process B] fcntl(fd, F_SETLKW,\n    {F_WRLCK, 0, 0});  // EDEADLK!',
        apply: (lt) => { lt.setLock(2, F_WRLCK, 0, 0); },
        lesson: 'Process B がバイト 0 を要求 → Process A が持っているので待ち... だが A は B を待っている → 循環待ち = デッドロック! カーネルはこれを検出して EDEADLK を返す。解決策: ロック順序を統一する (常に小さいバイト番号から)。',
      },
    ],
  },
];
