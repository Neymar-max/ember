// Renders the Ember app icon (SVG → 1024 PNG → .icns) and the DMG background. Run: node scripts/make-icon.mjs
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const B = join(process.cwd(), 'build')

// macOS icon grid: 1024 canvas, ~824 squircle body with ~100px margin, continuous-ish corners.
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbf9f3"/>
      <stop offset="1" stop-color="#ece6d7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e8875f" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#e8875f" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#e8875f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coal" cx="0.38" cy="0.32" r="0.8">
      <stop offset="0" stop-color="#ec9a74"/>
      <stop offset="0.55" stop-color="#d97757"/>
      <stop offset="1" stop-color="#b9532f"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#5a3a24" flood-opacity="0.22"/>
    </filter>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#8a3e22" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185.5" fill="none" stroke="#3a2a1a" stroke-opacity="0.08" stroke-width="1"/>
  <circle cx="512" cy="530" r="300" fill="url(#glow)"/>
  <circle cx="512" cy="522" r="206" fill="url(#coal)" filter="url(#soft)"/>
  <!-- terminal prompt: chevron + cursor, in cream -->
  <path d="M430 438 L520 522 L430 606" fill="none" stroke="#fbf6ec" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="548" y="582" width="112" height="44" rx="22" fill="#fbf6ec"/>
</svg>`

mkdirSync(B, { recursive: true })
writeFileSync(join(B, 'icon.svg'), iconSvg)
await sharp(Buffer.from(iconSvg)).png().toFile(join(B, 'icon.png'))

const set = join(B, 'icon.iconset')
rmSync(set, { recursive: true, force: true })
mkdirSync(set)
for (const s of [16, 32, 128, 256, 512]) {
  await sharp(Buffer.from(iconSvg)).resize(s, s).png().toFile(join(set, `icon_${s}x${s}.png`))
  await sharp(Buffer.from(iconSvg)).resize(s * 2, s * 2).png().toFile(join(set, `icon_${s}x${s}@2x.png`))
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(B, 'icon.icns')])
rmSync(set, { recursive: true, force: true })

// DMG background (660x400 @1x and @2x)
const dmgSvg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${660 * scale}" height="${440 * scale}" viewBox="0 0 660 440">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7f5ee"/>
      <stop offset="1" stop-color="#efece2"/>
    </linearGradient>
  </defs>
  <rect width="660" height="440" fill="url(#g)"/>
  <text x="330" y="56" text-anchor="middle" font-family="Songti SC, Georgia, serif" font-size="26" fill="#141413">Ember</text>
  <text x="330" y="80" text-anchor="middle" font-family="PingFang SC, Helvetica, sans-serif" font-size="12.5" fill="#73726c">Claude Code 的桌面界面 · A warm desktop UI for Claude Code</text>
  <path d="M262 176 C 300 162, 360 162, 398 176" fill="none" stroke="#c6613f" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 7"/>
  <path d="M390 168 L400 177 L388 183" fill="none" stroke="#c6613f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="330" y="258" text-anchor="middle" font-family="PingFang SC, Helvetica, sans-serif" font-size="13" fill="#3d3d3a">把 Ember 拖到「应用程序」即可安装</text>
  <text x="330" y="280" text-anchor="middle" font-family="PingFang SC, Helvetica, sans-serif" font-size="11.5" fill="#73726c">首次打开如被拦截：系统设置 → 隐私与安全性 → 仍要打开（详见下方说明）</text>
</svg>`
await sharp(Buffer.from(dmgSvg(1))).png().toFile(join(B, 'dmg-background.png'))
await sharp(Buffer.from(dmgSvg(2))).png().toFile(join(B, 'dmg-background@2x.png'))
console.log('icon + dmg background written to build/')
