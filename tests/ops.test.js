// Delta merging and the stored op encoding.
(function () {
  const I = globalThis.Inkline;

  const type = (text, { t = 0, pos = 0, gap = 100 } = {}) =>
    [...text].map((ch, i) => ({ t: t + i * gap, op: 'insert', pos: pos + i, text: ch }));

  test('merge: adjacent single characters within 1.5s become one op', () => {
    const ops = I.mergeOps(type('hello'));
    eq(ops, [{ t: 0, op: 'insert', pos: 0, text: 'hello', d: 400 }]);
  });

  test('merge: a pause longer than 1.5s starts a new op', () => {
    const ops = I.mergeOps([...type('ab'), ...type('cd', { t: 100 + 1501, pos: 2 })]);
    eq(ops.map((o) => [o.t, o.text]), [[0, 'ab'], [1601, 'cd']]);
  });

  test('merge: a pause of exactly 1.5s still merges', () => {
    const ops = I.mergeOps([...type('ab'), ...type('c', { t: 100 + 1500, pos: 2 })]);
    eq(ops.map((o) => o.text), ['abc']);
    eq(ops[0].d, 1600);
  });

  test('merge: typing somewhere else does not merge', () => {
    const ops = I.mergeOps([...type('ab'), { t: 300, op: 'insert', pos: 0, text: 'x' }]);
    eq(ops.map((o) => [o.pos, o.text]), [[0, 'ab'], [0, 'x']]);
  });

  test('merge: multi-character inserts and pastes stay separate', () => {
    const paste = 'x'.repeat(41);
    const ops = I.mergeOps([
      { t: 0, op: 'insert', pos: 0, text: 'a' },
      { t: 100, op: 'insert', pos: 1, text: 'word' },
      { t: 200, op: 'insert', pos: 5, text: 'b' },
      { t: 300, op: 'paste', pos: 6, text: paste },
      { t: 400, op: 'insert', pos: 47, text: 'c' },
    ]);
    eq(ops.map((o) => o.text), ['a', 'word', 'b', paste, 'c']);
  });

  test('merge: synced ops never merge with typing', () => {
    const ops = I.mergeOps([
      { t: 0, op: 'insert', pos: 0, text: 'a', sync: true },
      { t: 10, op: 'insert', pos: 1, text: 'b' },
    ]);
    eq(ops.length, 2);
  });

  test('merge: backspace and forward-delete runs', () => {
    const back = I.mergeOps([5, 4, 3].map((pos, i) => ({ t: i * 90, op: 'delete', pos, len: 1 })));
    eq(back, [{ t: 0, op: 'delete', pos: 3, len: 3, d: 180 }]);
    const fwd = I.mergeOps([2, 2, 2].map((pos, i) => ({ t: i * 90, op: 'delete', pos, len: 1 })));
    eq(fwd, [{ t: 0, op: 'delete', pos: 2, len: 3, d: 180 }]);
  });

  test('merge: two already-merged runs join across a flush boundary', () => {
    const first = I.mergeOps(type('hel'));
    const second = I.mergeOps(type('lo', { t: 300, pos: 3 }));
    eq(I.mergeOps([...first, ...second]), [{ t: 0, op: 'insert', pos: 0, text: 'hello', d: 400 }]);
  });

  test('merge: merged ops replay to the same text as the raw keystrokes', () => {
    const raw = [
      ...type('The quick fox'),
      ...[12, 11, 10].map((pos, i) => ({ t: 2000 + i * 80, op: 'delete', pos, len: 1 })),
      ...type('cat', { t: 2400, pos: 10 }),
      ...type('brown ', { t: 6000, pos: 4 }),
    ];
    const merged = I.mergeOps(raw);
    assert(merged.length < raw.length, 'expected fewer ops after merging');
    eq(I.applyOps('', merged), I.applyOps('', raw));
    eq(I.applyOps('', merged), 'The brown quick cat');
  });

  test('paste threshold: more than 40 characters in one event', () => {
    eq(I.insertKind('x'.repeat(40)), 'insert');
    eq(I.insertKind('x'.repeat(41)), 'paste');
  });

  test('encoding: timestamps are stored as integer deltas and round-trip', () => {
    const ops = [
      { t: 0, op: 'insert', pos: 0, text: 'hello', d: 400 },
      { t: 5200, op: 'paste', pos: 5, text: 'p'.repeat(50) },
      { t: 5900, op: 'delete', pos: 3, len: 2, d: 90 },
      { t: 9000, op: 'insert', pos: 0, text: 'old text', sync: true },
    ];
    const rows = I.encodeOps(ops);
    eq(rows.map((r) => r[0]), [0, 5200, 700, 3100]);
    eq(rows[0], [0, 0, 0, 'hello', 400]);
    eq(rows[2], [700, 1, 3, 2, 90]);
    eq(rows[3][1], 4);
    eq(I.decodeOps(rows), ops);
  });
})();
