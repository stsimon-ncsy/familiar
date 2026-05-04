const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

const CAPTURE_BUFFER = Buffer.from('privacy-test-capture')

const resetRecorderModule = () => {
  const resolved = require.resolve('../src/screen-stills/recorder')
  delete require.cache[resolved]
}

const createDeterministicLowPowerModeMonitor = () => ({
  start: () => {},
  stop: () => {},
  on: () => {},
  off: () => {},
  isLowPowerModeEnabled: () => false
})

const createMockSource = () => ({
  id: 'screen:1',
  display_id: '1',
  thumbnail: {
    toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
    getSize: () => ({ width: 640, height: 480 })
  }
})

const setupRecorderTest = ({
  blacklistedApps = [],
  windowSnapshots = [],
  logger = null,
  detectorMetadataFailureIsNonFatal = false,
  detectorSupportsWindowMetadata = true
} = {}) => {
  resetRecorderModule()

  const ipcMain = new EventEmitter()
  const queueEnqueues = []
  let startCalls = 0
  let stopCalls = 0
  let captureCalls = 0
  let detectCalls = 0
  let getSourcesCalls = 0

  function createWebContents() {
    const webContents = new EventEmitter()
    webContents.getURL = () => 'file://stills.html'
    webContents.send = (channel, payload) => {
      if (channel === 'screen-stills:start') {
        startCalls += 1
        process.nextTick(() => {
          ipcMain.emit('screen-stills:status', {}, {
            requestId: payload.requestId,
            status: 'started'
          })
        })
      }

      if (channel === 'screen-stills:stop') {
        stopCalls += 1
        process.nextTick(() => {
          ipcMain.emit('screen-stills:status', {}, {
            requestId: payload.requestId,
            status: 'stopped'
          })
        })
      }

      if (channel === 'screen-stills:capture') {
        captureCalls += 1
        process.nextTick(() => {
          ipcMain.emit('screen-stills:status', {}, {
            requestId: payload.requestId,
            status: 'captured',
            imageBuffer: CAPTURE_BUFFER
          })
        })
      }
    }
    return webContents
  }

  function BrowserWindowStub() {
    this.webContents = createWebContents()
    this.loadFile = () => {
      process.nextTick(() => {
        this.webContents.emit('did-finish-load')
        ipcMain.emit('screen-stills:ready', { sender: this.webContents })
      })
    }
    this.on = () => {}
    this.isDestroyed = () => false
    this.destroy = () => {}
  }

  const stubElectron = {
    BrowserWindow: BrowserWindowStub,
    desktopCapturer: {
      getSources: async () => {
        getSourcesCalls += 1
        return [createMockSource()]
      }
    },
    ipcMain,
    screen: {
      getAllDisplays: () => [{ id: 1, bounds: { width: 1000, height: 800 }, scaleFactor: 1 }],
      getPrimaryDisplay: () => ({ id: 1, bounds: { width: 1000, height: 800 }, scaleFactor: 1 })
    },
    app: { getVersion: () => 'test' }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familiar-capture-privacy-'))
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return stubElectron
    }
    if (request === '../screen-capture/permissions') {
      return { isScreenRecordingPermissionGranted: () => true }
    }
    if (request === './session-store') {
      return {
        createSessionStore: ({ contextFolderPath }) => ({
          sessionId: 'session-test',
          sessionDir: path.join(contextFolderPath, 'familiar', 'stills', 'session-test'),
          nextCaptureFile: (capturedAt) => ({ fileName: 'capture.webp', capturedAt })
        })
      }
    }
    if (request === './stills-queue') {
      return {
        createStillsQueue: () => ({
          enqueueCapture: (payload) => queueEnqueues.push(payload),
          close: () => {}
        })
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const cleanup = () => {
    Module._load = originalLoad
    resetRecorderModule()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  const createRecorder = () => {
    const { createRecorder } = require('../src/screen-stills/recorder')
    return createRecorder({
      logger: logger || { log: () => {}, warn: () => {}, error: () => {} },
      intervalSeconds: 1,
      lowPowerModeMonitor: createDeterministicLowPowerModeMonitor(),
      loadSettingsImpl: () => ({
        capturePrivacy: {
          blacklistedApps
        }
      }),
      createActiveWindowDetectorImpl: () => ({
        metadataFailureIsNonFatal: detectorMetadataFailureIsNonFatal,
        supportsWindowMetadata: detectorSupportsWindowMetadata,
        detectWindowCandidates: async () => {
          const next = windowSnapshots[detectCalls] || []
          detectCalls += 1
          if (next instanceof Error) {
            throw next
          }
          return next
        },
        resolveBinaryPath: async () => '/tmp/list-on-screen-apps'
      })
    })
  }

  return {
    tempDir,
    queueEnqueues,
    getStartCalls: () => startCalls,
    getStopCalls: () => stopCalls,
    getCaptureCalls: () => captureCalls,
    getDetectCalls: () => detectCalls,
    getSourcesCalls: () => getSourcesCalls,
    cleanup,
    createRecorder
  }
}

test('Windows foreground pre-capture blacklist match skips before source, renderer capture, write, or enqueue', async () => {
  const harness = setupRecorderTest({
    blacklistedApps: [{ name: 'Code' }],
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [[{ name: 'Code', bundleId: null, title: 'secrets.txt', active: true }]]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 1)
    assert.equal(harness.getSourcesCalls(), 0)
    assert.equal(harness.getStartCalls(), 0)
    assert.equal(harness.getCaptureCalls(), 0)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('recorder skips capture before renderer work when a blacklisted app is already visible', async () => {
  const harness = setupRecorderTest({
    blacklistedApps: [{ bundleId: 'com.apple.MobileSMS', name: 'Messages' }],
    windowSnapshots: [[{ name: 'Messages', bundleId: 'com.apple.MobileSMS', active: true }]]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getCaptureCalls(), 0)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('recorder logs full blacklisted app skip details without collapsing nested objects', async () => {
  const logMessages = []
  const harness = setupRecorderTest({
    blacklistedApps: [{ bundleId: 'com.apple.MobileSMS', name: 'Messages' }],
    windowSnapshots: [[{ name: 'Messages', bundleId: 'com.apple.MobileSMS', title: 'Inbox', active: true }]],
    logger: {
      log: (message) => logMessages.push(message),
      warn: () => {},
      error: () => {}
    }
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    const skipLog = logMessages.find((message) => message.includes('Skipped still capture due to blacklisted visible app'))
    assert.ok(skipLog)
    assert.match(skipLog, /blacklistedApp:\s*\{\s*bundleId:\s*'com\.apple\.MobileSMS'/)
    assert.match(skipLog, /visibleWindow:\s*\{\s*bundleId:\s*'com\.apple\.MobileSMS'/)
    assert.doesNotMatch(skipLog, /\[Object\]/)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('recorder drops encoded bytes after capture when a blacklisted app becomes visible', async () => {
  const harness = setupRecorderTest({
    blacklistedApps: [{ bundleId: 'com.apple.MobileSMS', name: 'Messages' }],
    windowSnapshots: [
      [{ name: 'Code', bundleId: 'com.microsoft.VSCode', active: true }],
      [{ name: 'Messages', bundleId: 'com.apple.MobileSMS', active: true }]
    ]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getCaptureCalls(), 1)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('Windows foreground post-capture blacklist match drops captured bytes before write or enqueue', async () => {
  const harness = setupRecorderTest({
    blacklistedApps: [{ name: 'Messages' }],
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [
      [{ name: 'Code', bundleId: null, title: 'work.md', active: true }],
      [{ name: 'Messages', bundleId: null, title: 'Private chat', active: true }]
    ]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 2)
    assert.equal(harness.getSourcesCalls(), 1)
    assert.equal(harness.getStartCalls(), 1)
    assert.equal(harness.getCaptureCalls(), 1)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('Windows foreground detection failure with blacklisted apps skips before source, renderer capture, write, or enqueue', async () => {
  const unavailableError = new Error('Windows foreground helper unavailable.')
  unavailableError.metadataUnavailable = true
  unavailableError.reason = 'foreground_unavailable'

  const harness = setupRecorderTest({
    blacklistedApps: [{ name: 'Messages' }],
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [unavailableError]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 1)
    assert.equal(harness.getSourcesCalls(), 0)
    assert.equal(harness.getStartCalls(), 0)
    assert.equal(harness.getCaptureCalls(), 0)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('Windows foreground post-capture detection failure with blacklisted apps drops captured bytes before write or enqueue', async () => {
  const unavailableError = new Error('Windows foreground helper unavailable after capture.')
  unavailableError.metadataUnavailable = true
  unavailableError.reason = 'foreground_unavailable'

  const harness = setupRecorderTest({
    blacklistedApps: [{ name: 'Messages' }],
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [
      [{ name: 'Code', bundleId: null, title: 'work.md', active: true }],
      unavailableError
    ]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 2)
    assert.equal(harness.getSourcesCalls(), 1)
    assert.equal(harness.getStartCalls(), 1)
    assert.equal(harness.getCaptureCalls(), 1)
    assert.equal(harness.queueEnqueues.length, 0)
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), false)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('Windows foreground detection unavailable with no blacklisted apps continues with null metadata', async () => {
  const beforeError = new Error('Windows foreground helper unavailable before capture.')
  beforeError.metadataUnavailable = true
  beforeError.reason = 'foreground_unavailable'
  const afterError = new Error('Windows foreground helper unavailable after capture.')
  afterError.metadataUnavailable = true
  afterError.reason = 'foreground_unavailable'

  const harness = setupRecorderTest({
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [beforeError, afterError]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 2)
    assert.equal(harness.getStartCalls(), 1)
    assert.equal(harness.getCaptureCalls(), 1)
    assert.equal(harness.queueEnqueues.length, 1)
    assert.equal(harness.queueEnqueues[0].appName, null)
    assert.equal(harness.queueEnqueues[0].appBundleId, null)
    assert.equal(harness.queueEnqueues[0].appTitle, null)
    assert.equal(harness.queueEnqueues[0].appLabelSource, null)
    assert.deepEqual(harness.queueEnqueues[0].visibleWindowNames, [])
    assert.equal(fs.existsSync(path.join(harness.tempDir, 'familiar', 'stills', 'session-test', 'capture.webp')), true)

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})

test('Windows foreground detection success with no blacklisted apps stores metadata', async () => {
  const harness = setupRecorderTest({
    detectorMetadataFailureIsNonFatal: true,
    windowSnapshots: [
      [{ name: 'Code', bundleId: null, title: 'work.md - Visual Studio Code', active: true }],
      [{ name: 'Code', bundleId: null, title: 'work.md - Visual Studio Code', active: true }]
    ]
  })

  try {
    const recorder = harness.createRecorder()
    const result = await recorder.start({ contextFolderPath: harness.tempDir })

    assert.equal(result.ok, true)
    assert.equal(harness.getDetectCalls(), 2)
    assert.equal(harness.getStartCalls(), 1)
    assert.equal(harness.getCaptureCalls(), 1)
    assert.equal(harness.queueEnqueues.length, 1)
    assert.equal(harness.queueEnqueues[0].appName, 'Code')
    assert.equal(harness.queueEnqueues[0].appBundleId, null)
    assert.equal(harness.queueEnqueues[0].appTitle, 'work.md - Visual Studio Code')
    assert.equal(harness.queueEnqueues[0].appLabelSource, 'after')
    assert.deepEqual(harness.queueEnqueues[0].visibleWindowNames, ['Code'])

    await recorder.stop({ reason: 'test' })
  } finally {
    harness.cleanup()
  }
})
