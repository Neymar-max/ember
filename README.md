# Ember — Claude Code 的桌面界面

> A warm, readable macOS desktop UI for the **Claude Code CLI**. No extra login — it drives the `claude` you already have installed and signed in, so settings, CLAUDE.md, skills, MCP, hooks and history are exactly the same as in your terminal.

Ember 是给 **Claude Code 命令行（CLI）** 套的一层好看、好读的 macOS 桌面界面。
它不是另一个 AI 客户端：背后跑的就是你电脑上已经装好、已经登录的那个 `claude`，
所以登录状态、`~/.claude/settings.json`、`CLAUDE.md`、skills、MCP、插件、hooks、权限规则、历史会话，全都和终端里一模一样。

- **不用再登录**：CLI 登录过，Ember 打开就能用。
- **可读性**：Markdown 完整渲染（表格、代码高亮、任务列表），改文件直接看 diff。
- **像 Claude app 一样读对话**：
  - 你的气泡里只显示你真正输入的内容（CLI 塞进去的系统提醒、后台任务通知、压缩摘要等都藏起来）。
  - Claude 的话按正文显示，每段工具调用收成一行灰字，例如「运行了 2 条命令」「创建了 a.py +85 -0 ›」，点开看细节。
  - 思考过程只显示一行摘要，正在思考时会闪动；回答完成后，整个思考过程自动折叠成「思考过程 · 5 个步骤 · 用时 1m 12s ›」，只留下最终结论。
- **右侧边栏**（标题栏右上角按钮打开）：
  - 「任务」：子 agent、工作流、后台命令的实时状态——在做什么、用了多久、调用了几次工具、花了多少 tokens，点开能看每一步。
  - 「文件」：Claude 这次改过的文件（带 +/- 行数），以及文件夹里其他新生成的文件；点开直接预览（Markdown 排版、代码高亮）。回复里的文件链接也会在这里打开。
- **插话看得见**：Claude 正在工作时你再发消息，消息会显示「排队中」；等它做完手头这一步真正读到时，变成「已读到」，并出现在它读到的位置。
- **Claude 旧版风格**：淡黄奶油底色、陶土橙强调色、衬线字体的回复正文；支持深色模式。
- **模型与思考强度**：输入框右下角选模型；旁边的强度按钮拖动「更快 ↔ 更聪明」（低 / 中 / 高 / 超高 / 最大 / Ultracode，颜色随档位变化）；圆环悬停可看上下文窗口占用和套餐额度（5 小时、每周、分模型每周，含重置时间）。
- **和终端互通**：侧边栏列出 `~/.claude/projects` 里所有历史会话，点开就能接着聊；也能一键在终端里 `claude --resume`。

## 安装

1. 在本仓库的 [Releases](../../releases) 页面下载对应芯片的安装包：
   - Apple 芯片（M1/M2/M3/M4…）：`Ember-1.1.1-arm64.dmg`
   - Intel 芯片：`Ember-1.1.1-x64.dmg`
2. 双击打开 DMG，把 **Ember** 拖进「应用程序」。
3. **首次打开被拦截怎么办**（这个 App 没有买 Apple 开发者证书，macOS 会拦一下，不是文件坏了）：
   - 方法一：双击 Ember → 弹窗点「完成」→ 打开「系统设置 → 隐私与安全性」→ 往下找到「已阻止打开 Ember」→ 点「仍要打开」。
   - 方法二：打开「终端」，运行
     ```bash
     xattr -dr com.apple.quarantine /Applications/Ember.app
     ```
   只需要做一次。

## 使用前提

- 已安装 Claude Code CLI（终端里能运行 `claude`）。没装的话：
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- 已登录：在终端运行 `claude`，输入 `/login` 按提示完成。
- macOS 12 或更新版本。

Ember 找不到 CLI 或 CLI 没登录时，会在启动页告诉你怎么处理；也可以在「设置 → Claude Code」里手动指定 `claude` 的路径。

## 常见问题

**Ember 会上传我的数据吗？** 不会。Ember 只是在本机启动你的 `claude` 进程并显示它的输出，和你在终端里用 CLI 发出的网络请求完全一样。

**用的是哪个账号、哪个套餐？** 就是 CLI 当前登录的账号，左下角会显示邮箱和套餐。

**权限确认怎么处理？** 和 CLI 一样：Claude 要运行命令或改文件时，输入框上方会弹出确认卡片（允许 / 本次会话都允许 / 拒绝并告诉 Claude 怎么做）。也可以在输入框左下角切换「自动接受编辑」「计划模式」等权限模式。

**Ember 里的对话能在终端接着聊吗？** 能。1.1.1 起 Ember 新开的对话会出现在终端 `claude --resume` 的列表里（在同一个文件夹下运行）。更早版本开的对话不在列表里，可以点 Ember 标题栏的「在终端中打开」，或运行 `claude --resume <对话编号>`。

**日志在哪？** `~/Library/Logs/Ember/main.log`（不记录对话内容和任何凭证）。

## 开发

```bash
npm install
npm run dev        # 开发模式
npm run typecheck  # 类型检查
npm test           # 单元测试
npm run dist       # 打包 arm64 + x64 两个 DMG，输出到 release/
```

技术栈：Electron + React + TypeScript，后端使用官方 `@anthropic-ai/claude-agent-sdk`（通过 `pathToClaudeCodeExecutable` 启动用户本机的 CLI）。

本项目以 [MIT 许可证](LICENSE) 开源：可以自由使用、修改、再发布，保留版权声明即可。

字体：Source Serif 4、Inter、JetBrains Mono（均为 SIL Open Font License）。
Ember 是社区项目，与 Anthropic 无关联；“Claude” 是 Anthropic 的商标。
