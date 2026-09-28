/* 利用統計の受信専用Apps Script。イベント明細は保存しない。 */
const DAILY_SHEET_NAME = '日次集計';
const DASHBOARD_SHEET_NAME = '管理ダッシュボード';
const SPREADSHEET_PROPERTY = 'ANALYTICS_SPREADSHEET_ID';
const TIME_ZONE = 'Asia/Tokyo';
const DATA_HEADERS = ['日付（日本時間）', '指標', '項目', '値', '形式・属性', '回数'];
const DASHBOARD_PERIODS = ['日別', '週別', '月別', '年別', '全期間'];
const INCLUDE_KEYS = ['event', 'place', 'date', 'blackRank', 'whiteRank', 'notes', 'time'];
const PRESET_KEYS = ['simple', 'particular', 'japanese'];
const FONT_ASSET_IDS = ['yuji-syuku', 'yuji-mai', 'kaisei-regular', 'kaisei-medium', 'kaisei-bold', 'hina-mincho', 'dot-gothic', 'potta-one', 'reggae-one'];
const SETTING_RULES = {
  showTitle: 'boolean', infoDirection: ['horizontal', 'vertical'],
  infoLayoutHorizontal: ['balanced', 'table', 'cards', 'bands', 'focus'],
  infoLayoutVertical: ['balanced', 'table', 'tiles', 'focus', 'groups'],
  infoVariant: ['base', 'classic', 'accent', 'framed', 'airy'],
  infoPatternVertical: ['1', '2', '3', '4', '5'],
  'fonts.title': 'font', 'fonts.info': 'font', 'fonts.number': 'font',
  'fontFamilies.title': ['none', 'custom'], 'fontFamilies.info': ['none', 'custom'], 'fontFamilies.number': ['none', 'custom'],
  dateFormat: ['dash', 'dot', 'slash', 'japanese'], dateCalendar: ['gregorian', 'wareki'],
  scoreFormat: ['decimal', 'half', 'stones', 'sgf'], komiFormat: ['decimal', 'half', 'stones', 'sgf'],
  resultFormat: ['decimal', 'half', 'stones', 'sgf'], sameScoreFormat: 'boolean',
  'notesPlacement.first': 'boolean', 'notesPlacement.last': 'boolean', 'notesPlacement.custom': 'boolean',
  'notesPlacement.all': 'boolean', notesPageNumbers: ['unset', 'specified'], notesAllMode: ['same', 'individual'],
  mode: ['all', 'split'], split: ['50', '100', 'custom'], customSplit: 'integer', coordinates: 'boolean',
  'positions.top': 'boolean', 'positions.bottom': 'boolean', 'positions.right': 'boolean', 'positions.left': 'boolean',
  coordFormat: ['num-kanji', 'lower-lower', 'upper-upper', 'num-lower', 'num-upper'], numbers: 'boolean',
  numberStyle: ['arabic', 'kanji'], boardColor: ['bw', 'kaya-new', 'kaya-old', 'hiba', 'katsura', 'custom'],
  customBoard: 'color', grain: ['plain', 'masame', 'itame'], stoneColor: ['bw', 'custom'],
  blackColor: 'color', whiteColor: 'color', blackPattern: ['plain', 'glass', 'nachi', 'agate'],
  whitePattern: ['plain', 'glass', 'shell', 'agate'], shadow: 'boolean', captures: ['show', 'hide'],
  repeats: 'boolean', repeatBracket: ['round', 'square'], repeatPosition: ['top', 'bottom', 'right', 'left'],
  repeatStones: 'boolean', repeatStoneStyle: ['beside', 'onStone'], paper: ['A3', 'A4', 'A5', 'B5'],
  orientation: ['portrait', 'landscape'], format: ['pdf', 'jpg', 'png'], dpi: [150, 300, 600]
};
const FIELD_LABELS = {
  showTitle: 'タイトル表示', infoDirection: '対局情報の方向', infoLayoutHorizontal: '横書きレイアウト',
  infoLayoutVertical: '縦書きレイアウト', infoVariant: '対局情報の見た目', infoPatternVertical: '縦書きパターン',
  'fonts.title': 'タイトルの書体', 'fonts.info': '対局情報の書体', 'fonts.number': '手数の書体',
  'fontFamilies.title': 'タイトルの端末フォント名指定', 'fontFamilies.info': '対局情報の端末フォント名指定',
  'fontFamilies.number': '手数の端末フォント名指定', dateFormat: '日付書式', dateCalendar: '日付の暦',
  scoreFormat: '勝敗・コミの書式', komiFormat: 'コミの書式', resultFormat: '勝敗の書式',
  sameScoreFormat: '勝敗とコミの書式を統一', 'notesPlacement.first': '所感を最初のページに掲載',
  'notesPlacement.last': '所感を最後のページに掲載', 'notesPlacement.custom': '所感を任意ページに掲載',
  'notesPlacement.all': '所感を全ページに掲載', notesPageNumbers: '所感のページ番号指定', notesAllMode: '全ページ所感の方式',
  mode: '棋譜の分割方式', split: '分割手数', customSplit: '任意の分割手数', coordinates: '座標表示',
  'positions.top': '座標の上表示', 'positions.bottom': '座標の下表示', 'positions.right': '座標の右表示',
  'positions.left': '座標の左表示', coordFormat: '座標の書式', numbers: '手数表示', numberStyle: '手数の書式',
  boardColor: '碁盤の色', customBoard: '指定碁盤色', grain: '碁盤の木目', stoneColor: '碁石の色',
  blackColor: '黒石の色', whiteColor: '白石の色', blackPattern: '黒石の模様', whitePattern: '白石の模様',
  shadow: '碁石の影', captures: 'アゲハマ表示', repeats: '同一点の再着手表示', repeatBracket: '再着手の括弧',
  repeatPosition: '再着手番号の位置', repeatStones: '再着手位置の碁石', repeatStoneStyle: '再着手碁石の表示方式',
  paper: '用紙サイズ', orientation: '用紙の向き', format: '出力形式', dpi: '画像解像度',
  'include.event': '大会名の掲載', 'include.place': '対局場所の掲載', 'include.date': '対局日の掲載',
  'include.blackRank': '黒番段級位の掲載', 'include.whiteRank': '白番段級位の掲載',
  'include.notes': '所感の掲載', 'include.time': '持ち時間の掲載'
};

function setupAnalytics() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('先に管理用スプレッドシートからApps Scriptを開いてね。');
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_PROPERTY, spreadsheet.getId());
  ensureSheets_(spreadsheet);
  refreshDashboard();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('サイト利用統計')
    .addItem('集計を更新', 'refreshDashboard')
    .addToUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet) {
    PropertiesService.getScriptProperties().setProperty(SPREADSHEET_PROPERTY, spreadsheet.getId());
    refreshDashboardFor_(spreadsheet);
  }
}

function onEdit(event) {
  if (!event || !event.range) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() === DASHBOARD_SHEET_NAME && event.range.getA1Notation() === 'B2') refreshDashboardFor_(event.source);
}

function doGet() {
  return ContentService.createTextOutput('利用統計の受信専用。集計データを読む機能はありません。');
}

function doPost(event) {
  try {
    const text = event && event.postData && event.postData.contents;
    if (typeof text !== 'string' || text.length > 20000) return response_();
    const payload = JSON.parse(text);
    const increments = validateAndExpand_(payload);
    if (increments) saveIncrements_(increments);
  } catch (_) {
    // 入力値や例外内容を実行ログへ残さない。
  }
  return response_();
}

function response_() {
  return ContentService.createTextOutput('ok');
}

function validateAndExpand_(event) {
  if (!isRecord_(event) || event.schema !== 1 || typeof event.kind !== 'string') return null;
  if (event.kind === 'visit') {
    if (!hasOnlyKeys_(event, ['schema', 'kind'])) return null;
    return [metric_('visits', '24時間ごとのブラウザ訪問', '', '')];
  }
  if (event.kind === 'failure') {
    if (!hasOnlyKeys_(event, ['schema', 'kind', 'reason']) || !['cancelled', 'generate', 'save'].includes(event.reason)) return null;
    const label = { cancelled: '中止', generate: '生成失敗', save: '保存開始失敗' }[event.reason];
    return [metric_('failure', label, '', '')];
  }
  if (event.kind !== 'download' || !hasOnlyKeys_(event, ['schema', 'kind', 'format', 'package', 'settings', 'include', 'ranks', 'recommendation'])) return null;
  if (!['pdf', 'jpg', 'png'].includes(event.format) || !['single', 'zip'].includes(event.package) ||
      event.format === 'pdf' && event.package !== 'single' || !validSettings_(event.settings) ||
      event.settings.format !== event.format || !validInclude_(event.include) || !validRanks_(event.ranks) ||
      !validRecommendation_(event.recommendation, event.settings)) return null;
  return downloadMetrics_(event);
}

function validSettings_(settings) {
  if (!isRecord_(settings) || !hasOnlyKeys_(settings, Object.keys(SETTING_RULES)) ||
      Object.keys(settings).length !== Object.keys(SETTING_RULES).length) return false;
  return Object.keys(SETTING_RULES).every(path => validField_(path, settings[path]));
}

function validField_(path, value) {
  const rule = SETTING_RULES[path];
  if (rule === 'boolean') return typeof value === 'boolean';
  if (rule === 'integer') return Number.isInteger(value) && value >= 1 && value <= 10000;
  if (rule === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (rule === 'font') {
    const modes = path === 'fonts.number' ? ['auto', 'system'] : ['default', 'system'];
    return typeof value === 'string' && (modes.includes(value) || /^asset:[a-z0-9-]{1,40}$/.test(value) && FONT_ASSET_IDS.includes(value.slice(6)));
  }
  return Array.isArray(rule) && rule.includes(value);
}

function validInclude_(include) {
  return isRecord_(include) && hasOnlyKeys_(include, INCLUDE_KEYS) && Object.keys(include).length === INCLUDE_KEYS.length &&
    INCLUDE_KEYS.every(key => typeof include[key] === 'boolean');
}

function validRanks_(ranks) {
  if (!isRecord_(ranks) || !hasOnlyKeys_(ranks, ['black', 'white']) || Object.keys(ranks).length !== 2) return false;
  return ['black', 'white'].every(side => ranks[side] === null ||
    typeof ranks[side] === 'string' && /^(?:[1-9][0-9]?段|[1-9][0-9]?級|プロ[1-9][0-9]?段)$/.test(ranks[side]));
}

function validRecommendation_(recommendation, settings) {
  if (!isRecord_(recommendation) || !hasOnlyKeys_(recommendation, ['preset', 'distance', 'band', 'changes']) ||
      !PRESET_KEYS.includes(recommendation.preset) || !Number.isInteger(recommendation.distance) ||
      recommendation.distance < 0 || recommendation.distance > Object.keys(SETTING_RULES).length ||
      !Array.isArray(recommendation.changes)) return false;
  const expectedBand = recommendation.distance === 0 ? 'exact' : recommendation.distance <= 2 ? 'close' : 'other';
  if (recommendation.band !== expectedBand) return false;
  if (expectedBand !== 'close') return recommendation.changes.length === 0;
  if (recommendation.changes.length !== recommendation.distance) return false;
  const seen = {};
  return recommendation.changes.every(change => isRecord_(change) && hasOnlyKeys_(change, ['path', 'value']) &&
    Object.prototype.hasOwnProperty.call(SETTING_RULES, change.path) && !seen[change.path] &&
    change.value === settings[change.path] && (seen[change.path] = true));
}

function downloadMetrics_(event) {
  const metrics = [metric_('exports_total', '成功出力', '', '')];
  metrics.push(metric_('exports', event.format, event.package, ''));
  const rec = event.recommendation;
  metrics.push(metric_('recommendation', rec.band, rec.preset, event.format));
  Object.keys(event.settings).forEach(path => {
    metrics.push(metric_('setting', path, String(event.settings[path]), event.format));
    if (rec.band !== 'exact') metrics.push(metric_('other_setting', path, String(event.settings[path]), event.format));
  });
  INCLUDE_KEYS.forEach(key => {
    const path = 'include.' + key, value = event.include[key] ? '掲載' : '非掲載';
    metrics.push(metric_('setting', path, value, event.format));
    if (rec.band !== 'exact') metrics.push(metric_('other_setting', path, value, event.format));
  });
  if (rec.band === 'close') rec.changes.forEach(change => {
    metrics.push(metric_('near_change', change.path, String(change.value), event.format));
  });
  ['black', 'white'].forEach(side => {
    if (event.ranks[side] !== null) metrics.push(metric_('rank', side, event.ranks[side], event.format));
  });
  return metrics;
}

function metric_(kind, item, value, format) {
  return { kind: kind, item: String(item == null ? '' : item), value: String(value == null ? '' : value), format: String(format == null ? '' : format) };
}

function saveIncrements_(increments) {
  const id = spreadsheetId_();
  if (!id) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const spreadsheet = SpreadsheetApp.openById(id);
    const sheet = ensureSheets_(spreadsheet).data;
    const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
    const lastRow = sheet.getLastRow();
    const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, DATA_HEADERS.length).getValues() : [];
    const positions = new Map();
    values.forEach((row, index) => {
      const date = row[0] instanceof Date ? Utilities.formatDate(row[0], TIME_ZONE, 'yyyy-MM-dd') : row[0];
      positions.set(counterKey_(date, row[1], row[2], row[3], row[4]), index);
    });
    const pending = new Map();
    increments.forEach(item => {
      const key = counterKey_(today, item.kind, item.item, item.value, item.format);
      pending.set(key, (pending.get(key) || 0) + 1);
    });
    const appended = [];
    pending.forEach((count, key) => {
      const index = positions.get(key);
      if (index !== undefined) values[index][5] = Number(values[index][5] || 0) + count;
      else {
        const [date, kind, item, value, format] = splitCounterKey_(key);
        appended.push([date, kind, item, value, format, count]);
      }
    });
    if (values.length) sheet.getRange(2, 1, values.length, DATA_HEADERS.length).setValues(values);
    if (appended.length) {
      const firstRow = sheet.getLastRow() + 1;
      sheet.getRange(firstRow, 1, appended.length, 1).setNumberFormat('@');
      sheet.getRange(firstRow, 1, appended.length, DATA_HEADERS.length).setValues(appended);
    }
  } finally {
    lock.releaseLock();
  }
}

function counterKey_(date, kind, item, value, format) {
  return [date, kind, item, value, format].map(value => String(value == null ? '' : value)).join('\u001f');
}

function splitCounterKey_(key) {
  return key.split('\u001f');
}

function ensureSheets_(spreadsheet) {
  let data = spreadsheet.getSheetByName(DAILY_SHEET_NAME);
  if (!data) data = spreadsheet.insertSheet(DAILY_SHEET_NAME);
  if (data.getLastRow() === 0) data.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]);
  data.setFrozenRows(1);
  let dashboard = spreadsheet.getSheetByName(DASHBOARD_SHEET_NAME);
  if (!dashboard) dashboard = spreadsheet.insertSheet(DASHBOARD_SHEET_NAME);
  dashboard.getRange('A1').setValue('紙の棋譜 利用統計');
  dashboard.getRange('A2').setValue('表示単位');
  if (!dashboard.getRange('B2').getValue()) dashboard.getRange('B2').setValue('月別');
  dashboard.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DASHBOARD_PERIODS, true).build());
  dashboard.getRange('A3').setValue('期間を選ぶと自動更新。集計データにイベント明細は含まれない。');
  dashboard.setFrozenRows(4);
  dashboard.getRange('A1').setFontSize(16).setFontWeight('bold');
  dashboard.getRange('A4:H4').setValues([['期間', '集計項目', '項目', '値', '形式', '回数', '割合', '分母']]);
  dashboard.getRange('A4:H4').setFontWeight('bold');
  return { data: data, dashboard: dashboard };
}

function refreshDashboard() {
  const id = spreadsheetId_();
  if (!id) return;
  refreshDashboardFor_(SpreadsheetApp.openById(id));
}

function spreadsheetId_() {
  const propertyId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_PROPERTY);
  if (propertyId) return propertyId;
  return typeof DEPLOY_SPREADSHEET_ID === 'string' ? DEPLOY_SPREADSHEET_ID : '';
}

function refreshDashboardFor_(spreadsheet) {
  const sheets = ensureSheets_(spreadsheet);
  const mode = sheets.dashboard.getRange('B2').getValue() || '月別';
  const lastRow = sheets.data.getLastRow();
  const rows = lastRow > 1 ? sheets.data.getRange(2, 1, lastRow - 1, DATA_HEADERS.length).getValues() : [];
  const output = buildDashboardRows_(rows, DASHBOARD_PERIODS.includes(mode) ? mode : '月別');
  const oldLast = sheets.dashboard.getLastRow();
  if (oldLast > 4) sheets.dashboard.getRange(5, 1, oldLast - 4, 8).clearContent();
  if (output.length) {
    sheets.dashboard.getRange(5, 1, output.length, 8).setValues(output);
    sheets.dashboard.getRange(5, 6, output.length, 1).setNumberFormat('#,##0');
    sheets.dashboard.getRange(5, 7, output.length, 1).setNumberFormat('0.0%');
    sheets.dashboard.getRange(5, 8, output.length, 1).setNumberFormat('#,##0');
  }
  sheets.dashboard.autoResizeColumns(1, 8);
}

function buildDashboardRows_(sourceRows, mode) {
  const totals = new Map();
  sourceRows.forEach(row => {
    const date = row[0] instanceof Date ? Utilities.formatDate(row[0], TIME_ZONE, 'yyyy-MM-dd') : String(row[0] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const bucket = periodBucket_(date, mode);
    const kind = String(row[1] || ''), item = String(row[2] || ''), value = String(row[3] || ''), format = String(row[4] || '');
    const key = counterKey_(bucket, kind, item, value, format);
    totals.set(key, (totals.get(key) || 0) + Math.max(0, Number(row[5]) || 0));
  });
  const buckets = Array.from(new Set(Array.from(totals.keys(), key => splitCounterKey_(key)[0]))).sort();
  const out = [];
  buckets.forEach(bucket => {
    const metrics = Array.from(totals.entries()).map(([key, count]) => ({ fields: splitCounterKey_(key), count }))
      .filter(item => item.fields[0] === bucket);
    const get = (kind, item) => metrics.filter(m => m.fields[1] === kind && (!item || m.fields[2] === item));
    const sum = list => list.reduce((total, item) => total + item.count, 0);
    const successful = sum(get('exports_total'));
    const nonExact = sum(get('recommendation').filter(m => m.fields[2] !== 'exact'));
    const close = sum(get('recommendation').filter(m => m.fields[2] === 'close'));
    const rankCounts = { black: sum(get('rank').filter(m => m.fields[2] === 'black')), white: sum(get('rank').filter(m => m.fields[2] === 'white')) };
    out.push(row_(bucket, '訪問', '24時間ごとのブラウザ訪問', '', '', sum(get('visits')), null, null));
    out.push(row_(bucket, '成功出力', '合計', '', '', successful, null, null));
    out.push(row_(bucket, '失敗・中止', '合計', '', '', sum(get('failure')), null, null));
    get('exports').forEach(m => out.push(row_(bucket, '出力形式', m.fields[2] === 'zip' ? m.fields[1] + '（ZIP）' : m.fields[1], '', m.fields[2], m.count,
      successful ? m.count / successful : null, successful)));
    get('recommendation').forEach(m => out.push(row_(bucket, 'おすすめ設定', recommendationLabel_(m.fields[3]), recommendationBandLabel_(m.fields[2]), m.fields[4], m.count,
      successful ? m.count / successful : null, successful)));
    get('setting').forEach(m => out.push(row_(bucket, '全設定の利用', FIELD_LABELS[m.fields[2]] || m.fields[2], m.fields[3], m.fields[4], m.count,
      successful ? m.count / successful : null, successful)));
    get('other_setting').forEach(m => out.push(row_(bucket, 'おすすめ以外の設定', FIELD_LABELS[m.fields[2]] || m.fields[2], m.fields[3], m.fields[4], m.count,
      nonExact ? m.count / nonExact : null, nonExact)));
    get('near_change').forEach(m => out.push(row_(bucket, '近い設定からの変更', FIELD_LABELS[m.fields[2]] || m.fields[2], m.fields[3], m.fields[4], m.count,
      close ? m.count / close : null, close)));
    get('rank').forEach(m => {
      const denominator = rankCounts[m.fields[2]];
      out.push(row_(bucket, '段級位分布', m.fields[2] === 'black' ? '黒番' : '白番', m.fields[3], m.fields[4], m.count,
        denominator ? m.count / denominator : null, denominator));
    });
    get('failure').forEach(m => out.push(row_(bucket, '失敗・中止の理由', m.fields[2], '', '', m.count, null, null)));
  });
  return out;
}

function row_(period, category, item, value, format, count, share, denominator) {
  return [period, category, item, value, format, count, share, denominator];
}

function periodBucket_(date, mode) {
  if (mode === '全期間') return '全期間';
  const parts = date.split('-').map(Number), instant = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (mode === '年別') return String(parts[0]);
  if (mode === '月別') return date.slice(0, 7);
  if (mode === '週別') {
    const mondayOffset = (instant.getUTCDay() + 6) % 7;
    instant.setUTCDate(instant.getUTCDate() - mondayOffset);
    const start = Utilities.formatDate(instant, 'UTC', 'yyyy-MM-dd');
    instant.setUTCDate(instant.getUTCDate() + 6);
    return start + '〜' + Utilities.formatDate(instant, 'UTC', 'yyyy-MM-dd');
  }
  return date;
}

function recommendationLabel_(preset) {
  return { simple: 'シンプル', particular: 'こだわりカラー', japanese: '和風' }[preset] || preset;
}

function recommendationBandLabel_(band) {
  return { exact: '完全一致', close: '近い', other: 'それ以外' }[band] || band;
}

function isRecord_(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys_(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}
