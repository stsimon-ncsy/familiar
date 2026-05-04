const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 5000
const MAX_STDOUT_BUFFER = 1024 * 1024

const createUnavailableResult = ({
  reason = 'foreground_unavailable',
  message = '',
  stderr = '',
  exitCode = 1,
  raw = null
} = {}) => ({
  ok: false,
  reason,
  message,
  stderr,
  exit_code: exitCode,
  window: null,
  raw
})

const stripPowerShellControlCharacters = (value) =>
  String(value || '').replace(/^\uFEFF/, '').replace(/[\x00-\x1f]/g, '')

const parseWindowsForegroundJson = (stdout) => {
  const sanitized = stripPowerShellControlCharacters(stdout).trim()
  if (!sanitized) {
    throw new Error('Windows foreground helper produced no JSON output.')
  }

  try {
    return JSON.parse(sanitized)
  } catch (_error) {
    throw new Error(
      `Failed to parse Windows foreground JSON output. stdout begins with: ${JSON.stringify(
        sanitized.slice(0, 200)
      )}`
    )
  }
}

const resolveWindowsForegroundScriptPath = ({
  repoRoot = path.resolve(__dirname, '..', '..'),
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
} = {}) => {
  if (resourcesPath) {
    return path.join(resourcesPath, 'windows', 'windows-foreground.ps1')
  }
  return path.join(repoRoot, 'scripts', 'windows', 'windows-foreground.ps1')
}

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized || null
}

const normalizePid = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

const normalizeWindowCandidate = (rawWindow) => {
  if (!rawWindow || typeof rawWindow !== 'object') {
    return null
  }

  const name = normalizeString(
    rawWindow.process_name ||
    rawWindow.processName ||
    rawWindow.app ||
    rawWindow.name
  )
  const title = normalizeString(rawWindow.title || rawWindow.window_title || rawWindow.windowTitle)
  const pid = normalizePid(rawWindow.pid)

  if (!name && !title) {
    return null
  }

  return {
    name,
    bundleId: null,
    title,
    pid,
    active: true
  }
}

const normalizeParsedWindowsForegroundResult = ({
  parsed,
  stderr = '',
  exitCode = 0
} = {}) => {
  const rawWindow =
    parsed?.window ||
    parsed?.foreground_window ||
    parsed?.foregroundWindow ||
    (parsed?.title || parsed?.app || parsed?.process_name ? parsed : null)
  const window = normalizeWindowCandidate(rawWindow)
  const ok = parsed?.ok !== false && !!window

  if (!ok) {
    return createUnavailableResult({
      reason: parsed?.reason || 'foreground_unavailable',
      message: parsed?.message || 'Windows foreground metadata is unavailable.',
      stderr,
      exitCode,
      raw: parsed || null
    })
  }

  return {
    ok: true,
    reason: parsed?.reason || 'ok',
    message: parsed?.message || '',
    stderr,
    exit_code: exitCode,
    window,
    raw: parsed
  }
}

const runWindowsForeground = async ({
  scriptPath = resolveWindowsForegroundScriptPath(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  execFileImpl = execFileAsync
} = {}) => {
  if (platform !== 'win32') {
    return createUnavailableResult({
      reason: 'not_windows',
      message: 'Windows foreground metadata is only available on Windows.'
    })
  }

  if (!scriptPath) {
    return createUnavailableResult({
      reason: 'missing_windows_foreground_helper',
      message: 'Windows foreground PowerShell helper path is missing.'
    })
  }

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ]

  try {
    const result = await execFileImpl('powershell.exe', args, {
      maxBuffer: MAX_STDOUT_BUFFER,
      timeout: timeoutMs,
      windowsHide: true
    })
    const parsed = parseWindowsForegroundJson(result.stdout)
    return normalizeParsedWindowsForegroundResult({
      parsed,
      stderr: String(result.stderr || '').trim(),
      exitCode: 0
    })
  } catch (error) {
    if (error?.stdout) {
      try {
        const parsed = parseWindowsForegroundJson(error.stdout)
        return normalizeParsedWindowsForegroundResult({
          parsed,
          stderr: String(error.stderr || '').trim(),
          exitCode: typeof error.code === 'number' ? error.code : 1
        })
      } catch (parseError) {
        return createUnavailableResult({
          reason: 'invalid_json',
          message: parseError.message,
          stderr: String(error.stderr || '').trim(),
          exitCode: typeof error.code === 'number' ? error.code : 1
        })
      }
    }

    if (
      typeof error?.message === 'string' &&
      (
        error.message.startsWith('Failed to parse Windows foreground JSON output') ||
        error.message.startsWith('Windows foreground helper produced no JSON output')
      )
    ) {
      return createUnavailableResult({
        reason: 'invalid_json',
        message: error.message,
        stderr: String(error.stderr || '').trim(),
        exitCode: 1
      })
    }

    if (error?.killed || error?.signal === 'SIGTERM') {
      return createUnavailableResult({
        reason: 'timeout',
        message: `Windows foreground metadata timed out after ${timeoutMs}ms.`,
        stderr: String(error.stderr || '').trim(),
        exitCode: typeof error.code === 'number' ? error.code : 1
      })
    }

    return createUnavailableResult({
      reason: 'foreground_unavailable',
      message: error?.message || String(error),
      stderr: String(error?.stderr || '').trim(),
      exitCode: typeof error?.code === 'number' ? error.code : 1
    })
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  normalizeParsedWindowsForegroundResult,
  parseWindowsForegroundJson,
  resolveWindowsForegroundScriptPath,
  runWindowsForeground,
  stripPowerShellControlCharacters
}
