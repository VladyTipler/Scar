import { readFile } from 'node:fs/promises';
import { Workflow } from './workflow.mjs';
import { catalogHome } from './io.mjs';
import { PersonalCatalog, catalogRpc } from './sharing.mjs';
import { publicCatalog, compactReport, publicationResult, reportDetails } from './presentation.mjs';

export async function cli(args) {
  const [operation, project, ...flags] = args;
  if (operation === 'catalog-rpc' && project) {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error('Catalog RPC input exceeds 2 MiB.'); }
    return await catalogRpc(project, JSON.parse(input));
  }
  const homeIndex = flags.indexOf('--home');
  const home = homeIndex < 0 ? catalogHome() : flags[homeIndex + 1];
  if (!project || !['prepare', 'verify', 'finish', 'status', 'review', 'learn', 'catalog', 'details'].includes(operation)) throw new Error('Usage: scar <prepare|verify|finish|status|review|learn|catalog|details> <absolute-project-or-record> [--home <catalog>] [--contract <json-file>] [--reason <text>]');
  const flow = new Workflow(home);
  const option = name => { const index = flags.indexOf(name); return index < 0 ? undefined : flags[index + 1]; };
  const pagination = { ...(option('--offset') === undefined ? {} : { offset: Number(option('--offset')) }), ...(option('--limit') === undefined ? {} : { limit: Number(option('--limit')) }) };
  if (operation === 'catalog') return await publicCatalog(flow.catalog, { ...pagination, id: option('--id'), query: option('--query') });
  if (operation === 'details') return await reportDetails(flow, project, { ...pagination, section: option('--section'), checkId: option('--check'), stream: option('--stream') });
  if (operation === 'learn') { const catalog = new PersonalCatalog(home); const record = JSON.parse(await readFile(project, 'utf8')); return publicationResult(await catalog.learn(record, (await catalog.read()).revision, { replace: flags.includes('--replace') }), record.id); }
  if (operation === 'review') return await flow.review(project, flags[flags.indexOf('--reason') + 1]);
  if (operation === 'prepare') {
    const index = flags.indexOf('--contract');
    return await flow.prepare(project, index < 0 ? undefined : JSON.parse(await readFile(flags[index + 1], 'utf8')));
  }
  return compactReport(await flow[operation](project));
}
cli(process.argv.slice(2)).then(result => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (['FAIL', 'STALE', 'INCOMPLETE'].includes(result.status)) process.exitCode = 1;
}).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
