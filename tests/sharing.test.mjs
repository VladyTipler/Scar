import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, candidate } from './helpers.mjs';
import { Catalog } from '../src/catalog.mjs';
import { RemoteCatalog, sshArguments } from '../src/sharing.mjs';
import { runCheck } from '../src/process.mjs';
import { atomicJson } from '../src/io.mjs';

test('remote catalog RPC crosses a real process boundary and keeps one revision source', async t => {
  const remoteHome = await fixture(t);
  const rpc = async payload => {
    const result = await runCheck({ id: 'rpc', command: '$NODE', args: [path.resolve('dist/cli.cjs'), 'catalog-rpc', remoteHome] }, remoteHome, JSON.stringify(payload));
    if (result.status !== 'PASS') throw new Error(result.stderr);
    return JSON.parse(result.stdout);
  };
  const remote = new RemoteCatalog({}, rpc);
  const first = await remote.read();
  await remote.learn(candidate, first.revision);
  assert.equal((await new Catalog(remoteHome).read()).records[0].id, candidate.id);
  await assert.rejects(() => remote.learn({ ...candidate, id: 'PERSONAL-002' }, first.revision), /revision/i);
  await assert.rejects(() => new RemoteCatalog({}, async () => { throw new Error('SSH unavailable'); }).read(), /unavailable/i);
});

test('SSH transport uses trusted argument arrays and rejects option injection', () => {
  assert.throws(() => sshArguments({ host: '-oProxyCommand=bad', runtime: '/opt/scar/dist/cli.cjs', home: '/data/scar' }));
  const args = sshArguments({ host: 'user@example.org', runtime: '/opt/Scar space/dist/cli.cjs', home: '/data/personal catalog' });
  assert.ok(args.includes('user@example.org'));
  assert.match(args.at(-1), /source ~\/\.profile/);
  assert.match(args.at(-1), /catalog-rpc/);
  assert.throws(()=>sshArguments({host:'example.org',runtime:'/scar/cli.cjs',home:'/data',executable:'ssh -o evil'}),/executable/i);
});

test('large catalog transport has a separate code-only budget from ordinary command evidence', async t => {
  const home = await fixture(t);
  await atomicJson(path.join(home,'catalog.json'),{schema:1,records:Array.from({length:100},(_,i)=>({...candidate,id:`PERSONAL-${i}`,explanation:'Large program-side evidence. '.repeat(700)}))});
  const result = await runCheck({id:'catalog_rpc',command:'$NODE',args:[path.resolve('dist/cli.cjs'),'catalog-rpc',home]},home,JSON.stringify({operation:'read'}),{},{maxOutputBytes:64*1024*1024});
  assert.equal(result.status,'PASS');
  assert.equal(JSON.parse(result.stdout).records.length,100);
});
