import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './io.mjs';

export async function discoverChecks(project) {
  const root = path.resolve(project);
  async function exists(name) { try { await access(path.join(root, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  const checks = [];
  const pkg = await readJson(path.join(root, 'package.json'), null);
  for (const name of ['test', 'test:feature', 'typecheck', 'lint', 'build']) {
    const script = pkg?.scripts?.[name];
    if (typeof script !== 'string' || !script.trim() || /no test specified/.test(script)) continue;
    const args = ['run', name];
    if (/\bvitest\b/.test(script) && !/\b(run|watch|ui)\b|--watch|--ui/.test(script)) args.push('--', '--run');
    checks.push({ id: name.replaceAll(':', '_'), command: 'npm', args });
  }
  if (await exists('go.mod')) checks.push({ id: 'go_test', command: 'go', args: ['test', './...'] });
  if (await exists('Cargo.toml')) checks.push({ id: 'cargo_test', command: 'cargo', args: ['test'] });
  const pyproject = await exists('pyproject.toml') ? await readFile(path.join(root, 'pyproject.toml'), 'utf8') : '';
  if (await exists('pytest.ini') || /\[tool\.pytest\./.test(pyproject)) checks.push({ id: 'pytest', command: process.platform === 'win32' ? 'python' : 'python3', args: ['-m', 'pytest'] });
  return checks;
}
