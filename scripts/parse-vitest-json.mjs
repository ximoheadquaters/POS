import fs from 'node:fs';

const path = process.argv[2] ?? 'tmp-api-vitest.json';
const r = JSON.parse(fs.readFileSync(path, 'utf8'));
const list = (r.testResults || [])
  .map((t) => {
    const name = String(t.name).replace(/\\/g, '/');
    const idx = name.indexOf('/apps/api/');
    const file = idx >= 0 ? name.slice(idx + 10) : name;
    const ar = t.assertionResults || [];
    return {
      file,
      tests: ar.length,
      passed: ar.filter((a) => a.status === 'passed').length,
      failed: ar.filter((a) => a.status === 'failed').length,
      skipped: ar.filter((a) => a.status === 'skipped' || a.status === 'pending').length,
      todo: ar.filter((a) => a.status === 'todo').length,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

console.log(
  'TOTAL',
  JSON.stringify({
    files: list.length,
    tests: r.numTotalTests,
    passed: r.numPassedTests,
    failed: r.numFailedTests,
    skipped: r.numPendingTests,
    todo: r.numTodoTests,
  }),
);
for (const row of list) {
  console.log(
    `${String(row.tests).padStart(3)} tests | P${row.passed} F${row.failed} S${row.skipped} T${row.todo} | ${row.file}`,
  );
}
