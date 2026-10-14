// Google Docs recorder.
//
// Docs draws text on a canvas, so nothing here reads the visible page. Key
// events on the hidden text-target iframe are turned into provisional ops with
// a best-guess cursor position. Whenever typing pauses, the document's plain
// text export is fetched and the provisional ops are checked against it (see
// shared/reconcile.js) before anything is stored. Snapshots are only ever held
// in memory.
(function () {
  const I = globalThis.Inkline;
  const C = I.docsConfig;
  const match = location.pathname.match(C.docIdPattern);
  if (!match) return;
  // Injected again (the popup does this to check on us): just report in.
  if (I.docsStarted) return void (I.docsReport && I.docsReport());
  I.docsStarted = true;

  const docId = match[1];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function title() {
    const input = document.querySelector(C.titleInput);
    return ((input && input.value) || document.title.replace(C.titleSuffix, '')).trim() || 'Untitled document';
  }

  const client = new I.RecClient({
    id: `docs:${docId}`,
    info: () => ({ kind: 'docs', title: title(), url: `${location.origin}/document/d/${docId}/edit`, host: location.host }),
    onActivity: I.indicator.pulse,
  });

  // Status readout for the popup, so a broken step is visible without devtools.
  const diag = { doc: docId, loaded: Date.now(), attached: false, ready: false, keys: 0, edits: 0, exportOk: 0, exportFail: 0, lastExport: '', lastCheck: '', committed: 0 };
  let diagTimer = 0;
  function note(patch) {
    Object.assign(diag, patch);
    if (diagTimer) return;
    diagTimer = setTimeout(() => {
      diagTimer = 0;
      Object.assign(diag, { sent: client.sent, saved: client.saved, error: client.error, at: Date.now() });
      try {
        chrome.storage.local.set({ [`diag:docs:${docId}`]: diag }).catch(() => {});
      } catch {}
    }, 400);
  }
  client.onResult = () => note({});
  I.docsReport = () => note({});

  let base = ''; // text as of the last snapshot we trusted
  let model = ''; // base with the provisional ops applied
  let prov = []; // ops since base; positions are guesses until verified
  let pendingSync = []; // stored text -> first snapshot, written with the first real edit
  let cursor = null; // offset into model, or null when we have lost track
  let lastCursor = null;
  let dirty = false; // something changed that key events can't describe (cut, undo, ...)
  let dirtyAt = 0;

  let ready = false;
  const queued = [];
  let editGen = 0;
  let verifying = false;
  let verifyTimer = 0;
  let lastSnapshotAt = 0;
  let failures = 0;
  let stale = 0;

  async function snapshot() {
    lastSnapshotAt = Date.now();
    try {
      const res = await fetch(C.exportUrl(docId), C.exportFetch);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/^text\/plain/.test(type)) {
        note({ exportFail: diag.exportFail + 1, lastExport: `failed: HTTP ${res.status} ${type}` });
        return null;
      }
      note({ exportOk: diag.exportOk + 1, lastExport: 'ok' });
      return (await res.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    } catch (err) {
      note({ exportFail: diag.exportFail + 1, lastExport: `failed: ${(err && err.message) || err}` });
      return null;
    }
  }

  function setCursor(pos) {
    cursor = pos;
    if (pos !== null) lastCursor = pos;
  }

  const place = () => Math.min(cursor ?? lastCursor ?? model.length, model.length);

  function addProv(op) {
    I.appendOp(prov, op);
    model = I.applyOp(model, op);
  }

  function apply(ev) {
    if (ev.kind === 'nav') {
      if (ev.by === null) cursor = null;
      else if (cursor !== null) setCursor(Math.min(Math.max(cursor + ev.by, 0), model.length));
      return;
    }
    editGen++;
    note({ edits: diag.edits + 1 });
    client.hold = true;
    if (ev.kind === 'ins') {
      const pos = place();
      addProv({ t: ev.t, op: I.insertKind(ev.text), pos, text: ev.text });
      setCursor(pos + ev.text.length);
    } else if (ev.kind === 'del') {
      const pos = place();
      let from = pos;
      let to = pos;
      if (ev.back) from = ev.word ? pos - /\S*\s*$/.exec(model.slice(0, pos))[0].length : pos - 1;
      else to = ev.word ? pos + /^\s*\S*/.exec(model.slice(pos))[0].length : pos + 1;
      from = Math.max(from, 0);
      to = Math.min(to, model.length);
      if (to > from) {
        addProv({ t: ev.t, op: 'delete', pos: from, len: to - from });
        setCursor(from);
      } else markDirty(ev.t);
    } else markDirty(ev.t);
    scheduleVerify();
  }

  function markDirty(t) {
    if (!dirty) dirtyAt = t;
    dirty = true;
  }

  function push(ev) {
    if (ev.kind !== 'nav') ev.t = client.now();
    if (ready) apply(ev);
    else queued.push(ev);
  }

  function commit(ops) {
    if (ops.length) {
      for (const op of pendingSync) client.add({ ...op, t: ops[0].t });
      pendingSync = [];
      for (const op of ops) client.add(op);
      note({ committed: diag.committed + ops.length });
    }
    prov = [];
    dirty = false;
    client.hold = false;
  }

  function scheduleVerify() {
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(verify, C.verifyIdleMs);
  }

  async function verify() {
    if (verifying || (!prov.length && !dirty)) return;
    const wait = C.minSnapshotIntervalMs - (Date.now() - lastSnapshotAt);
    if (wait > 0) {
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(verify, wait);
      return;
    }
    verifying = true;
    const gen = editGen;
    try {
      const snap = await snapshot();
      if (gen !== editGen) return;
      if (snap === null) {
        // Export unavailable: after a few tries, keep the guesses as they are.
        if (++failures >= C.maxSnapshotFailures) {
          base = model;
          commit(prov);
          note({ lastCheck: 'kept unverified (export unavailable)' });
        }
        return;
      }
      failures = 0;
      if (snap !== model) {
        // The export shows none of what was just typed: it is behind, not us.
        if (snap === base && prov.length) {
          if (++stale >= C.maxStaleSnapshots) {
            stale = 0;
            base = model;
            commit(prov);
            note({ lastCheck: 'kept unverified (export behind)' });
          } else note({ lastCheck: 'waiting for export to catch up' });
          return;
        }
        await sleep(C.settleMs);
        const again = await snapshot();
        if (gen !== editGen || again !== snap) return;
      }
      stale = 0;
      const result = I.reconcile({ base, ops: prov, snapshot: snap, now: dirtyAt });
      base = model = snap;
      note({ lastCheck: `${result.method}, ${result.ops.length} ops` });
      commit(result.ops);
      if (result.cursor !== null) setCursor(Math.min(result.cursor, model.length));
      // We had it wrong, so the export may still have been catching up: look once more.
      if (result.method !== 'match') markDirty(client.now());
    } finally {
      verifying = false;
      if (prov.length || dirty) scheduleVerify();
    }
  }

  // --- events on the text-target iframe -----------------------------------

  const FRESH_MS = 150;
  let keyInsert = null; // last text taken from keydown/compositionend, to skip its beforeinput twin
  let enterAt = 0;
  let deleteAt = 0;
  let pasteAt = 0;
  const fresh = (at) => performance.now() - at < FRESH_MS;

  function typed(text) {
    keyInsert = { text, at: performance.now() };
    push({ kind: 'ins', text });
  }

  function onKeyDown(e) {
    const k = e.key;
    note({ keys: diag.keys + 1 });
    if (e.isComposing || k === 'Process' || k === 'Dead' || k === 'Unidentified') return;
    const command = isMac ? e.metaKey : e.ctrlKey;
    const chord = e.ctrlKey || e.metaKey || (!isMac && e.altKey);
    if (Array.from(k).length === 1 && !chord) return typed(k);
    switch (k) {
      case 'Enter':
        if (chord) return push({ kind: 'dirty' });
        enterAt = performance.now();
        return typed('\n');
      case 'Tab':
        if (chord) return;
        return e.shiftKey ? push({ kind: 'dirty' }) : typed('\t');
      case 'Backspace':
      case 'Delete':
        if (isMac && e.metaKey) return push({ kind: 'dirty' });
        deleteAt = performance.now();
        return push({ kind: 'del', back: k === 'Backspace', word: isMac ? e.altKey : e.ctrlKey });
      case 'ArrowLeft':
      case 'ArrowRight': {
        const plain = !e.shiftKey && !e.altKey && !chord;
        return push({ kind: 'nav', by: plain ? (k === 'ArrowLeft' ? -1 : 1) : null });
      }
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Home':
      case 'End':
      case 'PageUp':
      case 'PageDown':
        return push({ kind: 'nav', by: null });
    }
    if (command && k.length === 1) {
      const key = k.toLowerCase();
      if (key === 'a') push({ kind: 'nav', by: null });
      else if ('zyxv'.includes(key)) push({ kind: 'dirty' });
    }
  }

  // Docs cancels most keydowns itself, so these only fire for input that never
  // had a usable keydown: IME, dictation, emoji picker, autocorrect, drops.
  function onBeforeInput(e) {
    const type = e.inputType || '';
    const data = e.data ?? (e.dataTransfer && e.dataTransfer.getData('text/plain')) ?? '';
    if (type === 'insertText' || type === 'insertReplacementText') {
      if (keyInsert && keyInsert.text === data && fresh(keyInsert.at)) keyInsert = null;
      else if (data) push({ kind: 'ins', text: data });
    } else if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      if (fresh(pasteAt)) return;
      if (data) push({ kind: 'ins', text: data.replace(/\r\n?/g, '\n') });
      else push({ kind: 'dirty' });
    } else if (type === 'insertParagraph' || type === 'insertLineBreak') {
      if (!fresh(enterAt)) push({ kind: 'ins', text: '\n' });
    } else if (type.startsWith('delete')) {
      if (!fresh(deleteAt)) push({ kind: 'del', back: !type.includes('Forward'), word: type.includes('Word') });
    }
  }

  function onCompositionEnd(e) {
    if (e.data) typed(e.data);
  }

  function onPaste(e) {
    pasteAt = performance.now();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n') : '';
    push(text ? { kind: 'ins', text } : { kind: 'dirty' });
  }

  function onCut() {
    push({ kind: 'nav', by: null });
    push({ kind: 'dirty' });
  }

  const handlers = { keydown: onKeyDown, beforeinput: onBeforeInput, compositionend: onCompositionEnd, paste: onPaste, cut: onCut };

  // Docs can rebuild the iframe; adding the same listener twice is a no-op, so
  // this simply runs on a timer.
  function attach() {
    const frame = document.querySelector(C.textTargetIframe);
    let doc = null;
    try {
      doc = frame && frame.contentDocument;
    } catch {}
    if (!doc) return;
    for (const [type, fn] of Object.entries(handlers)) doc.addEventListener(type, fn, true);
    if (!diag.attached) note({ attached: true });
    I.indicator.show();
  }

  // A click in the document moves the cursor somewhere we can't see.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.target instanceof Element && e.target.closest(C.editorSurface)) push({ kind: 'nav', by: null });
    },
    true
  );

  window.addEventListener('pagehide', () => {
    if (prov.length) {
      base = model;
      commit(prov);
    }
    client.flush();
  });

  note({});
  attach();
  setInterval(attach, C.findIframeEveryMs);

  (async function init() {
    const [stored, snap] = await Promise.all([client.open(), snapshot()]);
    base = model = snap ?? stored;
    if (snap !== null && snap !== stored) pendingSync = I.diffOps(stored, snap).map((op) => ({ ...op, sync: true }));
    ready = true;
    note({ ready: true });
    queued.splice(0).forEach(apply);
  })();
})();
