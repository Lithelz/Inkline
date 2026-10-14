// Idle compression, playback layout and stats.
(function () {
  const I = globalThis.Inkline;

  test('idle: gaps over 3s are compressed to 0.5s', () => {
    eq(I.compressGaps([0, 1000, 6000, 6400, 20000]), [0, 1000, 1500, 1900, 2400]);
  });

  test('idle: a gap of exactly 3s is kept', () => {
    eq(I.compressGaps([0, 3000, 6001]), [0, 3000, 3500]);
  });

  test('idle: empty and single-entry timelines', () => {
    eq(I.compressGaps([]), []);
    eq(I.compressGaps([4200]), [0]);
  });

  test('idle: raw times are untouched; skip-idle only changes the layout', () => {
    const sessions = [
      { start: 1, ops: [{ t: 0, op: 'insert', pos: 0, text: 'a' }, { t: 60000, op: 'insert', pos: 1, text: 'b' }] },
    ];
    const atoms = I.buildAtoms(sessions);
    eq([...I.layoutTimes(atoms, { skipIdle: true }).times], [0, 500]);
    eq([...I.layoutTimes(atoms, { skipIdle: false }).times], [0, 60000]);
    eq(sessions[0].ops[1].t, 60000);
  });

  test('layout: sessions are joined with a short gap, however far apart they were', () => {
    const sessions = [
      { start: 0, ops: [{ t: 0, op: 'insert', pos: 0, text: 'a' }] },
      { start: 86400000, ops: [{ t: 0, op: 'insert', pos: 1, text: 'b' }] },
    ];
    const atoms = I.buildAtoms(sessions);
    eq([...I.layoutTimes(atoms, { skipIdle: true }).times], [0, 500]);
    eq([...I.layoutTimes(atoms, { skipIdle: false }).times], [0, 1000]);
  });

  test('atoms: merged runs expand to one step per character and replay correctly', () => {
    const ops = [
      { t: 0, op: 'insert', pos: 0, text: 'hello', d: 400 },
      { t: 1000, op: 'delete', pos: 3, len: 2, d: 100 },
      { t: 2000, op: 'paste', pos: 3, text: 'p'.repeat(50) },
    ];
    const atoms = I.buildAtoms([{ start: 0, ops }]);
    eq(atoms.length, 5 + 2 + 1);
    eq(atoms.slice(0, 5).map((a) => a.t), [0, 100, 200, 300, 400]);
    eq(atoms.slice(5, 7).map((a) => a.pos), [4, 3]);
    assert(atoms[7].paste, 'paste flag carried through');
    let text = '';
    for (const a of atoms) text = a.del ? text.slice(0, a.pos) + text.slice(a.pos + a.len) : text.slice(0, a.pos) + a.text + text.slice(a.pos);
    eq(text, I.applyOps('', ops));
  });

  test('stats: typed vs pasted vs deleted, and active time ignores idle gaps', () => {
    const stats = I.sessionStats([
      { t: 0, op: 'insert', pos: 0, text: 'hello', d: 400 },
      { t: 1400, op: 'delete', pos: 4, len: 1 }, // 1s gap: active
      { t: 61400, op: 'paste', pos: 4, text: 'p'.repeat(50) }, // 60s gap: idle
      { t: 61500, op: 'insert', pos: 0, text: 'pre-existing', sync: true },
    ]);
    eq(stats.typed, 5);
    eq(stats.deleted, 1);
    eq(stats.pasted, 50);
    eq(stats.synced, 12);
    eq(stats.active, 400 + 1000 + 100);
    eq(stats.span, 61500);
  });
})();
