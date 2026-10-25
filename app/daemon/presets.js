'use strict';
// F41 presets (design/34): named system-prompt presets — wb「助理/专家」的
// MyAgent 对应物。Stored as one JSON file per preset under MYAGENT_HOME/presets.

const fs = require('fs');
const path = require('path');

function createPresetStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (id) => path.join(dir, id + '.json');
  return {
    dir,
    list() {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    create({ name, description, prompt, meta }) {
      if (!name) throw new Error('name is required');
      const preset = { id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name, description: description || '', prompt: prompt || '',
        // F56: provenance for catalog-imported experts (plain data, kept verbatim)
        ...(meta && typeof meta === 'object' && !Array.isArray(meta) ? { meta } : {}) };
      fs.writeFileSync(fileOf(preset.id), JSON.stringify(preset, null, 2));
      return preset;
    },
    remove(id) { fs.rmSync(fileOf(id), { force: true }); return true; },
    read(id) {
      try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
    },
  };
}

module.exports = { createPresetStore };
