const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  REQUIRED_PACKAGED_RESOURCES,
  hasStructuredOcrProbeResult,
  validatePackagedResources,
  validatePackagedResourcePaths
} = require('../scripts/windows/validate-packaged-resources')

const unpackedDir = path.join('C:\\tmp', 'Familiar', 'win-unpacked')

const createFileExistsImpl = (relativePaths) => {
  const existing = new Set(
    relativePaths.map((relativePath) => path.normalize(path.join(unpackedDir, relativePath)))
  )
  return async (candidatePath) => existing.has(path.normalize(candidatePath))
}

test('validatePackagedResourcePaths requires Familiar.exe and Windows beta resources', async () => {
  const result = await validatePackagedResourcePaths({
    unpackedDir,
    fileExistsImpl: createFileExistsImpl(REQUIRED_PACKAGED_RESOURCES.map((entry) => entry.relativePath))
  })

  assert.equal(result.ok, true)
  assert.equal(result.missing.length, 0)
  assert.deepEqual(
    result.checks.map((entry) => entry.relativePath),
    [
      'Familiar.exe',
      path.join('resources', 'windows', 'windows-media-ocr-probe.ps1'),
      path.join('resources', 'windows', 'windows-ocr.ps1'),
      path.join('resources', 'windows', 'windows-foreground.ps1'),
      path.join('resources', 'rg.exe')
    ]
  )
})

test('validatePackagedResourcePaths reports missing package resources', async () => {
  const result = await validatePackagedResourcePaths({
    unpackedDir,
    fileExistsImpl: createFileExistsImpl([
      'Familiar.exe',
      path.join('resources', 'windows', 'windows-media-ocr-probe.ps1')
    ])
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.missing.map((entry) => entry.relativePath),
    [
      path.join('resources', 'windows', 'windows-ocr.ps1'),
      path.join('resources', 'windows', 'windows-foreground.ps1'),
      path.join('resources', 'rg.exe')
    ]
  )
})

test('validatePackagedResources accepts structured OCR probe backend-unavailable output', async () => {
  const result = await validatePackagedResources({
    unpackedDir,
    platform: 'win32',
    fileExistsImpl: createFileExistsImpl(REQUIRED_PACKAGED_RESOURCES.map((entry) => entry.relativePath)),
    execFileImpl: async (command, args) => {
      assert.equal(path.basename(command).toLowerCase(), 'rg.exe')
      assert.deepEqual(args, ['--version'])
      return { stdout: 'ripgrep 14.1.1\n', stderr: '' }
    },
    runWindowsOcrProbeImpl: async ({ scriptPath }) => {
      assert.equal(
        path.normalize(scriptPath),
        path.normalize(path.join(unpackedDir, 'resources', 'windows', 'windows-media-ocr-probe.ps1'))
      )
      return {
        ok: false,
        backend_available: false,
        reason: 'package_identity_required',
        message: 'APPMODEL_ERROR_NO_PACKAGE'
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.rg.ok, true)
  assert.equal(result.ocrProbe.ok, true)
  assert.equal(result.ocrProbe.backend_available, false)
  assert.equal(result.ocrProbe.reason, 'package_identity_required')
})

test('validatePackagedResources fails when rg.exe cannot run', async () => {
  const result = await validatePackagedResources({
    unpackedDir,
    platform: 'win32',
    fileExistsImpl: createFileExistsImpl(REQUIRED_PACKAGED_RESOURCES.map((entry) => entry.relativePath)),
    execFileImpl: async () => {
      throw new Error('spawn failed')
    },
    runWindowsOcrProbeImpl: async () => ({
      ok: true,
      backend_available: true,
      reason: 'ok'
    })
  })

  assert.equal(result.ok, false)
  assert.equal(result.rg.ok, false)
  assert.match(result.rg.message, /spawn failed/)
})

test('validatePackagedResources fails when OCR probe output is not structured JSON', async () => {
  const result = await validatePackagedResources({
    unpackedDir,
    platform: 'win32',
    fileExistsImpl: createFileExistsImpl(REQUIRED_PACKAGED_RESOURCES.map((entry) => entry.relativePath)),
    execFileImpl: async () => ({ stdout: 'ripgrep 14.1.1\n', stderr: '' }),
    runWindowsOcrProbeImpl: async () => ({
      ok: false,
      message: 'not structured'
    })
  })

  assert.equal(result.ok, false)
  assert.equal(result.ocrProbe.ok, false)
  assert.equal(result.ocrProbe.reason, 'invalid_probe_result')
})

test('hasStructuredOcrProbeResult accepts available and unavailable probe contracts', () => {
  assert.equal(hasStructuredOcrProbeResult({ backend_available: true, reason: 'ok' }), true)
  assert.equal(
    hasStructuredOcrProbeResult({
      ok: false,
      backend_available: false,
      reason: 'winrt_ocr_unavailable'
    }),
    true
  )
  assert.equal(hasStructuredOcrProbeResult({ ok: false, message: 'missing fields' }), false)
})
