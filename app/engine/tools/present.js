'use strict';
// present_file (F47, task-parity P0-3): wb's agent finishes file deliverables
// with a present_files tool that copies the artifact into a user-visible
// folder (C:\Users\phil\WorkBuddy\<ts>\) and registers it (artifact-index →
// file card + preview). MyAgent's write_file leaves outputs buried in the
// session workspace; present_file copies a sandbox-checked workspace file
// into ~\MyAgent\<stamp>\ and reports the destination, which the engine
// forwards on the tool_result event as {artifact:{path,name}} for the
// renderer's artifact card. One stamp folder per engine session (wb: per task).

const fs = require('fs');
const path = require('path');

function makePresentTool({ sandbox, getDestDir, cloud } = {}) {
  const os = require('os');
  const root = () => path.join(os.homedir(), 'MyAgent');
  let dir = null;
  const destDir = () => {
    if (getDestDir) return getDestDir();
    if (!dir) dir = path.join(root(), new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
    return dir;
  };
  return {
    kind: 'write',
    description: 'Deliver a finished workspace file to the user-visible MyAgent delivery folder. Call once per finished artifact. Args: {path}',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    run: async (args) => {
      // No cloud download/materialization protocol yet: never interpret a
      // remote path as a coincidentally existing local file.
      if (cloud) return { ok: false, summary: 'remote file delivery is not supported; download it explicitly first' };
      const chk = sandbox.checkFile(args.path, 'read');
      if (!chk.ok) return { ok: false, summary: 'sandbox denied: ' + chk.path };
      let st;
      try { st = fs.statSync(chk.path); } catch (_) { return { ok: false, summary: 'not found: ' + args.path }; }
      if (!st.isFile()) return { ok: false, summary: 'not a file: ' + args.path };
      try {
        const dirPath = destDir();
        fs.mkdirSync(dirPath, { recursive: true });
        const dest = path.join(dirPath, path.basename(chk.path));
        fs.copyFileSync(chk.path, dest);
        return { ok: true, summary: 'delivered ' + dest + ' (' + st.size + 'B)',
          data: { dest, size: st.size } };
      } catch (e) {
        return { ok: false, summary: 'present failed: ' + String(e && e.message || e).slice(0, 160) };
      }
    },
  };
}

module.exports = { makePresentTool };
