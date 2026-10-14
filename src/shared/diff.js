// Small text diff: trims the common prefix/suffix, then runs a word-level
// Myers diff on what is left. Returns untimed ops that turn `a` into `b` when
// applied in order.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});

  const MAX_TOKENS = 6000;
  const MAX_EDITS = 400;

  function commonPrefix(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  function commonSuffix(a, b, max) {
    let i = 0;
    while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
    return i;
  }

  const tokenize = (s) => s.match(/\s+|[\w\u00c0-\uffff]+|[^\s\w\u00c0-\uffff]/g) || [];

  // Returns an edit script (0 keep, -1 drop from a, 1 take from b), one entry
  // per token, or null if the inputs differ by more than maxD edits.
  function myers(a, b, maxD) {
    const N = a.length;
    const M = b.length;
    const off = N + M + 1;
    const v = new Int32Array(2 * off + 1);
    const trace = [];
    let found = false;
    for (let d = 0; d <= N + M && !found; d++) {
      if (d > maxD) return null;
      const lo = off - d - 1;
      trace.push({ lo, row: v.slice(lo, off + d + 2) });
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= N && y >= M) {
          found = true;
          break;
        }
      }
    }
    const script = [];
    let x = N;
    let y = M;
    for (let d = trace.length - 1; d >= 0; d--) {
      const { lo, row } = trace[d];
      const at = (k) => row[off + k - lo];
      const k = x - y;
      const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const prevX = at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        script.push(0);
        x--;
        y--;
      }
      if (d > 0) {
        if (x === prevX) {
          script.push(1);
          y--;
        } else {
          script.push(-1);
          x--;
        }
      }
    }
    return script.reverse();
  }

  function diffOps(a, b) {
    if (a === b) return [];
    const p = commonPrefix(a, b);
    const s = commonSuffix(a, b, Math.min(a.length, b.length) - p);
    const midA = a.slice(p, a.length - s);
    const midB = b.slice(p, b.length - s);

    const ops = [];
    let pos = p;
    const del = (n) => {
      const last = ops[ops.length - 1];
      if (last && last.op === 'delete' && last.pos === pos) last.len += n;
      else ops.push({ op: 'delete', pos, len: n });
    };
    const ins = (text) => {
      const last = ops[ops.length - 1];
      if (last && last.op === 'insert' && last.pos + last.text.length === pos) last.text += text;
      else ops.push({ op: 'insert', pos, text });
      pos += text.length;
    };

    let script = null;
    let ta, tb;
    if (midA && midB) {
      ta = tokenize(midA);
      tb = tokenize(midB);
      if (ta.length + tb.length <= MAX_TOKENS) script = myers(ta, tb, MAX_EDITS);
    }
    if (!script) {
      if (midA) del(midA.length);
      if (midB) ins(midB);
      return ops;
    }
    let ia = 0;
    let ib = 0;
    for (const step of script) {
      if (step === 0) {
        pos += ta[ia].length;
        ia++;
        ib++;
      } else if (step < 0) del(ta[ia++].length);
      else ins(tb[ib++]);
    }
    return ops;
  }

  Object.assign(I, { commonPrefix, commonSuffix, diffOps });
})();
