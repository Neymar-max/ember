# Ember 竞品/前人经验调研（Claude Code CLI 的 GUI 壳子）

调研时间：2026-09-26。方法：WebSearch + WebFetch 抓取各项目 GitHub README / issues / 第三方对比文章。凡未能从可靠来源核实的地方标注 **UNVERIFIED**。

---

## 0. 最重要的一条背景事实（会改变 Ember 的定位）

**Anthropic 官方在 2026-04-14 已经把 Claude Code 桌面客户端整体重做了一版**（macOS + Windows）：并行会话 + git worktree 隔离、侧边栏会话列表、diff/终端/文件编辑器分屏、集成终端、MCP 一等支持、可选择本地/云端/SSH/WSL 运行。CLI 和这个新桌面客户端**共享同一套引擎**（project memory、CLAUDE.md、settings、MCP、hooks、skills、plugins、permission rules、模型访问全部共用）。
来源：[Claude Code Desktop Redesign 2026](https://www.buildfastwithai.com/blogs/claude-code-desktop-redesign-2026)、[Claude Code Docs – Desktop application](https://code.claude.com/docs/en/desktop)。

这意味着：
- "给 CLI 套一个好看的壳子"这件事，Anthropic 自己已经做了一遍——但用的是**2026 年春季之后的新视觉风格**，不是用户要的那种"淡黄色 + 26 年春季前"的旧 Claude App 风格。
- Ember 的真正差异化不是"有没有 GUI"，而是**（1）复刻旧的、用户偏好的视觉风格；（2）零登录、直接吃 CLI 已有的会话/配置，做一个更轻的第三方壳子，而不是替换官方客户端**。这一点务必写进产品说明，避免团队把力气花在"重新发明官方桌面版"上。

---

## 1. 逐项目调研

### 1.1 opcode（原名 Claudia，getAsterisk / winfunc 出品）

- **现状**：GitHub 星标约 15–22k（不同来源口径不同），是开源 Claude Code GUI 里最知名的一个；据第三方对比文章称，仓库自 2025-10 起已无新提交（**UNVERIFIED**，未直接核对 commit 历史）。
- **技术栈**：Tauri 2（Rust 后端）+ React 18 + TypeScript + Vite 6 + Tailwind v4 + shadcn/ui + SQLite（rusqlite）；打包用 Bun。
- **与 CLI 的通信方式**：README 里没有写明具体机制（是 spawn 子进程读 stream-json，还是走 SDK），只写"CLI 必须装好并在 PATH 里"。**UNVERIFIED** 具体实现，但从产品行为（会话来自 `~/.claude/projects/`，支持断点续跑）判断，大概率是 spawn `claude` 子进程 + 解析其 JSON/流式输出，而不是走官方 Agent SDK（因为它出现在 SDK 发布之前）。
- **认证**：不做自己的登录，依赖本机已装好的 CLI 的认证状态。
- **功能清单**：`~/.claude/projects/` 可视化浏览、会话历史与恢复、自定义 Agent（系统提示词）、后台 agent 独立进程运行、按模型/项目/时间的费用与 token 统计、MCP server 注册表管理、时间线/checkpoint 版本控制（可分支）、CLAUDE.md 内置编辑器（实时预览）、会话搜索。
- **用户反馈 / 已知问题**（GitHub issues）：
  - `#76`：CLI 装在非标准路径（如 mise 管理的 node 版本目录）时报"Claude code not found"——**PATH 探测太天真**是通病，Ember 必须做得更好（见第 3 章）。
  - `#77`："Credit balance is too low"误报——即使用户 CLI 本身用 Pro 订阅工作正常，GUI 层的账号/余额判断逻辑和 CLI 实际认证状态脱节。
  - `#78`（已核对 issue 正文）：这是社区维护的"opcode/Claudia 在 Windows 上跑起来"的补丁帖，v1 先解决"Windows 原生不支持、要用 WSL 搭桥"这个大问题；在 v2 阶段追加发现一个具体子 bug——**opcode 给 CLI 传了 `--system-prompt` 参数，而当时的 Claude CLI 版本不支持该参数，导致 agent 执行失败**，靠桥接脚本过滤掉不支持的参数才修好。原文措辞是"Claudia sends `--system-prompt` parameter which Claude CLI doesn't support"，这条经验依然成立：**GUI 层拼的 CLI 参数要跟 CLI 版本对齐，否则版本一升级就炸**，但它只是 Windows 兼容性工作里的一个子问题，不是"Windows 支持问题"本身的根因（根因是 opcode 用了 Unix-only 命令/路径，Windows 原生跑不了，需要 WSL 桥接）。

来源：[winfunc/opcode](https://github.com/winfunc/opcode)、[opcode.sh](https://opcode.sh/)、[issue #76](https://github.com/winfunc/opcode/issues/76)、[issue #77](https://github.com/winfunc/opcode/issues/77)、[issue #78](https://github.com/winfunc/opcode/issues/78)。

### 1.2 claudecodeui（siteboon，现改名 CloudCLI）

- **定位**：免费开源 Web UI/GUI，用来远程管理 Claude Code 会话和项目，同时支持 OpenCode、Cursor CLI、Codex。可自托管、可上 Docker、也有托管版 "CloudCLI Cloud"。
- **技术栈**：前端 React + Vite + Tailwind + CodeMirror；后端 Node.js（`/server` 目录）+ Docker；终端用 xterm.js；可选接 TaskMaster AI。
- **与 CLI 的通信方式**：README 没写死具体机制，但文档提到"通过内置 shell 直接访问 Agents CLI"——**UNVERIFIED** 是否走 stream-json，但从"自动发现 `~/.claude` 下的会话"这个行为看，是直接复用本机 CLI 的会话文件，而不是自己维护一套会话状态。
- **认证**：明确"自动发现 `~/.claude` 文件夹里的会话"，说明是**复用 CLI 已有登录态**，这点和我们要做的一致，值得参考其实现细节（如果能拿到源码）。
- **功能清单**：响应式桌面/平板/手机 UI、聊天界面、集成终端（xterm.js）、文件浏览器（语法高亮+实时编辑）、Git 面板（查看/暂存/提交/切分支）、浏览器端会话支持、插件系统、多模型兼容（Claude 和 GPT 系列）、MCP server 管理。
- **已知限制**：工具默认关闭（安全考虑，需要手动开）；自托管要求机器常开；Sandbox 模式标注"实验性"。
- **GitHub issues 里的坑（这些对 Ember 特别重要，因为都是"套壳子"类产品的通病）**：
  - `#1368`：**会话恢复（resume）会卡死**——后台 agent 任务被打断后再恢复，如果复用了同一个内部 task-id，`tool_use_id` 会错位，导致异步完成检测失效，会话看起来"永久卡住"，刷新/换浏览器都没用。→ Ember 做 resume 时，tool_use_id/session 状态机要重新生成而不是复用旧的。
  - `#1144`：**CLI 原生交互模式和 Web UI 的"续聊"会分裂成两条 prompt-cache 血统**——同一个会话在原生 CLI 和 GUI 之间来回切换时，Anthropic 的 prompt cache 命中率会被破坏（本质是两边对"这是同一个会话"的理解不一致）。→ Ember 如果允许用户在 GUI 和裸 CLI 之间来回用同一个 session，要格外小心 session 文件的写入时序。
  - `#1350`：**权限拒绝没有原因、也不会真的停下 agent**——用户点"拒绝"后，模型收到的永远是通用的 fallback 文案（"User denied tool use"，没有工具名/命令/原因），`interrupt` 字段也没设置。→ Ember 的权限弹窗要允许用户写拒绝理由，并确保拒绝真的打断当前 tool loop。
  - `#1376`（PR）：权限确认超时时间硬编码，后来才改成可配置（`CLAUDE_TOOL_APPROVAL_TIMEOUT_MS`，默认 55 秒，超时自动拒绝）。→ 长时间不响应的权限弹窗默认拒绝这件事，Ember 也要显式设计（不能让用户离开电脑回来发现权限静默被拒、任务半途夭折）。

来源：[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)、[claudecodeui.siteboon.ai](https://claudecodeui.siteboon.ai/)、issue [#1368](https://github.com/siteboon/claudecodeui/issues/1368)、[#1144](https://github.com/siteboon/claudecodeui/issues/1144)、[#1350](https://github.com/siteboon/claudecodeui/issues/1350)、PR [#1376](https://github.com/siteboon/claudecodeui/pull/1376)。

### 1.3 Crystal（stravu）→ 已改名/迁移为 Nimbalyst（2026-02 起）

- **Crystal 定位**：Electron 桌面应用，用 git worktree 隔离并行跑多个 Claude Code（后来也支持 Codex）会话，方便对比不同方案、每次迭代自动 commit 方便回滚。**2026-02 已宣布弃用**，官方建议迁移到 Nimbalyst。
- **Nimbalyst 定位**：开源可视化工作区，kanban 面板管理并行 agent 会话（Claude Code / Codex / OpenCode / GitHub Copilot alpha / Gemini provider），带 WYSIWYG 编辑器（markdown/线框图/图表）、任务追踪、内置 Git（分支/worktree/暂存/AI 生成 commit message/内嵌终端）、MCP client+server（工具结果渲染成可视化卡片而不是原始 JSON）、iOS/Android 移动端配套。MIT 协议，Mac/Windows/Linux 全平台。
- **技术栈**：monorepo，pnpm + Node.js（frontend/main/shared/test 分层，看目录结构像 Electron 主进程/渲染进程分离），但源码没有直接写明是否走官方 Agent SDK。**UNVERIFIED** 具体通信机制。
- **对 Ember 的启示**：
  - "把 MCP 工具结果渲染成卡片而不是原始 JSON"这个思路，和我们"可折叠 tool call + 高可读性"的诉求是一致的，值得借鉴交互形式。
  - Crystal → Nimbalyst 的这次"功能大扩张"（从单纯的会话管理器变成任务看板+多编辑器）说明：**单纯的"CLI 壳子"这个定位商业上留存率有限**，容易被逼着往"更重的 IDE 替代品"演化。Ember 如果要保持"轻、专注可读性"的定位，需要在产品文档里明确写清楚不做的事（对标 Nimbalyst 的功能蔓延，主动收窄范围）。

来源：[stravu/crystal](https://github.com/stravu/crystal)、[Nimbalyst GitHub](https://github.com/nimbalyst/nimbalyst)、[nimbalyst.com/crystal](https://nimbalyst.com/crystal/)、[Best Claude Code GUI 2026 对比文](https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/)。

### 1.4 Conductor（conductor.build）

- **定位**：Mac 原生 GUI，专注"并行跑多个 Claude Code agent"，同样基于 git worktree 隔离。左侧栏是 workspace 列表，中间是和 CLI 一致的聊天界面（支持 @file、slash command），右侧是实时 git diff + 集成终端。
- **认证/计费**：App 本身免费，但需要用户自己有 Claude Code 订阅——**说明它复用用户已有的 CLI/订阅认证，不做自己的账号体系**，这和 Ember 的"CLI 已登录就直接能用"诉求完全一致，是最贴近我们目标的先例之一。
- **平台限制**：目前只有 Mac 版，Linux/Windows 用户只能等或者继续用 CLI——**只做单一平台反而是可以接受的取舍**，Ember 同样先只做 macOS 没问题。
- **UI 结构**（值得直接参考）：三栏布局——workspace 侧栏 / 聊天主区（复刻 CLI 的 @file、slash command 体验）/ 右侧 diff+终端。

来源：[conductor.build 文档](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions)、[X 上 @majidmanzarpour 的介绍](https://x.com/majidmanzarpour/status/1950626486244749750)、[Medium 使用记录](https://georgetaskos.medium.com/scaling-the-loop-run-5-claude-code-sessions-in-parallel-with-conductor-build-539b52888a81)。

### 1.5 Claudable（opactorai / anymorph-ai）

- **定位**：不是"CLI 壳子"，是"开源 web builder"——用自然语言描述想要的 app，底层调用本地 CLI agent（Claude Code / Codex / Gemini CLI / Qwen Code / Cursor Agent 任选）直接生成并部署产品（可部署到 Vercel、接 Supabase 数据库）。
- **和 Ember 的关系**：定位不同（它是"用 CLI 造应用"的产品化工具，不是"让 CLI 好读"的壳子），但证明了"底层可插拔多种 CLI agent"是一个被验证过的架构模式，Ember 若未来想支持除 Claude Code 外的 CLI，可以参考它的抽象层设计（本次任务范围内不展开）。

来源：[opactorai/Claudable](https://github.com/opactorai/Claudable)。

### 1.5b Claude Code on the web / Cline / Roo Code（任务要求覆盖但容易漏掉的两类）

- **Claude Code on the web**：2025-10-20 以 Pro/Max 用户的 beta research preview 上线，此后 GA 并改名为"cloud sessions"（面向 Pro/Max/Team，以及带高级席位的 Enterprise），本质是把会话跑在 Anthropic 托管的隔离沙盒里，浏览器/手机可用、无需本机终端。**这就是第 0 章"2026-04-14 桌面重做"里 `Environment: Cloud` 选项背后的同一个能力**，不是一个独立产品——只是任务清单里单独点名了，这里补一句明确关系，避免误以为是另一个需要单独对比的竞品。对 Ember 没有直接架构参考价值（它是 Anthropic 云端沙盒，不是本机 GUI 套壳），但说明"零登录直读本机 CLI"这个定位在官方产品矩阵里确实是空白——官方给的是"重做终端体验"（桌面版）和"完全搬到云上"（web/cloud sessions）两个方向，都不是"轻量本机壳子"。来源：[Claude Code on the web 官方博客](https://claude.com/blog/claude-code-on-the-web)、[Use Claude Code in the cloud 文档](https://code.claude.com/docs/en/claude-code-on-the-web)、[InfoWorld 报道](https://www.infoworld.com/article/4075911/anthropic-extends-claude-code-to-browsers.html)。
- **Cline / Roo Code**：均为 VS Code 插件（Roo Code 是 Cline 的 fork，前身叫 Roo Cline），运行在 VS Code 扩展宿主进程里，直接接多家模型 API（不止 Anthropic），有自己的 agent 循环、文件系统/LSP 集成、工具审批 UI；官方也提供"Claude Code VS Code extension"，这个扩展**内置打包了自己的一份 CLI**，和独立安装的 `claude` 命令行是两条并行路径（用同一套模型/认证）。**结论：Cline/Roo Code 不是"给 Claude Code CLI 套壳"，架构上是独立的、editor-native 的 agent 实现，不 spawn 用户本机的 `claude` 二进制**，所以对 Ember（"直接 spawn 用户已装好的 CLI"这个核心机制）没有直接的实现参考价值，只在"工具审批 UI 长什么样"这一点上可以看一眼 Roo Code 的做法。这是本任务候选名单里唯一被判定为"架构不同、暂不深挖"的两个项目，明确记录理由而不是漏掉。来源：[Cline vs Claude Code 对比](https://www.morphllm.com/comparisons/cline-vs-claude-code)、[Roo Code vs Claude Code 对比](https://www.lowcode.agency/blog/claude-code-vs-roo-code)、[Claude Code VS Code 扩展官方文档](https://code.claude.com/docs/en/vs-code)。

### 1.6 "Companion" / "Nimbalyst" / "CloudCLI" 名称核对

- 任务里提到的 "Nimbalyst" 已在 1.3 核实为 Crystal 的官方后继项目。
- "CloudCLI" 已在 1.2 核实为 claudecodeui/siteboon 的新品牌名（同一个项目，README 标题就是 "aka Claude Code UI"）。
- **"Companion" 没有查到对应的知名 Claude Code GUI 项目**——搜索结果里出现的都是无关内容（如 "opcode's own coding agent"的宣传语里提到 companion 一词，不是产品名）。**UNVERIFIED / 未找到实体**，不排除是内部代号或规模很小、未被索引的项目。

### 1.7 中文社区项目

搜索到但规模均较小、**信息可信度需要用户自行二次核实（UNVERIFIED）**：
- **Claude Web UI**（`github.com/heng1234/claude-web`，**UNVERIFIED** 仓库是否仍活跃）：号称支持多会话、图片上传、token 级流式、Git Checkpoint 回滚、暗黑模式等 20+ 特性。
- **CC GUI 1.0**（2026-09-24 发布，博客来源 80aj.com）：基于 Tauri，号称聚合 Claude Code / Codex / Gemini 等 11 种 CLI，安装包仅 11.8MB，集成文件树/Git/终端。这是目前查到的、**发布时间最新**（就在本次调研前两天）的同类项目，体积做得很小（Tauri 的优势），值得关注但功能细节未深挖。
- **Misaka**（`github.com/knqiufan/Misaka`，**UNVERIFIED**）：博主自制的 Claude Code GUI 桌面客户端。
- 没有查到知乎/小红书/V2EX 上有实质技术内容（架构、认证方式）的深度帖子，多是"官方桌面版好不好用"的讨论，价值有限，未纳入。

---

## 2. 官方 Agent SDK 接 Electron 的已知坑（对 Ember 直接相关，优先级最高）

来源：[liruifengv 的 SDK 踩坑记录](https://liruifengv.com/posts/claude-agent-sdk-usage/)、[vanzan01/claude-agent-sdk-starter](https://github.com/vanzan01/claude-agent-sdk-starter)、[DoltHub 博客](https://www.dolthub.com/blog/2026-02-16-building-with-claude-code-sdk/)。

1. **ASAR 打包会让 `cli.js` 找不到**：SDK 内部会 spawn 一个 Node 进程去跑 `@anthropic-ai/claude-agent-sdk` 附带的 `cli.js`（或者我们这里是 `pathToClaudeCodeExecutable` 指向的用户自己的 `claude` 二进制）。二进制/脚本不能从 `app.asar` archive 内部直接执行。**修法**：`electron-builder` 配置 `asarUnpack: ['**/node_modules/@anthropic-ai/**']`，运行时把解析到的路径从 `app.asar/...` 重写成 `app.asar.unpacked/...`。这一条对 Ember **不完全适用**（因为我们是 `pathToClaudeCodeExecutable` 指向用户本机已安装的 `~/.local/bin/claude`，不是打包进 asar 里的文件），但如果未来决定把 SDK 自带的 `cli.js` 也打进包里做 fallback，这条必须处理。
2. **`spawn node ENOENT`**：SDK 默认用系统 PATH 找 `node` 来跑 `cli.js`，Electron 打包后的 GUI 进程 PATH 环境往往是精简的（不像 shell 里那样有 `.zshrc`/`.bash_profile` 加过的路径），会导致找不到 `node`。三种修法：换用 `fork`（用 Electron 自带的 Node 运行时）；用 SDK 的 `spawnClaudeCodeProcess` 自定义参数；打包自带的 `bun` 并手动设 PATH。**对 Ember 的意义**：我们本来就是直接 spawn 用户的 `claude` 二进制（原生可执行文件，不是靠 node 跑脚本），所以理论上不受这条影响；但**必须在真机上验证**：GUI App 通过 Finder/Dock 双击启动时的环境变量（尤其 `PATH`）和从 Terminal 里 `npm run dev` 启动时完全不同，`~/.local/bin` 这种用户级安装路径大概率不在 GUI 进程默认 PATH 里（这正是 opcode issue #76 的根因，也是 macOS GUI App 的通病：Finder 启动的进程不会 source `.zshrc`）。**必须做的事**：不要依赖 PATH 查找，直接让用户在设置里指定 `claude` 可执行文件路径，且启动时做几个兜底探测（`which claude`、`~/.local/bin/claude`、`/opt/homebrew/bin/claude`、`/usr/local/bin/claude`），找到后存到本地配置，不必每次都重新探测。
3. **`~/.claude/settings.json` 会覆盖你传的环境变量**：用户级配置文件的优先级比某些自定义 env 高，如果 Ember 想临时覆盖某个配置项（比如强制某个 model），需要显式排除 `'user'` 这个 settings 来源，否则静默不生效。
4. **permission 系统有多层叠加、互相打架**：`permissionMode`、hooks、`settings.json` 三层都能影响权限判定，SDK 层的设置不一定能覆盖项目级配置，容易出现"我在 GUI 里选了 auto-accept，但某个 hook 还是弹出确认"的诡异体验。Ember 的权限 UI 要在弹窗里明确告诉用户"这条规则来自哪一层"，否则用户会觉得开关不生效、产生不信任。
5. **API 设计本身有重叠概念**：`tools` / `allowedTools` / `disallowedTools` / `canUseTool` 四个参数职责有重叠、优先级不直观。Ember 内部做权限设置面板时，建议只暴露一套心智模型（比如只暴露"权限模式 + 例外规则列表"），不要把 SDK 的四个参数原样甩给用户。

---

## 3. macOS 打包/签名/分发的坑（无 Apple Developer 账号场景，直接对应本任务的交付要求）

来源：[electron-builder Code Signing 文档](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[electron-builder issue #8191](https://github.com/electron-userland/electron-builder/issues/8191)、[Zenium PR #55](https://github.com/BenItBuhner/Zenium/pull/55)、[artmann.co 签名教程](https://www.artmann.co/articles/signing-notarizing-and-publishing-an-electron-app-for-mac-os)。

- **现象**：Apple Silicon 上，完全不签名的 Electron App **直接闪退/打不开**并报 "App is damaged and can't be opened. You should move it to the Bin."——这不是 Gatekeeper 的"未知开发者"警告（那个可以右键"打开"绕过），而是更严重的一档：**arm64 架构要求任何可执行文件必须带有某种签名才能被系统加载执行**，跟有没有付费开发者账号无关。
- **修法（免费、无需 Apple Developer Program 会员）**：
  1. `electron-builder` 配置里设 `mac.identity: null`（告诉它不要去找付费证书）。
  2. 加一个 `afterPack` 钩子脚本，在打包成 `.dmg`/`.zip` **之前**对 `.app` 做 ad-hoc 签名（关键：必须在打包成 dmg 之前签，签完再打包才有效，签完 dmg 再签没用）：
     ```
     codesign --force --deep --sign - --options runtime --timestamp=none \
       --entitlements build/entitlements.mac.adhoc.plist YourApp.app
     ```
     其中 `--sign -` 就是 ad-hoc 签名（不需要证书）。
  3. 效果：应用不再报"damaged"，而是退回到普通的"未知开发者"提示，用户右键 → 打开一次即可正常使用（后续双击不再提示）。
- **对 Ember 的直接指导**：既然要交付 `.dmg` 给"别人"（非本机用户），必须做 ad-hoc 签名这一步，否则收到 dmg 的人十有八九会遇到"already damaged"直接放弃。这一步应该写进 `electron-builder` 的构建脚本，不能留成手动步骤（人会忘）。
- 另一个相关坑（**UNVERIFIED，仅供警惕**）：`electron-builder` issue 提到过 ad-hoc 签名之后摄像头/麦克风等需要隐私权限的 entitlement 在某些版本上会失效——Ember 目前不需要摄像头/麦克风权限，风险不大，但如果未来加语音输入之类的功能要重新验证。

---

## 4. Ember 功能优先级清单（Must / Should / Could）

站在"CLI 用户想要更好读的界面，但不想换一套认证、不想丢掉 CLI 的能力"这个诉求上排序：

### Must（没有就不算完成这个产品的核心承诺）
1. **零登录，直读本机 CLI 状态**：通过 `pathToClaudeCodeExecutable` 指向用户已安装的 `claude`，`initializationResult()` 拿到的 account/组织/订阅信息直接展示，不弹自己的登录框。这是产品定义本身，不是"加分项"。
2. **Markdown 完整渲染**：标题、列表、表格、代码块（带语法高亮）、粗体斜体正确渲染——这是这个产品存在的第一理由（对应第 1.7 章"终端里 markdown 渲染丢 40% GFM 特性"的官方 CLI 痛点）。
3. **可折叠的工具调用（tool call）展示**：每个 tool_use/tool_result 默认折叠成一行摘要（工具名+关键参数），点开看详情，避免长会话被 Bash 输出刷屏——直接对应用户抱怨的"可读性差"。
4. **Diff 视图**：Edit/Write 类工具调用展示成 side-by-side 或者至少高亮 +/- 的 diff，而不是原始 JSON 或者纯文本 patch。
5. **会话历史与 CLI 共享（`~/.claude/projects/`）**：`listSessions()` 列出的历史会话要能在 GUI 里打开、继续对话（resume），且不能破坏 CLI 侧继续使用同一个会话的能力（参考 1.2 章 claudecodeui 的 prompt-cache 分裂坑，做 session 写入时要格外小心，谁在写、什么时候写，避免竞态）。
6. **权限弹窗**：`canUseTool`/permission prompt 走美观的原生对话框，清楚展示"要执行的具体命令/文件路径"，允许"允许一次/总是允许/拒绝并说明原因"。
7. **视觉还原**：淡黄色/米白背景 + 陶土橙强调色 + 衬线体（assistant 消息），这是用户明确提出的唯一"美学要求"，必须做到，不能敷衍成"暖色系即可"。

### Should（明显提升体验，但缺了不影响核心承诺）
8. **模型/权限模式切换器**：模型列表读 `initializationResult()` 里的 `models`；当前权限模式**不在** `initializationResult()` 的返回里（其 `SDKControlInitializeResponse` 类型只有 `commands/agents/output_style/available_output_styles/models/account/hooks_applied/plugins_applied/fast_mode_state` 等字段，没有 permission mode），而是从 stream 里的 `system/init`（`SDKSystemMessage.permissionMode`）和 `system/status`（`SDKStatusMessage.permissionMode`）两类消息里读，切换权限模式用 `setPermissionMode`（对应 control request `subtype: 'set_permission_mode'`）。做下拉切换器要订阅这两个 system 消息来保持显示同步，不能只在初始化时读一次。（已核对 `docs/sdk/sdk.d.ts` 第 4504–4531 行 `SDKControlInitializeResponse`、第 5859 行 `SDKSystemMessage.permissionMode`、第 5823 行 `SDKStatusMessage.permissionMode`）
9. **Slash 命令面板**：读 `commands` 列表，做成 `/` 触发的命令面板（类似 VS Code Command Palette）。
10. **Todo/Plan 面板**：Claude Code 的 TodoWrite 工具输出，单独渲染成一个可勾选的任务列表侧栏（参考官方 2026-04 新桌面版的"plan sidebar"、Conductor 的右侧栏做法）。
11. **费用/用量/Rate limit 展示**：stream 里的 `rate_limit_event`（five_hour/seven_day utilization）做成小的进度条/菜单栏图标，参考 ClaudeUsageBar/Usagebar 这类第三方工具的展现形式（用 OAuth token 读用量，无需二次登录）。
12. **完成通知**：长任务跑完后，macOS 通知中心提醒（用户可能切到别的窗口去了）。
13. **多会话并行**：多个 tab/窗口同时管理多个会话（不强求 git worktree 隔离这种重量级方案，先做"同时开着、能看到各自状态"就够）。
14. **@file 提及 + 图片粘贴**：输入框支持 `@` 唤起文件选择器插入路径，支持直接粘贴截图。
15. **搜索**：跨会话历史的全文搜索（尤其是长期使用后会话会很多）。

### Could（好但不紧急，出问题不影响首个可用版本）
16. Agents/自定义 subagent 管理界面（读 `agents` 列表并展示，暂不做编辑器）。
17. Skills/MCP/Plugins 的可视化管理（列出已装的，暂不做安装/卸载 UI）。
18. 导出会话为 Markdown/HTML。
19. 键盘快捷键全套定制。
20. 跨设备同步设置（本地优先，云同步是加分项非必需）。

---

## 5. 具体的坑与规避对照表

| 坑 | 来源 | 对 Ember 的规避方案 |
|---|---|---|
| GUI 进程找不到 CLI（PATH 里没有用户级安装路径） | opcode #76；SDK "spawn node ENOENT" 讨论 | 不依赖 PATH 自动探测；首次启动引导用户手动选择/确认 `claude` 二进制路径，并做几个常见路径的兜底探测（`~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`），成功后写入本地配置持久化 |
| 未签名 App 在 Apple Silicon 上直接报"damaged" | electron-builder issue #8191 | `afterPack` 钩子里对 `.app` 做 `codesign --sign -` ad-hoc 签名，必须在打包成 dmg **之前** |
| 会话恢复卡死（tool_use_id 错位） | claudecodeui #1368 | resume 时不要复用旧的内部 task/correlation id；每次 resume 生成新的运行时状态机 |
| GUI 和裸 CLI 交替用同一会话导致 prompt-cache 分裂 | claudecodeui #1144 | 若要支持"在 GUI 里继续一个 CLI 建的会话"，只在会话空闲、没有并发写入时才允许双端切换；写清楚"当前会话正在被 CLI/GUI 占用"的状态提示 |
| 权限拒绝没理由，模型收到的信息太模糊 | claudecodeui #1350 | 拒绝弹窗提供"写理由"输入框，透传给 `canUseTool` 的返回结果 |
| 权限确认默认超时静默拒绝，长任务半途夭折 | claudecodeui #1376 | 超时时间可配置，且 UI 上要有明显的倒计时/即将超时提示，不能悄悄拒绝 |
| GUI 层拼的 CLI 参数（如 `--system-prompt`）版本不兼容 | opcode #78 | 启动时读 CLI 版本号，做参数兼容表，而不是硬编码一套参数永远传 |
| SDK 里 `tools`/`allowedTools`/`disallowedTools`/`canUseTool` 概念重叠、优先级不直观 | liruifengv 踩坑记录 | Ember 自己的设置面板只暴露一套简化心智模型（权限模式 + 例外名单），内部再翻译成 SDK 参数，不要把四个参数原样甩给用户 |
| `~/.claude/settings.json` 优先级高于自定义 env，覆盖失效 | liruifengv 踩坑记录 | 需要强制覆盖某配置时，显式排除 `'user'` 来源（若 SDK 支持 source 过滤参数），并在 UI 上提示"此设置来自项目/用户配置，可能不会生效" |
| 功能范围蔓延（Crystal → Nimbalyst 从会话管理器变成全功能任务看板） | Crystal/Nimbalyst 迁移历史 | 产品文档明确写"不做"的清单（不做多 agent 看板、不做跨平台、不做云端同步作为 v1 目标），防止团队自己把范围做大 |
| 终端 markdown 渲染丢失 GFM 特性（官方 CLI 本身的已知问题） | CLI issue #26390 等 | Ember 的渲染层直接用成熟的 web markdown 渲染库（如 react-markdown + remark-gfm），完整支持表格/任务列表/删除线等，这是我们相对官方 CLI 终端渲染的核心卖点 |

---

## 6. 未能验证 / 需要用户或团队自行确认的点

- "Companion" 项目：未找到对应实体，可能是内部代号或规模太小未被搜索引擎索引。
- claudecodeui / opcode / Crystal 三者与 CLI 的**确切**进程通信协议（是否走 `stream-json` 输出格式、是否用官方 Agent SDK、还是自己解析 CLI 的 stdout）均未能从公开 README 直接确认，只能从产品行为反推。如果需要精确复刻某个交互细节，建议直接读它们的源码（均开源）而不是依赖本文档的推断。
- CC GUI 1.0（中文社区，2026-09-24 发布）功能细节未深挖，只做了标题级确认，值得后续单独跟进（体积做到 11.8MB 这个数据点对我们用 Electron 的体积预期是个参考基准，但 Tauri 和 Electron 体积不可直接比较）。
- electron-builder ad-hoc 签名后是否影响其他 entitlement（如麦克风/摄像头）：本任务不涉及这些权限，标记为 UNVERIFIED 但低风险。

---

## 参考来源汇总

- [winfunc/opcode](https://github.com/winfunc/opcode) ・ [opcode.sh](https://opcode.sh/) ・ issues [#76](https://github.com/winfunc/opcode/issues/76) [#77](https://github.com/winfunc/opcode/issues/77) [#78](https://github.com/winfunc/opcode/issues/78)
- [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) ・ [claudecodeui.siteboon.ai](https://claudecodeui.siteboon.ai/) ・ issues [#1368](https://github.com/siteboon/claudecodeui/issues/1368) [#1144](https://github.com/siteboon/claudecodeui/issues/1144) [#1350](https://github.com/siteboon/claudecodeui/issues/1350) ・ PR [#1376](https://github.com/siteboon/claudecodeui/pull/1376)
- [stravu/crystal](https://github.com/stravu/crystal) ・ [nimbalyst/nimbalyst](https://github.com/nimbalyst/nimbalyst) ・ [nimbalyst.com/crystal](https://nimbalyst.com/crystal/) ・ [Best Claude Code GUI 2026 对比](https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/)
- [conductor.build 文档](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions) ・ [X 介绍帖](https://x.com/majidmanzarpour/status/1950626486244749750)
- [opactorai/Claudable](https://github.com/opactorai/Claudable)
- [Claude Code Desktop Redesign 2026](https://www.buildfastwithai.com/blogs/claude-code-desktop-redesign-2026) ・ [官方桌面文档](https://code.claude.com/docs/en/desktop)
- [liruifengv：Claude Agent SDK 踩坑](https://liruifengv.com/posts/claude-agent-sdk-usage/) ・ [vanzan01/claude-agent-sdk-starter](https://github.com/vanzan01/claude-agent-sdk-starter) ・ [DoltHub 博客](https://www.dolthub.com/blog/2026-02-16-building-with-claude-code-sdk/)
- [Electron 官方签名文档](https://www.electronjs.org/docs/latest/tutorial/code-signing) ・ [electron-builder issue #8191](https://github.com/electron-userland/electron-builder/issues/8191) ・ [Zenium ad-hoc 签名 PR](https://github.com/BenItBuhner/Zenium/pull/55) ・ [签名教程](https://www.artmann.co/articles/signing-notarizing-and-publishing-an-electron-app-for-mac-os)
- [Claude Code CLI markdown 渲染问题 issue #26390](https://github.com/anthropics/claude-code/issues/26390)
- [ClaudeUsageBar](https://www.claudeusagebar.com/) ・ [Usagebar](https://usagebar.com/)
- 中文社区：[80aj.com：CC GUI 1.0](https://www.80aj.com/2026/09/24/ai-client-cc-gui-1-0/)（其余中文项目信息量有限，见第 1.7 章标注）
- [Claude Code on the web 官方博客](https://claude.com/blog/claude-code-on-the-web) ・ [Use Claude Code in the cloud 文档](https://code.claude.com/docs/en/claude-code-on-the-web) ・ [InfoWorld 报道](https://www.infoworld.com/article/4075911/anthropic-extends-claude-code-to-browsers.html)
- [Cline vs Claude Code 对比](https://www.morphllm.com/comparisons/cline-vs-claude-code) ・ [Roo Code vs Claude Code 对比](https://www.lowcode.agency/blog/claude-code-vs-roo-code) ・ [Claude Code VS Code 扩展官方文档](https://code.claude.com/docs/en/vs-code)

---

## Reviewer notes（复核记录，2026-09-26）

复核方法：对着 `/Users/you/Desktop/claude/ember/docs/sdk/sdk.d.ts`（9833 行）和 `sdk-tools.d.ts` 逐条 grep 核对 SDK 相关断言；对 GitHub 项目/issue 用 `gh api` 直接查真实标题和状态（不是转述第三方文章）；对官方产品事实用 WebFetch 抓官方文档原文核对。

**改正的问题（原文有错，已在正文改）：**
1. **第 4 章"Should"第 8 条原文错误**：原文说"读 `initializationResult()` 里的 `models`/`current_permission_mode`"——**这是和 SDK 类型定义直接矛盾的事实错误**。核对 `sdk.d.ts` 第 4504–4531 行，`SDKControlInitializeResponse` 的字段是 `commands / agents / output_style / available_output_styles / models / account / hooks_applied? / plugins_applied? / fast_mode_state? / fast_mode_disabled_reason?`，**没有任何 permission mode 字段**，全文 grep `current_permission_mode` 在 sdk.d.ts 里零命中。当前权限模式实际来自 stream 里的 `system/init`（`SDKSystemMessage.permissionMode`，第 5859 行）和 `system/status`（`SDKStatusMessage.permissionMode`，第 5823 行），切换模式对应的 control request 是 `subtype: 'set_permission_mode'`（第 5034 行）。已在正文改写并注明具体行号。这一条如果没改，Ember 工程实现时会去 `initializationResult()` 返回值里找一个不存在的字段，白白浪费排查时间。
2. **opcode issue #78 的归因过度简化**：原文把"Windows 支持问题"整体的根因说成是 `--system-prompt` 参数不兼容。用 `gh api repos/winfunc/opcode/issues/78 --jq '.body'` 读了 issue 正文原文：真实根因是 opcode/Claudia 用了 Unix-only 命令和路径，Windows 原生跑不了，社区方案是搭 WSL 桥；`--system-prompt` 参数不兼容只是 v2 阶段发现的一个子 bug（原文英文原句："Claudia sends `--system-prompt` parameter which Claude CLI doesn't support"）。已改写区分"整体根因"和"子 bug"两层。

**核实为真、原文可以放心引用的关键断言（逐条验证来源，不是转述）：**
- `gh api` 直接查证 4 个 issue + 1 个 PR 标题与状态：opcode `#76`/`#77`/`#78`、claudecodeui `#1368`/`#1144`/`#1350`/PR `#1376`，标题与原文描述的内容一一对应（均为 `open`，`#1376` 未合并，原文没有声称已合并，无问题）。
- `gh api` 查证 CLI 官方 issue `#26390`，标题原文是"Terminal markdown renderer silently destroys **~40%** of GFM features"，和第 5 章表格里"丢 40% GFM 特性"的数字完全吻合。
- WebFetch 官方文档 `code.claude.com/docs/en/desktop` 原文逐句核对了第 0 章说的并行会话/侧边栏/多窗格（chat/diff/browser/terminal/file/plan/tasks/subagent）/集成终端/Local-Cloud-SSH-WSL 选项/MCP connector，**全部属实**；官方文档本身没写发布日期，"2026-04-14"这个具体日期是多篇第三方博客（buildfastwithai、pasqualepillitteri.it 等）复述的，原文已标来源、没有单独造出这个日期，可信度足够但严格说日期这条本身仍是二手信息（保留标注，见下方"仍不确定"）。
- WebFetch `github.com/winfunc/opcode` 核对技术栈（Tauri 2 + React 18 + TS + Vite 6 + Tailwind v4 + shadcn/ui + SQLite/rusqlite + Bun）逐项属实；star 数当前实测 **22.4k**（原文写"15–22k，口径不同"，实测值落在区间上沿，不算错但可以收紧，未强改，因为原文本身已经承认口径不一致）。
- WebFetch `github.com/stravu/crystal` 核对 Crystal→Nimbalyst 的弃用通知原文："Crystal ... has been deprecated and replaced by **Nimbalyst**"，弃用日期原文写"February 2026"，和正文第 1.3 节"2026-02 已宣布弃用"完全一致。
- Electron/macOS 签名坑：WebSearch 交叉核对多个独立来源（electron-builder issue #8191、electron.build 官方 troubleshooting 页、第三方项目 PR），确认"用 `afterSign`/`afterPack` 钩子对 `.app` 做 `codesign --sign -` ad-hoc 签名可以把'damaged'降级成普通'未知开发者'提示"这个修法成立。**但机制表述有一处可以更精确**：更准确的说法不是"arm64 架构本身要求任何可执行文件必须签名"，而是 electron-builder 默认打包时 Electron 自带的 ad-hoc 签名在改名/塞 asar 之后**签名摘要（resource seal）被破坏**，Gatekeeper 在 Apple Silicon 上对"签名摘要损坏"和"完全未签名"走的是不同分支，前者报"damaged"，后者才是能被"右键打开"绕过的"未知开发者"提示——原文因果关系写得稍粗，但**结论（必须在打包成 dmg 之前做一次干净的 ad-hoc 签名）是对的**，不影响 Ember 的实际操作指导，未改写正文（属于表述精度问题，不是事实错误，为避免过度编辑先保留）。
- 缺项已补齐：任务原本要求覆盖的候选名单里，"Claude Code on the web"和"Cline/Roo-style UIs"两项在原稿里完全没提到，已在新增的 §1.5b 里补上并注明架构结论（web 版已并入官方"cloud sessions"，和第 0 章同源；Cline/Roo 是 VS Code 插件、有自己的 agent 循环，不 spawn 用户的 `claude` 二进制，架构上和 Ember 的"套壳"路线不同，对实现没有直接参考价值）。

**仍然不确定、需要团队或用户自行确认的点（新增，不同于第 6 章已有的）：**
- opcode / claudecodeui / Crystal 与 CLI 的**确切**进程通信协议（stream-json？官方 SDK？自己解析 stdout？）依然只能从产品行为反推，本次复核没有去读它们的源码逐行确认，第 6 章已有的这条 UNVERIFIED 标注继续有效。
- "2026-04-14"这个官方桌面重做的具体发布日期来自第三方博客而非官方文档原文（官方文档页面本身不含发布日期），本次复核未找到 Anthropic 官方公告页面直接写这个日期，建议如果要在给用户/团队的正式材料里引用具体日期，再单独确认一次官方 changelog。
- opcode 现在的真实 star 数会随时间变化（本次复核时点 22.4k 是 2026-09-26 读到的快照），不是恒定值，正文区间写法本身没问题。
- electron-builder ad-hoc 签名对麦克风/摄像头等 entitlement 的影响，第 6 章已标 UNVERIFIED，本次复核没有新增证据，维持原状（Ember 当前不需要这些权限，风险低）。
