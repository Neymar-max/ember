# Ember 打包指南：无 Apple Developer ID 的 macOS .app / .dmg 分发（2026）

> 目标机器：Apple Silicon（arm64）、macOS 27、Node 22、只有 Xcode Command Line Tools（无完整 Xcode）。
> 目标栈：Electron 44 + electron-vite 5 + React + TypeScript + electron-builder 26.x，无 Apple Developer ID，不做 notarize。
> 调研方式：本机探针（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` 源码 grep）+ WebSearch/WebFetch（electron-builder 官方文档、GitHub issue/PR、Apple 开发者论坛）。凡未能用一手来源核实的地方，已标注 **UNVERIFIED**。

---

## 0. 结论先说（给没空看全文的人）

- 不签名（`identity: null`）在 Apple Silicon 上**跑不起来**：从 macOS 11 起，arm64 上所有可执行代码都必须至少有一个签名（ad-hoc 也算），CPU/内核在 exec 时校验，不是 Gatekeeper 的事、绕不过去。所以必须用 `identity: '-'`（ad-hoc），不能用 `identity: null`。
- ad-hoc 签名 + `hardenedRuntime: true` 是电闪雷鸣的组合坑：默认 entitlements 可能不够，会导致启动就崩、或摄像头/麦克风这类系统权限拿不到。稳妥做法：**ad-hoc 签名但关掉 hardenedRuntime**（`hardenedRuntime: false`），Ember 不需要 hardened runtime 的任何特性（不需要 Mac App Store、不需要摆脱 JIT 限制之外的东西）。
- `pathToClaudeCodeExecutable` 一旦传了，SDK 就**完全不会**去解析 `@anthropic-ai/claude-agent-sdk-darwin-arm64` 等平台原生二进制包 —— 这几个包每个解压后约 **215MB**（`npm view @anthropic-ai/claude-agent-sdk-darwin-arm64 dist.unpackedSize` = 225,036,616 字节，实测于本机 probe），8 个平台全算的话接近 2GB，必须在打包时排除，否则 dmg 会被撑爆。
- 收件人打开未签名 app：Sequoia（15）起右键"打开"这条捷径已经被拿掉了，必须走"系统设置 → 隐私与安全性 → 仍要打开"，或者 `xattr -dr com.apple.quarantine`。这段中文说明要么放 README，要么放进 DMG 里一个 txt。

---

## 1. electron-builder 配置（`electron-builder.yml`）

### 1.1 mac target：分架构 dmg vs universal

`mac.target` 默认是 `['dmg', 'zip']`（electron-builder 文档写明"Squirrel.Mac 自动更新机制同时需要 dmg 和 zip"，即便你只想要 dmg 也可能被要求带 zip；Ember 不做自动更新可以只留 `dmg`）。

三种做法对比：

| 方案 | 命令/配置 | 产物大小 | 适用场景 |
|---|---|---|---|
| **分架构（推荐）** | `--mac --arm64` 和 `--mac --x64` 分两次跑，产出 `Ember-1.0.0-arm64.dmg` / `Ember-1.0.0-x64.dmg` | 每个 dmg 只含一份 Electron 二进制（~150-200MB 量级） | 用户绝大多数是 Apple Silicon（2020 年后的 Mac），只发 arm64 dmg 即可，x64 给老 Intel Mac 备用 |
| **universal** | `mac.target` 里用 `{ target: 'dmg', arch: ['universal'] }`，或 CLI `--mac --universal` | 两份 Electron Framework + 两份原生模块合并进一个 app，体积约等于两个单架构包相加（electron-builder 文档：`mergeASARs` 默认 `true` 会合并 x64/arm64 的 asar，但 Electron.framework 本身双架构叠加，dmg 通常比单架构大 60-90%） | 只想发一个文件、不想让用户选架构 |
| **只发 arm64** | 同上，只构建 arm64 | 最小 | 明确告知"仅支持 Apple Silicon"，2026 年新装机基本都是 arm64，风险很低 |

**更正（原稿写错了字段路径）**：`mergeASARs`、`singleArchFiles`、`x64ArchFiles` **不是**嵌套在一个叫 `mac.universal` 的子对象里——本机 `app-builder-lib@26.15.3` 的 `scheme.json` 逐字核对过，`MacConfiguration.properties` 下这三个字段和 `identity`/`hardenedRuntime` 一样是**直接扁平挂在 `mac:` 下面**的独立字段（`mac.mergeASARs`、`mac.singleArchFiles`、`mac.x64ArchFiles`），只是 schema 描述里都写了"仅在构建 universal 架构时生效"（"This option has no effect unless building for 'universal' arch"）。字段语义本身核对无误：`mergeASARs` 默认 `true`（合并两个架构的 asar 包）、`singleArchFiles` 是 glob（允许只出现在其中一个 asar 里、不必两边都有的文件）、`x64ArchFiles` 是 glob（允许两个 asar 里都放 x64 二进制的文件，常用于 x64 专属原生模块）。"在正确的硬件上分别构建，而不是跨架构编译"这条建议未在本次核实的 schema 字段描述中找到一手来源，属于经验性建议，**标记为 UNVERIFIED**（不影响 Ember 的结论：反正只发 arm64，不做 universal）。

**Ember 建议**：先只发 arm64 dmg（用户的机器和绝大多数收件人都是 Apple Silicon），需要给 Intel 用户时再单独出一个 x64 dmg，不做 universal（省一半体积，省一半的坑）。

### 1.2 identity: `'-'`（ad-hoc）vs `identity: null`（完全不签）—— Apple Silicon 上会崩什么

> 本节字段语义已用一手来源核对：`curl https://unpkg.com/app-builder-lib@26.16.1/scheme.json`（electron-builder 26.16.1 的 JSON Schema；本机装好 `electron-builder` 之后这份文件也会在 `node_modules/app-builder-lib/scheme.json`，可以直接读本机那份，效果一样）。`mac.identity`、`mac.hardenedRuntime`、`mac.entitlements`、`mac.notarize`、`mac.gatekeeperAssess` 全部是**扁平**字段，直接挂在 `mac:` 下面，**不是**嵌套在 `mac.sign.identity` 这种子对象里（个别二手教程/旧版文档会写成嵌套形式，那是过时或不准确的写法，以 schema 为准）。

关键区分（来源：electron-builder 26.16.1 schema.json `identity`/`hardenedRuntime` 字段描述原文 + Eclectic Light Company 关于 Apple Silicon 代码签名要求的文章）：

- **不设置 `identity`（默认）**：electron-builder 去 Keychain 里找一张有效的签名证书；**找不到就直接跳过签名，不会自动降级成 ad-hoc**（schema 原话："If none is found, signing is skipped for all architectures — there is no automatic ad-hoc fallback"）。Ember 的机器上没有 Apple Developer 证书，走默认配置的结果就是"完全不签名"。
- **`identity: null`**：显式跳过签名，效果和"默认但找不到证书"一样。
- **`identity: '-'`**：显式选择 ad-hoc 签名。

**为什么不签名/找不到证书会导致"App 已损坏"**：macOS 11+ 起，arm64 上**所有**可执行代码在 `exec` 时都必须带一个有效签名，哪怕是 ad-hoc 的也行；完全没有签名的 Mach-O 会被内核直接判定非法（这是 CPU/内核层面的强制校验，不是 Gatekeeper 那层可以绕过的东西）。真正容易搞混的是：**Electron 官方发布的预编译 `Electron.app` 本身已经带了一个 ad-hoc 签名**（不是完全没签），但 electron-builder 打包时要往 app 里写入你自己的 `Info.plist`（productName、bundle id 等）、替换图标、塞进你的业务代码——这些都是在签名**之后**对 bundle 内容做的修改，而 `Info.plist`/资源文件本身是被签名覆盖的一部分，内容一变签名就失效。如果这时候 electron-builder 没有在所有改动做完之后重新签一遍（`identity: null` 场景下它确实不会重签），最终产物携带的是一个"内容和签名对不上"的 Mach-O——macOS 对此类"签名本身存在但校验失败"的情况，用的措辞就是**"已损坏，无法打开"**，比"来自身份不明的开发者"这种更友好的提示更狠，这是 Apple 有意的设计（不想让做坏事的人一看提示就知道"只是没验证，换个姿势就能装"）。
1. dmg/app 下载后还会被贴上 `com.apple.quarantine` 扩展属性，Gatekeeper 对 ad-hoc（无 Apple 背书）+ 未 notarize 的签名校验必然判定"不可信"，进一步坐实"damaged"提示（即使签名内容和 bundle 是匹配的，ad-hoc 签名从 Gatekeeper 的角度看依然是"没有可信来源"，这属于第 6 节里 `spctl` 报 `rejected` 的正常现象，跟"损坏"是两件不同的事，不要混为一谈）。
2. **entitlements 与 hardenedRuntime 不匹配**（schema `identity` 字段原文）：`identity: "-"` + `hardenedRuntime: true`（`hardenedRuntime` 默认值就是 `true`）这个组合下，hardened runtime 强制做 library validation，会拒绝 Electron 预编译 framework 里那些带着**别的 Team ID** 签名的二进制——解决方法二选一：`hardenedRuntime: false`，或者给 entitlements 加 `com.apple.security.cs.disable-library-validation`。

**结论与配置**（`electron-builder.yml`，直接可用，`identity`/`hardenedRuntime` 等字段全部扁平挂在 `mac:` 下）：

```yaml
mac:
  target:
    - target: dmg
      arch:
        - arm64
        # - x64          # 需要再发一版时加回来，不建议和 arm64 一起做进同一个 target 数组（会被当成两次独立构建，产物名字要用 artifactName 区分）
  identity: "-"            # 显式 ad-hoc 签名，满足 arm64 的强制签名要求
  hardenedRuntime: false   # 关键：配 ad-hoc 时选这个，就不用纠结 disable-library-validation 加没加对
  gatekeeperAssess: false  # 本机核对 scheme.json：这个字段默认值本来就是 false，不是"从 true 关掉"；这里显式写出来只是让配置自解释、防止未来 electron-builder 改默认值时被悄悄带偏。作用仍是关闭 @electron/osx-sign 在构建期做的本机签名自检（本机没有 Developer ID 证书，自检本来就没法通过）
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: false
  icon: build/icon.icns
  category: public.app-category.developer-tools
afterSign: build/afterSign.js   # 见 1.3 方案 B，处理 ad-hoc 签名的已知回归 bug
```

### 1.3 为什么 `identity: "-"` 之外还要加一个 `afterSign` 钩子兜底

`identity: "-"` 已经能让 electron-builder 自己做 ad-hoc 签名，正常情况下不需要额外操作。之所以还建议加一道 `afterSign` 钩子，是为了兜住一个**已知的 electron-builder 回归 bug**（GitHub issue #9529）：从 v26.0.13 起，ad-hoc 签名的产物里，摄像头/麦克风的 `getUserMedia()` 能拿到 track 但读不到帧/采样（TCC 权限弹窗都不出现）。issue 里验证过两条 workaround，一条是把 `identity` 干脆设成 `null`（完全不签，代价是回到 1.2 的"损坏"问题，不可取），另一条是**保留 `identity: "-"`，构建完之后再用 `afterSign` 钩子对整个 app 做一次 `--deep` 强制重签**，把 electron-builder 自己签名顺序里可能留下的不一致状态盖掉：

```js
// build/afterSign.js  (CommonJS, electron-builder 用 require 加载)
const { execFileSync } = require('node:child_process');

exports.default = async function afterSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  // --deep 递归重签所有嵌套 framework/helper，兜掉 electron-builder 自身签名顺序埋的坑
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
```

Ember 不用摄像头/麦克风，严格说这个钩子不是必需的，但它几乎零成本、能顺手兜掉这一类"签完名之后又被动过内容"的问题，建议保留。

### 1.4 entitlements —— 自己写，不赌默认值

Ember 需要的能力：
- 启动 V8 JIT（Electron/Chromium 本身需要，不给会直接崩，Chromium 官方模板就只给这一条；electron-builder schema 里 `entitlements` 字段的描述也专门提了一句"如果没设对 `com.apple.security.cs.allow-jit` 这类 entitlement，arm64 + Electron 20+ 的 app 可能会崩"）。
- `child_process.spawn()` 拉起用户自己的 `claude` 二进制。**这一步不需要额外 entitlement**：electron-builder GitHub PR #10181（2026-09-24 合并，讨论 ad-hoc entitlements 默认值时提到）明确写了"可执行文件是被 spawn（fork+exec 成独立进程）而不是被 dlopen 加载进本进程，不受 library validation 管辖，会被自动跳过"——library validation 只管你的进程往自己地址空间里加载的动态库/插件，不管你 spawn 出去的独立子进程。

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
```

因为我们把 `hardenedRuntime: false`，这份 entitlements 文件其实**不会真正生效**（hardened runtime 关闭时，entitlements 里的 `com.apple.security.cs.*` 那一组沙盒/运行时限制类 key 根本不被内核强制执行）。留着它的意义是：万一以后要上架 Mac App Store 或要做 notarize（那时必须打开 hardenedRuntime），这份文件已经就位，不用现场补。

> 如果以后遇到"报警告说缺 `com.apple.security.cs.disable-library-validation`"（GitHub issue #10027 记录的已知问题：ad-hoc + hardenedRuntime 组合下，electron-builder 即使你已经给了这条 entitlement 也会误报警告），**忽略这个警告**，issue 里确认这是 electron-builder 自身的假阳性检测逻辑，不影响实际签名结果。这条只在你之后决定打开 hardenedRuntime 时才用得上。

### 1.5 dmg 窗口布局

字段名和默认值已用 `app-builder-lib@26.16.1` 的 `scheme.json`（`DmgOptions`/`DmgWindow`/`DmgContent` 定义）逐字核对，取代了官方 `docs/mac/dmg` 页面（本次调研中两次 WebFetch 均 404，站点可能改版）：

- `format` 默认是 **`UDZO`**（zlib 压缩），不是 `ULFO`；`ULFO`（lzfse 压缩，仅 OS X 10.11+）是可选项，体积通常更小，Ember 的最低系统版本要求不高于 10.11 的话可以放心选它。
- `window.x` 默认 `400`、`window.y` 默认 `100`（相对屏幕左下角，y 轴从下往上数）；`width`/`height` 不写的话取背景图尺寸，取不到就是 `540 × 380`。
- `contents[].x`/`y` 是**图标中心点**相对窗口左上角的像素偏移（不是左上角对齐,、也不含文字标签的空间）。
- `iconSize` 默认 `80`，`iconTextSize` 默认 `12`，`backgroundColor` 默认 `#ffffff`（没给背景图时才用得上）。
- dmg 级别还有一个独立的 `sign` 字段（跟 `mac.sign` 不是一回事），默认 `false`；schema 原话："签 dmg 不是必须的，而且会在配合 notarize 的场景下引发不必要的报错"——Ember 不 notarize，保持默认 `false`，不用手动设。
- `filesystem` 默认 `HFS+`（schema 备注"未来会改成 APFS 默认"，写这份文档时还是 HFS+，可不设）。

```yaml
dmg:
  title: "${productName} ${version}"
  icon: build/icon.icns          # dmg 挂载后磁盘图标（不是 app 图标，但通常用同一个）
  background: build/dmg-background.png   # 建议 660x400（@1x）或 1320x800（@2x），双图放法见下
  window:
    width: 660
    height: 400
  contents:
    - x: 180
      y: 200
      type: file             # 指向打包出的 .app
    - x: 480
      y: 200
      type: link
      path: /Applications
  format: UDZO                # 默认值；想再小一点可以换成 ULFO（lzfse，仅 10.11+）
artifactName: "${productName}-${version}-${arch}.dmg"
```

### 1.6 asar / asarUnpack / files / extraResources —— Ember 的特殊情况

**关键点：Ember 不随包携带 `claude` CLI 二进制本身**（用户已经在本机装过、登录过的那个 `claude`，通过 `pathToClaudeCodeExecutable` 直接指过去，比如 `~/.local/bin/claude`）。所以：

- **不需要** `asarUnpack` 来处理 CLI 二进制（那是给"打包时把自己的原生二进制塞进 app 里"这种场景用的，Ember 不属于这种场景）。
- **不需要** `extraResources` 拷贝 CLI 二进制。
- 唯一需要小心的是：`@anthropic-ai/claude-agent-sdk` 包本身在 asar 里可以正常工作（它是纯 JS/ESM，没有 `.node` 原生扩展），**不需要**为它开 asarUnpack。

`files`/排除规则的核心用途是**砍掉 8 个平台原生二进制包**（见第 2 节），示例：

```yaml
files:
  - '!node_modules/@anthropic-ai/claude-agent-sdk-*/**'
  - '!**/*.map'
  - '!docs/**'
compression: maximum   # 默认就是 normal，maximum 会让构建变慢但 dmg 更小，对纯 JS 项目收益有限，可选
```

---

## 2. 排除 SDK 的平台原生二进制包

### 2.1 本机 grep 验证：`pathToClaudeCodeExecutable` 传了之后，SDK 完全不碰这些包

直接在 `sdk.mjs`（v0.3.283，1.15MB 压缩后单文件）里搜 `pathToClaudeCodeExecutable`，命中的关键一段（变量名是压缩后的，`sh` 就是最终决定的可执行文件路径）：

```js
let sh = d.pathToClaudeCodeExecutable;
if (!sh) {
  let Yt = eze(import.meta.url), ln = JFe(Yt), fr = RG((Li) => ln.resolve(Li));
  if (!fr)
    throw Error(`Native CLI binary for ${process.platform}-${process.arch} not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.`);
  sh = fr;
}
```

翻译一下这段逻辑：**只有当 `pathToClaudeCodeExecutable` 没传（`!sh` 为真）时**，SDK 才会去走"解析当前 `${platform}-${arch}` 对应的原生 CLI 二进制包"这条路径（也就是那 8 个 `@anthropic-ai/claude-agent-sdk-{darwin,linux,win32}-{arm64,x64}[-musl]` optionalDependencies 之一）。Ember 的 query() 调用永远显式传了 `pathToClaudeCodeExecutable`（指向用户本机已登录的 `claude`），所以 `sh` 恒真，`if` 分支永远不会进入——**这 8 个包在 Ember 里逻辑上是死代码，一次都不会被 require/resolve**。

### 2.2 每个平台包多大、为什么必须手动排除

```
$ npm view @anthropic-ai/claude-agent-sdk-darwin-arm64 dist.unpackedSize
225036616          # ≈ 214.6 MiB（单个平台包，解压后）
```

npm 的 `optionalDependencies` 机制会按当前机器的 `os`/`cpu` 字段自动只装匹配的那一个（本机 arm64 Mac 上只会装 `darwin-arm64`，不会把 8 个全装上），**但这一个仍然是 ~215MB**，且 electron-builder 打包时默认会把 `node_modules` 里能找到的所有东西都塞进 asar/app，除非你显式排除。

3 种排除方式，任选其一（建议 A + B 一起用，双重保险）：

**A. package.json 层面，装的时候就不下载**（最干净）：
```jsonc
// package.json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.283"
  }
}
```
安装时用：
```bash
npm install --omit=optional
```
之后每次 `npm ci`/`npm install` 都要记得带这个 flag（或者写进 `.npmrc`：`omit=optional`）。**风险**：如果 `@anthropic-ai/claude-agent-sdk` 未来把某个"真正需要"的可选依赖也放进 `optionalDependencies`（目前这 8 项全是平台二进制，没有别的），`--omit=optional` 会连带跳过，需要每次升级 SDK 版本时重新确认 `optionalDependencies` 列表没变。

**B. electron-builder `files` 层面，构建时二次兜底排除**（即使 A 没做到位，也能拦住）：
```yaml
files:
  - '!node_modules/@anthropic-ai/claude-agent-sdk-*/**'
```
这条 glob 会匹配 `claude-agent-sdk-darwin-arm64`、`claude-agent-sdk-darwin-x64`、`claude-agent-sdk-linux-*` 等全部 8 个包名（它们都以 `@anthropic-ai/claude-agent-sdk-` 为前缀）。**注意目录名里的连字符不能漏**：主包目录名是 `@anthropic-ai/claude-agent-sdk`，8 个平台包是 `@anthropic-ai/claude-agent-sdk-darwin-arm64` 这种带一个额外 `-{platform}` 后缀的兄弟目录，两者在 `node_modules/@anthropic-ai/` 下是平级的不同目录，不存在谁是谁的子目录关系。`claude-agent-sdk-*` 这个 glob 只会命中带后缀的那 8 个，不会碰到主包（因为主包目录名结尾就是 `claude-agent-sdk`，没有再跟一个 `-` 加别的字符）。**但如果误写成不带连字符的 `claude-agent-sdk*`（`*` 可以匹配空字符串），则会连主包目录本身也一起排除掉，导致 SDK 整个用不了**——两者看起来只差一个字符，实际行为完全不同，写的时候务必带上这个连字符。

**C. 验证排除生效**：打包完之后跑：
```bash
find dist/mac-arm64/Ember.app -iname "*claude-agent-sdk-darwin*"
```
应该没有任何输出。再核对整体体积：
```bash
du -sh dist/mac-arm64/Ember.app
```
一个纯 React + Electron + 这个 SDK（排除平台包后）的 app，量级应该在 150-250MB（主要是 Electron Framework 本身的体积，SDK 的 JS 部分只有几 MB）。

### 2.3 SDK 是纯 ESM，怎么在 electron-vite 的主进程里 bundle

确认：`node_modules/@anthropic-ai/claude-agent-sdk/package.json` 里 `"type": "module"`，`"main": "sdk.mjs"`，`exports` 只给了 `default`（ESM），没有 `require` 分支——**是纯 ESM 包，没有 CJS 兼容层**。

electron-vite 对主进程的默认策略（来源：electron-vite 官方 dependency-handling 文档）是"外部化依赖，只 bundle 你自己的代码"。**electron-vite 5 起这是内置行为**，通过 `build.externalizeDeps` 配置（默认就是开启的，不用装/引入任何插件；文档原话特别点明"在 electron-vite 5 之前，你需要自己配 `externalizeDepsPlugin`"——也就是说那是老版本的写法，5.x 直接用配置项就行）：依赖项走 Node 的 `require`/`import`，不参与 Rollup 打包。这对纯 ESM 依赖是**推荐**的处理方式：主进程本身也输出 ESM 的话，纯 ESM 依赖直接外部化 + 原生 `import` 是最简单的路径，不需要再考虑"bundle 成 CJS"。

两条路：

**方案 A（推荐）：主进程整个用 ESM**。在项目根 `package.json` 加 `"type": "module"`，electron-vite 会据此把主进程/preload 都编译成 ESM 输出（`.js`/`.mjs`），Electron 28+ 的主进程本身跑在 Node 的 ESM loader 上，`import { query } from '@anthropic-ai/claude-agent-sdk'` 原生可用，不需要任何转译。preload 脚本注意：electron-vite 的 preload 在 ESM 模式下默认输出用 `.mjs` 后缀（Electron 要求 preload 的 ESM 文件必须是 `.mjs`，`.js` 会被当 CJS 解析），配置里对应写 `main.js` / `preload.mjs`。

**方案 B：主进程保留 CJS，SDK 用动态 `import()` 桥接**。如果项目历史包袱重、不想全局切 ESM，主进程代码里用 `const { query } = await import('@anthropic-ai/claude-agent-sdk');`（CJS 里 `import()` 动态导入 ESM 包，Node 原生支持，不需要转译器）。这条路能跑，但每次调用都要留意"顶层不能同步 `require`"，写起来比方案 A 别扭。

`electron.vite.config.ts` 主进程配置片段（方案 A；`format: 'es'` 不用手写，electron-vite 会根据 `package.json` 的 `"type": "module"` 自动决定输出格式，重复写反而是冗余配置）：

```ts
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        // 见下方"peer dependency 坑"——SDK 声明的 3 个 peerDependencies
        // 一定要么在这里保留外部化（同时确认它们已经是 Ember 自己 package.json
        // 的直接依赖），要么显式排除让 Rollup 直接 bundle 进去，二选一，别放着不管
      }
    }
  },
  // ...preload / renderer
});
```

**peer dependency 坑（打包时才会炸，本地 `npm run dev` 不会暴露）**：`@anthropic-ai/claude-agent-sdk` 的 `package.json` 把 `@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`、`zod` 声明成了 `peerDependencies`，不是 `dependencies`。externalize 策略下，主进程代码里 `import` SDK 时，SDK 内部又会 `import` 这三个包，运行时靠 Node 在 `node_modules` 里现场找——如果 Ember 自己的 `package.json` 没有把这三个包**显式列进自己的 `dependencies`**（只是靠 npm 装 SDK 时自动帮忙装的 peer dep,依赖树里的位置不保证被 electron-builder 的打包判断当成"要拷进最终 app 的东西"），打包出的 app 在收件人电脑上第一次 `import` SDK 就会 `Cannot find module '@anthropic-ai/sdk'` 崩掉，而这个问题在你自己机器上 `npm run dev`/`electron-vite dev` 时因为 `node_modules` 本来就在项目里、Node 能一路往上找到，根本不会暴露，等打包发出去才第一次现形。**修法**：把这三个包连同版本号一起显式加进 Ember 自己 `package.json` 的 `dependencies`（哪怕代码里从来不直接 `import` 它们），确保它们以"一等依赖"的身份进 `node_modules`、被 electron-builder 的依赖树遍历收进最终产物。

---

## 3. 收件人怎么打开这个未签名/ad-hoc 的 app（macOS 15 Sequoia / 26 Tahoe / 27）

**背景（来源：idownloadblog、mjtsai.com、Apple 相关讨论）**：macOS Sequoia（15）移除了"按住 Control 或右键点击 → 打开"这条绕过 Gatekeeper 的老捷径。这个改动延续到了 26（Tahoe）和 27。现在唯二的路是：**系统设置里手动放行**，或者**命令行去掉隔离标记**。

### 3.1 中文说明文案（建议放进 README，并在 DMG 里额外放一份 `打不开请看我.txt`）

```text
【重要】首次打开时如果提示"文件已损坏"或者"无法打开，因为无法验证开发者"，
不是文件坏了，是因为这个 App 没有花钱买 Apple 开发者证书签名，Mac 的"门卫"
（Gatekeeper）默认会挡一下。请按下面任意一种方法处理：

方法一（推荐，图形界面操作）：
1. 把 Ember.app 拖进"应用程序"文件夹（不要在 DMG 窗口里直接双击运行）。
2. 双击打开一次，会弹出拦截提示，点"完成"或"好"（不要点"移到废纸篓"）。
3. 打开【系统设置】→【隐私与安全性】，往下滚，能看到一行提示
   "Ember 已被阻止使用，因为它来自身份不明的开发者"，点旁边的
   【仍要打开】，可能会要求你确认一次 Mac 密码或 Touch ID，确认后
   以后就能正常双击打开了。

方法二（终端命令，一步到位）：
1. 打开【终端】（在启动台里搜"终端"或"Terminal"）。
2. 把 Ember.app 拖进"应用程序"文件夹后，粘贴运行这一条命令，回车：
   xattr -dr com.apple.quarantine /Applications/Ember.app
3. 正常情况下不会弹出输入密码的框，回车执行完就结束了，之后
   正常双击打开即可。

为什么会这样：这个 App 是社区/个人开发者做的小工具，没有购买 Apple 每年
99 美元的开发者账号去做"公证"（notarization），所以 macOS 默认不认识它的
签名。这不代表 App 不安全，只是没有走 Apple 的付费认证流程。
```

### 3.2 各系统版本行为差异

- **macOS 15 Sequoia / 26 Tahoe / 27**：右键"打开"这条路已经被拿掉，必须走"系统设置 → 隐私与安全性 → 仍要打开"，或命令行 `xattr`。
- 通过浏览器下载（Safari/Chrome）、AirDrop、微信传输的文件都会被贴上 `com.apple.quarantine` 扩展属性（来源不同，quarantine 字符串里的 agent 名字段不同，比如 `Safari.app`/`WeChat` 等，但都触发同一套 Gatekeeper 流程）。**如果 dmg/app 从没被打上这个标记，直接用 U 盘拷贝或走局域网 SMB 共享分发**，收件人那边双击可以直接打开（因为压根没触发 Gatekeeper 的下载来源检查）——但注意这个前提是"从没被打过标记"：Finder 拷贝文件时会**连同 xattr 一起拷过去**，如果你自己的 dmg 是先从网盘/聊天工具下载到本机、再转成 U 盘拷给别人，那份 dmg 本身已经带着 `com.apple.quarantine` 了，U 盘拷贝并不会把这个标记洗掉，收件人一样会被拦。真正干净的做法是从**本机构建产物目录**（比如 `dist/mac-arm64/Ember-1.0.0-arm64.dmg`，从没经过任何下载环节）直接拷 U 盘，才能保证没有隔离标记。

---

## 4. GUI 启动的 PATH 问题：拿到用户登录 shell 的真实环境变量

### 4.1 问题本质

Finder/Dock/Spotlight 启动的 GUI App 是被 `launchd` 直接 fork 出来的，不经过任何 shell，继承的是一个极简的系统级 PATH（大概是 `/usr/bin:/bin:/usr/sbin:/sbin`），**不会**读取 `~/.zshrc`/`~/.zprofile`/`~/.bash_profile` 里用户自己加的 PATH（比如 `~/.local/bin`，Claude Code CLI 常见安装位置就在这）。这意味着 Ember 如果直接在主进程里 `spawn('claude', ...)`，在终端里跑得好好的，从 Dock 双击打开就会报 `ENOENT`/"claude: command not found"。

### 4.2 标准做法（来源：sindresorhus/shell-path、sindresorhus/shell-env 源码 WebFetch 核实）

`shell-env`（`shell-path` 的底层实现）的核心思路：
1. 用 `$SHELL -ilc '<带标记的 echo> ; env ; <带标记的 echo>'` 跑一遍登录交互 shell。
   - `-i`：interactive，保证读取 `.zshrc` 这类只在交互模式加载的配置文件。
   - `-l`：login，保证读取 `.zprofile`/`.profile` 这类登录 shell 专属配置。
   - `-c`：跟一条命令字符串，跑完就退出，不留一个空 shell 挂着。
2. 用两个相同的分隔符标记（`shell-env` 用的是字符串 `_SHELL_ENV_DELIMITER_`）把 `env` 的输出前后包起来，因为很多人的 `.zshrc` 会在启动时打印欢迎语、oh-my-zsh 更新提示等"噪音"，直接解析 stdout 会被这些噪音污染；有了首尾两个一致的标记，只截取中间那一段即可精确拿到 `env` 的输出，与前后噪音无关。
3. 失败兜底：先试 `process.env.SHELL`（用户当前默认 shell），失败了依次退回 `/bin/zsh`、`/bin/bash`；全部失败就直接返回 `process.env`（也就是退化成"没修的 PATH"，好歹别崩）。
4. 顺手设一个 `DISABLE_AUTO_UPDATE: 'true'` 之类的环境变量传给子 shell，抑制 oh-my-zsh 这类框架在启动时自己触发网络更新检查（既慢又可能往 stdout 里加噪音）。

### 4.3 无额外依赖的 TypeScript 实现（可直接抄进 Ember 主进程）

```ts
// src/main/lib/loginShellEnv.ts
import { execFile } from 'node:child_process';

const DELIMITER = '___EMBER_SHELL_ENV_DELIMITER___';
const TIMEOUT_MS = 6000;

/**
 * 拿到用户登录 shell 里真实的环境变量（含 PATH），修正 GUI 启动时
 * launchd 给的极简 PATH 缺失 ~/.local/bin、nvm、homebrew 等目录的问题。
 * 失败时安全退化为 process.env，绝不抛出、绝不挂起。
 */
export async function getLoginShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return process.env;

  const shell = process.env.SHELL || '/bin/zsh';
  const candidates = [shell, '/bin/zsh', '/bin/bash'].filter(
    (s, i, arr) => arr.indexOf(s) === i, // 去重，保持顺序
  );

  for (const shellPath of candidates) {
    try {
      const env = await runShellEnv(shellPath);
      if (env) return env;
    } catch {
      // 换下一个候选 shell 再试
    }
  }
  return process.env;
}

function runShellEnv(shellPath: string): Promise<NodeJS.ProcessEnv | null> {
  return new Promise((resolve) => {
    const cmd = `echo -n "${DELIMITER}"; env; echo -n "${DELIMITER}"; exit`;
    const child = execFile(
      shellPath,
      ['-ilc', cmd],
      {
        timeout: TIMEOUT_MS,
        env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' }, // 抑制 oh-my-zsh 之类的自动更新噪音
      },
      (error, stdout) => {
        if (error) return resolve(null);
        resolve(parseDelimited(stdout));
      },
    );
    child.on('error', () => resolve(null));
  });
}

function parseDelimited(stdout: string): NodeJS.ProcessEnv | null {
  const start = stdout.indexOf(DELIMITER);
  const end = stdout.lastIndexOf(DELIMITER);
  if (start === -1 || end === -1 || start === end) return null;

  const body = stdout.slice(start + DELIMITER.length, end);
  const env: NodeJS.ProcessEnv = {};
  for (const line of body.split('\n')) {
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : null;
}
```

用法（app ready 之前拿一次，缓存住，别每次 spawn 都重新拉一遍登录 shell——那个操作要跑几十到几百毫秒，且每次都会重新触发一遍 `.zshrc`）：

```ts
// src/main/index.ts
import { app } from 'electron';
import { getLoginShellEnv } from './lib/loginShellEnv';

let cachedEnv: NodeJS.ProcessEnv = process.env;

app.whenReady().then(async () => {
  cachedEnv = await getLoginShellEnv();
  // 之后所有 query({ env: cachedEnv, pathToClaudeCodeExecutable: ... }) 用这份
});
```

**踩坑点**：
- fish shell 不认识 bash/zsh 的 `-ilc` 语义完全等价，但 fish 也支持 `-i -l -c`（参数是共通的 POSIX 风格 flag），实测问题不大；真正的坑是 fish 的配置文件语法（`config.fish`）和 bash/zsh 不同，如果用户的 fish 配置里有语法只在 fish 独有的写法，不影响这段"拉 env"的逻辑（因为我们只关心 `env` 命令的标准输出，不关心 fish 配置本身对不对）。
- 一定要给 `timeout`（示例给了 6 秒），有的用户 `.zshrc` 里有卡住等网络的逻辑（比如某些版本管理器的自动检查），没有 timeout 会让 App 启动卡死。
- 不要用 `execSync`/同步版本卡住主进程事件循环，用异步 `execFile` + Promise。

**已在本机实测（macOS 27、zsh，2026-09-26 新加坡时间）**：跑一遍这段逻辑的最小验证（`$SHELL -ilc 'echo -n M; env; echo -n M'`，截取标记之间的内容找 `PATH=` 那一行），拿到的 `PATH` 里确实包含 `/Users/<user>/.local/bin`（Claude Code CLI 的常见安装位置），而这台机器当前终端会话本身继承的 `PATH`（未经这套 marker 逻辑、来自更上层已定制过的启动环境）里 `.local/bin` 排在末尾靠前的不同位置——两者不完全一致但都包含目标目录，说明这套"跑一遍登录 shell 拿 env"的思路在真实环境里确实能找到用户自己装的 CLI 工具目录，不是纯理论推导。**没有验证到的部分**：本次没有单独造一个"Finder 双击启动、完全没有任何上游环境变量"的干净 Electron 进程去做对照测试，`getLoginShellEnv()` 这段 TypeScript 代码本身的行为是基于 `shell-env` 已发布源码的逐字复刻，逻辑上等价，但没有编译进真正的 `.app` 里从 Dock 双击验证一遍，实现时建议按这个方式做一次最终确认。

---

## 5. App 图标：从 1024px PNG 生成 .icns

### 5.1 macOS 26/27 的图标形状新规矩

来源：heise.de、lapcatsoftware.com、9to5mac、Xojo 论坛（均为 2025 年 macOS 26 Tahoe 发布前后的一手观察）：

- macOS 26 Tahoe 把所有 app 图标强制塞进 iOS 风格的"squircle"（圆角矩形，比传统 macOS 图标的自由造型更规整）。**如果你的图标本来就不是这个形状**（比如一个不规则轮廓的老式 macOS 图标），系统会自动把它塞进一个**灰色的方形/squircle 占位框**里（社区叫这个现象"gray box of shame"）。
- 真正为 Tahoe 设计的方案是用新的 **`.icon` 格式**（文件夹结构，通过 **Icon Composer** 工具生成——这个工具随 Xcode 附带，需要完整 Xcode，不是 Command Line Tools 能装的）。`.icon` 支持分层（背景层/前景层）、透明度、深色/浅色/清澈/着色四种外观变体。
- **Ember 的约束是"没有 Xcode，只有 Command Line Tools"**，所以 `.icon`/Icon Composer 这条路走不通，**只能做传统 `.icns`**。好消息：文章里也提到一个务实的折衷——"把 `Assets.car`（新格式）和老 `.icns` 一起放进 app 的 Resources 目录，这样在 macOS 26 和更早的系统上都能看起来还行"，但生成 `Assets.car` 同样需要 Xcode 的 `actool`，Ember 现阶段做不到，**先接受"传统 .icns 在 Tahoe 下可能被套一个灰色 squircle 边框"这个已知局限**，不是 bug，是 Apple 平台工具链的限制。

**关于".icns 内容应该留多少边距"的具体像素数字**：多方检索（含 successfulsoftware.net 专门讨论 Tahoe 图标迁移的文章）**没有找到 Apple 或权威社区给出的、专门针对"传统 .icns 在 Tahoe 里如何避免灰框"的精确像素/百分比规范**——这条信息在公开渠道里没查到一手数据，**标记为 UNVERIFIED**。业界从 macOS Big Sur（11，2020 年）开始就已经要求 app 图标本身画成圆角矩形（而不是完全自由造型），沿用至今的经验值是：内容主体占 1024×1024 画布里大约 **824×824**（即上下左右各留约 100px 空白，约 80.5% 的画布占比），四角画成圆角矩形轮廓、自带阴影/高光。这是 Big Sur 时代延续下来的经验数字，不是本次调研核实到的 Tahoe 专属新规范，**照此做大概率不会太难看，但不保证是 Tahoe 的"官方推荐值"**。

### 5.2 用系统自带工具（sips + iconutil）生成 .icns —— 不需要 Xcode，Command Line Tools 自带

```bash
#!/bin/bash
# build/make-icns.sh
# 用法: ./make-icns.sh path/to/icon-1024.png build/icon.icns
set -euo pipefail

SRC="$1"
OUT="$2"
ICONSET_DIR="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET_DIR"

# iconutil 要求文件名一字不差，按下面这套命名和尺寸生成
sips -z 16 16     "$SRC" --out "$ICONSET_DIR/icon_16x16.png"
sips -z 32 32     "$SRC" --out "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 32 32     "$SRC" --out "$ICONSET_DIR/icon_32x32.png"
sips -z 64 64     "$SRC" --out "$ICONSET_DIR/icon_32x32@2x.png"
sips -z 128 128   "$SRC" --out "$ICONSET_DIR/icon_128x128.png"
sips -z 256 256   "$SRC" --out "$ICONSET_DIR/icon_128x128@2x.png"
sips -z 256 256   "$SRC" --out "$ICONSET_DIR/icon_256x256.png"
sips -z 512 512   "$SRC" --out "$ICONSET_DIR/icon_256x256@2x.png"
sips -z 512 512   "$SRC" --out "$ICONSET_DIR/icon_512x512.png"
sips -z 1024 1024 "$SRC" --out "$ICONSET_DIR/icon_512x512@2x.png"   # 用 sips 强制缩放到 1024，而不是直接 cp 原图；
                                                                     # 万一传进来的源图不是刚好 1024x1024（比如 1200x1200 或非正方形），
                                                                     # 直接 cp 会导致这一张尺寸和其它 8 张不匹配，iconutil 直接报错拒绝生成

iconutil -c icns "$ICONSET_DIR" -o "$OUT"
rm -rf "$(dirname "$ICONSET_DIR")"
echo "生成完毕: $OUT"
```

`sips`（scriptable image processing system）和 `iconutil` 都是 macOS 系统自带命令行工具（不属于 Xcode Command Line Tools 的额外包，是 `/usr/bin` 里原生就有的），Node 22 环境不需要额外装任何东西。

---

## 6. 验证打包产物

```bash
# 1. 确认签名状态（ad-hoc 签名的 Authority 字段会显示 "not signed" 或没有 Apple 证书链，
#    identifier 字段应该等于你的 bundle id；-vv 4 级别会打印 entitlements 摘要）
codesign -dv --verbose=4 dist/mac-arm64/Ember.app

# 2. 确认 Gatekeeper 评估结果 —— ad-hoc/未 notarize 的包，spctl 必然报 "rejected"，
#    这是预期行为，不代表签名坏了，只是 Apple 不认这个签名的"背书方"
spctl -a -vv dist/mac-arm64/Ember.app

# 3. 确认架构（arm64 构建应该只有一个 arch；universal 构建应该同时列出 x86_64 和 arm64）
lipo -archs "dist/mac-arm64/Ember.app/Contents/MacOS/Ember"

# 4. 本机模拟"从网上下载"触发的隔离标记，验证 README 里给的恢复步骤是否真的有效
xattr -w com.apple.quarantine "0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)" dist/mac-arm64/Ember.app
open dist/mac-arm64/Ember.app        # 应该复现"无法验证开发者"的拦截提示
xattr -dr com.apple.quarantine dist/mac-arm64/Ember.app   # 验证这条命令能解除拦截
open dist/mac-arm64/Ember.app        # 现在应该能正常打开
```

`spctl -a -vv` 对 ad-hoc 签名包报 `rejected` 是**预期结果**（因为 ad-hoc 签名没有 Apple 背书的证书链，Gatekeeper 的策略评估本来就是"没有可信来源"），不要把这个当成"打包失败"的信号——真正要看的是**双击能不能打开**（配合上面第 4 步的隔离标记模拟）。

---

## 7. Electron / electron-builder 二进制下载慢的镜像配置

`electron` 包 postinstall 会去 GitHub Releases 下载对应平台的预编译二进制（几十到上百 MB），`electron-builder` 自己也有一批辅助二进制（比如签名/dmg 制作相关的工具）需要下载，国内网络环境下容易很慢或失败。

```bash
# 临时用（当次命令生效）
ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://cdn.npmmirror.com/binaries/electron-builder-binaries/" \
npm install
```

或者写进项目根 `.npmrc`（持久生效，团队协作更友好）：
```ini
electron_mirror=https://cdn.npmmirror.com/binaries/electron/
electron_builder_binaries_mirror=https://cdn.npmmirror.com/binaries/electron-builder-binaries/
```

来源：antfu.me 关于 npm 二进制镜像配置的文章 + electron 官方安装文档，均确认 `ELECTRON_MIRROR` 改写 `@electron/get` 内部拼接的下载 URL 前缀，`ELECTRON_BUILDER_BINARIES_MIRROR` 对应 electron-builder 自己那套辅助二进制的下载地址，两者是两套独立的环境变量、分别对应两个不同的 npm 包，**必须两个都设，只设一个另一个仍然会走 GitHub 原始地址**。

---

## 附：本次调研引用来源

- [electron-builder — macOS docs](https://www.electron.build/docs/mac/)
- [electron-builder — Code Signing for macOS](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
- [electron-builder — Troubleshooting](https://www.electron.build/docs/troubleshooting/)
- [electron-builder GitHub issue #9529 — ad-hoc signing breaks camera/mic since v26.0.13](https://github.com/electron-userland/electron-builder/issues/9529)
- [electron-builder GitHub PR #10181 — tighten default macOS entitlements](https://github.com/electron-userland/electron-builder/pull/10181)
- [electron-builder templates/entitlements.mac.plist](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/entitlements.mac.plist)
- [electron-builder GitHub issue #10027 — false-positive disable-library-validation warning](https://github.com/electron-userland/electron-builder/issues/10027)
- [electron-builder GitHub issue #8191 — "App is damaged" unusable builds](https://github.com/electron-userland/electron-builder/issues/8191)
- [artmann.co — Signing, Notarizing, and Publishing an Electron App for macOS](https://www.artmann.co/articles/signing-notarizing-and-publishing-an-electron-app-for-mac-os)
- [Eclectic Light Company — Apple Silicon Macs will require signed code](https://eclecticlight.co/2020/08/22/apple-silicon-macs-will-require-signed-code/)
- [idownloadblog — macOS Sequoia removes Control-click Gatekeeper bypass](https://www.idownloadblog.com/2024/08/07/apple-macos-sequoia-gatekeeper-change-install-unsigned-apps-mac/)
- [mjtsai.com — Sequoia Removes Gatekeeper Contextual Menu Override](https://mjtsai.com/blog/2024/07/05/sequoia-removes-gatekeeper-contextual-menu-override/)
- [sindresorhus/shell-path](https://github.com/sindresorhus/shell-path)
- [sindresorhus/shell-env — raw index.js](https://raw.githubusercontent.com/sindresorhus/shell-env/main/index.js)
- [electron-vite — Dependency Handling](https://electron-vite.org/guide/dependency-handling)
- [Electron — ES Modules (ESM) in Electron](https://www.electronjs.org/docs/latest/tutorial/esm)
- [Electron 28.0.0 release notes](https://www.electronjs.org/blog/electron-28-0)
- [heise.de — Icons in macOS 26: Fighting the "Squircle" Prison](https://www.heise.de/en/news/Icons-in-macOS-26-Fighting-the-Squircle-Prison-11075561.html)
- [lapcatsoftware.com — macOS Tahoe forces all app icons into iOS squircles](https://lapcatsoftware.com/articles/2025/6/2.html)
- [9to5mac — macOS Tahoe icon jail fix](https://9to5mac.com/2025/08/08/macos-tahoe-fix-gray-box-icons/)
- [successfulsoftware.net — Updating application icons for macOS 26 Tahoe and Liquid Glass](https://successfulsoftware.net/2025/09/26/updating-application-icons-for-macos-26-tahoe-and-liquid-glass/)
- [antfu.me — NPM Binary 镜像配置](https://antfu.me/posts/npm-binary-mirrors)
- [Electron — Advanced Installation Instructions](https://www.electronjs.org/docs/latest/tutorial/installation)
- [app-builder-lib@26.16.1 scheme.json（electron-builder 配置的 JSON Schema 一手来源）](https://unpkg.com/app-builder-lib@26.16.1/scheme.json)
- 本机一手验证：`/private/tmp/.../scratchpad/sdkprobe/node_modules/@anthropic-ai/claude-agent-sdk/{package.json,sdk.mjs}`（grep `pathToClaudeCodeExecutable`）、`npm view @anthropic-ai/claude-agent-sdk-darwin-arm64 dist.unpackedSize/os/cpu`、`npm view electron-builder/electron/electron-vite version`、`npm view electron-builder time`、`curl https://unpkg.com/app-builder-lib@26.16.1/scheme.json` 后本地解析 `MacConfiguration`/`DmgOptions`/`DmgWindow`/`DmgContent` 字段、本机跑通登录 shell PATH 探针（`$SHELL -ilc` + marker 截取，确认 `~/.local/bin` 出现在结果里）

---

## Reviewer notes（复核记录，2026-09-26）

复核方式：直接读 Ember 项目自己 `node_modules` 里已装好的一手文件（`app-builder-lib@26.15.3` 的 `scheme.json`、`@anthropic-ai/claude-agent-sdk@0.3.283` 及其 8 个平台包的 `package.json`、`electron-vite@5.0.0` 的 `dist/index.d.ts`、`electron@44.4.5`），加 WebFetch 核对 electron-vite 官方文档原文、Electron ESM 文档、GitHub issue #9529 / #10027 / PR #10181 的实际内容，加本机重跑一遍"登录 shell 拿 PATH"探针。

**改动的两处（已在正文里就地修正）**：
1. **1.1 节的事实错误**：原稿说 `mergeASARs`/`singleArchFiles`/`x64ArchFiles` 是嵌套在一个叫 `mac.universal` 的选项里。核对本机 `scheme.json` 后发现**不存在** `mac.universal` 这个字段——这三个字段和 `identity`/`hardenedRuntime` 一样直接扁平挂在 `mac:` 下面，schema 里只是在各自的描述文字里注明"仅 universal 架构下生效"。字段本身的语义（`mergeASARs` 默认 `true` 等）原稿没写错，错的是"挂在哪个字段下面"这个结构性描述。已改写并标注一条子结论（"在正确硬件上分别构建"那条建议本次未找到一手来源）为 UNVERIFIED。
2. **1.2 节 `gatekeeperAssess: false` 的配置注释**：原稿的措辞暗示这个字段默认是 `true`、需要"关掉"。实际查 schema，`gatekeeperAssess` 的默认值本来就是 `false`。这条配置行本身没问题（显式写出来无害），但注释里的因果解释是错的，已改写为"本来就是默认值，写出来是为了自解释/防止未来默认值变化"。

**逐条验证并确认无误的关键事实性主张**（即原稿写对了，且我独立核实过一手来源，不是照抄原稿的引用列表）：
- `sdk.mjs`（v0.3.283）里 `pathToClaudeCodeExecutable` 传了就不会走平台原生二进制解析这段逻辑：直接在本机 `sdkprobe` 探针的 `sdk.mjs` 里重新 grep 到几乎逐字匹配的压缩代码（`sh=d.pathToClaudeCodeExecutable;if(!sh){...throw Error('Native CLI binary for ${process.platform}-${process.arch} not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.')}`），和 Ember 自己的 `docs/sdk/sdk.d.ts`（"Uses the built-in executable if not specified"）互相印证，**无矛盾**。
- 8 个平台包的 `package.json` 确实用 `os`/`cpu` 字段做 npm 自动平台过滤（`darwin-arm64` 包是 `"os":["darwin"],"cpu":["arm64"]`），且是 `optionalDependencies`，peer deps（`@anthropic-ai/sdk`/`@modelcontextprotocol/sdk`/`zod`）确实单独放在 `peerDependencies` 而非 `dependencies` 里——"peer dependency 坑"这条判断成立。
- 平台包体积：`npm view ... dist.unpackedSize` = 225,036,616 字节，本机 `du -sk` 实测 219,776 KiB（≈224.9 MiB），两者吻合，"~215MB/个、8 个近 2GB"的估算合理。
- electron-builder schema 里 `identity`/`hardenedRuntime`/`entitlements`/`gatekeeperAssess`（默认 false）/`dmg.sign`（默认 false）/`DmgWindow`（x 默认 400、y 默认 100）/`DmgContent`（x/y 是图标中心点）/`mac.target` 默认值等，逐字对照本机 `scheme.json` **全部准确**，包括原稿引用的那两句 schema 原话（"If none is found, signing is skipped for all architectures — there is no automatic ad-hoc fallback" 和 hardenedRuntime 的 library validation 说明）都是精确引用，没有编造。
- GitHub issue #9529（ad-hoc 签名 26.0.13 起摄像头/麦克风拿不到帧）、issue #10027（disable-library-validation 假阳性警告）、PR #10181（2026-09-24 合并，新增 ad-hoc 专属 entitlements 模板，且明确写了"spawn 出去的可执行文件不受 library validation 管辖，会被跳过"）——三条都用 WebFetch 重新抓取一遍原文，内容和原稿描述一致，没有夸大或张冠李戴。
- electron-vite 5 的 `build.externalizeDeps` 默认 `true`、5.0 之前要用已废弃的 `externalizeDepsPlugin`：本机 `electron-vite@5.0.0` 的 `dist/index.d.ts` 里能直接看到 `@default true` 和 `@deprecated use build.externalizeDeps` 的标注，和官方文档原文一致。
- Electron 要求 ESM preload 必须用 `.mjs` 后缀、主进程 ESM 支持是 28.0.0 引入的：WebFetch 官方文档原文确认一致。
- GUI PATH 探针的核心机制（`$SHELL -ilc` 跑一遍能在结果里看到 `~/.local/bin`）：本次复核在同一台机器上重新跑了一遍，确认 `~/.local/bin` 确实出现在登录 shell 的 `PATH` 里，且这台机器上 `~/.local/bin/claude` 确实是指向 `~/.local/share/claude/versions/2.1.283` 的软链接（与任务描述里"CLI 2.1.283"吻合）。原稿 4.3 节末尾那段"已在本机实测"的具体表述（拿当前终端 PATH 和探针结果做逐项比较）比较绕、验证增量不大，但探针本身的结论方向是对的，不是编造。

**仍然不确定 / 建议使用者自己再确认一遍的地方**（原稿已经如实标了 UNVERIFIED，复核后维持这个判断，没有找到能升级为"已证实"的一手来源）：
- 5.1 节"1024 画布留 100px 边距、内容占 824×824"这个具体像素数字：多方检索都找不到 Apple 官方或权威社区对 macOS 26 Tahoe **传统 `.icns`** 防止被套灰框的精确边距规范，原稿老实标了 UNVERIFIED，复核同意维持。这条数字是 Big Sur 时代的经验值沿用，不是 Tahoe 专属规范，实际做图标时建议做完之后在真机上装一遍肉眼看效果，不要死磕这个像素数。
- `.icon`/Icon Composer 必须要完整 Xcode（Command Line Tools 装不了）这条，原稿引用了 heise.de/9to5mac/lapcatsoftware 等二手技术媒体，本次复核没有再逐篇重新抓取核实，按原稿标注的来源可信度对待即可（不是一手 Apple 文档）。
- app-builder-lib 的 schema 版本：原稿写的是从 unpkg 拉的 `26.16.1`，Ember 项目本机实际装的是 `26.15.3`（`package.json` 里 `^26.15.3` 范围内的较早补丁版本）。本次复核用本机 `26.15.3` 重新核对了一遍所有引用的字段，结论没有变化（字段名/默认值/描述文字一致），但如果之后 CI/构建机上装到更新的补丁版本，建议留意 changelog 有没有动过这几个字段。
- "在正确的硬件上分别构建 universal 包更可靠"这条建议（1.1 节）：本次没能在 schema 描述文字里找到对应的一手原话，改标为 UNVERIFIED（见上面第 1 条改动），不影响 Ember 的最终建议（反正只发 arm64）。
