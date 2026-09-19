/* UI controller. Imported strings are assigned through .value/.textContent,
 * never through innerHTML. The templates below contain only trusted literals.
 */
(function (root) {
  'use strict';
  const K = root.KifuCore, R = root.KifuRender, E = root.KifuExport, P = root.KifuPreferences, F = root.KifuFonts;
  const $ = id => document.getElementById(id);
  const state = { settings: K.defaults(), meta: K.metadata([]), file: null, collection: null, tree: null,
    model: null, validation: null, plans: [], page: 0, game: 0, branch: 0, encoding: '',
    decodeWarnings: [], loadError: '', layoutError: '', exportError: '', busy: false, loading: false,
    focusNotes: false, seq: 0, raf: 0, controller: null, lastDownload: null };
  const fontState = { status: 'idle', name: '', error: '', face: null, pending: null, generation: 0, controller: null };
  function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function radio(path, values, columns = 2) {
    return `<div class="choice-grid ${columns === 3 ? 'three' : columns === 4 ? 'four' : ''}">${values.map(([v, label]) => `<label class="choice"><input type="radio" name="s_${path}" data-setting="${path}" value="${v}"><span>${label}</span></label>`).join('')}</div>`;
  }
  function check(path, label) { return `<label class="check-line"><input type="checkbox" data-setting="${path}"><span>${label}</span></label>`; }
  function group(label, html, id = '') { return `<div class="control-group"${id ? ` id="${id}"` : ''}><div class="group-label">${label}</div>${html}</div>`; }
  function section(title, html, open = false) { return `<details${open ? ' open' : ''}><summary>${title}</summary><div class="section-content">${html}</div></details>`; }
  function makeForms() {
    $('settingsForm').innerHTML =
      section('タイトル・対局情報',
        check('showTitle', 'タイトルを表示する') +
        '<p class="help">用紙上部中央に「黒番名前 対 白番名前」を掲載。名前の編集に追従し、全ページに反映する。</p>' +
        group('対局情報の書字方向', radio('infoDirection', [['horizontal', '横書き'], ['vertical', '縦書き']])) +
        group('横書きレイアウト', radio('infoLayoutHorizontal', [['balanced', '1 中央バランス'], ['table', '2 二列整列表'], ['cards', '3 対局者カード'], ['bands', '4 分類帯']]), 'horizontalLayouts') +
        group('縦書きレイアウト', radio('infoLayoutVertical', [['balanced', '1 均等列組み'], ['table', '2 罫線整列表'], ['tiles', '4 二段タイル'], ['focus', '5 対局者強調']]), 'verticalLayouts') +
        '<p class="help">対局情報と所感の書字方向。縦書きは上から下、列は右から左。タイトル・手数・座標は独立した設定。</p>') +
      section('棋譜画像',
        group('表示手数', radio('mode', [['all', '総譜'], ['split', '分割']])) +
        `<div id="splitOptions" class="subgroup">${group('分割手数', radio('split', [['50', '50手ずつ'], ['100', '100手ずつ'], ['custom', '任意']]))}<div id="customSplitWrap" class="control-group"><label class="field-label" for="customSplit">1枚あたりの手数</label><input id="customSplit" type="number" min="1" max="10000" step="1" data-setting="customSplit"></div><p id="kanjiLock" class="help warning" hidden>漢数字では100手ずつに固定されるよ。</p></div>` +
        `<div class="control-group">${check('coordinates', '座標を表示する')}<div id="coordinateOptions" class="subgroup">${group('表示位置', ['top', 'bottom', 'right', 'left'].map((p, i) => `<label class="choice"><input type="checkbox" data-setting="positions.${p}"><span>${['上', '下', '右', '左'][i]}</span></label>`).join('').replace(/^/, '<div class="choice-grid four">') + '</div>')}${group('表示形式［縦－横］', radio('coordFormat', [['num-kanji', '数字－漢数字'], ['lower-lower', 'a－a'], ['upper-upper', 'A－A'], ['num-lower', '1－a'], ['num-upper', '1－A']]))}<p class="help">左・右が縦、上・下が横。英字の I / i は省略しない。</p></div></div>` +
        `<div class="control-group">${check('numbers', '手数を表示する')}<div id="numberOptions" class="subgroup">${group('手数の表記法', radio('numberStyle', [['arabic', '数字'], ['kanji', '漢数字']]))}<div id="fontBox" class="font-box" hidden><div class="group-label">縦書きの行書体</div><p id="fontStatus" class="help"></p><button id="retryFont" type="button">行書体を再読み込み</button><input id="fontFile" type="file" accept=".ttf,.otf,.woff,.woff2" aria-label="行書体フォントファイルを選択"><p class="help">読み込めない場合は手元の行書体を選択。フォント本体は配布物に含めていないよ。選択したファイルはアップロードせず、このタブ内だけで使用する。</p></div></div></div>` +
        group('アゲハマ', radio('captures', [['show', '表示'], ['hide', '非表示']])) +
        '<p class="help">黒・白は、それぞれが取った石の数。各譜末までの累計。死石の合意処理や地合い計算は含まない。</p>') +
      section('碁盤',
        group('色', radio('boardColor', [['bw', '白黒'], ['kaya-new', '本榧（新）'], ['kaya-old', '本榧（旧）'], ['hiba', 'ヒバ'], ['katsura', '本桂'], ['custom', 'カラーパレット']])) +
        '<div id="boardColorWrap" class="control-group"><label class="field-label" for="customBoard">盤の色</label><input id="customBoard" type="color" data-setting="customBoard"></div>' +
        group('模様', radio('grain', [['plain', '無地'], ['masame', '柾目'], ['itame', '板目']], 3)) +
        '<p class="help">板目は提供写真の木目を抽出した素材。罫線と星を除去し、盤の色に合わせて描画する。柾目・艶は描画による表現。</p>') +
      section('碁石',
        group('色', radio('stoneColor', [['bw', '白黒'], ['custom', 'カラーパレット']])) +
        '<div id="stoneColorWrap" class="color-row control-group"><div><label class="field-label" for="blackColor">黒石側</label><input id="blackColor" type="color" data-setting="blackColor"></div><div><label class="field-label" for="whiteColor">白石側</label><input id="whiteColor" type="color" data-setting="whiteColor"></div></div>' +
        group('黒石の模様', radio('blackPattern', [['plain', '無地'], ['glass', 'ガラス'], ['nachi', '那智黒'], ['agate', 'メノウ']])) +
        group('白石の模様', radio('whitePattern', [['plain', '無地'], ['glass', 'ガラス'], ['shell', '蛤'], ['agate', 'メノウ']])) +
        `<div class="control-group">${check('shadow', '碁石の影を表示する')}</div>`) +
      section('同地点着手',
        check('repeats', '同地点着手を表示する') +
        `<div id="repeatOptions" class="subgroup">${group('表示形式', radio('repeatBracket', [['round', '53(46)'], ['square', '53[46]']]))}${group('表示位置', radio('repeatPosition', [['top', '上'], ['bottom', '下'], ['right', '右'], ['left', '左']], 4))}${check('repeatStones', '碁石の表示')}<div id="repeatStoneOptions" class="control-group">${radio('repeatStoneStyle', [['beside', '横に小さく'], ['onStone', '碁石上に表示']])}</div><p class="help">注記は上・下では盤面の横方向中央、右・左では縦方向中央に配置。左右では1件ずつ縦に並べ、上下ではカンマで区切る。前譜の番号には「前譜」とSGF座標を付ける。注記が多い場合は補記ページを追加するよ。</p></div>`) +
      section('用紙・出力',
        group('用紙サイズ', radio('paper', [['A3', 'A3'], ['A4', 'A4'], ['A5', 'A5'], ['B5', 'B5']], 4)) +
        '<p class="help">B5はJIS（182 × 257 mm）。余白あり。</p>' +
        group('向き', radio('orientation', [['portrait', '縦'], ['landscape', '横']])) +
        group('出力形式', radio('format', [['pdf', 'PDF'], ['jpg', 'JPG'], ['png', 'PNG']], 3)) +
        '<div class="control-group"><label class="field-label" for="dpi">出力解像度</label><select id="dpi" data-setting="dpi"><option value="150">150 dpi（軽量）</option><option value="300">300 dpi（標準）</option><option value="600">600 dpi（大容量）</option></select><p class="help">PDFは高解像度画像を収録。複数枚のJPG・PNGはZIPになる。A3・600 dpiは端末保護の上限を超えるため出力不可。</p></div>');
    const optional = (key, label, type = 'text') => `<div class="info-field" data-optional="${key}"><div class="info-field-head"><input type="checkbox" id="include_${key}" data-include="${key}"><label for="include_${key}">${label}を掲載</label></div>${type === 'textarea' ? `<textarea id="meta_${key}" data-meta="${key}" maxlength="${K.LIMITS.notes}" aria-label="${label}" placeholder="振り返りや気づきを自由に記入"></textarea>` : `<input id="meta_${key}" type="text" data-meta="${key}" maxlength="600" aria-label="${label}">`}</div>`;
    const required = (key, label, extra = '') => `<div class="info-field"><div class="info-field-head"><label for="meta_${key}">${label} <span class="asterisk">※</span></label></div><input id="meta_${key}" type="${key === 'komi' ? 'number' : 'text'}" data-meta="${key}" aria-required="true" ${key === 'komi' ? 'step="any"' : 'maxlength="600"'} ${extra}></div>`;
    $('infoForm').innerHTML =
      '<section class="info-section"><h3>対局の記録</h3>' + optional('event', '大会名') + optional('place', '対局場所') + optional('date', '対局日') + '</section>' +
      '<section class="info-section"><h3>対局者</h3>' + required('black', '黒番名前') + optional('blackRank', '黒番段級位') + required('white', '白番名前') + optional('whiteRank', '白番段級位') + '</section>' +
      '<section class="info-section"><h3>対局条件</h3>' + required('handicap', '手合い', 'list="handicapList" placeholder="互先・定先・置碁など"') +
      '<datalist id="handicapList"><option value="互先"><option value="定先"><option value="2子局"><option value="3子局"><option value="4子局"><option value="5子局"><option value="6子局"><option value="7子局"><option value="8子局"><option value="9子局"></datalist>' +
      '<p id="handicapHint" class="help warning" hidden>コミ0だけでは互先／定先を区別できないので、手合いを選んでね。</p>' +
      '<div class="info-field"><div class="info-field-head"><label for="meta_rule">ルール <span class="asterisk">※</span></label></div><select id="meta_rule" data-meta="rule" aria-required="true"><option value="">選択してください</option><option value="japanese">日本ルール</option><option value="chinese">中国ルール</option></select><p class="help">変更すると全分岐を再検査。日本は単純コウ、中国は盤面一致の同形反復禁止で検査する。</p></div>' +
      required('komi', 'コミ（目）', 'placeholder="コミなしは0"') +
      '<div class="info-field"><div class="info-field-head"><input id="include_time" type="checkbox" data-include="time"><label for="include_time">持ち時間を掲載</label></div><div id="timeOptions">' +
      '<div class="choice-grid">' + Object.entries(K.TIME_CONTROLS).map(([key, spec]) => `<label class="choice"><input type="radio" name="timeMode" data-time="mode" value="${key}"><span>${spec.label}</span></label>`).join('') + '</div>' +
      ['minutes','seconds','periods','overtimeMinutes','moves','increment','perMoveSeconds'].map(key => `<div id="timeField_${key}" class="control-group" hidden><label id="timeLabel_${key}" class="field-label" for="time_${key}"></label><input id="time_${key}" type="number" data-time="${key}"></div>`).join('') +
      '<p id="timeRaw" class="help warning" hidden></p></div></div></section>' +
      '<section class="info-section"><h3>結果と振り返り</h3>' + required('result', '勝敗', 'list="resultList" placeholder="例：黒1.5目勝ち"') +
      '<datalist id="resultList"><option value="黒中押し勝ち"><option value="白中押し勝ち"><option value="黒時間切れ勝ち"><option value="白時間切れ勝ち"><option value="持碁"><option value="無勝負"><option value="未終局"></datalist>' + optional('notes', '所感', 'textarea') +
      '<div id="notesOptions" class="notes-controls"><div class="group-label">所感を載せる棋譜図ページ</div><div class="choice-grid">' +
      [['first', '最初'], ['last', '最後'], ['custom', '任意ページ'], ['all', '全ページ']].map(([key, label]) => check('notesPlacement.' + key, label)).join('') + '</div>' +
      '<div id="notesCustomWrap" class="control-group"><label class="field-label" for="notesPageNumbers">任意ページの番号</label><input id="notesPageNumbers" data-setting="notesPageNumbers" type="text" maxlength="1000" placeholder="例：2,4-6"><p class="help">複数指定可能。最初・最後との重複は1回だけ掲載。</p></div>' +
      '<div id="notesAllWrap" class="control-group">' + radio('notesAllMode', [['same', '全ページ同じ所感'], ['individual', 'ページごとに異なる所感']]) + '</div>' +
      '<p class="help">「全ページ」が他の指定より優先。ページ番号は補記を除く棋譜図の順番。長い所感の続きは最後に補記する。</p></div>' +
      '<div id="notesByPage"></div><p id="notesDivisionHint" class="help warning" hidden></p><p id="notesPageHint" class="help" aria-live="polite"></p><button id="showNotesPage" type="button" class="text-button">所感の掲載ページを表示</button>' +
      '<p class="help">所感は入力中のページをプレビュー。全ページ同文の長い所感は、共通の補記を一度だけ作成する。本文は表示設定の保存対象外。</p></section>';
  }
  function boardCount() {
    if (!state.model) return 0;
    const s = state.settings, step = s.mode === 'all' ? Math.max(1, state.model.total) : Number(s.split === 'custom' ? s.customSplit : s.split);
    return step > 0 ? Math.min(K.LIMITS.pages, Math.max(1, Math.ceil(state.model.total / step))) : 0;
  }
  function syncNotes() {
    const s = state.settings, count = boardCount(), individual = s.notesPlacement.all && s.notesAllMode === 'individual';
    $('notesCustomWrap').hidden = !s.notesPlacement.custom || s.notesPlacement.all;
    $('notesAllWrap').hidden = !s.notesPlacement.all;
    document.querySelectorAll('[data-setting^="notesPlacement."]').forEach(e => { e.disabled = s.notesPlacement.all && e.dataset.setting !== 'notesPlacement.all'; });
    $('meta_notes').hidden = individual;
    const container = $('notesByPage'); container.hidden = !individual;
    if (individual && container.dataset.count !== String(count)) {
      container.replaceChildren();
      for (let i = 1; i <= count; i++) {
        const wrap = document.createElement('div'); wrap.className = 'page-note';
        const label = document.createElement('label'); label.className = 'field-label'; label.htmlFor = 'notes_page_' + i;
        const textarea = document.createElement('textarea'); textarea.id = label.htmlFor; textarea.dataset.notePage = String(i); textarea.maxLength = K.LIMITS.notes;
        textarea.placeholder = `${i}ページ目の所感`; textarea.value = (state.meta.notesByPage || {})[i] || '';
        wrap.append(label, textarea); container.append(wrap);
      }
      container.dataset.count = String(count);
    }
    if (individual) {
      const step = s.mode === 'all' ? Math.max(1, state.model ? state.model.total : 1) : Number(s.split === 'custom' ? s.customSplit : s.split);
      container.querySelectorAll('[data-note-page]').forEach(e => {
        const n = Number(e.dataset.notePage), start = state.model && state.model.total ? (n-1)*step+1 : 0, end = Math.min(n*step, state.model ? state.model.total : 0);
        e.previousElementSibling.textContent = `${n}ページ目（${start}〜${end}手）の所感`;
        if (document.activeElement !== e) e.value = (state.meta.notesByPage || {})[n] || '';
      });
    }
    $('notesDivisionHint').hidden = !individual;
    const hiddenCount = Object.entries(state.meta.notesByPage || {}).filter(([n, text]) => Number(n) > count && text.trim()).length;
    $('notesDivisionHint').textContent = '本文はページ番号に対応。分割手数を変えた場合は各ページの内容を確認してね。' + (hiddenCount ? ` 現在のページ数を超える${hiddenCount}件は一時保持中（出力されない）。` : '');
  }
  function getPath(o, path) { return path.split('.').reduce((a, k) => a[k], o); }
  function setPath(o, path, value) { const p = path.split('.'), key = p.pop(); let a = o; for (const k of p) a = a[k]; a[key] = value; }
  function setControl(input, value) {
    if (input.type === 'radio') input.checked = String(value) === input.value;
    else if (input.type === 'checkbox') input.checked = !!value;
    else if (document.activeElement !== input) input.value = value == null ? '' : String(value);
  }
  function syncForms() {
    const s = state.settings, m = state.meta;
    document.querySelectorAll('[data-setting]').forEach(e => setControl(e, getPath(s, e.dataset.setting)));
    document.querySelectorAll('[data-meta]').forEach(e => setControl(e, m[e.dataset.meta]));
    document.querySelectorAll('[data-include]').forEach(e => setControl(e, m.include[e.dataset.include]));
    document.querySelectorAll('[data-time]').forEach(e => setControl(e, m.time[e.dataset.time]));
    document.querySelectorAll('[data-optional]').forEach(e => {
      const key = e.dataset.optional, included = !!m.include[key]; e.classList.toggle('optional-inactive', !included);
      const input = $(`meta_${key}`); if (input) input.disabled = key !== 'notes' && !included;
    });
    $('horizontalLayouts').hidden = s.infoDirection !== 'horizontal'; $('verticalLayouts').hidden = s.infoDirection !== 'vertical';
    syncNotes();
    $('splitOptions').hidden = s.mode !== 'split'; $('customSplitWrap').hidden = s.split !== 'custom';
    const kanji = s.numbers && s.numberStyle === 'kanji';
    $('kanjiLock').hidden = !kanji; $('coordinateOptions').hidden = !s.coordinates; $('numberOptions').hidden = !s.numbers;
    $('fontBox').hidden = !kanji;
    document.querySelectorAll('[data-setting="mode"],[data-setting="split"],[data-setting="customSplit"]').forEach(e => { e.disabled = kanji; });
    $('boardColorWrap').hidden = s.boardColor !== 'custom'; $('stoneColorWrap').hidden = s.stoneColor !== 'custom';
    $('repeatOptions').hidden = !s.repeats; $('repeatStoneOptions').hidden = !s.repeatStones;
    $('timeOptions').hidden = !m.include.time;
    const spec = K.TIME_CONTROLS[m.time.mode];
    document.querySelectorAll('[id^="timeField_"]').forEach(el => { el.hidden = true; });
    const changedTimeMode = $('timeOptions').dataset.mode !== m.time.mode;
    if (spec) spec.fields.forEach(([key, label, min, integer]) => {
      const wrap = $('timeField_' + key); wrap.hidden = false; if (changedTimeMode) $('timeOptions').append(wrap);
      $('timeLabel_' + key).textContent = label;
      $('time_' + key).min = String(min); $('time_' + key).step = integer ? '1' : 'any';
    });
    if (changedTimeMode) $('timeOptions').append($('timeRaw'));
    $('timeOptions').dataset.mode = m.time.mode;
    $('handicapHint').hidden = m.handicap !== '' || m.komi === '' || Number(m.komi) !== 0;
    $('timeRaw').hidden = !m.time.raw || m.time.recognized;
    $('timeRaw').textContent = m.time.raw && !m.time.recognized ? `OTの原文：${m.time.raw}。方式・数値を自動判別できないので確認して入力してね。` : '';
    if (fontState.status === 'ready') $('fontStatus').textContent = `読込済み：${fontState.name}`;
    else if (fontState.status === 'loading') $('fontStatus').textContent = '行書体フォントを読み込み中…';
    else if (fontState.status === 'error') $('fontStatus').textContent = fontState.error;
    else $('fontStatus').textContent = '漢数字を選ぶと端末の行書体を確認するよ。サイトに行書体が設定されている場合は自動読込。見つからなければフォントファイルを選択してね。';
    $('retryFont').disabled = state.busy || fontState.status === 'loading';
  }
  function missing() {
    const reasons = [];
    if (!state.tree || !state.model) reasons.push(state.loadError || 'SGFの読み込み・検査が必要です。');
    if (state.validation && !state.validation.ok) reasons.push('SGFの検査に合格していません。');
    if (state.tree) reasons.push(...K.validateMetadata(state.meta));
    reasons.push(...K.validateSettings(state.settings));
    if (state.layoutError) reasons.push(state.layoutError);
    if (state.settings.numbers && state.settings.numberStyle === 'kanji' && fontState.status !== 'ready') reasons.push('漢数字用の行書体フォントを読み込んでください。');
    if (!state.plans.length && state.model && !state.layoutError) reasons.push('プレビューを準備しています。');
    return [...new Set(reasons)];
  }
  function updateStatus() {
    const m = state.meta, validation = state.validation, errors = missing();
    const validMeta = state.tree ? K.validateMetadata(m) : [];
    $('missingFields').hidden = !validMeta.length;
    $('missingFields').textContent = validMeta.slice(0, 3).join(' ') + (validMeta.length > 3 ? ` ほか${validMeta.length - 3}項目。` : '');
    for (const key of ['black', 'white', 'handicap', 'result', 'rule', 'komi']) {
      const el = $('meta_' + key);
      const invalid = !!state.tree && (key === 'komi' ? m.komi === '' || !Number.isFinite(Number(m.komi)) : !m[key]);
      el.classList.toggle('invalid', invalid); el.setAttribute('aria-invalid', String(invalid));
    }
    $('downloadButton').disabled = state.busy || state.loading || !!errors.length;
    $('downloadButton').textContent = `${state.settings.format.toUpperCase()}をダウンロード`;
    $('downloadButton').title = errors.join('\n');
    $('settingsFields').disabled = !state.model || state.busy || state.loading;
    $('saveSettings').disabled = state.busy || state.loading; $('exportSettings').disabled = state.busy; $('importSettings').disabled = state.busy;
    $('infoFields').disabled = !state.tree || state.busy || state.loading;
    $('resetSettings').disabled = !state.model || state.busy;
    for (const id of ['chooseTop', 'chooseCenter', 'dropMini', 'encoding', 'gameSelect', 'branchSelect']) $(id).disabled = state.busy || state.loading;
    $('cancelExport').hidden = !state.busy;
    $('fileInput').disabled = state.busy || state.loading;
    const status = $('status'), dot = $('statusDot'); dot.className = 'status-dot';
    if (state.loading) { status.textContent = 'SGFを読み込み・検査中…'; dot.classList.add('pending'); }
    else if (state.loadError) { status.textContent = '読み込みできません。検査結果を確認してね。'; dot.classList.add('error'); }
    else if (validation && !validation.ok) { status.textContent = '検査未合格：出力できません'; dot.classList.add('error'); }
    else if (state.model) {
      status.textContent = `${m.rule ? '検査合格' : '基本検査合格・ルール未選択'}  ·  ${state.model.total}手  ·  ${state.model.size.w}×${state.model.size.h}路`;
      dot.classList.add(m.rule ? 'ok' : 'pending');
    } else status.textContent = 'SGFを選んで、棋譜を作ろう。';
    $('errorBar').hidden = !(state.loadError || state.layoutError || state.exportError);
    $('errorBar').textContent = state.loadError || state.layoutError || state.exportError;
    ['step1', 'step2', 'step3', 'step4'].forEach((id, i) => $(id).classList.toggle('active', i === 0 || (i === 1 && !!state.tree) || (i === 2 && !!state.model) || (i === 3 && !errors.length)));
  }
  function showValidation() {
    const d = $('validationDetails'), body = $('validationBody'); body.replaceChildren();
    if (!state.validation && !state.loadError) { d.hidden = true; return; }
    d.hidden = false;
    const v = state.validation;
    $('validationTitle').textContent = state.loadError ? '読み込みエラー' : v.ok ? `検査合格 / ${v.branches.length}分岐` : `検査未合格 / ${v.errors.length}件`;
    const add = (text, cls = '') => { const p = document.createElement('p'); p.textContent = text; p.className = cls; body.append(p); };
    if (state.loadError) add(state.loadError, 'validation-error');
    if (v) {
      if (v.ok) add('選択した対局の全分岐を検査済み。盤外着手・重複着手・手番・取り石・自殺手・コウを確認。');
      for (const e of v.errors) add(e, 'validation-error');
      for (const w of [...state.decodeWarnings, ...v.warnings]) add(w, 'validation-warning');
      add('終局の合意、死活・セキ、地合い、勝敗の正しさ、時間切れ、反復時の審判裁定までは検査しない。', 'help');
    }
    if (state.loadError || (v && !v.ok)) d.open = true;
  }
  function updateSelectors() {
    $('gameWrap').hidden = !state.collection || state.collection.games.length < 2;
    if (state.collection) {
      $('gameSelect').replaceChildren(...state.collection.games.map((t, i) => {
        const o = document.createElement('option'), root = t.nodes[0].props;
        o.value = String(i); o.textContent = `${i + 1}: ${K.first(root, 'PB', '黒番未記載')} vs ${K.first(root, 'PW', '白番未記載')}`; return o;
      })); $('gameSelect').value = String(state.game);
    }
    const bs = state.tree ? K.listBranches(state.tree) : [];
    $('branchWrap').hidden = bs.length < 2;
    $('branchSelect').replaceChildren(...bs.map((b, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = b.label; return o; }));
    $('branchSelect').value = String(state.branch);
  }
  function validateAndReplay() {
    if (!state.tree) return;
    state.validation = K.validateGame(state.tree, state.meta.rule);
    if (state.validation.ok) state.model = K.replay(state.tree, state.branch, state.meta.rule);
    showValidation(); requestRender();
  }
  function activateGame(game, branch = 0) {
    state.game = game; state.branch = branch; state.page = 0; state.model = null; state.plans = [];
    state.tree = state.collection.games[game];
    const bs = K.listBranches(state.tree);
    state.meta = K.metadata(bs[branch].nodes);
    $('notesByPage').dataset.count = ''; // discard DOM for the previous game, never carry its text
    state.focusNotes = false;
    updateSelectors(); syncForms(); validateAndReplay(); updateStatus();
  }
  async function readFile(file) {
    if (state.busy) return;
    const seq = ++state.seq;
    state.loading = true; state.file = file; state.loadError = ''; state.layoutError = ''; state.exportError = '';
    state.collection = null; state.tree = null; state.model = null; state.plans = []; state.validation = null;
    state.decodeWarnings = []; state.meta = K.metadata([]); state.page = 0;
    $('empty').hidden = false; $('paperWrap').hidden = true; $('downloadResult').hidden = true;
    $('fileSummary').textContent = file ? file.name : 'ファイルが選ばれていません。';
    updateStatus(); syncForms(); showValidation();
    try {
      if (!file || !/\.sgf$/i.test(file.name)) throw new Error('拡張子が .sgf のファイルを1つ選択してください。');
      if (file.size > K.LIMITS.bytes) throw new Error('SGFは5 MiB以下にしてください。');
      const buffer = await file.arrayBuffer(); if (seq !== state.seq) return;
      await new Promise(resolve => setTimeout(resolve, 0));
      const decoded = K.decode(buffer, $('encoding').value), parsed = K.parse(decoded.text);
      if (seq !== state.seq) return;
      state.decodeWarnings = decoded.warnings; state.encoding = decoded.encoding; state.collection = parsed;
      $('fileSummary').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB · ${decoded.encoding} · ${parsed.games.length}対局`;
      activateGame(0);
    } catch (e) {
      if (seq !== state.seq) return;
      state.loadError = e.message || String(e); state.model = null; state.plans = [];
      state.tree = null; state.collection = null; state.validation = null;
      showValidation();
    } finally {
      if (seq === state.seq) { state.loading = false; updateSelectors(); updateStatus(); requestRender(); }
    }
  }
  function installFont(result, generation) {
    // Ignore an older auto-load after the user has selected another font.
    if (generation !== fontState.generation) return;
    if (fontState.face) document.fonts.delete(fontState.face);
    document.fonts.add(result.face);
    fontState.face = result.face; fontState.name = result.name;
    fontState.status = 'ready'; fontState.error = '';
    R.clearFontCache(); syncForms(); requestRender();
  }
  async function ensureFont(force = false) {
    if (fontState.status === 'ready' && !force) return;
    if (fontState.status === 'loading') return fontState.pending;
    if (fontState.status === 'error' && !force) return;
    if (fontState.controller) fontState.controller.abort();
    const controller = new AbortController(), generation = ++fontState.generation;
    fontState.controller = controller; fontState.status = 'loading'; fontState.error = '';
    syncForms(); updateStatus();
    fontState.pending = (async () => {
      try { installFont(await F.loadAutomatic(controller.signal), generation); }
      catch (e) {
        if (generation === fontState.generation) {
          fontState.status = 'error'; fontState.error = e.message || String(e);
          syncForms(); requestRender();
        }
      } finally { updateStatus(); }
    })();
    return fontState.pending;
  }
  async function readFont(file) {
    if (!file || state.busy) return;
    if (fontState.controller) fontState.controller.abort();
    const generation = ++fontState.generation;
    fontState.status = 'loading'; fontState.error = ''; syncForms(); updateStatus();
    try { installFont(await F.loadFile(file), generation); }
    catch (e) { if (generation === fontState.generation) { fontState.status = 'error'; fontState.error = e.message || String(e); } }
    syncForms(); requestRender(); updateStatus();
  }
  function requestRender() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => { state.raf = 0; render(); });
  }
  function render() {
    state.layoutError = '';
    if (!state.model) { $('empty').hidden = false; $('paperWrap').hidden = true; updateStatus(); return; }
    syncForms();
    const errors = K.validateSettings(state.settings);
    if (errors.length) { state.layoutError = errors[0]; previewOldWarning(state.layoutError); updateStatus(); return; }
    try {
      const plans = R.getPlans(state.model, state.settings, state.meta);
      state.plans = plans;
      const selected = state.meta.include.notes ? K.notePages(state.settings, boardCount()) : [];
      if (state.focusNotes) {
        const source = typeof state.focusNotes === 'number' ? state.focusNotes : selected[0];
        const target = plans.findIndex(p => p.type === 'board' && p.source === source);
        if (target >= 0) state.page = target;
        state.focusNotes = false;
      }
      const published = plans.filter(p => p.type === 'board' && p.notesText && p.notesText.trim()).map(p => p.source);
      $('notesPageHint').textContent = published.length ? `所感を掲載：棋譜図 ${published.join('、')}ページ。` : '所感は未入力、非掲載、または掲載先の選択なし。';
      state.page = Math.max(0, Math.min(state.page, plans.length - 1));
      const kanjiMissing = state.settings.numbers && state.settings.numberStyle === 'kanji' && fontState.status !== 'ready';
      const invalidRule = state.validation && !state.validation.ok;
      const draft = invalidRule ? '検査未合格' : kanjiMissing ? '行書体 読込待ち' : '';
      R.draw($('previewCanvas'), plans[state.page], state.settings, 110, { draft });
      $('empty').hidden = true; $('paperWrap').hidden = false; $('previewWarning').hidden = true;
      $('pageSelect').replaceChildren(...plans.map((p, i) => {
        const opt = document.createElement('option'); opt.value = String(i); opt.textContent = `${i + 1} / ${plans.length}  ${p.type === 'board' ? `${p.diagram.start}〜${p.diagram.end}手` : '補記'}`; return opt;
      }));
      $('pageSelect').disabled = false; $('pageSelect').value = String(state.page);
      $('prevPage').disabled = state.page <= 0; $('nextPage').disabled = state.page >= plans.length - 1;
      const boards = plans.filter(p => p.type === 'board').length, extras = plans.length - boards;
      $('pageSummary').textContent = `${state.settings.paper}${state.settings.paper === 'B5' ? '（JIS）' : ''}・${state.settings.orientation === 'portrait' ? '縦' : '横'} ／ 棋譜${boards}枚${extras ? `＋補記${extras}枚` : ''} ／ 全${plans.length}ページ`;
      fitPreview();
      if (kanjiMissing) ensureFont();
    } catch (e) {
      state.layoutError = e.message || String(e); previewOldWarning(state.layoutError);
    }
    updateStatus();
  }
  function previewOldWarning(message) {
    $('previewWarning').hidden = false;
    $('previewWarning').textContent = `${message} 変更を反映できないため、直前のプレビューを表示中。ダウンロードは無効。`;
  }
  function fitPreview() {
    if ($('paperWrap').hidden || !state.plans.length) return;
    const p = state.plans[state.page], st = $('stage'), css = getComputedStyle(st);
    const w = Math.max(70, st.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
    const h = Math.max(70, st.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom));
    const mode = $('zoom').value;
    let width = mode === 'fit' ? Math.min(w, h * p.W / p.H) : mode === 'width' ? w : p.W * 96 / 25.4 * Number(mode) / 100;
    width = Math.max(60, width);
    const canvas = $('previewCanvas'); canvas.style.width = `${width}px`; canvas.style.height = `${width * p.H / p.W}px`;
    $('paperWrap').style.width = canvas.style.width; $('paperWrap').style.height = canvas.style.height;
    st.classList.toggle('zoomed', mode !== 'fit');
  }
  function togglePanel(side, forceCollapsed) {
    const cls = `${side}-collapsed`, collapsed = forceCollapsed === undefined ? !$('workspace').classList.contains(cls) : forceCollapsed;
    $('workspace').classList.toggle(cls, collapsed);
    const key = side === 'left' ? 'Left' : 'Right'; $(`toggle${key}`).setAttribute('aria-expanded', String(!collapsed));
    $(`${side}Rail`).hidden = !collapsed;
    if (root.matchMedia('(max-width:950px)').matches && !collapsed) {
      const other = side === 'left' ? 'right' : 'left';
      $('workspace').classList.add(`${other}-collapsed`); $(`${other}Rail`).hidden = false;
      $(`toggle${other === 'left' ? 'Left' : 'Right'}`).setAttribute('aria-expanded', 'false');
    }
    requestAnimationFrame(fitPreview);
  }
  async function download() {
    // Apply a pending input frame and validate again, not just the button state.
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    render(); const reasons = missing();
    if (reasons.length || state.busy) { if (reasons.length) { $('errorBar').hidden = false; $('errorBar').textContent = reasons.join(' '); } return; }
    state.exportError = ''; state.busy = true; state.controller = new AbortController(); document.body.classList.add('busy');
    $('progressWrap').hidden = false; $('downloadResult').hidden = true; updateStatus();
    if (state.lastDownload) { state.lastDownload.revoke(); state.lastDownload = null; }
    try {
      // Freeze the selected page plan and settings for the duration of export.
      const settings = JSON.parse(JSON.stringify(state.settings)), plans = state.plans;
      const output = await E.generate(plans, settings, state.file.name, (current, total, text) => {
        $('progress').value = current / total * 100; $('progressLabel').textContent = text;
      }, state.controller.signal);
      state.lastDownload = E.save(output.blob, output.name);
      const result = $('downloadResult'); result.replaceChildren();
      const msg = document.createElement('span'); msg.textContent = `作成完了（${(output.blob.size / 1024 / 1024).toFixed(2)} MiB）。保存が始まらない場合： `;
      const link = document.createElement('a'); link.href = state.lastDownload.url; link.download = output.name; link.target = '_self'; link.textContent = output.name;
      result.append(msg, link); result.hidden = false;
    } catch (e) {
      state.exportError = e.name === 'AbortError' ? '出力を中止したよ。途中のファイルは保存していない。' : `出力に失敗したよ：${e.message || e}`;
    } finally {
      state.busy = false; state.controller = null; document.body.classList.remove('busy'); $('progressWrap').hidden = true;
      updateStatus();
      // Export errors remain visible until another export or an input edit.
    }
  }
  function bind() {
    for (const id of ['chooseTop', 'chooseCenter', 'dropMini']) $(id).addEventListener('click', () => { $('fileInput').value = ''; $('fileInput').click(); });
    $('fileInput').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
    $('encoding').addEventListener('change', () => { if (state.file) readFile(state.file); });
    $('gameSelect').addEventListener('change', e => activateGame(Number(e.target.value)));
    $('branchSelect').addEventListener('change', e => activateGame(state.game, Number(e.target.value)));
    const settingsInput = e => {
      const path = e.target.dataset.setting; if (!path || state.busy) return;
      state.exportError = '';
      const v = e.target.type === 'checkbox' ? e.target.checked : path === 'dpi' ? Number(e.target.value) : e.target.value;
      setPath(state.settings, path, v); state.settings = K.normalizeSettings(state.settings);
      if (path.startsWith('notes')) state.focusNotes = true;
      $('settingsSaveStatus').dataset.error = 'false';
      $('settingsSaveStatus').textContent = '変更あり。「表示設定を保存」で次回にも引き継げる。';
      state.page = Math.max(0, Math.min(state.page, state.plans.length - 1)); syncForms(); requestRender();
    };
    $('settingsForm').addEventListener('input', settingsInput);
    $('infoForm').addEventListener('input', settingsInput);
    $('infoForm').addEventListener('input', e => {
      if (state.busy) return;
      const t = e.target;
      state.exportError = '';
      if (t.dataset.meta) {
        state.meta[t.dataset.meta] = t.value;
        if (t.dataset.meta === 'notes' && t.value.trim()) { state.meta.include.notes = true; state.focusNotes = true; }
        if (t.dataset.meta === 'rule') validateAndReplay();
      } else if (t.dataset.include) {
        state.meta.include[t.dataset.include] = t.checked;
        if (t.dataset.include === 'notes' && t.checked) state.focusNotes = true;
      }
      else if (t.dataset.time) state.meta.time[t.dataset.time] = t.value;
      else if (t.dataset.notePage) {
        state.meta.notesByPage[t.dataset.notePage] = t.value;
        if (t.value.trim()) state.meta.include.notes = true;
        state.focusNotes = Number(t.dataset.notePage);
      }
      else return;
      syncForms(); requestRender();
    });
    $('fontFile').addEventListener('change', e => readFont(e.target.files[0]));
    $('retryFont').addEventListener('click', () => ensureFont(true));
    $('showNotesPage').addEventListener('click', () => { state.focusNotes = true; requestRender(); });
    $('resetSettings').addEventListener('click', () => { document.querySelectorAll('#settingsBody details').forEach(d => { d.open = false; }); state.settings = K.defaults(); state.page = 0; $('settingsSaveStatus').textContent = '初期値に変更。保存済み設定も更新するには「表示設定を保存」を押してね。'; syncForms(); requestRender(); });
    $('saveSettings').addEventListener('click', () => {
      try { P.save(state.settings); $('settingsSaveStatus').textContent = '表示設定を保存したよ。次回、同じブラウザで自動復元する。'; $('settingsSaveStatus').dataset.error = 'false'; }
      catch (e) { $('settingsSaveStatus').textContent = e.message; $('settingsSaveStatus').dataset.error = 'true'; }
    });
    $('exportSettings').addEventListener('click', () => {
      try { const saved = E.save(new Blob([P.encode(state.settings)], {type:'application/json'}), 'KifuPrintWeb-settings.json'); setTimeout(saved.revoke, 60000); }
      catch (e) { $('settingsSaveStatus').textContent = e.message; }
    });
    $('importSettings').addEventListener('click', () => { $('settingsFile').value = ''; $('settingsFile').click(); });
    $('settingsFile').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file || state.busy) return;
      try {
        if (file.size > 50000) throw new Error('設定ファイルは50 KB以内にしてください。');
        state.settings = P.decode(await file.text()); syncForms(); requestRender();
        $('settingsSaveStatus').dataset.error = 'false';
        $('settingsSaveStatus').textContent = '設定を読み込んだよ。次回用に残すには「表示設定を保存」を押してね。';
      } catch (err) { $('settingsSaveStatus').dataset.error = 'true'; $('settingsSaveStatus').textContent = '設定を読み込めません：' + err.message; }
    });
    $('downloadButton').addEventListener('click', download);
    $('cancelExport').addEventListener('click', () => { if (state.controller) state.controller.abort(); });
    $('prevPage').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); requestRender(); });
    $('nextPage').addEventListener('click', () => { state.page = Math.min(state.plans.length - 1, state.page + 1); requestRender(); });
    $('pageSelect').addEventListener('change', e => { state.page = Number(e.target.value); requestRender(); });
    $('zoom').addEventListener('change', fitPreview);
    for (const side of ['left', 'right']) {
      $(`toggle${side === 'left' ? 'Left' : 'Right'}`).addEventListener('click', () => togglePanel(side));
      $(`${side}Rail`).addEventListener('click', () => togglePanel(side, false));
    }
    document.addEventListener('keydown', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && state.page > 0) { state.page--; requestRender(); }
      if (e.key === 'ArrowRight' && state.page + 1 < state.plans.length) { state.page++; requestRender(); }
      if (e.key === 'Escape' && matchMedia('(max-width:950px)').matches) { togglePanel('left', true); togglePanel('right', true); }
    });
    let dragDepth = 0;
    const isFileDrag = e => Array.from(e.dataTransfer ? e.dataTransfer.types : []).includes('Files');
    root.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
    root.addEventListener('drop', e => {
      if (!isFileDrag(e)) return; e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true;
      if (state.busy || state.loading) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length !== 1) { $('errorBar').hidden = false; $('errorBar').textContent = 'SGFは1回に1ファイルだけドロップしてね。'; return; }
      readFile(files[0]);
    });
    $('center').addEventListener('dragenter', e => { if (isFileDrag(e)) { e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; } });
    $('center').addEventListener('dragleave', e => { if (isFileDrag(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; } });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitPreview).observe($('stage'));
    else root.addEventListener('resize', fitPreview);
    root.addEventListener('resize', () => { if (matchMedia('(max-width:950px)').matches && !state.mobile) { togglePanel('left', true); togglePanel('right', true); state.mobile = true; } else if (!matchMedia('(max-width:950px)').matches) state.mobile = false; });
  }
  const stored = P.load(); if (stored.settings) state.settings = stored.settings;
  makeForms(); bind(); syncForms(); updateStatus();
  if (stored.error) { $('settingsSaveStatus').textContent = stored.error; $('settingsSaveStatus').dataset.error = 'true'; }
  else if (stored.settings) $('settingsSaveStatus').textContent = '保存済みの表示設定を復元したよ。';
  R.ready().then(() => requestRender());
  if ($('bootNotice')) $('bootNotice').hidden = true;
  if (matchMedia('(max-width:950px)').matches) { state.mobile = true; togglePanel('left', true); togglePanel('right', true); }
  // Read-only diagnostic access helps reproduce a problem without uploading SGF.
  root.KifuApp = { version: '2.0.0', readFile, render, get state() { return state; }, get fontState() { return fontState; } };
})(globalThis);
