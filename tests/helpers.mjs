import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function fixture(t, files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'scar-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return root;
}

export const candidate = {
  id: 'PERSONAL-001', title: 'Debug mode leaks into production configuration',
  explanation: 'A deployable source must not enable debug mode unconditionally.',
  prevention: 'Bind debug behavior to an explicit environment check.',
  extensions: ['.js', '.ts'],
  detector: `export default ({files}) => files.filter(f => /debug\\s*:\\s*true/.test(f.text)).map(f => ({file:f.path,line:1,message:'Unconditional debug'}));`,
  fixtures: {
    bad: [{ path: 'config.js', text: 'export const settings = {debug: true};' }],
    alternate: [{ path: 'other.ts', text: 'const settings = { debug : true };' }],
    good: [{ path: 'config.js', text: 'export const settings = {debug: false};' }]
  },
  evidence: 'Synthetic regression demonstrating unconditional debug configuration.'
};
