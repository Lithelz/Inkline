(async function () {
  const I = globalThis.Inkline;
  const F = I.format;
  const $ = (id) => document.getElementById(id);
  const store = I.openStore();

  const DOCS_HOST = 'docs.google.com';
  const hostOf = (origin) => (origin.match(/^[^:]+:\/\/([^/]*)/) || [])[1] || '';
  const DOC_ID = /^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/;
  const originFor = (host) => `*://${host}/*`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try {
    url = new URL(tab.url);
  } catch {}

  function showStats(meta) {
    if (!meta) return;
    const total = I.totalStats(meta.sessions);
    const cells = [
      [F.duration(total.active), 'writing'],
      [F.count(total.typed), 'typed'],
      [String(total.sessions), total.sessions === 1 ? 'session' : 'sessions'],
    ];
    $('page-stats').replaceChildren(
      ...cells.map(([value, label]) => {
        const div = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = value;
        div.append(b, label);
        return div;
      })
    );
    $('page-stats').hidden = false;
  }

  const DOCS_FILES = [
    'src/shared/ops.js',
    'src/shared/diff.js',
    'src/shared/reconcile.js',
    'src/content/client.js',
    'src/content/indicator.js',
    'src/content/docs.config.js',
    'src/content/docs.js',
  ];

  async function showDiag(docId) {
    const key = `diag:docs:${docId}`;
    const read = async () => (await chrome.storage.local.get(key))[key];
    const yes = (v) => (v ? 'yes' : 'NO');
    // Injecting again makes a running recorder report in, and starts one in a
    // tab that was open before Inkline was loaded.
    const asked = Date.now();
    let startError = '';
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: DOCS_FILES }).catch((err) => {
      startError = (err && err.message) || String(err);
    });
    await new Promise((r) => setTimeout(r, 1000));
    const d = await read();
    const lines =
      !d || d.at < asked
        ? ['Recorder could not start on this tab.', `Reason: ${startError || 'script ran but did not report in'}`]
        : [
            `Attached to editor: ${yes(d.attached)}`,
            `Storage reachable: ${yes(d.ready)}`,
            `Keys seen: ${d.keys}   edits: ${d.edits}`,
            `Export checks: ${d.exportOk} ok, ${d.exportFail} failed`,
            `Last export: ${d.lastExport || '-'}`,
            `Last check: ${d.lastCheck || '-'}`,
            `Ops confirmed: ${d.committed}   saved: ${d.saved || 0}`,
            `Error: ${d.error || 'none'}`,
          ];
    $('diag-text').textContent = lines.join('\n');
    $('diag').hidden = false;
    $('diag').open = true;
  }

  async function renderPage() {
    const docId = url && url.host === 'docs.google.com' && (url.pathname.match(DOC_ID) || [])[1];
    if (docId) {
      $('page-title').textContent = 'Google Docs';
      $('page-sub').textContent = 'Documents are recorded automatically.';
      $('docs-live').hidden = false;
      showStats(await store.getMeta(`docs:${docId}`));
      showDiag(docId);
    } else if (url && url.host === 'docs.google.com') {
      $('page-title').textContent = 'Google Docs';
      $('page-sub').textContent = 'Open a document and Inkline records it automatically.';
    } else if (url && /^https?:$/.test(url.protocol)) {
      $('page-title').textContent = url.hostname;
      $('site-switch').hidden = false;
      const on = await chrome.permissions.contains({ origins: [originFor(url.hostname)] });
      $('site-toggle').checked = on;
      $('page-sub').textContent = on ? 'Recording text you write on this site.' : 'Record on this site';
    } else {
      $('page-title').textContent = 'Nothing to record here';
      $('page-sub').textContent = 'Open a Google Doc, or any site you want to record on.';
    }
  }

  async function renderSites() {
    const { origins = [] } = await chrome.permissions.getAll();
    const hosts = [...new Set(origins.map(hostOf).filter((h) => h && h !== DOCS_HOST))];
    $('sites-section').hidden = !hosts.length;
    $('sites').replaceChildren(
      ...hosts.map((host) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = host;
        const off = document.createElement('button');
        off.textContent = 'Turn off';
        off.addEventListener('click', () => disable(host));
        li.append(name, off);
        return li;
      })
    );
  }

  async function renderTotal() {
    const list = await store.list();
    const size = list.reduce((n, m) => n + (m.bytes || 0), 0);
    $('total').textContent = list.length ? `${list.length} recording${list.length === 1 ? '' : 's'} · ${F.bytes(size)}` : '';
  }

  async function disable(host) {
    // Remove exactly the patterns that were granted for this host.
    const { origins = [] } = await chrome.permissions.getAll();
    const granted = origins.filter((o) => hostOf(o) === host);
    // Tell pages on that host to stop now; the permission goes with it.
    const tabs = await chrome.tabs.query({ url: granted }).catch(() => []);
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'inkline:stop' }).catch(() => {});
    if (granted.length) await chrome.permissions.remove({ origins: granted }).catch(() => false);
    await Promise.all([renderPage(), renderSites()]);
  }

  $('site-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Must be called straight from the click. The service worker reacts to
      // the grant itself, so this still works if the prompt closes the popup.
      const granted = await chrome.permissions.request({ origins: [originFor(url.hostname)] }).catch(() => false);
      e.target.checked = granted;
      await Promise.all([renderPage(), renderSites()]);
    } else await disable(url.hostname);
  });

  $('open').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/player/player.html') });
    window.close();
  });

  renderPage();
  renderSites();
  renderTotal();
})();
