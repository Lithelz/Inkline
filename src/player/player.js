(function () {
  const I = globalThis.Inkline;
  const F = I.format;
  const $ = (id) => document.getElementById(id);
  const store = I.openStore();

  const KEYFRAME_EVERY = 400;
  const GHOST_MS = 700;
  const GHOST_MAX_CHARS = 240;

  let list = [];
  let rec = null; // { meta, sessions, atoms, times, total, keyframes }

  // Playback state. `idx` atoms have been applied to `text`.
  const st = {
    idx: 0,
    text: '',
    ranges: [], // pasted spans still present in the text: { s, e }
    ghosts: [], // just-deleted text, shown struck through until `until`
    caret: 0,
    time: 0,
    playing: false,
    speed: 8,
    skipIdle: true,
    lastFrame: 0,
    raf: 0,
  };

  // --- applying atoms -----------------------------------------------------

  function insertAtom(a) {
    const p = Math.min(a.pos, st.text.length);
    const n = a.text.length;
    const ranges = [];
    for (const r of st.ranges) {
      if (p <= r.s) ranges.push({ s: r.s + n, e: r.e + n });
      else if (p >= r.e) ranges.push(r);
      else ranges.push({ s: r.s, e: p }, { s: p + n, e: r.e + n }); // typed inside a paste
    }
    if (a.paste) ranges.push({ s: p, e: p + n });
    st.ranges = ranges;
    for (const g of st.ghosts) if (g.pos >= p) g.pos += n;
    st.text = st.text.slice(0, p) + a.text + st.text.slice(p);
    st.caret = p + n;
  }

  function deleteAtom(a, showGhost) {
    const p = Math.min(a.pos, st.text.length);
    const q = Math.min(p + a.len, st.text.length);
    const n = q - p;
    const move = (x) => (x <= p ? x : x >= q ? x - n : p);
    st.ranges = st.ranges.map((r) => ({ s: move(r.s), e: move(r.e) })).filter((r) => r.e > r.s);
    const removed = st.text.slice(p, q);
    let merged = false;
    for (const g of st.ghosts) {
      const wasRight = g.pos >= q;
      g.pos = move(g.pos);
      if (showGhost && !merged && g.pos === p) {
        // Backspacing walks left of the earlier ghost; forward-delete adds after it.
        g.text = wasRight ? removed + g.text : g.text + removed;
        g.until = performance.now() + GHOST_MS;
        merged = true;
      }
    }
    if (showGhost && !merged && removed) st.ghosts.push({ pos: p, text: removed, until: performance.now() + GHOST_MS });
    st.text = st.text.slice(0, p) + st.text.slice(q);
    st.caret = p;
  }

  function applyAtom(a, showGhost) {
    if (a.del) deleteAtom(a, showGhost && !a.sync);
    else insertAtom(a);
  }

  function seek(index) {
    const k = Math.min(Math.floor(index / KEYFRAME_EVERY), rec.keyframes.length - 1);
    const frame = rec.keyframes[k];
    st.text = frame.text;
    st.ranges = frame.ranges.map((r) => ({ ...r }));
    st.caret = frame.caret;
    st.ghosts = [];
    for (st.idx = k * KEYFRAME_EVERY; st.idx < index; st.idx++) applyAtom(rec.atoms[st.idx], false);
  }

  // Number of atoms that have happened by playback time t.
  function indexAt(t) {
    let lo = 0;
    let hi = rec.atoms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rec.times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // --- rendering ----------------------------------------------------------

  function render(follow) {
    const ranges = [...st.ranges].sort((a, b) => a.s - b.s);
    const cuts = new Set([0, st.text.length, st.caret]);
    for (const r of ranges) cuts.add(r.s).add(r.e);
    for (const g of st.ghosts) cuts.add(g.pos);
    const points = [...cuts].sort((a, b) => a - b);

    const out = document.createDocumentFragment();
    let caretEl = null;
    let ri = 0;
    points.forEach((c, i) => {
      for (const g of st.ghosts) {
        if (g.pos !== c) continue;
        const del = document.createElement('del');
        del.textContent = g.text.length > GHOST_MAX_CHARS ? `${g.text.slice(0, GHOST_MAX_CHARS)}…` : g.text;
        out.append(del);
      }
      if (c === st.caret) {
        caretEl = document.createElement('span');
        caretEl.className = 'caret';
        out.append(caretEl);
      }
      const next = points[i + 1];
      if (next === undefined) return;
      const chunk = st.text.slice(c, next);
      while (ri < ranges.length && ranges[ri].e <= c) ri++;
      const r = ranges[ri];
      if (r && r.s <= c) {
        const mark = document.createElement('mark');
        if (r.s === c) mark.dataset.label = `Pasted · ${F.count(r.e - r.s)} chars`;
        mark.textContent = chunk;
        out.append(mark);
      } else out.append(chunk);
    });
    $('text').replaceChildren(out);

    if (follow && caretEl) {
      const stage = $('stage');
      const top = caretEl.offsetTop;
      if (top < stage.scrollTop + 40 || top > stage.scrollTop + stage.clientHeight - 80) {
        stage.scrollTop = Math.max(0, top - stage.clientHeight / 2);
      }
    }
  }

  function renderHud() {
    $('time').textContent = `${F.clock(st.time)} / ${F.clock(rec.total)}`;
    $('scrub').value = rec.total ? Math.round((st.time / rec.total) * 1000) : 0;
    $('play').classList.toggle('playing', st.playing);
    $('play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    const atom = rec.atoms[Math.max(0, st.idx - 1)];
    const n = rec.sessions.length;
    $('session').textContent = atom && n > 1 ? `Session ${atom.s + 1} of ${n} · ${F.date(rec.sessions[atom.s].start)}` : '';
  }

  // --- playback loop ------------------------------------------------------

  function frame(now) {
    st.raf = 0;
    if (!rec) return;
    const dt = Math.min(now - st.lastFrame, exporter ? 1000 : 250);
    st.lastFrame = now;
    let changed = false;
    if (st.playing) {
      st.time = Math.min(st.time + dt * st.speed, rec.total);
      const target = indexAt(st.time);
      if (target > st.idx) {
        const showGhosts = target - st.idx < 200;
        while (st.idx < target) applyAtom(rec.atoms[st.idx++], showGhosts);
        changed = true;
      }
      if (st.time >= rec.total) st.playing = false;
    }
    const before = st.ghosts.length;
    st.ghosts = st.ghosts.filter((g) => g.until > now);
    if (changed || st.ghosts.length !== before) render(changed);
    renderHud();
    if (exporter) exporter.tick();
    if (st.playing || st.ghosts.length) run();
  }

  function run() {
    if (st.raf) return;
    // A video export must not stall when the tab loses focus, so it runs on a
    // timer; requestAnimationFrame stops in background tabs.
    st.raf = exporter ? setTimeout(() => frame(performance.now()), 33) : requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    if (!rec) return;
    if (on && st.time >= rec.total) jump(0);
    st.playing = on;
    st.lastFrame = performance.now();
    renderHud();
    if (on) run();
  }

  function jump(time) {
    st.time = Math.min(Math.max(time, 0), rec.total);
    seek(indexAt(st.time));
    render(true);
    renderHud();
  }

  function relayout() {
    Object.assign(rec, I.layoutTimes(rec.atoms, { skipIdle: st.skipIdle }));
    st.time = st.idx ? rec.times[st.idx - 1] : 0;
    renderHud();
  }

  // --- recording view -----------------------------------------------------

  function renderStats() {
    const total = I.totalStats(rec.meta.sessions);
    const added = total.typed + total.pasted;
    const first = rec.meta.sessions[0];
    const last = rec.meta.sessions[rec.meta.sessions.length - 1];
    const cards = [
      ['Active writing time', F.duration(total.active), 'Pauses over 3s not counted'],
      ['Typed', F.count(total.typed), `${F.count(total.deleted)} deleted`],
      ['Pasted', F.count(total.pasted), added ? `${Math.round((total.pasted / added) * 100)}% of text added` : 'Nothing pasted'],
      ['Sessions', String(total.sessions), first && last && first !== last ? `${F.date(first.start)} – ${F.date(last.start)}` : first ? F.date(first.start) : ''],
    ];
    $('stats').replaceChildren(
      ...cards.map(([label, value, note]) => {
        const card = document.createElement('div');
        card.className = 'stat';
        for (const [cls, text] of [['label', label], ['value', value], ['note', note]]) {
          const el = document.createElement('div');
          el.className = cls;
          el.textContent = text;
          card.append(el);
        }
        return card;
      })
    );
    const where = rec.meta.kind === 'docs' ? 'Google Docs' : rec.meta.host || 'Imported';
    const parts = [where, F.date(rec.meta.updated), F.bytes(rec.meta.bytes || 0)];
    if (total.synced) parts.push(`${F.count(total.synced)} chars changed outside recorded sessions`);
    $('sub').textContent = parts.join(' · ');
  }

  async function open(id) {
    if (exporter) exporter.cancel();
    setPlaying(false);
    const loaded = id && (await store.get(id));
    if (!loaded) {
      rec = null;
      $('view').hidden = true;
      $('empty').hidden = false;
      renderList();
      return;
    }
    rec = loaded;
    rec.atoms = I.buildAtoms(rec.sessions);
    Object.assign(rec, I.layoutTimes(rec.atoms, { skipIdle: st.skipIdle }));

    // One full replay up front to drop keyframes for scrubbing.
    Object.assign(st, { idx: 0, text: '', ranges: [], ghosts: [], caret: 0, time: 0 });
    rec.keyframes = [];
    rec.atoms.forEach((atom, i) => {
      if (i % KEYFRAME_EVERY === 0) rec.keyframes.push({ text: st.text, ranges: st.ranges.map((r) => ({ ...r })), caret: st.caret });
      applyAtom(atom, false);
    });
    if (!rec.keyframes.length) rec.keyframes.push({ text: '', ranges: [], caret: 0 });

    $('title').textContent = rec.meta.title || 'Untitled';
    $('empty').hidden = true;
    $('view').hidden = false;
    renderStats();
    renderList();
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    // Open on the finished text; pressing play starts from the top.
    jump(rec.total);
  }

  // --- list ---------------------------------------------------------------

  function renderList() {
    $('list-empty').hidden = list.length > 0;
    $('list').replaceChildren(
      ...list.map((meta) => {
        const total = I.totalStats(meta.sessions);
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.setAttribute('aria-current', String(!!rec && rec.meta.id === meta.id));
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = meta.title || 'Untitled';
        const info = document.createElement('div');
        info.className = 'meta';
        info.textContent = [F.date(meta.updated), F.duration(total.active), F.bytes(meta.bytes || 0)].join(' · ');
        btn.append(name, info);
        btn.title = `${meta.title || 'Untitled'}\n${meta.kind === 'docs' ? 'Google Docs' : meta.host || ''}`;
        btn.addEventListener('click', () => open(meta.id));
        li.append(btn);
        return li;
      })
    );
  }

  async function refreshList() {
    list = await store.list();
    renderList();
  }

  // --- actions ------------------------------------------------------------

  let toastTimer = 0;
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 3500);
  }

  $('play').addEventListener('click', () => (exporter ? exporter.cancel() : setPlaying(!st.playing)));
  $('scrub').addEventListener('input', (e) => rec && !exporter && jump((e.target.value / 1000) * rec.total));
  $('speed').addEventListener('input', (e) => {
    st.speed = Number(e.target.value);
    $('speed-label').textContent = `${st.speed}×`;
  });
  $('skip-idle').addEventListener('change', (e) => {
    st.skipIdle = e.target.checked;
    if (rec) relayout();
  });
  document.addEventListener('keydown', (e) => {
    if (!rec || exporter || e.target.closest('input, button, dialog')) return;
    if (e.key === ' ') {
      e.preventDefault();
      setPlaying(!st.playing);
    } else if (e.key === 'ArrowLeft') jump(st.time - rec.total / 50);
    else if (e.key === 'ArrowRight') jump(st.time + rec.total / 50);
  });


  // --- video export -------------------------------------------------------
  //
  // Plays the recording from the start at the current speed, paints each frame
  // to a canvas and records that canvas. It runs in real time, so the export
  // takes as long as the video is.

  const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  let exporter = null;

  // The same pieces render() draws, as plain data.
  function segments() {
    const ranges = [...st.ranges].sort((a, b) => a.s - b.s);
    const cuts = new Set([0, st.text.length, st.caret]);
    for (const r of ranges) cuts.add(r.s).add(r.e);
    for (const g of st.ghosts) cuts.add(g.pos);
    const points = [...cuts].sort((a, b) => a - b);
    const out = [];
    let ri = 0;
    points.forEach((c, i) => {
      for (const g of st.ghosts) {
        if (g.pos === c) out.push({ type: 'ghost', text: g.text.length > GHOST_MAX_CHARS ? `${g.text.slice(0, GHOST_MAX_CHARS)}...` : g.text });
      }
      if (c === st.caret) out.push({ type: 'caret', text: '' });
      const next = points[i + 1];
      if (next === undefined) return;
      while (ri < ranges.length && ranges[ri].e <= c) ri++;
      const r = ranges[ri];
      const pasted = r && r.s <= c;
      out.push({
        type: pasted ? 'paste' : 'text',
        text: st.text.slice(c, next),
        label: pasted && r.s === c ? `Pasted, ${F.count(r.e - r.s)} chars` : '',
      });
    });
    return out;
  }

  function makePainter(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const color = {
      bg: v('--surface'), text: v('--text'), muted: v('--muted'), border: v('--border'),
      accent: v('--accent'), soft: v('--accent-soft'), onAccent: v('--on-accent'),
      danger: v('--danger'), dangerSoft: v('--danger-soft'),
    };
    const family = v('--font');
    const FONT = `24px ${family}`;
    const LABEL_FONT = `600 14px ${family}`;
    const LINE = 38;
    const X0 = 90;
    const X1 = W - 90;
    const Y0 = 100;
    const Y1 = H - 70;
    const rows = Math.floor((Y1 - Y0) / LINE);
    const widths = new Map();
    const measure = (font, text) => {
      const key = font + text;
      let w = widths.get(key);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width;
        if (widths.size < 50000) widths.set(key, w);
      }
      return w;
    };
    let scroll = 0; // first visible line

    return function paint() {
      // Lay the text out into lines.
      const items = [];
      let x = X0;
      let line = 0;
      let caretLine = 0;
      const newline = () => {
        x = X0;
        line++;
      };
      for (const seg of segments()) {
        if (seg.type === 'caret') {
          items.push({ type: 'caret', x, line });
          caretLine = line;
          continue;
        }
        if (seg.label) {
          const w = measure(LABEL_FONT, seg.label) + 18;
          if (x + w > X1 && x > X0) newline();
          items.push({ type: 'label', x, line, w, text: seg.label });
          x += w + 8;
        }
        for (const token of seg.text.match(/\n|[^\S\n]+|\S+/g) || []) {
          if (token === '\n') {
            newline();
            continue;
          }
          const w = measure(FONT, token);
          if (x + w > X1 && x > X0 && token.trim()) newline();
          items.push({ type: seg.type, x, line, w, text: token });
          x += w;
        }
      }
      // Keep the cursor in view.
      if (caretLine > scroll + rows - 3) scroll = caretLine - (rows - 3);
      if (caretLine < scroll) scroll = caretLine;

      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, W, H);

      // Header
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 22px ${family}`;
      ctx.fillStyle = color.text;
      let title = rec.meta.title || 'Untitled';
      while (title.length > 4 && ctx.measureText(title).width > X1 - X0 - 120) title = `${title.slice(0, -4)}...`;
      ctx.fillText(title, X0, 56);
      ctx.font = `600 16px ${family}`;
      ctx.fillStyle = color.accent;
      ctx.textAlign = 'right';
      ctx.fillText('Inkline', X1, 56);
      ctx.textAlign = 'left';
      ctx.fillStyle = color.border;
      ctx.fillRect(X0, 76, X1 - X0, 1);

      // Text
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, Y0 - 6, W, Y1 - Y0 + 12);
      ctx.clip();
      for (const it of items) {
        if (it.line < scroll || it.line > scroll + rows) continue;
        const top = Y0 + (it.line - scroll) * LINE;
        const base = top + 27;
        if (it.type === 'caret') {
          ctx.fillStyle = color.accent;
          ctx.fillRect(it.x - 1, top + 5, 2, 28);
        } else if (it.type === 'label') {
          ctx.fillStyle = color.accent;
          ctx.beginPath();
          ctx.roundRect(it.x, top + 8, it.w, 22, 11);
          ctx.fill();
          ctx.font = LABEL_FONT;
          ctx.fillStyle = color.onAccent;
          ctx.fillText(it.text, it.x + 9, top + 24);
        } else {
          if (it.type !== 'text') {
            ctx.fillStyle = it.type === 'paste' ? color.soft : color.dangerSoft;
            ctx.fillRect(it.x, top + 3, it.w, LINE - 6);
          }
          ctx.font = FONT;
          ctx.fillStyle = it.type === 'ghost' ? color.danger : color.text;
          ctx.fillText(it.text, it.x, base);
          if (it.type === 'ghost') ctx.fillRect(it.x, top + 19, it.w, 2);
        }
      }
      ctx.restore();

      // Footer: progress and time
      const done = rec.total ? st.time / rec.total : 0;
      ctx.fillStyle = color.border;
      ctx.fillRect(X0, H - 36, X1 - X0, 4);
      ctx.fillStyle = color.accent;
      ctx.fillRect(X0, H - 36, (X1 - X0) * done, 4);
      ctx.font = `14px ${family}`;
      ctx.fillStyle = color.muted;
      ctx.textAlign = 'right';
      ctx.fillText(`${st.speed}x speed`, X1, H - 46);
      ctx.textAlign = 'left';
    };
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const fileSlug = () =>
    (rec.meta.title || 'recording').replace(/[^\w\- ]+/g, '').trim().replace(/[\s-]+/g, '-').slice(0, 60) || 'recording';

  function exportVideo() {
    if (!rec) return;
    if (exporter) return exporter.cancel();
    const type = VIDEO_TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!type) return toast('This browser cannot record video');

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const paint = makePainter(canvas);
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 5000000 });
    const chunks = [];
    let finishing = false;
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const cancelled = exporter.cancelled;
      exporter = null;
      $('video').textContent = 'Export video';
      if (cancelled) return toast('Video export cancelled');
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      download(new Blob(chunks, { type: type.split(';')[0] }), `${fileSlug()}.${ext}`);
      toast(`Saved ${fileSlug()}.${ext}`);
    };
    exporter = {
      cancelled: false,
      // Called after every playback frame.
      tick() {
        paint();
        $('video').textContent = `Recording ${Math.round((st.time / rec.total) * 100)}% (cancel)`;
        if (!st.playing && !finishing) {
          finishing = true;
          // Hold the finished text for a moment before ending the video.
          const hold = setInterval(paint, 100);
          setTimeout(() => {
            clearInterval(hold);
            recorder.stop();
          }, 1500);
        }
      },
      cancel() {
        this.cancelled = true;
        finishing = true;
        setPlaying(false);
        if (recorder.state !== 'inactive') recorder.stop();
      },
    };

    setPlaying(false);
    jump(0);
    paint();
    recorder.start(1000);
    setTimeout(() => exporter && !exporter.cancelled && setPlaying(true), 400);
    toast('Recording the video. Keep this tab open until it finishes.');
  }

  $('video').addEventListener('click', exportVideo);

  $('export').addEventListener('click', async () => {
    const bytes = await store.exportFile(rec.meta.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
    const slug = (rec.meta.title || 'recording').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    a.download = `${slug || 'recording'}.inkline`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const meta = await store.importFile(new Uint8Array(await file.arrayBuffer()));
      await refreshList();
      await open(meta.id);
    } catch (err) {
      toast(err.message || 'Could not import that file');
    }
  });

  $('delete').addEventListener('click', () => {
    $('confirm-text').textContent = `“${rec.meta.title || 'Untitled'}” and its whole history will be removed from this device. This can't be undone.`;
    $('confirm').showModal();
  });
  $('confirm-no').addEventListener('click', () => $('confirm').close());
  $('confirm-yes').addEventListener('click', async () => {
    $('confirm').close();
    await store.remove(rec.meta.id);
    history.replaceState(null, '', location.pathname);
    await refreshList();
    await open(null);
  });

  // New recordings show up while the page is open.
  if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
    let timer = 0;
    chrome.storage.onChanged.addListener(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshList, 500);
    });
  }

  refreshList().then(() => {
    const wanted = decodeURIComponent(location.hash.slice(1));
    if (wanted && list.some((m) => m.id === wanted)) open(wanted);
  });
})();
