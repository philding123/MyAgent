#!/usr/bin/env node
// F56: vendor a curated set of open-source expert personas from
// msitarzewski/agency-agents (MIT) into market/agency-experts/ — index.json +
// verbatim persona markdown + LICENSE/NOTICES. Locked to an upstream commit;
// re-run this script (then T51) to upgrade.
//   node scripts/vendor-agency-experts.mjs [--repo <clone>] [--ref <sha>]
// --repo reuses a local clone; otherwise a shallow clone is made. --ref checks
// out a specific commit before vendoring (requires a full-ish fetch).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

const UPSTREAM = 'https://github.com/msitarzewski/agency-agents';
const LICENSE = 'MIT';
const DIVISION_ZH = { engineering: '工程', design: '设计', product: '产品', testing: '测试', security: '安全', research: '研究', finance: '金融' };
// Curated batch 1 (26) + batch 2 finance (2026-10-25, 7): one persona per file,
// verbatim. zh display names/descriptions are ours (catalog metadata only).
const CURATED = [
  // engineering
  ['engineering/engineering-backend-architect.md', '后端架构师', '可扩展系统设计、数据库与 API 架构、可靠服务端方案'],
  ['engineering/engineering-frontend-developer.md', '前端工程师', '组件化前端实现、性能与可访问性工程实践'],
  ['engineering/engineering-ai-engineer.md', 'AI 工程师', 'LLM 应用与智能体系统集成、评测与落地'],
  ['engineering/engineering-code-reviewer.md', '代码审查员', '以缺陷与风险为导向的结构化代码评审'],
  ['engineering/engineering-codebase-onboarding-engineer.md', '代码库上手工程师', '快速梳理陌生代码库并产出上手地图'],
  ['engineering/engineering-database-optimizer.md', '数据库优化专家', '慢查询分析与索引、Schema、配置调优'],
  ['engineering/engineering-sre.md', 'SRE 可靠性工程师', '可用性目标、告警、故障演练与容量规划'],
  ['engineering/engineering-git-workflow-master.md', 'Git 工作流专家', '分支策略、疑难提交历史修复与协作规范'],
  ['engineering/engineering-rapid-prototyper.md', '快速原型工程师', '在极短周期内交付可验证的最小原型'],
  ['engineering/engineering-technical-writer.md', '技术作家', '把复杂系统写成清晰的文档与指南'],
  // design
  ['design/design-ui-designer.md', 'UI 设计师', '界面视觉设计、组件规范与一致性细节'],
  ['design/design-ux-architect.md', 'UX 架构师', '信息架构与端到端用户体验设计'],
  ['design/design-ux-researcher.md', '用户研究员', '访谈、可用性测试与行为洞察'],
  ['design/design-brand-guardian.md', '品牌守护者', '输出内容与品牌视觉语言保持一致'],
  // product
  ['product/product-manager.md', '产品经理', '需求定义、路线图与跨职能推进'],
  ['product/product-feedback-synthesizer.md', '反馈综合分析师', '把散乱用户反馈归纳为可行动结论'],
  ['product/product-sprint-prioritizer.md', '迭代优先级规划', '按价值与成本对任务排序并给出取舍理由'],
  // testing
  ['testing/testing-api-tester.md', 'API 测试工程师', '接口契约测试、边界与异常场景设计'],
  ['testing/testing-test-automation-engineer.md', '测试自动化工程师', '自动化测试体系搭建与维护'],
  ['testing/testing-accessibility-auditor.md', '无障碍审计师', '按 WCAG 检查并给出可修复建议'],
  ['testing/testing-performance-benchmarker.md', '性能基准测试工程师', '基准设计、瓶颈定位与回归对比'],
  ['testing/testing-reality-checker.md', '实事求是核查员', '对结论与证据做怀疑式复核，防止自欺'],
  // security
  ['security/security-appsec-engineer.md', '应用安全工程师', '威胁建模与安全编码、依赖风险治理'],
  ['security/security-ai-generated-code-auditor.md', 'AI 代码安全审计', '专门审查 AI 生成代码的安全缺陷'],
  ['security/security-secrets-credential-engineer.md', '凭证卫生工程师', '密钥轮换、泄漏处置与凭据管理规范'],
  // research
  ['research/research-synthesist.md', '研究综合师', '多来源调研并综合成结构化结论'],
  // finance (batch 2) + adjacent engineering money roles
  ['finance/finance-bookkeeper-controller.md', '记账控制员', '复式记账、月结闭环与账务一致性控制'],
  ['finance/finance-financial-analyst.md', '财务分析师', '财务报表解读、比率与经营状况分析'],
  ['finance/finance-fpa-analyst.md', 'FP&A 分析师', '预算编制、滚动预测与经营计划分析'],
  ['finance/finance-investment-researcher.md', '投资研究员', '标的调研、估值方法与投资论证'],
  ['finance/finance-tax-strategist.md', '税务策略师', '税务筹划路径与合规要点梳理'],
  ['engineering/engineering-payments-billing-engineer.md', '支付计费工程师', '计费系统、支付通道与对账幂等设计'],
  ['engineering/engineering-finops-engineer.md', 'FinOps 工程师', '云成本优化、预算告警与单位经济性治理'],
];

function parseFrontmatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('no frontmatter: ' + file);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv && kv[2] !== undefined) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  if (!fm.name || !fm.description) throw new Error('frontmatter missing name/description: ' + file);
  return { fm, body: m[2].trim() + '\n' };
}

// ---------- obtain the repo ----------
let repo = opt('repo'), tmp = null;
const ref = opt('ref');
if (!repo) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-agents-vendor-'));
  repo = path.join(tmp, 'repo');
  console.log('shallow cloning ' + UPSTREAM);
  execFileSync('git', ['clone', '--depth', '1', UPSTREAM, repo], { stdio: 'inherit' });
}
if (ref) execFileSync('git', ['-C', repo, 'checkout', ref], { stdio: 'inherit' });
const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
const committedAt = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%cI']).toString().trim();
if (!fs.existsSync(path.join(repo, 'LICENSE'))) throw new Error('upstream LICENSE missing — refusing to vendor');

// ---------- vendor ----------
const out = path.join(ROOT, 'market', 'agency-experts');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'experts'), { recursive: true });
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(out, 'LICENSE'));

const experts = [];
for (const [file, zhName, zhDesc] of CURATED) {
  const abs = path.join(repo, file);
  if (!fs.existsSync(abs)) throw new Error('curated file missing upstream: ' + file);
  const raw = fs.readFileSync(abs);
  const text = raw.toString('utf8');
  const { fm, body } = parseFrontmatter(text, file);
  if (/[\x00]/.test(body)) throw new Error('NUL in persona body: ' + file);
  const id = path.basename(file, '.md');
  const division = path.dirname(file);
  fs.writeFileSync(path.join(out, 'experts', id + '.md'), raw); // verbatim bytes
  experts.push({
    id, file,
    name: fm.name, display_name: zhName,
    description: fm.description, description_zh: zhDesc,
    division, division_zh: DIVISION_ZH[division] || division,
    emoji: fm.emoji || '', author: 'AgentLand Contributors', license: LICENSE,
    homepage: UPSTREAM + '/blob/' + commit + '/' + file,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  });
}

const index = {
  name: 'agency-experts',
  display_name: '开源专家市场',
  description: '精选开源专家角色（github.com/msitarzewski/agency-agents，MIT），导入后成为可绑定会话的专家预设',
  owner: { name: 'AgentLand Contributors', url: UPSTREAM },
  metadata: { upstream: UPSTREAM, commit, committedAt, vendoredAt: new Date().toISOString().slice(0, 10), license: LICENSE, count: experts.length },
  experts,
};
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.md'),
  '# Third-party notices\n\n- `experts/*.md` come from [agency-agents](' + UPSTREAM + ') at commit `' + commit + '`, licensed MIT (see LICENSE). Files are vendored verbatim; zh display names/descriptions in index.json are MyAgent catalog metadata.\n');

console.log('vendored ' + experts.length + ' experts @ ' + commit.slice(0, 12) + ' → market/agency-experts');
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
