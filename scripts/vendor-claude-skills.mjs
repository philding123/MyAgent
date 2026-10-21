#!/usr/bin/env node
// F53: vendor Anthropic's public skills (github.com/anthropics/skills) into
// market/claude-skills as MyAgent's builtin, offline skill market.
//
//   node scripts/vendor-claude-skills.mjs [--repo <local clone>] [--ref <sha|branch>]
//
// Apache-2.0 skills are copied verbatim (LICENSE.txt kept). The document
// skills (docx/pdf/pptx/xlsx) are source-available under a proprietary
// license that forbids copies outside Anthropic's services, so they are
// listed view-only (homepage link, installable:false) and never copied.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'market', 'claude-skills');
const UPSTREAM = 'https://github.com/anthropics/skills';
const require = createRequire(import.meta.url);
const { parseFrontmatter } = require('../app/daemon/skills.js');
const { treeHash } = require('../app/daemon/market.js');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

// zh catalog metadata (wb market cards show a localized name + one-liner)
// catalog order = META order (most generally useful first, Claude-product
// meta skills last); unknown upstream additions append alphabetically
const META = {
  'skill-creator': ['技能创建器', 'dev', '从零创建、修改技能并评测技能效果'],
  'mcp-builder': ['MCP 构建器', 'dev', '指导创建高质量 MCP 服务器（Python / TypeScript）'],
  'frontend-design': ['前端设计', 'creative', '构建或重塑界面时给出有辨识度的视觉方向与排版'],
  'webapp-testing': ['Web 应用测试', 'dev', '用 Playwright 测试本地 Web 应用、截图、查看日志'],
  'web-artifacts-builder': ['Web 产物构建', 'dev', '用 React + Tailwind + shadcn/ui 构建多组件 HTML 产物'],
  'doc-coauthoring': ['文档共创', 'enterprise', '结构化协作撰写方案、技术规格、决策文档'],
  'internal-comms': ['内部沟通', 'enterprise', '按公司常用格式写周报、通告、FAQ 等内部沟通'],
  'theme-factory': ['主题工厂', 'creative', '10 套预设配色/字体主题，套用到幻灯片、文档、网页'],
  'canvas-design': ['画布设计', 'creative', '按设计理念产出 PNG/PDF 海报、艺术与静态视觉作品'],
  'algorithmic-art': ['算法艺术', 'creative', '用 p5.js 生成带种子随机数、可交互调参的算法艺术'],
  'slack-gif-creator': ['Slack 动图', 'creative', '生成为 Slack 优化的动画 GIF（含约束校验工具）'],
  'brand-guidelines': ['品牌规范', 'enterprise', '把 Anthropic 官方品牌色与字体套用到各类产物'],
  'claude-api': ['Claude API', 'dev', 'Claude API / Anthropic SDK 参考：模型、参数、流式、工具调用、缓存'],
  'discernment-nudge': ['审慎提示', 'enterprise', '给出可执行建议后提醒用户核实关键假设'],
  'academy-guide': ['Claude 学院向导', 'enterprise', '回答 Claude 用法问题时推荐 Claude Academy 课程'],
  docx: ['Word 文档', 'document', '创建、读取、编辑 Word（.docx）文档'],
  pdf: ['PDF 处理', 'document', '提取文本表格、合并拆分、填表、OCR 等 PDF 操作'],
  pptx: ['PPT 演示文稿', 'document', '创建、读取、编辑 PowerPoint（.pptx）演示文稿'],
  xlsx: ['Excel 表格', 'document', '创建、读取、编辑电子表格（公式、格式、图表）'],
};
const RESTRICTED = new Set(['docx', 'pdf', 'pptx', 'xlsx']);

function sh(cmd, a, cwd) {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(cmd + ' ' + a.join(' ') + ' failed: ' + (r.stderr || r.error));
  return r.stdout.trim();
}

// one-line upstream description: YAML block scalars unfolded by the same
// parser the daemon uses, whitespace collapsed
function upstreamDescription(dir) {
  const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  return String(meta.description || '').replace(/\s+/g, ' ').trim();
}

function main() {
  let repo = opt('--repo');
  if (!repo) {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skills-'));
    sh('git', ['clone', '--depth', '1', UPSTREAM + '.git', repo]);
  }
  const ref = opt('--ref');
  if (ref) sh('git', ['checkout', '--quiet', ref], repo);
  const commit = sh('git', ['rev-parse', 'HEAD'], repo);
  const committedAt = sh('git', ['log', '-1', '--format=%cI'], repo);

  fs.rmSync(path.join(OUT, 'skills'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'skills'), { recursive: true });
  const plugins = [];
  const src = path.join(repo, 'skills');
  const order = Object.keys(META);
  const rank = (n) => (order.includes(n) ? order.indexOf(n) : order.length);
  const names = fs.readdirSync(src).sort().sort((a, b) => rank(a) - rank(b));
  for (const name of names) {
    const dir = path.join(src, name);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).meta;
    const [display, group, zh] = META[name] || [name, 'other', ''];
    const entry = {
      name: fm.name || name,
      display_name: display,
      description: upstreamDescription(dir),
      description_zh: zh,
      category: 'skill',
      group,
      author: 'Anthropic',
      version: commit.slice(0, 7),
      homepage: `${UPSTREAM}/tree/${commit}/skills/${name}`,
    };
    if (RESTRICTED.has(name)) {
      Object.assign(entry, {
        license: 'proprietary',
        installable: false,
        reason: '源码可见但非开源：许可禁止在 Anthropic 服务之外复制或留存，MyAgent 不内置也不代为下载（可在 Claude 应用 / Claude Code 内使用）',
      });
    } else {
      fs.cpSync(dir, path.join(OUT, 'skills', name), { recursive: true });
      Object.assign(entry, {
        license: 'Apache-2.0',
        installable: true,
        source: 'builtin:skills/' + name,
        tree_sha256: treeHash(path.join(OUT, 'skills', name)),
      });
    }
    plugins.push(entry);
  }
  for (const f of ['THIRD_PARTY_NOTICES.md']) {
    if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(OUT, f));
  }
  const index = {
    name: 'claude-skills',
    display_name: 'Claude 技能市场',
    description: 'Anthropic 公开分享的 Agent Skills（github.com/anthropics/skills），随 MyAgent 内置、离线可装',
    owner: { name: 'Anthropic', url: UPSTREAM },
    metadata: { upstream: UPSTREAM, commit, committedAt, vendoredAt: new Date().toISOString().slice(0, 10) },
    plugins,
  };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`vendored ${plugins.filter((p) => p.installable).length} skills (+${plugins.filter((p) => !p.installable).length} view-only) @ ${commit.slice(0, 7)} → ${path.relative(ROOT, OUT)}`);
}

main();
