// Diffing and Google Docs drift correction.
(function () {
  const I = globalThis.Inkline;
  const check = (a, b) => eq(I.applyStrict(a, I.diffOps(a, b)), b, `diff ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);

  test('diff: ops always turn the old text into the new text', () => {
    check('', 'hello');
    check('hello', '');
    check('hello world', 'hello brave new world');
    check('aaa', 'aaaa');
    check('The quick brown fox jumps', 'A quick red fox leaps over');
    check('one\ntwo\nthree\n', 'zero\none\nthree\nfour\n');
    check('same', 'same');
  });

  test('diff: a single edit is a single op at the right place', () => {
    eq(I.diffOps('hello world', 'hello big world'), [{ op: 'insert', pos: 6, text: 'big ' }]);
    eq(I.diffOps('hello big world', 'hello world'), [{ op: 'delete', pos: 6, len: 4 }]);
  });

  test('diff: separate edits stay separate instead of replacing everything between', () => {
    const ops = I.diffOps('alpha beta gamma delta', 'alpha BETA gamma DELTA');
    eq(ops.length, 4);
    eq(I.applyStrict('alpha beta gamma delta', ops), 'alpha BETA gamma DELTA');
  });

  test('reconcile: a correct guess is kept as it is', () => {
    const ops = [{ t: 100, op: 'insert', pos: 5, text: ' there', d: 500 }];
    const r = I.reconcile({ base: 'hello', ops, snapshot: 'hello there' });
    eq(r.method, 'match');
    eq(r.ops, ops);
  });

  test('reconcile: right keystrokes at the wrong position are shifted, timing intact', () => {
    const base = 'First paragraph.\nSecond paragraph.\n';
    // We guessed the cursor was at the end; it was really after "First".
    const ops = [
      { t: 100, op: 'insert', pos: base.length, text: ' big', d: 300 },
      { t: 900, op: 'delete', pos: base.length + 3, len: 1 },
      { t: 1100, op: 'insert', pos: base.length + 3, text: 't' },
    ];
    const snapshot = 'First bit paragraph.\nSecond paragraph.\n';
    const r = I.reconcile({ base, ops, snapshot });
    eq(r.method, 'shift');
    eq(I.applyStrict(base, r.ops), snapshot);
    eq(r.ops.map((o) => [o.t, o.pos]), [[100, 5], [900, 8], [1100, 8]]);
    eq(r.cursor, 9);
  });

  test('reconcile: shifting copes with repeated characters around the edit', () => {
    const base = 'aaaa bbbb';
    const ops = [{ t: 0, op: 'insert', pos: 9, text: 'aa', d: 100 }];
    const r = I.reconcile({ base, ops, snapshot: 'aaaaaa bbbb' });
    eq(r.method, 'shift');
    eq(I.applyStrict(base, r.ops), 'aaaaaa bbbb');
  });

  test('reconcile: anything else falls back to a diff over the same time span', () => {
    const base = 'Shopping:\n';
    // Typed "milk", Enter, "eggs" in a bulleted list; the export adds bullets.
    const ops = [{ t: 1000, op: 'insert', pos: 10, text: 'milk\neggs', d: 2000 }];
    const snapshot = 'Shopping:\n* milk\n* eggs\n';
    const r = I.reconcile({ base, ops, snapshot });
    eq(r.method, 'diff');
    eq(I.applyStrict(base, r.ops), snapshot);
    assert(r.ops.every((o) => o.t >= 1000 && I.opEnd(o) <= 3000), 'ops stay inside the original time span');
    assert(r.ops.every((o) => !o.sync), 'still attributed to the writer');
  });

  test('reconcile: a paste keeps its paste flag through a diff', () => {
    const pasted = 'lorem ipsum dolor sit amet '.repeat(3);
    const ops = [{ t: 0, op: 'paste', pos: 0, text: pasted }];
    const r = I.reconcile({ base: 'Intro. ', ops, snapshot: `Intro. ${pasted.trim()}\n` });
    eq(r.method, 'diff');
    eq(r.ops.map((o) => o.op), ['paste']);
  });

  test('reconcile: changes nobody typed here are marked as synced', () => {
    const r = I.reconcile({ base: 'abc', ops: [], snapshot: 'abc def', now: 777, external: true });
    eq(r.ops, [{ op: 'insert', pos: 3, text: ' def', t: 777, sync: true }]);
  });
})();
