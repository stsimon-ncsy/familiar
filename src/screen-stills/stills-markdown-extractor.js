const { normalizeAppString } = require('../utils/strings')
const {
  resolveAppleVisionOcrBinaryPath,
  runAppleVisionOcrBinary,
  buildMarkdownLayoutFromOcr
} = require('../ocr/apple-vision-ocr')
const { createWindowsOcrExtractor } = require('./windows-ocr-extractor')

const parseVisibleWindowNames = (value, { logger = console } = {}) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string')
  }

  if (typeof value !== 'string') {
    return []
  }
  const normalized = normalizeAppString(value, null)
  if (!normalized) {
    return []
  }

  try {
    const parsed = JSON.parse(normalized)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch (_error) {
    logger.error('Failed to parse visibleWindowNames JSON', {
      value: normalized,
      error: _error?.message || String(_error)
    })
    return []
  }
}

const createAppleVisionOcrExtractor = ({
  settings,
  logger = console,
  resolveBinaryPathImpl = resolveAppleVisionOcrBinaryPath,
  runAppleVisionOcrBinaryImpl = runAppleVisionOcrBinary,
  buildMarkdownLayoutFromOcrImpl = buildMarkdownLayoutFromOcr
} = {}) => {
  const config = settings?.stills_markdown_extractor && typeof settings.stills_markdown_extractor === 'object'
    ? settings.stills_markdown_extractor
    : {}

  const level = typeof config.level === 'string' ? config.level : 'accurate'
  const languages = config.languages || ''
  const usesLanguageCorrection = config.noCorrection === true ? false : true
  const minConfidence = typeof config.minConfidence === 'number' ? config.minConfidence : 0.0

  let binaryPathPromise = null
  const resolveBinaryPathOnce = async () => {
    if (!binaryPathPromise) {
      binaryPathPromise = resolveBinaryPathImpl({ logger })
    }
    return binaryPathPromise
  }

  const canRun = async () => {
    const binaryPath = await resolveBinaryPathOnce()
    if (!binaryPath) {
      return {
        ok: false,
        reason: 'missing_ocr_binary',
        message:
          'Apple Vision OCR helper not found. Build it with ./code/desktopapp/scripts/build-apple-vision-ocr.sh (dev) or ship it with the app.'
      }
    }
    return { ok: true }
  }

  const extractBatch = async ({ rows } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Map()
    }

    const binaryPath = await resolveBinaryPathOnce()
    if (!binaryPath) {
      return new Map()
    }

    const results = new Map()
    for (const row of rows) {
      try {
        const { meta, lines } = await runAppleVisionOcrBinaryImpl({
          binaryPath,
          imagePath: row.image_path,
          level,
          languages,
          usesLanguageCorrection,
          minConfidence,
          emitObservations: false
        })
        const markdown = buildMarkdownLayoutFromOcrImpl({
          imagePath: row.image_path,
          meta,
          lines,
          appName: row?.app_name || null,
          appBundleId: row?.app_bundle_id || null,
          appTitle: row?.app_title || null,
          appLabelSource: row?.app_label_source || null,
          visibleWindowNames: parseVisibleWindowNames(row?.visible_window_names, { logger })
        })
        results.set(String(row.id), {
          markdown,
          providerLabel: 'apple_vision_ocr',
          modelLabel: String(level || 'accurate')
        })
      } catch (error) {
        logger.error('Apple Vision OCR failed for still', {
          id: row.id,
          imagePath: row.image_path,
          error
        })
      }
    }

    return results
  }

  return {
    type: 'apple_vision_ocr',
    // OCR is CPU-heavy; keep this bounded so we don't spawn too many helper processes at once.
    execution: { maxParallelBatches: 2 },
    canRun,
    extractBatch
  }
}

const isWindowsOcrAvailable = ({ platform = process.platform } = {}) => platform === 'win32'

const normalizeExtractorType = ({
  value,
  platform = process.platform,
  isWindowsOcrAvailable: windowsOcrAvailable = isWindowsOcrAvailable({ platform })
} = {}) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'windows_ocr') {
    return 'windows_ocr'
  }
  if (platform === 'win32' && windowsOcrAvailable) {
    return 'windows_ocr'
  }
  return 'apple_vision_ocr'
}

const createStillsMarkdownExtractor = (options = {}) => {
  const {
    settings,
    platform = process.platform,
    isWindowsOcrAvailableImpl = isWindowsOcrAvailable,
    createWindowsOcrExtractorImpl = createWindowsOcrExtractor
  } = options
  const config = settings?.stills_markdown_extractor && typeof settings.stills_markdown_extractor === 'object'
    ? settings.stills_markdown_extractor
    : {}

  const extractorType = normalizeExtractorType({
    value: config.type,
    platform,
    isWindowsOcrAvailable: isWindowsOcrAvailableImpl({ platform, settings })
  })

  if (extractorType === 'windows_ocr') {
    return createWindowsOcrExtractorImpl(options)
  }

  return createAppleVisionOcrExtractor(options)
}

module.exports = {
  createStillsMarkdownExtractor,
  createAppleVisionOcrExtractor,
  isWindowsOcrAvailable,
  normalizeExtractorType
}
