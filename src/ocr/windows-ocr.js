const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const WINDOWS_OCR_ENGINE = 'windows_media_ocr'
const DEFAULT_TIMEOUT_MS = 30000
const MAX_STDOUT_BUFFER = 1024 * 1024 * 50

const PACKAGE_IDENTITY_PATTERNS = [
  'appmodel_error_no_package',
  'package identity required',
  'no package identity'
]

const LANGUAGE_PACK_PATTERNS = [
  'ocr language pack',
  'language pack is available',
  'language pack available',
  'trycreatefromuserprofilelanguages returned null'
]

const MEDIA_OCR_UNAVAILABLE_PATTERNS = [
  'windows.media.ocr',
  'unable to find type [windows.media.ocr',
  'ocrengine',
  'windows media ocr runtime',
  'runtime unavailable'
]

const WINRT_ACTIVATION_PATTERNS = [
  'e_illegal_method_call',
  'winrt activation',
  'activation failure',
  'activation failed',
  'powershell winrt activation failure',
  'class not registered',
  '0x80040154'
]

const createEmptyResult = ({
  ok = false,
  backendAvailable = false,
  reason = 'windows_media_ocr_unavailable',
  message = '',
  stderr = '',
  exitCode = 1,
  raw = null
} = {}) => ({
  ok,
  backend_available: backendAvailable,
  reason,
  message,
  stderr,
  exit_code: exitCode,
  results: new Map(),
  failures: new Map(),
  raw
})

const stripPowerShellControlCharacters = (value) =>
  String(value || '').replace(/^\uFEFF/, '').replace(/[\x00-\x1f]/g, '')

const parseWindowsOcrJson = (stdout) => {
  const sanitized = stripPowerShellControlCharacters(stdout).trim()
  if (!sanitized) {
    throw new Error('Windows OCR produced no JSON output.')
  }

  try {
    return JSON.parse(sanitized)
  } catch (error) {
    throw new Error(
      `Failed to parse Windows OCR JSON output. stdout begins with: ${JSON.stringify(
        sanitized.slice(0, 200)
      )}`
    )
  }
}

const classifyWindowsOcrFailure = (message) => {
  const normalized = String(message || '').toLowerCase()

  if (PACKAGE_IDENTITY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'package_identity_required'
    }
  }

  if (LANGUAGE_PACK_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'ocr_language_pack_unavailable'
    }
  }

  if (WINRT_ACTIVATION_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'winrt_activation_failed'
    }
  }

  if (MEDIA_OCR_UNAVAILABLE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'windows_media_ocr_unavailable'
    }
  }

  return {
    backend_available: false,
    reason: 'windows_media_ocr_unavailable'
  }
}

const resolveWindowsOcrScriptPath = ({
  repoRoot = path.resolve(__dirname, '..', '..'),
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
} = {}) => {
  if (resourcesPath) {
    return path.join(resourcesPath, 'windows', 'windows-ocr.ps1')
  }
  return path.join(repoRoot, 'scripts', 'windows', 'windows-ocr.ps1')
}

const normalizeLines = (lines) =>
  Array.isArray(lines)
    ? lines.map((line) => String(line).replace(/[\x00-\x1f]/g, '').trim()).filter(Boolean)
    : []

const normalizeMeta = (meta = {}) => {
  const raw = meta && typeof meta === 'object' ? meta : {}
  const imageWidth = Number(raw.image_width)
  const imageHeight = Number(raw.image_height)

  return {
    ...raw,
    ocr_engine: raw.ocr_engine || WINDOWS_OCR_ENGINE,
    platform: raw.platform || 'windows',
    image_width: Number.isFinite(imageWidth) && imageWidth > 0 ? Math.floor(imageWidth) : null,
    image_height: Number.isFinite(imageHeight) && imageHeight > 0 ? Math.floor(imageHeight) : null,
    timestamp: typeof raw.timestamp === 'string' && raw.timestamp.trim()
      ? raw.timestamp.trim()
      : new Date().toISOString()
  }
}

const normalizeParsedWindowsOcrResult = ({ parsed, imagePaths = [], stderr = '', exitCode = 0 } = {}) => {
  const backendAvailable = parsed?.backend_available !== false
  const ok = parsed?.ok !== false && backendAvailable
  const reason = parsed?.reason || (ok ? 'ok' : 'windows_media_ocr_unavailable')
  const results = new Map()
  const failures = new Map()

  let rawResults = parsed?.results && typeof parsed.results === 'object' && !Array.isArray(parsed.results)
    ? parsed.results
    : null

  if (!rawResults && Array.isArray(parsed?.lines) && imagePaths.length === 1) {
    rawResults = {
      [imagePaths[0]]: parsed
    }
  }

  if (rawResults) {
    for (const [imagePath, entry] of Object.entries(rawResults)) {
      if (!entry || typeof entry !== 'object') {
        failures.set(imagePath, {
          reason: 'invalid_result',
          message: 'Windows OCR result entry was not an object.'
        })
        continue
      }

      if (entry.ok === false || entry.backend_available === false || entry.error) {
        const message = entry.message || entry.error || 'Windows OCR failed for image.'
        failures.set(imagePath, {
          backend_available: entry.backend_available !== false,
          reason: entry.reason || classifyWindowsOcrFailure(message).reason,
          message
        })
        continue
      }

      results.set(imagePath, {
        meta: normalizeMeta(entry.meta || entry),
        lines: normalizeLines(entry.lines),
        raw: entry
      })
    }
  }

  return {
    ok,
    backend_available: backendAvailable,
    reason,
    message: parsed?.message || '',
    stderr,
    exit_code: exitCode,
    results,
    failures,
    raw: parsed
  }
}

const runWindowsOcrBatch = async ({
  imagePaths,
  scriptPath = resolveWindowsOcrScriptPath(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  execFileImpl = execFileAsync
} = {}) => {
  const resolvedImagePaths = Array.isArray(imagePaths)
    ? imagePaths.map((imagePath) => String(imagePath || '')).filter(Boolean)
    : []

  if (resolvedImagePaths.length === 0) {
    return createEmptyResult({
      ok: true,
      backendAvailable: true,
      reason: 'ok',
      exitCode: 0
    })
  }

  if (platform !== 'win32') {
    return createEmptyResult({
      reason: 'not_windows',
      message: 'Windows OCR can only run on Windows.'
    })
  }

  if (!scriptPath) {
    return createEmptyResult({
      reason: 'missing_windows_ocr_helper',
      message: 'Windows OCR PowerShell helper path is missing.'
    })
  }

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ImagePath',
    ...resolvedImagePaths
  ]

  try {
    const result = await execFileImpl('powershell.exe', args, {
      maxBuffer: MAX_STDOUT_BUFFER,
      timeout: timeoutMs,
      windowsHide: true
    })
    const parsed = parseWindowsOcrJson(result.stdout)
    return normalizeParsedWindowsOcrResult({
      parsed,
      imagePaths: resolvedImagePaths,
      stderr: String(result.stderr || '').trim(),
      exitCode: 0
    })
  } catch (error) {
    if (error?.stdout) {
      try {
        const parsed = parseWindowsOcrJson(error.stdout)
        return normalizeParsedWindowsOcrResult({
          parsed,
          imagePaths: resolvedImagePaths,
          stderr: String(error.stderr || '').trim(),
          exitCode: typeof error.code === 'number' ? error.code : 1
        })
      } catch (_) {
        // Fall through to the structured process failure.
      }
    }

    if (
      typeof error?.message === 'string' &&
      (
        error.message.startsWith('Failed to parse Windows OCR JSON output') ||
        error.message.startsWith('Windows OCR produced no JSON output')
      )
    ) {
      return createEmptyResult({
        reason: 'invalid_json',
        message: error.message,
        stderr: String(error.stderr || '').trim(),
        exitCode: 1
      })
    }

    if (error?.killed || error?.signal === 'SIGTERM') {
      return createEmptyResult({
        reason: 'timeout',
        message: `Windows OCR timed out after ${timeoutMs}ms.`,
        stderr: String(error.stderr || '').trim(),
        exitCode: typeof error.code === 'number' ? error.code : 1
      })
    }

    const message = error?.message || String(error)
    const classification = classifyWindowsOcrFailure(`${message}\n${error?.stderr || ''}`)
    return createEmptyResult({
      backendAvailable: classification.backend_available,
      reason: classification.reason,
      message,
      stderr: String(error?.stderr || '').trim(),
      exitCode: typeof error?.code === 'number' ? error.code : 1
    })
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  WINDOWS_OCR_ENGINE,
  classifyWindowsOcrFailure,
  normalizeParsedWindowsOcrResult,
  parseWindowsOcrJson,
  resolveWindowsOcrScriptPath,
  runWindowsOcrBatch,
  stripPowerShellControlCharacters
}
