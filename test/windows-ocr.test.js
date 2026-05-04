const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  classifyWindowsOcrFailure,
  parseWindowsOcrJson,
  resolveWindowsOcrScriptPath,
  runWindowsOcrBatch
} = require('../src/ocr/windows-ocr')

test('resolveWindowsOcrScriptPath resolves dev and packaged helper locations', () => {
  const repoRoot = path.resolve(__dirname, '..')

  assert.equal(
    resolveWindowsOcrScriptPath({ repoRoot, resourcesPath: '' }),
    path.join(repoRoot, 'scripts', 'windows', 'windows-ocr.ps1')
  )
  assert.equal(
    resolveWindowsOcrScriptPath({ repoRoot, resourcesPath: 'C:\\App\\resources' }),
    path.join('C:\\App\\resources', 'windows', 'windows-ocr.ps1')
  )
})

test('parseWindowsOcrJson accepts clean PowerShell JSON', () => {
  const parsed = parseWindowsOcrJson('{"ok":true,"backend_available":true,"results":{}}')

  assert.equal(parsed.ok, true)
  assert.equal(parsed.backend_available, true)
  assert.deepEqual(parsed.results, {})
})

test('parseWindowsOcrJson removes BOM and PowerShell control characters', () => {
  const parsed = parseWindowsOcrJson('\uFEFF\u0000{"ok":true,"lines":["Fam\u0007iliar"]}\u0001')

  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.lines, ['Familiar'])
})

test('runWindowsOcrBatch parses valid JSON output', async () => {
  const imagePath = 'C:\\tmp\\screen.png'
  const result = await runWindowsOcrBatch({
    imagePaths: [imagePath],
    scriptPath: 'C:\\App\\resources\\windows\\windows-ocr.ps1',
    platform: 'win32',
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        ok: true,
        backend_available: true,
        reason: 'ok',
        results: {
          [imagePath]: {
            meta: {
              image_width: 320,
              image_height: 200,
              timestamp: '2026-05-04T12:00:00.000Z'
            },
            lines: ['Familiar OCR probe 123']
          }
        }
      }),
      stderr: ''
    })
  })

  assert.equal(result.ok, true)
  assert.equal(result.backend_available, true)
  assert.equal(result.reason, 'ok')
  assert.deepEqual(result.results.get(imagePath).lines, ['Familiar OCR probe 123'])
  assert.equal(result.results.get(imagePath).meta.image_width, 320)
})

test('runWindowsOcrBatch handles invalid JSON output', async () => {
  const result = await runWindowsOcrBatch({
    imagePaths: ['C:\\tmp\\screen.png'],
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    execFileImpl: async () => ({ stdout: 'not-json', stderr: '' })
  })

  assert.equal(result.ok, false)
  assert.equal(result.backend_available, false)
  assert.equal(result.reason, 'invalid_json')
  assert.match(result.message, /Failed to parse Windows OCR JSON output/)
})

test('runWindowsOcrBatch handles timeout without throwing', async () => {
  const timeoutError = new Error('Command timed out')
  timeoutError.killed = true

  const result = await runWindowsOcrBatch({
    imagePaths: ['C:\\tmp\\screen.png'],
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    timeoutMs: 10,
    execFileImpl: async () => {
      throw timeoutError
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.backend_available, false)
  assert.equal(result.reason, 'timeout')
  assert.match(result.message, /timed out after 10ms/)
})

test('runWindowsOcrBatch handles backend unavailable package identity errors', async () => {
  const packageError = new Error('APPMODEL_ERROR_NO_PACKAGE: package identity required')
  packageError.stderr = 'package identity required for Windows.Media.Ocr'

  const result = await runWindowsOcrBatch({
    imagePaths: ['C:\\tmp\\screen.png'],
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    execFileImpl: async () => {
      throw packageError
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.backend_available, false)
  assert.equal(result.reason, 'package_identity_required')
})

test('classifyWindowsOcrFailure reports known unavailable reasons clearly', () => {
  const cases = [
    ['APPMODEL_ERROR_NO_PACKAGE', 'package_identity_required'],
    ['package identity required', 'package_identity_required'],
    ['E_ILLEGAL_METHOD_CALL', 'winrt_activation_failed'],
    ['PowerShell WinRT activation failure', 'winrt_activation_failed'],
    ['Unable to find type [Windows.Media.Ocr.OcrEngine]', 'windows_media_ocr_unavailable'],
    ['No Windows OCR language pack is available', 'ocr_language_pack_unavailable']
  ]

  for (const [message, reason] of cases) {
    assert.equal(classifyWindowsOcrFailure(message).reason, reason)
    assert.equal(classifyWindowsOcrFailure(message).backend_available, false)
  }
})
