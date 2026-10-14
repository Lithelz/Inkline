// Playback timing and stats. Recordings keep raw times; idle gaps are only
// squeezed here, when a recording is played back or summarised.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  const IDLE_THRESHOLD_MS = 3000;
  const IDLE_TARGET_MS = 500;
  const SESSION_GAP_MS = 1000;
  const TAIL_MS = 400;

  // Rebase a sorted list of times so every gap over `threshold` becomes `target`.
  function compressGaps(times, threshold = IDLE_THRESHOLD_MS, target = IDLE_TARGET_MS) {
    const out = [];
    let acc = 0;
    for (let i = 0; i < times.length; i++) {
      if (i) {
        const gap = times[i] - times[i - 1];
        acc += gap > threshold ? target : Math.max(0, gap);
      }
      out.push(acc);
    }
    return out;
  }

  // Expand ops into single playback steps. Merged typing runs become one step
  // per character, spaced evenly over the run; merged deletes play back as
  // backspaces.
  function buildAtoms(sessions) {
    const atoms = [];
    sessions.forEach((session, s) => {
      for (const op of session.ops) {
        const flags = { s, paste: op.op === 'paste', sync: !!op.sync };
        if (op.op === 'delete') {
          if (op.d && op.len > 1) {
            for (let i = 0; i < op.len; i++) {
              atoms.push({ ...flags, t: op.t + (op.d * i) / (op.len - 1), del: true, pos: op.pos + op.len - 1 - i, len: 1 });
            }
          } else atoms.push({ ...flags, t: op.t, del: true, pos: op.pos, len: op.len });
        } else if (op.d && op.text.length > 1) {
          const chars = Array.from(op.text);
          let pos = op.pos;
          chars.forEach((ch, i) => {
            atoms.push({ ...flags, t: op.t + (op.d * i) / (chars.length - 1), del: false, pos, text: ch });
            pos += ch.length;
          });
        } else atoms.push({ ...flags, t: op.t, del: false, pos: op.pos, text: op.text });
      }
    });
    return atoms;
  }

  // Playback time of every atom. Sessions are always butted together; gaps
  // inside a session are squeezed only when skipIdle is on.
  function layoutTimes(atoms, { skipIdle = true } = {}) {
    const times = new Float64Array(atoms.length);
    let acc = 0;
    for (let i = 1; i < atoms.length; i++) {
      const prev = atoms[i - 1];
      const cur = atoms[i];
      if (cur.s !== prev.s) acc += skipIdle ? IDLE_TARGET_MS : SESSION_GAP_MS;
      else {
        const gap = Math.max(0, cur.t - prev.t);
        acc += skipIdle && gap > IDLE_THRESHOLD_MS ? IDLE_TARGET_MS : gap;
      }
      times[i] = acc;
    }
    return { times, total: atoms.length ? acc + TAIL_MS : 0 };
  }

  function sessionStats(ops) {
    const stats = { ops: ops.length, typed: 0, pasted: 0, deleted: 0, synced: 0, active: 0, span: 0 };
    ops.forEach((op, i) => {
      if (op.sync) stats.synced += I.opSize(op);
      else if (op.op === 'delete') stats.deleted += op.len;
      else if (op.op === 'paste') stats.pasted += op.text.length;
      else stats.typed += op.text.length;
      stats.active += op.d || 0;
      const next = ops[i + 1];
      if (next) {
        const gap = next.t - I.opEnd(op);
        if (gap > 0 && gap <= IDLE_THRESHOLD_MS) stats.active += gap;
      }
    });
    if (ops.length) stats.span = I.opEnd(ops[ops.length - 1]) - ops[0].t;
    return stats;
  }

  function totalStats(summaries) {
    const total = { sessions: summaries.length, ops: 0, typed: 0, pasted: 0, deleted: 0, synced: 0, active: 0, span: 0, bytes: 0 };
    for (const s of summaries) for (const k of Object.keys(total)) if (k !== 'sessions') total[k] += s[k] || 0;
    return total;
  }

  Object.assign(I, {
    IDLE_THRESHOLD_MS,
    IDLE_TARGET_MS,
    compressGaps,
    buildAtoms,
    layoutTimes,
    sessionStats,
    totalStats,
  });
})();
