import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, 'dist'), { recursive: true });
const checksums = {};
const packages = new Set();
for (const name of ['cli', 'hook', 'mcp']) {
  const outfile = path.join(root, 'dist', `${name}.cjs`);
  const result = await build({ entryPoints: [path.join(root, 'src', `${name}.mjs`)], outfile, platform: 'node', target: 'node20', bundle: true, format: 'cjs', minify: true, legalComments: 'eof', metafile: true, alias: { '@vue/compiler-sfc': '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js' } });
  await writeFile(outfile, (await readFile(outfile, 'utf8')).replace(/[ \t]+$/gm, ''));
  for (const input of Object.keys(result.metafile.inputs)) {
    const matched = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (matched) packages.add(matched[1]);
  }
  checksums[`${name}.cjs`] = createHash('sha256').update(await readFile(outfile)).digest('hex');
}
await writeFile(path.join(root, 'dist', 'checksums.json'), `${JSON.stringify(checksums, null, 2)}\n`);
const notices = ['# Bundled third-party notices\n', 'Scar source licensing is not yet selected. Bundled components retain their original licenses.\n'];
const { readdir } = await import('node:fs/promises');
for (const name of [...packages].sort()) {
  const directory = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  notices.push(`## ${name} ${pkg.version}\n\nLicense: ${pkg.license || 'see upstream license'}\n`);
  const licenseFiles = (await readdir(directory)).filter(file => /^(license|licence|notice|copyright)/i.test(file));
  if (!licenseFiles.length) throw new Error(`Missing third-party license: ${name}`);
  for (const file of licenseFiles) notices.push(`### ${file}\n\n${await readFile(path.join(directory, file), 'utf8')}\n`);
}
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices.join('\n').replace(/[ \t]+$/gm, ''));
