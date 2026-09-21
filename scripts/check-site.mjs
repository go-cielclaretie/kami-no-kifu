import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function checkSite() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\.[^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    if (!ref.startsWith('./') || ref.includes('..')) throw new Error(`Invalid relative resource: ${ref}`);
    await access(resolve(root, ref.split('?')[0]));
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id');
  if (!html.includes('v' + pkg.version)) throw new Error('HTML version does not match package.json');
  for (const f of await readdir(resolve(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const source = await readFile(resolve(root, 'js', f), 'utf8');
    new vm.Script(source, { filename: f });
    if (/google\s*\.\s*script|\bHtmlService\b|\bUrlFetchApp\b|\bgetGyoshoFont\b|script\.google\.com/.test(source))
      throw new Error('GAS dependency in ' + f);
  }
  const config = await readFile(resolve(root, 'js/config.js'), 'utf8');
  if (!config.includes(`version: '${pkg.version}'`)) throw new Error('Config version mismatch');
  const fontPaths = [...config.matchAll(/path: '(fonts\/[^']+\.ttf)'/g)].map(m => m[1]);
  if (!fontPaths.length) throw new Error('No licensed TTF fonts are configured');
  for (const path of fontPaths) await access(resolve(root, path));
  const exp = await readFile(resolve(root, 'js/export.js'), 'utf8');
  if (!exp.includes(`Kifu Print Web ${pkg.version}`)) throw new Error('PDF producer version mismatch');
  await access(resolve(root, '.nojekyll'));
  await access(resolve(root, 'assets/itame-grain.png'));
  return { version: pkg.version, checkedResources: refs.length, scriptSyntax: true, gasDependencies: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkSite(), null, 2));
}
