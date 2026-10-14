# AGENTS.md — tests/

## 职责与定位

三层测试体系，`npm run verify` 的执行对象；T 编号与 design/99-test-plan.md、00-roadmap 功能点一一对应。

## 结构

| 目录 | 层 | 说明 |
|---|---|---|
| `unit/` | 单元 | 纯 Node 直测模块（codec/存储/沙箱/工具/预热/技能/vault），无 Electron |
| `integration/` | 集成 | fork 真实 daemon/engine + 本地 mock LLM，走完整协议 |
| （e2e） | 端到端 | 实现在 `app/main/index.js#runSmoke`，由 scripts/verify.mjs 轮询结果 JSON 驱动 |
| `helpers.js` | 公共 | `makeTempHome`（MYAGENT_HOME 隔离）、`forkDaemon`（协议客户端：request/waitEvent 带事件索引） |

## 铁律

1. **命名契约**：文件与用例名以 `T\d+[a-z]?` 开头——verify.mjs 靠它生成验收报告，改名前先看 scripts/verify.mjs 的 tIndex 正则。
2. 集成测试必须设隔离数据目录（makeTempHome），禁止写真实 `%APPDATA%/myagent`（唯一例外 scripts/real-llm-check.js，它就是配真实环境的）。
3. 涉及 LLM 的测试一律用 `scripts/mock-llm.mjs`（场景化脚本响应），禁止烧真实 API。
4. waitEvent 依赖事件索引防陈旧事件（T13 教训）；新增等待逻辑注意 mark 捕获时机。

## 命令

```bash
npm run test:unit   # node --test tests/unit/*.test.js
npm run test:int    # node --test tests/integration/*.test.js
npm run verify      # 全量 + 验收报告
```
