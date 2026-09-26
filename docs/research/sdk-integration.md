# Agent SDK 集成指南（给 Ember 的 Electron 主进程用）

版本基准：`@anthropic-ai/claude-agent-sdk` **0.3.283**（对应 CLI 2.1.283）。
来源：逐行读了 `docs/sdk/sdk.d.ts`（9833 行）和 `docs/sdk/sdk-tools.d.ts`（4153 行），
用 WebFetch 核对了 code.claude.com 的 permissions / user-input / streaming-vs-single-mode / slash-commands 四篇官方文档，
另外对 `.d.ts` 没写清楚的两处默认值，直接 `grep` 了 `ember/node_modules/@anthropic-ai/claude-agent-sdk/{sdk,core}.mjs` 里的压缩后源码逐行核实（见 §2 里的引用）。
文中标了 **[UNVERIFIED]** 的地方是源码、`.d.ts` 和官方文档三者都没写清楚、只能靠通用 Node.js/Electron 常识推断的部分。

---

## 0. 一句话地图

- 一个会话 = 一次 `query({ prompt, options })` 调用，返回一个 `Query` 对象。
- `Query` 既是 `AsyncGenerator<SDKMessage, void>`（`for await` 读消息流），又挂了一堆控制方法（`interrupt()`、`setPermissionMode()`、`close()`……）。
- 要做「一直开着、能连续对话」的 GUI，`prompt` 必须传 `AsyncIterable<SDKUserMessage>`（流式输入），不能传字符串（字符串是一次性单轮模式）。
- 权限确认 UI 全部走一个回调：`canUseTool`。`AskUserQuestion`（澄清问题）和 `ExitPlanMode`（计划审批）**不是**单独的通道，它们本质上也是"工具调用"，一样从 `canUseTool` 里冒出来，靠 `toolName === 'AskUserQuestion'` 分支处理。
- `onUserDialog` 是另一条独立通道，只用于 `request_user_dialog` 这类协议级弹窗（比如模型拒答后的 fallback 确认），跟工具权限无关。

---

## 1. 流式输入 + 长连接会话

### 1.1 类型

```ts
// sdk.d.ts:3237
export declare function query(_params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
}): Query;

// sdk.d.ts:2843
export declare interface Query extends AsyncGenerator<SDKMessage, void> {
    interrupt(): Promise<SDKControlInterruptResponse | undefined>;
    setPermissionMode(mode: PermissionMode): Promise<void>;
    setModel(model?: string): Promise<void>;
    streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
    close(): void;
    // ...还有 initializationResult()/supportedModels()/mcpServerStatus() 等，见后面章节
}
```

`SDKUserMessage`（sdk.d.ts:6149）本质是一层薄包装：

```ts
export declare type SDKUserMessage = {
    type: 'user';
    message: MessageParam;           // Anthropic Messages API 的标准 user message
    parent_tool_use_id: string | null; // 顶层对话固定传 null
    uuid?: UUID;                     // 建议自己生成一个，用于把回复对应回这条发送
    shouldQuery?: boolean;           // false = 只追加进 transcript，不触发新一轮回复
    client_composed?: true;          // 见 1.5
    priority?: 'now' | 'next' | 'later';
    timestamp?: string;
};
```

`MessageParam`（来自 `@anthropic-ai/sdk/resources`，标准 Anthropic content block）决定了 `message.content` 可以是字符串，也可以是 block 数组：`text` / `image` / `document`。**图片必须放在这里**，不是单独的字段。

### 1.2 一直开着的输入迭代器（Ember 需要的核心模式）

`.d.ts` 里官方例子（以及官方文档 streaming-vs-single-mode）给的都是"提前写好几条 yield、跑完就完"的 `async function*`，不适合聊天 GUI（GUI 不知道用户下一句话什么时候来）。要做成"用户随时可以在输入框敲字发消息"，标准做法是自己写一个**异步队列**当生成器喂给 `query()`：

```ts
// main/claudeSession.ts
class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolvers: Array<(v: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(msg: SDKUserMessage) {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: msg, done: false });
    else this.queue.push(msg);
  }

  end() {
    this.closed = true;
    // 唤醒所有还在等的 next()，让迭代器正常结束（而不是挂死）
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}

const inputQueue = new AsyncMessageQueue();
const q = query({ prompt: inputQueue, options: { /* ... */ } });

// 用户在输入框按下发送：
inputQueue.push({
  type: 'user',
  message: { role: 'user', content: userText },
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
});

// 读消息流（务必在 result 之后继续 for-await，不然 prompt_suggestion 等收不到）
for await (const msg of q) {
  mainWindow.webContents.send('claude:message', msg);
}
```

关键点：

- `AsyncMessageQueue` 这个类是我自己按 AsyncIterable 协议写的，**不是** SDK 自带的东西——SDK 没有导出任何官方的 queue 工具类，`.d.ts` 里搜不到。做法本身是标准 JS async iterator 模式，没有 SDK 特有的坑，但请把它当作"我方代码"而非"SDK 提供的 API"来标注。
- 只要 queue 不 `end()`，`for await (const msg of q)` 就会一直挂着等下一条消息——这就是"长连接会话"的本质：Node 子进程一直活着，stdin 没关，模型可以在任意时刻收到新的用户消息并开始新一轮。
- 多条消息挤在一起发送时，CLI 会把它们合并成一轮（`SDKAssistantMessage.user_message_uuids` 数组，最后一条的 uuid 是 `user_message_uuid`），所以 GUI 侧用 `user_message_uuid`/`user_message_uuids` 而不是"哪条先发"来对账。

### 1.3 关闭会话（三种方式，语义不同）

| 方式 | 效果 |
|---|---|
| `inputQueue.end()`（让迭代器 `done: true`） | 只是让输入流结束；CLI 侧行为取决于 CLI 版本，**不保证**立刻杀进程——偏"优雅收尾" |
| `query.close()` | `Query` 接口文档原文：*"Close the query and terminate the underlying process. This forcefully ends the query, cleaning up all resources including pending requests, MCP transports, and the CLI subprocess."* → **这是 Ember 应该在"关闭标签页/退出应用"时调用的方法** |
| `options.abortController.abort()` | 传入的 `AbortController`，主动 `abort()`。`SpawnOptions.signal` 注释说明：这个信号会先走"stdin EOF → `GRACEFUL_EXIT_TIMEOUT_MS`（约 2 秒）宽限期"再真正杀进程，除非你自定义了 `spawnClaudeCodeProcess`。**普通用法下 abort 是"温和终止"，不是立杀** |

推荐组合：正常"结束这个会话"用 `query.close()`；如果要在应用退出时确保子进程真的没了，额外监听不到 `exit` 事件时兜底 `process.kill(pid, 'SIGKILL')`（见 1.6）。

补充一点：`Query` 本身继承自 `AsyncGenerator<SDKMessage, void>`，所以理论上消费方也能调用生成器协议自带的 `q.return()` 来"从读取侧结束迭代"。但 `.d.ts` 里没有任何地方说明 `return()` 会连带杀掉底层子进程——它更像是"我不想再读这个流了"的信号，具体有没有清理副作用没有文档保证 **[UNVERIFIED]**。Ember 不要依赖 `q.return()` 做资源清理，统一用文档明确写了清理语义的 `close()`。

`interrupt()` **不是**关闭会话，是"打断当前这一轮回复"（相当于终端里按 Esc/Ctrl+C 打断当前 turn），会话本身还活着，可以继续对话：

```ts
const receipt = await q.interrupt();
// CLI 支持 interrupt_receipt_v1（见 system/init.capabilities）时返回
// { still_queued: string[] }：还没被这次 interrupt 打断、之后仍会跑的排队消息 uuid
// 老版本 CLI 直接 resolve 成 undefined
```

`interrupt()` 只在**流式输入模式**下可用（字符串 prompt 模式没有这个方法能调的意义，因为进程跑完一轮就退出了）。

### 1.4 检测进程死亡

SDK 没有直接把"子进程对象"暴露给普通调用方（除非你自己实现了 `Options.spawnClaudeCodeProcess`，那样才能拿到 `SpawnedProcess`，可以 `.on('exit', ...)` / `.on('error', ...)`）。默认走内置的 `pathToClaudeCodeExecutable` 本地 spawn 时，检测手段是：

1. `Options.stderr?: (data: string) => void` —— 捕获所有 stderr 原始文本，崩溃/启动失败的诊断信息基本都在这里。GUI 应该始终挂上这个回调，写到本地日志文件，用户报 bug 时能拿到。
2. `for await (const msg of q)` 循环本身：如果进程异常退出，`next()` 的 promise 会 reject，`for await` 会抛异常——**用 try/catch 包住整个消费循环**。
3. 正常退出路径下会先收到一条 `SDKResultMessage`（`type:'result'`），其中 `error_during_execution`/`startup_failure_reason` 字段（见 sdk.d.ts:5610-5664）说明失败原因；这是"进程还活着但这一轮失败了"，跟"进程真的挂了"要分开处理。
4. `Options.debug` + `Options.debugFile` 可以打开更详细的调试日志文件，故障复现时有用。

**[UNVERIFIED]** `.d.ts` 没有专门给"普通用法下如何拿到子进程 PID/exit code"的 API；如果 Ember 需要在任务管理器里显示"claude 进程存活"或做强制清理，唯一可靠的路子是自己传 `spawnClaudeCodeProcess`，包一层 Node `child_process.spawn`，自己持有 `ChildProcess` 引用（见下面 1.6 和第 8 节的僵尸进程问题）。

### 1.5 `client_composed` 要不要开

`Options`/`SDKUserMessage` 都有 `client_composed?: true`（session 级用 `verbatimPrompts`，单条消息级用 `client_composed`）。开启后 CLI 原样发送文本，**跳过** `@path` 文件提及展开和 slash 命令分发，也跳过整个"轮次开始附件传递"（CLAUDE.md、skill 列表、提醒等改成在工具调用之间才附带，而不是随第一条消息附带）。

Ember 的场景（用户在输入框里手动打字）应该**保持默认关闭**——用户可能真的想用 `/compact`、`@somefile.ts` 这类语法，关掉这些会让 GUI 手感跟真实 CLI 不一致，违背"套壳"的初衷。只有当 GUI 自己拼接了用户没有输入过的内容（比如把一个文件选择器的结果拼进 prompt）时才该对**那一条**消息单独打 `client_composed: true`。

### 1.6 僵尸进程与优雅退出 [UNVERIFIED 部分见标注]

- Electron `app.on('before-quit')` / `app.on('will-quit')` 里必须对所有活跃 `Query` 调 `close()`，并等一小段时间再放行退出，否则窗口关了但 `claude` 子进程还在后台跑。
- `close()` 的文档只说会清理"pending requests, MCP transports, and the CLI subprocess"，但没写清楚它是发 SIGTERM 还是直接 kill，也没写超时时间 **[UNVERIFIED]**。保险做法：`close()` 之后设一个几秒的兜底定时器，如果本地还能查到对应 PID 存活再补一刀 `SIGKILL`——但要注意这个"查 PID"本身就需要前置条件：默认走内置 spawn 时普通调用方拿不到子进程 PID（见 1.4），**必须先按 1.4 节说的自己实现 `spawnClaudeCodeProcess` 包一层 `child_process.spawn`，自己持有 `ChildProcess` 引用**，才谈得上"兜底 SIGKILL"这一步；如果 Ember 没有做这层包装，`close()` 就是唯一能用的清理手段,没有更强的兜底可用。
- macOS 上 Electron 打包后子进程默认**不会**在父进程被系统强杀（如崩溃、`kill -9` App）时自动清理，这是常见 Electron 通病，不是这个 SDK 特有的坑，但 Ember 作为长驻 GUI 必须自己处理。

---

## 2. `Options` 里跟 GUI 强相关的字段（sdk.d.ts:1518-2442）

先回答核心问题：**要让 SDK 会话跟交互式 CLI 行为完全一致，需要什么？**

`Options.settingSources` 的官方注释原文：

> When omitted, all sources are loaded (matches CLI defaults). Pass `[]` to disable filesystem settings (SDK isolation mode). Must include `'project'` to load CLAUDE.md files.

**结论：什么都不传（不设置 `settingSources`）就是跟 CLI 完全一致**，不需要显式写 `['user','project','local']`。只要 Ember 显式传了这个字段（哪怕只是为了别的目的），就必须记得三个都塞进去，否则会悄悄丢 CLAUDE.md/skills/项目设置。`skills`/`plugins`/`mcpServers` 也是同理：不显式设置就是"CLI 默认全都要"；一旦显式设置了 `skills: [...]`，就变成白名单模式。

逐项过一遍：

| 字段 | 作用 | Ember 建议 |
|---|---|---|
| `pathToClaudeCodeExecutable` | 指定要 spawn 的 `claude` 二进制路径 | **必须设**，指向用户系统上已登录的 CLI（`~/.local/bin/claude` 或 `which claude` 探测到的路径），这样认证（keychain OAuth / API key）、`settings.json`、skills、MCP、plugins 全部沿用 CLI 自己的 |
| `executable` | Node/bun/deno 运行时选择 | 不设，让它自动探测；Ember 打包后跑在系统 Node 之外，不用管这个 |
| `env` | **完全替换**子进程环境变量（不是合并！） | 一定要 `{ ...process.env, ... }` 展开后再传，否则 `PATH`/`HOME`/`ANTHROPIC_API_KEY` 全丢。见第 8 节的环境变量清理问题 |
| `cwd` | 会话工作目录 | 对应 Ember 的"项目/文件夹选择器"当前选中的目录 |
| `resume` / `continue` / `forkSession` | 恢复/继续/分支会话 | 见第 5 节 |
| `model` / `fallbackModel` / `effort` / `thinking` | 模型、效果等级、思考模式 | UI 上做成模型选择器 + 效果滑杆，运行时用 `query.setModel()` 而不是重启会话（见第 6 节） |
| `permissionMode` / `allowDangerouslySkipPermissions` | 权限模式 | 见第 4 节；GUI 默认应该是 `'default'`，不建议默认 `bypassPermissions` |
| `canUseTool` | 权限/澄清问题回调 | 见第 4 节，Ember 的核心交互 |
| `includePartialMessages` | 打开 `stream_event` 流式增量 | **Ember 必须开**，否则文字是"一整块蹦出来"而不是逐字流式渲染，跟 CLI 手感不一致 |
| `includeHookEvents` | 打开 `hook_started`/`hook_progress`/`hook_response` | 可选；只有 Ember 想在 UI 里显示 hook 执行细节才开 |
| `forwardSubagentText` | 子 agent 的文字/thinking 也转发出来 | 建议开，Task 工具产生的子对话才能在 UI 里渲染成嵌套对话，而不只是心跳计数 |
| `agentProgressSummaries` | 后台子任务的一句话进度摘要 | 建议开，配合任务列表 UI 显示"正在分析认证模块"这种状态行 |
| `settingSources` | 见上 | 不设（默认即 CLI 行为）；除非 Ember 要做"沙箱/隐身模式"才显式收窄。这条默认值有一条间接但比较有力的证据：`sdk.mjs` 压缩源码里 SDK 自带的 `resolveSettings()`（进程内直接解析设置、不经过 CLI 子进程的那个 API）硬编码了 `z0e=["user","project","local"]` 作为 `e.settingSources??z0e` 的回落值。**但这只是 `resolveSettings()` 这一个 API 的实现**——`query()` 走的是另一条路径（`Gr`/`lA` 那两个函数），会把 `settingSources` 原样（包括 `undefined`）转发进发给 CLI 子进程的 initialize 请求，真正的默认值解析发生在 `claude` 二进制那一侧，不在这份 npm 包的可读代码里。`resolveSettings()` 里硬编码的三元数组跟 `.d.ts` 注释"省略时全部加载"是吻合的，可以当作强旁证，但**不是对 `query()` 路径的直接证明** |
| `systemPrompt` | 系统提示词 | **不能假设"不设 = CLI 默认的 claude_code 预设"**——`.d.ts` 没写省略时的行为，我 grep 了本地 `node_modules/@anthropic-ai/claude-agent-sdk/core.mjs` 的压缩源码核实过：解析这个字段的函数里，`preset` 分支要满足 `p.type==="preset"` 才会给 `append`/`excludeDynamicSections`/`snapshot` 赋值；而**省略时走的是 `if(p===void 0)k=""` 这一支**，根本没进 `preset` 分支，三个字段全部保持 `undefined`。往下一层，序列化成发给 CLI 子进程的 `initialize` 请求时是 `systemPrompt:typeof x==="string"?[x]:x`——`k=""` 是字符串,所以会序列化成 `[""]`。到这里为止是我实际读到的代码，**可以确认的结论只是**："省略 `systemPrompt` 不会走向 preset 预设分支，SDK 侧解析出的中间值是空字符串"。至于这个 `[""]` 传到 `claude` 二进制之后，CLI 端是"就当空系统提示词处理"还是"自己再兜底成默认预设"，那部分逻辑在 CLI 二进制里，这份 npm 包不包含其可读源码，**[UNVERIFIED]**——我没有证据证明最终效果是哪种。保险起见：**Ember 应该显式设置** `systemPrompt: {type:'preset', preset:'claude_code', snapshot:true}`（要加门面话就再带上 `append`），不要依赖省略这个字段去猜 CLI 端最终会不会兜底 |
| `additionalDirectories` | 额外可访问目录 | 对应 Ember 的"添加文件夹"功能 |
| `stderr` | stderr 回调 | 必须挂，见 1.4 |
| `enableFileCheckpointing` | 开启文件回滚 | 建议开，配合 `query.rewindFiles()` 做"撤销 Claude 这一步的文件改动"按钮 |
| `abortController` | 会话级取消 | 每个会话自己建一个 `AbortController`，`close()` 之外的强制取消手段 |
| `maxTurns` / `maxBudgetUsd` | 轮数/预算硬上限 | Ember 大概不需要设，除非要做"每次对话最多花 $X"的护栏 |
| `extraArgs` | 传给 CLI 的额外 `--flag` | 兜底逃生舱，`.d.ts` 覆盖不到的新 CLI 参数可以从这里塞 |
| `mcpServers` / `strictMcpConfig` / `plugins` / `pluginDelivery` | MCP/插件 | 不设 = 沿用用户在 CLI 里配置好的一切（项目 `.mcp.json`、用户配置、插件市场）。Ember 不需要自己管理这些，**这正是"套壳"最省事的地方** |
| `toolConfig.askUserQuestion.previewFormat` | AskUserQuestion 选项预览格式 | **Ember 应该设成 `'html'`**（默认是 `'markdown'`，是给终端用的）。见第 4 节 |
| `onUserDialog` + `supportedDialogKinds` | 协议级弹窗 | 见第 7 节 |
| `persistSession` | 是否写入 `~/.claude/projects/` | 默认 `true`，保持默认，这样才能用 `listSessions()` 在 GUI 侧边栏里列出历史会话 |
| `title` | 新会话标题 | 对应 Ember 侧边栏的会话标题；resume 已有会话时这个字段不生效，用 `renameSession()` 改名 |

一个"完全等价于交互式 CLI"的最小 `Options` 骨架：

```ts
const options: Options = {
  pathToClaudeCodeExecutable: claudeBinPath,      // 探测得到（见第 8 节：必须用登录 shell 的 PATH 去探测，不能用 Finder 启动时的裸 PATH）
  cwd: projectDir,
  env: { ...loginShellEnv },                       // 展开登录 shell 环境，别用 Electron 主进程自带的裸 process.env（见第 8 节）
  systemPrompt: { type: 'preset', preset: 'claude_code', snapshot: true }, // 显式设置，别依赖"省略=默认预设"（见上表，已用源码验证省略时是空字符串）
  settingSources: ['user', 'project', 'local'],    // 显式写全三个，保证"总是允许"写的 localSettings 规则真的会被读回来
  includePartialMessages: true,
  forwardSubagentText: true,
  agentProgressSummaries: true,
  enableFileCheckpointing: true,
  toolConfig: { askUserQuestion: { previewFormat: 'html' } },
  canUseTool: myCanUseTool,
  stderr: (data) => log.append(data),
  abortController: sessionAbort,
  // skills / mcpServers / plugins 不设 = 跟 CLI 一致（这几个字段的"省略=全部"已经在 skills 官方文档里核实过，见文末链接）
};
```

---

## 3. `SDKMessage` 全家桶：GUI 该怎么渲染每一种

`SDKMessage` 联合类型（sdk.d.ts:5273）一共 39 个变体（原稿写成 37，逐个数了一遍是 39，见文末 Reviewer notes）。下面按"GUI 渲染桶"分组说明，重点讲字段含义和拼接逻辑（`.d.ts` 里每个类型的完整字段清单已经在上面几次 Read 里摘录过，这里只挑 GUI 要用的关键字段）。

### 3.1 对话主线：assistant / user / stream_event / result

这四种是聊天气泡的核心数据来源，关系如下：

```
system/init (每轮开头)
  → stream_event (type:'stream_event', 增量, 仅 includePartialMessages 时有)
      content_block_start → content_block_delta(text_delta/thinking_delta/input_json_delta) → content_block_stop
  → assistant (type:'assistant', 完整的一个 content block)
  → user (type:'user', 如果这轮有工具调用, 携带 tool_result)
  → ...（工具调用会形成 assistant→user→assistant→user 的循环）
  → result (type:'result', 这一轮结束)
```

**关键事实（sdk.d.ts:3600 注释原文翻译）**：流式过程中，CLI 每完成一个 content block 就发一条 `SDKAssistantMessage`，所以**一轮回复里可能有好几条 `assistant` 消息共享同一个 `message.id`**，每条的 `message.content` 只装那一个 block（比如第一条只有 `thinking` block，第二条只有 `text` block，第三条只有 `tool_use` block）。这几条消息的 `message.stop_reason` 都是 `null`、`message.usage` 都不是最终值——**真正的 stop_reason 和总 usage 要等 `result` 消息**。

`stream_event`（`SDKPartialAssistantMessage`，sdk.d.ts:5422）和上面这些完整 `assistant` 消息的关系：`stream_event.event` 就是标准 Anthropic Messages API 的流式事件（`message_start`/`content_block_start`/`content_block_delta`/`content_block_stop`/`message_delta`/`message_stop`），**完整的 assistant 消息仍然会在流结束后单独发一条**——也就是说，你可以选择只用 `stream_event` 做逐字渐显动画，最终定稿内容以后续的 `assistant` 消息为准（更省事、更权威），或者反过来只用 `assistant` 消息、完全不处理 `stream_event`（没有逐字动画但更简单）。**不要把两者的文字加起来**，会重复。

拼接建议（Ember 的渐显动画）：

```ts
// 按 message.id 分组 assistant 消息；stream_event 只用来驱动"正在打字"动画
// 用 event.index（content_block 的下标）+ delta 拼字符串，
// text_delta.text 累加、thinking_delta.thinking 累加、
// input_json_delta.partial_json 累加后在 content_block_stop 时 JSON.parse 得到完整 tool_use.input
```

`parent_tool_use_id`：非 null 时说明这条消息是某个子 agent（Task 工具）内部产生的，值是发起该子任务的 `tool_use` 的 id——GUI 据此把消息渲染进"子任务折叠面板"而不是主时间线（配合 `forwardSubagentText`）。

`tool_use`/`tool_result` 配对：`assistant` 消息里的 `tool_use` block 有 `id`；紧随其后的 `user` 消息里对应的 `tool_result` block 用同一个 `id`（标准 Anthropic 用法）。`SDKUserMessage.tool_use_result`（sdk.d.ts:6158）额外提供**结构化**的完整工具输出对象（按工具名对应到 `sdk-tools.d.ts` 里的 `*Output` 类型，比如 `FileReadOutput`、`BashOutput`），比解析 `tool_result` 里给模型看的纯文本更适合渲染富 UI（比如 Bash 输出高亮、Read 输出加行号）。`tool_result` 的 `content` 可以是字符串或 block 数组，`is_error?: boolean` 标记这次调用失败。

**易踩坑：CLI 会把你刚发的用户消息原样回放一遍**——除了你自己 push 进输入队列的那条 `SDKUserMessage`，流里稍后还会收到一条 `type:'user'` 但 `isReplay: true` 的 `SDKUserMessageReplay`（sdk.d.ts:6237），字段基本跟 `SDKUserMessage` 一样，多了确定性的 `uuid: UUID`（服务端/CLI 侧最终确认的 uuid，不是必然等于你本地生成的那个）和 `session_id`。**如果不去重，用户自己发的每条消息会在 GUI 里渲染两遍**（一遍是本地"乐观渲染"，一遍是这条回放）。正确做法：发送时用本地生成的 `uuid` 乐观渲染一个"发送中"气泡；收到 `isReplay:true` 的回放后，按 `uuid` 匹配到那条气泡，只把状态改成"已送达"（并把回放里权威的 `uuid`/`session_id` 记下来，后面 `forkSession({upToMessageId})`、`rewindFiles(userMessageId)` 都需要这个权威 uuid），**不要**再插入一条新气泡。

`result` 消息（`SDKResultSuccess`/`SDKResultError`，sdk.d.ts:5610-5735）是"这一轮彻底结束"的信号，之后 GUI 应该：把输入框重新变成可发送状态、显示 `total_cost_usd`/`usage`、如果 `is_error` 就用红色提示条展示 `errors`/`result`。**注意**：`result` 之后可能还会来 `prompt_suggestion`（如果开了 `promptSuggestions`）等消息，**别在收到 result 就断开监听**。

### 3.2 会话生命周期 / 状态

- `system/init`（`SDKSystemMessage`，sdk.d.ts:5834）：每轮开头基本都会发一次，带 `model`、`cwd`、`tools`、`mcp_servers`、`permissionMode`、`slash_commands`、`output_style`、`skills`、`plugins`、`capabilities`（能力探测字符串数组，比如 `'interrupt_receipt_v1'`）。GUI 应该用这条更新顶部状态栏（当前模型/权限模式/CWD），并用 `capabilities` 做特性开关。
- `system/status`（`SDKStatusMessage`）：`status: 'compacting'|'requesting'|null`，用来在输入框旁边显示"压缩历史中…"之类的小转轮。
- `system/compact_boundary`：压缩发生了，`compact_metadata.pre_tokens`/`post_tokens` 可以显示"上下文从 X 压缩到 Y tokens"。
- `system/session_state_changed`：`'idle'|'running'|'requires_action'`，权威的"这轮结束了"信号（比 result 更底层）。
- `conversation_reset`：`/clear` 等操作把对话清空，GUI 必须清空本地渲染的消息列表，`trigger` 字段说明原因。
- `system/commands_changed` / `system/background_tasks_changed`：分别是 slash 命令列表变化、后台任务集合变化，都是"整份替换"语义（REPLACE，不是增量 patch）。

### 3.3 任务/子 agent 面板

`task_started` → `task_progress`（可能多次）→ `task_notification`（终态：completed/failed/stopped）是一组三段式事件，`task_id` 贯穿；`task_updated` 是增量 patch（只带变化的字段）。GUI 做一个"后台任务"侧边面板，按 `task_id` 建索引，`is_backgrounded`/`ambient` 决定要不要在主时间线里显示。`agentProgressSummaries: true` 时 `task_progress.summary` 有一句话人类可读进度。

### 3.4 权限/工具执行状态

- `tool_progress`（`type:'tool_progress'`，注意这个不是 `system` 子类型，是顶层 `type`）：长时间运行的工具（Bash 命令、子 agent）的心跳，`elapsed_time_seconds` 可以做"运行中...12s"的显示。
- `permission_denied`（`SDKPermissionDeniedMessage`）：工具调用**没有**走到 `canUseTool` 就被自动拒绝了（规则/`dontAsk`模式/分类器拒绝），GUI 应该在对应工具调用气泡上标"已自动拒绝：{message}"。
- `tool_use_summary`：一句话总结前面几个工具调用做了什么，适合折叠长串工具调用时显示摘要行。

### 3.5 速率限制 / 认证 / 错误类

- `rate_limit_event`（`SDKRateLimitEvent`）：`rate_limit_info.status: 'allowed'|'allowed_warning'|'rejected'`，`rateLimitType: 'five_hour'|'seven_day'|...`，`utilization`（0-100）。**这是 Ember 做"用量条"UI 的数据源**，收到就更新对应窗口的进度条；`status:'rejected'` 时要用醒目提示挡住输入框。
- `auth_status`（`SDKAuthStatusMessage`）：`isAuthenticating: boolean`、`output: string[]`、`error?: string`。这是登录流程中的中间状态（比如触发浏览器 OAuth 时）。
- `model_refusal_fallback` / `model_refusal_no_fallback`：模型以 `stop_reason:'refusal'` 结束时的两种后续——自动切到备用模型重试，或没有备用模型可切。GUI 可以在气泡上标"模型拒绝回答，已自动重试"或直接显示拒绝文案。
- `mirror_error`：会话镜像到外部存储失败（只有配了 `sessionStore` 才会出现），Ember 大概用不到。

### 3.6 其它

- `informational`（`SDKInformationalMessage`）：通用文本横幅（hook 的阻断原因、slash 命令输出等），按 `level: 'info'|'notice'|'suggestion'|'warning'` 决定样式。
- `local_command_output`：本地 slash 命令（如 `/usage`）的输出，当纯文本渲染。
- `memory_recall`：自动记忆被召回时的提示（"从记忆中调取了…"），可以做一个小小的"引用记忆"标签。
- `prompt_suggestion`：每轮结束后的下一句话预测文案，可以做成输入框下方的"建议"按钮。
- `thinking_tokens`（`SDKThinkingTokensMessage`）：思考过程中的实时 token 数估算（`estimated_tokens`/`estimated_tokens_delta`），用来在"思考中…"状态上显示一个跳动的数字，**不是**最终计费用量，只做展示。
- `notification`（`SDKNotificationMessage`）：`key`/`text`/`priority:'low'|'medium'|'high'|'immediate'`/`color?`/`timeout_ms?`，跟终端里 REPL 通知队列同源，做成 toast 通知即可。
- `hook_started`/`hook_progress`/`hook_response`：需要 `includeHookEvents: true` 才会发（`SessionStart`/`Setup` 两类 hook 始终发，不受这个开关影响）。三段式：开始→（可能多次）进度（带 `stdout`/`stderr`/`output`）→结束（`outcome:'success'|'error'|'cancelled'`）。Ember 如果做"hook 执行日志"面板，按 `hook_id` 分组渲染。
- `plugin_install`：headless 插件安装进度（`status:'started'|'installed'|'failed'|'completed'`），仅在设了 `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` 环境变量时出现，Ember 大概率用不到。
- `files_persisted`（`SDKFilesPersistedEvent`）：`files`/`failed` 两个数组，说明哪些文件成功/失败持久化了，配合文件上传类功能使用。
- `elicitation_complete`：MCP server 确认某个 URL 模式的 elicitation（见第 7 节 `onElicitation`）流程走完了，`mcp_server_name`/`elicitation_id`，用来关掉对应的"等待授权中"弹窗。
- `worker_shutting_down`（`SDKWorkerShuttingDownMessage`）：优雅关闭的告警（`reason`），**注意 `.d.ts` 明确说明它不是可靠的"进程已死"信号**（很多关闭路径不发这条），只能当"活着时的额外提示"用，不能替代 1.4 节讲的死亡检测。
- `control_request_progress`（`SDKControlRequestProgressMessage`）：某个耗时的控制请求（比如 `reloadPlugins()`）正在进行中的进度回报，UI 上可以给对应的设置项按钮加个转轮。

**兜底原则**（`.d.ts` 注释原话）：*"Consumers should ignore types and subtypes they do not recognize: the set grows over time."* Ember 的消息分发器要写成 `switch` + `default: 忽略或记日志`，绝不能因为遇到未知 `subtype` 就崩溃——这个 SDK 版本升级很快，新 subtype 随时会加。

---

## 4. 权限系统：`canUseTool` 是唯一入口

### 4.1 调用时机（官方文档原文，已用 WebFetch 核对）

`canUseTool` **不是**"每次工具调用都触发"，而是"前面几层规则都没能自动决出结果时才触发"。完整六步评估链（Hooks → Deny 规则 → Ask 规则 → 权限模式 → Allow 规则 → `canUseTool`）中：

> **Auto-approved tools never reach `canUseTool`.** A tool call approved at any earlier step, by `acceptEdits` or `bypassPermissions`, or by an allow rule, skips your `canUseTool` callback, so permission checks you put there are silently bypassed for that tool.

（原稿把这句转述成"The callback never fires for auto-approved tools"并当成原文放进引用块——意思没错，但不是官方文档的原句，上面已换成 WebFetch 实测到的逐字原文。）

例外（**这几类工具即使被 allow 规则批准，也不会自动跳过 `canUseTool`**）：
- `AskUserQuestion`
- MCP 工具声明了 `_meta["anthropic/requiresUserInteraction"]` 的
- 组织策略标为 `ask` 的 claude.ai 连接器工具
- 针对"关键路径"的 `rm`/`rmdir`（见官方 permission-modes 文档的 critical paths 表）

**注意前三类和第四类的例外条件不一样**（原稿写成"除非 dontAsk 模式"对四类一视同仁，是错的）：前三类只在 `dontAsk` 模式下才会被直接拒绝、不调用回调；第四类（关键路径 `rm`/`rmdir`）除了 `dontAsk` 之外，**`auto` 模式下 Agent SDK 会话默认也是直接拒绝、不调用回调**（官方原文：*"In other modes the first three reach the callback. Depending on the permission mode, a critical-path removal reaches the callback too or Claude Code denies it without calling it, as it does by default for an Agent SDK session in `auto` mode."*）——Ember 如果做 `auto` 模式，不能假设关键路径删除一定会弹 `canUseTool` 让用户看到。

`permissionPrompts: 'none'`（`Options`，见 sdk.d.ts:2017）可以彻底关掉这条路径——设了之后 `canUseTool` 永不被调用，未决的都直接 deny。Ember 不应该设这个，因为需要真的弹窗问用户。

### 4.2 完整签名（sdk.d.ts:213）

```ts
export declare type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];   // "总是允许"要回显的规则建议
    blockedPath?: string;               // 触发权限请求的具体路径（比如越权访问的路径）
    mcpServer?: { name: string; source: string };
    decisionReason?: string;            // 为什么触发了这次请求
    title?: string;                     // 完整提示句，比如 "Claude wants to read foo.txt"——优先用它做主文案
    displayName?: string;               // 简短名词短语，比如 "Read file"——适合按钮标签
    description?: string;               // 副标题，比如 "Claude will have read and write access to files in ~/Downloads"
    defaultToNo?: boolean;              // true 时 UI 不能给"一键确认"，必须默认停在拒绝选项
    suppressAlwaysAllowRule?: boolean;  // true 时不能提供"以后都不问"选项
    toolUseID: string;
    agentID?: string;                   // 子 agent 里发起的话，子 agent id
    requestId: string;                  // 只有走"带外应答"（自己发 HTTP 而不是走 SDK 的默认通道）时才需要回显
    matchedAskRule?: { source: string; toolName: string; ruleContent?: string };
  }
) => Promise<PermissionResult | null>;
```

`title`/`displayName`/`description` 是 CLI 自己拼好的人类可读文案（"bridge 渲染的完整提示句"），**Ember 应该优先用这三个字段**做权限弹窗文案，而不是自己按 `toolName`+`input` 拼句子——这样文案措辞会和真 CLI 保持一致，也自动覆盖了将来新增的工具类型。

### 4.3 `PermissionResult`（sdk.d.ts:2504）

```ts
export declare type PermissionResult = {
    behavior: 'allow';
    updatedInput?: Record<string, unknown>;   // 不给 = 用原始 input；给了 = 修改后执行（Claude 不知道被改过）
    updatedPermissions?: PermissionUpdate[];  // "总是允许" 时把 suggestions 原样回显进来
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification; // 'user_temporary'|'user_permanent'|'user_reject'
} | {
    behavior: 'deny';
    message: string;      // 会作为 tool_result 内容回给模型，模型会看到并可能调整方案
    interrupt?: boolean;  // true = 连带打断整轮回复（不只是拒绝这一个工具）
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification;
};
```

`PermissionUpdate`（sdk.d.ts:2523）六种变体：`addRules`/`replaceRules`/`removeRules`（针对具体规则，带 `PermissionRuleValue{toolName, ruleContent?}` 和 `PermissionBehavior:'allow'|'deny'|'ask'`）、`setMode`（切权限模式）、`addDirectories`/`removeDirectories`（改可访问目录）。每条都带 `destination: 'userSettings'|'projectSettings'|'localSettings'|'session'|'cliArg'`，决定写到哪：`'session'` 只在本次会话内存里生效，`'localSettings'` 会真的写 `.claude/settings.local.json` 落盘。

### 4.4 三档按钮的实现（Allow once / Always allow this session / Always allow this project）

```ts
async function myCanUseTool(toolName, input, opts): Promise<PermissionResult> {
  if (toolName === 'AskUserQuestion') return handleAskUserQuestion(input); // 见 4.5
  if (toolName === 'ExitPlanMode') return handlePlanApproval(input, opts); // 见 4.6

  const choice = await showPermissionDialog({
    title: opts.title,
    description: opts.description,
    defaultToNo: opts.defaultToNo,
    canRemember: !opts.suppressAlwaysAllowRule,
  });

  if (choice === 'deny') {
    return { behavior: 'deny', message: 'User denied this action' };
  }
  if (choice === 'allow-once') {
    return { behavior: 'allow', updatedInput: input };
  }
  if (choice === 'always-session') {
    const sessionRules = (opts.suggestions ?? []).filter(s => s.destination === 'session');
    return { behavior: 'allow', updatedInput: input, updatedPermissions: sessionRules };
  }
  if (choice === 'always-project') {
    const projectRules = (opts.suggestions ?? []).filter(s => s.destination === 'projectSettings');
    return { behavior: 'allow', updatedInput: input, updatedPermissions: projectRules };
  }
  // 兜底
  return { behavior: 'deny', message: 'Unhandled choice' };
}
```

`opts.suggestions` 里到底会有哪些 `destination` 由 CLI 自己决定（通常是 `session` + 一个持久化选项），Ember 只需要按 `destination` 过滤展示对应按钮，不需要自己构造 `PermissionUpdate`。

### 4.5 `AskUserQuestion`：怎么把答案传回去（**这是本节最容易出错的地方，官方文档专门强调过**）

`AskUserQuestion` **走的还是 `canUseTool`**，不是单独通道。触发条件：`toolName === 'AskUserQuestion'`。它的输入形状（`AskUserQuestionInput`，sdk-tools.d.ts:1102）：

```ts
interface AskUserQuestionInput {
  questions: Array<{
    question: string;      // 完整问句
    header: string;        // ≤12 字符的短标签
    options: Array<{ label: string; description: string; preview?: string }>; // 2-4 个
    multiSelect: boolean;
  }>; // 1-4 个问题
}
```

`preview` 字段的格式由 `Options.toolConfig.askUserQuestion.previewFormat` 决定：设成 `'html'` 时 `preview` 是一段自包含 HTML 片段（SDK 会在回调触发前就过滤掉 `<script>`/`<style>`/`<!DOCTYPE>`），Ember 直接用一个沙箱 iframe 或 `dangerouslySetInnerHTML`（配合 CSP）渲染即可；不设的话默认是 `'markdown'`，是给终端用的等宽框，不适合网页渲染，**Ember 一定要显式设成 `'html'`**。

**答案怎么传回去**——不是走某个专门的 "answer" API，而是在 `canUseTool` 返回 `{behavior:'allow', updatedInput: {...}}` 时，把 `updatedInput` 塞成 `AskUserQuestionOutput` 的形状（sdk-tools.d.ts 3749 附近）：

```ts
function handleAskUserQuestion(input: AskUserQuestionInput): Promise<PermissionResult> {
  return showQuestionDialog(input.questions).then((userChoices) => ({
    behavior: 'allow',
    updatedInput: {
      questions: input.questions,          // 必须原样带回去（工具处理需要）
      answers: userChoices.answers,         // { [question全文]: 选中的label字符串 }，类型是 Record<string,string>，multiSelect 只能用 ", " 拼接成一个字符串（sdk-tools.d.ts 里 answers 的类型是 `{[k:string]:string}`，不是数组，注释原话是"multi-select answers are comma-separated"——原稿这里写了"或数组"是错的，实测按 .d.ts 类型数组不合法）
      response: userChoices.freeText,       // 可选：用户绕开选项直接打字的整体回复
      annotations: userChoices.annotations, // 可选：每题的备注
    },
  }));
}
```

要点（官方文档反复强调，容易踩坑的地方）：
1. `answers` 的 **key 是问题原文**（`question` 字段的完整字符串），不是 `header`，也不是下标。
2. `answers` 的 **value 是选中选项的 `label`**，不是 index、不是 description。
3. `questions` 数组必须原样回传（"required for tool processing"）。
4. 多选题：value **只能**是用 `", "` 拼接成的一个字符串（`AskUserQuestionOutput.answers` 的类型是 `{[k:string]: string}`，逐字段都是 `string`，没有数组这个选项——原稿这里说"可以是数组"是错的，已核对 sdk-tools.d.ts 改正）。
5. 如果 GUI 允许用户完全跳过结构化选项直接打字回复整段话（不是针对某一题），用顶层的 `response` 字段而不是塞进某个 `answers[question]`——设了 `response` 之后模型收到的是"用户回复了：…"而不是逐题答案列表。
6. 支持"其它/自由输入"选项时，把用户打的文字直接作为该题 `answers[question]` 的值（不要用字面的 "Other" 当值）。
7. **限制**：`AskUserQuestion` 目前在通过 Agent 工具启动的子 agent 里不可用（官方文档 Limitations 明确写的）。
8. 如果 Ember 用 `tools: [...]` 显式收窄了工具列表，必须把 `'AskUserQuestion'` 加进去，否则模型根本发不出这个工具调用。

### 4.6 `ExitPlanMode`（计划模式审批）

`ExitPlanModeInput`（sdk-tools.d.ts:822）本身 schema 里只列了一个已废弃的 `allowedPrompts` 字段，实际的计划正文走 `[k: string]: unknown` 的开放索引签名承载（**[UNVERIFIED]** 具体字段名 `.d.ts` 没标注，需要在实测抓包里确认，常见做法是模型把计划文本作为 assistant 消息的 `text` block 先说出来，`ExitPlanMode` 工具调用本身更像一个"请求切出 plan 模式"的信号）。处理方式跟其它工具一致：也是从 `canUseTool` 里以 `toolName === 'ExitPlanMode'` 分支进来，UI 上展示"批准这个计划吗？"。批准之后**先检查这次回调的 `opts.suggestions`**（跟 4.4 节"总是允许"用的是同一个字段）——如果 CLI 已经在 `suggestions` 里带了 `{type:'setMode', mode:'default'|'acceptEdits', destination:...}` 这类条目，直接把它原样塞进 `updatedPermissions` 回显（跟处理"总是允许"完全同一套代码路径），让 CLI 按它自己算好的目标模式切换；只有当这次 `suggestions` 里**没有** `setMode` 建议时，才退回到手动调 `query.setPermissionMode('default')`/`'acceptEdits'` 这条兜底路径。用户拒绝则 `{behavior:'deny', message:'...'}`，模型会继续留在 plan 模式修改计划。

官方文档只说了一句相关的话（user-input 页 Tip）："Claude may use `AskUserQuestion` to clarify requirements before finalizing the plan"——即计划模式下常见的是先用 `AskUserQuestion` 澄清、最后才调 `ExitPlanMode`，两者是同一条 `canUseTool` 管道里的两种 `toolName`。

### 4.7 `setPermissionMode` 与六种模式

```ts
setPermissionMode(mode: PermissionMode): Promise<void>; // 只在流式输入模式可用
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
```

| 模式 | 行为要点（已用官方文档核对） |
|---|---|
| `default` | 无自动批准；未匹配 allow 规则的都走 `canUseTool` |
| `acceptEdits` | 工作目录内的 Edit/Write 和 `mkdir/touch/rm/rmdir/mv/cp/sed` 自动批准；越权路径、受保护路径、关键路径删除仍会问 |
| `bypassPermissions` | 几乎全部自动批准（除了关键路径删除等极少数例外）；**必须**同时设 `allowDangerouslySkipPermissions: true` 才能用；Linux/macOS 上以 root/sudo 运行会直接拒绝启动 |
| `plan` | 只读工具正常跑，文件编辑/改动型 shell 命令一律走 `canUseTool`，不会被任何 allow 规则自动批准 |
| `dontAsk` | 原本会问的全部直接拒绝，**`canUseTool` 完全不会被调用** |
| `auto` | 用一个模型分类器自动批准/拒绝，替代人工确认（"消除确认弹窗"模式，适合"信任但不想被打断"的场景） |

Ember 的 GUI 应该做一个模式切换器（跟 CLI 里的效果一样），默认 `'default'`，让用户自己决定要不要切到 `acceptEdits`/`auto`/`bypassPermissions`——**不要**给 Ember 自己硬编码 `bypassPermissions` 当默认值，这违反最小权限原则，也会让用户觉得"这个壳子比原版 CLI 还危险"。

子 agent 权限继承规则（官方文档 Warning）：子 agent 默认继承父会话的权限模式，除非在其 `AgentDefinition.permissionMode` 里单独设置，**且**父会话本身是 `default`/`dontAsk`/`plan` 之一时才会生效——子 agent 永远不会"意外"继承出 `bypassPermissions`，除非父会话本来就是。

---

## 5. 会话历史 API

```ts
listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>
getSessionInfo(sessionId, options?): Promise<SDKSessionInfo | undefined>
getSessionMessages(sessionId, options?): Promise<SessionMessage[]>
getSubagentMessages(sessionId, agentId, options?): Promise<SessionMessage[]>
listSubagents(sessionId, options?): Promise<string[]>
forkSession(sessionId, options?): Promise<ForkSessionResult>
renameSession(sessionId, title, options?): Promise<void>
deleteSession(sessionId, options?): Promise<void>
tagSession(sessionId, tag, options?): Promise<void>
```

`SDKSessionInfo`（sdk.d.ts:5740）字段：`sessionId`、`summary`（标题：自定义标题/自动摘要/首条 prompt 三选一）、`lastModified`（ms）、`fileSize?`、`customTitle?`、`firstPrompt?`、`gitBranch?`、`cwd?`、`tag?`、`createdAt?`。**这就是 Ember 侧边栏"历史会话列表"的完整数据源**，`dir` 参数对应"按项目分组"。

`ListSessionsOptions.includeProgrammatic`（默认 `true`）：会把 SDK/daemon 自己产生的会话也列出来。**Ember 作为一个 SDK 消费者，它自己开的每个会话也会被记进这个列表**（`entrypoint` 会标 `sdk-ts`），如果 Ember 想要跟 IDE 的会话选择器手感一致（只看用户在真实终端里开的会话），要传 `includeProgrammatic: false`。

`getSessionMessages` 返回的 `SessionMessage`（sdk.d.ts:6368）：

```ts
type SessionMessage = {
    type: 'user' | 'assistant' | 'system';
    uuid: string;
    session_id: string;
    message: unknown;          // 未强类型化，但就是原始 JSONL 里存的标准 Anthropic MessageParam/BetaMessage
    parent_tool_use_id: string | null;
    parent_agent_id: string | null;
};
```

**回答任务里的关键问题**：`message` 字段类型是 `unknown`，但它就是原始 transcript JSONL 条目里的消息对象——**包含完整的 `tool_use`/`tool_result` content block**，跟实时流里收到的 `assistant`/`user` 消息内容结构完全一样。所以历史回放可以复用同一套"消息 → 气泡"渲染函数，不需要写第二套解析逻辑。`includeSystemMessages: true`（`GetSessionMessagesOptions`）才会把 compact_boundary 等系统消息也读出来，默认不读。

`resume` 怎么跟 `cwd`配合：`Options.resume: string` 直接传 sessionId 恢复对话历史；`cwd` 独立设置，**不要求**跟原会话的 cwd 一致（用户可以在恢复一个会话的同时切换到别的目录），但如果目录变了，文件相关的工具调用会按新 `cwd` 解析路径,这点如果 GUI 允许"resume 到不同目录"要在 UI 上提示清楚。`resumeSessionAt`/`resumeDropsTurn` 是更精细的"恢复到某条消息为止"控制，`.d.ts` 里那段超长注释本质是说：**只能在"保留的这一轮"的最后一条链上截断**，选早了会被拒绝（`error_during_execution`，消息以 `Resume rejected by --resume-drops-turn:` 开头）——Ember 如果做"回退到这句话重新问"功能，遇到这个拒绝就应该清空重试目标、走普通 `resume`（不截断），而不是重试同一个截断点（判定是确定性的，重试没用）。

`forkSession`（sdk.d.ts:835）：`upToMessageId` 截取到某条消息（用 `SessionMessage.uuid`），返回新 `sessionId`，用 `resume` 打开——适合做"从这条消息开始，另开一个分支继续聊"的功能。

---

## 6. 其它对 UI 有用的控制方法

```ts
q.initializationResult(): Promise<SDKControlInitializeResponse>
// { commands, agents, output_style, available_output_styles, models, account, hooks_applied?, plugins_applied? }
// account: AccountInfo = { email?, organization?, subscriptionType?, apiProvider?: 'firstParty'|'bedrock'|... }

q.supportedCommands(): Promise<SlashCommand[]>   // { name, description, argumentHint, aliases?, builtin? }
q.supportedModels(): Promise<ModelInfo[]>        // { value, displayName, description, supportsEffort?, supportedEffortLevels?, ... }
q.supportedAgents(): Promise<AgentInfo[]>
q.mcpServerStatus(): Promise<McpServerStatus[]>  // { name, status:'connected'|'failed'|'needs-auth'|'pending'|'disabled', tools?, error? }
q.getContextUsage(opts?): Promise<SDKControlGetContextUsageResponse> // /context 面板的数据源
q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts?)   // /usage 面板 + 速率限制窗口，官方标注为不稳定实验 API
q.accountInfo(): Promise<AccountInfo>
q.rewindFiles(userMessageId, opts?)              // 需要 enableFileCheckpointing
q.setModel(model?)                                // 运行时切模型，不用重启会话
q.setMaxThinkingTokens(...)                       // 已废弃，用 Options.thinking
q.applyFlagSettings({...})                        // 运行时改设置（合并进 flag 层，只在 session 内存里生效，不写任何文件——见下面纠正）
  // effortLevel 单独有讲究（sdk.d.ts:2931-2944）：
  //   applyFlagSettings 本身操作的是"flag 设置层"，这是一层只存在于当前会话内存里的覆盖层，
  //   优先级在 user/project/local settings 之上、managed policy 之下——它不是任何 settings.json 文件，
  //   也不会把值写进任何文件（原稿这里写的"传具体等级会被写进 settings 文件的候选值"是把它跟另一个方法
  //   `updateSettings()` 搞混了：只有 updateSettings() 才真的通过 CLI 的写入器落盘到 localSettings/userSettings 文件）
  //   传具体等级 'low'|'medium'|'high'|'xhigh' → 在本次会话内存里正常生效
  //   传 'max' → 同样只在本次会话内存里生效（session-only），且这个值本来就不会出现在 settings.json 持久化类型里
  //     （Settings.effortLevel 的类型定义排除了 'max'，这是"'max' 从设计上就不可持久化"的证据，不是"其它值会被持久化"的证据）
  //   传 null → 不是"清掉设置回落到 settings.json 里保存的值"，而是直接重置到"模型的默认 effort"，跟设置文件/query() 选项都不联动
  //     （官方原文：null 对多数 key 是"清掉 flag 层、回落到低优先级来源"，但 effortLevel/model/agent/ultracode 这四个 key 是例外，
  //      null 直接重置到硬编码默认值，不回落到任何已保存的值）
  //   传 undefined（不传这个 key）→ 什么都不变（JSON 序列化会丢掉 undefined）
  // 如果 Ember 想要"记住用户上次选的 effort 等级，下次开新会话也用它"，要调用的是 q.updateSettings('userSettings', {effortLevel})，不是 applyFlagSettings
q.reloadPlugins() / q.reloadSkills() / q.reloadOutputStyles()
q.setMcpServers(servers)                          // 动态增删 MCP server
q.stopTask(taskId) / q.backgroundTasks(toolUseId?)
```

`initializationResult()` vs `system/init`（流里那条消息）：**两者字段不完全一样**——`initializationResult()` 多了 `account`、`available_output_styles`、`hooks_applied`/`plugins_applied`；`system/init` 消息多了 `apiKeySource`、`cwd`、`tools`（工具名列表）、`capabilities`、`fast_mode_state`。Ember 应该把两者都读:启动时 `await q.initializationResult()` 拿账户信息填侧边栏用户区，流里的 `system/init` 拿来实时更新状态栏。

### Slash 命令在 SDK 模式下的行为（已用官方文档核对）

- 把 `/xxx` 当普通文本塞进用户消息发出去即可分发，不依赖 `skills` 白名单（哪怕 `skills` 列表里没列这个技能，直接发 `/name` 照样能跑）。
- 需要交互式终端的命令（`/theme`、`/terminal-setup` 等）**不会出现**在 `system/init.slash_commands` 列表里——Ember 的命令面板直接用这个字段过滤即可，天然不会显示不支持的命令。
- 发一个匹配不到任何命令的 `/xxx`：2.1.274 之后的版本行为是"当成普通消息发给模型，附带一句该命令没跑成的提示"，会真的消耗一次模型轮次；2.1.274 之前是直接返回 `Unknown command: /xxx` 不跑模型。**Ember 要按当前用户装的 CLI 版本预期对应行为**，不要固定假设某一种。
- 匹配到一个"存在但当前环境不支持"的内置命令（比如 `/theme`）：直接返回结果 `"/theme isn't available in this environment."`，不跑模型。
- `/compact`：需要已有对话历史才有意义；成功执行会发一条 `system/compact_boundary` 消息（`compact_metadata.trigger`/`pre_tokens`/`post_tokens`）；如果历史不够，`result.result` 文本里会给出原因（如 `"Not enough messages to compact."`），依然是 `subtype:'success'`，不是错误。
- `/clear`：在流式长连接会话里有意义（清空上下文，可以之后 `resume` 回原 sessionId 找回历史）；在一次性字符串 prompt 模式下没有实际效果（反正每次 `query()` 本来就是空上下文开始）。
- `/cost`/`/usage`/`/context`：结果通过 `local_command_output` 消息（纯文本）和/或对应 `assistant` 消息上挂的结构化字段（`usage_report`/`context_usage`）双通道到达——**优先读结构化字段渲染表格/图表**，`local_command_output`/纯文本当兜底显示。

---

## 7. 错误场景与 GUI 该展示什么

| 场景 | 信号 | GUI 应该做 |
|---|---|---|
| 未登录 / OAuth 过期 | `SDKAssistantMessage.error === 'authentication_failed'`（或 `'oauth_org_not_allowed'`/`'account_on_hold'`/`'verification_required'`），也可能先看到 `auth_status`（`isAuthenticating`, `error`） | 弹出"请在终端里跑 `claude login` 重新登录"提示，因为 Ember **不做自己的登录 UI**（需求明确说了"不需要额外登录"），认证状态完全依赖 CLI 自己的 keychain/config |
| 计费/账单问题 | `error: 'billing_error'` | 提示检查 claude.ai 账单页 |
| 速率限制 | `error: 'rate_limit'`（assistant 级），或更细粒度的 `rate_limit_event`（`status:'rejected'`） | 用量条变红 + 显示 `resetsAt` 倒计时 |
| 服务过载 | `error: 'overloaded'` | 提示"服务繁忙，请稍后重试"，SDK/CLI 本身会按 `SDKAPIRetryMessage`（`attempt`/`max_retries`/`retry_delay_ms`）自动重试，GUI 可以显示"重试中 (1/3)…" |
| 请求不合法 | `error: 'invalid_request'` | 一般是 Ember 自己传参出错（比如 `model` 名字打错），展示原始 result 文本方便调试 |
| 模型不存在 | `error: 'model_not_found'` | 检查 `Options.model` 拼写，回退到 `supportedModels()` 里列出的合法值 |
| CLI 二进制找不到 / 版本不对 | `query()` 调用本身可能直接抛异常（spawn ENOENT），或 `result.startup_failure_reason === 'cli_version_too_old'` | 启动时先做一次二进制探测（`which claude` / 检查 `pathToClaudeCodeExecutable` 是否存在且可执行），给出"请先安装/升级 Claude Code CLI"的引导，而不是让用户看到裸的 Node stack trace |
| spawn 失败（权限/路径错误等） | Node 层面的 spawn error，走 `Options.stderr` 或者 promise reject | 兜底 catch，展示 stderr 尾部文本 |
| 会话被沙箱/托管策略拒绝启动 | `startup_failure_reason` 的其它值：`'org_pin_api_key_conflict'`、`'gateway_signin_required'`、`'gateway_access_denied'`、`'proxy_invalid'`、`'temp_dir_unusable'`、`'cwd_unavailable'`、`'shell_tool_missing'`、`'bypass_root'` 等（完整列表见 sdk.d.ts:5815 `SDKStartupFailureReason`） | 按具体 reason 给出对应文案；这些大多是企业环境的策略拒绝，个人用户基本不会遇到 |

**关键设计原则**：Ember 不应该重新发明认证 UI——需求文档明确"如果 cli 端已经登录了，那么就可以正常工作"。所以 Ember 的职责只是**检测并友好展示**认证失败，引导用户去终端里跑 `claude login`，而不是自己接管 OAuth 流程。

---

## 8. 容易踩的坑

1. **从另一个 Claude Code 会话内部启动 Ember 时的环境变量**：`.d.ts` 和官方文档都没有列出需要清理的具体变量名 **[UNVERIFIED]**。按 Claude Code 生态的通用经验（不是这份 `.d.ts` 里写的，是常识性推断），CLI 自己会检测 `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` 之类的环境变量来判断"我是不是已经在另一层 Claude Code 里跑"，从而调整行为（比如禁用某些嵌套功能）。Ember 作为一个独立桌面 App，用户是从 Finder/Dock 双击启动的，Electron 主进程原始的 `process.env` 里本来就不会带 `CLAUDECODE` 这类变量，**这一点通常不需要主动清理**；只有当 Ember 本身是被"从 CLI 里跑的脚本"拉起来的开发者场景才要小心。

但是——第 8 节第 2 条为了修 PATH 引入的 `loginShellEnv`（读用户登录 shell 展开出来的完整环境）会带来一个新问题：**如果用户在自己的 `~/.zshrc`/`~/.zprofile` 里手动导出过 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`（很多人为了用别的工具会这么干），这个值会原样进到 Ember 传给 `query()` 的 `env` 里，让 CLI 子进程改用 API Key 认证，而不是用户在 CLI 里登录好的 claude.ai OAuth session**——这就悄悄破坏了需求里"不需要额外登录，直接沿用 CLI 已登录状态"的承诺，而且用户很可能完全不知道自己的 shell profile 里有这个变量。建议：构造 `loginShellEnv` 之后显式 `delete loginShellEnv.ANTHROPIC_API_KEY; delete loginShellEnv.ANTHROPIC_AUTH_TOKEN;`（除非 Ember 未来做了"使用 API Key 而不是订阅登录"的开关,用户主动选择时才保留)。保守做法：`Options.env` 传值时用 `{ ...process.env }` 展开而不是手写白名单，如果发现某些奇怪行为，再针对性地 `delete env.CLAUDECODE` 之类调试。
2. **Bash 工具的 `PATH`——`{ ...process.env }` 对 Ember 这个具体交付物不够,必须额外修一步**：Ember 最终是一个从 Finder/Dock 双击启动的 `.app`，Electron 主进程的 `process.env.PATH` 在这种启动方式下是 macOS launchd 给的系统默认 PATH（大致是 `/usr/bin:/bin:/usr/sbin:/sbin`），**不包含**用户在 `~/.zshrc`/`~/.zprofile` 里加的 `/opt/homebrew/bin`、`~/.local/bin`、nvm 的 node 路径等。任务描述里"从干净环境 `PATH=/usr/bin:/bin` 启动 `~/.local/bin/claude` 能跑通"只证明了**claude 这个二进制本身**能被绝对路径直接拉起来，完全不能说明**claude 内部跑 Bash 工具时**找得到 `git`/`node`/`npm`——那些命令的 PATH 是 Bash 工具子进程自己的环境，同样继承自 Ember 传给 `query()` 的 `env`。所以：
   - 探测 `claude` 二进制路径、以及构造 `Options.env` 时，都不能直接用 Electron 主进程的裸 `process.env`。
   - 正确做法是**启动时先解析一次用户登录 shell 的 PATH**，再用这份 PATH 覆盖 `env.PATH`：
     ```ts
     import { execFile } from 'node:child_process';
     function getLoginShellPath(): Promise<string> {
       const shell = process.env.SHELL || '/bin/zsh';
       return new Promise((resolve) => {
         execFile(shell, ['-ilc', 'echo -n "$PATH"'], (err, stdout) => {
           resolve(err ? process.env.PATH ?? '' : stdout.trim());
         });
       });
     }
     // 应用启动时跑一次，缓存结果；也可以直接用现成的 `fix-path`/`shell-env` npm 包做同样的事
     const loginShellEnv = { ...process.env, PATH: await getLoginShellPath() };
     ```
   - 用这份修好的 PATH 去 `which claude`/探测 `pathToClaudeCodeExecutable`，也用它构造传给 `query()` 的 `Options.env`。
   - 这一条比"别漏传 PATH"更深一层：**不是漏没漏传的问题，是 Electron 从 Finder 启动时 `process.env.PATH` 本身就是错的（太窄）**，必须主动修正，而不是简单展开 `{ ...process.env }` 就够。
3. **僵尸进程**：见 1.6，Electron 应用生命周期钩子里必须显式 `close()` 所有活跃 `Query`，且要考虑到用户可能同时开着好几个会话标签页（Ember 大概会做多标签），每个标签对应一个独立的 `Query`/子进程，关闭标签就该关对应的那一个,不能全局一刀切。
4. **`includePartialMessages` 的内存**：打开后每个 token 都会多产生一条 `stream_event` 消息，长对话/长代码块场景下消息条数会暴涨。如果 Ember 把所有历史消息原样存进 React state/IndexedDB，要考虑**只保留最终的 `assistant` 消息用于持久化**，`stream_event` 只用于当前这一轮的实时动画,动画结束就可以丢弃，不要长期攒着。
5. **大工具输出**：`SDKUserMessage.tool_use_result` 和 `tool_result.content` 对于 Bash/Read 大文件输出可能是几十 KB 甚至更大的字符串。渲染时要做截断/虚拟滚动，不能直接塞进一个不限高度的 DOM 节点，否则长会话打开会卡。
6. **`env` 覆盖 vs `settings` 合并的区别别搞混**：`Options.env` 是完全替换子进程环境；但 `Options.settings`（内联对象或文件路径）是叠加进"flag 设置层"，跟用户/项目/本地 settings **合并**，优先级高于它们但不会整体替换掉它们。两个字段名字看起来像但语义完全不同，写代码时容易搞混。
7. **多条 `assistant` 消息共享 `message.id`**：如果 Ember 用 `message.id` 当 React key 渲染消息列表，会撞 key（同一轮回复里好几条消息 id 一样）。要用 `SDKAssistantMessage.uuid`（每条消息独有）当 key，`message.id` 只用来判断"这几条是不是同一次 API 回复的不同 block"。
8. **`AskUserQuestion`/`ExitPlanMode` 的权限弹窗组件要单独设计**，不能复用"允许/拒绝 Bash 命令"那套通用 UI——前者是选择题界面（选项+预览），不是 allow/deny 二元决定。如果 `canUseTool` 里漏了 `toolName === 'AskUserQuestion'` 的分支，走到通用弹窗逻辑上，`updatedInput` 传回原始 `input`（没有 `answers` 字段），工具执行会失败或者卡住。

---

## 附：关键类型速查表（按本次读取到的精确位置）

| 类型/函数 | 位置 |
|---|---|
| `query()` | sdk.d.ts:3237 |
| `Query` interface | sdk.d.ts:2843 |
| `Options` | sdk.d.ts:1518 |
| `CanUseTool` | sdk.d.ts:213 |
| `PermissionResult` / `PermissionUpdate` | sdk.d.ts:2504 / 2523 |
| `SDKMessage` union | sdk.d.ts:5273 |
| `SDKAssistantMessage` | sdk.d.ts:3602 |
| `SDKUserMessage` / `SDKUserMessageReplay` | sdk.d.ts:6149 / 6237 |
| `SDKPartialAssistantMessage`(stream_event) | sdk.d.ts:5422 |
| `SDKResultSuccess` / `SDKResultError` | sdk.d.ts:5671 / 5610 |
| `SDKSystemMessage`(init) | sdk.d.ts:5834 |
| `SDKRateLimitEvent` / `SDKRateLimitInfo` | sdk.d.ts:5573 / 5586 |
| `SDKAuthStatusMessage` | sdk.d.ts:3685（原稿误写成 5685，已核对改正） |
| `SDKControlInitializeResponse` | sdk.d.ts:4504 |
| `listSessions`/`getSessionMessages`/`forkSession` | sdk.d.ts:1094 / 899 / 835 |
| `SessionMessage` | sdk.d.ts:6368 |
| `AskUserQuestionInput`/`Output` | sdk-tools.d.ts:1102 / 3749 |
| `ExitPlanModeInput`/`Output` | sdk-tools.d.ts:822 / 3342 |
| `ToolConfig`(askUserQuestion.previewFormat) | sdk.d.ts:9620 |

参考的官方文档（WebFetch 已核对，非猜测）：
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/agent-sdk/user-input
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- https://code.claude.com/docs/en/agent-sdk/skills （含"Commands in Agent SDK sessions"一节）

---

## Reviewer notes（复核记录）

复核方法：不是泛泛通读，是挑了这份指南里"哪怕错一点、Ember 写代码就会踩坑"的十几处硬指标（类型行号、字段名、枚举值、方法语义），逐条用 `grep`/`sed` 回到 `sdk.d.ts`（9833 行）和 `sdk-tools.d.ts`（4153 行）原文核对，另外用 WebFetch 重新抓了一次 `code.claude.com/docs/en/agent-sdk/permissions` 原文逐句对比第 4.1 节的引用块。下面是改动清单。

**已修正的错误（原稿写的和源码/官方文档不一致）：**

1. **`SDKMessage` 联合类型的成员数**：原稿说"一共 37 个变体"，实际数了一遍（`grep` 出整行按 `|` 切开）是 **39 个**。好消息是这 39 个变体在第 3 节里逐个都有对应到某个小节讲解，没有漏讲哪个类型，只是总数写错了。已改成 39。
2. **`AskUserQuestionOutput.answers` 的值类型**：原稿说多选题的 value"可以是字符串数组，也可以用 `, ` 拼接"。查了 `sdk-tools.d.ts:3749` 起的 `AskUserQuestionOutput` 定义，`answers` 字段的类型是 `{[k: string]: string}`——**每个 value 严格是 `string`，没有数组这个分支**，字段注释原文是"multi-select answers are comma-separated"。原稿"或数组"这半句是错的，已经在两处（§4.5 要点 4、§4.5 示例代码注释）改掉。
3. **`applyFlagSettings()` 会不会写文件**：原稿在讲 `effortLevel` 那段说"传具体等级...会被写进 settings 文件的候选值"。查了 `sdk.d.ts:2921-2944` 附近 `applyFlagSettings` 的完整文档注释：它操作的是**"flag 设置层"**，明确写着"优先级在 user/project/local 之上、managed policy 之下"——这是一个只存在于当前会话内存里的覆盖层，**不是**任何 settings.json 文件，方法本身也没有一处提到落盘。真正会通过 CLI 写入器把值写进 `localSettings`/`userSettings` 文件的是另一个方法 `updateSettings()`（`sdk.d.ts:2960` 附近，文档注释里明说"Writes settings through the CLI's own writer"）。原稿把这两个方法的语义搞混了，已经改正，并补了一句提示：Ember 如果想"记住用户上次选的 effort，下次开新会话也生效"，要调用 `updateSettings('userSettings', {effortLevel})`，不能只调 `applyFlagSettings`。
4. **§4.1 那个放进引用块的"官方原文"**：原稿写的是"The callback never fires for auto-approved tools."，格式上用 `>` 引用块暗示这是逐字原文。我重新 WebFetch 了 `permissions` 页面逐句核对：官方原文其实是**"Auto-approved tools never reach `canUseTool`."**（后面还有一句"so permission checks you put there are silently bypassed for that tool"原稿没引全）。意思没差，但拿着一句不逐字的转述当"官方文档原文"用引用块的格式呈现，容易误导后面的人以为可以直接复制这句去对答案。已经换成实测到的逐字原文，并把漏掉的后半句也补上。
5. **关键路径 `rm`/`rmdir` 的"canUseTool 例外"条件写错了**：原稿说"AskUserQuestion / 需要用户交互的 MCP 工具 / 组织标 ask 的连接器工具 / 关键路径 rm/rmdir"这四类"永远会走到 canUseTool，除非在 dontAsk 模式下直接拒绝"——把四类工具的例外条件写成了完全一样。重新核对官方文档原文后发现**关键路径 rm/rmdir 这一类的例外条件比另外三类多一档**：除了 `dontAsk` 模式会跳过回调直接拒绝之外，**`auto` 模式下 Agent SDK 会话默认也会跳过回调直接拒绝**关键路径删除（前三类工具在 `auto` 模式下仍然会走到 `canUseTool`，只有第四类不会）。这一条如果不修，Ember 在 `auto` 模式下会误以为关键路径删除一定会弹窗问用户，实际上默认是静默拒绝、用户根本看不到发生了什么。已经在 §4.1 补充说明并附上官方原句。
6. **参考位置表里 `SDKAuthStatusMessage` 的行号写错**：原稿写 `sdk.d.ts:5685`，实际 `grep` 出来的定义在 `sdk.d.ts:3685`（差了正好 2000 行，像是抄的时候手滑）。已改正。其余表里列出的行号（`query()`:3237、`Query`:2843、`Options`:1518、`CanUseTool`:213、`PermissionResult`/`PermissionUpdate`:2504/2523、`SDKMessage` union:5273、`SDKUserMessage`/`Replay`:6149/6237、`SDKPartialAssistantMessage`:5422、`SDKResultSuccess`/`Error`:5671/5610、`SDKControlInitializeResponse`:4504、`listSessions`/`getSessionMessages`/`forkSession`:1094/899/835、`SessionMessage`:6368、`AskUserQuestionInput`/`Output`:1102/3749、`ExitPlanModeInput`/`Output`:822/3342）逐一 `grep` 核对过，**全部准确**，没有再发现别的行号错误。

**核对之后确认原稿是对的、值得一提的几处（说明复核确实覆盖到了核心机制，不是走过场）：**

- `Options.settingSources`/`skills` 省略时的默认行为、`verbatimPrompts`（`client_composed`）会跳过"轮次开始附件传递"这条细节、`SDKAssistantMessage.error` 枚举值（`authentication_failed`/`billing_error`/`rate_limit`/…）、`close()` 的文档原文、`SDKSessionInfo` 全部字段、`ListSessionsOptions.includeProgrammatic` 默认 `true`、`ExitPlanModeInput` 只有一个废弃字段加开放索引签名、`setMaxThinkingTokens` 标了 `@deprecated`——这些逐一核对下来都和 `.d.ts` 原文一字不差，原稿在这些地方的转述是准确的。
- `PermissionMode` 六个值 `'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'`、`CanUseTool` 完整签名字段、子 agent 权限继承规则——跟 `.d.ts`/官方文档逐字对比也是准的。

**仍然不确定、原稿已经如实标了 `[UNVERIFIED]` 且我没能进一步验证的地方（复核后维持原判）：**

- `ExitPlanMode` 计划正文具体走哪个字段传给回调（`.d.ts` 只给了废弃字段 + 开放索引签名，没有抓包验证不知道实际 key 是什么）。
- `q.return()` 是否连带清理子进程——`.d.ts` 没写，官方文档也没提。
- 从另一层 Claude Code 会话内部启动时具体要清理哪些环境变量（`CLAUDECODE` 等）——`.d.ts`/官方文档都没列清单，原稿标的是"通用经验推断"，我没有找到更权威的来源去证实或证伪。
- `AskUserQuestion` 的"其它/自由输入"选项具体怎么在协议层区分"用户选了某个选项"和"用户绕开选项自己打字"——`.d.ts` 只说明了 `response` 字段是"用户没选结构化选项时的自由文本"，但没有进一步的抓包证据能证实原稿第 4.5 节第 6 点给的具体接线方式（"把自由输入文字直接塞进某题 answers[question]"）在真实协议里到底是不是这么处理的；这条建议听起来合理，但不算验证过的事实。
- 我自己没有重新验证 §1–§2 之外的所有 WebFetch 引用（`user-input`/`streaming-vs-single-mode`/`skills` 三篇原稿说核对过的官方文档只抽查了 `permissions` 一篇跟第 4.1 节的引用块），这三篇里的其它转述内容（比如 slash 命令在 SDK 模式下的具体行为差异、`/compact`/`/clear` 的语义）本次复核没有重新抓取原文逐句比对，只是交叉检查了跟 `.d.ts` 字段能对上的那部分（`compact_metadata`/`local_command_output` 等字段确实存在），文字表述本身按原稿"已用 WebFetch 核对"的说法暂且保留，没有推翻证据但也没有独立复核证据。
