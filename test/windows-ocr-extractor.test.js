const test = require('node:test')
const assert = require('node:assert/strict')

const { createWindowsOcrExtractor } = require('../src/screen-stills/windows-ocr-extractor')

test('Windows OCR extractor returns familiar-layout-v0 markdown for successful OCR', async () => {
  const imagePath = 'C:\\tmp\\screen.png'
  const extractor = createWindowsOcrExtractor({
    platform: 'win32',
    resolveScriptPathImpl: () => 'C:\\App\\resources\\windows\\windows-ocr.ps1',
    fileExistsImpl: async () => true,
    runWindowsOcrBatchImpl: async () => ({
      ok: true,
      backend_available: true,
      reason: 'ok',
      results: new Map([
        [
          imagePath,
          {
            meta: {
              image_width: 320,
              image_height: 200,
              timestamp: '2026-05-04T12:00:00.000Z'
            },
            lines: ['Familiar OCR probe 123']
          }
        ]
      ])
    })
  })

  const canRun = await extractor.canRun()
  assert.equal(canRun.ok, true)

  const results = await extractor.extractBatch({
    rows: [
      {
        id: 42,
        image_path: imagePath,
        app_name: 'Code',
        app_bundle_id: 'com.microsoft.VSCode',
        app_title: 'editor.js',
        app_label_source: 'test'
      }
    ]
  })

  const entry = results.get('42')
  assert.equal(entry.providerLabel, 'windows_ocr')
  assert.equal(entry.modelLabel, 'windows_media_ocr')
  assert.match(entry.markdown, /format: familiar-layout-v0/)
  assert.match(entry.markdown, /extractor: windows_ocr/)
  assert.match(entry.markdown, /ocr_engine: windows_media_ocr/)
  assert.match(entry.markdown, /platform: windows/)
  assert.match(entry.markdown, /image_width: 320/)
  assert.match(entry.markdown, /image_height: 200/)
  assert.match(entry.markdown, /timestamp: 2026-05-04T12:00:00.000Z/)
  assert.match(entry.markdown, /url: null/)
  assert.match(entry.markdown, /- "Familiar OCR probe 123"/)
})

test('Windows OCR extractor marks backend unavailable without crashing on OCR failure', async () => {
  const errors = []
  const extractor = createWindowsOcrExtractor({
    platform: 'win32',
    logger: {
      log: () => {},
      warn: () => {},
      error: (...args) => errors.push(args)
    },
    resolveScriptPathImpl: () => 'C:\\App\\resources\\windows\\windows-ocr.ps1',
    fileExistsImpl: async () => true,
    runWindowsOcrBatchImpl: async () => ({
      ok: false,
      backend_available: false,
      reason: 'package_identity_required',
      message: 'APPMODEL_ERROR_NO_PACKAGE: package identity required',
      results: new Map()
    })
  })

  const results = await extractor.extractBatch({
    rows: [{ id: 1, image_path: 'C:\\tmp\\screen.png' }]
  })
  const canRunAfterFailure = await extractor.canRun()

  assert.equal(results.size, 0)
  assert.equal(canRunAfterFailure.ok, false)
  assert.equal(canRunAfterFailure.reason, 'package_identity_required')
  assert.equal(errors.length, 1)
})
