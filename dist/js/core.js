/* Kifu Print Web — SGF parser, rule checker and diagram model.
 * All SGF processing is local. No dependencies. UMD export supports Node tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KifuCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, nodes: 12000, depth: 128,
    games: 16, branches: 128, dimension: 25, pages: 300, field: 600, notes: 12000 });
  const SINGLE = new Set(('B W KO MN PL C N DM GB GW HO UC V BM DO IT TE FF GM SZ CA AP ST AN BR BT CP DT EV GN GC HA KM ON OT PB PC PW RE RO RU SO TM US WR WT BL OB OW WL FG PM').split(' '));
  const ROOT_ONLY = new Set(['FF', 'GM', 'SZ', 'CA', 'AP', 'ST']);
  const POINTS = new Set('AB AW AE CR DD MA SL SQ TR TB TW VW'.split(' '));
  const KNOWN = new Set([...SINGLE, ...POINTS, ...'AR LN LB'.split(' ')]);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const first = (p, k, fallback = '') => own(p, k) ? p[k][0] : fallback;
  const simple = s => String(s || '').replace(/[\r\n\t\f\v]/g, ' ').trim();
  const warn = (a, msg) => { if (a.length < 80 && !a.includes(msg)) a.push(msg); };
  class SgfError extends Error {
    constructor(message, position = -1, kind = 'invalid') {
      super(message); this.name = 'SgfError'; this.position = position; this.kind = kind;
    }
  }
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new SgfError('SGFが空です。');
    if (text.length > LIMITS.bytes) throw new SgfError('SGFが大きすぎます（上限5 MiB）。', -1, 'limit');
    text = text.replace(/^\uFEFF/, '');
    let i = 0, count = 0;
    const warnings = [];
    const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    const fail = msg => {
      const line = text.slice(0, i).split('\n').length;
      const col = i - text.lastIndexOf('\n', i - 1);
      throw new SgfError(`${msg}（${line}行 ${col}列）`, i);
    };
    function value() {
      i++; // '['
      let out = '';
      while (i < text.length) {
        let ch = text[i++];
        if (ch === ']') return out;
        if (ch === '\\') {
          if (i >= text.length) fail('エスケープの直後にファイルが終わっています');
          ch = text[i++];
          if (ch === '\r' || ch === '\n') {
            if ((ch === '\r' && text[i] === '\n') || (ch === '\n' && text[i] === '\r')) i++;
          } else out += ch;
        } else if (ch === '\r') {
          if (text[i] === '\n') i++;
          out += '\n';
        } else if (ch === '\0') fail('NUL文字が含まれています');
        else out += ch;
      }
      fail('プロパティ値を閉じる ] がありません');
    }
    function node() {
      const pos = i++;
      if (++count > LIMITS.nodes) throw new SgfError(`ノード数が上限${LIMITS.nodes}を超えています。`, pos, 'limit');
      const props = Object.create(null);
      ws();
      while (i < text.length && /[A-Za-z]/.test(text[i])) {
        let id = '';
        while (i < text.length && /[A-Za-z]/.test(text[i])) id += text[i++];
        if (id !== id.toUpperCase()) fail(`プロパティ名 ${id} は大文字で記述してください`);
        if (own(props, id)) fail(`同じノードに ${id} が重複しています`);
        ws();
        if (text[i] !== '[') fail(`${id} の値を囲む [ ] がありません`);
        const values = [];
        while (text[i] === '[') { values.push(value()); ws(); }
        props[id] = values;
      }
      return { props, pos, serial: count };
    }
    function tree(depth) {
      if (depth > LIMITS.depth) throw new SgfError('分岐が深すぎます。', i, 'limit');
      if (text[i] !== '(') fail('ゲーム木を開始する ( がありません');
      i++; ws();
      const nodes = [], children = [];
      while (text[i] === ';') { nodes.push(node()); ws(); }
      if (!nodes.length) fail('空のゲーム木は読み込めません');
      while (text[i] === '(') { children.push(tree(depth + 1)); ws(); }
      if (text[i] !== ')') fail('ゲーム木を閉じる ) がないか、予期しない文字があります');
      i++;
      return { nodes, children };
    }
    ws();
    const games = [];
    while (text[i] === '(') {
      if (games.length >= LIMITS.games) throw new SgfError('1ファイル内の対局は16局までです。', i, 'limit');
      games.push(tree(0)); ws();
    }
    if (!games.length) fail('SGFは (; で始まるゲーム木を含む必要があります');
    if (i !== text.length) fail('ゲーム木の外に余分な文字があります');
    return { games, warnings, nodeCount: count };
  }
  function decode(bytes, forced = 'auto') {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!data.length) throw new SgfError('選択したファイルは空です。');
    if (data.length > LIMITS.bytes) throw new SgfError('ファイルは5 MiB以下にしてください。', -1, 'limit');
    const warnings = [];
    let encoding = forced;
    if (forced === 'auto') {
      if (data[0] === 0xff && data[1] === 0xfe) encoding = 'utf-16le';
      else if (data[0] === 0xfe && data[1] === 0xff) encoding = 'utf-16be';
      else if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) encoding = 'utf-8';
      else {
        // Parse the byte-preserving representation; never mistake CA[...] in a comment for CA.
        let declared = '';
        try {
          const latin = new TextDecoder('windows-1252').decode(data);
          declared = first(parse(latin).games[0].nodes[0].props, 'CA').trim();
        } catch (_) { /* The Unicode parser below reports structural errors. */ }
        const aliases = { utf8: 'utf-8', utf_8: 'utf-8', gb2312: 'gb18030', gbk: 'gb18030',
          sjis: 'shift_jis', shiftjis: 'shift_jis', 'shift-jis': 'shift_jis', cp932: 'shift_jis',
          eucjp: 'euc-jp', latin1: 'windows-1252', 'iso-8859-1': 'windows-1252' };
        if (declared) encoding = aliases[declared.toLowerCase()] || declared;
        else {
          try { new TextDecoder('utf-8', { fatal: true }).decode(data); encoding = 'utf-8'; }
          catch (_) {
            throw new SgfError('CA（文字コード指定）のない非UTF-8ファイルです。「文字コード」を選んで読み直してください。', -1, 'encoding');
          }
          warn(warnings, 'CA指定なし：UTF-8として読み込みました。文字化け時は文字コードを指定して読み直してください。');
        }
      }
    }
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(data); }
    catch (_) { throw new SgfError(`文字コード ${encoding} では正しく復号できません。文字コードを選び直してください。`, -1, 'encoding'); }
    if (text.includes('\uFFFD')) warn(warnings, '置換文字「�」が含まれています。名前などの文字化けを確認してください。');
    return { text, encoding, warnings };
  }
  function dimensions(props) {
    const s = first(props, 'SZ', '19');
    if (!/^\d+(?::\d+)?$/.test(s)) throw new SgfError(`盤サイズ SZ[${s}] が不正です。`);
    const parts = s.split(':').map(Number), w = parts[0], h = parts[1] || w;
    if (w < 2 || h < 2 || w > LIMITS.dimension || h > LIMITS.dimension)
      throw new SgfError('この版で扱える盤は縦横2〜25路です。26〜52路は未対応です。', -1, 'unsupported');
    return { w, h };
  }
  function point(s, size, passAllowed = false) {
    if (passAllowed && (s === '' || (s === 'tt' && size.w <= 19 && size.h <= 19))) return -1;
    if (!/^[a-zA-Z]{2}$/.test(s)) throw new SgfError(`座標「${s}」が不正です。`);
    const idx = ch => ch <= 'Z' ? ch.charCodeAt(0) - 65 + 26 : ch.charCodeAt(0) - 97;
    const x = idx(s[0]), y = idx(s[1]);
    if (x >= size.w || y >= size.h) throw new SgfError(`座標「${s}」は${size.w}×${size.h}路盤の外です。`);
    return y * size.w + x;
  }
  function pointList(values, size, allowEmpty = false) {
    const out = [], seen = new Set();
    for (const s of values) {
      if (s === '' && allowEmpty && values.length === 1) continue;
      const parts = s.split(':');
      if (parts.length > 2) throw new SgfError(`座標範囲「${s}」が不正です。`);
      const p = point(parts[0], size), q = parts.length === 2 ? point(parts[1], size) : p;
      const ax = p % size.w, ay = Math.floor(p / size.w), bx = q % size.w, by = Math.floor(q / size.w);
      if (ax > bx || ay > by) throw new SgfError(`座標範囲「${s}」の開始と終了が逆です。`);
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        const v = y * size.w + x;
        if (seen.has(v)) throw new SgfError(`座標リスト内で ${coord(v, size)} が重複しています。`);
        seen.add(v); out.push(v);
      }
    }
    return out;
  }
  function coord(p, size) { return String.fromCharCode(97 + p % size.w) + String.fromCharCode(97 + Math.floor(p / size.w)); }
  function standardKanji(n) {
    const k = '〇一二三四五六七八九';
    if (n < 10) return k[n];
    if (n === 100) return '百';
    return (n >= 20 ? k[Math.floor(n / 10)] : '') + '十' + (n % 10 ? k[n % 10] : '');
  }
  function compactKanji(n) {
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new RangeError('漢数字手数は1〜100です。');
    if (n <= 20 || n % 10 === 0) return standardKanji(n);
    return '一二三四五六七八九'[Math.floor(n / 10) - 1] + '一二三四五六七八九'[n % 10 - 1];
  }
  function listBranches(tree) {
    const out = [];
    function visit(t, path, nodes) {
      const next = nodes.concat(t.nodes);
      if (!t.children.length) {
        if (out.length >= LIMITS.branches) throw new SgfError('分岐は1対局あたり128本までです。', -1, 'limit');
        out.push({ path, nodes: next, label: out.length === 0 ? '本譜（最初の分岐）' : `変化 ${path.map(n => n + 1).join(' → ')}` });
      } else t.children.forEach((c, j) => visit(c, path.concat(j), next));
    }
    visit(tree, [], []); return out;
  }
  function ruleFrom(s) {
    s = String(s).toLowerCase();
    if (/japan|日本/.test(s)) return 'japanese';
    if (/chinese|china|中国|中國/.test(s)) return 'chinese';
    return '';
  }
  function group(board, p, size) {
    const color = board[p], stack = [p], stones = [], seen = new Set([p]), liberties = new Set();
    while (stack.length) {
      const a = stack.pop(); stones.push(a);
      for (const n of neighbors(a, size)) {
        if (!board[n]) liberties.add(n);
        else if (board[n] === color && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    return { stones, liberties };
  }
  function neighbors(p, size) {
    const x = p % size.w, y = Math.floor(p / size.w), a = [];
    if (x) a.push(p - 1); if (x + 1 < size.w) a.push(p + 1);
    if (y) a.push(p - size.w); if (y + 1 < size.h) a.push(p + size.w);
    return a;
  }
  const hash = b => Array.from(b).join('');
  function makeState(size, handicap) {
    const board = new Uint8Array(size.w * size.h);
    return { board, origins: new Int32Array(board.length), next: handicap >= 2 ? 2 : 1,
      explicitPlayer: false, n: 0, captures: [0, 0, 0], previous: null, seen: new Set([hash(board)]),
      handicap, setupChecked: false, lastPass: false, infoSeen: false };
  }
  function cloneState(s) {
    return { ...s, board: s.board.slice(), origins: s.origins.slice(), captures: s.captures.slice(), seen: new Set(s.seen) };
  }
  function checkProps(node, size, isRoot, warnings) {
    const p = node.props;
    for (const [k, v] of Object.entries(p)) {
      if (SINGLE.has(k) && v.length !== 1) throw new SgfError(`${k} は1つの値だけを持てます。`, node.pos);
      if (!isRoot && ROOT_ONLY.has(k)) throw new SgfError(`${k} はルートノードにだけ記載できます。`, node.pos);
      if (!KNOWN.has(k)) warn(warnings, `独自・未対応プロパティ ${k} は保存用の図には反映しません。`);
      if (POINTS.has(k)) pointList(v, size, ['DD', 'VW', 'TB', 'TW'].includes(k));
      if (k === 'LB') for (const s of v) {
        if (s[2] !== ':') throw new SgfError('LBラベルは座標:文字の形式で指定してください。', node.pos);
        point(s.slice(0, 2), size);
      }
      if (['AR', 'LN'].includes(k)) for (const s of v) {
        if (!/^[A-Za-z]{2}:[A-Za-z]{2}$/.test(s)) throw new SgfError(`${k} の線の指定が不正です。`, node.pos);
        point(s.slice(0, 2), size); point(s.slice(3), size);
      }
      if (['KM', 'TM', 'BL', 'WL', 'V'].includes(k) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v[0]))
        throw new SgfError(`${k}[${v[0]}] は数値で指定してください。`, node.pos);
      if (['TM', 'BL', 'WL'].includes(k) && Number(v[0]) < 0) throw new SgfError(`${k} は0以上で指定してください。`, node.pos);
      if (['HA', 'MN', 'OB', 'OW'].includes(k) && !/^\d+$/.test(v[0])) throw new SgfError(`${k} は0以上の整数で指定してください。`, node.pos);
      if (['PL'].includes(k) && !['B', 'W'].includes(v[0])) throw new SgfError('PLはBまたはWで指定してください。', node.pos);
      if (['KO', 'DO', 'IT'].includes(k) && v[0] !== '') throw new SgfError(`${k} は空の値 [] で指定してください。`, node.pos);
      if (['DM', 'GB', 'GW', 'HO', 'UC', 'BM', 'TE'].includes(k) && !['1', '2'].includes(v[0])) throw new SgfError(`${k} は1または2で指定してください。`, node.pos);
      if (['CR', 'DD', 'MA', 'SL', 'SQ', 'TR', 'TB', 'TW', 'VW', 'AR', 'LN', 'LB', 'FG', 'PM'].includes(k))
        warn(warnings, 'SGFのマーク・地合いマーク・部分表示指定は印刷しません。着手から棋譜図を作成します。');
    }
    if (own(p, 'B') && own(p, 'W')) throw new SgfError('同じノードにBとWを同時に記載できません。', node.pos);
    const move = own(p, 'B') || own(p, 'W');
    if (move && ['AB', 'AW', 'AE', 'PL'].some(k => own(p, k))) throw new SgfError('着手と初期配置・PLを同じノードに混在できません。', node.pos);
    if (own(p, 'KO') && !move) throw new SgfError('KOは着手のあるノードに記載してください。', node.pos);
    if (own(p, 'TB') && own(p, 'TW')) {
      const black = new Set(pointList(p.TB, size, true));
      if (pointList(p.TW, size, true).some(q => black.has(q))) throw new SgfError('同一地点を黒地と白地の両方に指定しています。', node.pos);
    }
    if (own(p, 'MN')) warn(warnings, 'MNによる表示番号の変更は採用せず、B/Wの実手順をパス込みで1から数えます。');
  }
  function checkSetup(s, size) {
    if (s.setupChecked) return;
    const checked = new Set();
    for (let p = 0; p < s.board.length; p++) if (s.board[p] && !checked.has(p)) {
      const g = group(s.board, p, size); g.stones.forEach(q => checked.add(q));
      if (!g.liberties.size) throw new SgfError(`初期配置の ${coord(p, size)} に呼吸点のない石があります。`);
    }
    const black = Array.from(s.board).filter(v => v === 1).length;
    if (s.handicap >= 2 && black !== s.handicap)
      throw new SgfError(`HA[${s.handicap}] と初期配置の黒石${black}個が一致しません。置石の座標ABが必要です。`);
    s.setupChecked = true;
  }
  function applyNode(s, node, size, rule, warnings) {
    const p = node.props;
    const setup = ['AB', 'AW', 'AE', 'PL'].some(k => own(p, k));
    if (setup) {
      if (s.n) throw new SgfError('対局途中のAB/AW/AE/PLによる局面編集は、この印刷版では未対応です（SGF自体が不正とは限りません）。', node.pos, 'unsupported');
      const occupied = new Set();
      for (const [k, color] of [['AE', 0], ['AB', 1], ['AW', 2]]) if (own(p, k)) {
        for (const q of pointList(p[k], size)) {
          if (occupied.has(q)) throw new SgfError(`初期配置 ${coord(q, size)} の指定が重複・競合しています。`, node.pos);
          occupied.add(q); s.board[q] = color; s.origins[q] = 0;
        }
      }
      if (own(p, 'PL')) { s.next = first(p, 'PL') === 'B' ? 1 : 2; s.explicitPlayer = true; }
      else if (!s.explicitPlayer) {
        const b = Array.from(s.board).filter(v => v === 1).length, w = s.board.includes(2);
        s.next = s.handicap >= 2 || (b >= 2 && !w) ? 2 : 1;
      }
      s.seen = new Set([hash(s.board)]); s.previous = null; s.setupChecked = false;
    }
    const color = own(p, 'B') ? 1 : own(p, 'W') ? 2 : 0;
    if (!color) return null;
    checkSetup(s, size);
    if (color !== s.next) throw new SgfError(`${s.n + 1}手目：手番が不正です。${s.next === 1 ? '黒' : '白'}番のところに${color === 1 ? '黒' : '白'}の着手があります。`, node.pos);
    const q = point(first(p, color === 1 ? 'B' : 'W'), size, true), old = hash(s.board);
    const event = { n: s.n + 1, color, p: q, captured: [], pass: q < 0 };
    if (q >= 0) {
      if (s.board[q]) throw new SgfError(`${event.n}手目：${coord(q, size)} は既に石がある地点です。`, node.pos);
      const next = s.board.slice(); next[q] = color;
      const enemy = 3 - color;
      for (const a of neighbors(q, size)) if (next[a] === enemy) {
        const g = group(next, a, size);
        if (!g.liberties.size) for (const t of g.stones) { next[t] = 0; event.captured.push(t); }
      }
      if (!group(next, q, size).liberties.size) throw new SgfError(`${event.n}手目：${coord(q, size)} は自殺手です。`, node.pos);
      const key = hash(next);
      if (key === s.previous) throw new SgfError(`${event.n}手目：コウの即時取り返しです。`, node.pos);
      if (rule === 'chinese' && s.seen.has(key)) throw new SgfError(`${event.n}手目：過去と同じ盤面になるため、中国ルール用の同形反復禁止検査に不合格です。`, node.pos);
      if (rule !== 'chinese' && s.seen.has(key)) warn(warnings, '長周期の同形反復があります。日本ルールでの無勝負・合意などの裁定は自動判定しません。');
      s.board = next; s.origins[q] = event.n;
      event.captured.forEach(t => { s.origins[t] = 0; });
      s.captures[color] += event.captured.length; s.seen.add(key);
    }
    if (q < 0 && s.lastPass) warn(warnings, '連続パスがあります。終局の合意・再開の可否は自動判定しません。');
    s.previous = old; s.n++; s.next = 3 - color; s.lastPass = q < 0;
    event.captures = s.captures.slice();
    return event;
  }
  function validateGame(tree, ruleOverride = '') {
    const warnings = [], errors = [];
    let size, branches;
    const root = tree.nodes[0].props;
    try {
      const gm = first(root, 'GM', '1'), ff = first(root, 'FF', '4');
      if (gm !== '1') throw new SgfError(`GM[${gm}] は囲碁ではありません。`, -1, 'unsupported');
      if (!['1', '2', '3', '4'].includes(ff)) throw new SgfError(`FF[${ff}] は未対応です。`, -1, 'unsupported');
      if (ff !== '4' || !own(root, 'FF')) warn(warnings, '旧形式またはFF指定なしのSGFを互換読み込みしています。');
      size = dimensions(root); branches = listBranches(tree);
    } catch (e) { return { ok: false, errors: [e.message], errorKinds: [e.kind || 'invalid'], warnings, size: null, branches: [] }; }
    const inferred = ruleFrom(first(root, 'RU'));
    const rule = ruleOverride || inferred || 'japanese';
    if (!inferred && !ruleOverride) warn(warnings, 'ルール未確定：基本的な着手検査のみ実施しました。対局情報でルールを選ぶと再検査します。');
    if (first(root, 'RU') && !inferred && !ruleOverride) warn(warnings, `RU[${first(root, 'RU')}] は日本／中国に自動分類できません。手動で選択してください。`);
    const ha = Number(first(root, 'HA', '0'));
    if (own(root, 'HA') && ha < 2) warn(warnings, 'HA[0]／HA[1] は互換扱いです。置石はABの指定だけから再現します。');
    const kinds = [];
    function visit(t, s, path, isRootTree) {
      for (let j = 0; j < t.nodes.length; j++) {
        const node = t.nodes[j];
        try {
          checkProps(node, size, isRootTree && j === 0, warnings);
          if (own(node.props, 'HA') && !(isRootTree && j === 0)) throw new SgfError('この版ではHA（置石数）はルートに指定してください。', node.pos, 'unsupported');
          applyNode(s, node, size, rule, warnings);
        } catch (e) {
          if (errors.length < 40) { errors.push(`${path || '本譜'} / ノード${node.serial}：${e.message}`); kinds.push(e.kind || 'invalid'); }
          return;
        }
      }
      if (!t.children.length) {
        try { checkSetup(s, size); } catch (e) { errors.push(`${path || '本譜'}：${e.message}`); kinds.push(e.kind || 'invalid'); }
      }
      t.children.forEach((child, n) => visit(child, cloneState(s), `${path ? path + ' → ' : '分岐 '}${n + 1}`, false));
    }
    visit(tree, makeState(size, ha), '', true);
    return { ok: !errors.length, errors, errorKinds: kinds, warnings, size, branches, rule, inferredRule: inferred };
  }
  function replay(tree, branchIndex = 0, rule = '') {
    const result = validateGame(tree, rule);
    if (!result.ok) throw new SgfError(result.errors[0]);
    const branch = result.branches[branchIndex];
    if (!branch) throw new SgfError('指定した分岐がありません。');
    const s = makeState(result.size, Number(first(tree.nodes[0].props, 'HA', '0')));
    const events = [], snapshots = [];
    let initial = null;
    for (const node of branch.nodes) {
      const isMove = own(node.props, 'B') || own(node.props, 'W');
      if (isMove && !initial) { initial = { board: s.board.slice(), origins: s.origins.slice(), captures: [0, 0, 0] }; snapshots.push(initial); }
      const event = applyNode(s, node, result.size, result.rule, []);
      if (event) { events.push(event); snapshots.push({ board: s.board.slice(), origins: s.origins.slice(), captures: s.captures.slice() }); }
    }
    if (!initial) { initial = { board: s.board.slice(), origins: s.origins.slice(), captures: [0, 0, 0] }; snapshots.push(initial); }
    return { ...result, events, snapshots, initial, total: events.length, branch, branchIndex };
  }
  function parseResult(raw) {
    const s = simple(raw);
    if (!s || s === '?') return '';
    if (/^(0|draw|jigo)$/i.test(s)) return '持碁';
    if (/^void$/i.test(s)) return '無勝負';
    let m = /^([BW])\+(.+)$/i.exec(s);
    if (m) {
      const winner = m[1].toUpperCase() === 'B' ? '黒' : '白', v = m[2];
      if (/^(R|Resign)$/i.test(v)) return `${winner}中押し勝ち`;
      if (/^(T|Time)$/i.test(v)) return `${winner}時間切れ勝ち`;
      if (/^(F|Forfeit)$/i.test(v)) return `${winner}反則勝ち`;
      if (/^\d+(?:\.\d+)?$/.test(v)) return `${winner}${Number(v)}目勝ち`;
    }
    // A child is half a point; convert only when the unit 子 is explicit.
    m = /^([黒黑白BW])(?:\+)?\s*(\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)\s*子(?:勝ち|胜|勝)?$/i.exec(s);
    if (m) {
      const v = m[2]; let n;
      if (v.includes('/')) {
        const a = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(v);
        if (!a || Number(a[3]) === 0) return s;
        n = Number(a[1] || 0) + Number(a[2]) / Number(a[3]);
      } else n = Number(v);
      return `${/[黒黑B]/i.test(m[1]) ? '黒' : '白'}${Number((n / 2).toFixed(6))}目勝ち`;
    }
    m = /^([黒黑白])(?:中盘|中盤)(?:胜|勝|勝ち)$/.exec(s);
    if (m) return `${m[1] === '白' ? '白' : '黒'}中押し勝ち`;
    return s;
  }
  // OT is free text in SGF. Only explicit, recognized formats are mapped.
  // Main time alone does not prove sudden death; leave the mode for confirmation.
  const TIME_CONTROLS = Object.freeze({
    japanese: { label: '日本式', fields: [['minutes', '持ち時間（分）', 0], ['seconds', '秒読み（秒）', .001], ['periods', '回数（回）', 1, true]] },
    canadian: { label: 'カナダ式', fields: [['minutes', '持ち時間（分）', 0], ['overtimeMinutes', '予備時間（分）', .001], ['moves', '手数（手）', 1, true]] },
    fischer: { label: 'フィッシャー式', fields: [['minutes', '持ち時間（分）', 0], ['increment', '加算時間（秒）', 0]] },
    absolute: { label: '切れ負け', fields: [['minutes', '持ち時間（分）', 0]] },
    byoyomi: { label: '秒読み', fields: [['perMoveSeconds', '一手あたり（秒）', .001]] },
    nhk: { label: 'NHK杯式', fields: [['perMoveSeconds', '一手あたり（秒）', .001], ['seconds', '考慮時間（秒）', .001], ['periods', '回数（回）', 1, true]] }
  });
  function normalizeTime(time) {
    const out = { mode: '', minutes: '', increment: '', seconds: '', periods: '', overtimeMinutes: '', moves: '', perMoveSeconds: '', ...time };
    if (out.mode === 'swiss') out.mode = 'japanese'; // v1.2 form label migration
    return out;
  }
  function parseTime(tm, ot) {
    const base = tm !== '' && Number.isFinite(Number(tm)) ? String(Number(tm) / 60) : '';
    const out = normalizeTime({ enabled: tm !== '' || !!ot, minutes: base, raw: ot || '', recognized: !ot });
    const t = simple(ot); let m;
    // NHK: require the per-move allowance and consideration period explicitly.
    if ((m = /^(?:NHK(?:杯)?(?:式)?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)\s*\+\s*(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)$/i.exec(t))) {
      Object.assign(out, { mode: 'nhk', perMoveSeconds: m[1], periods: m[2], seconds: m[3], recognized: true });
    } else if ((m = /^(?:fischer|フィッシャー(?:式)?)\s*[:：+]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)?$/i.exec(t))) {
      Object.assign(out, { mode: 'fischer', increment: m[1], recognized: true });
    } else if ((m = /^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(s|sec|秒|m|min|分)?\s*canadian$/i.exec(t))) {
      Object.assign(out, { mode: 'canadian', moves: m[1], overtimeMinutes: String(Number(m[2]) / (/^(m|min|分)$/i.test(m[3] || '') ? 1 : 60)), recognized: true });
    } else if ((m = /^(?:canadian|カナダ式)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(s|sec|秒|m|min|分)\s*\/\s*(\d+)\s*(?:moves?|手)?$/i.exec(t))) {
      Object.assign(out, { mode: 'canadian', moves: m[3], overtimeMinutes: String(Number(m[1]) / (/^(m|min|分)$/i.test(m[2]) ? 1 : 60)), recognized: true });
    } else if (/^(?:absolute|sudden[- ]?death|切れ負け)$/i.test(t)) {
      Object.assign(out, { mode: 'absolute', recognized: true });
    } else if ((m = /^(\d+(?:\.\d+)?)\s*(?:s|sec|秒)\s*(?:\/\s*move|per\s+move|一手あたり)$/i.exec(t)) ||
               (m = /^(?:秒読み|一手あたり)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)$/i.exec(t))) {
      // With a nonzero main clock this is Japanese one-period overtime,
      // not the "no main time" per-move-only form.
      if (base !== '' && Number(base) > 0) Object.assign(out, { mode: 'japanese', seconds: m[1], periods: '1', recognized: true });
      else Object.assign(out, { mode: 'byoyomi', perMoveSeconds: m[1], recognized: true });
    } else if ((m = /^(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)?(?:\s*byo.?yomi)?$/i.exec(t)) ||
               (m = /^(?:byo.?yomi|日本式|秒読み)\s*[:：]?\s*(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒)?$/i.exec(t))) {
      Object.assign(out, { mode: 'japanese', periods: m[1], seconds: m[2], recognized: true });
    } else if ((m = /^(\d+(?:\.\d+)?)\s*秒\s*[x×*]\s*(\d+)\s*回?$/.exec(t))) {
      Object.assign(out, { mode: 'japanese', seconds: m[1], periods: m[2], recognized: true });
    }
    return out;
  }
  // Page selectors address board diagrams, never continuation pages. This
  // prevents pagination/selection feedback loops for long comments.
  function parsePageNumbers(text, count) {
    const result = new Set();
    const normalized = String(text || '').replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)).replace(/[，、]/g, ',').replace(/[〜～－–]/g, '-').trim();
    if (!normalized) throw new SgfError('任意ページの番号を入力してください（例：2,4-6）。');
    for (const part of normalized.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if (!m) throw new SgfError('任意ページは「2,4-6」のように指定してください。');
      const a = Number(m[1]), b = Number(m[2] || m[1]);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < a || b > count)
        throw new SgfError(`任意ページは1〜${count}の範囲で指定してください。`);
      for (let n = a; n <= b; n++) result.add(n);
    }
    return Array.from(result).sort((a, b) => a - b);
  }
  function notePages(input, count) {
    const s = normalizeSettings(input), p = s.notesPlacement, selected = new Set();
    if (p.all) return Array.from({ length: count }, (_, i) => i + 1);
    if (p.first) selected.add(1);
    if (p.last) selected.add(count);
    if (p.custom) parsePageNumbers(s.notesPageNumbers, count).forEach(n => selected.add(n));
    return Array.from(selected).sort((a, b) => a - b);
  }
  function notesForPage(m, input, page, count) {
    if (!m.include.notes || !notePages(input, count).includes(page)) return '';
    const s = normalizeSettings(input);
    return String(s.notesPlacement.all && s.notesAllMode === 'individual' ? (m.notesByPage || {})[page] || '' : m.notes || '');
  }
  function metadata(nodes) {
    const props = Object.create(null);
    for (const node of nodes) for (const [k, v] of Object.entries(node.props)) if (!own(props, k)) props[k] = v;
    const get = k => simple(first(props, k));
    function player(name, rank) {
      const match = /^(.*?)\s*[（(]((?:\d+|[一二三四五六七八九十百]+)(?:級|段|級位)|初段)[）)]\s*$/i.exec(name);
      if (match && (!rank || rank === match[2])) return [match[1].trim(), rank || match[2]];
      // Numeric English SGF ranks in parentheses, e.g. (10k).
      const en = /^(.*?)\s*[（(](\d+\s*[dkp])[）)]\s*$/i.exec(name);
      if (en && (!rank || rank === en[2])) return [en[1].trim(), rank || en[2]];
      return [name, rank];
    }
    const [black, blackRank] = player(get('PB'), get('BR'));
    const [white, whiteRank] = player(get('PW'), get('WR'));
    const ha = Number(get('HA') || 0), komi = get('KM');
    // KM[0] alone does not prove 定先. Do not silently invent this mandatory field.
    const handicap = ha >= 2 ? `${ha}子局` : komi !== '' && Number(komi) !== 0 ? '互先' : '';
    const time = parseTime(get('TM'), get('OT'));
    const m = { event: get('EV'), place: get('PC'), date: get('DT'), black, blackRank, white, whiteRank,
      handicap, rule: ruleFrom(get('RU')), komi, result: parseResult(get('RE')), notes: '', notesByPage: {}, time,
      originalRule: get('RU'), originalResult: get('RE'), originalHandicap: get('HA'), include: {} };
    for (const k of ['event', 'place', 'date', 'blackRank', 'whiteRank', 'notes']) m.include[k] = !!m[k];
    m.include.time = time.enabled;
    // Notes start empty but are ready for immediate publication when entered.
    m.include.notes = true;
    return m;
  }
  function defaults() {
    return { showTitle: true, infoDirection: 'horizontal', infoLayoutHorizontal: 'balanced', infoLayoutVertical: 'balanced',
      infoVariant: 'accent', infoPatternVertical: '1', fonts: { title: 'default', info: 'default', number: 'auto' }, fontFamilies: { title: '', info: '', number: '' },
      dateFormat: 'dash', dateCalendar: 'gregorian', scoreFormat: 'decimal', komiFormat: 'decimal', resultFormat: 'decimal', sameScoreFormat: true,
      notesPlacement: { first: false, last: true, custom: false, all: false }, notesPageNumbers: '', notesAllMode: 'same', mode: 'all', split: '100', customSplit: 100, coordinates: true,
      positions: { top: true, bottom: false, right: false, left: true }, coordFormat: 'num-kanji',
      numbers: true, numberStyle: 'arabic', boardColor: 'bw', customBoard: '#e5c47d', grain: 'plain',
      stoneColor: 'bw', blackColor: '#171717', whiteColor: '#ffffff', blackPattern: 'plain', whitePattern: 'plain',
      shadow: false, captures: 'show', repeats: true, repeatBracket: 'round', repeatPosition: 'bottom',
      repeatStones: false, repeatStoneStyle: 'beside', paper: 'A4', orientation: 'portrait', format: 'pdf', dpi: 300 };
  }
  function normalizeSettings(input) {
    const base = defaults();
    const imported = JSON.parse(JSON.stringify(input || {}));
    const s = { ...base, ...imported };
    if (!Object.prototype.hasOwnProperty.call(imported, 'infoVariant')) {
      const legacy = imported.infoDirection === 'vertical' ? imported.infoVariantVertical : imported.infoVariantHorizontal;
      if (legacy) s.infoVariant = legacy;
    }
    delete s.infoVariantHorizontal; delete s.infoVariantVertical;
    s.positions = { ...base.positions, ...s.positions };
    s.notesPlacement = { ...base.notesPlacement, ...s.notesPlacement };
    s.fonts = { ...base.fonts, ...s.fonts };
    s.fontFamilies = { ...base.fontFamilies, ...s.fontFamilies };
    // Migrate v1.0/v1.1's radio setting without treating 'hide' as truthy.
    if (s.repeatStones === 'show' || s.repeatStones === 'hide') s.repeatStones = s.repeatStones === 'show';
    const locked = s.numbers && s.numberStyle === 'kanji';
    if (locked) {
      if (!s.paginationBeforeKanji) s.paginationBeforeKanji = { mode: s.mode, split: s.split, customSplit: s.customSplit };
      s.mode = 'split'; s.split = '100'; s.customSplit = 100;
    } else if (s.paginationBeforeKanji) {
      const old = s.paginationBeforeKanji;
      s.mode = old.mode; s.split = old.split; s.customSplit = old.customSplit;
      delete s.paginationBeforeKanji;
    }
    return s;
  }
  function validateSettings(input) {
    const s = normalizeSettings(input), e = [];
    const choices = { infoLayoutHorizontal: ['balanced', 'table', 'cards', 'bands', 'focus'], infoLayoutVertical: ['balanced', 'table', 'tiles', 'focus', 'groups'], infoVariant: ['base', 'classic', 'accent', 'framed', 'airy'], infoPatternVertical: ['1', '2', '3', '4', '5'], dateFormat: ['dash', 'dot', 'slash', 'japanese'], dateCalendar: ['gregorian', 'wareki'], scoreFormat: ['decimal', 'half', 'stones', 'sgf'], komiFormat: ['decimal', 'half', 'stones', 'sgf'], resultFormat: ['decimal', 'half', 'stones', 'sgf'], notesAllMode: ['same', 'individual'], infoDirection: ['horizontal', 'vertical'], mode: ['all', 'split'], split: ['50', '100', 'custom'], numberStyle: ['arabic', 'kanji'],
      coordFormat: ['num-kanji', 'lower-lower', 'upper-upper', 'num-lower', 'num-upper'],
      boardColor: ['bw', 'kaya-new', 'kaya-old', 'hiba', 'katsura', 'custom'], grain: ['plain', 'masame', 'itame'],
      stoneColor: ['bw', 'custom'], blackPattern: ['plain', 'glass', 'nachi', 'agate'], whitePattern: ['plain', 'glass', 'shell', 'agate'],
      captures: ['show', 'hide'], repeatBracket: ['round', 'square'], repeatPosition: ['top', 'bottom', 'right', 'left'],
      repeatStoneStyle: ['beside', 'onStone'], paper: ['A3', 'A4', 'A5', 'B5'], orientation: ['portrait', 'landscape'], format: ['pdf', 'jpg', 'png'] };
    for (const k of ['first', 'last', 'custom', 'all']) if (typeof s.notesPlacement[k] !== 'boolean') e.push('所感の掲載ページ設定が不正です。');
    if (typeof s.notesPageNumbers !== 'string' || s.notesPageNumbers.length > 1000) e.push('任意ページの指定が不正です。');
    for (const k of ['coordinates', 'numbers', 'shadow', 'repeats', 'sameScoreFormat']) if (typeof s[k] !== 'boolean') e.push(`設定 ${k} が不正です。`);
    const fontIds = new Set((root.KifuConfig && root.KifuConfig.fontAssets || []).map(x => x.id));
    for (const role of ['title', 'info', 'number']) {
      const allowed = role === 'number' ? ['auto', 'system'] : ['default', 'system'];
      const selected = s.fonts[role];
      if (!(allowed.includes(selected) || typeof selected === 'string' && selected.startsWith('asset:') &&
          (!fontIds.size || fontIds.has(selected.slice(6))))) e.push(`フォント設定 ${role} が不正です。`);
      const family = s.fontFamilies[role];
      if (typeof family !== 'string' || family.length > 120 || /[\r\n;{}]/.test(family)) e.push(`端末フォント名 ${role} が不正です。`);
    }
    for (const k of ['top', 'bottom', 'right', 'left']) if (typeof s.positions[k] !== 'boolean') e.push('座標の表示位置が不正です。');
    if (typeof s.repeatStones !== 'boolean') e.push('碁石の表示設定が不正です。');
    if (typeof s.showTitle !== 'boolean') e.push('タイトル表示の設定が不正です。');
    for (const [k, allowed] of Object.entries(choices)) if (!allowed.includes(s[k])) e.push(`設定 ${k} が不正です。`);
    if (s.mode === 'split' && s.split === 'custom' && (!Number.isInteger(Number(s.customSplit)) || Number(s.customSplit) < 1 || Number(s.customSplit) > 10000)) e.push('分割手数は1〜10000の整数で入力してください。');
    for (const k of ['customBoard', 'blackColor', 'whiteColor']) if (!/^#[0-9a-f]{6}$/i.test(s[k])) e.push('色は#RRGGBBの形式で指定してください。');
    if (![150, 300, 600].includes(Number(s.dpi))) e.push('解像度は150・300・600 dpiから選択してください。');
    return e;
  }
  function validateMetadata(m) {
    const e = [];
    for (const [k, label] of [['black', '黒番名前'], ['white', '白番名前'], ['handicap', '手合い'], ['result', '勝敗']])
      if (!String(m[k] || '').trim()) e.push(`${label}を入力してください。`);
    if (!['japanese', 'chinese'].includes(m.rule)) e.push('ルールを選択してください。');
    if (m.komi === '' || !Number.isFinite(Number(m.komi))) e.push('コミを数値で入力してください（なしは0）。');
    for (const [k, v] of Object.entries(m)) if (typeof v === 'string' && k !== 'notes' && v.length > LIMITS.field) e.push(`${k}が長すぎます（600文字以内）。`);
    if (m.notes.length > LIMITS.notes) e.push('所感は12000文字以内で入力してください。');
    for (const [page, text] of Object.entries(m.notesByPage || {})) {
      if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > LIMITS.pages || typeof text !== 'string' || text.length > LIMITS.notes)
        e.push('ページ別所感は各12000文字以内で入力してください。');
    }
    if (Object.values(m.notesByPage || {}).reduce((n, t) => n + String(t).length, 0) > 120000) e.push('ページ別所感は合計120000文字以内で入力してください。');
    if (m.include.time) {
      const t = normalizeTime(m.time), spec = TIME_CONTROLS[t.mode];
      if (!spec) e.push('持ち時間の方式を選択してください。');
      else for (const [key, label, min, integer] of spec.fields) {
        const v = t[key];
        if (v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) || Number(v) < min || (integer && !Number.isInteger(Number(v))))
          e.push(`${label}を${integer ? '整数' : '数値'}で入力してください（${min}以上）。`);
      }
    }
    return e;
  }
  function diagrams(model, input) {
    const s = normalizeSettings(input), errors = validateSettings(s);
    if (errors.length) throw new SgfError(errors[0]);
    const step = s.mode === 'all' ? Math.max(1, model.total) : Number(s.split === 'custom' ? s.customSplit : s.split);
    const count = Math.max(1, Math.ceil(model.total / step));
    if (count > LIMITS.pages) throw new SgfError(`分割後の棋譜図が${count}枚になります。上限${LIMITS.pages}枚以内になるよう分割手数を増やしてください。`, -1, 'limit');
    const out = [], previousVisit = new Int32Array(model.initial.board.length);
    let consumed = 0;
    for (let page = 0; page < count; page++) {
      const start = page * step + 1, end = Math.min(model.total, (page + 1) * step);
      const snapshot = model.snapshots[start - 1] || model.initial;
      while (consumed < start - 1) { const e = model.events[consumed++]; if (e.p >= 0) previousVisit[e.p] = e.n; }
      const stones = new Map(), repeats = [], passes = [];
      snapshot.board.forEach((color, p) => { if (color) stones.set(p, { p, color, n: 0, absolute: snapshot.origins[p], carried: true }); });
      for (let j = start - 1; j < end; j++) {
        const e = model.events[j];
        if (e.pass) { passes.push(e); continue; }
        const anchor = stones.get(e.p), prior = previousVisit[e.p];
        if (anchor || prior) {
          const ref = anchor && anchor.absolute ? anchor.absolute : prior;
          repeats.push({ ...e, ref, refColor: (anchor && anchor.color) || (ref && model.events[ref - 1] ? model.events[ref - 1].color : snapshot.board[e.p]) || e.color, priorPage: !!ref && ref < start, setup: !ref,
            referenceCoord: coord(e.p, model.size) });
        }
        if (!anchor) stones.set(e.p, { p: e.p, color: e.color, n: e.n, absolute: e.n, carried: false });
        previousVisit[e.p] = e.n;
      }
      consumed = end;
      const final = model.snapshots[end] || model.initial;
      out.push({ start: model.total ? start : 0, end, page: page + 1, count, stones: Array.from(stones.values()),
        repeats, passes, captures: final.captures, size: model.size, total: model.total });
    }
    return out;
  }
  function moveLabel(n, start, style) { return style === 'kanji' ? compactKanji(n - start + 1) : String(n); }
  function repeatText(e, d, s) {
    const style = s.numbers ? s.numberStyle : 'arabic';
    const n = moveLabel(e.n, d.start, style);
    const ref = e.setup ? `置石:${e.referenceCoord}` : e.priorPage ? `前譜${e.ref}:${e.referenceCoord}` : moveLabel(e.ref, d.start, style);
    return s.repeatBracket === 'square' ? `${n}[${ref}]` : `${n}(${ref})`;
  }
  return { LIMITS, SgfError, parse, decode, dimensions, point, pointList, coord, standardKanji, compactKanji,
    listBranches, ruleFrom, group, neighbors, hash, makeState, applyNode, validateGame, replay,
    parseResult, parseTime, normalizeTime, TIME_CONTROLS, parsePageNumbers, notePages, notesForPage, metadata, defaults, normalizeSettings, validateSettings, validateMetadata,
    diagrams, moveLabel, repeatText, first };
});
