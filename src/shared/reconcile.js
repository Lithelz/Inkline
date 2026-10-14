// Drift correction for editors whose cursor we can only estimate (Google Docs).
//
// `ops` are provisional: derived from key events, with guessed positions, on
// top of a text (`base`) that is known to be right. `snapshot` is the real text
// afterwards. The result is a list of ops that takes base to snapshot exactly,
// keeping as much of the original keystroke timing as possible:
//
//   match  the guess was right, ops are returned untouched
//   shift  right keystrokes, wrong place: every op moved by one offset
//   diff   anything else: ops rebuilt from a diff, spread over the same time span
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  const SHIFT_WINDOW = 64;

  const endCursor = (ops) => {
    const last = ops[ops.length - 1];
    if (!last) return null;
    return last.op === 'delete' ? last.pos : last.pos + last.text.length;
  };

  function reconcile({ base, ops, snapshot, now = 0, external = false }) {
    if (I.applyStrict(base, ops) === snapshot) return { method: 'match', ops, cursor: null };

    const lengthDelta = ops.reduce((n, op) => n + (op.op === 'delete' ? -op.len : op.text.length), 0);
    if (ops.length && base.length + lengthDelta === snapshot.length) {
      const firstChange = I.commonPrefix(base, snapshot);
      const leftmost = Math.min(...ops.map((op) => op.pos));
      for (let back = 0; back <= SHIFT_WINDOW; back++) {
        const shift = firstChange - back - leftmost;
        if (!shift) continue;
        const moved = ops.map((op) => ({ ...op, pos: op.pos + shift }));
        if (I.applyStrict(base, moved) === snapshot) return { method: 'shift', ops: moved, cursor: endCursor(moved) };
      }
    }

    const diff = I.diffOps(base, snapshot);
    const t0 = ops.length ? ops[0].t : now;
    const span = ops.length ? Math.max(0, I.opEnd(ops[ops.length - 1]) - t0) : 0;
    const total = diff.reduce((n, op) => n + I.opSize(op), 0) || 1;
    const hadPaste = ops.some((op) => op.op === 'paste');
    let done = 0;
    const rebuilt = diff.map((op) => {
      const size = I.opSize(op);
      const out = { ...op, t: Math.round(t0 + (span * done) / total) };
      done += size;
      if (external) out.sync = true;
      else if (op.op === 'insert' && hadPaste && I.insertKind(op.text) === 'paste') out.op = 'paste';
      else if (size > 1 && span > 0) out.d = Math.round((span * size) / total);
      return out;
    });
    return { method: 'diff', ops: rebuilt, cursor: endCursor(rebuilt) };
  }

  I.reconcile = reconcile;
})();
