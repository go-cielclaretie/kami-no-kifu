/* 匿名の利用統計を送信する。イベント本文には対局内容を含めない。 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KifuAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const core = root.KifuCore || (typeof require === 'function' ? require('./core.js') : null);
  const recommendationOrder = Object.freeze(['simple', 'particular', 'japanese']);
  const fontAssetIds = Object.freeze(['yuji-syuku', 'yuji-mai', 'kaisei-regular', 'kaisei-medium', 'kaisei-bold', 'hina-mincho', 'dot-gothic', 'potta-one', 'reggae-one']);
  const recommendationPaths = Object.freeze({
    simple: 'suggested_layout/suggestion-simple.json',
    particular: 'suggested_layout/suggestion-particular.json',
    japanese: 'suggested_layout/suggestion-japanese.json'
  });
  const includeKeys = Object.freeze(['event', 'place', 'date', 'blackRank', 'whiteRank', 'notes', 'time']);
  const fields = Object.freeze({
    showTitle: 'boolean', infoDirection: ['horizontal', 'vertical'],
    infoLayoutHorizontal: ['balanced', 'table', 'cards', 'bands', 'focus'],
    infoLayoutVertical: ['balanced', 'table', 'tiles', 'focus', 'groups'],
    infoVariant: ['base', 'classic', 'accent', 'framed', 'airy'],
    infoPatternVertical: ['1', '2', '3', '4', '5'],
    'fonts.title': ['default', 'system', 'asset'], 'fonts.info': ['default', 'system', 'asset'],
    'fonts.number': ['auto', 'system', 'asset'],
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
  });
  const paths = Object.freeze(Object.keys(fields));
  const rankKanji = Object.freeze({ '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 });
  let recommendationsPromise = null;

  function getPath(source, path) {
    return path.split('.').reduce((value, key) => value && value[key], source);
  }
  function japaneseNumber(text) {
    if (/^[〇零一二三四五六七八九]+$/.test(text)) return Array.from(text, c => rankKanji[c]).join('');
    if (!/^[〇零一二三四五六七八九十百]+$/.test(text)) return null;
    let total = 0, section = 0, digit = 0;
    for (const c of text) {
      if (Object.prototype.hasOwnProperty.call(rankKanji, c)) digit = rankKanji[c];
      else if (c === '十') { section += (digit || 1) * 10; digit = 0; }
      else if (c === '百') { section += (digit || 1) * 100; digit = 0; }
    }
    total += section + digit;
    return Number.isInteger(total) ? String(total) : null;
  }
  function normalizeRank(input) {
    if (typeof input !== 'string') return null;
    let value = input.normalize('NFKC').trim().toLowerCase().replace(/[\s　]/g, '');
    if (!value) return null;
    if (value === '初段') return '1段';
    let match = /^(\d{1,2})([dkp])$/.exec(value);
    if (match) return match[2] === 'p' ? `プロ${match[1]}段` : `${match[1]}${match[2] === 'd' ? '段' : '級'}`;
    match = /^(?:プロ)?([〇零一二三四五六七八九十百\d]{1,4})(段|級|級位)$/.exec(value);
    if (!match) return null;
    const number = /^\d+$/.test(match[1]) ? String(Number(match[1])) : japaneseNumber(match[1]);
    if (number == null || Number(number) < 1 || Number(number) > 99) return null;
    const rankType = match[2] === '級位' ? '級' : match[2];
    return value.startsWith('プロ') ? `プロ${number}段` : `${number}${rankType}`;
  }
  function safeFieldValue(path, value) {
    const rule = fields[path];
    if (rule === 'boolean') return typeof value === 'boolean' ? value : undefined;
    if (rule === 'integer') return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10000 ? Number(value) : undefined;
    if (rule === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    if (Array.isArray(rule)) {
      if (rule.includes(value)) return value;
      if (path.startsWith('fonts.') && typeof value === 'string' && value.startsWith('asset:') && fontAssetIds.includes(value.slice(6))) return value;
      return undefined;
    }
    if (path.startsWith('fontFamilies.')) return value === 'custom' || value === 'none' ? value : undefined;
    return undefined;
  }
  function flattenSettings(input) {
    const source = { ...(input || {}) };
    delete source.paginationBeforeKanji;
    delete source.infoVariantHorizontal;
    delete source.infoVariantVertical;
    const settings = core ? core.normalizeSettings(source) : source;
    const result = {};
    for (const path of paths) {
      let value = getPath(settings, path);
      if (path.startsWith('fontFamilies.')) {
        const role = path.slice('fontFamilies.'.length);
        value = settings.fonts && settings.fonts[role] === 'system' && typeof value === 'string' && value.trim() ? 'custom' : 'none';
      } else if (path === 'notesPageNumbers') value = typeof value === 'string' && value.trim() ? 'specified' : 'unset';
      else if (path.startsWith('fonts.') && typeof value === 'string' && value.startsWith('asset:')) value = value;
      const safe = safeFieldValue(path, value);
      if (safe !== undefined) result[path] = safe;
    }
    return result;
  }
  function parseRecommendation(value) {
    if (!value || typeof value !== 'object') return null;
    const settings = value.settings && typeof value.settings === 'object' ? value.settings : value;
    const flattened = flattenSettings(settings);
    return paths.every(path => Object.prototype.hasOwnProperty.call(flattened, path)) ? flattened : null;
  }
  async function loadRecommendations() {
    if (recommendationsPromise) return recommendationsPromise;
    recommendationsPromise = (async () => {
      const embedded = root.KifuSuggestedLayouts;
      if (embedded) {
        const found = {};
        for (const key of recommendationOrder) found[key] = parseRecommendation(embedded[key]);
        if (recommendationOrder.every(key => found[key])) return found;
      }
      if (!root.fetch || !root.KifuPlatform || !root.KifuPlatform.assetURL || root.location && root.location.protocol === 'file:') return null;
      try {
        const entries = await Promise.all(recommendationOrder.map(async key => {
          const response = await root.fetch(root.KifuPlatform.assetURL(recommendationPaths[key]), {
            method: 'GET', mode: 'same-origin', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
          });
          if (!response.ok) throw new Error('recommendation unavailable');
          return [key, parseRecommendation(JSON.parse(await response.text()))];
        }));
        const found = Object.fromEntries(entries);
        return recommendationOrder.every(key => found[key]) ? found : null;
      } catch (_) { return null; }
    })();
    return recommendationsPromise;
  }
  function classifySettings(input, recommendations) {
    const settings = flattenSettings(input);
    if (!recommendations || !paths.every(path => Object.prototype.hasOwnProperty.call(settings, path))) return null;
    let nearest = null;
    for (const preset of recommendationOrder) {
      const recommended = recommendations[preset];
      if (!recommended) return null;
      const changes = paths.filter(path => settings[path] !== recommended[path]).map(path => ({ path, value: settings[path] }));
      if (!nearest || changes.length < nearest.distance) nearest = { preset, distance: changes.length, changes };
    }
    const band = nearest.distance === 0 ? 'exact' : nearest.distance <= 2 ? 'close' : 'other';
    return { settings, recommendation: {
      preset: nearest.preset, distance: nearest.distance, band,
      changes: band === 'close' ? nearest.changes : []
    } };
  }
  function cleanInclude(input) {
    const source = input && typeof input === 'object' ? input : {};
    return Object.fromEntries(includeKeys.map(key => [key, source[key] === true]));
  }
  function createDownloadEvent(input, recommendations) {
    if (!input || !input.settings) return null;
    const classified = classifySettings(input.settings, recommendations);
    if (!classified) return null;
    const format = classified.settings.format;
    if (!['pdf', 'jpg', 'png'].includes(format)) return null;
    const packageType = input.packageType === 'zip' && format !== 'pdf' ? 'zip' : 'single';
    return {
      schema: 1, kind: 'download', format, package: packageType,
      settings: classified.settings, include: cleanInclude(input.include),
      ranks: {
        black: normalizeRank(input.ranks && input.ranks.black),
        white: normalizeRank(input.ranks && input.ranks.white)
      },
      recommendation: classified.recommendation
    };
  }
  function endpoint() {
    const value = root.KifuConfig && root.KifuConfig.analyticsEndpoint;
    if (typeof value !== 'string' || !value.trim() || !root.location || root.location.protocol === 'file:') return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function send(event) {
    const url = endpoint();
    if (!url || !root.navigator || root.navigator.onLine === false) return false;
    let body;
    try { body = JSON.stringify(event); } catch (_) { return false; }
    try {
      if (typeof root.fetch === 'function') {
        const request = root.fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', cache: 'no-store',
          redirect: 'follow', referrerPolicy: 'no-referrer', keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body });
        if (request && typeof request.catch === 'function') request.catch(() => {});
        return true;
      }
    } catch (_) { return false; }
    return false;
  }
  function recordVisit() {
    const key = 'KifuPrintWeb.analytics.lastVisit.v1', now = Date.now();
    if (!endpoint() || !root.navigator || root.navigator.onLine === false) return false;
    try {
      const storage = root.localStorage;
      if (!storage) return false;
      const last = Number(storage.getItem(key) || 0);
      if (!isVisitDue(last, now)) return false;
      storage.setItem(key, String(now));
    } catch (_) { return false; }
    return send({ schema: 1, kind: 'visit' });
  }
  function isVisitDue(last, now) {
    const previous = Number(last);
    return !(previous > 0) || Number(now) - previous >= 24 * 60 * 60 * 1000;
  }
  async function recordDownload(input) {
    try {
      const recommendations = await loadRecommendations();
      if (!recommendations) recommendationsPromise = null;
      const event = createDownloadEvent(input, recommendations);
      return event ? send(event) : false;
    } catch (_) { return false; }
  }
  function recordFailure(reason) {
    return send(createFailureEvent(reason));
  }
  function createFailureEvent(reason) {
    const allowed = ['cancelled', 'generate', 'save'];
    return { schema: 1, kind: 'failure', reason: allowed.includes(reason) ? reason : 'generate' };
  }
  const api = Object.freeze({ fields, paths, includeKeys, recommendationOrder, normalizeRank, flattenSettings,
    classifySettings, createDownloadEvent, createFailureEvent, loadRecommendations, isVisitDue, recordVisit, recordDownload, recordFailure, send });
  if (endpoint() && root.navigator && root.navigator.onLine !== false) loadRecommendations().catch(() => {});
  return api;
});
