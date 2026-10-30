'use strict';
// Context compaction (F50, task-parity P1): wb shows「只保留关键上下文，目标和
// 约束最重要」— its runtime trims history so long tool-heavy tasks never drown
// the model. MyAgent used to ship the full history every call. compactHistory
// drops whole message GROUPS (assistant + its tool responses stay together —
// OpenAI-compatible APIs reject orphaned tool messages), always keeping the
// system message, the opening user goal, and the most recent groups within a
// budget fraction of maxChars, inserting an explicit marker for what was cut.

const { isImageMessage } = require('./vision');

// F59: an inline screenshot is hundreds of KB of base64 but costs the model
// about a thousand tokens — measure it at a flat rate, or one screenshot
// alone would blow the budget and compaction would drop it (and all earlier
// work) before the model ever saw it.
const IMAGE_CHAR_COST = 4000;
const IMAGE_STANDIN = 'i'.repeat(IMAGE_CHAR_COST);
const sizeReplacer = (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:image/') ? IMAGE_STANDIN : v);
function sizeOf(x) { return JSON.stringify(x, sizeReplacer).length; }
function groupSize(g) { return sizeOf(g); }

function compactHistory(history, maxChars) {
  if (sizeOf(history) <= maxChars) return false;
  const budget = Math.floor(maxChars * 0.6);
  const groups = [];
  let i = 1; // history[0] is the system message — never dropped
  while (i < history.length) {
    const m = history[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const g = [m];
      i++;
      while (i < history.length && history[i].role === 'tool') { g.push(history[i]); i++; }
      // F59 screenshots that follow a tool batch belong to that group
      while (i < history.length && isImageMessage(history[i])) { g.push(history[i]); i++; }
      groups.push(g);
    } else {
      groups.push([m]);
      i++;
    }
  }
  const goal = groups.shift(); // the opening user goal — always kept
  const kept = [];
  let used = groupSize(goal);
  for (let k = groups.length - 1; k >= 0; k--) {
    const s = groupSize(groups[k]);
    if (used + s > budget) break;
    used += s;
    kept.unshift(groups[k]);
  }
  const dropped = groups.length - kept.length;
  const out = [history[0], ...goal];
  if (dropped > 0) {
    out.push({ role: 'user', content: '[context compacted: ' + dropped
      + ' earlier message groups omitted to stay within budget; the goal and recent work remain]' });
  }
  for (const g of kept) out.push(...g);
  history.length = 0;
  history.push(...out);
  return true;
}

module.exports = { compactHistory, IMAGE_CHAR_COST };
