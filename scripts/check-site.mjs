import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function checkSite() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const privacy = await readFile(resolve(root, 'privacy.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\.[^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    if (!ref.startsWith('./') || ref.includes('..')) throw new Error(`Invalid relative resource: ${ref}`);
    await access(resolve(root, ref.split('?')[0]));
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id');
  if (!html.includes('v' + pkg.version)) throw new Error('HTML version does not match package.json');
  if (!html.includes('./js/analytics.js') || !html.includes('https://script.google.com') || !html.includes('./privacy.html'))
    throw new Error('Analytics entry point, CSP connection, or privacy link is missing');
  if (!privacy.includes('送る情報') || !privacy.includes('送らない情報')) throw new Error('Privacy disclosure is incomplete');
  for (const f of await readdir(resolve(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const source = await readFile(resolve(root, 'js', f), 'utf8');
    new vm.Script(source, { filename: f });
    const gasRuntime = /google\s*\.\s*script|\bHtmlService\b|\bUrlFetchApp\b|\bgetGyoshoFont\b/.test(source);
    const misplacedReceiver = !['analytics.js', 'config.js'].includes(f) && /script\.google\.com/.test(source);
    if (gasRuntime || misplacedReceiver)
      throw new Error('GAS dependency in ' + f);
  }
  const config = await readFile(resolve(root, 'js/config.js'), 'utf8');
  if (!config.includes(`version: '${pkg.version}'`)) throw new Error('Config version mismatch');
  const endpoint = config.match(/analyticsEndpoint: '([^']*)'/)?.[1];
  if (endpoint === undefined || endpoint && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))
    throw new Error('Invalid analytics endpoint');
  const fontPaths = [...config.matchAll(/path: '(fonts\/[^']+\.ttf)'/g)].map(m => m[1]);
  if (!fontPaths.length) throw new Error('No licensed TTF fonts are configured');
  for (const path of fontPaths) await access(resolve(root, path));
  const exp = await readFile(resolve(root, 'js/export.js'), 'utf8');
  if (!exp.includes(`Kifu Print Web ${pkg.version}`)) throw new Error('PDF producer version mismatch');
  await access(resolve(root, '.nojekyll'));
  await access(resolve(root, 'privacy.html'));
  await access(resolve(root, 'assets/itame-grain.png'));
  return { version: pkg.version, checkedResources: refs.length, scriptSyntax: true, gasRuntimeDependencies: false, optionalAnalyticsReceiver: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkSite(), null, 2));
}
