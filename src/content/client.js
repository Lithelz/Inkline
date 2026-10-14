// Content-script side of a recording: stamps ops with session-relative time,
// buffers them, and hands them to the service worker to be stored.
(function () {
  const I = (globalThis.Inkline = globalThis.Inkline || {});
  if (I.RecClient) return;

  const FLUSH_MS = 5000;
  const NEW_SESSION_AFTER_MS = 30 * 60 * 1000;

  class RecClient {
    // info() returns the current { kind, title, url, host } for the recording.
    constructor({ id, info, onActivity }) {
      this.id = id;
      this.info = info;
      this.onActivity = onActivity;
      this.buffer = [];
      this.start = 0;
      this.last = 0;
      this.dead = false;
      // Counters for the popup's status readout.
      this.sent = 0;
      this.saved = 0;
      this.error = '';
      this.onResult = null;
      // Set while the caller still holds unsent ops timed against this session.
      this.hold = false;
      this.flush = this.flush.bind(this);
      this.onVisibility = () => document.hidden && this.flush();
      this.timer = setInterval(this.flush, FLUSH_MS);
      window.addEventListener('pagehide', this.flush);
      document.addEventListener('visibilitychange', this.onVisibility);
    }

    send(message) {
      if (this.dead) return Promise.resolve(null);
      try {
        return chrome.runtime.sendMessage(message);
      } catch (err) {
        // The extension was reloaded or removed underneath this page.
        this.close();
        return Promise.resolve(null);
      }
    }

    // The text this recording currently ends on ('' for a new recording).
    async open() {
      const res = await this.send({ type: 'inkline:open', id: this.id }).catch((err) => {
        this.error = `open: ${(err && err.message) || err}`;
        return null;
      });
      if (!res && !this.error) this.error = 'open: no reply from the service worker';
      return (res && res.text) || '';
    }

    // ms since session start. Starts a session on first use and a new one
    // after a long break.
    now() {
      const now = Date.now();
      if (!this.start || (!this.hold && now - this.last > NEW_SESSION_AFTER_MS)) {
        this.flush();
        this.start = now;
      }
      this.last = now;
      return now - this.start;
    }

    add(op) {
      if (this.dead) return;
      I.appendOp(this.buffer, op);
      if (this.onActivity) this.onActivity();
    }

    flush() {
      if (!this.buffer.length || this.dead) return;
      const ops = this.buffer;
      const start = this.start;
      this.buffer = [];
      this.sent += ops.length;
      this.send({ type: 'inkline:append', id: this.id, info: this.info(), start, ops })
        .then((res) => {
          if (!res || !res.ok) throw new Error((res && res.error) || 'no reply from the service worker');
          this.saved += ops.length;
          this.error = '';
        })
        .catch((err) => {
          this.error = `save: ${(err && err.message) || err}`;
          if (!this.dead && this.start === start) {
            this.sent -= ops.length;
            this.buffer = ops.concat(this.buffer);
          }
        })
        .then(() => this.onResult && this.onResult());
    }

    close() {
      this.flush();
      this.dead = true;
      clearInterval(this.timer);
      window.removeEventListener('pagehide', this.flush);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  I.RecClient = RecClient;
})();
