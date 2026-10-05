// Optional real-host contract probe. Use an explicitly disposable remote catalog.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicJson } from '../src/io.mjs';
import { PersonalCatalog } from '../src/sharing.mjs';
import { Workflow } from '../src/workflow.mjs';
import { candidate } from '../tests/helpers.mjs';

const [host, runtime, remoteHome, executable] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(),'scar-ssh-probe-'));
try {
  const home = path.join(root,'home');
  await atomicJson(path.join(home,'connection.json'),{type:'ssh',host,runtime,home:remoteHome,...(executable ? {executable} : {})});
  const catalog = new PersonalCatalog(home);
  const before = await catalog.read();
  assert.equal(before.records.length,0,'Use a disposable empty remote catalog, never real user data.');
  await catalog.learn(candidate,before.revision);
  assert.equal((await new PersonalCatalog(home).read()).records[0].id,candidate.id);
  await writeFile(path.join(root,'config.ts'),'export const settings={debug:true}');
  const flow = new Workflow(home);
  const prepared = await flow.prepare(root,{task:'Shared catalog proof',checks:[{id:'behavior',command:'$NODE',args:['-e','process.exit(0)']}]});
  assert.ok(prepared.classes.some(c=>c.id===candidate.id));
  assert.ok((await flow.verify(root)).findings.some(f=>f.id===candidate.id));
  console.log(JSON.stringify({status:'PASS',transport:'real SSH',proof:['publish','read-back','fresh client','project guard']}));
} finally { await rm(root,{recursive:true,force:true}); }
