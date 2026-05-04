#!/usr/bin/env node

const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { runWindowsOcrProbe } = require('./validate-windows-ocr')

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_UNPACKED_DIR = path.join(REPO_ROOT, 'dist', 'win-unpacked')
const DEFAULT_TIMEOUT_MS = 30000

const REQUIRED_PACKAGED_RESOURCES = Object.freeze([
  {
    label: 'Familiar executable',
    relativePath: 'Familiar.exe'
  },
  {
    label: 'Windows.Media.Ocr probe helper',
    relativePath: path.join('resources', 'windows', 'windows-media-ocr-probe.ps1')
  },
  {
    label: 'Windows OCR helper',
    relativePath: path.join('resources', 'windows', 'windows-ocr.ps1')
  },
  {
    label: 'Windows foreground helper',
    relativePath: path.join('resources', 'windows', 'windows-foreground.ps1')
  },
  {
    label: 'bundled rg.exe',
    relativePath: path.join('resources', 'rg.exe')
  }
])

const fileExists = async (candidatePath) => {
  try {
    const stats = await fs.stat(candidatePath)
    return stats.isFile()
  } catch (_) {
    return false
  }
}

const normalizeUnpackedDir = (unpackedDir) => path.resolve(unpackedDir || DEFAULT_UNPACKED_DIR)

const validatePackagedResourcePaths = async ({
  unpackedDir = DEFAULT_UNPACKED_DIR,
  fileExistsImpl = fileExists
} = {}) => {
  const resolvedUnpackedDir = normalizeUnpackedDir(unpackedDir)
  const checks = []

  for (const resource of REQUIRED_PACKAGED_RESOURCES) {
    const absolutePath = path.join(resolvedUnpackedDir, resource.relativePath)
    // eslint-disable-next-line no-await-in-loop
    const exists = await fileExistsImpl(absolutePath)
    checks.push({
      ...resource,
      absolutePath,
      exists
    })
  }

  const missing = checks
    .filter((entry) => !entry.exists)
    .map(({ label, relativePath, absolutePath }) => ({
      label,
      relativePath,
      absolutePath
    }))

  return {
    ok: missing.length === 0,
    unpackedDir: resolvedUnpackedDir,
    checks,
    missing
  }
}

const hasStructuredOcrProbeResult = (result) =>
  !!result &&
  typeof result === 'object' &&
  typeof result.backend_available === 'boolean' &&
  typeof result.reason === 'string' &&
  result.reason.length > 0

const validateRgVersion = async ({
  rgPath,
  execFileImpl = execFileAsync,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  if (!rgPath) {
    return {
      ok: false,
      reason: 'missing_rg_path',
      message: 'Packaged rg.exe path is missing.'
    }
  }

  try {
    const result = await execFileImpl(rgPath, ['--version'], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    })
    const version = String(result?.stdout || '').split(/\r?\n/)[0].trim()
    return {
      ok: true,
      reason: 'ok',
      path: rgPath,
      version: version || 'unknown',
      stderr: String(result?.stderr || '').trim()
    }
  } catch (error) {
    return {
      ok: false,
      reason: error?.killed ? 'timeout' : 'rg_version_failed',
      path: rgPath,
      message: error?.killed
        ? `Packaged rg.exe --version timed out after ${timeoutMs}ms.`
        : error?.message || String(error),
      exit_code: typeof error?.code === 'number' ? error.code : 1,
      stderr: String(error?.stderr || '').trim()
    }
  }
}

const validateOcrProbe = async ({
  scriptPath,
  runWindowsOcrProbeImpl = runWindowsOcrProbe,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  if (!scriptPath) {
    return {
      ok: false,
      reason: 'missing_probe_path',
      message: 'Packaged Windows OCR probe helper path is missing.'
    }
  }

  try {
    const result = await runWindowsOcrProbeImpl({
      scriptPath,
      timeoutMs
    })

    if (!hasStructuredOcrProbeResult(result)) {
      return {
        ok: false,
        reason: 'invalid_probe_result',
        path: scriptPath,
        message: 'Packaged Windows OCR probe did not return structured JSON.',
        result
      }
    }

    return {
      ok: true,
      reason: result.reason,
      path: scriptPath,
      backend_available: result.backend_available,
      result
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'probe_failed',
      path: scriptPath,
      message: error?.message || String(error)
    }
  }
}

const getCheckByRelativePath = (pathResult, relativePath) =>
  pathResult.checks.find((entry) => entry.relativePath === relativePath) || null

const validatePackagedResources = async ({
  unpackedDir = DEFAULT_UNPACKED_DIR,
  platform = process.platform,
  fileExistsImpl = fileExists,
  execFileImpl = execFileAsync,
  runWindowsOcrProbeImpl = runWindowsOcrProbe,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  skipRuntimeChecks = platform !== 'win32'
} = {}) => {
  const paths = await validatePackagedResourcePaths({
    unpackedDir,
    fileExistsImpl
  })

  const rgRelativePath = path.join('resources', 'rg.exe')
  const probeRelativePath = path.join('resources', 'windows', 'windows-media-ocr-probe.ps1')
  const rgCheck = getCheckByRelativePath(paths, rgRelativePath)
  const probeCheck = getCheckByRelativePath(paths, probeRelativePath)

  let rg = {
    ok: true,
    skipped: true,
    reason: 'runtime_checks_skipped',
    path: rgCheck?.absolutePath || ''
  }
  let ocrProbe = {
    ok: true,
    skipped: true,
    reason: 'runtime_checks_skipped',
    path: probeCheck?.absolutePath || ''
  }

  if (!skipRuntimeChecks) {
    rg = rgCheck?.exists
      ? await validateRgVersion({
        rgPath: rgCheck.absolutePath,
        execFileImpl,
        timeoutMs
      })
      : {
          ok: false,
          reason: 'missing_rg_resource',
          path: rgCheck?.absolutePath || '',
          message: 'Packaged rg.exe is missing.'
        }

    ocrProbe = probeCheck?.exists
      ? await validateOcrProbe({
        scriptPath: probeCheck.absolutePath,
        runWindowsOcrProbeImpl,
        timeoutMs
      })
      : {
          ok: false,
          reason: 'missing_probe_resource',
          path: probeCheck?.absolutePath || '',
          message: 'Packaged Windows OCR probe helper is missing.'
        }
  }

  return {
    ok: paths.ok && rg.ok && ocrProbe.ok,
    platform,
    runtime_checks_skipped: skipRuntimeChecks,
    paths,
    rg,
    ocrProbe
  }
}

const parseArgs = (argv) => {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--unpacked-dir' && argv[index + 1]) {
      options.unpackedDir = argv[index + 1]
      index += 1
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1])
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeoutMs = Math.floor(parsed)
      }
      index += 1
    } else if (arg === '--skip-runtime-checks') {
      options.skipRuntimeChecks = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }
  return options
}

const formatSummary = (result) => {
  const lines = [
    'Windows packaged resource validation',
    `Unpacked dir: ${result.paths.unpackedDir}`,
    ''
  ]

  for (const check of result.paths.checks) {
    lines.push(`${check.exists ? '[ok]' : '[missing]'} ${check.relativePath}`)
  }

  lines.push('')
  if (result.runtime_checks_skipped) {
    lines.push('[skipped] Runtime checks skipped.')
  } else {
    lines.push(
      result.rg.ok
        ? `[ok] rg.exe --version: ${result.rg.version}`
        : `[failed] rg.exe --version: ${result.rg.message || result.rg.reason}`
    )
    lines.push(
      result.ocrProbe.ok
        ? `[ok] OCR probe structured JSON: backend_available=${result.ocrProbe.backend_available} reason=${result.ocrProbe.reason}`
        : `[failed] OCR probe structured JSON: ${result.ocrProbe.message || result.ocrProbe.reason}`
    )
  }

  lines.push('')
  lines.push(result.ok ? 'Result: ok' : 'Result: failed')
  return lines.join('\n')
}

const printHelp = () => {
  console.log([
    'Usage: node scripts/windows/validate-packaged-resources.js [options]',
    '',
    'Options:',
    '  --unpacked-dir <path>      Path to dist/win-unpacked',
    '  --timeout-ms <ms>          Runtime check timeout in milliseconds',
    '  --skip-runtime-checks      Only validate required packaged files',
    '  --json                    Print structured JSON',
    '  -h, --help                Show this help'
  ].join('\n'))
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const result = await validatePackagedResources(options)
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatSummary(result))
  }

  process.exitCode = result.ok ? 0 : 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error))
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_UNPACKED_DIR,
  REQUIRED_PACKAGED_RESOURCES,
  fileExists,
  formatSummary,
  hasStructuredOcrProbeResult,
  parseArgs,
  validateOcrProbe,
  validatePackagedResources,
  validatePackagedResourcePaths,
  validateRgVersion
}
