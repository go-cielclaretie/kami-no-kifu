/* Explicit opt-in, browser-local display preferences. Never store SGF, names,
 * game metadata, notes text, fonts, or a Google account identifier. */
(function (root) {
  'use strict';
  const K = root.KifuCore, KEY = root.KifuPlatform ? root.KifuPlatform.storageKey : 'KifuPrintWeb.display.v2:/';
  function clean(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('表示設定の形式が不正です。');
    const out = {}, base = K.defaults();
    for (const key of Object.keys(base)) if (Object.prototype.hasOwnProperty.call(input, key)) {
      const v = input[key];
      if (key === 'positions' || key === 'notesPlacement') {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('表示設定の形式が不正です。');
        out[key] = {};
        for (const sub of Object.keys(base[key])) if (Object.prototype.hasOwnProperty.call(v, sub)) out[key][sub] = v[sub];
      } else out[key] = v;
    }
    if (input.paginationBeforeKanji && typeof input.paginationBeforeKanji === 'object') {
      const p = input.paginationBeforeKanji;
      if (!['all', 'split'].includes(p.mode) || !['50', '100', 'custom'].includes(String(p.split)) ||
          !Number.isInteger(Number(p.customSplit)) || Number(p.customSplit) < 1 || Number(p.customSplit) > 10000)
        throw new Error('漢数字切替前の分割設定が不正です。');
      out.paginationBeforeKanji = { mode: p.mode, split: String(p.split), customSplit: Number(p.customSplit) };
    }
    const normalized = K.normalizeSettings(out), errors = K.validateSettings(normalized);
    if (errors.length) throw new Error(errors.join(' '));
    return normalized;
  }
  function encode(input) { return JSON.stringify({ schema: 1, app: 'KifuPrintWeb', settings: clean(input) }, null, 2); }
  function decode(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 50000) throw new Error('設定ファイルは50 KB以内にしてください。');
    const obj = JSON.parse(text);
    if (!obj || obj.schema !== 1 || obj.app !== 'KifuPrintWeb') throw new Error('対応していない設定ファイルです。');
    return clean(obj.settings);
  }
  function load() {
    try { const raw = root.localStorage.getItem(KEY); return { settings: raw ? decode(raw) : null, error: '' }; }
    catch (_) { return { settings: null, error: '保存済み設定を読み込めません。ブラウザの保存制限、または設定データの破損を確認してください。' }; }
  }
  function save(input) {
    const text = encode(input);
    try {
      root.localStorage.setItem(KEY, text);
      if (root.localStorage.getItem(KEY) !== text) throw new Error('readback');
    } catch (_) { throw new Error('このブラウザでは設定を保存できません。保存を許可するか「設定を書き出す」で控えを作成してください。'); }
    return text;
  }
  root.KifuPreferences = { KEY, clean, encode, decode, load, save };
})(globalThis);
