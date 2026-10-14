// Recording storage. Small per-recording metadata lives in chrome.storage.local
// (so the popup and player can list recordings without touching the data);
// the gzip'd session chunks live in IndexedDB.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  function memoryKV() {
    const map = new Map();
    return {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      del: async (k) => void map.delete(k),
      values: async () => [...map.values()],
    };
  }

  const dbs = new Map();
  function openDb(name) {
    if (!dbs.has(name)) {
      dbs.set(
        name,
        new Promise((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('meta');
            req.result.createObjectStore('chunks');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
      );
    }
    return dbs.get(name);
  }

  function idbKV(dbName, storeName) {
    const run = async (mode, fn) => {
      const db = await openDb(dbName);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    };
    return {
      get: (k) => run('readonly', (s) => s.get(k)),
      put: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      values: () => run('readonly', (s) => s.getAll()),
    };
  }

  function chromeKV(prefix) {
    const area = chrome.storage.local;
    return {
      get: async (k) => (await area.get(prefix + k))[prefix + k],
      put: (k, v) => area.set({ [prefix + k]: v }),
      del: (k) => area.remove(prefix + k),
      values: async () =>
        Object.entries(await area.get(null))
          .filter(([k]) => k.startsWith(prefix))
          .map(([, v]) => v),
    };
  }

  const chunkKey = (id, start) => `${id}\n${start}`;

  class Store {
    constructor({ meta, chunks }) {
      this.meta = meta;
      this.chunks = chunks;
      this.queue = Promise.resolve();
    }

    // Writes run one at a time so two flushes can't interleave on one chunk.
    serial(fn) {
      const run = this.queue.then(fn);
      this.queue = run.catch(() => {});
      return run;
    }

    async list() {
      const all = await this.meta.values();
      return all.sort((a, b) => b.updated - a.updated);
    }

    getMeta(id) {
      return this.meta.get(id);
    }

    async get(id) {
      const meta = await this.meta.get(id);
      if (!meta) return null;
      const sessions = [];
      for (const s of meta.sessions) {
        const bytes = await this.chunks.get(chunkKey(id, s.start));
        if (bytes) sessions.push(await I.unpackSession(bytes));
      }
      return { meta, sessions };
    }

    // The text a recording ends on, rebuilt by replaying every op.
    async getText(id) {
      const rec = await this.get(id);
      let text = '';
      if (rec) for (const s of rec.sessions) text = I.applyOps(text, s.ops);
      return text;
    }

    async writeSession(meta, session) {
      const bytes = await I.packSession(session);
      await this.chunks.put(chunkKey(meta.id, session.start), bytes);
      const summary = { start: session.start, bytes: bytes.byteLength, ...I.sessionStats(session.ops) };
      meta.sessions = meta.sessions.filter((s) => s.start !== session.start).concat(summary);
      meta.sessions.sort((a, b) => a.start - b.start);
      meta.bytes = meta.sessions.reduce((n, s) => n + s.bytes, 0);
    }

    // Append ops to one session of a recording, creating either as needed.
    append(id, info, start, ops) {
      return this.serial(async () => {
        const now = Date.now();
        const meta = (await this.meta.get(id)) || { id, created: now, sessions: [] };
        for (const k of ['kind', 'title', 'url', 'host']) if (info && info[k]) meta[k] = info[k];
        const bytes = await this.chunks.get(chunkKey(id, start));
        const session = bytes ? await I.unpackSession(bytes) : { start, ops: [] };
        let floor = session.ops.length ? session.ops[session.ops.length - 1].t : 0;
        for (const op of ops) {
          floor = Math.max(floor, op.t);
          I.appendOp(session.ops, { ...op, t: floor });
        }
        await this.writeSession(meta, session);
        meta.updated = now;
        await this.meta.put(id, meta);
        return meta;
      });
    }

    remove(id) {
      return this.serial(async () => {
        const meta = await this.meta.get(id);
        if (!meta) return;
        for (const s of meta.sessions) await this.chunks.del(chunkKey(id, s.start));
        await this.meta.del(id);
      });
    }

    async exportFile(id) {
      const rec = await this.get(id);
      if (!rec) throw new Error('Recording not found');
      return I.packFile(rec.meta, rec.sessions);
    }

    // Imports never overwrite: a clashing id is stored as a separate copy.
    importFile(bytes) {
      return this.serial(async () => {
        const file = await I.unpackFile(bytes);
        const now = Date.now();
        let id = String(file.meta.id || `import:${now}`);
        if (await this.meta.get(id)) id = `${id}~${now.toString(36)}`;
        const meta = { ...file.meta, id, created: file.meta.created || now, updated: file.meta.updated || now, sessions: [] };
        for (const session of file.sessions) await this.writeSession(meta, session);
        await this.meta.put(id, meta);
        return meta;
      });
    }
  }

  function openStore() {
    const inExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    return new Store({
      meta: inExtension ? chromeKV('rec:') : idbKV('inkline', 'meta'),
      chunks: idbKV('inkline', 'chunks'),
    });
  }

  Object.assign(I, { Store, memoryKV, openStore });
})();
