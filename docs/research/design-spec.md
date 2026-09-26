# Ember 视觉设计规格书 — 复刻 Claude App（2025 – 2026 年初，春季改版之前）

> 目标：给 Ember（Electron + React + TS 套壳 Claude Code CLI 的桌面 App）一份可以直接抄的视觉规格。
> 标注方式：**[已验证]** = 有具体来源交叉印证；**[推断]** = 基于命名规律/间接证据合理推断，未见官方一次来源；**UNVERIFIED** = 搜不到可靠来源，纯猜测，慎用。

---

## 0. 结论先说（给设计执行用）

- 主背景不是纯白，是暖米黄 `#F5F4EF`（`--bg-100`），卡片/输入框用更白一点的 `#F8F8F7`（`--bg-000`）。
- 品牌主色是陶土橙 **book-cloth `#CC785C`**（两个独立来源交叉验证一致），不是 Anthropic 官方品牌页上更新款的 `#D97757`（那个是 2026 年之后刷新的橙色，春季改版相关，**不要用**）。
- 正文（assistant 回复）用衬线字体，UI 控件用无衬线字体，代码用等宽字体 —— 三字体分层是 Claude 的核心识别特征，必须还原。
- 组件极简：无气泡（assistant 消息直接是衬线正文）、无阴影、边框用细的暖灰色、大圆角（面板 32px 级别，按钮/输入框 8–16px 级别）。

---

## 1. 颜色 Token

### 1.1 来源与可信度说明

真正意义上"最接近官方"的一份数据，来自一个反编译/抓取 claude.ai 渲染层实际写入 DOM 的 CSS 变量的 gist（用于导出/打印 Claude 对话的用户脚本，作者在脚本里原样保留了 claude.ai 自己的 `:root` 变量）[已验证，来源 A]：
`https://gist.github.com/0wwafa/6569915d936370656c687e014e596f4a`

这份数据里有几个反直觉但强可信的证据：变量名里出现了 `--kraft`、`--book-cloth`、`--manilla` 这种纸张/装订材质命名（Claude 的设计语言一直强调"纸感"），不像是拍脑袋编的。更关键的是，其中 `--book-cloth` 换算出的十六进制 **恰好是 `#CC785C`**，这个值和另一个独立来源——第三方复刻的 `Claude Design System DESIGN.md`（VoltAgent/awesome-design-md 仓库，来源 B：`https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md`）里标注的 "Primary: #cc785c" **完全一致**。两个互不相关的来源对上同一个色值，可信度较高。

同时要注意甄别：Anthropic 官方 `brand-guidelines` skill（`anthropics/skills` 仓库，2026 年内容）里给的橙色是 `#D97757`，这是**当前/刷新版**的品牌橙，与 2025–早2026 年 App 里实际用的 `#CC785C` 系（book-cloth / accent-main-100 ≈ `#BA5B38`）**不是同一个色**，两者色相接近但饱和度、明度不同（`#D97757` 更亮更饱和）。用户明确要"春季改版之前"的样子，所以本规格**统一采用 book-cloth/accent-main 系（#CC785C 附近），不采用 #D97757**。这一点标 **[已验证 + 需甄别]**。

原始 HSL 值（claude.ai `:root`，来源 A）与我用 Python `colorsys` 精确换算出的十六进制列在下面（HSL→RGB 是纯数学转换，换算结果本身不引入误差；不确定的只是"这份 HSL 是否等于官方当前值"这一点，来源 A 的可信度见上）。

### 1.2 Light 主题（App 默认主题，暖米黄）

| Token | HSL | HEX | 用途 |
|---|---|---|---|
| `--bg-000` | 60 6.7% 97.1% | `#F8F8F7` | 卡片/输入框/弹层表面（比页面背景更白） |
| `--bg-100` | 50 23.1% 94.9% | `#F5F4EF` | **App 主背景（暖米黄本体）** |
| `--bg-200` | 49 26.8% 92% | `#F0EEE5` | 侧边栏背景 / 次级分区背景 |
| `--bg-300` | 49 25.8% 87.8% | `#E8E5D8` | hover 态背景、分割区块 |
| `--bg-400` | 46 28.3% 82% | `#DED8C4` | 更强调的表面（如选中态背景） |
| `--bg-500` | 47 27% 71% | `#C9C0A1` | 最强调表面，很少用 |
| `--text-000` | 49 6.9% 5.5% | `#0F0F0D` | 一级正文（近黑，不是纯黑） |
| `--text-100` | 49 19.6% 13.3% | `#29261B` | 二级正文 |
| `--text-200` | 49 18.8% 20% | `#3D3929` | 三级/说明文字 |
| `--text-300` | 49 9% 30% | `#535146` | 弱化文字 |
| `--text-400` | 49 7% 37% | `#656358` | placeholder / 禁用文字 |
| `--text-500` | 51 7.5% 42.1% | `#737163` | 最弱文字，图标默认色 |
| `--accent-main-000` | 15 52.7% 43.9% | `#AB5235` | 主色按下态 |
| `--accent-main-100` | 16 53.8% 47.5% | `#BA5B38` | **主色默认（发送按钮/链接/焦点环）** |
| `--accent-main-200` | 15 55.6% 52.4% | `#C96442` | 主色 hover（更亮） |
| `--accent-main-900` | 15 48% 90.2% | `#F2E0DA` | 主色浅底（提示条背景等） |
| `book-cloth`（专名） | 15 52.3% 58% | `#CC785C` | **品牌本体色**，logo/关键强调点，比 accent-main-100 略亮 |
| `kraft`（专名） | 25 49.7% 66.5% | `#D4A27F` | 装饰性纸感强调色（少用） |
| `manilla`（专名） | 40 54% 82.9% | `#EBDBBC` | 高亮底色（如代码高亮、mark 标记） |
| `--accent-secondary-000/100/200` | 210 …% | `#1C6BBB` / `#207FDE` / `#3F91E3` | 蓝色系强调（少数状态用，非主色） |
| `--accent-pro-000/100/200` | 251 …% | `#433872` / `#5645A1` / `#9D8DE3` | 紫色系（Pro/Max 等身份标识用） |
| `--border-100`（原值偏深，用作 100% 不透明边框） | 48 12.5% 39.2% | `#706B57` | **建议实际用法：`rgba(112,107,87,0.18)`**（原始 token 太深，claude.ai 实际渲染边框都很浅，是加了透明度用的，这点 **[推断]**） |
| `--danger-000/100/200` | 5 …% | `#7C1B13` / `#A72519` / `#C9685F` | 错误/危险态 |
| `--danger-900` | 0 40.3% 89% | `#EED8D8` | 错误浅底 |
| `--oncolor-100` | 0 0% 100% | `#FFFFFF` | 纯白（用在深色/彩色按钮上的文字） |

补充（**[推断]**，无直接来源，按语义色惯例 + 与暖色板协调给出，供 Ember 自己的 UI 用）：

| Token | HEX | 说明 |
|---|---|---|
| `--success` | `#4A7B00` | 来源 B 交叉印证类似绿色系（`#5db872`/`#788c5d`），取中间值 |
| `--success-bg` | `#F2F8EA` | 成功提示浅底 |
| `--warning` | `#B8860B` | 暖色系警告黄（避开纯黄以贴合暖调） |
| `--warning-bg` | `#FAF3E0` | |
| `--selection` | `rgba(204,120,92,0.25)` | 文本选中色，用主色半透明 |
| `--diff-add-bg` | `#E3EFD9` | diff 新增行背景（绿系但降饱和贴合暖板） |
| `--diff-add-text` | `#3A6B2A` | |
| `--diff-remove-bg` | `#F5DEDA` | diff 删除行背景（红系降饱和） |
| `--diff-remove-text` | `#8A3B2E` | |

### 1.3 Dark 主题

| Token | HSL | HEX |
|---|---|---|
| `--bg-000` | 60 3% 10% | `#1A1A19` |
| `--bg-100` | 60 3% 13% | `#222220` |
| `--bg-200` | 60 3% 17% | `#2D2D2A` |
| `--bg-300` | 60 2% 22% | `#393937` |
| `--bg-400` | 60 2% 28% | `#494946` |
| `--bg-500` | 60 2% 38% | `#63635F` |
| `--text-000` | 48 33% 97% | `#FAF9F5` |
| `--text-100` | 50 9% 93% | `#EFEEEC` |
| `--text-200` | 50 7% 82% | `#D4D3CE` |
| `--text-300` | 50 5% 70% | `#B6B5AF` |
| `--text-400` | 50 4% 58% | `#989790` |
| `--text-500` | 50 4% 48% | `#7F7E76` |
| `--border-100..400` | 48 6% 30/35/40/50% | `#514F48` / `#5F5C54` / `#6C6A60` / `#878478` |

暗色下的 accent 建议直接复用 light 的 `accent-main-100/200`（`#BA5B38`/`#C96442`），暗底上橙色本来对比就够，claude.ai 暗色模式下品牌色基本不换色阶，只是背景反过来（**[推断]**，未在来源里单独抓到 dark 的 accent 变量）。

---

## 2. 字体

### 2.1 Claude 官方实际用的字体（**[已验证]**）

- **StyreneB**（Commercial Type，设计师 Panos Haratzopoulos / Ilya Ruderman / Berton Hasebe）：UI 无衬线，用于导航、按钮、标签、正文控件。特征是 f/j/r/t 等窄字母被拉方，比一般人文主义无衬线更"方"。来源：`https://type.today/en/journal/anthropic`，`https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with`。
- **Tiempos (Text/Headline)**（Klim Type Foundry，设计师 Kris Sowersby）：网站正文衬线，也是 assistant 回复正文最贴近的字体家族。来源同上，另交叉印证于 `typewolf.com/tiempos-text`。
- **Copernicus / Galaxie Copernicus**（Chester Jenkins / Kris Sowersby，2009）：更偏展示级衬线（标题级），是 Tiempos 的"前身/亲戚"关系，风格上比 Tiempos 更古典、字重对比更大。来源：`typewolf.com/galaxie-copernicus`，`type.today`。
- 代码：等宽字体，第三方复刻资料一致指向 **JetBrains Mono**（来源 B）。

这三款（StyreneB / Tiempos / Copernicus）都是**商业授权字体，无法开源打包进 App**（来源 B 也直接写"Copernicus and StyreneB are licensed Anthropic typefaces and not available as public web fonts"）。所以 Ember 必须选开源替代品离线内置。

### 2.2 Ember 实际选用（开源替代，OFL/Apache 协议，可离线打包）

| 用途 | 选用字体 | 为什么像 | 验证 |
|---|---|---|---|
| Assistant 正文（衬线） | **Source Serif 4**（Adobe，OFL） | Transitional 衬线，比例克制、x-height 适中，是目前开源里视觉气质最接近 Tiempos 的选择（现代过渡衬线，非老式衬线）；比 Newsreader/Lora 更"正文向"、不发花 | 字体家族已知（Adobe 官方开源），下载链接已用 curl 验证 200 |
| Assistant 正文备选（更暖、更书卷气） | **Literata**（Google，OFL，Google Play Books 用的字体） | 比 Source Serif 4 更暖、衬线更明显，如果想更贴近 Copernicus 那种展示级古典感可换这个当标题/首屏用 | 未单独 curl 验证该字重，但 fontsource 命名规律一致，同源 CDN 可用性极高 |
| UI 无衬线（控件/按钮/侧边栏/标签） | **Inter** | Claude 官方复刻资料（来源 B、来源 D）本身就把 Inter 列为 StyreneB 的替代字体；字重覆盖全、中文可读性配合系统字体也顺 | 200 已验证 |
| UI 无衬线备选（更有个性，接近 StyreneB 的"方"感） | **Figtree** 或 **Instrument Sans** | 二者都比 Inter 略"方"一点，边角处理更接近 StyreneB 的几何感；作为可切换的第二套 UI 字体 | 200 已验证（figtree、instrument-sans 均可拉取） |
| 代码/等宽 | **JetBrains Mono** | 与第三方复刻资料（来源 B）直接给出的选择一致 | 200 已验证 |
| 代码备选 | **Fira Code**（若要连字 ligature 效果） | 常见平替 | 200 已验证 |

**下载方式（已用 `curl -sI` 验证返回 `HTTP/2 200`，`content-type: font/woff2`）：**

用 jsDelivr 上的 Fontsource 静态包 CDN 直链（无需 npm，直接 curl 到本地打包进 App resources）：

```bash
# 衬线正文 Source Serif 4，Regular/Medium/SemiBold/Bold 四个字重示例（400/500/600/700）
curl -o SourceSerif4-400.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@latest/latin-400-normal.woff2"
curl -o SourceSerif4-600.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@latest/latin-600-normal.woff2"
curl -o SourceSerif4-400-italic.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@latest/latin-400-italic.woff2"

# UI 无衬线 Inter
curl -o Inter-400.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff2"
curl -o Inter-500.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-500-normal.woff2"
curl -o Inter-600.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-600-normal.woff2"

# 等宽 JetBrains Mono
curl -o JetBrainsMono-400.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.woff2"
curl -o JetBrainsMono-500.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-500-normal.woff2"
```

也可以走 npm（等价，更适合 electron-vite 构建时直接 `import`，构建产物里会自动带上字体文件）：
```bash
npm i @fontsource/source-serif-4 @fontsource/inter @fontsource/jetbrains-mono
```
（**注意**：本次只验证了各家族的 `latest` 静态字重 woff2 直链返回 200；`@fontsource-variable/*` 可变字体 CDN 路径我猜测的 URL 拼法实测是 404，说明可变字体包的具体路径规则和静态包不同，**如果要用可变字体版本，请改用 npm 包本地 import，不要照抄本文档里猜的可变字体直链**，这条标 **UNVERIFIED / 已证明该猜测路径错误**。)

### 2.3 中文回退

用户是中文用户，Source Serif 4 / Literata / Inter 都不含中文字形，需要 `font-family` 里在英文衬线/无衬线后面接中文回退栈：

```css
--font-serif: "Source Serif 4", "Songti SC", "STSong", serif;
--font-sans: "Inter", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
--font-mono: "JetBrains Mono", "PingFang SC", monospace;
```

说明（**[推断，符合中文排版惯例]**）：中文衬线用「宋体 Songti SC」承接英文衬线的"衬线感"（macOS 系统自带，不需要打包，Ember 是 macOS App 所以可以放心用系统字体做中文兜底）；中文无衬线用「苹方 PingFang SC」承接 Inter，这是 macOS 上最标准的中文界面字体搭配，视觉权重和 Inter 接近。中文没有"等宽衬线体"的概念，代码块里中文注释直接用 PingFang SC 兜底即可，不需要找中文等宽字体。

### 2.4 字号 / 行高 / 字重（**[已验证，来源 B 的 DESIGN.md 数值 + 来源 D fudge 的数值交叉]**）

两份第三方复刻资料给出的数字略有差异（正常，因为都是逆向推测），取交集/取中间值，Ember 按下表实现：

| 场景 | 字号 | 行高 | 字重 |
|---|---|---|---|
| Assistant 正文（衬线） | 16px | 1.6 | 400（强调用 600，不用斜体做强调） |
| Assistant 正文小号（脚注/引用） | 14px | 1.55 | 400 |
| 用户消息 | 15px | 1.5 | 400（无衬线，UI 字体，见 §3） |
| UI 正文/侧边栏项 | 14px | 1.43 | 400 |
| UI 标签/按钮文字 | 14px | 1.0（按钮内垂直居中，不靠 line-height 撑高度） | 500 |
| 页面/面板小标题 | 16–18px | 1.3–1.4 | 500 |
| 大标题（欢迎页/空状态） | 28–36px | 1.15–1.2 | 400（衬线，不加粗，靠字号撑气场，这是 Claude 视觉的一个特征：标题不用粗黑体压分量，用衬线的字号和留白压分量） |
| 代码块 | 13–14px | 1.6 | 400 |
| Caption / 时间戳 / 计数 | 12–13px | 1.4 | 500，可选全大写 + letter-spacing 1–1.5px |

---

## 3. 布局与组件规格

> 精确像素值这块，公开资料没有任何一份给出 claude.ai 生产环境的逆向像素表（这类信息通常不会被完整逆向出来），下面数值是综合第三方复刻资料（来源 B/D）+ 常见同类产品（ChatGPT/其它 AI 聊天客户端）的标准做法给出的**合理工程值**，标 **[推断]**，Ember 实现时可以按这个来，视觉误差用户基本感知不到，因为"感觉对不对"主要靠色板和字体，不靠某个值差 2px。

### 3.1 侧边栏
- 展开宽度：**260px**（[推断]；常见范围 240–280px，Claude 类工具型 App 惯用 260）
- 收起宽度：**0px**（完全隐藏，用顶部一个图标按钮唤出，不做"仅图标窄条"样式——这更贴合 claude.ai 的做法：侧栏是显/隐二态，不是三态）
- 背景：`--bg-200`（`#F0EEE5`），比主画布 `--bg-100` 深一档，制造"主内容区域最亮"的视觉重心
- 会话列表项：高度 36px，圆角 8px，hover 用 `--bg-300`，选中态用 `--bg-400` + 左侧 3px 竖条用 `accent-main-100`

### 3.2 消息列
- 内容最大宽度：**720px**（衬线正文长行会很难读，claude.ai 的正文列明显比 ChatGPT 窄，这是其"像在读书不像在看聊天软件"的关键之一）
- 消息间垂直间距：24–32px（大于 ChatGPT 的紧凑间距，制造呼吸感）
- **用户消息**：右对齐或与 assistant 同列左对齐皆可（claude.ai 实际是同列左对齐、靠底色块区分，不是气泡贴右墙），样式：
  - 背景：`--bg-000`（`#F8F8F7`，比页面背景稍白，制造"卡片浮起"感，但**不加阴影**）
  - 圆角：16px
  - 内边距：12px 16px
  - 字体：无衬线（UI 字体），与 assistant 的衬线正文形成鲜明的"用户说话 vs Claude 回复"字体反差 —— 这是识别度很高的一个设计决定，Ember 必须做
- **Assistant 消息**：
  - **无气泡**，不加背景色、不加边框，直接是页面背景上的一段衬线正文（这是 Claude 相对 ChatGPT 最大的视觉差异点，一定要做对）
  - 段前不需要头像图标（claude.ai 后期版本弱化/取消了 assistant 头像，靠字体切换就足以区分说话人）
  - 代码块、引用块、列表照常用正常 Markdown 排版规则，但代码块背景用 `--bg-200`、圆角 8px、内边距 16px、顶部可放一条语言名 + 复制按钮的工具条

### 3.3 Composer（输入框）
- 圆角：**16–24px**（大圆角，"rounded-2xl"级别）—— **[推断，原文引用已核实为误引，见下]**：复核来源 D 原文后发现它**没有**出现过 "rounded-2xl" 这个词，也没有单独给 composer 标注具体圆角数值，只写了"The composer is restrained: soft border, muted placeholder, and a small send control."。这个 16–24px 数值是 Ember 自己按大圆角美学 + 来源 D 里"大面板用 2rem（32px）"这条（那条是真实存在的引用，见下一条边框）的比例关系倒推出来的合理工程值，**不是来源 D 直接给的 composer 数字**，标注方式已改为 [推断]。
- 边框：1px solid，light 下用 `rgba(112,107,87,0.18)`（即 border-100 半透明化，[推断]），dark 下用 **`#30302E`**（来源 D 原文核实为 `"#DEDCD1"` 用于浅色面板、`"#30302E"` 用于深色面板，[已验证 via 来源D]；**注意：本文档初稿在这里误写成了 `#3d3a35`，是核实时发现的错误，已在下方 CSS 里同步改正**）
- **不加阴影**（[已验证 via 来源D，但引号需改写]：来源 D 原文是 "shadows are light or absent"，不是本文档初稿里逐字加引号的 "no shadow —— matching claude.ai's stripped-down look"——那句英文是初稿自己编的转述，被误标成了直接引用，已改正为准确转述，结论不变：阴影很浅或没有）
- 背景：比页面背景更白一档，`--bg-000`
- 最小高度 52px，可自适应多行到最大约 240px 后内部滚动
- 内部布局：左侧模型选择器（文字+chevron，无边框按钮）、中间自适应文本域、右侧发送按钮
- 发送按钮：圆形或圆角矩形，尺寸 32–36px，默认态背景 `accent-main-100`（`#BA5B38`），图标白色，禁用态（无输入内容）背景降到 `--bg-400` 灰底、图标降到 `--text-400`
- placeholder 文字颜色 `--text-400`

### 3.4 通用组件
- 按钮高度：主/次按钮 40px，小按钮/图标按钮 32–36px
- 按钮圆角：8px（小按钮）/ 12px（较大 CTA）
- 大面板/弹层圆角：**32px**（来源 D 明确"Large shells and major panels use a 2rem radius"）
- 输入框（非 composer，如设置项）：高度 40px，内边距 10px 14px，圆角 8px
- 图标风格：**细线描边（1.5px stroke）几何图标**，风格类似 Lucide / Phosphor 的 thin 变体（**[推断]**：claude.ai 实际图标未开源，但视觉上是细线风格几乎是行业共识描述，可直接用开源图标库 `lucide-react`，线宽设为 1.5，颜色用 `--text-500` 默认、hover 用 `--text-200`）
- 滚动条：细滚动条（8px 宽），轨道透明，滑块用 `--bg-500` 半透明，hover 加深，不用系统默认粗滚动条（macOS 上可以直接用 `overlay` 样式滚动条 + 自定义 `::-webkit-scrollbar`）
- 焦点态：**不用系统默认蓝色 outline**，统一用 `box-shadow: 0 0 0 2px var(--accent-main-900)`（浅橙色光环）或 `2px solid accent-main-200` 描边，贴合暖色板
- 过渡动画：颜色/背景/透明度过渡统一 150ms ease-out，禁止用弹簧回弹动画（Claude 的动效非常克制、几乎感觉不到"动画"，不要做 Framer Motion 那种夸张 spring）

---

## 4. Claude Code 专属组件（工具调用 / diff / todo / 权限确认 / plan mode）

这一节资料上没有找到系统性的"官方视觉规范文档"，是我基于 Claude Code CLI 终端实际交互结构（这是我自己作为 Claude Code 直接的运行经验，不是网络检索结果，**标注为基于产品实际行为的第一方描述，非网络来源**）+ 上面定的色板字体，给出 Ember 里应该怎么渲染这些结构：

### 4.1 工具调用行（"Read file" / "Ran command" 等）
- 渲染成**一行可折叠的浅色卡片**，不是对话气泡：左侧一个小图标（文件用文档图标、命令用终端图标、搜索用放大镜），中间是动词+对象的单行摘要（如 "Read `src/App.tsx`"、"Ran `npm install`"），右侧一个 chevron 展开箭头
- 折叠态背景：`--bg-200`；展开态内容区背景 `--bg-000`，字体切到 `JetBrains Mono` 13px 展示实际命令/文件内容片段
- 字体用**无衬线**（UI 字体）写摘要行，不用衬线——工具调用是"系统在做事"，不是"Claude 在说话"，字体上要和 assistant 正文的衬线区分开，进一步强化"这是过程日志，不是对话内容"的层级感
- 状态色：运行中用 `--text-400` + 一个细的loading spinner（用 accent-main-100 描边）；成功态图标变绿色勾（用 `--success`）；失败态用 `--danger-100`

### 4.2 Diff 块
- 整体容器：等宽字体 `JetBrains Mono` 13px，圆角 8px，边框 1px `border-100` 半透明
- 新增行：背景 `--diff-add-bg`(`#E3EFD9`) + 左侧 `+` 前缀用 `--diff-add-text`(`#3A6B2A`)
- 删除行：背景 `--diff-remove-bg`(`#F5DEDA`) + 左侧 `-` 前缀用 `--diff-remove-text`(`#8A3B2E`)
- 未改动的上下文行：正常代码块底色 `--bg-200`，文字 `--text-300`（弱化，突出改动行）
- 文件名/路径放在 diff 块顶部工具条，无衬线小字 `--text-400`

### 4.3 Todo 列表（TodoWrite 渲染）
- 每一项是一行：checkbox 图标（未开始=空心圆、进行中=半填充/带脉冲动效、完成=实心勾+文字加删除线降不透明度到 60%）
- 用无衬线 UI 字体 14px，不用衬线（同 4.1 的理由：这是系统状态，不是对话）
- 整个列表放在一张 `--bg-200` 背景、圆角 12px 的卡片里，卡片可折叠

### 4.4 权限确认 Prompt
- 这是**唯一应该用强调色（accent-main）做背板强调**的地方：整块用 `accent-main-900`(`#F2E0DA`) 浅橙色底 + `accent-main-200` 左侧 3px 竖条，提示"这里需要你决定"
- 文案用无衬线 UI 字体，加粗关键动作词（如将要执行的命令用 mono 字体标出）
- 两个按钮：「允许」用主色实心按钮（`accent-main-100` 背景），「拒绝/仅一次」用次级按钮（透明背景+边框）
- 默认展开工具调用详情，不要折叠（对应前面搜到的社区反馈：折叠详情是被抱怨的体验问题，Ember 应该直接把这个反馈修正掉，默认展开）—— **[核实后补充]**：引用的 issue #85172（"auto-expand tool call details in permission approval prompt"）核实后确认诉求描述准确，但该 issue 的实际状态是**已被 Anthropic 关闭、标记 not planned + stale**，并非一个被采纳或还在讨论中的反馈。这不代表 Ember 不该这么做（默认展开权限确认里的工具调用详情，在可用性上依然是合理设计），但不应把"CLI 官方还没做"包装成"这是被验证过的正确方向"；这里是 Ember 自己的产品判断，理由独立于 issue 是否被采纳。

### 4.5 Plan Mode 横幅
- 顶部/输入框上方常驻一条细横条，背景用 `accent-pro-900`(`#E6E3F1`，紫色系，和普通操作的橙色区分开，暗示"这是一个特殊模式，不是普通对话")，文字 "计划模式" + 一个退出/切换按钮
- 计划内容本身（一份 markdown 计划文档）用衬线正文渲染（因为这是"Claude 写给你看的内容"，遵循 §3.2 的 assistant 正文规则）

---

## 5. 可直接粘贴的 CSS

```css
:root {
  /* ---- Light theme (default) ---- */
  --bg-000: #F8F8F7;
  --bg-100: #F5F4EF;   /* app 主背景，暖米黄 */
  --bg-200: #F0EEE5;
  --bg-300: #E8E5D8;
  --bg-400: #DED8C4;
  --bg-500: #C9C0A1;

  --text-000: #0F0F0D;
  --text-100: #29261B;
  --text-200: #3D3929;
  --text-300: #535146;
  --text-400: #656358;
  --text-500: #737163;

  --accent-main-000: #AB5235;
  --accent-main-100: #BA5B38; /* 主色：发送按钮/链接/焦点环 */
  --accent-main-200: #C96442; /* 主色 hover */
  --accent-main-900: #F2E0DA; /* 主色浅底 */
  --book-cloth: #CC785C;      /* 品牌本体色，logo/关键强调 */
  --kraft: #D4A27F;
  --manilla: #EBDBBC;

  --accent-secondary-100: #207FDE;
  --accent-pro-100: #5645A1;
  --accent-pro-900: #E6E3F1;

  --border-color: rgba(112, 107, 87, 0.18);
  --border-strong: rgba(112, 107, 87, 0.32);

  --danger-100: #A72519;
  --danger-900: #EED8D8;
  --success: #4A7B00;
  --success-bg: #F2F8EA;
  --warning: #B8860B;
  --warning-bg: #FAF3E0;

  --diff-add-bg: #E3EFD9;
  --diff-add-text: #3A6B2A;
  --diff-remove-bg: #F5DEDA;
  --diff-remove-text: #8A3B2E;

  --selection: rgba(204, 120, 92, 0.25);
  --oncolor: #FFFFFF;

  --font-serif: "Source Serif 4", "Songti SC", "STSong", serif;
  --font-sans: "Inter", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
  --font-mono: "JetBrains Mono", "PingFang SC", monospace;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-panel: 32px;

  color-scheme: light;
}

[data-theme="dark"] {
  --bg-000: #1A1A19;
  --bg-100: #222220;
  --bg-200: #2D2D2A;
  --bg-300: #393937;
  --bg-400: #494946;
  --bg-500: #63635F;

  --text-000: #FAF9F5;
  --text-100: #EFEEEC;
  --text-200: #D4D3CE;
  --text-300: #B6B5AF;
  --text-400: #989790;
  --text-500: #7F7E76;

  --accent-main-000: #AB5235;
  --accent-main-100: #C96442;  /* 深色底上用更亮一档保证对比 */
  --accent-main-200: #D97757;
  --accent-main-900: #3D2A22;

  --border-color: #30302E; /* 来源 D 核实原值；初稿曾误写 #3d3a35，已改正 */
  --border-strong: #514F48;

  --danger-100: #C9685F;
  --danger-900: #3A2220;
  --success: #7BC24A;
  --success-bg: #24301C;
  --warning: #E0B84A;
  --warning-bg: #332C1A;

  --diff-add-bg: #1F3320;
  --diff-add-text: #8FCB7A;
  --diff-remove-bg: #3A2220;
  --diff-remove-text: #E09488;

  --selection: rgba(201, 100, 66, 0.35);
  --oncolor: #FFFFFF;

  color-scheme: dark;
}

body {
  background: var(--bg-100);
  color: var(--text-000);
  font-family: var(--font-sans);
}

/* Assistant 正文：衬线，无气泡 */
.message-assistant {
  font-family: var(--font-serif);
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-100);
  max-width: 720px;
}

/* 用户消息：无衬线，卡片 */
.message-user {
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  background: var(--bg-000);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  max-width: 720px;
}

.composer {
  background: var(--bg-000);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  box-shadow: none;
  min-height: 52px;
}

.composer:focus-within {
  box-shadow: 0 0 0 2px var(--accent-main-900);
  border-color: var(--accent-main-200);
}

.send-button {
  background: var(--accent-main-100);
  color: var(--oncolor);
  border-radius: 999px;
  transition: background-color 150ms ease-out;
}
.send-button:hover { background: var(--accent-main-200); }
.send-button:disabled { background: var(--bg-400); color: var(--text-400); }

.tool-call-row {
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--bg-200);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.diff-add { background: var(--diff-add-bg); color: var(--diff-add-text); font-family: var(--font-mono); }
.diff-remove { background: var(--diff-remove-bg); color: var(--diff-remove-text); font-family: var(--font-mono); }

.permission-prompt {
  background: var(--accent-main-900);
  border-left: 3px solid var(--accent-main-200);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
}

.plan-mode-banner {
  background: var(--accent-pro-900);
  color: var(--text-100);
  font-family: var(--font-sans);
  font-size: 13px;
}

::selection { background: var(--selection); }
```

### 5.1 @font-face 计划

```css
@font-face {
  font-family: "Source Serif 4";
  src: url("./fonts/SourceSerif4-400.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Source Serif 4";
  src: url("./fonts/SourceSerif4-400-italic.woff2") format("woff2");
  font-weight: 400; font-style: italic; font-display: swap;
}
@font-face {
  font-family: "Source Serif 4";
  src: url("./fonts/SourceSerif4-600.woff2") format("woff2");
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("./fonts/Inter-400.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("./fonts/Inter-500.woff2") format("woff2");
  font-weight: 500; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("./fonts/Inter-600.woff2") format("woff2");
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("./fonts/JetBrainsMono-400.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("./fonts/JetBrainsMono-500.woff2") format("woff2");
  font-weight: 500; font-style: normal; font-display: swap;
}
/* 中文回退用 macOS 系统字体，不需要 @font-face，直接在 font-family 栈里写 "Songti SC" / "PingFang SC" 即可 */
```

字体文件本地打包路径建议：`ember/resources/fonts/`，用上面 §2.2 的 curl 命令一次性下载好放进去，electron-builder 打包时随 `extraResources` 或直接作为渲染进程静态资源一起 bundle，保证离线可用（不依赖 Google Fonts CDN 在线加载，这点对"不需要额外登录、离线可用"的产品定位很重要）。

---

## 6. 关键来源清单

- 来源 A（claude.ai 生产环境实际 CSS 变量，含 `--bg-*` `--text-*` `--accent-*` `--border-*` `--danger-*` 及 `kraft/book-cloth/manilla` 专名）：https://gist.github.com/0wwafa/6569915d936370656c687e014e596f4a
- 来源 B（第三方逆向复刻的完整 Design System，含色值/字号/间距/圆角/组件尺寸）：https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md
- 来源 C（Anthropic 官方 brand-guidelines skill，当前品牌色 `#D97757` 系，**注意这是刷新后的品牌色，不是本规格采用的历史 App 配色**）：https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md
- 来源 D（第三方 UI 拆解博客，给出 composer/圆角/边框的具体像素与色值）：https://design.withfudge.com/share/claude.ai-design
- 来源 E（Styrene / Tiempos / Copernicus 字体背景与授权情况）：https://type.today/en/journal/anthropic ；https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with ；https://www.typewolf.com/tiempos-text ；https://www.typewolf.com/galaxie-copernicus
- 来源 F（tweakcn "claude" 主题，warm parchment + terracotta 的第三方社区复刻，作为色调气质的旁证）：https://tweakcn.com/ ，https://www.shadcnblocks.com/theme/claude
- 字体文件可用性验证：`curl -sI` 对 `cdn.jsdelivr.net/fontsource/fonts/{source-serif-4,inter,jetbrains-mono,newsreader,lora,crimson-pro,literata,figtree,instrument-sans,geist,fira-code}@latest/latin-400-normal.woff2` 均返回 `HTTP/2 200`；`cdn.jsdelivr.net/fontsource-variable/...` 路径猜测返回 404（已在文档中标注为验证失败，不要用该猜测路径）。
- Claude Code 工具调用折叠详情默认收起被社区抱怨（作为 §4.4"默认展开"设计决策的依据；**该 issue 已被关闭为 not planned + stale，见 §6 Reviewer notes**）：https://github.com/anthropics/claude-code/issues/85172

---

## Reviewer notes（复核记录）

复核方式：对文档里"[已验证]"标注的、且会直接决定 CSS 数值的关键引用，逐条用 WebFetch 重新抓取原始来源核对，不是只看文档转述；数值类的 HSL→HEX 换算用 Python `colorsys` 独立重算校验。

### 已核实为**错误**并已在正文改正的

1. **深色边框色值错误**：正文/CSS 原来写 `--border-color`（dark）= `#3d3a35`，标注"来源 D 给出的具体色，[已验证]"。重新抓取 `design.withfudge.com/share/claude.ai-design` 原文后，实际句子是 *"Borders sit in a warm gray range: `#DEDCD1` for lighter surfaces and `#30302E` when the panel is dark."* —— 深色值应为 **`#30302E`**，不是 `#3d3a35`；浅色值来源 D 给的是实色 `#DEDCD1`，不是文档里用 `rgba(112,107,87,0.18)` 的透明化做法（两种做法都合理，但不能说浅色那条也是"来源 D 验证过"的，那条其实是从来源 A 的 `border-100` 自己推的透明度，标注已改成 [推断]）。**已在 §3.3 正文和 §5 CSS 代码块里同步改正为 `#30302E`。**
2. **composer 圆角的引用是编造的**：正文写"来源 D 明确提到 composer 是 `rounded-2xl`"。重新用全文检索确认 `design.withfudge.com` 那篇文章里**根本没有出现过 "rounded-2xl" 这个词**，composer 相关的原句只是 *"The composer is restrained: soft border, muted placeholder, and a small send control."*，没给具体圆角数字。16–24px 这个数值本身作为工程建议不算错（和"大面板 2rem"那条真实引用的比例关系吻合），但把它包装成"来源 D 明确提到"是假引用，**已改标为 [推断] 并说明真实原文**。
3. **"no shadow" 那句英文引号是编的**：来源 D 原文说的是 *"shadows are light or absent"*，不是文档里逐字加引号的 "no shadow —— matching claude.ai's stripped-down look"。结论（基本不加阴影）是对的，但那句带引号的英文是转述被误标成直接引用，**已改正引号内容**。

### 独立复核后确认**准确**、可信度可以调高的

4. 色板核心数值（重点复核）：把文档 §1.2 表格里 `accent-secondary-000/100/200`、`accent-pro-000/100/200`、`danger-000/100/200`、`border-100`、`accent-main-000/100/200`、`book-cloth` 这些从来源 A（gist）HSL 值独立用 Python `colorsys.hls_to_rgb` 重新换算了一遍，结果和文档表格里的十六进制**逐一完全一致**（例如 `accent-pro-100` HSL `251 40% 45.1%` → `#5645A1`，`book-cloth` HSL `15 52.3% 58%` → `#CC785C`）。说明这部分不是"看起来像官方"的臆测，换算是严谨的，可信度上调为**[已验证，独立复核通过]**。
5. 来源 B（VoltAgent `DESIGN.md`）里 "Primary: #cc785c" 以及"Copernicus and StyreneB are licensed Anthropic typefaces and not available as public web fonts" 这两句直接引用，逐字核对原文后**确认存在且逐字准确**。
6. Anthropic 官方 `brand-guidelines` skill 里当前品牌橙确认为 `#D97757`（另外还核实到官方还给了 dark `#141413`、light `#faf9f5`、mid gray `#b0aea5`、light gray `#e8e6dc`，文档 §1.1 没提这几个，供 Ember 以后需要"官方最新版"配色时备用，不属于本次错误，是补充信息）。
7. 字体 CDN 直链复核：`cdn.jsdelivr.net/fontsource/fonts/{source-serif-4,inter,jetbrains-mono}@latest/latin-400-normal.woff2` 独立用 `curl -sI` 重新验证，均返回 `HTTP/2 200`、`content-type: font/woff2`；`fontsource-variable` 路径确认返回 `404`。文档里这条的标注（已验证 200 / 猜测路径已证明 404）是准确的，不需要改。

### 核实后发现的**遗漏/需要补的信息**（不算错，但原文没写）

8. 来源 B 自己给的衬线替代字体建议其实是 **Cormorant Garamond（weight 500, -0.02em letter-spacing）/ EB Garamond**，不是文档 §2.2 选的 Source Serif 4；无衬线替代建议是 Inter/Söhne，这条和文档一致。文档没有说"来源 B 推荐 Source Serif 4"，所以不算误引，但读者可能会以为 Source Serif 4 也是来源 B 认可的，这里补充说明：**Source Serif 4 是 Ember 自己的选择，来源 B 真实给出的替代建议是 Cormorant Garamond/EB Garamond**，如果想更贴近来源 B 那份复刻资料本身的建议，衬线备选应该考虑加上 Cormorant Garamond，而不是只列 Literata。
9. 与 SDK 的交叉检查：翻查了 `docs/sdk/sdk.d.ts` 里所有 `theme`/`color`/`output_style` 相关类型，CLI 本身有一个终端配色的 `theme?: 'auto' | 'dark' | 'light' | 'light-daltonized' | ...` 设置（`sdk.d.ts` 约 9087 行），以及 `SDKControlSetColorRequest`（agent 强调色，"default" 可重置）。这些是**终端配色**，跟本文档要做的"App 整体视觉皮肤"不是一个层，两者不冲突，文档也没有声称要读取或同步这个字段，所以**没有发现真正的矛盾**。但文档完全没提这一点，建议补一句产品决策：Ember 的亮/暗主题切换是做成 App 自己独立的开关，还是读取/跟随用户 CLI `settings.json` 里的 `theme` 字段（含 daltonized 色盲模式）—— 目前文档默认是"App 自己独立一套"，这是合理默认，但应该在文档里显性写出来，不要让人以为"没提到"是漏检查。
10. `initializationResult()` 会带回 `account.subscriptionType`（Free/Pro/Max 等），文档 §1.2 已经给了 `accent-pro-*` 紫色系并说明"Pro/Max 等身份标识用"，但 §3（布局）没有设计一个具体位置去用这个身份信息（比如侧边栏账号区的徽章）。这是一个**任务要求覆盖不全**的小缺口，不是错误，标注出来供后续设计补一个"账号/订阅徽章"组件位。

### 仍然不确定、建议标为 UNVERIFIED 对待的

11. §1.1 说来源 A（那个 gist）"用于导出/打印 Claude 对话的用户脚本"——这是文档作者对 gist 用途的转述，我没有找到独立证据证明这个 gist 的具体用途描述准确（gist 本身只是一段 CSS 变量列表），这条**保持 UNVERIFIED**，不影响色值本身的可信度（色值已经用换算独立核实过，见上第 4 条），但"这是什么脚本"这个背景故事没有二次来源印证，读者不要把这句话当成实锤。
12. StyreneB/Tiempos/Copernicus 具体风格描述（"比 Tiempos 更古典、字重对比更大"）没有找到强力的一次来源逐字支持，是文档作者综合印象的转述，建议继续按 **[推断]** 对待，不要升级成 [已验证]。
