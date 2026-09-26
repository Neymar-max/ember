// Re-sign the whole bundle ad-hoc after electron-builder's own signing pass, so every nested
// helper/framework carries a consistent signature (unsigned or half-signed arm64 apps report "damaged").
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = context.packager.projectDir
    ? path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
    : path.join(__dirname, 'entitlements.mac.plist')
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
