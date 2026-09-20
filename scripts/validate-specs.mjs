import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../specs/openapi.json', import.meta.url), 'utf8'));
const failures = [];
const ids = new Set();
const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    let target = spec;
    for (const segment of value.$ref.slice(2).split('/'))
      target = target?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (!target) failures.push(`Missing reference ${value.$ref}`);
  }
  for (const child of Object.values(value)) walk(child);
}
walk(spec);
let count = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!verbs.has(method)) continue;
    count++;
    if (!operation.operationId || ids.has(operation.operationId))
      failures.push(`Duplicate or missing operation ID: ${method} ${path}`);
    ids.add(operation.operationId);
    const params = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map((p) =>
      p.$ref ? spec.components.parameters[p.$ref.split('/').at(-1)] : p,
    );
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g))
      if (!params.some((p) => p.in === 'path' && p.name === name && p.required))
        failures.push(`Missing required path parameter ${name}: ${path}`);
    if (typeof operation['x-implemented'] !== 'boolean')
      failures.push(`Route needs an explicit implementation status: ${path}`);
  }
}
const tables = JSON.parse(
  readFileSync(new URL('../specs/dynamodb-tables.json', import.meta.url), 'utf8'),
);
for (const table of tables) {
  if (!table.TableName.startsWith('campusfix-local-'))
    failures.push('Nonlocal table in local spec');
  const attrs = new Set(table.AttributeDefinitions.map((a) => a.AttributeName));
  for (const index of [{ KeySchema: table.KeySchema }, ...(table.GlobalSecondaryIndexes ?? [])])
    for (const key of index.KeySchema)
      if (!attrs.has(key.AttributeName)) failures.push(`Undefined key ${key.AttributeName}`);
}
const seed = JSON.parse(
  readFileSync(new URL('../specs/demo-seed.dynamodb.json', import.meta.url), 'utf8'),
);
if (seed.synthetic !== true) failures.push('Seed must be synthetic');
for (const batch of seed.batches)
  for (const [table, requests] of Object.entries(batch.RequestItems)) {
    if (!tables.some((t) => t.TableName === table) || requests.length > 25)
      failures.push('Invalid fixture batch');
    if (requests.some((r) => !r.PutRequest?.Item?.pk?.S || !r.PutRequest?.Item?.sk?.S))
      failures.push('Fixture key missing');
  }
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Contract structure passed: ${count} operations, ${Object.keys(spec.components.schemas).length} schemas, ${tables.length} tables, synthetic fixtures.`,
  );
