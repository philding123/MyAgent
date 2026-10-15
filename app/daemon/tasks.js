'use strict';
// F40 scheduled tasks (design/34): persistent schedules in the settings KV
// (tasks.schedule.<id>), a 1s tick loop, and an injected runSchedule callback
// so tests can drive ticks without the engine.

function createScheduler({ store, runSchedule, tickMs = 1000 }) {
  let timer = null;
  const PREFIX = 'tasks.schedule.';
  const all = () => Object.entries(store.allSettings())
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => { try { return JSON.parse(v); } catch { return null; } })
    .filter((t) => t && !t.deleted);
  const save = (t) => store.setSetting(PREFIX + t.id, JSON.stringify(t));

  return {
    create({ name, prompt, intervalMs, sessionId }) {
      if (!name || !prompt || !(intervalMs > 0)) throw new Error('name/prompt/intervalMs required');
      const t = { id: 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name, prompt, intervalMs, sessionId: sessionId || null, enabled: true,
        nextAt: Date.now() + intervalMs };
      save(t);
      return t;
    },
    list() { return all().sort((a, b) => a.nextAt - b.nextAt); },
    remove(id) { const t = all().find((x) => x.id === id); if (t) { t.deleted = true; save(t); } return true; },
    toggle(id, enabled) { const t = all().find((x) => x.id === id); if (!t) return null; t.enabled = !!enabled; save(t); return t; },
    start() {
      if (timer) return;
      timer = setInterval(async () => {
        const now = Date.now();
        for (const t of all()) {
          if (!t.enabled || now < (t.nextAt || 0)) continue;
          t.nextAt = now + t.intervalMs;
          save(t);
          try { await runSchedule(t); } catch (_) {}
        }
      }, tickMs);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}

module.exports = { createScheduler };
