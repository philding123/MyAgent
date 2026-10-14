'use strict';
// Browser tool (F22). Provider-neutral action protocol over one CDP-driven
// page (WorkBuddy @genie/workbuddy-browser-use equivalent): navigate/content/
// snapshot/screenshot are read-kind; click/fill/press/scroll are exec-kind so
// the F07 mode policy gates them. `ref` targets only come from this session's
// latest snapshot — no arbitrary selectors cross the boundary.

const ACTION_KINDS = {
  navigate: 'read', content: 'read', snapshot: 'read', screenshot: 'read', close: 'read',
  click: 'exec', fill: 'exec', press: 'exec', scroll: 'exec',
};

const MAX_SNAPSHOT = 80;
const NAV_TIMEOUT_MS = 30000;

function makeBrowserSession(opts = {}) {
  // opts.playwright: injected playwright-core (tests); resolved lazily otherwise.
  let pw = opts.playwright || null;
  let browser = null;
  let page = null;
  let lastRefs = [];

  async function ensurePage() {
    if (page) return page;
    if (!pw) {
      try { pw = require('playwright-core'); } catch (e) {
        throw new Error('playwright-core unavailable: ' + e.message);
      }
      const { findBrowserExecutable } = require('../../shared/browser-probe');
      const found = findBrowserExecutable();
      if (!found.executablePath) throw new Error('no system browser found (Edge/Chrome)');
      browser = await pw.chromium.launch({
        headless: true,
        ...(found.channel ? { channel: found.channel } : { executablePath: found.executablePath }),
      });
    } else {
      browser = await pw.chromium.launch({ headless: true });
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    return page;
  }

  async function snapshotRefs() {
    const p = await ensurePage();
    const items = await p.evaluate(() => {
      const nodes = document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[onclick]');
      const out = [];
      for (const el of nodes) {
        if (out.length >= 120) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        out.push({
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') ||
            el.getAttribute('value') || '').trim().slice(0, 80),
          selectorHint: el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (el.getAttribute('name') ? '[name="' + el.getAttribute('name') + '"]' : ''),
        });
      }
      return out;
    });
    lastRefs = items.slice(0, MAX_SNAPSHOT).map((it, i) => ({ ref: 'r' + (i + 1), ...it }));
    return lastRefs;
  }

  function resolveRef(ref) {
    const hit = lastRefs.find((r) => r.ref === ref);
    if (!hit) throw new Error('unknown ref: ' + ref + ' (run snapshot first)');
    return hit.selectorHint;
  }

  async function run(args) {
    const action = args.action;
    if (action === 'close') {
      if (browser) { try { await browser.close(); } catch (_) {} }
      browser = null; page = null; lastRefs = [];
      return { ok: true, summary: 'browser closed' };
    }
    // ref validation happens before any launch (fail fast on stale/foreign refs)
    let targetSel = null;
    if (action === 'click' || action === 'fill') targetSel = resolveRef(args.ref);
    const p = await ensurePage();
    switch (action) {
      case 'navigate': {
        if (!args.url || !/^https?:\/\//i.test(args.url)) return { ok: false, summary: 'navigate needs http(s) url' };
        await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        return { ok: true, summary: 'navigated: ' + (await p.title()) + ' — ' + p.url() };
      }
      case 'content': {
        const text = args.selector
          ? await p.evaluate((sel) => (document.querySelector(sel) || {}).textContent || '', args.selector)
          : await p.evaluate(() => document.body.innerText);
        return { ok: true, summary: 'content ' + String(text).length + ' chars', data: { content: String(text).slice(0, 20000) } };
      }
      case 'snapshot': {
        const refs = await snapshotRefs();
        return { ok: true, summary: refs.length + ' interactive elements', data: { refs } };
      }
      case 'screenshot': {
        const buf = await p.screenshot({ type: 'png' });
        return { ok: true, summary: 'screenshot ' + buf.length + 'B', data: { png_base64: buf.toString('base64') } };
      }
      case 'click': {
        await p.click(resolveRef(args.ref), { timeout: NAV_TIMEOUT_MS });
        await p.waitForTimeout(300);
        const refs = await snapshotRefs();
        return { ok: true, summary: 'clicked ' + args.ref, data: { refs } };
      }
      case 'fill': {
        await p.fill(resolveRef(args.ref), String(args.value ?? ''), { timeout: NAV_TIMEOUT_MS });
        return { ok: true, summary: 'filled ' + args.ref };
      }
      case 'press': {
        await p.keyboard.press(String(args.key || 'Enter'));
        return { ok: true, summary: 'pressed ' + args.key };
      }
      case 'scroll': {
        await p.evaluate((dy) => window.scrollBy(0, dy), Number(args.dy || 300));
        return { ok: true, summary: 'scrolled ' + (args.dy || 300) };
      }
      default:
        return { ok: false, summary: 'unknown action: ' + action + ' (valid: ' + Object.keys(ACTION_KINDS).join(',') + ')' };
    }
  }

  async function dispose() {
    try { if (browser) await browser.close(); } catch (_) {}
    browser = null; page = null; lastRefs = [];
  }

  return { run, dispose, ACTION_KINDS };
}

function browserToolDefinition(session) {
  return {
    kind: 'read', // ask-mode may navigate/read; exec actions re-classified via kindOf
    kindOf: (args) => ACTION_KINDS[args.action] || 'read',
    description: 'Drive a headless browser. Actions: navigate{url} content[selector] snapshot screenshot click{ref} fill{ref,value} press{key} scroll{dy} close. click/fill/press/scroll are state-changing (policy-gated); refs come from snapshot.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.keys(ACTION_KINDS) },
        url: { type: 'string' }, selector: { type: 'string' },
        ref: { type: 'string' }, value: { type: 'string' }, key: { type: 'string' },
        dy: { type: 'number' },
      },
      required: ['action'],
    },
    run: async (args) => {
      try {
        return await session.run(args);
      } catch (e) {
        return { ok: false, summary: 'browser ' + args.action + ' failed: ' + String(e && e.message || e) };
      }
    },
  };
}

module.exports = { makeBrowserSession, browserToolDefinition, ACTION_KINDS };
