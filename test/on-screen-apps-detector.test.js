const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  createActiveWindowDetector,
  extractVisibleWindowNames,
  pickActiveWindow,
  resolveActiveWindowBinaryPath
} = require('../src/screen-stills/on-screen-apps-detector')

const logger = {
  log: () => {},
  warn: () => {},
  error: () => {}
}

test('pickActiveWindow returns the active window when available', () => {
  const input = [
    { name: 'Chrome', active: false },
    { name: 'Code', active: true },
    { name: 'Slack', active: false }
  ]

  const active = pickActiveWindow(input)
  assert.equal(active.name, 'Code')
})

test('pickActiveWindow returns null when no active window exists', () => {
  const active = pickActiveWindow([
    { name: 'Chrome', active: false },
    { name: 'Slack' },
    { name: 'Terminal', active: 0 }
  ])

  assert.equal(active, null)
})

test('extractVisibleWindowNames deduplicates exact app names and skips blank values', () => {
  const candidates = [
    { name: 'Code' },
    { name: 'Code' },
    { name: '  Chrome  ' },
    { name: '' },
    { name: 'Terminal' },
    { name: null }
  ]

  const names = extractVisibleWindowNames(candidates)
  assert.deepEqual(names, ['Code', '  Chrome  ', 'Terminal'])
})

test('detectActiveWindow throws when no active window is detected', async () => {
  const detector = createActiveWindowDetector({
    logger,
    resolveBinaryPathImpl: async () => '/tmp/list-on-screen-apps',
    runWindowListImpl: async () => [
      { name: 'Chrome', active: false },
      { name: 'Terminal', active: 0 }
    ]
  })

  await assert.rejects(
    detector.detectActiveWindow(),
    /No active window detected from helper output\./
  )
})

test('detectActiveWindow returns the active window candidate', async () => {
  const expected = { name: 'Code', bundleId: 'com.microsoft.VSCode', active: true }

  const detector = createActiveWindowDetector({
    logger,
    resolveBinaryPathImpl: async () => '/tmp/list-on-screen-apps',
    runWindowListImpl: async () => [
      { name: 'Terminal', active: false },
      expected,
      { name: 'Safari', active: true }
    ]
  })

  const actual = await detector.detectActiveWindow()
  assert.equal(actual.name, expected.name)
  assert.equal(actual.bundleId, expected.bundleId)
})

test('detectWindowCandidates uses Windows foreground metadata on Windows', async () => {
  const detector = createActiveWindowDetector({
    logger,
    platform: 'win32',
    resolveWindowsForegroundScriptPathImpl: () => 'C:\\App\\resources\\windows\\windows-foreground.ps1',
    runWindowsForegroundImpl: async ({ scriptPath }) => ({
      ok: true,
      reason: 'ok',
      scriptPath,
      window: {
        name: 'Code',
        bundleId: null,
        title: 'notes.md - Visual Studio Code',
        pid: 1234,
        active: true
      }
    })
  })

  const candidates = await detector.detectWindowCandidates()

  assert.equal(await detector.resolveBinaryPath(), 'C:\\App\\resources\\windows\\windows-foreground.ps1')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'Code')
  assert.equal(candidates[0].bundleId, null)
  assert.equal(candidates[0].title, 'notes.md - Visual Studio Code')
  assert.equal(candidates[0].active, true)
  assert.equal(detector.metadataFailureIsNonFatal, true)
})

test('detectWindowCandidates reports Windows foreground failure as metadata unavailable', async () => {
  const warnings = []
  const detector = createActiveWindowDetector({
    logger: {
      log: () => {},
      warn: (...args) => warnings.push(args),
      error: () => {}
    },
    platform: 'win32',
    resolveWindowsForegroundScriptPathImpl: () => 'C:\\App\\resources\\windows\\windows-foreground.ps1',
    runWindowsForegroundImpl: async () => ({
      ok: false,
      reason: 'foreground_unavailable',
      message: 'No foreground window detected.',
      window: null
    })
  })

  await assert.rejects(
    detector.detectWindowCandidates(),
    (error) => {
      assert.equal(error.metadataUnavailable, true)
      assert.equal(error.reason, 'foreground_unavailable')
      return /No foreground window detected\./.test(error.message)
    }
  )
  assert.equal(warnings.length, 0)
})

test('resolveActiveWindowBinaryPath passes a numeric mode flag to fs.promises.access', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familiar-awd-'))
  const binaryPath = path.join(tmpDir, 'list-on-screen-apps-helper')
  fs.writeFileSync(binaryPath, '')
  fs.chmodSync(binaryPath, 0o755)

  const originalAccess = fs.promises.access
  const originalEnv = process.env.FAMILIAR_LIST_ON_SCREEN_APPS_BINARY
  let seenMode = null

  process.env.FAMILIAR_LIST_ON_SCREEN_APPS_BINARY = binaryPath
  fs.promises.access = async (_candidatePath, mode) => {
    seenMode = mode
    if (typeof mode !== 'number') {
      throw new TypeError('expected numeric access mode flag')
    }
  }

  try {
    const detected = await resolveActiveWindowBinaryPath({ logger })

    assert.equal(detected, binaryPath)
    assert.equal(typeof seenMode, 'number')
    assert.equal(seenMode, fs.constants.F_OK)
  } finally {
    fs.promises.access = originalAccess
    if (originalEnv === undefined) {
      delete process.env.FAMILIAR_LIST_ON_SCREEN_APPS_BINARY
    } else {
      process.env.FAMILIAR_LIST_ON_SCREEN_APPS_BINARY = originalEnv
    }
    fs.rmSync(binaryPath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
