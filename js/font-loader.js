/** Browser-native font loading. There is no server-side proxy or GAS bridge.
 * Only installed fonts, an explicitly selected local file, or configured
 * same-site files are used. File bytes are never uploaded or stored by the app.
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
  async function createFace(source, name) {
    if (typeof root.FontFace !== 'function') throw new Error('このブラウザはフォント読み込みに対応していません。対応ブラウザか数字表記を使用してください。');
    const face = new root.FontFace('KifuGyosho', source, { style: 'normal', weight: '400' });
    await face.load();
    return { face, name };
  }
  function checkedPath(item) {
    if (!item || typeof item !== 'object') throw new Error('行書体のサイト設定が不正です。');
    const url = root.KifuPlatform.assetURL(item.path);
    if (!EXTENSION.test(new URL(url).pathname)) throw new Error('行書体のパスにはTTF・OTF・WOFF・WOFF2を指定してください。');
    return url;
  }
  async function fetchFont(item, outerSignal) {
    const url = checkedPath(item);
    if (!/^https?:/.test(url)) throw new Error('HTMLを直接開いた場合はサイト内フォントを取得できません。フォントファイルを選択するかHTTPサーバーで開いてください。');
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
      const result = await createFace(checkBytes(buffer), item.name || 'サイトの行書体');
      aborted(outerSignal);
      return result;
    } catch (e) {
      if (outerSignal && outerSignal.aborted) aborted(outerSignal);
      if (e.name === 'AbortError') throw new Error('行書体の取得がタイムアウトしました。再読み込みかフォントファイルの選択を試してください。');
      throw e;
    } finally {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    }
  }
  async function loadAutomatic(signal) {
    const config = root.KifuConfig;
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
    if (lastError) throw new Error(`${lastError.message} 手元の行書体フォントも選択できるよ。`);
    throw new Error('端末に行書体が見つからず、このサイトにも行書体が設定されていないよ。手元の行書体フォント（TTF・OTF・WOFF・WOFF2）を選択してね。');
  }
  async function loadFile(file) {
    if (!file || !EXTENSION.test(file.name || '') || !Number.isFinite(file.size) || file.size < 12 || file.size > MAX_BYTES)
      throw new Error('25 MiB以下のTTF・OTF・WOFF・WOFF2を選択してください。');
    return createFace(checkBytes(await file.arrayBuffer()), `選択したフォント：${file.name}`);
  }
  root.KifuFonts = Object.freeze({ MAX_BYTES, checkBytes, checkedPath, loadAutomatic, loadFile });
})(globalThis);
