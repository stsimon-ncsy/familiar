const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createStillsMarkdownExtractor,
  createAppleVisionOcrExtractor,
  normalizeExtractorType
} = require('../src/screen-stills/stills-markdown-extractor')

test('normalizeExtractorType preserves windows_ocr', () => {
  assert.equal(
    normalizeExtractorType({
      value: 'windows_ocr',
      platform: 'darwin',
      isWindowsOcrAvailable: false
    }),
    'windows_ocr'
  )
})

test('createStillsMarkdownExtractor keeps cloud OCR non-default on macOS', () => {
  const extractor = createStillsMarkdownExtractor({
    platform: 'darwin',
    settings: { stills_markdown_extractor: { type: 'llm' } },
    resolveBinaryPathImpl: async () => '/tmp/familiar-ocr-helper',
    runAppleVisionOcrBinaryImpl: async () => ({ meta: {}, lines: [] }),
    buildMarkdownLayoutFromOcrImpl: () => 'mock markdown'
  })

  assert.equal(extractor.type, 'apple_vision_ocr')
})

test('createStillsMarkdownExtractor defaults to Windows OCR when available on Windows', () => {
  const extractor = createStillsMarkdownExtractor({
    platform: 'win32',
    settings: {},
    isWindowsOcrAvailableImpl: () => true,
    createWindowsOcrExtractorImpl: () => ({
      type: 'windows_ocr',
      execution: { maxParallelBatches: 2 },
      canRun: async () => ({ ok: true }),
      extractBatch: async () => new Map()
    }),
    resolveBinaryPathImpl: async () => '/tmp/familiar-ocr-helper',
    runAppleVisionOcrBinaryImpl: async () => ({ meta: {}, lines: [] }),
    buildMarkdownLayoutFromOcrImpl: () => 'mock markdown'
  })

  assert.equal(extractor.type, 'windows_ocr')
})

test('apple vision ocr extractor caps parallel batches at 2', () => {
  const extractor = createAppleVisionOcrExtractor({
    settings: { stills_markdown_extractor: { type: 'apple_vision_ocr' } },
    resolveBinaryPathImpl: async () => '/tmp/familiar-ocr-helper',
    runAppleVisionOcrBinaryImpl: async () => ({ meta: {}, lines: [] }),
    buildMarkdownLayoutFromOcrImpl: () => 'mock markdown'
  })

  assert.equal(extractor.execution.maxParallelBatches, 2)
})

test('apple vision extractor passes visible window names into markdown builder', async () => {
  let visibleWindowNamesSeen
  const extractor = createAppleVisionOcrExtractor({
    settings: { stills_markdown_extractor: { type: 'apple_vision_ocr' } },
    resolveBinaryPathImpl: async () => '/tmp/familiar-ocr-helper',
    runAppleVisionOcrBinaryImpl: async () => ({
      meta: {},
      lines: ['test']
    }),
    buildMarkdownLayoutFromOcrImpl: ({ visibleWindowNames }) => {
      visibleWindowNamesSeen = visibleWindowNames
      return 'mock markdown'
    }
  })

  const result = await extractor.extractBatch({
    rows: [{
      id: 1,
      image_path: '/tmp/image.png',
      visible_window_names: JSON.stringify(['Code', 'Google Chrome'])
    }]
  })

  assert.equal(result.get('1')?.markdown, 'mock markdown')
  assert.deepEqual(visibleWindowNamesSeen, ['Code', 'Google Chrome'])
})
