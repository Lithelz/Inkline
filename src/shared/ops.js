// Text delta ops: the only thing Inkline ever records.
//
//   { t, op: 'insert' | 'paste', pos, text, d?, sync? }
//   { t, op: 'delete',           pos, len,  d?, sync? }
//
// t    ms since session start
// d    duration of a merged typing/backspace run (last keystroke - first)
// sync change that was not typed here (text that already existed, edits made
//      elsewhere); found by diffing, so it has no real keystroke timing
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  const MERGE_WINDOW_MS = 1500;
  const PASTE_MIN_CHARS = 40;

  const opEnd = (op) => op.t + (op.d || 0);
  const opSize = (op) => (op.op === 'delete' ? op.len : op.text.length);
  const insertKind = (text) => (text.length > PASTE_MIN_CHARS ? 'paste' : 'insert');

  function applyOp(text, op) {
    const pos = Math.min(Math.max(op.pos, 0), text.length);
    if (op.op === 'delete') return text.slice(0, pos) + text.slice(pos + op.len);
    return text.slice(0, pos) + op.text + text.slice(pos);
  }

  function applyOps(text, ops) {
    for (const op of ops) text = applyOp(text, op);
    return text;
  }

  // Like applyOps, but returns null if any op falls outside the text.
  function applyStrict(text, ops) {
    for (const op of ops) {
      if (op.pos < 0 || op.pos > text.length) return null;
      if (op.op === 'delete' && op.pos + op.len > text.length) return null;
      text = applyOp(text, op);
    }
    return text;
  }

  // A single keystroke, or a run of them that has already been merged.
  const isRun = (op) => !op.sync && op.op !== 'paste' && (opSize(op) === 1 || op.d !== undefined);

  // Append op to ops, folding adjacent keystrokes typed within the merge
  // window into the previous op. Mutates and returns ops.
  function appendOp(ops, op) {
    const last = ops[ops.length - 1];
    const gap = last ? op.t - opEnd(last) : Infinity;
    if (last && last.op === op.op && isRun(last) && isRun(op) && gap >= 0 && gap <= MERGE_WINDOW_MS) {
      if (op.op === 'insert' && op.pos === last.pos + last.text.length) {
        last.text += op.text;
        last.d = opEnd(op) - last.t;
        return ops;
      }
      // Backspace run moves left; forward-delete run stays put.
      if (op.op === 'delete' && (op.pos + op.len === last.pos || op.pos === last.pos)) {
        last.pos = op.pos;
        last.len += op.len;
        last.d = opEnd(op) - last.t;
        return ops;
      }
    }
    ops.push({ ...op });
    return ops;
  }

  function mergeOps(ops) {
    const out = [];
    for (const op of ops) appendOp(out, op);
    return out;
  }

  // Stored form: [dt, code, pos, payload, d?] with dt relative to the previous op.
  const SYNC_BIT = 4;
  const CODES = { insert: 0, delete: 1, paste: 2 };
  const NAMES = ['insert', 'delete', 'paste'];

  function encodeOps(ops) {
    let prev = 0;
    return ops.map((op) => {
      const t = Math.max(Math.round(op.t), prev);
      const row = [t - prev, CODES[op.op] + (op.sync ? SYNC_BIT : 0), op.pos, op.op === 'delete' ? op.len : op.text];
      if (op.d > 0) row.push(Math.round(op.d));
      prev = t;
      return row;
    });
  }

  function decodeOps(rows) {
    let t = 0;
    return rows.map(([dt, code, pos, payload, d]) => {
      t += dt;
      const name = NAMES[code & 3];
      const op = { t, op: name, pos };
      if (name === 'delete') op.len = payload;
      else op.text = payload;
      if (d !== undefined) op.d = d;
      if (code & SYNC_BIT) op.sync = true;
      return op;
    });
  }

  Object.assign(I, {
    MERGE_WINDOW_MS,
    PASTE_MIN_CHARS,
    opEnd,
    opSize,
    insertKind,
    applyOp,
    applyOps,
    applyStrict,
    appendOp,
    mergeOps,
    encodeOps,
    decodeOps,
  });
})();
