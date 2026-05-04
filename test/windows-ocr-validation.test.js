const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  parseProbeJson,
  classifyWindowsOcrFailure,
  resolveWindowsOcrProbeScriptPath
} = require('../scripts/windows/validate-windows-ocr')

test('parseProbeJson accepts clean PowerShell JSON', () => {
  const parsed = parseProbeJson('{"ok":true,"backend_available":true,"lines":["Familiar"]}')

  assert.equal(parsed.ok, true)
  assert.equal(parsed.backend_available, true)
  assert.deepEqual(parsed.lines, ['Familiar'])
})

test('parseProbeJson removes BOM and control characters around JSON', () => {
  const parsed = parseProbeJson('\uFEFF\u0000{"ok":false,"error":"APPMODEL_ERROR_NO_PACKAGE"}\u0007')

  assert.equal(parsed.ok, false)
  assert.equal(parsed.error, 'APPMODEL_ERROR_NO_PACKAGE')
})

test('classifyWindowsOcrFailure marks package identity errors as backend unavailable', () => {
  const result = classifyWindowsOcrFailure('APPMODEL_ERROR_NO_PACKAGE: package identity required')

  assert.equal(result.backend_available, false)
  assert.equal(result.reason, 'package_identity_required')
})

test('resolveWindowsOcrProbeScriptPath resolves dev and packaged helper locations', () => {
  const repoRoot = path.resolve(__dirname, '..')
  assert.equal(
    resolveWindowsOcrProbeScriptPath({ repoRoot, resourcesPath: '' }),
    path.join(repoRoot, 'scripts', 'windows', 'windows-media-ocr-probe.ps1')
  )
  assert.equal(
    resolveWindowsOcrProbeScriptPath({ repoRoot, resourcesPath: 'C:\\App\\resources' }),
    path.join('C:\\App\\resources', 'windows', 'windows-media-ocr-probe.ps1')
  )
})
