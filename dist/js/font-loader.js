/** Browser-native font loading. There is no server-side proxy or GAS bridge.
 * Only installed fonts and configured same-site files are used.
 */
(function (root) {
  'use strict';
  const MAX_BYTES = 25 * 1024 * 1024;
  const EXTENSION = /\.(ttf|otf|woff2?)$/i;
  function aborted(signal) {
    if (signal && signal.aborted) throw new DOMException('フォントの読み込みを中止しました。', 'AbortError');
  }
  function checkBytes(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12 || buffer.byteLength > MAX_BYTES)
      throw new Error('フォントは25 MiB以下のTTF・OTF・WOFF・WOFF2を指定してください。');
    const b = new Uint8Array(buffer, 0, 4);
    const signature = String.fromCharCode(...b);
    if (!(b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) && !['OTTO', 'true', 'wOFF', 'wOF2'].includes(signature))
      throw new Error('ファイルの内容が対応するフォント形式ではありません。');
    return buffer;
  }
  async function createFace(source, name, family = 'KifuGyosho') {
    if (typeof root.FontFace !== 'function') throw new Error('このブラウザはフォント読み込みに対応していません。対応ブラウザか数字表記を使用してください。');
    const face = new root.FontFace(family, source, { style: 'normal', weight: '400' });
    await face.load();
    return { face, name, family };
  }
  function checkedPath(item) {
    if (!item || typeof item !== 'object') throw new Error('行書体のサイト設定が不正です。');
    const url = root.KifuPlatform.assetURL(item.path);
    if (!EXTENSION.test(new URL(url).pathname)) throw new Error('行書体のパスにはTTF・OTF・WOFF・WOFF2を指定してください。');
    return url;
  }
  function embeddedBytes(item) {
    const source = root.KifuEmbeddedFonts && root.KifuEmbeddedFonts[item.id];
    if (!source) return null;
    const match = /^data:font\/(?:ttf|otf|woff2?);base64,([A-Za-z0-9+/=]+)$/.exec(source);
    if (!match) throw new Error('埋め込みフォントの形式が不正です。');
    const binary = root.atob(match[1]);
    if (binary.length > MAX_BYTES) throw new Error('フォントが25 MiBの上限を超えています。');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return checkBytes(bytes.buffer);
  }
  async function fetchFont(item, outerSignal) {
    aborted(outerSignal);
    const embedded = embeddedBytes(item);
    if (embedded) return createFace(embedded, item.name || 'サイトの行書体', item.family || 'KifuGyosho');
    const url = checkedPath(item);
    if (!/^https?:/.test(url)) throw new Error('ローカル確認ではstandalone/index.htmlを開くか、ローカルHTTPサーバーを使用してください。');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    aborted(outerSignal);
    if (outerSignal) outerSignal.addEventListener('abort', onAbort, { once: true });
    const requested = Number(root.KifuConfig.fontTimeoutMs);
    const timeout = Number.isFinite(requested) ? Math.max(100, Math.min(60000, requested)) : 20000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await root.fetch(url, {
        method: 'GET', mode: 'same-origin', credentials: 'omit',
        referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal
      });
      if (!response.ok) throw new Error(`行書体を取得できません（HTTP ${response.status}）。サイト内のファイル配置を確認してください。`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('フォントが25 MiBの上限を超えています。');
      let buffer;
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) { await reader.cancel(); throw new Error('フォントが25 MiBの上限を超えています。'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        buffer = bytes.buffer;
      } else buffer = await response.arrayBuffer();
      aborted(outerSignal);
      const result = await createFace(checkBytes(buffer), item.name || 'サイトの行書体', item.family || 'KifuGyosho');
      aborted(outerSignal);
      return result;
    } catch (e) {
      if (outerSignal && outerSignal.aborted) aborted(outerSignal);
      if (e.name === 'AbortError') throw new Error('行書体の取得がタイムアウトしました。再読み込みするか、サイト内のフォントファイル配置を確認してください。');
      throw e;
    } finally {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    }
  }
  async function loadAutomatic(signal) {
    const config = root.KifuConfig;
    const defaultAsset = (config.fontAssets || []).find(item => item.id === config.defaultKanjiFontAsset);
    // The selected Yuji Syuku asset is the configured default; do not silently
    // replace it with another local font when its site file cannot be loaded.
    if (defaultAsset) return fetchFont(defaultAsset, signal);
    for (const name of config.localGyoshoNames || []) {
      aborted(signal);
      try {
        // Escape as a CSS string; config is operator-authored, never SGF input.
        const result = await createFace('local(' + JSON.stringify(String(name)) + ')', String(name));
        aborted(signal); return result;
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
    let lastError;
    for (const item of config.gyoshoFonts || []) {
      aborted(signal);
      try { return await fetchFont(item, signal); }
      catch (e) { if (e.name === 'AbortError') throw e; lastError = e; }
    }
    if (lastError) throw new Error(`${lastError.message} 端末にインストール済みのフォント名も指定できます。`);
    throw new Error('行書体を読み込めません。端末にインストール済みのフォント名を指定してください。');
  }
  async function loadAsset(id, signal) {
    const item = (root.KifuConfig.fontAssets || []).find(font => font.id === id);
    if (!item) throw new Error('フォント一覧にないファイルです。');
    return fetchFont(item, signal);
  }
  root.KifuFonts = Object.freeze({ MAX_BYTES, checkBytes, checkedPath, loadAutomatic, loadAsset });
})(globalThis);
