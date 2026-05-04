const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isSupportedDesktopPlatform,
  shouldInitializeRecordingForPlatform
} = require('../src/platform/support')

test('supports macOS and Windows desktop platforms', () => {
  assert.equal(isSupportedDesktopPlatform('darwin'), true)
  assert.equal(isSupportedDesktopPlatform('win32'), true)
  assert.equal(isSupportedDesktopPlatform('linux'), false)
})

test('initializes recording on macOS and Windows plus e2e fallback', () => {
  assert.equal(shouldInitializeRecordingForPlatform({ platform: 'darwin' }), true)
  assert.equal(shouldInitializeRecordingForPlatform({ platform: 'win32' }), true)
  assert.equal(shouldInitializeRecordingForPlatform({ platform: 'linux' }), false)
  assert.equal(shouldInitializeRecordingForPlatform({ platform: 'linux', isE2E: true }), true)
})
