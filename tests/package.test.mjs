import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';

test('installed bundles run outside source with no node_modules or dependency setup', async t => {
  // Close the child before deleting its cwd: Windows holds that directory open.
  const client=new Client({name:'isolated-package-test',version:'1'});
  t.after(()=>client.close());
  const install = await fixture(t);
  const home = await fixture(t);
  const project = await fixture(t, {'main.ts':'export const value=1;'});
  const checksums = JSON.parse(await readFile(path.resolve('dist/checksums.json'),'utf8'));
  await mkdir(path.join(install,'dist'));
  for(const name of ['cli','mcp','hook']) {
    const source=path.resolve(`dist/${name}.cjs`);
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),checksums[`${name}.cjs`]);
    await copyFile(source,path.join(install,'dist',`${name}.cjs`));
  }
  const declaration=JSON.parse(await readFile(path.resolve('.mcp.json'),'utf8')).mcpServers.scar;
  // Codex's legacy loader resolves cwd against the installed plugin root; args remain literal.
  await client.connect(new StdioClientTransport({command:declaration.command,args:declaration.args,cwd:path.resolve(install,declaration.cwd),env:{...process.env,SCAR_HOME:home}}));
  const result=await client.callTool({name:'scar_prepare',arguments:{project,task:'Isolated install',checks:[]}});
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.equal(result.structuredContent.applicableCount,3);
  assert.ok((await client.listTools()).tools.some(tool=>tool.name==='scar_context'));
});
