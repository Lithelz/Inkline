// gzip + the on-disk shapes: one compressed chunk per session, and the
// .inkline export file (a whole recording in one gzip'd JSON document).
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  const FORMAT = 'inkline';
  const VERSION = 1;

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  const gzip = (text) => pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
  const gunzip = async (bytes) => new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));

  const packSession = (session) => gzip(JSON.stringify({ v: VERSION, start: session.start, ops: I.encodeOps(session.ops) }));

  async function unpackSession(bytes) {
    const data = JSON.parse(await gunzip(bytes));
    return { start: data.start, ops: I.decodeOps(data.ops) };
  }

  function packFile(meta, sessions) {
    const { id, kind, title, url, host, created, updated } = meta;
    return gzip(
      JSON.stringify({
        format: FORMAT,
        v: VERSION,
        meta: { id, kind, title, url, host, created, updated },
        sessions: sessions.map((s) => ({ start: s.start, ops: I.encodeOps(s.ops) })),
      })
    );
  }

  async function unpackFile(bytes) {
    let data;
    try {
      data = JSON.parse(await gunzip(bytes));
    } catch {
      throw new Error('Not a valid .inkline file');
    }
    if (!data || data.format !== FORMAT || !data.meta || !Array.isArray(data.sessions)) throw new Error('Not a valid .inkline file');
    if (data.v > VERSION) throw new Error('This file was made by a newer version of Inkline');
    return {
      meta: data.meta,
      sessions: data.sessions.map((s) => ({ start: Number(s.start) || 0, ops: I.decodeOps(s.ops) })),
    };
  }

  Object.assign(I, { gzip, gunzip, packSession, unpackSession, packFile, unpackFile });
})();
