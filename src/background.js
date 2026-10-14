// Service worker: owns storage writes and keeps the opt-in site recorder
// registered on exactly the hosts the user has granted.
importScripts('shared/ops.js', 'shared/timeline.js', 'shared/codec.js', 'shared/store.js');

const I = globalThis.Inkline;
const store = I.openStore();

const SITE_SCRIPT_ID = 'inkline-sites';
const SITE_FILES = [
  'src/shared/ops.js',
  'src/shared/diff.js',
  'src/content/client.js',
  'src/content/indicator.js',
  'src/content/site.js',
];
const DOCS_HOST = 'docs.google.com';
const DOCS_FILES = [
  'src/shared/ops.js',
  'src/shared/diff.js',
  'src/shared/reconcile.js',
  'src/content/client.js',
  'src/content/indicator.js',
  'src/content/docs.config.js',
  'src/content/docs.js',
];
const hostOf = (origin) => (origin.match(/^[^:]+:\/\/([^/]*)/) || [])[1] || '';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message) return;
  if (message.type === 'inkline:open') {
    store.getText(message.id).then(
      (text) => respond({ ok: true, text }),
      () => respond({ ok: false, text: '' })
    );
    return true;
  }
  if (message.type === 'inkline:append') {
    store.append(message.id, message.info, message.start, message.ops).then(
      () => respond({ ok: true }),
      (err) => respond({ ok: false, error: String(err) })
    );
    return true;
  }
});

// The granted optional origins are the list of enabled sites; there is no
// second copy of it to drift out of sync. getAll() also reports the built-in
// Docs access (host permission and content-script pattern), which is not one.
async function enabledOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => hostOf(o) !== DOCS_HOST);
}

async function syncSiteScript() {
  const matches = await enabledOrigins();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT_ID] });
    return;
  }
  const script = { id: SITE_SCRIPT_ID, matches, js: SITE_FILES, allFrames: true, runAt: 'document_idle', persistAcrossSessions: true };
  const save = (s) => (existing.length ? chrome.scripting.updateContentScripts([s]) : chrome.scripting.registerContentScripts([s]));
  try {
    await save({ ...script, matchOriginAsFallback: true });
  } catch {
    // Older Chromium builds don't accept matchOriginAsFallback here.
    await save(script);
  }
}

// Start recording in tabs that are already open on a newly enabled site.
async function injectInto(origins) {
  for (const origin of origins) {
    const tabs = await chrome.tabs.query({ url: origin }).catch(() => []);
    for (const tab of tabs) {
      chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: SITE_FILES }).catch(() => {});
    }
  }
}

chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  await syncSiteScript();
  await injectInto(origins.filter((o) => hostOf(o) !== DOCS_HOST));
});
// Documents that were already open when the extension was installed or
// reloaded have no recorder in them yet (the browser only injects content
// scripts on page load), so put one in.
async function attachToOpenDocs() {
  const tabs = await chrome.tabs.query({ url: 'https://docs.google.com/document/*' }).catch(() => []);
  for (const tab of tabs) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: DOCS_FILES }).catch(() => {});
}

chrome.permissions.onRemoved.addListener(syncSiteScript);
chrome.runtime.onInstalled.addListener(attachToOpenDocs);
chrome.runtime.onInstalled.addListener(syncSiteScript);
chrome.runtime.onStartup.addListener(syncSiteScript);
