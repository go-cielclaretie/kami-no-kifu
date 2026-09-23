/** No dependencies / no bundler required for deployment.
 * dist/ is an allowlisted site-only copy; standalone/ is an optional offline
 * preview/regression fixture. Neither contains tests, SGFs, logs, or secrets.
 */
import { readFile, writeFile, mkdir, rm, cp, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, checkSite } from './check-site.mjs';
await checkSite();
async function rejectLinks(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not copied: ' + path);
  if (stat.isDirectory()) for (const f of await readdir(path)) await rejectLinks(join(path, f));
}
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
for (const name of ['index.html', '.nojekyll', 'js', 'css', 'assets', 'fonts', 'suggested_layout']) {
  await rejectLinks(resolve(root, name));
  await cp(resolve(root, name), resolve(dist, name), { recursive: true });
}
let html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'css/styles.css'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]+>/, () => '<style>' + css + '</style>');
html = html.replace(/<link rel="icon"[^>]+>/, '');
const texture = (await readFile(resolve(root, 'assets/itame-grain.png'))).toString('base64');
const configSource = await readFile(resolve(root, 'js/config.js'), 'utf8');
const defaultFontId = /defaultKanjiFontAsset:\s*'([^']+)'/.exec(configSource)?.[1];
const escapedFontId = defaultFontId && defaultFontId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const defaultFontPath = escapedFontId && new RegExp(`id:\\s*'${escapedFontId}'[^\\n]*path:\\s*'([^']+)'`).exec(configSource)?.[1];
if (!defaultFontId || !defaultFontPath) throw new Error('Default kanji font configuration is missing.');
const defaultFont = (await readFile(resolve(root, defaultFontPath))).toString('base64');
const embeddedFontSource = `globalThis.KifuEmbeddedFonts=Object.freeze({${JSON.stringify(defaultFontId)}:${JSON.stringify(`data:font/ttf;base64,${defaultFont}`)}});\n`;
const embeddedSuggestions = {};
for (const [key, filename] of Object.entries({
  simple: 'suggestion-simple.json', particular: 'suggestion-particular.json', japanese: 'suggestion-japanese.json'
})) embeddedSuggestions[key] = JSON.parse(await readFile(resolve(root, 'suggested_layout', filename), 'utf8'));
const scripts = [];
for (const match of [...html.matchAll(/<script src="\.\/js\/([^"?]+)\?v=[^"]+" defer><\/script>/g)]) {
  const name = match[1];
  let source = name === 'assets.js' ? `globalThis.KifuAssets = {itame: 'data:image/png;base64,${texture}'};globalThis.KifuSuggestedLayouts = ${JSON.stringify(embeddedSuggestions)};` : await readFile(resolve(root, 'js', name), 'utf8');
  if (name === 'font-loader.js') source = embeddedFontSource + source;
  // HTML parsing normalizes CRLF in inline scripts, so hash and embed the
  // normalized source that the browser will actually validate against CSP.
  source = source.replace(/\r\n?/g, '\n');
  if (/<\/script\s*>/i.test(source)) throw new Error('Unsafe script delimiter in ' + name);
  scripts.push(source);
  html = html.replace(match[0], () => '<script>' + source + '</script>');
}
// Hashes permit the embedded version without allowing arbitrary inline scripts.
const hashes = scripts.map(s => "'sha256-" + createHash('sha256').update(s).digest('base64') + "'").join(' ');
html = html.replace("script-src 'self'", 'script-src ' + hashes);
await mkdir(resolve(root, 'standalone'), { recursive: true });
await writeFile(resolve(root, 'standalone/index.html'), html);
console.log('Built dist/ (GitHub Pages) and standalone/index.html (optional local preview).');
