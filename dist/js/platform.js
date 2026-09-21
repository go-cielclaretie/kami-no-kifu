/** Paths work at /, /repository/, and /any/nested/path/, including index.html.
 * No username, repository name, domain, API token, or Google URL is hardcoded.
 */
(function (root) {
  'use strict';
  function siteBase(scriptURL, pageURL) {
    if (scriptURL) return new URL('../', scriptURL).href;
    try { return new URL('./', pageURL).href; }
    catch (_) { return 'https://standalone.invalid/'; } // about:blank test harness only
  }
  function storageKey(baseURL) {
    // localStorage already separates origins, but project Pages share an origin.
    // Keep the key stable across future app-version updates at this path.
    const path = new URL(baseURL).pathname;
    return 'KifuPrintWeb.display.v2:' + path;
  }
  function siteURL(path, baseURL) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('サイト内ファイルのパスが空です。');
    // Reject absolute/protocol-relative paths, traversal, encoded separators,
    // credentials and external URLs before assigning a resource URL.
    if (/^[a-z][a-z\d+.-]*:/i.test(path) || /^[\/\\]/.test(path) || /\\|%2f|%5c/i.test(path))
      throw new Error('ファイルはサイト内の相対パスで指定してください。');
    const base = new URL(baseURL), target = new URL(path, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.username || target.password)
      throw new Error('サイト外のファイルは読み込みません。');
    return target.href;
  }
  const script = root.document && root.document.currentScript;
  const baseURL = siteBase(script && script.src, root.document ? root.document.baseURI : 'https://standalone.invalid/');
  root.KifuPlatform = Object.freeze({
    baseURL,
    storageKey: storageKey(baseURL),
    assetURL: path => siteURL(path, baseURL),
    siteBase, siteURL, keyForBase: storageKey
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.KifuPlatform;
})(globalThis);
