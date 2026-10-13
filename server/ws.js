/* =====================================================================
   مدير اشتراكات WebSocket (تيّارٌ مركّب) مع إعادة اتصالٍ تلقائية.

   - كل اتصالٍ يحمل حتى `perConn` تيّاراً (بايننس تسمح بـ1024).
   - مراقبُ صمت: إن لم تصل رسالةٌ خلال `silenceMs` يُغلَق الاتصال
     ويُعاد فتحه (اتصالٌ «حيّ» صامت أخطر من اتصالٍ مقطوع).
   - عند كل إعادة اتصالٍ يُستدعى onReconnect لترقيع الشموع الفائتة.
   - المضيفات تتناوب عند الفشل المتكرّر.
   ===================================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class StreamGroup {
  /**
   * @param {object} o
   * @param {string[]} o.hosts   مضيفات wss
   * @param {string[]} o.streams أسماء التيّارات (مثل btcusdt@kline_15m)
   * @param {(msg:any, connIdx:number)=>void} o.onMessage
   * @param {(connIdx:number, streams:string[])=>void} [o.onReconnect]
   * @param {(s:object)=>void} [o.onStatus]
   */
  constructor({ hosts, streams, onMessage, onReconnect, onStatus, perConn = 200, silenceMs = 45000, name = "ws" }) {
    this.hosts = hosts; this.streams = streams; this.onMessage = onMessage;
    this.onReconnect = onReconnect; this.onStatus = onStatus;
    this.perConn = perConn; this.silenceMs = silenceMs; this.name = name;
    this.conns = [];
    this.stopped = false;
  }

  start() {
    const chunks = [];
    for (let i = 0; i < this.streams.length; i += this.perConn) chunks.push(this.streams.slice(i, i + this.perConn));
    this.conns = chunks.map((streams, idx) => ({
      idx, streams, ws: null, state: "idle", lastMsgAt: 0, openedAt: 0, attempts: 0, hostIdx: 0, msgs: 0, reconnects: 0
    }));
    for (const c of this.conns) this._open(c);
    this._watch = setInterval(() => this._watchdog(), 10000);
    this._watch.unref?.();
  }

  stop() {
    this.stopped = true;
    clearInterval(this._watch);
    for (const c of this.conns) { try { c.ws?.close(); } catch { /* */ } }
  }

  status() {
    return {
      name: this.name,
      connections: this.conns.length,
      streams: this.streams.length,
      open: this.conns.filter(c => c.state === "open").length,
      lastMsgAt: Math.max(0, ...this.conns.map(c => c.lastMsgAt)),
      reconnects: this.conns.reduce((a, c) => a + c.reconnects, 0),
      messages: this.conns.reduce((a, c) => a + c.msgs, 0)
    };
  }

  _open(c) {
    if (this.stopped) return;
    const host = this.hosts[c.hostIdx % this.hosts.length];
    const url = `${host}/stream?streams=${c.streams.join("/")}`;
    c.state = "connecting";
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this._retry(c); }
    c.ws = ws;
    ws.addEventListener("open", () => {
      c.state = "open"; c.openedAt = Date.now(); c.lastMsgAt = Date.now();
      const wasRetry = c.attempts > 0 || c.reconnects > 0;
      c.attempts = 0;
      if (wasRetry && this.onReconnect) {
        try { this.onReconnect(c.idx, c.streams); } catch { /* */ }
      }
      this.onStatus?.(this.status());
    });
    ws.addEventListener("message", ev => {
      c.lastMsgAt = Date.now(); c.msgs++;
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { return; }
      if (msg && msg.data) this.onMessage(msg, c.idx);
    });
    const onGone = () => {
      if (c.ws !== ws) return;
      c.state = "closed";
      this._retry(c);
    };
    ws.addEventListener("close", onGone);
    ws.addEventListener("error", onGone);
  }

  async _retry(c) {
    if (this.stopped || c.retrying) return;
    c.retrying = true;
    c.attempts++; c.reconnects++;
    if (c.attempts % 3 === 0) c.hostIdx++;
    const delay = Math.min(30000, 500 * 2 ** Math.min(c.attempts, 6)) + Math.random() * 400;
    this.onStatus?.(this.status());
    await sleep(delay);
    c.retrying = false;
    this._open(c);
  }

  _watchdog() {
    const now = Date.now();
    for (const c of this.conns) {
      if (c.state === "open" && now - c.lastMsgAt > this.silenceMs) {
        try { c.ws.close(); } catch { /* */ }
        c.state = "closed";
        this._retry(c);
      }
      /* الاتصالات تُجدَّد قبل حدّ 24 ساعة بمدّةٍ آمنة */
      if (c.state === "open" && now - c.openedAt > 23.5 * 3600e3) {
        try { c.ws.close(); } catch { /* */ }
        c.state = "closed";
        this._retry(c);
      }
    }
  }
}
