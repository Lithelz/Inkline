// Everything Inkline assumes about the Google Docs page lives here. Docs
// changes its markup without notice; if recording stops working, this is the
// file to update. Last checked against the live editor: October 2026.
//
// What was observed:
//  - The document is painted on <canvas class="kix-canvas-tile-content"> tiles
//    inside .kix-appview-editor. There is no readable text in the DOM.
//  - Keyboard focus sits in an offscreen <iframe class="docs-texteventtarget-iframe">
//    (src about:blank, same origin). Its document holds one
//    <div contenteditable="true" role="textbox" aria-label="Document content">.
//  - Docs handles keys on that iframe's keydown and cancels the default, so
//    beforeinput/input do not fire for most keys. Capture-phase keydown
//    listeners on the iframe's document still see everything.
//  - /document/d/<id>/export?format=txt returns the plain text (UTF-8, CRLF
//    line ends, one line per paragraph). It answers with a redirect to a
//    one-time *.googleusercontent.com URL that allows any origin but not
//    credentialed requests, so it must be fetched with credentials: 'same-origin'.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  I.docsConfig = {
    docIdPattern: /\/document\/(?:u\/\d+\/)?d\/([\w-]+)/,
    textTargetIframe: 'iframe.docs-texteventtarget-iframe',
    editorSurface: '.kix-appview-editor',
    titleInput: 'input.docs-title-input',
    titleSuffix: /\s+-\s+Google Docs$/,
    exportUrl: (id) => `/document/d/${id}/export?format=txt`,
    exportFetch: { credentials: 'same-origin', cache: 'no-store' },

    // Wait this long after the last edit before checking against a snapshot.
    verifyIdleMs: 2500,
    // A snapshot that disagrees with us must be seen twice, this far apart,
    // before it is trusted (Docs may not have saved the last keystrokes yet).
    settleMs: 2000,
    minSnapshotIntervalMs: 6000,
    // After this many failed fetches in a row, keep the unverified ops as they are.
    maxSnapshotFailures: 3,
    // The export can lag behind the editor. If it still shows none of our edits
    // after this many looks, keep the unverified ops rather than drop them.
    maxStaleSnapshots: 3,
    findIframeEveryMs: 1500,
  };
})();
