// The small dot shown on a page while Inkline is recording it.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});
  if (I.indicator) return;

  let host = null;
  let dot = null;
  let timer = 0;

  function show() {
    if (host || window.top !== window) return;
    host = document.createElement('inkline-indicator');
    host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    // Built node by node: pages with Trusted Types reject innerHTML.
    const style = document.createElement('style');
    style.textContent = `
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #1a7f5a; opacity: .45;
             box-shadow: 0 0 0 2px rgba(255,255,255,.7); transition: opacity .4s, transform .4s; }
      .dot.active { opacity: 1; transform: scale(1.25); }
      @media (prefers-color-scheme: dark) { .dot { background: #4cc38a; box-shadow: 0 0 0 2px rgba(0,0,0,.4); } }`;
    dot = document.createElement('div');
    dot.className = 'dot';
    root.append(style, dot);
    document.documentElement.appendChild(host);
  }

  function pulse() {
    if (!dot) return;
    dot.classList.add('active');
    clearTimeout(timer);
    timer = setTimeout(() => dot && dot.classList.remove('active'), 1200);
  }

  function hide() {
    if (host) host.remove();
    host = dot = null;
  }

  I.indicator = { show, pulse, hide };
})();
