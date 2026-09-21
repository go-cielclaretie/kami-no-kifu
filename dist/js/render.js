/* Shared Canvas renderer. Coordinates are millimetres; preview and export use
 * the same page plan. Textures are deterministic; flat-sawn grain is reconstructed from a user-provided photograph.
 */
(function (root) {
  'use strict';
  const K = root.KifuCore;
  const itameImage = new Image();
  let textureError = '';
  const assetsReady = new Promise(resolve => {
    itameImage.onload = () => resolve(true);
    itameImage.onerror = () => { textureError = '板目の画像素材を読み込めません。ページを再読み込みしてください。'; resolve(false); };
    if (root.KifuAssets && root.KifuAssets.itame) itameImage.src = root.KifuAssets.itame;
    else { textureError = '板目の画像素材がありません。assets/itame-grain.png の配置を確認してください。'; resolve(false); }
  });
  const PAPERS = Object.freeze({ A3: [297, 420], A4: [210, 297], A5: [148, 210], B5: [182, 257] });
  const SANS = '"Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif';
  const DIGITS = 'Arial, "Noto Sans", sans-serif';
  const fontAssets = new Map((root.KifuConfig && root.KifuConfig.fontAssets || []).map(item => [item.id, item]));
  let activeFontFamily = SANS;
  function selectedFontFamily(input, role, kanji = false) {
    const s = K.normalizeSettings(input), choice = s.fonts[role];
    const fallback = role === 'number' ? (kanji ? '"KifuGyosho", "Yu Mincho", serif' : DIGITS) : SANS;
    if (choice === 'system' && s.fontFamilies[role].trim()) return `${JSON.stringify(s.fontFamilies[role].trim())}, ${fallback}`;
    if (typeof choice === 'string' && choice.startsWith('asset:')) {
      const item = fontAssets.get(choice.slice(6));
      if (item) return `"${item.family}", ${fallback}`;
    }
    if (role === 'number' && choice === 'auto') return fallback;
    return fallback;
  }
  function withFontFamily(family, work) {
    const previous = activeFontFamily; activeFontFamily = family || SANS;
    try { return work(); } finally { activeFontFamily = previous; }
  }
  const measureCanvas = document.createElement('canvas');
  const mc = measureCanvas.getContext('2d');
  const glyphCache = new Map();
  let segmenter;
  try { segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' }); } catch (_) { /* Array.from is adequate on old browsers. */ }
  function chars(s) { return segmenter ? Array.from(segmenter.segment(s), v => v.segment) : Array.from(s); }
  function font(ctx, size = 3, weight = 400, family = activeFontFamily) { ctx.font = `${weight} ${size}px ${family}`; }
  function textWidth(s, size = 3, weight = 400, family = activeFontFamily) { font(mc, size, weight, family); return mc.measureText(s).width; }
  function wrap(text, width, size = 3, weight = 400, family = activeFontFamily) {
    if (width <= 0) throw new Error('文字領域の幅が不足しています。');
    font(mc, size, weight, family);
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const ch of chars(para)) {
        if (line && mc.measureText(line + ch).width > width) { out.push(line); line = ch; }
        else line += ch;
      }
      if (line) out.push(line);
    }
    return out;
  }
  function addText(blocks, text, x, y, w, size = 3, weight = 400, color = '#222222', leading = 1.48, family = activeFontFamily) {
    const lines = Array.isArray(text) ? text : wrap(text, w, size, weight, family);
    const lh = size * leading;
    blocks.push({ kind: 'text', lines, x, y, w, size, weight, color, lh, family });
    return lines.length * lh;
  }
  function paperSize(s) { const p = PAPERS[s.paper].slice(); return s.orientation === 'landscape' ? p.reverse() : p; }
  function timeLines(m) {
    const t = K.normalizeTime(m.time), v = x => x === '' || x == null ? '未入力' : String(x);
    switch (t.mode) {
      case 'japanese': return [`日本式　${v(t.minutes)}分`, `秒読み${v(t.seconds)}秒 × ${v(t.periods)}回`];
      case 'canadian': return [`カナダ式　${v(t.minutes)}分`, `予備時間${v(t.overtimeMinutes)}分で${v(t.moves)}手`];
      case 'fischer': return [`フィッシャー式　${v(t.minutes)}分`, `1手ごとに${v(t.increment)}秒加算`];
      case 'absolute': return [`切れ負け　${v(t.minutes)}分`];
      case 'byoyomi': return ['秒読み', `一手あたり${v(t.perMoveSeconds)}秒`];
      case 'nhk': return ['NHK杯式', `一手あたり${v(t.perMoveSeconds)}秒`, `考慮時間${v(t.seconds)}秒 × ${v(t.periods)}回`];
      default: return [`方式未選択　${v(t.minutes)}分`];
    }
  }
  function numberText(value) {
    return String(Number(Number(value).toFixed(6)));
  }
  function formatChildCount(value) {
    const sign = value < 0 ? '−' : '', amount = Math.abs(value), whole = Math.floor(amount + 1e-7), fraction = amount - whole;
    if (fraction < 1e-6) return sign + String(whole);
    let best = null;
    for (let den = 2; den <= 256; den++) {
      const num = Math.round(fraction * den), error = Math.abs(fraction - num / den);
      if (num > 0 && num < den && (!best || error < best.error)) best = { num, den, error };
      if (best && best.error < 1e-7) break;
    }
    if (!best || best.error > 1e-5) return sign + numberText(amount);
    const part = `${best.num}/${best.den}`;
    return sign + (whole ? `${whole} ${part}` : part);
  }
  function formatPoints(value, format, unit = true) {
    const sign = value < 0 ? '−' : '', amount = Math.abs(Number(value));
    if (format === 'sgf') return `${value < 0 ? '-' : ''}${numberText(amount)}`;
    if (format === 'stones') return `${formatChildCount(Number(value) * 2)}${unit ? '子' : ''}`;
    if (format === 'half') {
      const whole = Math.floor(amount + 1e-7), fraction = amount - whole;
      if (Math.abs(fraction - .5) < 1e-6) return `${sign}${whole ? `${whole}目半` : '半目'}`;
    }
    return `${sign}${numberText(amount)}${unit ? '目' : ''}`;
  }
  function dateText(text, input = K.defaults()) {
    const s = K.normalizeSettings(input), eras = [
      ['令和', 2019, 5, 1], ['平成', 1989, 1, 8], ['昭和', 1926, 12, 25],
      ['大正', 1912, 7, 30], ['明治', 1868, 1, 25]
    ];
    const source = String(text).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[／]/g, '/').replace(/[．]/g, '.').replace(/[－−]/g, '-');
    const gregorian = source.replace(/(^|[^\d])(令和|平成|昭和|大正|明治)(元|\d+)年(\d{1,2})月(?:(\d{1,2})日)?(?!\d)/g,
      (_, prefix, eraName, eraYear, month, day) => {
        const start = eras.find(era => era[0] === eraName)[1], year = start + (eraYear === '元' ? 1 : Number(eraYear)) - 1;
        return `${prefix}${year}年${month}月${day ? `${day}日` : ''}`;
      });
    return gregorian.replace(/(^|[^\d])(\d{4})(?:(?:[-./](\d{1,2})(?:[-./](\d{1,2}))?)|(?:年(\d{1,2})月(?:(\d{1,2})日)?))(?!\d)/g,
      (_, prefix, yearText, separatedMonth, separatedDay, japaneseMonth, japaneseDay) => {
        const monthText = separatedMonth || japaneseMonth, dayText = separatedDay || japaneseDay;
        const year = Number(yearText), month = Number(monthText), day = dayText ? Number(dayText) : 1;
        let yearOut = yearText;
        if (s.dateCalendar === 'wareki') {
          const era = eras.find(([, startYear, startMonth, startDay]) =>
            year > startYear || year === startYear && (month > startMonth || month === startMonth && day >= startDay));
          if (era) {
            const count = year - era[1] + 1;
            yearOut = era[0] + (count === 1 ? '元' : String(count));
          }
        }
        const monthOut = String(month).padStart(2, '0'), dayOut = dayText ? String(Number(dayText)).padStart(2, '0') : '';
        let formatted;
        if (s.dateFormat === 'japanese') {
          formatted = `${yearOut}年${monthOut}月${dayText ? `${dayOut}日` : ''}`;
        } else {
          const separator = s.dateFormat === 'dot' ? '.' : s.dateFormat === 'slash' ? '/' : '-';
          formatted = `${yearOut}${separator}${monthOut}${dayText ? `${separator}${dayOut}` : ''}`;
        }
        return prefix + formatted;
      });
  }
  function fractionValue(text) {
    const mixed = /^([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
    if (mixed && Number(mixed[3])) return Math.sign(Number(mixed[1]) || 1) * (Math.abs(Number(mixed[1])) + Number(mixed[2]) / Number(mixed[3]));
    const fraction = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(text);
    if (fraction && Number(fraction[2])) return Number(fraction[1]) / Number(fraction[2]);
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function resultDetails(raw) {
    const original = String(raw || '').trim(), s = original.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[＋]/g, '+').replace(/　/g, ' ');
    if (!s) return null;
    if (/^(?:0|draw|jigo|持碁|引き分け|引分)$/i.test(s)) return { kind: 'draw' };
    if (/^(?:void|無勝負)$/i.test(s)) return { kind: 'void' };
    if (/^(?:\?|未終局)$/i.test(s)) return { kind: 'unknown' };
    const sideMatch = /^([BW黒黑白])\s*(?:\+\s*)?(.*)$/i.exec(s);
    if (!sideMatch) return null;
    const color = /^[Bb黒黑]$/.test(sideMatch[1]) ? 'B' : 'W', side = color === 'B' ? '黒' : '白';
    const body = sideMatch[2].trim();
    if (/^(?:R|Resign|投了|中押|中押し|中盤|中盘)(?:\b|勝ち|勝|胜)?/i.test(body)) return { kind: 'reason', color, side, reason: 'R' };
    if (/^(?:T|Time|時間切れ|時間切)(?:\b|勝ち|勝|胜)?/i.test(body)) return { kind: 'reason', color, side, reason: 'T' };
    if (/^(?:F|Forfeit|反則)(?:\b|勝ち|勝|胜)?/i.test(body)) return { kind: 'reason', color, side, reason: 'F' };
    let score;
    const half = /^([+-]?\d+(?:\.\d+)?)\s*目半/.exec(body);
    if (half) score = Number(half[1]) + .5;
    else if (/^半目/.test(body)) score = .5;
    else {
      const childUnit = /子/.test(body), valueMatch = /([+-]?(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?))/.exec(body.replace(/^[+]/, ''));
      if (!valueMatch) return null;
      const value = fractionValue(valueMatch[1]);
      if (value == null) return null;
      score = childUnit ? value / 2 : value;
    }
    return { kind: 'score', color, side, score: Math.abs(score) };
  }
  function formattedResult(m, format) {
    const current = String(m.result || ''), raw = m.originalResult && K.parseResult(m.originalResult) === current ? m.originalResult : current;
    const result = resultDetails(raw);
    if (!result) return current || raw;
    if (result.kind === 'draw') return format === 'sgf' ? '0' : '持碁';
    if (result.kind === 'void') return format === 'sgf' ? 'Void' : '無勝負';
    if (result.kind === 'unknown') return format === 'sgf' ? '?' : '未終局';
    if (result.kind === 'reason') {
      if (format === 'sgf') return `${result.color}+${result.reason}`;
      return `${result.side}${result.reason === 'R' ? '中押し' : result.reason === 'T' ? '時間切れ' : '反則'}勝ち`;
    }
    if (format === 'sgf') return `${result.color}+${numberText(result.score)}`;
    return `${result.side}${formatPoints(result.score, format)}勝ち`;
  }
  function metadataFields(m, vertical = false, input = K.defaults()) {
    const fields = [], push = (key, label, value, group = 'record') => fields.push({ key, label, value: String(value), group });
    const s = K.normalizeSettings(input);
    if (m.include.event && m.event) push('event', '大会名', m.event);
    if (m.include.date && m.date) push('date', '対局日', dateText(m.date, s));
    if (m.include.place && m.place) push('place', '対局場所', m.place);
    push('black', '黒番', (m.black || '（名前未入力）') + (m.include.blackRank && m.blackRank ? '　' + m.blackRank : ''), 'players');
    push('white', '白番', (m.white || '（名前未入力）') + (m.include.whiteRank && m.whiteRank ? '　' + m.whiteRank : ''), 'players');
    for (const [key, rankKey] of [['black', 'blackRank'], ['white', 'whiteRank']]) {
      const field = fields.find(f => f.key === key);
      field.runs = [{ text: m[key] || '（名前未入力）', digits: 'none' }];
      if (m.include[rankKey] && m[rankKey]) field.runs.push({ text: '　' + m[rankKey], digits: 'rank' });
    }
    push('handicap', '手合い', m.handicap || '未入力', 'conditions');
    push('rule', 'ルール', m.rule === 'chinese' ? '中国ルール' : m.rule === 'japanese' ? '日本ルール' : '未選択', 'conditions');
    const komiFormat = s.sameScoreFormat ? s.scoreFormat : s.komiFormat;
    push('komi', 'コミ', m.komi === '' ? '未入力' : formatPoints(Number(m.komi), komiFormat), 'conditions');
    if (m.include.time) push('time', '持ち時間', timeLines(m).join('\n'), 'conditions');
    const resultFormat = s.sameScoreFormat ? s.scoreFormat : s.resultFormat;
    push('result', '勝敗', formattedResult(m, resultFormat) || '未入力', 'result');
    for (const field of fields) if (['komi', 'result'].includes(field.key)) field.digits = 'score';
    return fields;
  }
  // Upright Latin characters throughout. Digit grouping is explicitly field-aware:
  // names never use tate-chu-yoko; dates keep the four-digit year upright one by
  // one, and combine the (one/two digit) month and day. No sideways Latin runs.
  function verticalTokens(text, size = 3, weight = 400, options = {}) {
    if (options.runs) return options.runs.flatMap(run => verticalTokens(run.text, size, weight, { ...options, runs: null, digits: run.digits }).map(t => ({ ...t, digitPolicy: run.digits })));
    const requestedSpacing = Number(options.spacing);
    // Values below one em let ascenders/descenders from some Japanese fonts
    // collide. Keep the cell pitch compact, but never smaller than a safe em
    // box so every glyph has its own fixed vertical cell.
    const spacing = Number.isFinite(requestedSpacing) ? Math.max(1.12, requestedSpacing) : 1.18;
    const gs = chars(String(text)), out = [], digits = options.digits || 'none', advance = size * spacing;
    for (let i = 0; i < gs.length;) {
      const c = gs[i];
      if (c === '\n') { out.push({ raw: c, newline: true, advance: 0 }); i++; continue; }
      if (digits === 'score' && /^[+\-−]?\d/.test(gs.slice(i).join(''))) {
        const run = /^[+\-−]?(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)/.exec(gs.slice(i).join(''))[0];
        out.push({ text: run, raw: run, tcy: true, rotate: false, advance, size, weight }); i += Array.from(run).length; continue;
      }
      if (/^[0-9０-９]$/.test(c) && ['short', 'rank'].includes(digits)) {
        let run = c; i++; while (i < gs.length && /^[0-9０-９]$/.test(gs[i])) run += gs[i++];
        if (run.length <= 2 || digits === 'rank') out.push({ text: run, raw: run, tcy: true, rotate: false, advance, size, weight });
        else for (const ch of run) out.push({ text: ch, raw: ch, tcy: false, rotate: false, advance, size, weight });
      } else {
        const rotate = /^[ー－—―‐\-~〜～（）()［］\[\]｛｝{}「」『』〈〉《》]$/.test(c);
        // Keep semantic break information on the token.  A vertical line is
        // allowed to continue at a separator, but should not split a name or
        // a date merely because the height limit was reached.
        const breakAfter = /^[\s　・／/、。，．：:；;]$/.test(c) || /[）」』〉》]$/.test(c);
        out.push({ text: c, raw: c, rotate, tcy: false, punctuation: /^[、。，．]$/.test(c), breakAfter, advance, size, weight }); i++;
      }
    }
    return out;
  }
  function verticalColumns(text, height, size = 3, weight = 400, options = {}) {
    const tokens = verticalTokens(text, size, weight, options), columns = [];
    const indent = Math.max(0, Number(options.indent || 0));
    let col = [], used = 0, startOffset = 0;
    const trimLeading = list => { while (list.length && /^\s+$/.test(list[0].text || '')) list.shift(); return list; };
    const recalc = () => { let n = 0; for (const item of col) { item.offset = n; n += item.advance || 0; } used = startOffset + n; };
    const flush = () => { if (col.length) columns.push({ tokens: col, height: used, startOffset }); col = []; used = indent; startOffset = indent; };
    const carryAfterSemanticBreak = () => {
      for (let i = col.length - 1; i >= 0; i--) if (col[i].breakAfter) {
        const carry = trimLeading(col.splice(i + 1));
        if (carry.length) { recalc(); columns.push({ tokens: col, height: used, startOffset }); col = carry; startOffset = indent; recalc(); }
        else flush();
        return true;
      }
      return false;
    };
    for (const t of tokens) {
      if (t.newline) { col.push({ ...t, offset: Math.max(0, used - startOffset) }); flush(); continue; }
      if (col.length && used + t.advance > height + 1e-6) {
        if (!carryAfterSemanticBreak()) flush();
      }
      col.push({ ...t, offset: Math.max(0, used - startOffset) }); used += t.advance;
    }
    if (col.length) flush();
    return columns;
  }
  function verticalNaturalHeight(text, size = 3, weight = 400, options = {}) {
    let used = 0, max = 0;
    for (const t of verticalTokens(text, size, weight, options)) {
      if (t.newline) { max = Math.max(max, used); used = 0; }
      else used += t.advance;
    }
    return Math.max(max, used);
  }
  function verticalBlock(columns, x, y, w, h, size = 3, role = 'metadata', family = activeFontFamily) {
    return { kind: 'vertical', role, columns, x, y, w, h, size, pitch: size * 1.65, color: '#222222', family };
  }
  function textBlock(blocks, text, x, y, w, size = 3, weight = 400, align = 'left', role = 'metadata', color = '#222222', family = activeFontFamily) {
    const start = blocks.length, h = addText(blocks, text, x, y, w, size, weight, color, 1.48, family);
    blocks[start].align = align; blocks[start].role = role; return h;
  }
  function metadataTreatmentPadding(treatment) {
    return treatment === 'base' ? 0 : treatment === 'airy' ? 1.65 : treatment === 'framed' ? 1.15 : .8;
  }
  function applyMetadataTreatment(blocks, start, treatment, vertical, variant = '') {
    let content = blocks.slice(start).filter(b => b.kind === 'text' || b.kind === 'vertical' || b.kind === 'rect');
    if (!content.length) return null;
    const blockHeight = block => typeof block.h === 'number' ? block.h
      : block.kind === 'text' ? block.lines.length * block.lh : 0;
    let top = Math.min(...content.map(b => b.y));
    // Horizontal micro-adjustments change density as well as decoration. This
    // makes every option visible even on layouts that already contain cells.
    if (!vertical) {
      const stretch = treatment === 'classic' ? .9 : treatment === 'framed' ? 1.05 : treatment === 'airy' ? 1.22 : 1;
      if (stretch !== 1) for (const block of content) {
        block.y = top + (block.y - top) * stretch;
        if (typeof block.h === 'number') block.h *= stretch;
        if (block.kind === 'text' && typeof block.lh === 'number') block.lh *= stretch;
      }
      content = blocks.slice(start).filter(b => b.kind === 'text' || b.kind === 'vertical' || b.kind === 'rect');
      top = Math.min(...content.map(b => b.y));
    }
    const left = Math.min(...content.map(b => b.x));
    const right = Math.max(...content.map(b => b.x + b.w));
    const bottom = Math.max(...content.map(b => b.y + blockHeight(b)));
    if (treatment === 'base') return { top, bottom };
    const pad = metadataTreatmentPadding(treatment);
    const frame = { kind: 'rect', role: 'metadata', x: left - pad, y: top - pad, w: right - left + 2 * pad, h: bottom - top + 2 * pad,
      fill: treatment === 'accent' ? '#f2f7f2' : treatment === 'framed' ? '#f4f4f2' : '#ffffff',
      stroke: treatment === 'classic' ? '#4b4b47' : treatment === 'framed' ? '#686864' : null };
    if (treatment === 'airy') {
      blocks.splice(start, 0,
        { kind: 'rect', role: 'metadata', x: frame.x, y: frame.y, w: frame.w, h: .28, fill: '#767672' },
        { kind: 'rect', role: 'metadata', x: frame.x, y: frame.y + frame.h - .28, w: frame.w, h: .28, fill: '#767672' });
    } else if (treatment === 'accent') {
      blocks.splice(start, 0, frame,
        { kind: 'rect', role: 'metadata', x: frame.x, y: frame.y, w: 1.45, h: frame.h, fill: '#52785e' });
      if (!vertical) for (const block of content) if (block.role === 'metadata-label') block.color = '#365b45';
    } else if (treatment === 'classic') {
      blocks.splice(start, 0, frame,
        { kind: 'rect', role: 'metadata', x: frame.x + .45, y: frame.y + .5, w: Math.max(0, frame.w - .9), h: .16, fill: '#777772' },
        { kind: 'rect', role: 'metadata', x: frame.x + .45, y: frame.y + frame.h - .66, w: Math.max(0, frame.w - .9), h: .16, fill: '#777772' });
    } else {
      blocks.splice(start, 0, frame,
        { kind: 'rect', role: 'metadata', x: frame.x + .75, y: frame.y + .75, w: Math.max(0, frame.w - 1.5), h: Math.max(0, frame.h - 1.5), fill: '#ffffff', stroke: '#c7c7c2' });
    }
    return { top: frame.y, bottom: frame.y + frame.h };
  }
  function horizontalFlow(blocks, items, x, y, w, fs = 2.85, weight = 400) {
    const gap = fs * 1.9, rows = []; let row = [], used = 0;
    for (const item of items) {
      const width = Math.min(w, textWidth(item, fs, weight));
      if (row.length && used + gap + width > w) { rows.push(row); row = []; used = 0; }
      row.push({ text: item, w: width }); used += (row.length > 1 ? gap : 0) + width;
    }
    if (row.length) rows.push(row);
    for (const r of rows) {
      const total = r.reduce((a, v) => a + v.w, 0) + gap * (r.length - 1); let left = x + (w - total) / 2, h = 0;
      for (const v of r) { h = Math.max(h, textBlock(blocks, v.text, left, y, v.w + .05, fs, weight, 'center')); left += v.w + gap; }
      y += h + 1.1;
    }
    return y;
  }
  function horizontalFieldFlow(blocks, fields, x, y, w, fs = 2.85) {
    const gap = fs * 1.25, labelGap = fs * .45, lineH = fs * 1.48, rows = [];
    let row = [], used = 0;
    for (const field of fields) {
      const labelW = textWidth(field.label, fs, 600), value = field.value.replace(/\n/g, '　／　');
      const valueW = Math.min(Math.max(1, w - labelW - labelGap), textWidth(value, fs, 400));
      const itemW = Math.min(w, labelW + labelGap + valueW);
      if (row.length && used + gap + itemW > w) { rows.push(row); row = []; used = 0; }
      row.push({ field, labelW, valueW, itemW }); used += (row.length > 1 ? gap : 0) + itemW;
    }
    if (row.length) rows.push(row);
    for (const items of rows) {
      const total = items.reduce((n, item) => n + item.itemW, 0) + gap * (items.length - 1);
      let left = x + (w - total) / 2, height = lineH;
      for (const item of items) {
        const lines = wrap(item.field.value.replace(/\n/g, '　／　'), item.valueW, fs, 400);
        textBlock(blocks, item.field.label, left, y, item.labelW, fs, 600, 'left', 'metadata-label', '#555555');
        textBlock(blocks, lines, left + item.labelW + labelGap, y, item.valueW, fs, 400, 'left', 'metadata-value');
        height = Math.max(height, lines.length * lineH); left += item.itemW + gap;
      }
      y += height + .7;
    }
    return y;
  }
  function addHorizontalMetadata(blocks, m, x, y, w, variant = 'balanced', input = K.defaults(), tuning = 'base') {
    const family = selectedFontFamily(input, 'info');
    return withFontFamily(family, () => {
    // The decoration grows around the content. Reserve that space before
    // laying out the fields, so the complete band still fits the board width.
    // The extra tenth of a millimetre keeps stroked borders inside as well.
    const inset = tuning === 'base' ? 0 : metadataTreatmentPadding(tuning) + .1;
    x += inset; w -= inset * 2;
    const start = blocks.length, top = y, fields = metadataFields(m, false, input), get = k => fields.find(f => f.key === k);
    const txt = f => `${f.label}　${f.value.replace(/\n/g, '　／　')}`;
    const players = fields.filter(f => f.group === 'players'), conditions = fields.filter(f => f.group === 'conditions'), records = fields.filter(f => f.group === 'record');
    if (variant === 'table') {
      // Two-column table, with one shared label width in every cell.
      const gap = 3, cw = (w - gap) / 2, labelW = Math.min(17, cw * .28), fs = 2.8;
      const groups = [];
      const ordered = fields.filter(f => !['time', 'result'].includes(f.key));
      for (let i = 0; i < ordered.length; i += 2) groups.push(ordered.slice(i, i + 2));
      if (get('time')) groups.push([get('time')]); groups.push([get('result')]);
      for (const row of groups) {
        const cellW = row.length === 1 ? w : cw, h = Math.max(...row.map(f => wrap(f.value, cellW - labelW - 5, fs).length * fs * 1.48)) + 4;
        row.forEach((f, i) => {
          const bx = x + i * (cw + gap);
          blocks.push({ kind: 'rect', role: 'metadata', x: bx, y, w: cellW, h, fill: '#fafafa', stroke: '#cccccc' });
          textBlock(blocks, f.label, bx + 2, y + 2, labelW - 2, fs, 600);
          textBlock(blocks, f.value, bx + labelW, y + 2, cellW - labelW - 3, fs);
        }); y += h + .7;
      }
    } else if (variant === 'bands') {
      const groups = [['対局記録', records.map(txt)], ['対局者', players.map(txt)], ['対局条件', conditions.map(txt)], ['勝敗', [get('result').value]]];
      for (const [label, vals] of groups) {
        if (!vals.length) continue;
        const lw = 17, fs = 2.85, lines = wrap(vals.join('　／　'), w - lw - 5, fs), h = Math.max(lines.length * fs * 1.48 + 4, 9);
        blocks.push({ kind: 'rect', role: 'metadata', x, y, w: lw, h, fill: '#eceff0' });
        textBlock(blocks, label, x + 1, y + 2, lw - 2, 2.8, 600, 'center');
        textBlock(blocks, lines, x + lw + 3, y + 2, w - lw - 3, fs, label === '勝敗' ? 600 : 400);
        blocks.push({ kind: 'rect', role: 'metadata', x, y: y + h, w, h: .18, fill: '#cccccc' }); y += h + 1.5;
      }
    } else {
      if (get('event')) y += textBlock(blocks, get('event').value, x, y, w, 3.25, 500, 'center') + 1.2;
      y = horizontalFieldFlow(blocks, records.filter(f => f.key !== 'event'), x, y, w, 2.65);
      const cards = variant === 'cards' || variant === 'focus', gap = cards ? 5 : 6, cw = (w - gap) / 2;
      let ph = Math.max(...players.map(f => wrap(f.value, cw - (cards ? 6 : 0), cards ? 3.7 : 3.4, 600).length * (cards ? 3.7 : 3.4) * 1.48));
      players.forEach((f, i) => {
        const bx = x + i * (cw + gap);
        if (cards) {
          blocks.push({ kind: 'rect', role: 'metadata', x: bx, y, w: cw, h: ph + 10, fill: '#f8f8f8', stroke: '#cccccc' });
          textBlock(blocks, f.label, bx + 3, y + 1.7, cw - 6, 2.6, 500, 'center');
          textBlock(blocks, f.value, bx + 3, y + 6.5, cw - 6, 3.7, 600, 'center');
        } else {
          const labelW = textWidth(f.label, 2.8, 600), gapW = 1.2;
          const valueW = cw - labelW - gapW;
          const lines = wrap(f.value, valueW, 3.2, 600);
          const drawnW = Math.min(valueW, Math.max(...lines.map(line => textWidth(line, 3.2, 600))));
          const totalW = labelW + gapW + drawnW;
          const left = bx + (cw - totalW) / 2;
          textBlock(blocks, f.label, left, y, labelW, 2.8, 600, 'left', 'metadata-label', '#555555');
          textBlock(blocks, lines, left + labelW + gapW, y, drawnW, 3.2, 600, 'left', 'metadata-value');
        }
      });
      // Include the label in the natural row-height calculation when unframed.
      if (!cards) ph = Math.max(...players.map(f => wrap(txt(f), cw, 3.4, 600).length * 3.4 * 1.48));
      y += ph + (cards ? 12 : 2.4);
      if (variant === 'focus') {
        const cols = Math.min(3, conditions.length), gap2 = 2.5, tw = (w - gap2 * (cols - 1)) / cols;
        for (let offset = 0; offset < conditions.length; offset += cols) {
          const row = conditions.slice(offset, offset + cols), actualW = (w - gap2 * (row.length - 1)) / row.length;
          const rh = Math.max(...row.map(f => wrap(f.value, actualW - 4, 2.8).length * 4.15)) + 8;
          row.forEach((f, i) => {
            const bx = x + i * (actualW + gap2);
            textBlock(blocks, f.label, bx, y, actualW, 2.6, 600, 'center', 'metadata', '#666666');
            textBlock(blocks, f.value, bx + 2, y + 4.5, actualW - 4, 2.8, 400, 'center');
          }); y += rh;
        }
      } else {
        y = horizontalFieldFlow(blocks, conditions.filter(f => f.key !== 'time'), x, y, w, 2.75);
        if (get('time')) {
          const lines = timeLines(m);
          y += textBlock(blocks, '持ち時間　' + lines[0], x, y, w, 2.85, 400, 'center');
          if (lines.length > 1) y += textBlock(blocks, lines.slice(1).join('　／　'), x, y, w, 2.85, 400, 'center');
          y += 1;
        }
      }
      const rh = wrap('勝敗　' + get('result').value, w - 6, 3.1, 600).length * 4.59 + 3.8;
      blocks.push({ kind: 'rect', role: 'metadata', x, y, w, h: rh, fill: variant === 'focus' ? '#e9edef' : '#f3f3f3' });
      textBlock(blocks, '勝敗　' + get('result').value, x + 3, y + 1.5, w - 6, 3.1, 600, 'center'); y += rh + 1.5;
    }
    const treatmentBounds = applyMetadataTreatment(blocks, start, tuning, false);
    return Math.max(y, treatmentBounds ? treatmentBounds.bottom : y) - top + 2.5;
    });
  }
  function addVerticalMetadata(blocks, m, x, y, w, H, margin, variant = 'balanced', input = K.defaults(), tuning = 'base') {
    const family = selectedFontFamily(input, 'info');
    return withFontFamily(family, () => {
      const source = metadataFields(m, true, input), top = y;
      const record = source.filter(f => f.group === 'record');
      const players = source.filter(f => f.group === 'players');
      const conditions = source.filter(f => f.group === 'conditions');
      const result = source.filter(f => f.group === 'result');
      const pattern = Math.max(1, Math.min(5, Number(input.infoPatternVertical) || 1));
      const orders = {
        balanced: [...record, ...players, ...conditions, ...result],
        table: [...record, ...players, ...conditions, ...result],
        tiles: pattern === 3 ? [...record, players[0], ...result, players[1], ...conditions] : [...record, ...players, ...conditions, ...result],
        groups: [...record, ...players, ...conditions, ...result],
        focus: pattern === 3 ? [...record, players[0], ...result, players[1], ...conditions] : [...record, ...players, ...result, ...conditions]
      };
      if (variant === 'balanced' && pattern === 2) orders.balanced = [...record, players[0], ...result, players[1], ...conditions];
      const fields = orders[variant] || orders.balanced;
      const shortLabels = variant === 'table'
        ? { event: '大会', date: '日', place: '場所', black: '黒', white: '白', handicap: '手合', rule: 'ルール', komi: 'コミ', time: '時間', result: '勝敗' }
        : variant === 'tiles'
          ? { black: '黒番', white: '白番', result: '勝敗' }
          : variant === 'focus'
            ? { black: '黒番', white: '白番', result: '勝敗' }
            : {};
      const measured = fields.map(f => {
        const text = f.key === 'time' ? f.value.replace(/\n/g, '　／　') : f.value;
        const label = shortLabels[f.key] || f.label;
        const spacing = pattern === 5 ? 1.12 : pattern === 4 ? 1.18 : 1.15;
        const options = { digits: f.digits || (['black', 'white', 'event', 'place'].includes(f.key) ? 'none' : 'short'), runs: f.runs, spacing };
        return { f, label, text, options };
      });

      const gap = variant === 'balanced' && pattern === 4 ? 2.05 : pattern === 5 ? .55 : variant === 'focus' ? .8 : 1.05;
      const weightFor = g => {
        if (variant === 'tiles') return g.f.group === 'players' ? 1.55 : g.f.group === 'result' ? 1.25 : g.f.group === 'record' ? .9 : .82;
        if (variant === 'focus') return g.f.group === 'players' ? 1.9 : g.f.group === 'result' ? 1.55 : .66;
        if (variant === 'groups') return g.f.group === 'players' ? 1.18 : g.f.group === 'result' ? 1.12 : .9;
        if (variant === 'balanced') return ['black', 'white', 'result'].includes(g.f.key) ? 1.12 : .97;
        return 1;
      };
      const weights = measured.map(weightFor), totalWeight = weights.reduce((n, v) => n + v, 0);
      const unit = Math.max(.1, (w - gap * Math.max(0, measured.length - 1)) / Math.max(.1, totalWeight));
      const placements = []; let right = x + w;
      measured.forEach((g, i) => {
        const slotW = unit * weights[i], slotX = right - slotW;
        placements.push({ ...g, slotX, slotW }); right = slotX - gap;
      });

      let valueCap = Math.max(22, Math.min(32, H * .11));
      if (pattern === 5) valueCap -= .8;
      let size = variant === 'focus' ? 2.72 : 2.64;
      let pitch = size * 1.48;
      const fieldWeight = g => ['black', 'white', 'result'].includes(g.f.key) ? 600 : 400;
      // Prefer a readable semantic continuation column. Only shrink a field
      // when it has no useful break point and would otherwise be split in the
      // middle of a name, date, or other indivisible value.
      const compactSize = (g, fontSize) => {
        const natural = verticalNaturalHeight(g.text, fontSize, fieldWeight(g), g.options);
        if (natural <= valueCap + 1e-6) return fontSize;
        const tokens = verticalTokens(g.text, fontSize, fieldWeight(g), g.options);
        if (tokens.some(t => t.newline || t.breakAfter)) return fontSize;
        return Math.max(fontSize * .84, Math.min(fontSize, fontSize * valueCap / natural * .96));
      };
      const fieldSize = g => compactSize(g, size);
      const showsFieldLabel = g => !(variant === 'groups' && g.f.group === 'result');
      const makeColumns = (g, fontSize) => {
        const fs = compactSize(g, fontSize);
        return verticalColumns(g.text, valueCap, fs, fieldWeight(g), { ...g.options, indent: fs * .75 });
      };
      while (size > 1.82) {
        pitch = size * 1.48;
        const fits = placements.every((g, i) => {
          const fs = fieldSize(g), cols = makeColumns(g, size);
          const labelPitch = Math.max(1.8, size * .82) * 1.42, pairGap = size * .52;
          const firstInGroup = i === 0 || placements[i - 1].f.group !== g.f.group;
          const groupReserve = variant === 'groups' && firstInGroup ? 2.3 : 0;
          const labelReserve = showsFieldLabel(g) ? labelPitch + pairGap : 0;
          return groupReserve + labelReserve + cols.length * fs * 1.65 <= g.slotW - .65;
        });
        if (fits) break;
        size -= .08;
      }
      pitch = size * 1.48;
      const labelSize = Math.max(1.8, size * .82), labelPitch = labelSize * 1.42, pairGap = size * .52;
      const height = valueCap + 2.6;
      const fieldStyle = (f, index) => {
        const major = ['black', 'white', 'result'].includes(f.key);
        let style = { cell: '#ffffff', stroke: null, label: '#626262', value: '#222222', divider: true };
        if (variant === 'table') {
          if (pattern === 1) style = { ...style, cell: '#fbfbf8', stroke: '#c9cec9' };
          else if (pattern === 2) style = { ...style, cell: '#fbfbf8', stroke: '#d4d8d4', labelFill: '#e2e7e2' };
          else if (pattern === 3) style = { ...style, cell: index % 2 ? '#f7f8f4' : '#eaf0ea', divider: false };
          else if (pattern === 4) style = { ...style, cell: '#fffefa', stroke: '#aeb5af' };
          else style = { ...style, cell: '#ffffff', stroke: null, divider: false };
        } else if (variant === 'balanced') {
          style = { ...style, cell: '#ffffff', stroke: null, divider: false, value: major ? '#111111' : '#252525' };
          if (pattern === 2 && major) style.edge = f.key === 'result' ? '#8d493e' : '#aeb6af';
          if (pattern === 5) style.compact = true;
        } else if (variant === 'tiles') {
          style = { ...style, divider: !major };
          if (pattern === 1 && f.group === 'players') style = { ...style, cell: '#f2f4ef', stroke: f.key === 'black' ? '#363b37' : '#aeb5af', topBar: f.key === 'black' ? '#222724' : '#aab1ab' };
          else if (pattern === 2 && f.group === 'players') style = f.key === 'black'
            ? { ...style, cell: '#222724', stroke: '#222724', label: '#cbd1cc', value: '#ffffff', dividerColor: '#707873' }
            : { ...style, cell: '#ffffff', stroke: '#4e5650' };
          else if (pattern === 3 && major) style = f.group === 'result'
            ? { ...style, cell: '#8d493e', stroke: '#8d493e', label: '#ead6d1', value: '#ffffff', dividerColor: '#b97a70' }
            : { ...style, cell: '#f4f5f1', stroke: '#9ca49e' };
          else if (pattern === 4 && f.group === 'players') style = { ...style, cell: '#f0f3ef', labelFill: f.key === 'black' ? '#222724' : '#aab1ab', label: f.key === 'black' ? '#ffffff' : '#222222' };
          else if (pattern === 5 && f.group === 'players') style = { ...style, cell: '#ffffff', stroke: f.key === 'black' ? '#222724' : '#9ba39d', topBar: f.key === 'black' ? '#222724' : '#9ba39d' };
        } else if (variant === 'groups') {
          style = { ...style, cell: 'transparent', stroke: null, divider: false, value: major ? '#111111' : '#252525' };
        } else if (variant === 'focus') {
          style = { ...style, divider: !major };
          if (pattern === 1 && f.group === 'players') style = { ...style, cell: '#222724', stroke: '#222724', label: '#cbd1cc', value: '#ffffff', dividerColor: '#747b76' };
          else if (pattern === 1 && f.group === 'result') style = { ...style, cell: '#d7ddd8', stroke: '#aeb6af' };
          else if (pattern === 2 && f.group === 'players') style = f.key === 'black'
            ? { ...style, cell: '#222724', stroke: '#222724', label: '#d0d5d1', value: '#ffffff', dividerColor: '#737a75' }
            : { ...style, cell: '#ffffff', stroke: '#222724' };
          else if (pattern === 2 && f.group === 'result') style = { ...style, cell: '#e2e5e1', stroke: '#9da49e' };
          else if (pattern === 3 && f.group === 'result') style = { ...style, cell: '#8d493e', stroke: '#8d493e', label: '#efdcd7', value: '#ffffff', dividerColor: '#bd8379' };
          else if (pattern === 3 && f.group === 'players') style = { ...style, cell: '#f2f4ef', stroke: '#acb4ad' };
          else if (pattern === 4) style = { ...style, cell: '#ffffff', stroke: null, divider: false };
          else if (pattern === 5 && major) style = { ...style, cell: '#f7f8f4', edge: f.group === 'result' ? '#8d493e' : f.key === 'black' ? '#222724' : '#9ea6a0' };
        }
        return style;
      };

      if (variant === 'table' && pattern === 4) blocks.push(
        { kind: 'rect', role: 'metadata', x: x - .55, y: y - .55, w: w + 1.1, h: height + 1.1, fill: '#ffffff', stroke: '#3f4541' },
        { kind: 'rect', role: 'metadata', x: x + .15, y: y + .15, w: w - .3, h: height - .3, fill: '#ffffff', stroke: '#aeb5af' });
      if ((variant === 'table' && pattern === 5) || (variant === 'balanced' && pattern === 3)) blocks.push(
        { kind: 'rect', role: 'metadata', x, y, w, h: .18, fill: '#69736c' },
        { kind: 'rect', role: 'metadata', x, y: y + height - .18, w, h: .18, fill: '#69736c' });
      if (variant === 'balanced' && pattern === 2) blocks.push({ kind: 'rect', role: 'metadata', x: x + w / 2 - .09, y: y + 1.4, w: .18, h: height - 2.8, fill: '#a8b3aa' });
      if (variant === 'groups') {
        const names = { record: '対局記録', players: '対局者', conditions: '対局条件', result: '勝敗' };
        for (const group of ['record', 'players', 'conditions', 'result']) {
          const list = placements.filter(g => g.f.group === group); if (!list.length) continue;
          const gx = Math.min(...list.map(g => g.slotX)), gr = Math.max(...list.map(g => g.slotX + g.slotW)), gw = gr - gx;
          if (pattern === 1) blocks.push({ kind: 'rect', role: 'metadata', x: gx, y, w: gw, h: height, fill: group === 'players' ? '#e8ede8' : group === 'result' ? '#e1e6e1' : group === 'record' ? '#f4f6f2' : '#f2f3ef', stroke: '#c6cdc7' });
          else if (pattern === 2) blocks.push({ kind: 'rect', role: 'metadata', x: gr - 2.15, y, w: 2.15, h: height, fill: group === 'result' ? '#8d493e' : '#222724' });
          else if (pattern === 3) blocks.push({ kind: 'rect', role: 'metadata', x: gx, y, w: gw, h: height, fill: group === 'players' ? '#e4ebe5' : group === 'result' ? '#d7ded8' : group === 'record' ? '#f5f7f3' : '#edf1ed' });
          else if (pattern === 4) blocks.push(
            { kind: 'rect', role: 'metadata', x: gx, y, w: gw, h: .18, fill: '#69736c' },
            { kind: 'rect', role: 'metadata', x: gx, y: y + height - .18, w: gw, h: .18, fill: '#69736c' });
          else if (group !== 'record') blocks.push({ kind: 'rect', role: 'metadata', x: gr + gap * .45, y: y + 1.2, w: .18, h: height - 2.4, fill: '#69736c' });
          const headerColor = pattern === 2 ? '#ffffff' : group === 'result' ? '#8d493e' : '#626c65';
          const header = verticalBlock(verticalColumns(names[group], height - 2, 1.8, 600, { spacing: 1.14 }), gr - 2.15, y + 1, 2.15, height - 2, 1.8, 'metadata-group', family);
          header.pitch = 2.15; header.color = headerColor; blocks.push(header);
        }
      }

      placements.forEach((g, i) => {
        const style = fieldStyle(g.f, i), weight = ['black', 'white', 'result'].includes(g.f.key) ? 600 : 400;
        const fs = fieldSize(g), cols = makeColumns(g, size), valuePitch = fs * 1.65, colW = Math.max(valuePitch, cols.length * valuePitch);
        const cellX = g.slotX + .12, cellW = Math.max(.4, g.slotW - .24);
        blocks.push({ kind: 'rect', role: 'metadata', x: cellX, y, w: cellW, h: height, fill: style.cell, stroke: style.stroke });
        if (style.labelFill) blocks.push({ kind: 'rect', role: 'metadata', x: cellX + cellW - labelPitch - .8, y, w: labelPitch + .8, h: height, fill: style.labelFill });
        if (style.topBar) blocks.push({ kind: 'rect', role: 'metadata', x: cellX, y, w: cellW, h: .5, fill: style.topBar });
        if (style.edge) blocks.push({ kind: 'rect', role: 'metadata', x: cellX + cellW - .48, y, w: .48, h: height, fill: style.edge });
        const firstInGroup = i === 0 || placements[i - 1].f.group !== g.f.group;
        const groupReserve = variant === 'groups' && firstInGroup ? 2.3 : 0;
        const showFieldLabel = showsFieldLabel(g);
        const contentRight = cellX + cellW - .45 - groupReserve;
        const labelCenter = contentRight - labelPitch / 2;
        const valueRightCenter = showFieldLabel ? labelCenter - labelPitch / 2 - pairGap - valuePitch / 2 : contentRight - valuePitch / 2;
        const valueX = valueRightCenter - colW + valuePitch / 2;
        if (showFieldLabel && style.divider !== false) blocks.push({ kind: 'rect', role: 'metadata', x: labelCenter - labelPitch / 2 - pairGap / 2 - .06, y: y + 1, w: .12, h: height - 2, fill: style.dividerColor || '#cfd5cf' });
        if (showFieldLabel) {
          const label = verticalBlock(verticalColumns(g.label, height - 2, labelSize, 600, { spacing: 1.14 }), labelCenter - labelPitch / 2, y + 1, labelPitch, height - 2, labelSize, 'metadata-label', family);
          label.field = g.f.key; label.pitch = labelPitch; label.color = style.label; blocks.push(label);
        }
        const val = verticalBlock(cols, valueX, y + 1, colW, valueCap, fs, 'metadata-value', family);
        val.field = g.f.key; val.pitch = valuePitch; val.valueTop = y + 1; val.color = style.value; blocks.push(val);
        if (variant === 'table' && pattern === 5 && i) blocks.push({ kind: 'rect', role: 'metadata', x: g.slotX + g.slotW + gap / 2 - .06, y: y + 1.6, w: .12, h: height - 3.2, fill: '#cfd5cf' });
        if (variant === 'balanced' && pattern === 4 && i && placements[i - 1].f.group !== g.f.group)
          blocks.push({ kind: 'rect', role: 'metadata', x: g.slotX + g.slotW + gap / 2 - .06, y: y + 2, w: .12, h: height - 4, fill: '#cfd5cf' });
      });
      return height + 1.4;
    });
  }
  function header(m, W, H, subtitle = '', s = K.defaults()) {
    const b = [], margin = W < 160 ? 9 : W > 280 ? 13 : 11, w = W - margin * 2;
    let y = margin;
    if (s.showTitle) {
      const title = `${String(m.black || '（黒番未入力）').trim()} 対 ${String(m.white || '（白番未入力）').trim()}`;
      const family = selectedFontFamily(s, 'title');
      withFontFamily(family, () => {
        let fs = 6.4; while (fs > 4 && textWidth(title, fs, 600) > w) fs -= .2;
        const lines = wrap(title, w, fs, 600), lh = fs * 1.4;
        b.push({ kind: 'text', role: 'title', align: 'center', lines, x: margin, y, w, size: fs, weight: 600, color: '#171717', lh, family });
        y += lines.length * lh + 4;
      });
    }
    const info = s._infoBounds || { x: margin, w }, variant = s._layoutVariant || (s.infoDirection === 'vertical' ? s.infoLayoutVertical : s.infoLayoutHorizontal) || 'balanced';
    const tuning = s.infoVariant;
    const infoY = y;
    // Lay out small formats at a readable reference width, then shrink the
    // whole metadata band uniformly. Re-wrapping into a 50 mm board-width band
    // otherwise creates a runaway "taller header -> smaller board" loop.
    const referenceW = Math.max(info.w, s.infoDirection === 'vertical' ? 165 : 145);
    const metaBlocks = [];
    const naturalH = s.infoDirection === 'vertical'
      ? addVerticalMetadata(metaBlocks, m, 0, 0, referenceW, H, margin, variant, s, tuning)
      : addHorizontalMetadata(metaBlocks, m, 0, 0, referenceW, variant, s, tuning);
    const available = H - margin - 13 - y - (s._notesBudget || 0);
    const maxInfoH = Math.max(12, Math.min(H * .36, available - 44));
    const factor = Math.min(1, info.w / referenceW, maxInfoH / naturalH);
    const offsetX = info.x + (info.w - referenceW * factor) / 2;
    for (const original of metaBlocks) {
      const block = { ...original, x: offsetX + original.x * factor, y: y + original.y * factor };
      for (const key of ['w', 'h', 'size', 'lh', 'pitch']) if (typeof original[key] === 'number') block[key] = original[key] * factor;
      if (typeof original.valueTop === 'number') block.valueTop = y + original.valueTop * factor;
      if (original.columns) block.columns = original.columns.map(c => ({ ...c, height: c.height * factor,
        startOffset: typeof c.startOffset === 'number' ? c.startOffset * factor : 0,
        tokens: c.tokens.map(t => { const token = { ...t }; for (const k of ['size', 'advance', 'offset']) if (typeof t[k] === 'number') token[k] = t[k] * factor; return token; }) }));
      b.push(block);
    }
    y += naturalH * factor;
    const infoBottom = y;
    if (subtitle) y += withFontFamily(selectedFontFamily(s, 'title'), () => textBlock(b, subtitle, info.x, y, info.w, 3.15, 600, 'center', 'diagram-title')) + 1.8;
    if (y > H - margin - 38) throw new Error('対局情報が用紙に収まりません。長い項目を短くするか、用紙サイズ・向きを変更してください。');
    return { blocks: b, y, margin, w, infoBounds: { x: info.x, y: infoY, w: info.w, h: infoBottom - infoY } };
  }
  function repeatEntries(d, s) {
    return d.repeats.map(e => ({ text: K.repeatText(e, d, s), color: e.color, refColor: e.refColor || e.color,
      label: K.moveLabel(e.n, d.start, s.numbers ? s.numberStyle : 'arabic'),
      refLabel: e.setup ? '' : e.priorPage ? String(e.ref) : K.moveLabel(e.ref, d.start, s.numbers ? s.numberStyle : 'arabic'),
      refPrefix: e.setup ? '置石:' : e.priorPage ? '前譜' : '',
      refSuffix: e.setup || e.priorPage ? e.referenceCoord : '', refKanji: !e.setup && !e.priorPage && s.numbers && s.numberStyle === 'kanji' }));
  }
  function annotationParts(e, s, fs) {
    const family = selectedFontFamily(s, 'number', s.numbers && s.numberStyle === 'kanji');
    return withFontFamily(family, () => {
    if (!s.repeatStones || s.repeatStoneStyle !== 'onStone') return null;
    const [open, close] = s.repeatBracket === 'square' ? ['[', ']'] : ['(', ')'];
    const parts = [{ kind: 'stone', label: e.label, color: e.color, kanji: s.numbers && s.numberStyle === 'kanji' }, { kind: 'text', text: open }];
    if (e.refPrefix) parts.push({ kind: 'text', text: e.refPrefix });
    if (e.refLabel) parts.push({ kind: 'stone', label: e.refLabel, color: e.refColor, kanji: e.refKanji });
    if (e.refSuffix) parts.push({ kind: 'text', text: (e.refLabel ? ':' : '') + e.refSuffix });
    parts.push({ kind: 'text', text: close });
    let x = 0;
    for (const p of parts) { p.x = x; p.w = p.kind === 'stone' ? fs * 2.12 : textWidth(p.text, fs); x += p.w + fs * .08; }
    return { parts, w: x - fs * .08 };
    });
  }
  function tokensLayout(entries, width, fontSize, input, vertical = false) {
    const s = K.normalizeSettings(typeof input === 'object' ? input : { repeatStones: !!input });
    const family = selectedFontFamily(s, 'number', s.numbers && s.numberStyle === 'kanji');
    return withFontFamily(family, () => {
    const rows = []; let row = [], used = 0;
    entries.forEach((entry, index) => {
      const comma = !vertical && index + 1 < entries.length ? ',' : '', drawText = entry.text + comma;
      const graphical = annotationParts(entry, s, fontSize);
      const contentWidth = graphical ? graphical.w + textWidth(comma, fontSize) : textWidth(drawText, fontSize) + (s.repeatStones ? fontSize * 1.55 : 0);
      const gap = fontSize * .65;
      if (contentWidth > width + .15) throw new Error('着手注記が欄に収まりません。表示位置を上または下に変更してください。');
      if (row.length && (vertical || used + contentWidth > width)) { rows.push(row); row = []; used = 0; }
      row.push({ ...entry, drawText, comma, graphical, x: used, width: contentWidth + gap, contentWidth }); used += contentWidth + gap;
    });
    if (row.length) rows.push(row); return rows;
    });
  }
  function rowWidth(row) { const last = row[row.length - 1]; return last ? last.x + last.contentWidth : 0; }
  function layoutPages(model, input, m) {
    const s = K.normalizeSettings(input), [W, H] = paperSize(s), ds = K.diagrams(model, s), pages = [], spill = [];
    if (m.include.notes) K.notePages(s, ds.length); // validate before preparing pages
    const sharedNotes = s.notesPlacement.all && s.notesAllMode === 'same';
    let sharedNoteSpillAdded = false;
    for (const d of ds) {
      const noteText = K.notesForPage(m, s, d.page, ds.length);
      const title = s.mode === 'all' ? `総譜  ${d.total ? `1〜${d.end}手` : '初期配置'}` : `第${d.page}譜  ${d.start}〜${d.end}手`;
      const head = header(m, W, H, title, { ...s, _notesBudget: noteText.trim() ? 38 : 0, _infoBounds: s._infoBoundsBySource ? s._infoBoundsBySource[d.page] : s._infoBounds }); let y = head.y;
      if (s.numbers && s.numberStyle === 'kanji') y += textBlock(head.blocks, `本譜の番号 一〜${K.compactKanji(Math.max(1, d.end - d.start + 1))}  ／ 通算 ${d.start}〜${d.end}手`, head.margin, y, head.w, 2.4, 400, 'center', 'diagram-title', '#222222', selectedFontFamily(s, 'title')) + 1.2;
      const bottom = H - head.margin - 8, footerLines = [];
      if (s.numbers && d.stones.some(a => a.carried)) footerLines.push('無番号の石は、前譜から残った石または初期配置の石。');
      if (d.passes.length) footerLines.push('パス  ' + d.passes.map(e => `${K.moveLabel(e.n, d.start, s.numbers ? s.numberStyle : 'arabic')}${e.color === 1 ? '黒' : '白'}`).join(', '));
      let ft = footerLines.flatMap(t => wrap(t, head.w, 2.6));
      if (ft.length > 5) { spill.push({ title: `第${d.page}譜・パス／注記の続き`, lines: ft.slice(4), source: d.page }); ft = ft.slice(0, 4).concat('注記の続きは補記ページに掲載。'); }
      const footH = ft.length * 3.9 + (ft.length ? 4 : 0);
      let notesVisible = [], notesH = 0, verticalNotes = null;
      const noteTitle = sharedNotes ? '所感の続き（全棋譜図共通）' : `所感の続き（第${d.page}譜）`;
      const notesFamily = selectedFontFamily(s, 'info');
      function addNoteSpill(item) {
        if (sharedNotes && sharedNoteSpillAdded) return;
        spill.push({ ...item, title: noteTitle, source: d.page, notes: true });
        if (sharedNotes) sharedNoteSpillAdded = true;
      }
      if (noteText.trim() && s.infoDirection === 'vertical') {
        const fs = 3, maxH = s.orientation === 'landscape' ? 22 : 34, cols = withFontFamily(notesFamily, () => verticalColumns(noteText, maxH, fs));
        const capacity = Math.max(1, Math.floor((head.w - 8) / (fs * 1.65))), visible = cols.slice(0, capacity);
        const extra = cols.slice(capacity).flatMap(c => c.tokens.map(t => t.raw)).join('');
        verticalNotes = { columns: visible, height: Math.max(...visible.map(c => c.height)), fs, overflow: !!extra };
        notesH = verticalNotes.height + 5 + (extra ? 4 : 0);
        if (extra) addNoteSpill({ verticalText: extra });
      } else if (noteText.trim()) {
        const notesAll = withFontFamily(notesFamily, () => wrap(noteText, head.w, 3)), keep = Math.min(notesAll.length, s.orientation === 'landscape' ? 3 : 5);
        notesVisible = notesAll.slice(0, keep); notesH = keep * 4.5 + 8;
        if (notesAll.length > keep) { addNoteSpill({ lines: notesAll.slice(keep) }); notesH += 4.3; }
      }
      // Dedicated capture row immediately below the board/coordinate envelope.
      // It is separate from page-bottom notes and does not share their position.
      const captureH = s.captures === 'show' ? 6 : 0;
      let area = { x: head.margin, y, w: head.w, h: bottom - y - footH - notesH - captureH - 2 };
      if (area.h < 25) throw new Error('用紙の高さが不足しています。縦向きにするか、掲載する対局情報を減らしてください。');
      const entries = s.repeats ? repeatEntries(d, s) : [];
      let annotation = null;
      if (entries.length) {
        const side = ['left', 'right'].includes(s.repeatPosition), fs = W < 160 ? 2.35 : 2.65;
        const onStone = s.repeatStones && s.repeatStoneStyle === 'onStone', lh = fs * (onStone ? 2.48 : 1.65), pad = onStone ? 1.8 : 1.2, gap = 3;
        const annotationFamily = selectedFontFamily(s, 'number', s.numbers && s.numberStyle === 'kanji');
        const widths = withFontFamily(annotationFamily, () => entries.map(e => { const a = annotationParts(e, s, fs); return a ? a.w : textWidth(e.text, fs) + (s.repeatStones ? fs * 1.55 : 0); }));
        let nw = side ? Math.max(...widths) + 2 * pad : area.w;
        nw = Math.min(nw, area.w * (side ? .47 : 1));
        let maxH;
        if (side) {
          const testArea = { ...area, w: area.w - nw - gap }; maxH = Math.min(area.h, boardGeometry({ diagram: d, area: testArea }, s).box.h);
        } else {
          maxH = Math.max(12, Math.min(35, area.h * .24));
          const testArea = { ...area, h: area.h - maxH - gap }; nw = Math.min(area.w, Math.max(25, boardGeometry({ diagram: d, area: testArea }, s).box.w));
        }
        const rows = tokensLayout(entries, nw - 2 * pad, fs, s, side);
        let capacity = Math.max(1, Math.floor((maxH - 2 * pad) / lh));
        if (rows.length > capacity) capacity = Math.max(1, Math.floor((maxH - 2 * pad - 4) / lh));
        const visible = rows.slice(0, capacity), extra = rows.slice(capacity).flat().map(e => { const a = { ...e }; delete a.graphical; return a; });
        const nh = visible.length * lh + 2 * pad + (extra.length ? 4 : 0);
        const contentW = Math.max(...visible.map(rowWidth), extra.length ? withFontFamily(annotationFamily, () => textWidth('続きは補記ページ', 2)) : 0) + 2 * pad;
        if (extra.length) spill.push({ title: `第${d.page}譜・着手注記の続き`, entries: extra, source: d.page, vertical: side });
        if (side) { area.w -= nw + gap; if (s.repeatPosition === 'left') area.x += nw + gap; }
        else { area.h -= nh + gap; if (s.repeatPosition === 'top') area.y += nh + gap; }
        const geo = boardGeometry({ diagram: d, area }, s);
        const nx = side ? (s.repeatPosition === 'left' ? geo.extent.x - gap - contentW : geo.extent.x + geo.extent.w + gap) : geo.centerX - contentW / 2;
        const ny = side ? geo.centerY - nh / 2 : (s.repeatPosition === 'top' ? geo.extent.y - gap - nh : geo.extent.y + geo.extent.h + captureH + gap);
        annotation = { x: nx, y: ny, w: contentW, h: nh, rows: visible, fs, lh, pad, overflow: !!extra.length, centered: true, vertical: side,
          centerAxis: side ? 'y' : 'x', boardCenterX: geo.centerX, boardCenterY: geo.centerY };
      }
      const geo = boardGeometry({ diagram: d, area }, s);
      if (s.captures === 'show') {
        const cap = `アゲハマ   黒：${d.captures[1]}  白：${d.captures[2]}`;
        textBlock(head.blocks, cap, geo.box.x, geo.extent.y + geo.extent.h + 1.3, geo.box.w, 2.6, 400, 'right', 'captures');
      }
      const bottomTextY = bottom - footH - notesH;
      if (ft.length) textBlock(head.blocks, ft, head.margin, bottomTextY, head.w, 2.6, 400, 'left', 'footnotes');
      if (verticalNotes) {
        const ny = bottom - notesH;
        head.blocks.push(verticalBlock(verticalColumns('所感', Math.max(8, verticalNotes.height), 3, 600), head.margin + head.w - 6, ny, 6, Math.max(8, verticalNotes.height), 3, 'notes-label', notesFamily));
        head.blocks.push(verticalBlock(verticalNotes.columns, head.margin, ny, head.w - 8, verticalNotes.height, 3, 'notes', notesFamily));
        if (verticalNotes.overflow) textBlock(head.blocks, '所感の続きは補記ページに掲載。', head.margin, ny + verticalNotes.height + 1, head.w, 2.5, 400, 'left', 'notes-continuation', '#222222', notesFamily);
      }
      if (notesVisible.length) {
        let ny = bottom - notesH;
        ny += textBlock(head.blocks, '所感', head.margin, ny, head.w, 3, 600, 'left', 'notes-label', '#222222', notesFamily) + 1;
        ny += textBlock(head.blocks, notesVisible, head.margin, ny, head.w, 3, 400, 'left', 'notes', '#222222', notesFamily);
        if (notesH > notesVisible.length * 4.5 + 8.1) textBlock(head.blocks, '所感の続きは補記ページに掲載。', head.margin, ny, head.w, 2.5, 400, 'left', 'notes-continuation', '#222222', notesFamily);
      }
      pages.push({ type: 'board', W, H, margin: head.margin, blocks: head.blocks, diagram: d, area, annotation, infoBounds: head.infoBounds,
        title, source: d.page, boardCount: ds.length, notesText: noteText });
    }
    for (const item of spill) {
      let lines = item.lines ? wrap(item.lines.join('\n'), W - (W < 160 ? 18 : W > 280 ? 26 : 22), 3) : null;
      let entries = item.entries ? item.entries.slice() : null, part = 0, verticalText = item.verticalText || '';
      while ((lines && lines.length) || (entries && entries.length) || verticalText) {
        part++; const h = header(m, W, H, `補記  ${item.title}${part > 1 ? '（続）' : ''}`, s), maxH = H - h.margin - 10 - h.y;
        if (verticalText) {
          const fs = 3, cols = withFontFamily(notesFamily, () => verticalColumns(verticalText, maxH, fs)), capacity = Math.max(1, Math.floor(h.w / (fs * 1.65))), visible = cols.slice(0, capacity);
          h.blocks.push(verticalBlock(visible, h.margin, h.y, h.w, maxH, fs, 'notes', notesFamily));
          verticalText = cols.slice(capacity).flatMap(c => c.tokens.map(t => t.raw)).join('');
          pages.push({ type: 'notes', W, H, margin: h.margin, blocks: h.blocks, title: item.title, source: item.source });
        } else if (lines) {
          const capacity = Math.max(1, Math.floor(maxH / 4.5));
          const notes = item.title.startsWith('所感');
          textBlock(h.blocks, lines.splice(0, capacity), h.margin, h.y, h.w, 3, 400, 'left', notes ? 'notes' : 'footnotes', '#222222', notes ? selectedFontFamily(s, 'info') : SANS);
          pages.push({ type: 'notes', W, H, margin: h.margin, blocks: h.blocks, title: item.title, source: item.source });
        } else {
          const fs = 3, lh = fs * (s.repeatStones && s.repeatStoneStyle === 'onStone' ? 2.48 : 1.65), pad = 2;
          const rows = tokensLayout(entries, h.w - 4, fs, s, item.vertical), visible = rows.slice(0, Math.max(1, Math.floor((maxH - 4) / lh)));
          const taken = visible.reduce((a, r) => a + r.length, 0); entries.splice(0, taken);
          const aw = Math.max(...visible.map(rowWidth)) + 4, ah = visible.length * lh + 4;
          pages.push({ type: 'notes', W, H, margin: h.margin, blocks: h.blocks, title: item.title, source: item.source,
            annotation: { x: h.margin + (h.w - aw) / 2, y: h.y, w: aw, h: ah, rows: visible, fs, lh, pad, overflow: false, centered: true, vertical: item.vertical } });
        }
        if (pages.length > K.LIMITS.pages) throw new Error(`出力は補記を含めて${K.LIMITS.pages}ページまでです。`);
      }
    }
    pages.forEach((p, i) => { p.index = i + 1; p.totalPages = pages.length; }); return pages;
  }
  function getPlans(model, input, m) {
    const s = K.normalizeSettings(input);
    // All eight selected layouts now share board-width-constrained planning.
    if (s._infoBounds) return layoutPages(model, s, m);
    // Reflow metadata into the actual board width rather than the paper width.
    // Damped iteration avoids two-state width/height oscillations. Each
    // diagram has its own band, accounting for that page's comments.
    let bounds = null;
    for (let pass = 0; pass < 32; pass++) {
      const plans = layoutPages(model, { ...s, _infoBoundsBySource: bounds }, m), next = {}; let stable = !!bounds;
      for (const p of plans.filter(p => p.type === 'board')) {
        const g = boardGeometry(p, s), old = bounds && bounds[p.source];
        const w = old ? (old.w + g.box.w) / 2 : g.box.w, x = g.centerX - w / 2;
        next[p.source] = { x, w };
        if (!old || Math.abs(old.w - w) > .015 || Math.abs(old.x - x) > .015) stable = false;
      }
      if (stable) {
        // Final conservative reflow: band edges are inside the board even at
        // a floating-point/line-wrap boundary.
        const safe = {};
        for (const p of plans.filter(p => p.type === 'board')) {
          const g = boardGeometry(p, s), width = Math.min(bounds[p.source].w, g.box.w) - .025;
          safe[p.source] = { x: g.centerX - width / 2, w: width };
        }
        return layoutPages(model, { ...s, _infoBoundsBySource: safe }, m);
      }
      bounds = next;
    }
    throw new Error('対局情報と盤面の配置を確定できません。用紙を大きくするか、掲載項目を減らしてください。');
  }
  function colorRGB(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
  function rgba(hex, alpha) { const [r, g, b] = colorRGB(hex); return `rgba(${r},${g},${b},${alpha})`; }
  function mix(a, b, t) { const x = colorRGB(a), y = colorRGB(b); return '#' + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join(''); }
  function contrast(hex) {
    const v = colorRGB(hex).map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return v[0] * .2126 + v[1] * .7152 + v[2] * .0722 > .27 ? '#111111' : '#ffffff';
  }
  function rng(seed) { let x = seed >>> 0 || 12345; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }
  function boardTexture(ctx, box, s) {
    const palette = { bw: '#ffffff', 'kaya-new': '#e7c273', 'kaya-old': '#b57b43', hiba: '#eee0ae', katsura: '#cba08b', custom: s.customBoard };
    const base = palette[s.boardColor];
    ctx.fillStyle = base; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    if (s.grain === 'itame') {
      if (!itameImage.complete || !itameImage.naturalWidth) { ctx.restore(); throw new Error(textureError || '板目の画像素材を準備中です。'); }
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = s.boardColor === 'bw' ? .72 : 1;
      ctx.drawImage(itameImage, box.x, box.y, box.w, box.h); ctx.restore();
    }
    if (s.grain === 'masame') {
      const random = rng(814731), dark = s.boardColor === 'bw' ? '#404040' : '#72401d', light = s.boardColor === 'bw' ? '#aaaaaa' : '#fff0ca';
      // Normalized paths are deterministic across page sizes and DPI. Fine
      // fibres run with, not across, the cut grain. No tiled source photograph.
      const cx = v => .40 + .014 * Math.sin(v * 6.3) + .006 * Math.sin(v * 17.5);
      const potential = v => .0027 * (.76 + .63 * Math.sin(v * 17.7 + .45) + .14 * Math.sin(v * 42.5));
      const pathX = (u, v) => {
        if (s.grain === 'masame') return u + .0022 * Math.sin(v * 6 + u * 15) + .0011 * Math.sin(v * 19 + u * 25);
        const d = u - .40, bend = .013 * Math.sin(v * 7 + 1) + .007 * Math.sin(v * 19);
        return u + bend * Math.exp(-Math.abs(d) * 6) + .0025 * Math.sin(v * 15 + u * 20);
      };
      // Nearly parallel, high-contrast quarter-sawn latewood + light earlywood.
      if (s.grain === 'masame') {
        for (let i = 0; i < 132; i++) {
          const u = (i + random() * .65) / 131, width = (.00038 + random() * .0010) * box.w;
          ctx.beginPath();
          for (let j = 0; j <= 45; j++) { const v = j / 45, xx = box.x + pathX(u, v) * box.w, yy = box.y + v * box.h; if (!j) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
          ctx.strokeStyle = rgba(dark, .15 + random() * .24); ctx.lineWidth = width; ctx.stroke();
          ctx.strokeStyle = rgba(light, .15); ctx.lineWidth = width * .35; ctx.stroke();
        }
      } else {
        // Flat-sawn grain: narrow cathedral/spindle figures localized left of
        // centre, with long straight grain outside. Intersections of warped
        // growth-ring surfaces create the repeated pointed figures; the whole
        // board is not filled with identical nested U-shaped arches.
        for (let i = 0; i < 172; i++) {
          const half = .005 + (i + random() * .5) * .00375;
          const level = half * half, opacity = .13 + random() * .27;
          ctx.strokeStyle = rgba(dark, opacity); ctx.lineWidth = box.w * (.00042 + random() * .00075);
          for (const sign of [-1, 1]) {
            ctx.beginPath(); let active = false;
            for (let j = 0; j <= 350; j++) {
              const v = j / 350, f = level - potential(v);
              if (f < 0) { active = false; continue; }
              const offset = Math.sqrt(f) * (sign < 0 ? 1.20 : 1.03);
              const u = .40 + (cx(v) - .40) * Math.exp(-half * 12) + sign * offset + .0008 * Math.sin(v * 51 + half * 40);
              const xx = box.x + u * box.w, yy = box.y + v * box.h;
              if (!active) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); active = true;
            }
            ctx.stroke();
          }
        }
      }
      // Fine fibres and occasional soft bands, different for every strip but
      // stable for the same settings. Low amplitude leaves grid lines legible.
      for (let i = 0; i < 320; i++) {
        const u = random(), alpha = .04 + random() * .10;
        ctx.strokeStyle = rgba(random() < .35 ? light : dark, alpha); ctx.lineWidth = box.w * (.00010 + random() * .00023);
        ctx.beginPath();
        for (let j = 0; j <= 26; j++) { const v = j / 26, xx = box.x + pathX(u, v) * box.w, yy = box.y + v * box.h; if (!j) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
        ctx.stroke();
      }
    }
    if (s.boardColor === 'kaya-new' || s.boardColor === 'kaya-old') {
      const old = s.boardColor === 'kaya-old', grad = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      grad.addColorStop(0, `rgba(255,255,255,${old ? .22 : .10})`); grad.addColorStop(.36, 'rgba(255,255,255,0)');
      grad.addColorStop(.7, `rgba(40,20,0,${old ? .13 : .025})`); grad.addColorStop(1, 'rgba(255,255,255,.05)');
      ctx.fillStyle = grad; ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  }
  function stone(ctx, x, y, r, color, s, scale = 1, seed = 1, tiny = false) {
    const base = s.stoneColor === 'custom' ? (color === 1 ? s.blackColor : s.whiteColor) : color === 1 ? '#171717' : '#ffffff';
    const pattern = color === 1 ? s.blackPattern : s.whitePattern;
    ctx.save();
    if (s.shadow && !tiny) {
      ctx.shadowColor = 'rgba(0,0,0,.24)'; ctx.shadowBlur = r * .35 * scale;
      ctx.shadowOffsetX = r * .12 * scale; ctx.shadowOffsetY = r * .18 * scale;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (pattern === 'plain' || tiny) ctx.fillStyle = base;
    else {
      const g = ctx.createRadialGradient(x - r * .35, y - r * .42, r * .02, x + r * .16, y + r * .18, r * 1.32);
      if (pattern === 'nachi') {
        g.addColorStop(0, mix(base, '#ffffff', .27)); g.addColorStop(.28, mix(base, '#ffffff', .12));
        g.addColorStop(.68, base); g.addColorStop(1, mix(base, '#000000', .62));
      } else if (pattern === 'agate') {
        g.addColorStop(0, mix(base, '#ffffff', color === 1 ? .26 : .015));
        g.addColorStop(.38, mix(base, color === 1 ? '#858e92' : '#b6c9c8', color === 1 ? .21 : .48));
        g.addColorStop(.72, mix(base, '#000000', color === 1 ? .15 : .16));
        g.addColorStop(.9, mix(base, color === 1 ? '#b7c6c9' : '#dbe9e8', color === 1 ? .3 : .3));
        g.addColorStop(1, mix(base, '#000000', color === 1 ? .6 : .25));
      } else if (pattern === 'shell') {
        g.addColorStop(0, mix(base, '#fff8e7', .4)); g.addColorStop(.45, mix(base, '#e9dfce', .16));
        g.addColorStop(1, mix(base, '#a09483', .3));
      } else { // Glass: sharp surface reflection and an unclouded glossy body.
        g.addColorStop(0, mix(base, '#ffffff', .56)); g.addColorStop(.23, mix(base, '#ffffff', .12));
        g.addColorStop(.53, mix(base, '#000000', color === 1 ? .04 : .05));
        g.addColorStop(1, mix(base, '#000000', color === 1 ? .68 : .35));
      }
      ctx.fillStyle = g;
    }
    ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(.12, r * .035); ctx.strokeStyle = mix(base, '#000000', color === 2 ? .76 : .2); ctx.stroke();
    if (!tiny && pattern !== 'plain') {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * .976, 0, Math.PI * 2); ctx.clip();
      const random = rng(seed * 4177 + color * 1021);
      if (pattern === 'nachi') {
        // Diffuse lit dome with fine, paired micro-facets. No mirror-like blob.
        for (let i = 0; i < 620; i++) {
          const a = random() * Math.PI * 2, d = Math.sqrt(random()) * r, xx = x + Math.cos(a) * d, yy = y + Math.sin(a) * d;
          const rr = r * (.006 + random() * .014), lit = 1 - ((xx - x) + (yy - y)) / (r * 3.2);
          ctx.fillStyle = `rgba(0,0,0,${.18 + random() * .24})`; ctx.beginPath(); ctx.arc(xx, yy, rr, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${(.13 + random() * .19) * lit})`; ctx.beginPath(); ctx.arc(xx - rr * .3, yy - rr * .6, rr * .60, 0, Math.PI * 2); ctx.fill();
        }
      } else if (pattern === 'shell') {
        const angle = ((seed * .71) % 1.1) - .55; ctx.translate(x, y); ctx.rotate(angle);
        // Fine parallel shell growth striae, deliberately exclusive to shell.
        for (let i = -10; i <= 10; i++) {
          const a = i * r / 8.8 + (random() - .5) * r * .025;
          ctx.strokeStyle = rgba('#877969', .28 + random() * .18); ctx.lineWidth = r * (.011 + random() * .012);
          ctx.beginPath(); ctx.moveTo(-r * 1.2, a + r * .1); ctx.bezierCurveTo(-r * .42, a - r * .1, r * .38, a - r * .11, r * 1.2, a + r * .1); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = r * .009; ctx.stroke();
        }
      } else if (pattern === 'agate') {
        // Translucent depth is expressed by soft internal clouds and a bright
        // subsurface crescent. No concentric bands or shell-stripe paths.
        for (let i = 0; i < 5; i++) {
          const xx = x + (random() - .5) * r * 1.1, yy = y + (random() - .5) * r * 1.1, rr = r * (.35 + random() * .45);
          const g = ctx.createRadialGradient(xx, yy, 0, xx, yy, rr);
          g.addColorStop(0, color === 1 ? 'rgba(199,225,230,.16)' : 'rgba(255,255,255,.56)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.save(); ctx.lineCap = 'round';
        const glow = ctx.createLinearGradient(x + r * .9, y, x, y + r * .9);
        glow.addColorStop(0, 'rgba(226,244,245,0)'); glow.addColorStop(.48, color === 1 ? 'rgba(211,236,239,.35)' : 'rgba(255,255,255,.6)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
        for (let k = 0; k < 5; k++) { ctx.strokeStyle = glow; ctx.lineWidth = r * (.018 + k * .024); ctx.globalAlpha = .22; ctx.beginPath(); ctx.arc(x - r * .015, y - r * .03, r * .80, .08, 1.5); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.beginPath(); ctx.ellipse(x - r * .35, y - r * .42, r * .23, r * .10, -.55, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.32)'; ctx.beginPath(); ctx.ellipse(x - r * .35, y - r * .40, r * .32, r * .18, -.55, 0, Math.PI * 2); ctx.fill();
      } else if (pattern === 'glass') {
        if (color === 2) {
          // A thin reflected dark environment around the hard white highlight
          // keeps glass visibly glossy even when the base color is white.
          ctx.fillStyle = 'rgba(53,66,73,.16)'; ctx.beginPath(); ctx.ellipse(x - r * .34, y - r * .43, r * .34, r * .16, -.57, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.beginPath(); ctx.ellipse(x - r * .34, y - r * .43, r * .31, r * .135, -.57, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.36)'; ctx.beginPath(); ctx.ellipse(x - r * .31, y - r * .44, r * .37, r * .20, -.57, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.34)'; ctx.lineWidth = r * .035; ctx.beginPath(); ctx.arc(x, y, r * .90, .35, 1.15); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore(); return base;
  }
  function inkMetrics(ctx, text) {
    // Alignment/baseline MUST be set before measureText, not afterwards.
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'ltr';
    const m = ctx.measureText(text), finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
    const f = parseFloat(ctx.font.match(/([\d.]+)px/)[1]);
    const l = finite(m.actualBoundingBoxLeft, 0), r = finite(m.actualBoundingBoxRight, m.width);
    const a = finite(m.actualBoundingBoxAscent, f * .8), d = finite(m.actualBoundingBoxDescent, f * .2);
    return { l, r, a, d, w: l + r, h: a + d, advance: m.width };
  }
  function centeredGlyph(ctx, text, x, y) {
    const m = inkMetrics(ctx, text);
    ctx.fillText(text, x + (m.l - m.r) / 2, y + (m.a - m.d) / 2);
  }
  const NUMBER_REFERENCE = 1000;
  function numberMetrics(label, r, kanji = false, input = K.defaults()) {
    const s = K.normalizeSettings(input), family = selectedFontFamily(s, 'number', kanji);
    // Site and system fonts are registered at their regular face. Use that face
    // for Arabic move numbers as well; the built-in numeric fallback stays bold.
    const weight = kanji || s.fonts.number !== 'auto' ? 400 : 600;
    const text = String(label), key = `${family}:${kanji ? 'k:' : 'a:'}${text}`;
    let layout = glyphCache.get(key);
    if (!layout) {
      mc.save(); font(mc, NUMBER_REFERENCE, weight, family);
      if (!kanji) {
        const referenceKey = `arabic-reference-diagonal:${family}:${weight}`;
        let ref = glyphCache.get(referenceKey);
        if (!ref) {
          ref = 0;
          // Worst-case three-digit ink box: 1/2/3-digit labels all share ONE
          // type size, rather than stretching each label to fill the stone.
          for (let n = 100; n <= 999; n++) {
            const m = inkMetrics(mc, String(n)); ref = Math.max(ref, Math.hypot(m.w, m.h));
          }
          glyphCache.set(referenceKey, ref);
        }
        const m = inkMetrics(mc, text);
        layout = { glyphs: [{ text, x: (m.l - m.r) / 2, y: (m.a - m.d) / 2 }], width: m.w, height: m.h,
          referenceDiagonal: text.length <= 3 ? ref : Math.max(ref, Math.hypot(m.w, m.h)) };
      } else {
        const glyphs = [], ms = Array.from(text).map(ch => ({ text: ch, m: inkMetrics(mc, ch) }));
        const gap = NUMBER_REFERENCE * .07;
        const height = ms.reduce((sum, v) => sum + v.m.h, 0) + Math.max(0, ms.length - 1) * gap;
        const width = Math.max(...ms.map(v => v.m.w)); let top = -height / 2;
        for (const { text: ch, m } of ms) { glyphs.push({ text: ch, x: (m.l - m.r) / 2, y: top + m.a }); top += m.h + gap; }
        layout = { glyphs, width, height, referenceDiagonal: Math.hypot(width, height) };
      }
      mc.restore(); glyphCache.set(key, layout);
    }
    const ratio = kanji ? .95 : .85, k = (2 * r * ratio) / Math.max(1, layout.referenceDiagonal);
    return { ...layout, family, weight, scale: k, nominalFontSize: NUMBER_REFERENCE * k,
      inkWidth: layout.width * k, inkHeight: layout.height * k, targetRatio: ratio,
      actualRatio: Math.hypot(layout.width, layout.height) * k / (2 * r) };
  }
  function number(ctx, label, x, y, r, ink, kanji, input = K.defaults()) {
    const metrics = numberMetrics(label, r, kanji, input);
    ctx.save(); ctx.fillStyle = ink; ctx.translate(x, y); ctx.scale(metrics.scale, metrics.scale);
    // Measure and draw at the same reference size, avoiding rounding of ink
    // bearings at tiny millimetre-sized fonts in Canvas implementations.
    font(ctx, NUMBER_REFERENCE, metrics.weight, metrics.family);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'ltr';
    for (const g of metrics.glyphs) ctx.fillText(g.text, g.x, g.y);
    ctx.restore();
    return metrics;
  }
  function drawVertical(ctx, b) {
    ctx.save(); ctx.fillStyle = b.color;
    b.columns.forEach((col, ci) => {
      const x = b.x + b.w - b.pitch * (ci + .5);
      for (const t of col.tokens) {
        if (t.newline || /^\s+$/.test(t.text)) continue;
        ctx.save(); ctx.fillStyle = b.color;
        let y = b.y + (col.startOffset || 0) + t.offset + t.advance / 2;
        if (t.punctuation) { ctx.translate(x + t.size * .22, y - t.size * .22); }
        else ctx.translate(x, y);
        if (t.rotate) ctx.rotate(Math.PI / 2);
        // Measure at a large reference size. Measuring each glyph at its tiny
        // final size quantizes the ink bearings differently and makes a single
        // vertical line visibly wobble left/right. The fixed x=0 cell origin
        // below keeps every ordinary glyph on the same centre axis.
        font(ctx, NUMBER_REFERENCE, t.weight, b.family || SANS);
        const m = inkMetrics(ctx, t.text);
        const fit = t.tcy ? Math.min(1, NUMBER_REFERENCE * .96 / Math.max(.01, m.w)) : 1;
        const ratio = t.size / NUMBER_REFERENCE;
        ctx.scale(ratio * fit, ratio);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'ltr';
        ctx.fillText(t.text, 0, (m.a - m.d) / 2); ctx.restore();
      }
    });
    ctx.restore();
  }
  function coordLabel(n, axis, format) {
    if (format === 'num-kanji') return axis === 'v' ? String(n) : K.standardKanji(n);
    if (format === 'lower-lower') return String.fromCharCode(96 + n);
    if (format === 'upper-upper') return String.fromCharCode(64 + n);
    if (format === 'num-lower') return axis === 'v' ? String(n) : String.fromCharCode(96 + n);
    return axis === 'v' ? String(n) : String.fromCharCode(64 + n);
  }
  function boardGeometry(page, s) {
    const d = page.diagram, a = page.area, p = s.coordinates ? s.positions : { top: false, right: false, bottom: false, left: false };
    // An equal cell pitch in both axes, including rectangular SGF boards.
    const sides = { left: p.left ? 1.25 : .64, right: p.right ? 1.25 : .64, top: p.top ? 1.25 : .64, bottom: p.bottom ? 1.25 : .64 };
    const cell = Math.min(a.w / (d.size.w - 1 + sides.left + sides.right), a.h / (d.size.h - 1 + sides.top + sides.bottom));
    const totalW = (d.size.w - 1 + sides.left + sides.right) * cell, totalH = (d.size.h - 1 + sides.top + sides.bottom) * cell;
    const x0 = a.x + (a.w - totalW) / 2 + sides.left * cell, y0 = a.y + (a.h - totalH) / 2 + sides.top * cell;
    const bw = (d.size.w - 1) * cell, bh = (d.size.h - 1) * cell;
    const box = { x: x0 - cell * .56, y: y0 - cell * .56, w: bw + cell * 1.12, h: bh + cell * 1.12 };
    return { cell, x0, y0, bw, bh, r: cell * .47, box, p,
      centerX: x0 + bw / 2, centerY: y0 + bh / 2,
      extent: { x: x0 - sides.left * cell, y: y0 - sides.top * cell, w: totalW, h: totalH } };
  }
  function horizontalCoordinateLayout(labels, size, centerY) {
    mc.save(); font(mc, 1000); const m = inkMetrics(mc, '国Hg');
    const baseline = centerY + (m.a - m.d) / 2 * size / 1000;
    const result = labels.map(text => ({ text, baseline, size })); mc.restore(); return result;
  }
  function coordinateGlyph(ctx, text, x, baseline, size) {
    ctx.save(); ctx.translate(x, baseline); ctx.scale(size / 1000, size / 1000);
    font(ctx, 1000); const m = inkMetrics(ctx, text); ctx.fillText(text, (m.l - m.r) / 2, 0); ctx.restore();
  }
  function board(ctx, page, s, scale) {
    const d = page.diagram, geo = boardGeometry(page, s);
    const { cell, x0, y0, bw, bh, box, p } = geo;
    boardTexture(ctx, box, s);
    ctx.strokeStyle = s.boardColor === 'bw' ? '#252525' : '#26211c'; ctx.lineWidth = Math.max(.12, cell * .015);
    ctx.beginPath();
    for (let x = 0; x < d.size.w; x++) { ctx.moveTo(x0 + x * cell, y0); ctx.lineTo(x0 + x * cell, y0 + bh); }
    for (let y = 0; y < d.size.h; y++) { ctx.moveTo(x0, y0 + y * cell); ctx.lineTo(x0 + bw, y0 + y * cell); }
    ctx.stroke(); ctx.lineWidth = Math.max(.23, cell * .028); ctx.strokeRect(x0, y0, bw, bh);
    if (d.size.w === d.size.h && [9, 13, 19].includes(d.size.w)) {
      const n = d.size.w, edge = n === 9 ? 2 : 3, mid = (n - 1) / 2;
      const stars = n === 19 ? [edge, mid, n - 1 - edge].flatMap(x => [edge, mid, n - 1 - edge].map(y => [x, y])) : [[edge, edge], [edge, n - edge - 1], [n - edge - 1, edge], [n - edge - 1, n - edge - 1], [mid, mid]];
      ctx.fillStyle = s.boardColor === 'bw' ? '#202020' : '#201d18'; for (const [x, y] of stars) { ctx.beginPath(); ctx.arc(x0 + cell * x, y0 + cell * y, cell * .08, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#333333'; font(ctx, Math.min(3.5, cell * .31), 400);
    const coordSize = Math.min(3.5, cell * .31);
    const labels = Array.from({ length: d.size.w }, (_, i) => coordLabel(i + 1, 'h', s.coordFormat));
    for (const [enabled, yy] of [[p.top, y0 - cell * .91], [p.bottom, y0 + bh + cell * .91]]) {
      if (enabled) horizontalCoordinateLayout(labels, coordSize, yy).forEach((t, i) => coordinateGlyph(ctx, t.text, x0 + cell * i, t.baseline, coordSize));
    }
    for (let y = 0; y < d.size.h; y++) {
      const label = coordLabel(y + 1, 'v', s.coordFormat);
      if (p.left) centeredGlyph(ctx, label, x0 - cell * .91, y0 + cell * y);
      if (p.right) centeredGlyph(ctx, label, x0 + bw + cell * .91, y0 + cell * y);
    }
    const r = cell * .47;
    for (const st of d.stones) {
      const x = x0 + (st.p % d.size.w) * cell, y = y0 + Math.floor(st.p / d.size.w) * cell;
      const base = stone(ctx, x, y, r, st.color, s, scale, st.p + 1);
      if (s.numbers && st.n) number(ctx, K.moveLabel(st.n, d.start, s.numberStyle), x, y, r, contrast(base), s.numberStyle === 'kanji', s);
    }
    return geo;
  }
  function drawAnnotation(ctx, a, s, scale) {
    const family = selectedFontFamily(s, 'number', s.numbers && s.numberStyle === 'kanji');
    return withFontFamily(family, () => {
    ctx.save();
    // No caption and no opaque panel: the notation itself is the content.
    a.rows.forEach((row, index) => {
      const y = a.y + a.pad + (index + .5) * a.lh;
      const origin = a.centered ? a.x + (a.w - rowWidth(row)) / 2 : a.x + a.pad;
      row.forEach(e => {
        let x = origin + e.x;
        if (e.graphical && s.repeatStones && s.repeatStoneStyle === 'onStone') {
          for (const p of e.graphical.parts) {
            if (p.kind === 'stone') {
              const r = a.fs * .98, sx = x + p.x + p.w / 2;
              const base = stone(ctx, sx, y, r, p.color, s, scale, p.color * 31 + index, false);
              number(ctx, p.label, sx, y, r, contrast(base), p.kanji, s);
            } else {
              ctx.fillStyle = '#222222'; font(ctx, a.fs); centeredGlyph(ctx, p.text, x + p.x + p.w / 2, y);
            }
          }
          if (e.comma) { ctx.fillStyle = '#222222'; font(ctx, a.fs); centeredGlyph(ctx, e.comma, x + e.graphical.w + textWidth(e.comma, a.fs) / 2, y + a.fs * .23); }
        } else {
          if (s.repeatStones) { stone(ctx, x + a.fs * .55, y, a.fs * .48, e.color, s, scale, 1, true); x += a.fs * 1.55; }
          ctx.fillStyle = '#222222'; font(ctx, a.fs); const t = e.drawText === undefined ? e.text : e.drawText;
          const metrics = inkMetrics(ctx, '国Ag'); ctx.fillText(t, x, y + (metrics.a - metrics.d) / 2);
        }
      });
    });
    if (a.overflow) {
      ctx.fillStyle = '#666666'; font(ctx, 2); ctx.textAlign = a.centered ? 'center' : 'left'; ctx.textBaseline = 'top';
      ctx.fillText('続きは補記ページ', a.centered ? a.x + a.w / 2 : a.x + a.pad, a.y + a.h - 3);
    }
    ctx.restore();
    });
  }
  function draw(canvas, page, input, dpi = 110, options = {}) {
    const s = K.normalizeSettings(input), scale = dpi / 25.4;
    const cw = Math.round(page.W * scale), ch = Math.round(page.H * scale);
    if (cw * ch > 45000000) throw new Error('画像が大きすぎます。解像度を300 dpi以下にしてください。');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvasを作成できません。別のブラウザで開いてください。');
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.W, page.H);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (const b of page.blocks) {
      if (b.kind === 'rect') { ctx.fillStyle = b.fill; ctx.fillRect(b.x, b.y, b.w, b.h); if (b.stroke) { ctx.strokeStyle = b.stroke; ctx.lineWidth = .17; ctx.strokeRect(b.x, b.y, b.w, b.h); } }
      else if (b.kind === 'vertical') drawVertical(ctx, b);
      else {
        font(ctx, b.size, b.weight, b.family || SANS); ctx.fillStyle = b.color; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        if (b.align === 'center') {
          b.lines.forEach((line, i) => {
            const m = inkMetrics(ctx, line);
            ctx.fillText(line, b.x + b.w / 2 + (m.l - m.r) / 2, b.y + i * b.lh + m.a);
          });
        } else if (b.align === 'right') { ctx.textAlign = 'right'; b.lines.forEach((line, i) => ctx.fillText(line, b.x + b.w, b.y + i * b.lh)); } else b.lines.forEach((line, i) => ctx.fillText(line, b.x, b.y + i * b.lh));
      }
    }
    let geometry = null;
    if (page.type === 'board') geometry = board(ctx, page, s, scale);
    if (page.annotation) drawAnnotation(ctx, page.annotation, s, scale);
    ctx.strokeStyle = '#cccccc'; ctx.lineWidth = .15;
    ctx.beginPath(); ctx.moveTo(page.margin, page.H - page.margin - 5); ctx.lineTo(page.W - page.margin, page.H - page.margin - 5); ctx.stroke();
    font(ctx, 2.5); ctx.textBaseline = 'top'; ctx.fillStyle = '#666666'; ctx.textAlign = 'left';
    const footer = page.type === 'board'
      ? `全${page.diagram.total}手${page.boardCount > 1 ? `  ／  棋譜図 ${page.source} / ${page.boardCount}` : ''}`
      : `補記  ／  第${page.source}譜関連`;
    ctx.fillText(footer, page.margin, page.H - page.margin - 3.4);
    if (page.totalPages > 1) { ctx.textAlign = 'right'; ctx.fillText(`${page.index} / ${page.totalPages}`, page.W - page.margin, page.H - page.margin - 3.4); }
    if (options.draft) {
      ctx.save(); ctx.translate(page.W / 2, page.H / 2); ctx.rotate(-.4);
      ctx.fillStyle = 'rgba(170,55,35,.16)'; font(ctx, 10, 600); ctx.textAlign = 'center'; ctx.fillText(options.draft, 0, 0); ctx.restore();
    }
    return geometry;
  }
  function clearFontCache() { glyphCache.clear(); }
  root.KifuRender = { ready: () => assetsReady, PAPERS, SANS, paperSize, wrap, getPlans, draw, stone, number, numberMetrics, boardGeometry, verticalColumns, verticalTokens, metadataFields, dateText, timeLines, header, boardTexture, horizontalCoordinateLayout, repeatEntries, tokensLayout, contrast, coordLabel, clearFontCache };
})(globalThis);
