// Recorder for sites the user has switched on. Works on <textarea>,
// <input type=text> and contenteditable editors, including ones that live in
// same-origin iframes (TinyMCE, CKEditor 4).
//
// The field's value is readable here, so there is no cursor tracking: after
// every input event the new value is diffed against the last one.
(function () {
  const I = globalThis.Inkline;
  if (I.siteStarted) return;
  I.siteStarted = true;

  const MARK = 'inklineRec';
  const SCAN_MS = 2000;
  const token = Math.random().toString(36).slice(2);

  const fields = new WeakMap();
  const clients = new Set();
  const claimed = new Set();

  // Editor iframes are usually about:blank; name recordings after the page that hosts them.
  function pageLocation() {
    let w = window;
    try {
      while (w !== w.parent && /^(about|blob|data):/.test(w.location.href)) w = w.parent;
      return w.location;
    } catch {
      return location;
    }
  }

  function pageTitle() {
    try {
      return window.top.document.title;
    } catch {
      return document.title;
    }
  }

  const usable = (el) => !el.readOnly && !el.disabled && !/cc-|password|one-time-code/.test(el.autocomplete || '');

  function editableRoot(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el) return null;
    if (el.tagName === 'TEXTAREA') return usable(el) ? el : null;
    if (el.tagName === 'INPUT') return el.type === 'text' && usable(el) ? el : null;
    if (el.ownerDocument.designMode === 'on') return el.ownerDocument.body;
    if (!el.isContentEditable) return null;
    while (el.parentElement && el.parentElement.isContentEditable) el = el.parentElement;
    return el;
  }

  function read(el) {
    if ('value' in el && el.tagName !== 'BODY') return el.value.replace(/\r\n?/g, '\n');
    return el.innerText.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  }

  function fieldKey(el) {
    const doc = el.ownerDocument;
    const all = doc.querySelectorAll('textarea, input[type="text"], [contenteditable]');
    const own = el.id || el.getAttribute('name') || el.getAttribute('aria-label') || `${el.tagName.toLowerCase()}-${[...all].indexOf(el)}`;
    let frame = null;
    try {
      frame = doc.defaultView.frameElement;
    } catch {}
    return frame ? `${frame.id || frame.name || 'frame'}/${own}` : own;
  }

  const fieldLabel = (el) => el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || 'Text field';

  // seen: the field's text before any edit we are about to record.
  function stateFor(el, seen) {
    let st = fields.get(el);
    if (st) return st;
    const loc = pageLocation();
    const url = loc.origin + loc.pathname + loc.search;
    const label = fieldLabel(el);
    const client = new I.RecClient({
      id: `site:${loc.host}${loc.pathname}${loc.search}#${fieldKey(el)}`,
      info: () => ({ kind: 'site', title: `${pageTitle() || loc.host} · ${label}`, url, host: loc.host }),
      onActivity: I.indicator.pulse,
    });
    clients.add(client);
    // text stays null until the stored recording has been loaded.
    st = { el, client, text: null, live: false, pendingSync: [], queue: [], seen: seen ?? read(el) };
    fields.set(el, st);
    client.open().then((stored) => {
      st.text = stored;
      sync(st, st.seen);
      st.queue.splice(0).forEach((value) => edit(st, value));
    });
    return st;
  }

  // The field changed without us seeing the keystrokes (pre-filled text, a
  // script, an edit made while recording was off). Nothing is written for a
  // field until the user actually types in it.
  function sync(st, value) {
    if (value === st.text) return;
    const ops = I.diffOps(st.text, value).map((op) => ({ ...op, sync: true }));
    st.text = value;
    if (!st.live) st.pendingSync.push(...ops);
    else {
      const t = st.client.now();
      for (const op of ops) st.client.add({ ...op, t });
    }
  }

  function edit(st, value) {
    if (value === st.text) return;
    const t = st.client.now();
    for (const op of st.pendingSync.splice(0)) st.client.add({ ...op, t });
    for (const op of I.diffOps(st.text, value)) {
      st.client.add(op.op === 'delete' ? { ...op, t } : { ...op, t, op: I.insertKind(op.text) });
    }
    st.text = value;
    st.live = true;
  }

  function onFocusIn(e) {
    const root = editableRoot(e.target);
    if (!root) return;
    const st = stateFor(root);
    if (st.text !== null) sync(st, read(root));
  }

  // Fires before the change lands, so a field first seen here is captured in
  // its pre-edit state.
  function onBeforeInput(e) {
    const root = editableRoot(e.target);
    if (root) stateFor(root);
  }

  // A field first seen on `input` has already changed; for plain typing in a
  // form field the keystroke can be taken back out to get the text before it.
  function valueBefore(el, e, value) {
    const data = e.inputType === 'insertText' && e.data;
    if (!data || typeof el.selectionStart !== 'number') return value;
    const end = el.selectionStart;
    const start = end - data.length;
    return start >= 0 && value.slice(start, end) === data ? value.slice(0, start) + value.slice(end) : value;
  }

  function onInput(e) {
    const root = editableRoot(e.target);
    if (!root) return;
    const value = read(root);
    const st = fields.get(root) || stateFor(root, valueBefore(root, e, value));
    if (st.text === null) st.queue.push(value);
    else edit(st, value);
  }

  const handlers = { focusin: onFocusIn, beforeinput: onBeforeInput, input: onInput };

  // Several copies of this script can reach the same document (one per frame,
  // plus the parent reaching into same-origin iframes). Whoever stamps the
  // document first records it.
  function claim(doc) {
    const root = doc.documentElement;
    if (!root) return false;
    const owner = root.dataset[MARK];
    if (owner && owner !== token) return false;
    root.dataset[MARK] = token;
    return true;
  }

  function scan(doc, depth) {
    if (!claim(doc)) return;
    const isNew = !claimed.has(doc);
    claimed.add(doc);
    // Re-added every pass: document.open() (used by rich-text editors) drops listeners.
    for (const [type, fn] of Object.entries(handlers)) doc.addEventListener(type, fn, true);
    if (isNew) {
      const root = editableRoot(doc.activeElement);
      if (root) stateFor(root);
    }
    if (depth >= 3) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      let inner = null;
      try {
        inner = frame.contentDocument;
      } catch {}
      if (inner) scan(inner, depth + 1);
    }
  }

  function stop() {
    clearInterval(timer);
    for (const doc of claimed) {
      for (const [type, fn] of Object.entries(handlers)) doc.removeEventListener(type, fn, true);
      if (doc.documentElement && doc.documentElement.dataset[MARK] === token) delete doc.documentElement.dataset[MARK];
    }
    claimed.clear();
    for (const client of clients) client.close();
    I.indicator.hide();
    I.siteStarted = false;
  }

  function tick() {
    // The extension was reloaded or removed: let go of the page.
    if (!chrome.runtime || !chrome.runtime.id) return stop();
    scan(document, 0);
    if (claimed.has(document)) I.indicator.show();
  }

  const timer = setInterval(tick, SCAN_MS);
  tick();

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'inkline:stop') stop();
  });
})();
