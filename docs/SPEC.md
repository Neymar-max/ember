# Ember — 总设计规格（实现以本文件为准）

Ember 是一个 macOS 桌面 App：给 **本机已安装、已登录的 Claude Code CLI** 套一个好看、好读的界面。
后端 100% 是用户自己的 `claude` 可执行文件（通过官方 `@anthropic-ai/claude-agent-sdk@0.3.283` 的 `pathToClaudeCodeExecutable` 启动），
所以登录状态、settings.json、CLAUDE.md、skills、MCP、plugins、hooks、权限规则全部与 CLI 一致。App 自己 **不做登录**。
视觉：2025 → 2026 春季改版前的 Claude App —— 淡黄奶油底色、陶土橙强调色、助手回复用衬线字体。

项目根目录：`/Users/you/Desktop/claude/ember`
技术栈：Electron 44 + electron-vite 5 + React 19 + TypeScript + zustand 5；纯 CSS（CSS 变量 + 每个组件一个 .css 文件）；lucide-react 图标；react-markdown + remark-gfm + rehype-highlight（highlight.js）；`diff` 包。
**不允许新增 npm 依赖**，除非本文件列出。所有依赖都在 devDependencies（vite 会把它们打进 bundle）。

参考资料（必要时查阅，不必通读）：
- `docs/research/sdk-integration.md` — SDK 用法详解（中文）
- `docs/research/design-spec.md` — Claude 视觉调研
- `docs/research/prior-art.md`、`docs/research/packaging.md`
- `docs/sdk/sdk.d.ts`、`docs/sdk/sdk-tools.d.ts` — SDK 类型定义（权威）
- `docs/fixtures/*.jsonl` — **真实抓包**（tools/todo/plan/ask/subagent/markdown/interrupt 七个场景），每行一个 SDK 消息；`{"__canUseTool": {...}}` 行是 canUseTool 回调收到的参数；`{"__interrupt":...}` 是 interrupt() 返回值。

---

## 1. 目录与分工（每个工作包只改自己拥有的文件）

```
src/shared/types.ts, src/shared/ipc.ts     契约（已写好，只读；如必须改，只能“追加”字段并在汇报里说明）
src/preload/index.ts, index.d.ts            已写好（只读）
src/main/**                                 WP-A 主进程
src/renderer/src/store/types.ts             渲染层数据模型（已写好，只读；可追加可选字段）
src/renderer/src/store/chats.ts             WP-B（接口已定，实现替换 stub）
src/renderer/src/store/reducer.ts (+test)   WP-B
src/renderer/src/components/chat/**         WP-B（Markdown/CodeBlock/ChatView 等）
src/renderer/src/i18n/chat.ts               WP-B
src/renderer/src/components/tools/**        WP-C（ToolRow、各工具卡片、DiffView、TaskPanel）
src/renderer/src/components/interactive/**  WP-C（权限卡、提问卡、计划审批卡、InteractionDock）
src/renderer/src/i18n/tools.ts              WP-C
src/renderer/src/App.tsx                    WP-D
src/renderer/src/store/app.ts               WP-D（接口已定，实现替换 stub）
src/renderer/src/components/layout|composer|settings|setup/**   WP-D
src/renderer/src/components/common/**       已有 Button/IconButton/Spinner/EmberSpark/CopyButton（只读）；WP-D 可以新增 Menu/Popover/Dialog/Toast 等文件
src/renderer/src/i18n/shell.ts              WP-D
src/renderer/src/lib/api.ts, lib/format.ts, i18n/index.ts, i18n/common.ts, styles/*   已写好（只读；format.ts 可追加函数）
```

跨包组件接口（签名已在 stub 文件里，实现方必须保持签名）：
- WP-B 提供：`<ChatView chatId>`（消息滚动区）、`<Markdown text variant streaming?>`、`<CodeBlock code language? startLine? maxLines? bare?>`
- WP-C 提供：`<ToolRow chatId toolUseId depth?>`（WP-B 的助手消息里渲染 tool part 时调用）、`<InteractionDock chatId>`、`<TaskPanel chatId>`
- WP-D 提供：App 布局，把 `<ChatView>`、`<TaskPanel>`、`<InteractionDock>`、Composer 组合起来。

CSS 类名前缀防冲突：WP-B `em-chat-*`，WP-C `em-tool-*` / `em-ix-*`，WP-D `em-shell-*` / `em-composer-*` / `em-settings-*` / `em-setup-*`，公共 `em-ui-*`。
所有颜色、圆角、阴影、字体 **只用 `styles/tokens.css` 里的变量**，禁止写死颜色（浅色/深色主题都要对）。
所有界面文字走 i18n：组件里 `const t = useT()`，key 以包名开头，中英文都要写（中文为主要语言，英文要自然）。

---

## 2. 主进程（WP-A）

文件建议：`src/main/index.ts`（生命周期/窗口/菜单）、`env.ts`（登录 shell 环境）、`cli.ts`（找 claude）、`probe.ts`（探测登录/模型/命令）、`sessions.ts`（会话管理）、`history.ts`、`settings.ts`、`files.ts`、`ipc.ts`、`log.ts`。
实现 `src/shared/ipc.ts` 里 **每一个** invoke 通道和 push 通道，行为如下。

### 2.1 窗口
- `BrowserWindow`：1280×840，最小 880×560；`titleBarStyle: 'hiddenInset'`，`trafficLightPosition: {x: 18, y: 17}`；`backgroundColor` 跟随主题（浅 `#f5f4ed` / 深 `#262624`，读 settings.theme + nativeTheme）；`show:false` 到 `ready-to-show`。
- `webPreferences`: `preload` = `join(__dirname, '../preload/index.js')`（electron-vite 产物；若产物是 .mjs 用对应名字），`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `spellcheck: false`。
- 窗口位置/大小持久化到 userData/window-state.json。
- 安全：`setWindowOpenHandler` → 只允许 http/https/mailto 用 `shell.openExternal`，返回 deny；`will-navigate` 阻止非本地导航。
- 菜单（中文/英文随 settings.language 或系统）：App 菜单（关于 Ember、设置… ⌘,、隐藏、退出 ⌘Q）；文件（新对话 ⌘N、打开项目文件夹… ⌘O）；编辑（role 标准项：撤销/重做/剪切/复制/粘贴/全选）；视图（切换侧边栏 ⌘B、搜索会话 ⌘K、聚焦输入框 ⌘L、实际大小/放大/缩小、开发者工具（仅开发模式或按住 ⌥））；窗口（最小化、缩放）；帮助。菜单项通过 `IPC.menuCommand` 发送 `MenuCommand` 给渲染层。`interrupt` 不放菜单（渲染层自己处理 Esc）。
- macOS：关闭最后一个窗口不退出（dock 点击重新打开）；`before-quit` 时关闭所有会话（见 2.4），最多等 3 秒。
- 单实例锁（`requestSingleInstanceLock`），第二个实例聚焦已有窗口。

### 2.2 环境（env.ts）——关键坑
- GUI 从 Finder 启动时 PATH 极简。启动时异步跑一次用户登录 shell 拿环境：`$SHELL -ilc 'printf "%s" "__EMBER_ENV__"; env; printf "%s" "__EMBER_ENV__"'`，6 秒超时，失败依次试 `/bin/zsh`、`/bin/bash`，全失败就用 process.env。解析两个分隔符之间的 `KEY=VALUE` 行（值可能含 `=`；多行值只取第一行即可）。传 `DISABLE_AUTO_UPDATE=true` 抑制 oh-my-zsh。结果缓存。
- 构造给 CLI 的 env：`{...process.env, ...shellEnv}`，然后：
  - **必须保证 `USER`、`LOGNAME`、`HOME`、`SHELL` 存在**（从 `os.userInfo()` 补）。实测：缺 `USER` 时 CLI 读不到钥匙串里的登录凭证，会显示“未登录”。
  - `LANG` 缺失时补 `en_US.UTF-8`。
  - 删除 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SSE_PORT`、`ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ATTACH_CONSOLE`、`NODE_OPTIONS`（Electron 的 NODE_OPTIONS 可能干扰）。
  - PATH 里去掉包含 `/cmux-cli-shims` 的目录项；确保 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin` 在 PATH 里（不存在就追加到末尾）。

### 2.3 找 CLI（cli.ts）
顺序：settings.cliPath（非空时）→ `~/.local/bin/claude` → `~/.claude/local/claude` → `/opt/homebrew/bin/claude` → `/usr/local/bin/claude` → 在登录 shell PATH 里逐目录找 `claude`（跳过 shim 目录）→ `~/.npm-global/bin/claude`、`~/.volta/bin/claude`、`~/.bun/bin/claude`。
每个候选：存在且可执行 → 用构造好的 env 跑 `<path> --version`（5 秒超时），输出形如 `2.1.283 (Claude Code)` 才算有效；记录 version。返回 `CliInfo`。

### 2.4 探测（probe.ts）→ EnvStatus
- 找到 CLI 后，用 SDK `query()` 起一个 **不发任何消息** 的会话（prompt 为永不产出的 async generator），`await q.initializationResult()`（15 秒超时），拿 `account/models/commands`，然后 `q.close()`。这一步不消耗 API 额度。
- `state` 判定：没找到 CLI → `'no-cli'`；account 里 `email` 为空且 `tokenSource` 为 `'none'`/空、`apiKeySource` 为空/`'none'`、`apiProvider` 为 `'firstParty'`（或空）→ `'not-logged-in'`；否则 `'ready'`。异常 → `'error'` + error 文本（附 stderr 尾部）。
- 附加：读 `~/.claude.json` 的 `oauthAccount.displayName`（只读这个字段，不要读或打印其它敏感内容）填 `account.displayName`；读 `~/.claude/settings.json` 的 `model` 填 `defaultModel`。
- models 映射成 `ModelOption[]`；commands 映射成 `SlashCommandInfo[]`。
- app 启动时自动跑一次；`env:get` 若还在跑就等它；`env:recheck` 强制重跑（重新找 CLI + 重新 probe）。变化时 push `IPC.envChanged`。settings.cliPath 变化时自动 recheck。

### 2.5 会话管理（sessions.ts）——核心
一个 chatId 对应最多一个活的 `LiveSession { query, input: AsyncQueue, abort, sessionId?, cwd, status, pending: Map<requestId, resolver>, lastUsed }`。
- **启动**（`session:start` 或 `session:send` 时若没有活会话则自动启动）：
  ```ts
  query({ prompt: input, options: {
    pathToClaudeCodeExecutable: cli.path, cwd, env: childEnv,
    resume: resumeSessionId,          // 有就传
    model, permissionMode, effort,    // 有就传；permissionMode==='bypassPermissions' 时同时传 allowDangerouslySkipPermissions: true
    systemPrompt: { type: 'preset', preset: 'claude_code' },   // 必须显式传，否则 SDK 默认是空系统提示词
    settingSources: ['user', 'project', 'local'],              // 与 CLI 一致（CLAUDE.md、skills、权限规则）
    includePartialMessages: true, forwardSubagentText: true, agentProgressSummaries: true,
    toolConfig: { askUserQuestion: { previewFormat: 'html' } },
    canUseTool, stderr: (d) => 记录到环形缓冲（最后 200 行）并写日志文件,
    abortController,
  }})
  ```
  然后后台 `for await (const m of q)` 循环：每条消息 → `send(IPC.sessionEvent, {chatId, kind:'sdk', message: m})`。遇到 `system/init` 时记录 `session_id`，第一次拿到时 push `{kind:'session-id'}`。
  状态 push：启动时 `starting`；收到 init 后 `idle`；用户 send 时 `running`；收到 `result` → `idle`；收到 `stream_event`/`assistant` 且当前 idle（CLI 自己发起的新一轮，例如后台子代理完成后）→ `running`。循环正常结束 → `closed`；抛异常 → `error`（error 文本 = 异常信息 + stderr 最后 20 行）并把该会话从 map 移除（下次 send 会用 `resume: sessionId` 自动重启）。
  **注意**：不要在收到 `result` 后停止读流；后台子代理完成后 CLI 会自动开启新一轮。
- **发送**：`input.push({ type:'user', message:{ role:'user', content }, parent_tool_use_id: null, uuid: payload.uuid, session_id: '' })`。有图片时 content 为 `[{type:'image', source:{type:'base64', media_type, data}}..., {type:'text', text}]`，否则直接字符串。实测 CLI **不会回显** 我们发出的 user 消息，渲染层自己乐观显示。
- **canUseTool**：生成/使用 `opts.requestId`，把请求存进 pending，push `{kind:'permission', request: PermissionRequest}`（字段从 toolName/input/opts 映射；`suggestions` 原样透传）。然后等渲染层 `session:respond`：
  - allow → `{behavior:'allow', updatedInput: resp.updatedInput ?? input, updatedPermissions: resp.applySuggestions ? opts.suggestions : undefined}`。若 `resp.switchToMode`（计划审批）→ `updatedPermissions` 追加/使用 `{type:'setMode', mode: switchToMode, destination:'session'}`。
  - deny → `{behavior:'deny', message: resp.message || 'The user denied this action.', interrupt: resp.interrupt}`。
  - `opts.signal` abort（中断等）→ 从 pending 删除，push `{kind:'permission-cancelled', requestId}`，返回 deny。
  - 窗口不在前台时发系统通知“Claude 需要你的确认”（点击通知聚焦窗口并 push `IPC.notificationClicked` chatId），dock 角标 = 所有 pending 数量。
- `interrupt` → `q.interrupt()`；`setModel` → `q.setModel(model)`；`setPermissionMode` → `q.setPermissionMode(mode)`；`setEffort` → `q.applyFlagSettings({ effortLevel: effort })`（null 清除）。没有活会话时这些调用直接返回（渲染层会在下次启动时带上）。
- `close` → pending 全部以 deny 结束、`input.end()`、`q.close()`，2 秒后若子进程仍在（能拿到 pid 的话）SIGKILL。
- `session:pending` 返回所有 chat 的 pending 请求（渲染层重载后恢复）。`session:meta` 返回该会话 `initializationResult()` 的 models/commands/account 以及最近一次 init 的 permissionMode/model。`session:context-usage` → `q.getContextUsage({detail:'summary'})` 映射成 `ContextUsage`（失败返回 null）。`session:live-list` 列出活会话。
- 最多 8 个活会话；超过时关闭最久未用且 idle 的那个。
- `rate_limit_event`：从 `rate_limit_info` 提取；注意实测结构是 `rate_limit_info.unifiedWindows.five_hour.utilization`（0~1 小数）和 `.seven_day`，也可能只有顶层 `utilization`/`rateLimitType`；合并成 `RateLimitSnapshot`，push `IPC.rateLimits`，`env:rate-limits-get` 返回最新值。
- 每次一轮结束（result）push `IPC.historyChanged`（节流 1 秒），让侧边栏刷新标题/时间。

### 2.6 历史（history.ts）
- `history:list` → SDK `listSessions({ limit: opts?.limit ?? 300 })` 映射成 `SessionSummary`（title = customTitle || summary || firstPrompt || '未命名'，去掉首尾空白和换行，截断 120 字）。按 lastModified 倒序。过滤掉 `cwd` 位于系统临时目录（`/private/var/folders`、`/tmp`、`/private/tmp`）且标题为空的噪声会话？——**不要过滤**，全部显示（用户自己的数据）。
- `history:load` → `getSessionMessages(sessionId, { includeSystemMessages: true })`，再找到原始 JSONL（在 `~/.claude/projects/*/` 下找 `<sessionId>.jsonl`，可缓存目录列表）逐行读，建立 `uuid → toolUseResult` 映射，把 `toolUseResult` 挂到对应消息的 `tool_use_result` 字段；原始行的 `isMeta: true` 也带上。返回 `LoadedHistory`（cwd 取 getSessionInfo 的 cwd）。大文件（>50MB）只做 SDK 那一步。
- `history:rename` → `renameSession`；`history:delete` → 先关闭对应活会话，再 `deleteSession`。之后 push `historyChanged`。

### 2.7 其它
- settings：`userData/settings.json`，与 `DEFAULT_SETTINGS` 合并；`settings:set` 合并保存后 push `settingsChanged`；主题变化时同步 `nativeTheme.themeSource` 和窗口背景色。
- `files:suggest(cwd, query)`：cwd 是 git 仓库时用 `git ls-files --cached --others --exclude-standard`（登录 shell env，3 秒超时，缓存 30 秒），否则有限深度遍历（深度 6，跳过 node_modules/.git/dist/build/.venv 等，最多 20000 条）；按模糊匹配（子序列 + 文件名优先）排序返回前 50 条，包含目录项（isDir）。
- `sys:*`：pickDirectory（openDirectory + createDirectory）；pickImages（png/jpg/jpeg/gif/webp，≤ 10MB/张，返回 base64）；pickExecutable；openExternal（仅 http/https/mailto）；showInFinder；openInTerminal（`open -a Terminal <cwd>`；有 command 时用 osascript 在 Terminal 里 `cd <cwd> && <command>`，注意转义）；openPath；notify（窗口 focused 时不弹）；setBadge（`app.dock.setBadge`）；appInfo；pathExists。
- 日志：`~/Library/Logs/Ember/main.log`（追加，>5MB 轮转一次），记录启动、CLI 路径/版本、每个会话启动/退出/错误、stderr。**不要记录消息内容和任何凭证**。
- 错误处理：所有 ipcMain.handle 都 try/catch，返回合理的默认值或 `{ok:false, error}`，不要让异常把主进程带崩。

---

## 3. 渲染层数据流（WP-B 的 reducer 规则，WP-C/WP-D 都依赖）

`store/types.ts` 定义了 `ChatState/ChatItem/Part/ToolCall/...`。`store/reducer.ts` 导出纯函数：
```ts
export function applySdkMessage(state: ChatState, msg: RawSdkMessage, opts?: { live?: boolean }): ChatState
export function buildFromHistory(base: ChatState, messages: HistoryMessage[]): ChatState
```
（可用 immer 风格的手写不可变更新；不要引入 immer。）规则（全部来自 `docs/fixtures` 实测）：

1. **助手一轮 = 一个 `assistant` item**：从一条真实用户提问之后开始，所有助手消息（多个不同 `message.id`，中间夹着 tool_result）都追加到同一个 assistant item 的 `parts` 里，直到下一条真实用户提问。
2. **流式**：`stream_event` 的 `event`：`message_start`（记下 message.id）→ `content_block_start`（index, content_block：text/thinking/tool_use）→ `content_block_delta`（`text_delta.text` / `thinking_delta.thinking` / `input_json_delta.partial_json` 累加）→ `content_block_stop`。随后 CLI 会再发一条**完整的** `assistant` 消息，每条只含一个 block（同一个 message.id 会有多条）。收到完整消息时：tool_use 按 id 找到 part 覆盖 input；text/thinking 找同 message.id 下第一个同类型且未定稿的 part，用完整文本替换并定稿（`streaming:false`）；找不到（例如历史记录或没开流式）就追加新 part。**不要把流式文字和完整文字相加。**
3. **thinking**：实测完整消息里 `thinking` 文本常为空字符串（只有 signature）。空文本的 thinking 也要保留一个 part（显示“已思考”），`system/thinking_tokens` 消息的 `estimated_tokens` 写到 `state.thinkingTokens` 以及当前 thinking part 的 `tokens`。
4. **工具**：`tool_use` 块 → `tools[id] = {name, input, status:'pending', parentToolUseId, children:[]}` 并在 parts 里放 `{type:'tool', toolUseId}`。后续 `user` 消息里的 `tool_result`（`tool_use_id`、`content`、`is_error`）→ 更新 `result`、`status`（done/error），消息顶层的 `tool_use_result` 存入 `structured`。`tool_result` 内容以 `"The user doesn't want to proceed"` 或 `"User rejected"` 或 `"Permission to use"`/`"denied"` 开头且 is_error → `denied`。`tool_progress` 消息 → `progress.elapsedSeconds`、`status:'running'`。`permission` 事件 → 对应 tool `waiting-permission`。
5. **子代理**：`parent_tool_use_id` 非空的 assistant/stream_event/user 消息属于该 Agent/Task 工具调用 —— 把它们的 parts 追加到 `tools[parent].children`，工具也照常进 `tools` map（带 parentToolUseId）。实测 Agent 工具默认**异步**：tool_result 立刻返回 `{isAsync:true,status:'async_launched'}`，子代理之后继续产出消息；`system/task_started|task_progress|task_notification|task_updated` 与 `background_tasks_changed` 维护 `backgroundTasks`，task 结束时对应 Agent 工具标 done/failed。
6. **待办**：新版 CLI 用 `TaskCreate`（input.subject/description/activeForm；tool_use_result.task.id）、`TaskUpdate`（input.taskId/status/subject/activeForm；status 'deleted' 表示删除）、`TaskList`（tool_use_result.tasks 是完整快照，直接覆盖）；旧版用 `TodoWrite`（input.todos 完整列表）。四者都更新 `state.todos`。
7. **用户消息**：历史里的 user 消息若 content 全是 tool_result → 不产生 item。文本里包含 `<command-name>/xxx</command-name>` 和 `<command-args>` → 产生带 `command` 的 user item；`<local-command-stdout>...</local-command-stdout>` → `command-output` item；以 `Caveat:` 开头的 meta 消息、`isMeta:true`、`<system-reminder>` 包裹的内容 → 隐藏。`[Request interrupted by user]`（实测：中断后 CLI 发一条 user 文本消息）→ `notice`（info，“已中断”），并把当前 assistant item 的 streaming 结束、未完成工具标 `interrupted`。图片块 → `images`（data URL）。
8. **result**：`result` → 追加 `result` item（durationMs、total_cost_usd、usage.input/output/cache_read、num_turns；`is_error` 或 subtype≠success → isError，文本来自 `result`/`errors` 字段；中断的 `error_during_execution` 标 interrupted），`status:'idle'`，结束所有 streaming，累加 totals；`contextTokens` 取最后一次 assistant 消息 usage 的 input+cache_read+cache_creation。
9. **system**：`init` → sessionId、activeModel、permissionMode、slashCommands、cwd；`status`（status: 'requesting'|'compacting'|null，可能带 permissionMode）→ cliStatus / permissionMode；`compact_boundary` → `compact` item；`api_retry` → notice（warning：“正在重试 (n/max)”）；`informational`/`notification` → notice；`local_command_output` → command-output item；`hook_*`、`thinking_tokens` 等不产生 item。**未知 type/subtype 一律忽略**。
10. `assistant` 消息带 `error` 字段（authentication_failed / rate_limit / billing_error / overloaded …）→ error notice，文案友好（未登录时提示“在终端运行 claude 并 /login”）。`auth_status` 带 error → error notice。
11. item/part 的 id 用消息 uuid / message.id+index / tool id 等稳定值（React key）。

`store/chats.ts`（WP-B）实现 `ChatsStore`：
- `newChat(cwd)`：chatId = `crypto.randomUUID()`，status 'new'，permissionMode/model/effort 取 settings 默认值。
- `openHistory(summary)`：chatId = sessionId；已在内存则只切换；否则 status 'loading'，调 `ember.history.load`，`buildFromHistory`，status 'idle'，historyLoaded true。
- `send`：乐观追加 user item（pending），status 'running'，`turnStartedAt`；调 `ember.session.send({chatId, cwd, resumeSessionId: sessionId, model, permissionMode, effort, text, images, uuid})`；失败 → status 'error' + error notice。收到任何该 chat 的 sdk 事件后把 pending 的 user item 置为非 pending。
- `ingest(event)`：按 kind 分发；sdk 消息用 `applySdkMessage`（live）。**性能**：流式 delta 很密，用 `requestAnimationFrame` 批量合并同一帧内的事件再 set 一次。
- `permission` 事件 → pendingPermissions 追加（按 requestId 去重）；`permission-cancelled` → 移除；`respondPermission` → 调 `ember.session.respond` 后从 pending 移除。
- `status` 事件 → status（'closed' 映射成 'idle'）；`session-id` → sessionId；`stderr` 忽略。
- 一轮结束（result）且窗口没聚焦、settings.notifyOnDone → `ember.sys.notify('Claude 已完成', 最后一段文字前 100 字, chatId)`。
- 启动时（App 调用）用 `ember.session.pending()` 恢复 pending 权限。

---

## 4. 视觉与交互规范（所有渲染层包必须遵守）

整体气质：安静、温暖、像在读一本排版好的书。大量留白，细边框，几乎不用阴影，动效克制（120–180ms，不弹跳）。

### 4.1 布局
- 左侧边栏 272px（`--bg-sidebar`），可 ⌘B 收起（收起时主区顶部左侧留出红绿灯位置 + 展开按钮）。侧边栏顶部 52px 为拖拽区，左侧留 78px 给红绿灯。
- 主区（`--bg-app`）：顶部 48px 标题栏（拖拽区）：左边对话标题（点击可重命名），右边项目路径小标签（文件夹图标 + 文件夹名，悬停显示完整路径，点击在 Finder 打开）、“在终端中打开”按钮（`claude --resume <sessionId>`）、上下文用量小圆环。
- 消息列：最大宽度 `--content-width`（760px），水平居中，左右 padding 32px；顶部 24px，底部给输入区留空间。
- 底部停靠区（与消息列同宽，居中）：自上而下 `<TaskPanel>`（有待办时）→ `<InteractionDock>`（有待确认时）→ Composer。底部留 20px。
- 新对话空状态：竖直居中的欢迎区：EmberSpark 图标 + 衬线大字问候（32px，font-weight 400，例：“下午好，Your Name” / “Good afternoon”，按本地时间 早上/下午/晚上），下面是 Composer（居中、宽 680px），Composer 下方一行：项目选择 chip（文件夹图标 + 名称 ▾，点开列出最近项目 + “选择其他文件夹…”）；再下面 3–4 个建议 chip（“解释这个项目的结构”、“找出并修复一个 bug”、“为最近的改动写测试”、“review 当前 git diff”），点击填入输入框。

### 4.2 消息
- **用户消息**：右对齐气泡，`--bg-user` 底，圆角 `--radius-xl`（16px），padding 10px 16px，最大宽度 85%，字体 `--font-ui` 15px 行高 1.55，`--text-1`；保留换行；图片缩略图（最大 240px 宽，圆角 8px，可点击放大）；pending 时 60% 不透明。斜杠命令显示为等宽字体 chip（`/compact`）+ 参数。悬停时气泡下方出现复制按钮。
- **助手回复**：无气泡、无头像；正文用 `--font-message`，字号 `--msg-font-size`（默认 16px），行高 `--msg-line-height`（1.7），颜色 `--text-1`。段落间距 0.9em。标题用衬线 600（h1 1.5em / h2 1.3em / h3 1.12em）。列表缩进 1.4em，列表项间距 0.3em。引用块：左边 3px `--border-2` 竖线，`--text-2`，斜体不要。表格：细边框 `--border-1`，表头 `--bg-hover` 底，单元格 padding 6px 12px，字体用 UI 字体 14px，横向可滚动。链接 `--accent-text` 下划线（offset 2px），点击走 `ember.sys.openExternal`。行内代码：`--font-mono` 0.88em，`--bg-inline-code` 底，`--text-inline-code` 颜色，圆角 4px，padding 1px 5px。hr 用 `--border-1`。
- **代码块**：`--bg-code` 底，圆角 `--radius-lg`，1px `--border-1` 边框；顶部 34px 头部栏：左语言名（小号 `--text-3`，UI 字体 12px），右复制按钮；代码 `--font-mono` 13px 行高 1.6，padding 14px 16px，横向滚动不换行。高亮主题要自己写一份暖色系 hljs 配色（浅色：关键字 `#a3482a`、字符串 `#4d7c3a`、数字 `#9a6414`、注释 `--text-3` 斜体、函数名 `#3b5f8a`、类型 `#7a4f9e`；深色相应提亮），放在 WP-B 的 CSS 里，用 `:root[data-theme='dark']` 区分。
- 回复末尾（一轮结束后）：一行淡色小工具条（悬停整个回复时显示，最后一条回复常显）：复制全文按钮、耗时（例“12.4s”）、tokens（↑1.2k ↓350）、settings.showCost 时显示费用。错误结果显示为红色 notice。
- **思考块**：默认折叠的一行：`Sparkles`/`Brain` 小图标 +“思考过程”（流式时“正在思考…” + 动态 token 数，文字带柔和的明暗扫光动画）；文本为空时显示“已思考 · 约 N tokens”，不可展开。展开后用 `--text-3` 小一号衬线斜体显示思考文本，左侧 2px 竖线。settings.showThinking=false 时完全不显示。
- **运行中指示**：当前轮在跑且最后一个 part 不是流式文字时，回复末尾显示 EmberSpark（动画）+ 状态文字（“正在思考…/正在运行 Bash…/正在压缩上下文…/正在请求…”）+ 已用时间（秒，每秒更新）。
- notice：居中的一行小字（UI 字体 12.5px，图标 + 文本），info `--text-3`、warning `--warning`、error 用 `--danger-soft` 底的圆角条带 `--danger` 字，可展开 detail。compact item：一条带文字的细分割线“上下文已压缩（120k → 18k tokens）”。
- 滚动：新内容到达时，若用户在底部附近（< 80px）自动跟随；用户上滑后停止跟随，并在右下角显示“↓ 回到底部”圆形按钮。切换对话时恢复到底部。长对话性能：每个 item 用 `content-visibility: auto; contain-intrinsic-size: auto 200px`。

### 4.3 工具调用（WP-C）
- **ToolRow**：助手回复中的一行（不是气泡），高 30px 左右：左 16px 图标（lucide，stroke 1.75，`--text-3`）+ 动词（UI 字体 13.5px `--text-2`）+ 目标（等宽 12.5px，`--text-1`，文件路径显示相对 cwd 的路径，过长中间省略）+ 右侧状态：运行中 Spinner / 耗时 / 错误红点 / 被拒绝“已拒绝”标签 + chevron。整行 hover `--bg-hover` 圆角 8px。点击展开 body（`--bg-surface-2` 底、1px `--border-1`、圆角 10px、左边距与图标对齐）。连续多个工具行之间间距 2px，与正文间距 10px。
- 动词与 body（中文示例）：
  - Bash：“运行” + 命令首行（或 input.description 作为副标题）；body：`$ command`（等宽加粗）+ 输出（stdout，stderr 用 `--danger` 色），超过 20 行折叠“显示全部 N 行”；`structured.interrupted`/超时标注。
  - Read：“读取” + 路径（有 offset/limit 时加“第 a–b 行”）；body：CodeBlock bare + 行号（来自 structured.file.startLine / content），最多 40 行可展开。图片读取显示缩略图。
  - Edit / MultiEdit：“编辑” + 路径 + `+N −M` 统计（绿/红小字）；body：DiffView。**Edit 行默认展开**（改动 ≤ 40 行时）。
  - Write：“创建”（structured.type==='create' 或无原文件）/“写入” + 路径 + `+N 行`；body：新建 → CodeBlock（语言由扩展名推断，最多 40 行）；覆盖 → DiffView。
  - Grep：“搜索” + `pattern`（+ 路径/glob）；body：结果文本（等宽，按文件分组如果能解析）。Glob：“查找文件” + pattern；body：文件列表。
  - WebSearch：“搜索网页” + query；WebFetch：“读取网页” + 域名；body：结果摘要文本（Markdown ui 变体）。
  - Agent / Task：“子代理” + description + subagent_type 小标签；body：子代理的 children parts（递归：text 用 Markdown ui 变体小一号，tool 用 ToolRow depth+1），完成后显示最终结果；异步运行中显示“后台运行中”+ progress.summary。
  - TaskCreate/TaskUpdate/TaskList/TodoWrite：**不单独占行**（或极简一行“更新了任务列表”），真实展示交给 TaskPanel。
  - ToolSearch：极简灰色一行“加载工具 X、Y”，不可展开。Skill：“使用技能” + skill 名。NotebookEdit：“编辑笔记本” + 路径。ExitPlanMode：渲染成“计划”卡片（Markdown 衬线正文，`--plan-soft` 左边框），状态：已批准/已拒绝。AskUserQuestion：渲染问题与用户选择的答案摘要。EnterPlanMode：灰色一行“进入计划模式”。
  - MCP 工具 `mcp__server__tool`：“server · tool”（去掉 mcp__ 前缀，下划线转空格）；其它未知工具：工具名。body：输入参数（key: value 列表，长值折叠）+ 输出文本。
  - tool_result 的 content 可能是字符串或 `[{type:'text',text}]` / image 块数组，都要处理。
- **DiffView**：优先用 `structured.structuredPatch`（`[{oldStart,oldLines,newStart,newLines,lines:[' ctx','-del','+add']}]`）；没有时（历史或 MultiEdit）用 `diff` 包 `structuredPatch(old_string, new_string)` 自己算。统一视图：两列行号 + 符号列 + 代码（等宽 12.5px 行高 1.55）；增行 `--diff-add-bg`、删行 `--diff-del-bg`，相邻删/增行对做词级高亮（`diffWordsWithSpace`，强色 `--diff-*-strong`）；hunk 之间显示 `⋯` 分隔。顶部路径条 + 统计 + 复制新内容按钮。
- **TaskPanel**（底部停靠）：有 todos 时显示一个可折叠卡片（`--bg-surface`、边框、圆角 12px）：标题“任务 2/5”+ 进度细条（`--accent`）；展开列表：每项圆形状态图标（pending 空心圈 `--text-4`、in_progress 橙色 Spinner 或实心半圆、completed 绿色勾）+ 文本（in_progress 显示 activeForm 并加粗，completed 删除线 `--text-3`）。全部完成 5 秒后自动折叠成一行“✓ 全部 N 个任务已完成”。
- **InteractionDock**：显示该 chat 最早的一个 pending 请求（多个时标“还有 N 个待确认”）。卡片：`--bg-surface` 底，1px `--accent-soft-border` 边框，左侧 3px `--accent` 竖条，圆角 14px，阴影 `--shadow-md`，出现时 150ms 淡入上移。
  - 普通权限卡：标题 = request.title || 按工具生成（“Claude 想要运行命令” / “Claude 想要编辑 foo.ts” / “Claude 想要创建 bar.md” …），description 作副标题；预览：Bash → 等宽命令块；Edit/Write → DiffView/CodeBlock 预览（最多 20 行，可展开）；其它 → 参数列表。按钮行：主按钮“允许”（Enter）、次按钮“本次会话都允许”（仅当 suggestions 非空且 !suppressAlwaysAllow；hover tooltip 说明将应用的规则，例如“切换到自动接受编辑模式”）、“拒绝”（Esc）；拒绝旁有小链接“告诉 Claude 怎么做…”展开一个输入框，提交即 deny + message。defaultToNo 时焦点默认在拒绝。键盘快捷键仅在该卡片可见且焦点不在其它输入框时生效（Composer 为空时也允许）。
  - AskUserQuestion 卡：逐题显示 header 标签 + 问题（衬线 15px）+ 选项按钮（单选 radio 样式卡片 / 多选 checkbox 样式；label 粗体，description 小字；有 `preview` HTML 时在选项下方用 `<iframe sandbox="" srcdoc>` 渲染，最大高 240px）+ “其他”自由输入框。多题时分页或纵向排列都可。提交 → allow，`updatedInput = {...input, answers: {[question文本]: 选中label（多选用 ", " 连接）或自由输入文本}}`。另有“跳过/拒绝回答”→ deny message“The user declined to answer.”。
  - ExitPlanMode 卡（计划审批）：标题“Claude 制定了计划，是否开始执行？”；计划正文 `input.plan`（Markdown 衬线，最大高 360px 可滚动）；按钮：“批准并自动接受编辑”（switchToMode: 'acceptEdits'，主按钮）、“批准，逐项确认”（switchToMode: 'default'）、“继续完善计划”（展开输入框写修改意见 → deny + message）。

### 4.4 Composer（WP-D）
- 卡片：`--bg-surface` 底，圆角 `--radius-2xl`（20px），阴影 `--shadow-composer`，无粗边框；focus-within 时阴影稍加深（不要蓝色描边）。内边距 12px 14px 10px。
- 文本框：无边框、透明底，UI 字体 15px 行高 1.55，占位符 `--text-3`（“回复 Claude…”/新对话“今天想让 Claude 帮你做什么？”）；自动增高 1–12 行，超出内部滚动。
- 底部工具行（高 32px）：左侧：`+` 附件按钮（选图片）、权限模式 pill（图标 + 名称：默认“逐项确认”、acceptEdits“自动接受编辑”、plan“计划模式”（紫色 `--plan`）、auto“自动模式”、bypassPermissions“跳过所有权限”（`--danger` 色，选择时二次确认））；右侧：模型选择（文字 + chevron，无边框，菜单里列出 env.models 的 displayName + description，勾选当前；若模型 supportsEffort，菜单底部有“思考强度”分段：默认/低/中/高/超高/最大）、发送按钮（32×32 圆角 10px，`--accent` 底白色向上箭头；输入为空时 `--bg-active` 底 `--text-4` 箭头禁用）；运行中且输入为空时发送按钮变成停止按钮（`--text-1` 底白色方块图标，点击 interrupt）；运行中有输入时仍可发送（CLI 会排队）。
- 键：settings.sendKey==='enter' 时 Enter 发送、Shift+Enter 换行；否则 ⌘Enter 发送。输入法组合中（isComposing）不发送。Esc：运行中则中断；空闲时失焦。↑ 在空输入框时填入上一条用户消息。
- `/` 开头 → 命令菜单（弹出在输入框上方，`--shadow-popover`，最多 8 行可滚动）：列出 env.commands（和当前会话 slashCommands 合并去重），每行 `/name`（等宽）+ argumentHint（淡色）+ description（截断）；输入过滤；↑↓ 选择，Enter/Tab 补全（补全为 `/name `）。
- `@` → 文件菜单：调 `ember.files.suggest(cwd, query)`（防抖 120ms），选中插入 `@相对路径 `。
- 粘贴图片 / 拖入图片 → 附件缩略图条（64px 方块，圆角 8px，右上角 × 移除）；拖入非图片文件 → 插入 `@绝对路径`。最多 10 张。
- 草稿按 chat 保存（store.setDraft）。

### 4.5 侧边栏（WP-D）
- 顶部：拖拽区；右侧“收起侧边栏”图标按钮；下方品牌行：EmberSpark（静态）+ “Ember”（衬线 18px 600）。
- “新对话”按钮：整行宽，左 `Plus` 圆形小图标（`--accent` 底白色），文字“新对话”，hover `--bg-hover`，快捷键提示 ⌘N 淡色。
- 搜索框（⌘K 聚焦）：`Search` 图标 + “搜索对话”，透明底，focus 时 `--bg-surface`。按标题/首条消息/项目名过滤。
- 项目筛选：一行小 chip“全部项目 ▾”，菜单列出会话里出现过的 cwd（按最近使用排序，显示文件夹名 + 淡色父路径）。
- 会话列表：按 今天/昨天/过去 7 天/过去 30 天/更早 分组（组标题 11.5px `--text-3` 600 大写间距）。行：高 34px，圆角 8px，padding 0 10px，标题单行省略（13.5px `--text-1`）；hover 时右侧出现 `⋯` 菜单（重命名、在 Finder 中显示项目、在终端中继续（`claude --resume id`）、复制会话 ID、删除（二次确认））；选中行 `--bg-selected`。活会话运行中：标题前 6px `--accent-brand` 圆点呼吸动画；有待确认：`--accent` 小徽标“需确认”。当前内存中但尚未落盘的新对话也显示在“今天”顶部。
- 底部账号区：分隔线；圆形头像（首字母，`--accent-soft` 底 `--accent-text` 字）+ 名称（displayName || email 前缀）+ 小字 email/套餐（subscriptionType，如“Claude Max”）；右侧设置齿轮。有 rateLimits 时在上方显示两条细进度条：“5 小时 45%”“7 天 30%”（>80% 变 `--warning`，rejected 变 `--danger`，悬停显示重置时间）。

### 4.6 设置对话框（WP-D）
居中模态（560px 宽，圆角 16px，`--shadow-popover`，遮罩 `--bg-overlay`），左侧分类导航（外观 / 通用 / Claude Code / 关于），右侧内容：
- 外观：主题（浅色 / 深色 / 跟随系统，三张小预览卡）、回复字体（Claude 衬线 / 衬线+苹方 / 无衬线，带示例文字预览）、回复字号滑块 14–20。
- 通用：语言（跟随系统 / 中文 / English）、发送键（Enter / ⌘Enter）、完成时通知、显示思考过程、显示费用。
- Claude Code：CLI 路径（显示当前检测到的路径 + 版本，“更改…”选文件、“自动检测”恢复、“重新检测”）；账号（email、组织、套餐、apiProvider）；默认模型；默认权限模式；默认思考强度。说明文字：“Ember 直接使用你本机 Claude Code 的登录状态和配置（~/.claude），不会上传任何数据。”
- 关于：图标、版本、简介、日志文件位置（点击在 Finder 显示）。

### 4.7 启动/引导（WP-D，SetupScreen）
env.state：`checking` → 全屏居中 EmberSpark 动画 +“正在连接 Claude Code…”；`no-cli` → 卡片：标题“没有找到 Claude Code CLI”，说明 + 安装命令（可复制）：`curl -fsSL https://claude.ai/install.sh | bash`，以及 npm 方式 `npm install -g @anthropic-ai/claude-code`；按钮“重新检测”、“手动选择 claude 路径…”；`not-logged-in` → “Claude Code 还没有登录”，步骤：打开终端 → 运行 `claude` → 输入 `/login` 完成登录 → 回到这里点“重新检测”；按钮“打开终端”（openInTerminal(home, 'claude')）、“重新检测”；`error` → 错误详情（可展开）+ 重新检测。卡片风格与整体一致（衬线标题 24px）。**不做任何登录表单。**

### 4.8 快捷键与菜单（WP-D 在渲染层实现）
⌘N 新对话；⌘K 搜索；⌘, 设置；⌘B 侧边栏；⌘L 聚焦输入框；Esc 中断（运行中）；⌘O 打开项目文件夹（新对话并选文件夹）。菜单命令通过 `ember.sys.onMenuCommand` 进来，与键盘快捷键走同一处理函数（避免重复触发：键盘快捷键只在渲染层监听那些菜单里没有 accelerator 的键，或全部交给菜单 accelerator —— 二选一，推荐全部由菜单 accelerator 触发，渲染层只处理 Esc）。

### 4.9 主题与字体应用（WP-D）
`<html data-theme="light|dark">`（system 时跟随 `matchMedia('(prefers-color-scheme: dark)')` 并监听变化）、`data-msgfont="claude|mixed|sans"`、`style="--msg-font-size: 16px"`。语言：`useLang.setLang(resolveLang(settings.language))`。

---

## 5. 质量要求（每个包自测）
- `npm run typecheck` 必须 0 错误（至少自己负责的文件 0 错误；别人的 stub 不报错）。
- `npm run build` 必须成功。
- WP-B：`store/reducer.test.ts`（vitest，`npx vitest run`）用 `docs/fixtures/*.jsonl` 回放每个场景，断言：assistant item 数、tool 数与状态、todo 结果（todo 场景结束时 3 项全 completed）、ask/plan 的工具状态、interrupt 产生 notice、流式文字不重复。
- WP-A：写 `scripts/smoke-main.mjs`（playwright-core `_electron`，env 只给 HOME/USER/PATH=/usr/bin:/bin 模拟 Finder 启动），验证 env.get() 为 ready、history.list() 有数据、在临时目录 send 一条 “Reply with exactly: PONG”（model 'haiku'）并收到 result 事件。
- 渲染层包：用 fixtures 做一个开发用“演示模式”不是必须的；但要保证组件在空数据、超长文本、深色主题下不崩、不溢出。
- 不要留 console.log 调试输出（主进程日志用 log.ts）。
- 代码风格：TypeScript strict，函数组件 + hooks，prettier 风格（2 空格、单引号、无分号、行宽 120）。注释简洁，只写“为什么”。
