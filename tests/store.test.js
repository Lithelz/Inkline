// Storage round-trip: ops -> delta encoding -> gzip -> store -> back again.
(function () {
  const I = globalThis.Inkline;
  const newStore = () => new I.Store({ meta: I.memoryKV(), chunks: I.memoryKV() });

  // Deterministic stand-in for an hour at the keyboard: bursts of typing,
  // typos fixed with backspace, thinking pauses and the odd paste.
  function simulateHour() {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const words = 'the of and to in is that it was for on are as with his they at be this from have or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part'.split(' ');
    const ops = [];
    let t = 0;
    let text = '';
    const add = (op) => {
      ops.push(op);
      text = I.applyOp(text, op);
    };
    while (t < 3600000) {
      const roll = rand();
      if (roll < 0.004) {
        const paste = Array.from({ length: 30 }, () => words[Math.floor(rand() * words.length)]).join(' ');
        add({ t, op: 'paste', pos: text.length, text: paste });
        t += 4000;
      } else if (roll < 0.05 && text.length > 6) {
        for (let i = 0; i < 4; i++) {
          add({ t, op: 'delete', pos: text.length - 1, len: 1 });
          t += 110;
        }
      } else {
        for (const ch of `${words[Math.floor(rand() * words.length)]} `) {
          add({ t, op: 'insert', pos: text.length, text: ch });
          t += 120 + Math.floor(rand() * 160);
        }
      }
      if (rand() < 0.06) t += 2000 + Math.floor(rand() * 20000);
    }
    return { ops, text };
  }

  test('codec: gzip round-trips text, including non-ASCII', async () => {
    const text = 'naïve café — 日本語 🙂\n'.repeat(50);
    const packed = await I.gzip(text);
    assert(packed instanceof Uint8Array && packed[0] === 0x1f && packed[1] === 0x8b, 'expected a gzip stream');
    assert(packed.byteLength < text.length, 'expected compression');
    eq(await I.gunzip(packed), text);
  });

  test('store: appended ops come back identical, with stats in the metadata', async () => {
    const store = newStore();
    const ops = [
      { t: 0, op: 'insert', pos: 0, text: 'Draft', d: 500 },
      { t: 4000, op: 'paste', pos: 5, text: ' ' + 'quoted '.repeat(8) },
      { t: 9000, op: 'delete', pos: 0, len: 5 },
    ];
    await store.append('docs:abc', { kind: 'docs', title: 'Essay', url: 'https://docs.google.com/document/d/abc/edit' }, 1000, ops);
    const rec = await store.get('docs:abc');
    eq(rec.sessions, [{ start: 1000, ops }]);
    eq(rec.meta.title, 'Essay');
    eq(rec.meta.sessions.length, 1);
    eq(rec.meta.sessions[0].typed, 5);
    eq(rec.meta.sessions[0].pasted, 57);
    eq(rec.meta.bytes, rec.meta.sessions[0].bytes);
    eq(await store.getText('docs:abc'), ' ' + 'quoted '.repeat(8));
  });

  test('store: flushes into one session merge at the seam; new sessions append', async () => {
    const store = newStore();
    await store.append('r', { title: 'T' }, 100, [{ t: 0, op: 'insert', pos: 0, text: 'ab', d: 100 }]);
    await store.append('r', { title: 'T' }, 100, [{ t: 300, op: 'insert', pos: 2, text: 'c' }]);
    await store.append('r', { title: 'T2' }, 900000, [{ t: 0, op: 'insert', pos: 3, text: 'd' }]);
    const rec = await store.get('r');
    eq(rec.sessions.map((s) => s.ops.map((o) => o.text)), [['abc'], ['d']]);
    eq(rec.sessions[0].ops[0].d, 300);
    eq(rec.meta.title, 'T2');
    eq(rec.meta.sessions.map((s) => s.start), [100, 900000]);
    eq(await store.getText('r'), 'abcd');
  });

  test('store: concurrent appends do not lose ops', async () => {
    const store = newStore();
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) => store.append('r', {}, 1, [{ t: i * 5000, op: 'insert', pos: i, text: String(i) }]))
    );
    eq(await store.getText('r'), '01234');
  });

  test('store: an hour of writing stays well under 100 KB and replays exactly', async () => {
    const store = newStore();
    const { ops, text } = simulateHour();
    assert(text.length > 8000, `simulation too small (${text.length} chars)`);
    // Flushed in small batches, the way the content script sends them.
    let meta;
    for (let i = 0; i < ops.length; i += 40) meta = await store.append('hour', { title: 'Hour' }, 5, ops.slice(i, i + 40));
    eq(await store.getText('hour'), text);
    assert(meta.bytes < 100 * 1024, `stored ${meta.bytes} bytes`);
    assert(meta.sessions[0].ops < ops.length / 3, 'expected keystrokes to be merged');
    console.log(`    one simulated hour: ${ops.length} keystrokes -> ${meta.sessions[0].ops} ops, ${meta.bytes} bytes stored`);
  });

  test('store: export -> import round-trip keeps every op and never overwrites', async () => {
    const a = newStore();
    await a.append('site:example.com/x#body', { kind: 'site', title: 'Post', host: 'example.com' }, 10, [
      { t: 0, op: 'insert', pos: 0, text: 'one', d: 200 },
    ]);
    await a.append('site:example.com/x#body', {}, 99999, [{ t: 0, op: 'delete', pos: 1, len: 2, d: 80 }]);
    const file = await a.exportFile('site:example.com/x#body');
    assert(file[0] === 0x1f && file[1] === 0x8b, '.inkline files are gzip');

    const b = newStore();
    const imported = await b.importFile(file);
    eq(imported.id, 'site:example.com/x#body');
    eq((await b.get(imported.id)).sessions, (await a.get('site:example.com/x#body')).sessions);
    eq(imported.title, 'Post');

    const again = await b.importFile(file);
    assert(again.id !== imported.id, 'second import must get its own id');
    eq((await b.list()).length, 2);
  });

  test('store: import rejects files that are not recordings', async () => {
    const store = newStore();
    for (const bytes of [new Uint8Array([1, 2, 3]), await I.gzip('{"format":"other"}')]) {
      let failed = false;
      await store.importFile(bytes).catch(() => (failed = true));
      assert(failed, 'expected import to fail');
    }
    eq((await store.list()).length, 0);
  });

  test('store: delete removes the recording and its chunks', async () => {
    const chunks = I.memoryKV();
    const store = new I.Store({ meta: I.memoryKV(), chunks });
    await store.append('r', {}, 1, [{ t: 0, op: 'insert', pos: 0, text: 'a' }]);
    await store.append('r', {}, 2, [{ t: 0, op: 'insert', pos: 1, text: 'b' }]);
    await store.remove('r');
    eq(await store.get('r'), null);
    eq((await chunks.values()).length, 0);
    eq(await store.getText('r'), '');
  });
})();
