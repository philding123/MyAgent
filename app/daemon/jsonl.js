'use strict';
// JSON-Lines codec for engine stdio (design 01-architecture §2).
// Node IPC (main<->daemon) already transports objects natively; the wire codec
// is only needed for the engine subprocess boundary.

class JsonlCodec {
  constructor() { this.buf = ''; }
  static encode(obj) { return JSON.stringify(obj) + '\n'; }
  push(chunk) {
    this.buf += chunk.toString('utf8');
    const out = [];
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); }
      catch (e) { out.push({ type: 'error', message: 'bad frame: ' + e.message }); }
    }
    return out;
  }
}

module.exports = { JsonlCodec };
