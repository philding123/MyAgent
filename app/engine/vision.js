'use strict';
// F59 vision loop (design/43): tool results may carry an image
// (data.image = {mime, base64}); the engine then assembles the OpenAI-style
// multi-part tool message so a vision-capable model actually SEES it, instead
// of shipping megabytes of base64 as a JSON string nobody renders.
//
// Caps are fail-closed value errors, never silent truncation:
// - per image: base64 length (default 1.5MB ≈ a 1280×800 PNG with headroom)
// - per turn: image count (default 10)
// Implementation ruling vs design/43: no JPEG re-encode in round 1 (pure-Node
// engine has no encoder); the browser viewport is already 1280-wide and OS
// shots are capped by capture area. Oversize → honest value error.

const MAX_IMAGE_B64_CHARS = 1536 * 1024;
const MAX_IMAGES_PER_TURN = 10;

function plainToolMessage(toolCallId, result) {
  return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) };
}

/**
 * Build the history message for a tool result. When it carries a usable
 * image the message content becomes [{type:'text'},{type:'image_url'}];
 * the JSON text part never contains the base64 (no double shipping).
 *
 * @param budget {{images:number}} mutated when an image is attached
 * @returns {{msg: object}|{result: object}} — on cap violation the ORIGINAL
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
  return { msg: {
    role: 'tool',
    tool_call_id: toolCallId,
    content: [
      { type: 'text', text: JSON.stringify({ ok: result.ok, summary: result.summary, ...(Object.keys(rest).length ? { data: rest } : {}) }) },
      { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + image.base64 } },
    ],
  } };
}

module.exports = { buildToolMessage, MAX_IMAGE_B64_CHARS, MAX_IMAGES_PER_TURN };
