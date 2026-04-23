/**
 * process-memory scenarios — memory layout (Figure 7.6)
 *
 * State is a plain object representing memory segments.
 */

export const SCENARIOS = [
  {
    label: 'Figure 7.6: プロセスのメモリ配置',
    figure: '7.6',
    description: 'C プログラムのメモリは text (コード) / data (初期化済みグローバル) / bss (未初期化グローバル) / heap (malloc) / stack (関数呼び出し) の 5 セグメントに分かれる。heap は上方向 (低→高)、stack は下方向 (高→低) に成長する。',
    initialState: () => ({
      segments: [
        { name: 'text', label: 'Text (code)', size: 100, color: 'var(--accent2)', items: ['main()', 'printf()', 'calc()'] },
        { name: 'data', label: 'Initialized Data', size: 30, color: 'var(--green)', items: ['int maxcount = 99;', 'char msg[] = "hello";'] },
        { name: 'bss', label: 'BSS (uninitialized)', size: 20, color: 'var(--yellow)', items: ['long sum[1000];', 'int flag;'] },
        { name: 'heap', label: 'Heap ↑', size: 0, color: 'var(--purple)', items: [] },
        { name: 'gap', label: '(free space)', size: 200, color: 'transparent', items: [] },
        { name: 'stack', label: 'Stack ↓', size: 40, color: 'var(--accent)', items: ['main(): argc, argv'] },
      ],
      envArgs: ['HOME=/home/user', 'PATH=/usr/bin:/bin', 'argv[0]="./a.out"'],
    }),
    steps: [
      {
        code: 'int main(int argc, char *argv[]) {',
        apply: (s) => {
          s.segments[5].items = ['main(): argc=1, argv, local vars'];
        },
        lesson: 'プログラム開始。main のスタックフレームが作られる。argc, argv, ローカル変数がスタックに置かれる。環境変数と引数文字列はスタックの上 (高位アドレス) に置かれる。',
      },
      {
        code: 'char *p = malloc(256);',
        apply: (s) => {
          s.segments[3].size = 30;
          s.segments[3].items = ['malloc(256): p → 0x...'];
          s.segments[4].size = 170;
        },
        lesson: 'malloc でヒープが成長。ヒープは bss の直後から上方向 (高位アドレス方向) に伸びる。sbrk(2) システムコールでヒープの上限 (program break) を上げる。',
      },
      {
        code: 'calc(p, 100);  // function call',
        apply: (s) => {
          s.segments[5].size = 70;
          s.segments[5].items = ['main(): argc, argv, p', 'calc(): p, n=100, local vars'];
          s.segments[4].size = 140;
        },
        lesson: '関数 calc() を呼ぶとスタックが下方向に成長。新しいスタックフレームに引数と局所変数が置かれる。スタックとヒープは互いに向かって伸びる — 衝突するとスタックオーバーフロー。',
      },
      {
        code: 'p = realloc(p, 1024);',
        apply: (s) => {
          s.segments[3].size = 60;
          s.segments[3].items = ['realloc(1024): p → 0x...'];
          s.segments[4].size = 110;
        },
        lesson: 'realloc でヒープがさらに成長。元の 256 バイトを 1024 バイトに拡張。十分な連続空間がなければ新しい場所に移動してコピーする。',
      },
      {
        code: '// calc returns',
        apply: (s) => {
          s.segments[5].size = 40;
          s.segments[5].items = ['main(): argc, argv, p'];
          s.segments[4].size = 140;
        },
        lesson: 'calc() から return。スタックフレームが解放されスタックポインタが戻る。スタックの「メモリ」は実際には解放されない (ポインタが動くだけ)。これが「return 後のローカル変数のアドレスを使ってはいけない」理由。',
      },
      {
        code: 'free(p);',
        apply: (s) => {
          s.segments[3].size = 10;
          s.segments[3].items = ['(freed — available for reuse)'];
          s.segments[4].size = 190;
        },
        lesson: 'free でヒープメモリを解放。malloc ライブラリの内部フリーリストに戻される。OS に返されるとは限らない (sbrk は通常縮小しない)。free 後のポインタを使うと未定義動作 (use after free)。',
      },
    ],
  },
  {
    label: 'setjmp/longjmp とスタック',
    figure: '7.10',
    description: 'setjmp は現在のスタック状態を保存し、longjmp でそこに巻き戻る。関数をまたぐ goto。スタックの巻き戻しを可視化する。',
    initialState: () => ({
      segments: [
        { name: 'text', label: 'Text (code)', size: 100, color: 'var(--accent2)', items: ['main()', 'do_work()', 'parse()'] },
        { name: 'data', label: 'Initialized Data', size: 20, color: 'var(--green)', items: ['jmp_buf env;'] },
        { name: 'bss', label: 'BSS', size: 10, color: 'var(--yellow)', items: [] },
        { name: 'heap', label: 'Heap', size: 10, color: 'var(--purple)', items: [] },
        { name: 'gap', label: '(free space)', size: 180, color: 'transparent', items: [] },
        { name: 'stack', label: 'Stack', size: 30, color: 'var(--accent)', items: ['main()'] },
      ],
      envArgs: ['argv[0]="./a.out"'],
    }),
    steps: [
      {
        code: 'if (setjmp(env) != 0) {\n    printf("recovered!\\n");\n    return 1;\n}',
        apply: (s) => {
          s.segments[1].items = ['jmp_buf env; // saved here'];
          s.segments[5].items = ['main(): setjmp point saved'];
        },
        lesson: 'setjmp は現在のレジスタ (PC, SP, etc.) を jmp_buf に保存し、0 を返す。if の本体はスキップされる。jmp_buf はグローバルまたは static に置く (スタック上だと longjmp 時に破壊されている可能性がある)。',
      },
      {
        code: 'do_work();',
        apply: (s) => {
          s.segments[5].size = 50;
          s.segments[5].items = ['main(): setjmp point', 'do_work(): local vars'];
          s.segments[4].size = 160;
        },
        lesson: 'do_work() を呼び出し、スタックが成長。',
      },
      {
        code: '// inside do_work:\nparse(input);',
        apply: (s) => {
          s.segments[5].size = 75;
          s.segments[5].items = ['main(): setjmp point', 'do_work(): local vars', 'parse(): buf, ptr'];
          s.segments[4].size = 135;
        },
        lesson: 'parse() がさらに呼ばれ、スタックが 3 段に。通常の return は parse→do_work→main の順で戻る。',
      },
      {
        code: '// parse error detected!\nlongjmp(env, 1);',
        apply: (s) => {
          s.segments[5].size = 30;
          s.segments[5].items = ['main(): setjmp returns 1'];
          s.segments[4].size = 180;
        },
        lesson: 'longjmp で setjmp の地点に一気に巻き戻る。parse と do_work のスタックフレームはスキップされる (デストラクタも呼ばれない)。setjmp が今度は 1 を返す → if の本体が実行される。C でのエラーハンドリングの原始的な形。',
      },
    ],
  },
  {
    label: '環境変数と引数のメモリ配置',
    figure: '7.5',
    description: '環境変数と引数文字列はスタックの上 (高位アドレス) に置かれる。putenv/setenv で変更するとヒープに新しいメモリが割り当てられることがある。',
    initialState: () => ({
      segments: [
        { name: 'text', label: 'Text (code)', size: 80, color: 'var(--accent2)', items: ['main()'] },
        { name: 'data', label: 'Data', size: 20, color: 'var(--green)', items: [] },
        { name: 'bss', label: 'BSS', size: 10, color: 'var(--yellow)', items: [] },
        { name: 'heap', label: 'Heap', size: 0, color: 'var(--purple)', items: [] },
        { name: 'gap', label: '(free space)', size: 230, color: 'transparent', items: [] },
        { name: 'stack', label: 'Stack', size: 30, color: 'var(--accent)', items: ['main(): argc=2'] },
      ],
      envArgs: ['HOME=/home/user', 'PATH=/usr/bin', 'TERM=xterm', 'argv[0]="./prog"', 'argv[1]="hello"'],
    }),
    steps: [
      {
        code: 'char *home = getenv("HOME");',
        apply: (s) => {
          s.segments[5].items = ['main(): argc=2, home="/home/user"'];
        },
        lesson: 'getenv は環境変数リストを線形探索し、値へのポインタを返す。環境変数は name=value 形式の文字列配列で、スタック上部に格納されている。',
      },
      {
        code: 'setenv("MYVAR", "value123", 1);',
        apply: (s) => {
          s.segments[3].size = 15;
          s.segments[3].items = ['setenv: "MYVAR=value123"'];
          s.segments[4].size = 215;
          s.envArgs.push('MYVAR=value123');
        },
        lesson: 'setenv は新しい name=value 文字列のためにヒープから malloc する。元の環境変数領域 (スタック上部) には収まらない場合があるため。environ ポインタ配列自体も再割り当てされることがある。',
      },
      {
        code: 'putenv("LANG=ja_JP.UTF-8");',
        apply: (s) => {
          s.envArgs.push('LANG=ja_JP.UTF-8');
        },
        lesson: 'putenv は渡された文字列そのものを環境に配置する (コピーしない)。そのため、自動変数のアドレスを渡すと関数リターン後に壊れる。setenv はコピーを作るのでこの問題がない。',
      },
    ],
  },
];
