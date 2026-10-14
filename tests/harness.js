// Tiny test harness that runs unchanged in Node (tests/run.mjs) and in a
// browser (tests/index.html).
(function () {
  const tests = [];
  globalThis.test = (name, fn) => tests.push({ name, fn });
  globalThis.assert = (cond, message) => {
    if (!cond) throw new Error(message || 'assertion failed');
  };
  globalThis.eq = (got, expected, message) => {
    const a = JSON.stringify(got);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message || 'values differ'}\n    got:      ${a}\n    expected: ${b}`);
  };
  globalThis.runTests = async () => {
    const results = [];
    for (const { name, fn } of tests) {
      try {
        await fn();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, error: String((err && err.message) || err) });
      }
    }
    return results;
  };
})();
