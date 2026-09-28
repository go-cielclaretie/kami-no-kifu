const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Analytics = require('../js/analytics.js');
const presets = Object.fromEntries([
  ['simple', 'suggestion-simple.json'],
  ['particular', 'suggestion-particular.json'],
  ['japanese', 'suggestion-japanese.json']
].map(([key, filename]) => [key, Analytics.flattenSettings(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'suggested_layout', filename), 'utf8')).settings)]));
const simpleSettings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'suggested_layout', 'suggestion-simple.json'), 'utf8')).settings;

function alternateValue(path, current) {
  const rule = Analytics.fields[path];
  if (rule === 'boolean') return !current;
  if (rule === 'integer') return current === 10000 ? 9999 : current + 1;
  if (rule === 'color') return current === '#010203' ? '#030201' : '#010203';
  if (Array.isArray(rule)) {
    if (path.startsWith('fonts.') && current.startsWith('asset:')) return 'system';
    return rule.find(value => value !== current);
  }
  throw new Error('No alternate for ' + path);
}

function syntheticPresets() {
  return Object.fromEntries(Analytics.recommendationOrder.map(key => [key, { ...presets.simple }]));
}

function gasHarness() {
  const rows = [['日付（日本時間）', '指標', '項目', '値', '形式・属性', '回数']];
  const sheet = {
    getLastRow() { return rows.length; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() { return rows.slice(row - 1, row - 1 + rowCount).map(values => values.slice(column - 1, column - 1 + columnCount)); },
        setNumberFormat() {},
        setValues(values) {
          for (let i = 0; i < values.length; i++) rows[row - 1 + i] = values[i].slice();
        }
      };
    }
  };
  const spreadsheet = { getSheetByName(name) { return name === '日次集計' ? sheet : null; } };
  const context = vm.createContext({
    SpreadsheetApp: { openById() { return spreadsheet; } },
    PropertiesService: { getScriptProperties() { return { getProperty() { return 'private-sheet-id'; } }; } },
    LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
    Utilities: { formatDate(date) { return date.toISOString().slice(0, 10); } },
    ContentService: { createTextOutput(content) { return { content }; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'analytics_gas', 'Code.gs'), 'utf8'), context);
  return { context, rows };
}

function browserAnalytics(endpoint, online = true) {
  const sent = [], values = new Map();
  const embedded = Object.fromEntries([
    ['simple', 'suggestion-simple.json'],
    ['particular', 'suggestion-particular.json'],
    ['japanese', 'suggestion-japanese.json']
  ].map(([key, filename]) => [key, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'suggested_layout', filename), 'utf8'))]));
  const context = vm.createContext({
    KifuCore: require('../js/core.js'), KifuConfig: { analyticsEndpoint: endpoint },
    KifuSuggestedLayouts: embedded, location: { protocol: 'https:' }, URL, Blob, Date,
    navigator: { onLine: online },
    localStorage: { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, value); } },
    fetch(url, options) { sent.push({ url, body: options.body, options }); return Promise.reject(new Error('network down')); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'analytics.js'), 'utf8'), context);
  return { api: context.KifuAnalytics, sent, values };
}

test('段級位を正規化して未知の自由入力を捨てる', () => {
  const examples = new Map([
    ['初段', '1段'], ['三段', '3段'], ['十段', '10段'], ['二級位', '2級'],
    ['3d', '3段'], ['7k', '7級'], ['2p', 'プロ2段'], ['３ｄ', '3段'], ['自由入力の名前', null]
  ]);
  for (const [source, expected] of examples) assert.equal(Analytics.normalizeRank(source), expected, source);
});

test('訪問は24時間以上たったときだけ再計上する', () => {
  const hour = 60 * 60 * 1000, previous = Date.UTC(2026, 8, 28, 0, 0);
  assert.equal(Analytics.isVisitDue(previous, previous + 23 * hour + 59 * 60 * 1000), false);
  assert.equal(Analytics.isVisitDue(previous, previous + 24 * hour), true);
  assert.equal(Analytics.isVisitDue(0, previous), true);
});

test('受信先未設定・オフラインは送信せず、通信失敗は出力イベントを止めない', async () => {
  const disabled = browserAnalytics('');
  assert.equal(disabled.api.recordVisit(), false);
  assert.equal(disabled.sent.length, 0);
  const offline = browserAnalytics('https://script.google.com/macros/s/abc123/exec', false);
  assert.equal(offline.api.recordVisit(), false);
  assert.equal(offline.sent.length, 0);
  const connected = browserAnalytics('https://script.google.com/macros/s/abc123/exec');
  const event = await connected.api.recordDownload({ settings: simpleSettings, include: {}, ranks: {} });
  assert.equal(event, true);
  assert.equal(connected.sent.filter(item => item.body).length, 1);
  assert.match(connected.sent[0].url, /\/macros\/s\/abc123\/exec$/);
  assert.equal(connected.sent[0].options.credentials, 'omit');
  assert.equal(connected.sent[0].options.referrerPolicy, 'no-referrer');
});

test('おすすめ設定の一致・1/2/3差分と同距離の表示順を判定する', () => {
  const recommendations = syntheticPresets();
  const base = simpleSettings;
  assert.equal(Analytics.classifySettings(base, recommendations).recommendation.band, 'exact');
  for (const [count, expected] of [[1, 'close'], [2, 'close'], [3, 'other']]) {
    const changed = { ...base, positions: { ...base.positions }, notesPlacement: { ...base.notesPlacement }, fonts: { ...base.fonts }, fontFamilies: { ...base.fontFamilies } };
    const selectedPaths = Analytics.paths.slice(0, count);
    for (const settingPath of selectedPaths) {
      const keyParts = settingPath.split('.');
      let target = changed;
      while (keyParts.length > 1) target = target[keyParts.shift()];
      const key = keyParts[0];
      target[key] = alternateValue(settingPath, Analytics.flattenSettings(base)[settingPath]);
    }
    const classified = Analytics.classifySettings(changed, recommendations).recommendation;
    assert.equal(classified.band, expected);
    assert.equal(classified.distance, count);
    assert.equal(classified.preset, 'simple');
    assert.equal(classified.changes.length, count === 3 ? 0 : count);
  }
});

test('内部の漢数字用分割値はおすすめ比較へ混ぜない', () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'suggested_layout', 'suggestion-simple.json'), 'utf8')).settings;
  const withInternal = { ...base, paginationBeforeKanji: { mode: 'all', split: 'custom', customSplit: 37 }, infoVariantHorizontal: 'airy' };
  assert.equal(Analytics.classifySettings(withInternal, syntheticPresets()).recommendation.band, 'exact');
  assert.equal(Object.prototype.hasOwnProperty.call(Analytics.flattenSettings(withInternal), 'paginationBeforeKanji'), false);
});

test('出力イベントに対局内容や未知の段級位を含めない', () => {
  const source = { ...simpleSettings, format: 'png' };
  const event = Analytics.createDownloadEvent({
    settings: source, include: { event: true, notes: true }, ranks: { black: '3d', white: '秘密の入力' }, packageType: 'zip',
    playerName: '送らない名前', sgf: '(;GM[1])'
  }, syntheticPresets());
  assert.equal(event.package, 'zip');
  assert.equal(event.ranks.black, '3段');
  assert.equal(event.ranks.white, null);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /送らない名前|秘密の入力|対局場所|SGF/);
  assert.deepEqual(Object.keys(Analytics.createFailureEvent('cancelled')).sort(), ['kind', 'reason', 'schema']);
});

test('Apps Scriptは許可されたイベントだけを日次集計し、読み出し結果を返さない', () => {
  const harness = gasHarness(), { context, rows } = harness;
  const settings = simpleSettings;
  const event = Analytics.createDownloadEvent({ settings, include: {}, ranks: { black: '初段', white: '自由入力' } }, syntheticPresets());
  assert.ok(event);
  context.doPost({ postData: { contents: JSON.stringify(event) } });
  context.doPost({ postData: { contents: JSON.stringify(event) } });
  context.doPost({ postData: { contents: JSON.stringify({ schema: 1, kind: 'visit' }) } });
  context.doPost({ postData: { contents: JSON.stringify({ ...event, playerName: '不許可の追加項目' }) } });
  const counts = new Map(rows.slice(1).map(row => [`${row[1]}|${row[2]}|${row[3]}|${row[4]}`, row[5]]));
  assert.equal(counts.get('exports_total|成功出力||'), 2);
  assert.equal(counts.get('setting|showTitle|true|pdf'), 2);
  assert.equal(counts.get('setting|positions.bottom|false|pdf'), 2);
  assert.equal(counts.get('rank|black|1段|pdf'), 2);
  assert.equal(counts.get('visits|24時間ごとのブラウザ訪問||'), 1);
  assert.ok(!rows.flat().includes('不許可の追加項目'));
  assert.ok(!rows.flat().includes('自由入力'));
  assert.doesNotMatch(context.doGet().content, /成功出力|日次集計/);
});

test('形式・ZIP・失敗の件数とダッシュボード割合を集計する', () => {
  const { context, rows } = gasHarness();
  for (const [format, packageType] of [['pdf', 'single'], ['jpg', 'single'], ['jpg', 'zip'], ['png', 'zip']]) {
    const settings = { ...simpleSettings, format };
    const event = Analytics.createDownloadEvent({ settings, packageType, include: {}, ranks: {} }, syntheticPresets());
    assert.ok(event);
    context.doPost({ postData: { contents: JSON.stringify(event) } });
  }
  for (const reason of ['cancelled', 'generate', 'save']) {
    context.doPost({ postData: { contents: JSON.stringify(Analytics.createFailureEvent(reason)) } });
  }
  const totals = rows.slice(1).reduce((sum, row) => row[1] === 'exports_total' ? sum + row[5] : sum, 0);
  assert.equal(totals, 4);
  assert.equal(rows.slice(1).find(row => row[1] === 'exports' && row[2] === 'jpg' && row[3] === 'zip')[5], 1);
  assert.equal(rows.slice(1).filter(row => row[1] === 'failure').reduce((sum, row) => sum + row[5], 0), 3);

  const dayRows = [
    ['2026-09-28', 'exports_total', '成功出力', '', '', 4],
    ['2026-09-28', 'recommendation', 'exact', 'simple', 'pdf', 1],
    ['2026-09-28', 'recommendation', 'close', 'simple', 'png', 2],
    ['2026-09-28', 'recommendation', 'other', 'japanese', 'jpg', 1],
    ['2026-09-28', 'other_setting', 'coordinates', 'false', 'png', 2],
    ['2026-09-28', 'near_change', 'dpi', '600', 'png', 2],
    ['2026-09-28', 'rank', 'black', '1段', 'pdf', 2],
    ['2026-09-28', 'rank', 'black', '3級', 'pdf', 1]
  ];
  const report = context.buildDashboardRows_(dayRows, '月別');
  const match = (category, item, value) => report.find(row => row[1] === category && row[2] === item && row[3] === value);
  assert.equal(match('おすすめ設定', 'シンプル', '完全一致')[6], 1 / 4);
  assert.equal(match('おすすめ以外の設定', '座標表示', 'false')[6], 2 / 3);
  assert.equal(match('近い設定からの変更', '画像解像度', '600')[6], 1);
  assert.equal(match('段級位分布', '黒番', '1段')[6], 2 / 3);
  assert.equal(context.periodBucket_('2026-09-29', '週別'), '2026-09-28〜2026-10-04');
  assert.equal(context.periodBucket_('2026-09-29', '年別'), '2026');
  assert.equal(context.periodBucket_('2026-09-29', '全期間'), '全期間');
});
