const fs = require('node:fs/promises')
const path = require('node:path')

const { escapeForQuotedBullet } = require('../ocr/apple-vision-ocr')
const {
  WINDOWS_OCR_ENGINE,
  resolveWindowsOcrScriptPath,
  runWindowsOcrBatch
} = require('../ocr/windows-ocr')
const { normalizeAppString } = require('../utils/strings')

const fileExists = async (candidatePath) => {
  if (!candidatePath) {
    return false
  }
  try {
    const stats = await fs.stat(candidatePath)
    return stats.isFile()
  } catch (_) {
    return false
  }
}

const escapeForQuotedFrontmatterValue = (value) => escapeForQuotedBullet(value)

const normalizeVisibleWindowNames = (value, { logger = console } = {}) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string')
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch (error) {
    logger.error('Failed to parse visibleWindowNames JSON for Windows OCR', {
      error: error?.message || String(error)
    })
    return []
  }
}

const buildMarkdownLayoutFromWindowsOcr = ({
  imagePath,
  meta,
  lines,
  row,
  logger = console
} = {}) => {
  const width = Number(meta?.image_width) || null
  const height = Number(meta?.image_height) || null
  const resolution = width && height ? `${width}x${height}` : 'unknown'
  const timestamp = typeof meta?.timestamp === 'string' && meta.timestamp.trim()
    ? meta.timestamp.trim()
    : new Date().toISOString()

  const normalizedAppName = normalizeAppString(row?.app_name, 'unknown')
  const normalizedAppBundleId = normalizeAppString(row?.app_bundle_id, 'unknown')
  const normalizedAppTitle = normalizeAppString(row?.app_title, 'unknown')
  const normalizedAppLabelSource = normalizeAppString(row?.app_label_source, 'unknown')
  const visibleWindowNames = normalizeVisibleWindowNames(row?.visible_window_names, { logger })
  const visibleWindowYamlLines = visibleWindowNames.length > 0
    ? [
        'visible_windows:',
        ...visibleWindowNames.map((name) => `  - "${escapeForQuotedFrontmatterValue(name)}"`)
      ]
    : ['visible_windows: []']

  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => String(line).trim()).filter(Boolean)
    : []
  const ocrLines = normalizedLines.length > 0 ? normalizedLines : ['NO_TEXT_DETECTED']
  const ocrBullets = ocrLines.map((line) => `- "${escapeForQuotedBullet(line)}"`).join('\n')
  const basename = imagePath ? path.basename(imagePath) : 'unknown'

  return [
    '---',
    'format: familiar-layout-v0',
    'extractor: windows_ocr',
    `source_image: ${basename}`,
    `screen_resolution: ${resolution}`,
    'grid: unknown',
    `app: ${normalizedAppName}`,
    `app_bundle_id: ${normalizedAppBundleId}`,
    `window_title_raw: ${normalizedAppTitle}`,
    `window_title_norm: ${normalizedAppTitle}`,
    `app_label_source: ${normalizedAppLabelSource}`,
    ...visibleWindowYamlLines,
    'url: null',
    'url_source: unavailable',
    `ocr_engine: ${meta?.ocr_engine || WINDOWS_OCR_ENGINE}`,
    'platform: windows',
    `image_width: ${width || 'unknown'}`,
    `image_height: ${height || 'unknown'}`,
    `timestamp: ${timestamp}`,
    '---',
    '# OCR',
    ocrBullets,
    ''
  ].join('\n')
}

const createWindowsOcrExtractor = ({
  logger = console,
  platform = process.platform,
  timeoutMs,
  resolveScriptPathImpl = resolveWindowsOcrScriptPath,
  runWindowsOcrBatchImpl = runWindowsOcrBatch,
  buildMarkdownLayoutFromWindowsOcrImpl = buildMarkdownLayoutFromWindowsOcr,
  fileExistsImpl = fileExists
} = {}) => {
  let helperPathPromise = null
  let backendUnavailable = null

  const resolveScriptPathOnce = async () => {
    if (!helperPathPromise) {
      helperPathPromise = Promise.resolve(resolveScriptPathImpl())
    }
    return helperPathPromise
  }

  const canRun = async () => {
    if (platform !== 'win32') {
      return {
        ok: false,
        reason: 'not_windows',
        message: 'Windows OCR is only available on Windows.'
      }
    }

    if (backendUnavailable) {
      return backendUnavailable
    }

    const scriptPath = await resolveScriptPathOnce()
    if (!scriptPath || !(await fileExistsImpl(scriptPath))) {
      return {
        ok: false,
        reason: 'missing_windows_ocr_helper',
        message: 'Windows OCR PowerShell helper not found.'
      }
    }

    return { ok: true }
  }

  const rememberBackendUnavailable = (result) => {
    backendUnavailable = {
      ok: false,
      reason: result?.reason || 'windows_media_ocr_unavailable',
      message: result?.message || 'Windows OCR backend is unavailable.'
    }
  }

  const extractBatch = async ({ rows } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Map()
    }

    const scriptPath = await resolveScriptPathOnce()
    const imagePaths = rows.map((row) => row?.image_path).filter(Boolean)
    if (imagePaths.length === 0) {
      return new Map()
    }

    let batchResult
    try {
      batchResult = await runWindowsOcrBatchImpl({
        imagePaths,
        scriptPath,
        timeoutMs,
        platform,
        logger
      })
    } catch (error) {
      logger.error('Windows OCR batch failed unexpectedly', { error })
      return new Map()
    }

    if (!batchResult?.ok) {
      if (batchResult?.backend_available === false) {
        rememberBackendUnavailable(batchResult)
      }
      logger.error('Windows OCR batch did not produce markdown', {
        reason: batchResult?.reason || 'unknown',
        message: batchResult?.message || ''
      })
      return new Map()
    }

    const ocrResults = batchResult.results instanceof Map ? batchResult.results : new Map()
    const results = new Map()
    for (const row of rows) {
      const ocrResult = ocrResults.get(row.image_path)
      if (!ocrResult) {
        const failure = batchResult.failures instanceof Map ? batchResult.failures.get(row.image_path) : null
        logger.error('Windows OCR missing result for still', {
          id: row.id,
          imagePath: row.image_path,
          reason: failure?.reason || 'missing_result',
          message: failure?.message || ''
        })
        continue
      }

      const markdown = buildMarkdownLayoutFromWindowsOcrImpl({
        imagePath: row.image_path,
        meta: ocrResult.meta,
        lines: ocrResult.lines,
        row,
        logger
      })

      results.set(String(row.id), {
        markdown,
        providerLabel: 'windows_ocr',
        modelLabel: WINDOWS_OCR_ENGINE
      })
    }

    return results
  }

  return {
    type: 'windows_ocr',
    execution: { maxParallelBatches: 2 },
    canRun,
    extractBatch
  }
}

module.exports = {
  buildMarkdownLayoutFromWindowsOcr,
  createWindowsOcrExtractor,
  fileExists,
  normalizeVisibleWindowNames
}
