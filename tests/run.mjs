// node tests/run.mjs   (Node 18+, no dependencies)
const files = [
  '../src/shared/ops.js',
  '../src/shared/diff.js',
  '../src/shared/reconcile.js',
  '../src/shared/timeline.js',
  '../src/shared/codec.js',
  '../src/shared/store.js',
  './harness.js',
  './ops.test.js',
  './timeline.test.js',
  './store.test.js',
  './diff.test.js',
];
for (const file of files) await import(file);

const results = await globalThis.runTests();
for (const r of results) console.log(`${r.ok ? '  ok  ' : 'FAIL  '}${r.name}${r.ok ? '' : `\n    ${r.error}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
