'use strict';
// T42 (unit): context compaction (F50) — group integrity, budget, marker.
const test = require('node:test');
const assert = require('node:assert');
const { compactHistory } = require('../../app/engine/compact');

function buildHistory(groups, groupChars) {
  const h = [
    { role: 'system', content: 'sys prompt' },
    { role: 'user', content: '调研 REA skill 并交付 html 报告' },
  ];
  for (let i = 0; i < groups; i++) {
    h.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, type: 'function',
      function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://x/' + i }) } }] });
    h.push({ role: 'tool', tool_call_id: 'c' + i, content: 'd'.repeat(groupChars) });
  }
  h.push({ role: 'assistant', content: 'final answer' });
  return h;
}

test('T42 small history is untouched', () => {
  const h = buildHistory(2, 100);
  assert.strictEqual(compactHistory(h, 100000), false);
  assert.strictEqual(h.length, 7); // sys + goal + 2×(assistant+tool) + final
});

test('T42 compaction keeps system+goal+recent groups with complete pairs', () => {
  const h = buildHistory(6, 2000); // ~12KB of groups
  const changed = compactHistory(h, 6000);
  assert.strictEqual(changed, true);
  assert.ok(JSON.stringify(h).length <= 6000, 'result within budget');
  assert.strictEqual(h[0].role, 'system');
  assert.match(h[1].content, /调研 REA skill/);
  // every tool message directly follows its assistant tool_calls call
  for (let i = 1; i < h.length; i++) {
    if (h[i].role === 'tool') {
      const p = h[i - 1];
      assert.ok(p.role === 'assistant' && Array.isArray(p.tool_calls) && p.tool_calls.length,
        'tool at ' + i + ' orphaned');
      assert.strictEqual(p.tool_calls[0].id, h[i].tool_call_id);
    }
  }
  assert.ok(h.some((m) => String(m.content).includes('[context compacted')), 'marker present');
  assert.strictEqual(h[h.length - 1].content, 'final answer', 'recent work survives');
  assert.ok(h.length < 16, 'older groups dropped');
});
