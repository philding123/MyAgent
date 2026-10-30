'use strict';
// F59 vision loop (design/43): tool results may carry an image
// (data.image = {mime, base64}); the engine then attaches it so a
// vision-capable model actually SEES it, instead of shipping megabytes of
// base64 as a JSON string nobody renders.
//
// Message shape: OpenAI-compatible Chat Completions only accept TEXT parts in
// role:'tool' messages, so the tool message stays a plain JSON string and the
// image rides in a role:'user' message appended after the step's tool batch
// (tool messages must directly follow their assistant tool_calls).
//
// Caps are fail-closed value errors, never silent truncation:
// - per image: base64 length (default 1.5MB ≈ a 1280×800 PNG with headroom)
// - per turn: image count (default 10)
// - in context: only the newest MAX_IMAGES_IN_CONTEXT images keep their pixels;
//   older ones collapse to their text label (pruneImages) so history and
//   compaction never carry a stack of stale screenshots
// Implementation ruling vs design/43: no JPEG re-encode in round 1 (pure-Node
// engine has no encoder); the browser viewport is already 1280-wide and OS
// shots are capped by capture area. Oversize → honest value error.

const MAX_IMAGE_B64_CHARS = 1536 * 1024;
const MAX_IMAGES_PER_TURN = 10;
const MAX_IMAGES_IN_CONTEXT = 2;

function plainToolMessage(toolCallId, result) {
  return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) };
}

/**
 * Build the history message(s) for a tool result. The tool message is always
 * a JSON string; when the result carries a usable image, `imageMsg` is the
 * role:'user' message holding it (text label + image_url part). The JSON
 * text never contains the base64 (no double shipping).
 *
 * @param budget {{images:number}} mutated when an image is attached
 * @returns {{msg: object, imageMsg?: object}} — on cap violation the ORIGINAL
 *   result is replaced by an error value the model can act on.
 */
function buildToolMessage(toolCallId, result, budget) {
  const image = result && result.ok && result.data && result.data.image;
  if (!image || typeof image.base64 !== 'string' || !image.base64) {
    return { msg: plainToolMessage(toolCallId, result) };
  }
  if (image.base64.length > MAX_IMAGE_B64_CHARS) {
    return { msg: plainToolMessage(toolCallId, { ok: false,
      summary: 'screenshot exceeds the vision budget (' + Math.round(image.base64.length / 1024)
        + 'KB base64 > ' + Math.round(MAX_IMAGE_B64_CHARS / 1024) + 'KB); not attached' }) };
  }
  if (!budget || budget.images >= MAX_IMAGES_PER_TURN) {
    return { msg: plainToolMessage(toolCallId, { ok: false,
      summary: 'screenshot budget reached (' + MAX_IMAGES_PER_TURN + ' images per turn); not attached' }) };
  }
  budget.images++;
  const { image: _stripped, ...rest } = result.data;
  const mime = image.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return {
    msg: plainToolMessage(toolCallId, { ok: result.ok, summary: result.summary,
      ...(Object.keys(rest).length ? { data: rest } : {}), image: 'attached in the next user message' }),
    imageMsg: { role: 'user', content: [
      { type: 'text', text: '[screenshot from tool call ' + toolCallId + ': ' + String(result.summary || '').slice(0, 160) + ']' },
      { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + image.base64 } },
    ] },
  };
}

/** A user message built by buildToolMessage (array content with an image). */
function isImageMessage(m) {
  return !!m && m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p && p.type === 'image_url');
}

/**
 * Keep pixels only for the newest `keep` image messages; older ones become
 * their text label so the model still knows a screenshot happened.
 * @returns {number} how many images were dropped
 */
function pruneImages(history, keep = MAX_IMAGES_IN_CONTEXT) {
  let seen = 0;
  let dropped = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!isImageMessage(m)) continue;
    if (++seen <= keep) continue;
    const label = m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ') || '[screenshot]';
    history[i] = { role: 'user', content: label + ' (image dropped from context; take a new screenshot if needed)' };
    dropped++;
  }
  return dropped;
}

module.exports = { buildToolMessage, isImageMessage, pruneImages, MAX_IMAGE_B64_CHARS, MAX_IMAGES_PER_TURN, MAX_IMAGES_IN_CONTEXT };
