'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../js/core.js');
const Platform = require('../js/platform.js');
const root = path.resolve(__dirname, '..');
const base = 'https://example.github.io/KifuPrintWeb/';
for (const [script, page, expected] of [
  ['https://example.github.io/js/platform.js?v=2.0.0', '', 'https://example.github.io/'],
  [base + 'js/platform.js?v=2.0.0', '', base],
  ['https://example.github.io/other/nested/js/platform.js?v=2.0.0', '', 'https://example.github.io/other/nested/'],
  ['', base + 'index.html?q=1#x', base], ['', base, base],
  ['file:///tmp/KifuPrintWeb/js/platform.js?v=2.0.0', '', 'file:///tmp/KifuPrintWeb/'],
  ['', 'about:blank', 'https://standalone.invalid/']
]) test('v200 base URL: ' + (script || page), () => assert.equal(Platform.siteBase(script, page), expected));
for (const name of ['assets/itame-grain.png', './assets/fonts/a.woff2?v=2.0.0', 'js/../css/styles.css'])
  test('v200 relative asset: ' + name, () => assert.equal(Platform.siteURL(name, base), new URL(name, base).href));
for (const name of ['', ' ', '../other/asset.png', '../../asset', '%2e%2e/secret', '/outside.png', '//other.example/x', 'https://other.example/font.ttf', 'data:font/ttf,abc', 'blob:xx', 'javascript:alert(1)', 'assets\\x', 'assets%2fx', 'assets%5cx'])
  test('v200 rejects external/traversal path: ' + name, () => assert.throws(() => Platform.siteURL(name, base)));
test('v200 separate project settings keys', () => assert.notEqual(Platform.keyForBase(base), Platform.keyForBase('https://example.github.io/Other/')));
test('v200 keys not tied to changing app version', () => assert.equal(Platform.keyForBase(base), 'KifuPrintWeb.display.v2:/KifuPrintWeb/'));
function prefs(storage, site) {
  const ctx = vm.createContext({ KifuCore: K, TextEncoder, localStorage: storage, KifuPlatform: { storageKey: Platform.keyForBase(site) } });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/preferences.js'), 'utf8'), ctx);
  return ctx.KifuPreferences;
}
test('v200 settings isolated by project with same Storage backend', () => {
  const map = new Map(), storage = { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
  const a = prefs(storage, base), b = prefs(storage, 'https://example.github.io/Other/');
  a.save({ ...K.defaults(), grain: 'itame' }); assert.equal(b.load().settings, null);
  assert.equal(prefs(storage, base).load().settings.grain, 'itame');
});
test('v200 reads GAS v1.3 exported JSON, not its inaccessible localStorage', () => {
  const legacy = JSON.stringify({ schema: 1, app: 'KifuPrintWeb', settings: { ...K.defaults(), infoLayoutHorizontal: 'bands', infoLayoutVertical: 'tiles', notesPlacement: { all: true, first: false, last: false, custom: false }, notesAllMode: 'individual' } });
  const value = prefs({}, base).decode(legacy);
  assert.equal(value.infoLayoutHorizontal, 'bands'); assert.equal(value.infoLayoutVertical, 'tiles');
  assert.equal(value.notesAllMode, 'individual'); assert.equal(value.notesPlacement.all, true);
});
function fontContext({ config = {}, fetcher, localSuccess = false, faceFailure = false } = {}) {
  const calls = [], faces = [];
  class Face {
    constructor(name, source) { this.family = name; this.source = source; faces.push(source); }
    async load() { if ((typeof this.source === 'string' && !localSuccess) || faceFailure) throw new Error('Unavailable font'); return this; }
  }
  const ctx = vm.createContext({ FontFace: Face, ArrayBuffer, Uint8Array, URL, TextEncoder, AbortController, DOMException, setTimeout, clearTimeout,
    KifuConfig: { localGyoshoNames: ['not-installed'], gyoshoFonts: [], fontTimeoutMs: 100, ...config },
    KifuPlatform: { assetURL: p => Platform.siteURL(p, base) },
    fetch: (...args) => { calls.push(args); return fetcher(...args); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/font-loader.js'), 'utf8'), ctx);
  return { F: ctx.KifuFonts, calls, faces };
}
function fontBytes(signature = 'OTTO', size = 128) { const b = new Uint8Array(size); b.set(Buffer.from(signature)); return b.buffer; }
test('v200 default auto-font path makes no external requests', async () => {
  const { F, calls } = fontContext(); await assert.rejects(F.loadAutomatic(), /見つからず/); assert.equal(calls.length, 0);
});
test('v200 installed font used without HTTP', async () => {
  const { F, calls } = fontContext({ localSuccess: true }); const r = await F.loadAutomatic(); assert.equal(r.name, 'not-installed'); assert.equal(calls.length, 0);
});
for (const signature of ['OTTO', 'true', 'wOFF', 'wOF2', '\x00\x01\x00\x00']) test('v200 font signature ' + JSON.stringify(signature), () => {
  const { F } = fontContext(); assert.equal(F.checkBytes(fontBytes(signature)).byteLength, 128);
});
for (const signature of ['<htm', 'PK\x03\x04', 'ttcf']) test('v200 invalid font signature ' + signature, () => assert.throws(() => fontContext().F.checkBytes(fontBytes(signature))));
test('v200 font size guarded before file reads', async () => {
  let read = false;
  await assert.rejects(fontContext().F.loadFile({ name: 'font.ttf', size: 260000000, arrayBuffer: () => { read = true; } }), /25 MiB/);
  assert.equal(read, false);
});
test('v200 local selected font stays local', async () => {
  const { F, calls } = fontContext(); const r = await F.loadFile({ name: 'mine.otf', size: 128, arrayBuffer: async () => fontBytes() });
  assert.match(r.name, /mine.otf/); assert.equal(calls.length, 0);
});
test('v200 configured same-site font fetch uses no cookies/no referrer', async () => {
  const { F, calls } = fontContext({ config: { gyoshoFonts: [{ path: 'assets/fonts/gyosho.woff2', name: 'Configured' }] },
    fetcher: async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => fontBytes('wOF2') }) });
  const r = await F.loadAutomatic(); assert.equal(r.name, 'Configured'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], base + 'assets/fonts/gyosho.woff2'); assert.equal(calls[0][1].credentials, 'omit'); assert.equal(calls[0][1].mode, 'same-origin'); assert.equal(calls[0][1].redirect, 'error');
});
test('v200 disallows third-party font even when operator misconfigures it', async () => {
  const { F, calls } = fontContext({ config: { gyoshoFonts: [{ path: 'https://other.example/a.ttf' }] } });
  await assert.rejects(F.loadAutomatic(), /相対パス/); assert.equal(calls.length, 0);
});
test('v200 404 font error is visible, not a silent success', async () => {
  const { F } = fontContext({ config: { gyoshoFonts: [{ path: 'assets/fonts/a.ttf' }] }, fetcher: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(F.loadAutomatic(), /HTTP 404/);
});
test('v200 streamed same-site font enforces body and handles chunks', async () => {
  const bytes = new Uint8Array(fontBytes()); let n = 0, released = false;
  const { F } = fontContext({ config: { gyoshoFonts: [{ path: 'assets/fonts/a.otf' }] }, fetcher: async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => n++ ? { done: true } : { done: false, value: bytes }, releaseLock: () => { released = true; } }) } }) });
  const r = await F.loadAutomatic(); assert.ok(r.face); assert.equal(released, true);
});
test('v200 font Content-Length oversized rejection', async () => {
  const { F } = fontContext({ config: { gyoshoFonts: [{ path: 'assets/fonts/a.ttf' }] }, fetcher: async () => ({ ok: true, headers: new Headers({ 'content-length': '999999999' }) }) });
  await assert.rejects(F.loadAutomatic(), /25 MiB/);
});
test('v200 font fetch timeout exits loading', async () => {
  const { F } = fontContext({ config: { gyoshoFonts: [{ path: 'assets/fonts/a.ttf' }] }, fetcher: (_url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
  await assert.rejects(F.loadAutomatic(), /タイムアウト/);
});
test('v200 cancellation prevents font request', async () => {
  const { F, calls } = fontContext(), c = new AbortController(); c.abort();
  await assert.rejects(F.loadAutomatic(c.signal), { name: 'AbortError' }); assert.equal(calls.length, 0);
});
test('v200 root site has no inline scripts, GAS bootstrap, or templates', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(!/<base|google\.script|\/\*__\w+__\*\//.test(html));
  assert.equal((html.match(/<script src=/g) || []).length, 9);
  assert.ok(!/<script>/.test(html)); assert.ok(html.includes("object-src 'none'"));
});
test('v200 release uses new version throughout live code', () => {
  for (const file of ['js/config.js', 'js/export.js', 'js/ui.js', 'index.html']) {
    const t = fs.readFileSync(path.join(root, file), 'utf8'); assert.ok(t.includes('2.0.0')); assert.ok(!t.includes('1.3.0'));
  }
});
