# AGENTS.md — app/engine 详细契约

## 1. 职责与定位

每会话一个的 headless 引擎子进程。由 daemon 的 EngineHost fork（无 Electron 依赖，纯 Node）。对外只暴露 stdio JSON-Lines 双向协议；对 LLM 暴露 OpenAI 兼容 `/chat/completions` + function calling。

## 2. 结构与组件

| 文件 | 职责 |
|---|---|
| `index.js` | readline 消费 stdin；`init`（建 Sandbox/registry/LlmClient/system 提示）→ `runTurn` 工具循环；`gateTool` 三级门控：①policy.js 模式规则 → ②sandbox 路径/命令规则 → ③confirm 门控（exec 与 plan 写操作） |
| `policy.js` | `MODE_RULES`（ask: write/exec=deny；plan: write=confirm、exec=只读白名单 `READONLY_CMD`；craft: 全放行）+ `systemPromptFragment`（对齐 WorkBuddy interactionmode fragments 的 `<current_mode>` 硬规则写法） |
| `llm.js` | `LlmClient.chat(messages, tools)`；`ping()` 供测试连接 |
| `tools/index.js` | `makeTools({sandbox, skillRegistry})` → tools 表（read_file/list_dir/write_file/run_command/search/skill_read，各带 kind: read/write/exec）+ OpenAI `definitions` |
| `tools/web.js` | F46 web_search（cn.bing SERP）/web_fetch（htmlToText，上限）；直连 fetch、错误即值 | 
| `tools/social.js` | F57 social_fetch：hackernews（hn.algolia keyless）+ rss（RSS/Atom 紧凑解析；国内社交走自托管 RSSHub 路由）；kind=read，≤30 条/8000 字 |
| `vision.js` | F59 视觉回路：工具结果带 `data.image={mime,base64}` → tool 消息保持纯文本，图像随本步工具批次后的 `role:user` 消息 `[{type:text},{type:image_url}]` 下发（OpenAI 兼容 tool 消息只收文本；base64 绝不重复进 JSON 文本）；护栏 base64 ≤1.5MB/图、≤10 图/轮，超限=错误即值；`pruneImages` 只留最新 2 张像素；compact.js 按每图 4000 字符计量并把图像消息并入工具组 |
| `tools/computer.js` | F59 OS 原语 `computer`（仅 `computerUse.enable` 才注册）：内嵌 PowerShell（list/open/shot/click/type/key）；**坐标 ref 化**（list_windows→w1..wN，x/y=该窗口截图像素，宽 >1280 按比例换回）；click/type/key 同一调用内前置并**校验前台**（失败=未发送值）、按实时原点换算、尺寸变化拒绝；screenshot 带 ref=PrintWindow（锁屏可用）、无 ref=主屏（该环境失败为诚实值）；open_app 复用 gateTool 命令规则；非 win32=环境值 |

## 3. 铁律与不变式

- **三级门控顺序固定**：policy deny → sandbox deny → confirm；deny 不产生确认往返（T09a 断言）。
- **工具错误是值不是异常**：`run()` 返回 `{ok, summary, data?}`；引擎把结果 JSON 序列化进 `role:tool` 消息。
- **渐进披露**：system 只带技能清单（name+description），全文经 `skill_read`（init 携带完整 body）。
- **user_preferences / memoryFacts / persona**：daemon buildInit 注入，system 提示按节组装（`<user_preferences>` 等），格式改动需过 T13。

## 4. 开发与测试

- 集成路径：forkDaemon → settings.set(llm.baseUrl 指向 mock-llm) → sessions.create → engine.start → engine.userMessage → waitEvent(`engine:{id}`)。
- mock LLM：`scripts/mock-llm.mjs`（scenario = 逐请求出牌的 assistant 消息数组，支持 content/tool_calls/`__error`）。
- 相关测试：T04（循环）、T06（工具）、T07（策略）、T09（确认）、T11b/T13（system 组装）。
