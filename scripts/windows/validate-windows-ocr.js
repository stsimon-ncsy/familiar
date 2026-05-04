#!/usr/bin/env node

const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const PACKAGE_IDENTITY_PATTERNS = [
  'appmodel_error_no_package',
  'package identity required',
  'no package identity'
]

const WINRT_UNAVAILABLE_PATTERNS = [
  'e_illegal_method_call',
  'windows.media.ocr',
  'winrt',
  'activation',
  'runtime'
]

function stripControlCharacters(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/[\x00-\x1f]/g, '')
}

function parseProbeJson(stdout) {
  const sanitized = stripControlCharacters(stdout).trim()
  if (!sanitized) {
    throw new Error('Windows OCR probe produced no JSON output.')
  }
  return JSON.parse(sanitized)
}

function classifyWindowsOcrFailure(message) {
  const normalized = String(message || '').toLowerCase()
  if (PACKAGE_IDENTITY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'package_identity_required'
    }
  }
  if (WINRT_UNAVAILABLE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      backend_available: false,
      reason: 'winrt_ocr_unavailable'
    }
  }
  return {
    backend_available: false,
    reason: 'windows_media_ocr_unavailable'
  }
}

function resolveWindowsOcrProbeScriptPath({
  repoRoot = path.resolve(__dirname, '..', '..'),
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
} = {}) {
  if (resourcesPath) {
    return path.join(resourcesPath, 'windows', 'windows-media-ocr-probe.ps1')
  }
  return path.join(repoRoot, 'scripts', 'windows', 'windows-media-ocr-probe.ps1')
}

async function runWindowsOcrProbe({
  imagePath = '',
  scriptPath = resolveWindowsOcrProbeScriptPath(),
  timeoutMs = 30000
} = {}) {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      backend_available: false,
      reason: 'not_windows',
      message: 'Windows.Media.Ocr validation can only run on Windows.'
    }
  }

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ]
  if (imagePath) {
    args.push('-ImagePath', imagePath)
  }

  try {
    const result = await execFileAsync('powershell.exe', args, {
      maxBuffer: 1024 * 1024 * 10,
      timeout: timeoutMs,
      windowsHide: true
    })
    return {
      ...parseProbeJson(result.stdout),
      exit_code: 0,
      stderr: String(result.stderr || '').trim()
    }
  } catch (error) {
    if (error?.stdout) {
      try {
        return {
          ...parseProbeJson(error.stdout),
          exit_code: typeof error.code === 'number' ? error.code : 1,
          stderr: String(error.stderr || '').trim()
        }
      } catch (_) {
        // Fall through to the structured process failure below.
      }
    }

    const message = error?.killed
      ? `Windows OCR probe timed out after ${timeoutMs}ms.`
      : error?.message || String(error)
    const classification = error?.killed
      ? { backend_available: false, reason: 'timeout' }
      : classifyWindowsOcrFailure(`${message}\n${error?.stderr || ''}`)
    return {
      ok: false,
      ...classification,
      message,
      exit_code: typeof error?.code === 'number' ? error.code : 1,
      stderr: String(error?.stderr || '').trim()
    }
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--image' && argv[index + 1]) {
      options.imagePath = argv[index + 1]
      index += 1
    } else if (arg === '--script' && argv[index + 1]) {
      options.scriptPath = argv[index + 1]
      index += 1
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1])
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeoutMs = Math.floor(parsed)
      }
      index += 1
    }
  }
  return options
}

async function main() {
  const result = await runWindowsOcrProbe(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error))
    process.exit(1)
  })
}

module.exports = {
  classifyWindowsOcrFailure,
  parseProbeJson,
  resolveWindowsOcrProbeScriptPath,
  runWindowsOcrProbe
}
