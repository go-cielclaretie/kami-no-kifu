'use strict';
const fs = require('node:fs'), path = require('node:path'), K = require('../js/core.js');
const dir = path.resolve(__dirname, '../samples'); fs.mkdirSync(dir, { recursive: true });
function save(name, data) { fs.writeFileSync(path.join(dir, name), data + '\n', 'utf8'); }
function randomGame(root, count, seed = 184917, minX = 0) {
  const rootNode = K.parse(`(;${root})`).games[0].nodes[0], size = K.dimensions(rootNode.props);
  const state = K.makeState(size, 0); K.applyNode(state, rootNode, size, 'japanese', []);
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let moves = '';
  for (let i = 0; i < count; i++) {
    let success = false;
    const color = state.next === 1 ? 'B' : 'W';
    for (let tries = 0; tries < 3000; tries++) {
      const x = minX + Math.floor(rnd() * (size.w - minX)), y = Math.floor(rnd() * size.h), p = y * size.w + x;
      if (state.board[p]) continue;
      const pos = K.coord(p, size);
      try { K.applyNode(state, { props: { [color]: [pos] } }, size, 'japanese', []); moves += `;${color}[${pos}]`; success = true; break; }
      catch (_) { /* Try another legal point. */ }
    }
    if (!success) { K.applyNode(state, { props: { [color]: [''] } }, size, 'japanese', []); moves += `;${color}[]`; }
  }
  return moves;
}
const common = 'FF[4]GM[1]CA[UTF-8]AP[KifuPrintWeb:1.0.0]PB[サンプル黒(10級)]PW[サンプル白(9級)]DT[2026-09-18]PC[動作確認用]EV[サンプル対局・架空の棋譜]RU[Japanese]KM[6.5]RE[B+R]';
const root = common + 'SZ[19]TM[600]OT[3x30 byo-yomi]C[ソフトウェアの確認用に生成した架空の対局。実際の対局ではありません。]';
save('01_demo_235.sgf', `(;${root}${randomGame(root, 235)})`);
save('02_capture_replay_9x9.sgf', `(;${common}SZ[9];B[bb];W[ab];B[hh];W[ba];B[hg];W[cb];B[gg];W[bc];B[gh];W[bb])`);
const root53 = common + 'SZ[19]AB[bc]PL[B]C[初期配置を含む人工的な検証棋譜。53手目が46手目と同地点です。]';
save('03_53_replays_46.sgf', `(;${root53}${randomGame(root53, 45, 870321, 5)};W[bb];B[ab];W[];B[ba];W[];B[cb];W[];B[bb])`);
save('04_handicap_13.sgf', '(;FF[4]GM[1]CA[UTF-8]SZ[13]PB[置碁の黒]PW[置碁の白]BR[10k]WR[5k]RU[Japanese]KM[0]HA[2]AB[dd][jj]RE[W+2.5];W[dj];B[jd];W[ff];B[hh])');
save('05_variations.sgf', `(;${common}SZ[19];B[dd];W[pp](;B[dp];W[pd])(;B[qd];W[dp](;B[cc])(;B[cd])))`);
save('06_missing_metadata.sgf', '(;FF[4]GM[1]CA[UTF-8]SZ[9]KM[0];B[cc];W[gg];B[cg];W[gc])');
save('07_fischer.sgf', `(;${common}SZ[9]TM[300]OT[Fischer 5];B[cc];W[gg];B[cg];W[gc])`);
save('invalid_occupied.sgf', `(;${common}SZ[9]C[意図的に不正。2手目が重複着手です。];B[dd];W[dd])`);
save('invalid_ko.sgf', '(;FF[4]GM[1]CA[UTF-8]SZ[9]PB[黒]PW[白]RU[Japanese]KM[0]RE[?]AB[ab][ba][bc]AW[bb][ca][cc][db]PL[B];B[cb];W[bb])');
for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sgf') && !n.startsWith('invalid'))) {
  const v = K.validateGame(K.parse(fs.readFileSync(path.join(dir, name), 'utf8')).games[0]);
  if (!v.ok) throw new Error(name + ': ' + v.errors.join('\n'));
}
console.log('Created and validated SGF samples.');
