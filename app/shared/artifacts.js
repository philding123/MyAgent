'use strict';
// Pure CommonJS: usable from Node and bundled renderer ESM without Node shims.
const SOURCE_KINDS = { present_file: 'delivered', write_file: 'working' };
const basename = (p) => String(p).split(/[\\/]/).pop();

function normalizeArtifact(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return null;
  const sessionId = context.sessionId ?? value.sessionId;
  const toolCallId = context.toolCallId ?? value.toolCallId;
  const sourceTool = context.sourceTool ?? value.sourceTool;
  const createdAt = context.createdAt ?? value.createdAt;
  const location = value.location ?? (sourceTool === 'present_file' ? 'local' : null);
  const p = value.path;
  if (typeof sessionId !== 'string' || !sessionId || typeof toolCallId !== 'string' || !toolCallId
    || !Object.hasOwn(SOURCE_KINDS, sourceTool) || typeof p !== 'string' || !p.trim()
    || /[\x00-\x1f]/.test(p) || /[\\/]$/.test(p)
    || !Number.isFinite(createdAt) || createdAt < 0 || !['local', 'remote'].includes(location)) return null;
  if (context.sessionId && value.sessionId && value.sessionId !== context.sessionId) return null;
  return { schemaVersion: 1, sessionId, toolCallId, path: p, name: basename(p), sourceTool,
    createdAt, kind: SOURCE_KINDS[sourceTool], location };
}

function artifactFromMessage(message, sessionId) {
  if (!message || message.role !== 'tool' || (sessionId && message.session_id !== sessionId)) return null;
  try {
    const data = typeof message.tool_json === 'string' ? JSON.parse(message.tool_json) : message.tool_json;
    if (!data || data.ok !== true || !data.artifact) return null;
    return normalizeArtifact(data.artifact, { sessionId: sessionId || message.session_id,
      sourceTool: message.tool_name, toolCallId: data.artifact.toolCallId || message.id,
      createdAt: data.artifact.createdAt ?? message.created_at });
  } catch (_) { return null; }
}

function collectArtifacts(messages, sessionId) {
  const byPath = new Map();
  for (const message of messages || []) {
    const artifact = artifactFromMessage(message, sessionId);
    if (artifact) byPath.set(artifact.path, artifact);
  }
  return [...byPath.values()];
}

function isSafeOpenPath(p) {
  // Explicitly narrower than preview support. No HTML/SVG, code, macros,
  // executable/shortcut/URL handlers, UNC paths, ADS or device namespaces.
  if (typeof p !== 'string' || /[\x00-\x1f]/.test(p) || /^[\\/]{2}/.test(p)
    || /:/.test(p.replace(/^[A-Za-z]:/, '')) || /[. ]$/.test(p)) return false;
  return /\.(?:docx|pdf|xlsx|csv|pptx|png|jpe?g|gif|webp|bmp|txt|md|json|log)$/i.test(p);
}

module.exports = { normalizeArtifact, artifactFromMessage, collectArtifacts, isSafeOpenPath };
