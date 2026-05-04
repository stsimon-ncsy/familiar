const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  parseWindowsForegroundJson,
  resolveWindowsForegroundScriptPath,
  runWindowsForeground
} = require('../src/ocr/windows-foreground')

test('resolveWindowsForegroundScriptPath resolves dev and packaged helper locations', () => {
  const repoRoot = path.resolve(__dirname, '..')

  assert.equal(
    resolveWindowsForegroundScriptPath({ repoRoot, resourcesPath: '' }),
    path.join(repoRoot, 'scripts', 'windows', 'windows-foreground.ps1')
  )
  assert.equal(
    resolveWindowsForegroundScriptPath({ repoRoot, resourcesPath: 'C:\\App\\resources' }),
    path.join('C:\\App\\resources', 'windows', 'windows-foreground.ps1')
  )
})

test('parseWindowsForegroundJson removes BOM and PowerShell control characters', () => {
  const parsed = parseWindowsForegroundJson('\uFEFF\u0000{"ok":true,"window":{"title":"Fam\u0007iliar"}}\u0001')

  assert.equal(parsed.ok, true)
  assert.equal(parsed.window.title, 'Familiar')
})

test('runWindowsForeground parses valid JSON output', async () => {
  const result = await runWindowsForeground({
    scriptPath: 'C:\\App\\resources\\windows\\windows-foreground.ps1',
    platform: 'win32',
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        ok: true,
        reason: 'ok',
        window: {
          title: 'notes.md - Visual Studio Code',
          process_name: 'Code',
          pid: 1234
        }
      }),
      stderr: ''
    })
  })

  assert.equal(result.ok, true)
  assert.equal(result.reason, 'ok')
  assert.deepEqual(result.window, {
    name: 'Code',
    bundleId: null,
    title: 'notes.md - Visual Studio Code',
    pid: 1234,
    active: true
  })
})

test('runWindowsForeground handles invalid JSON output', async () => {
  const result = await runWindowsForeground({
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    execFileImpl: async () => ({ stdout: 'not-json', stderr: '' })
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid_json')
  assert.equal(result.window, null)
  assert.match(result.message, /Failed to parse Windows foreground JSON output/)
})

test('runWindowsForeground handles timeout without throwing', async () => {
  const timeoutError = new Error('Command timed out')
  timeoutError.killed = true

  const result = await runWindowsForeground({
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    timeoutMs: 10,
    execFileImpl: async () => {
      throw timeoutError
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.equal(result.window, null)
  assert.match(result.message, /timed out after 10ms/)
})

test('runWindowsForeground treats helper failure as unavailable metadata', async () => {
  const result = await runWindowsForeground({
    scriptPath: 'C:\\helper.ps1',
    platform: 'win32',
    execFileImpl: async () => {
      const error = new Error('Win32 foreground probe failed')
      error.stderr = 'Access denied'
      throw error
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'foreground_unavailable')
  assert.equal(result.window, null)
  assert.match(result.message, /Win32 foreground probe failed/)
})
