#!/usr/bin/env node

const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '..')
const BIN_DIR = path.join(__dirname, 'bin', 'rg')
const WINDOWS_RG_DEST = path.join(BIN_DIR, 'rg.exe')
const RG_VERSION = process.env.FAMILIAR_RG_VERSION || '14.1.1'
const WINDOWS_ARCHIVE_ARCH_BY_NODE_ARCH = Object.freeze({
  x64: 'x86_64-pc-windows-msvc',
  arm64: 'aarch64-pc-windows-msvc'
})
const WINDOWS_SOURCE_ENV_BY_NODE_ARCH = Object.freeze({
  x64: 'FAMILIAR_RG_WINDOWS_X64_SOURCE',
  arm64: 'FAMILIAR_RG_WINDOWS_ARM64_SOURCE'
})

const runDarwinBuild = () => {
  const scriptPath = path.join(__dirname, 'build-rg-bundle.sh')
  const result = spawnSync('bash', [scriptPath], {
    stdio: 'inherit',
    cwd: ROOT_DIR
  })

  if (result.error) {
    console.error(`Failed to run rg bundle build: ${result.error.message}`)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

const fileExists = (candidatePath) => {
  try {
    return fs.statSync(candidatePath).isFile()
  } catch (_) {
    return false
  }
}

const validateRgBinary = (binaryPath) => {
  const result = spawnSync(binaryPath, ['--version'], {
    stdio: 'ignore',
    windowsHide: true
  })
  return !result.error && result.status === 0
}

const copyRgBinary = ({ sourcePath, targetPath }) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
}

const findFileByName = ({ dirPath, fileName }) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return entryPath
    }
    if (entry.isDirectory()) {
      const found = findFileByName({ dirPath: entryPath, fileName })
      if (found) {
        return found
      }
    }
  }
  return ''
}

const downloadFile = ({ url, destination, redirectsRemaining = 5 }) =>
  new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location &&
        redirectsRemaining > 0
      ) {
        response.resume()
        const nextUrl = new URL(response.headers.location, url).toString()
        downloadFile({
          url: nextUrl,
          destination,
          redirectsRemaining: redirectsRemaining - 1
        }).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`))
        return
      }

      const file = fs.createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => {
        file.close(resolve)
      })
      file.on('error', reject)
    })

    request.on('error', reject)
  })

const extractZip = ({ archivePath, destinationDir }) => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      archivePath,
      destinationDir
    ],
    {
      stdio: 'inherit',
      windowsHide: true
    }
  )

  if (result.error) {
    throw new Error(`Failed to extract rg archive: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`Failed to extract rg archive; PowerShell exited ${result.status}`)
  }
}

const downloadWindowsRgBinary = async ({ targetPath, archiveArch }) => {
  const archiveName = `ripgrep-${RG_VERSION}-${archiveArch}.zip`
  const archiveUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${archiveName}`
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'familiar-rg-'))
  const archivePath = path.join(tempDir, archiveName)
  const extractDir = path.join(tempDir, 'extract')

  try {
    fs.mkdirSync(extractDir, { recursive: true })
    console.error(`Downloading ${archiveUrl}`)
    await downloadFile({ url: archiveUrl, destination: archivePath })
    extractZip({ archivePath, destinationDir: extractDir })

    const extractedRgPath = findFileByName({ dirPath: extractDir, fileName: 'rg.exe' })
    if (!extractedRgPath) {
      throw new Error(`Failed to locate rg.exe inside ${archiveName}`)
    }

    copyRgBinary({ sourcePath: extractedRgPath, targetPath })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const getWindowsSourceOverride = (arch) => {
  const archSpecificEnvName = WINDOWS_SOURCE_ENV_BY_NODE_ARCH[arch] || ''
  return (
    process.env.FAMILIAR_RG_WINDOWS_SOURCE ||
    (archSpecificEnvName ? process.env[archSpecificEnvName] : '') ||
    ''
  )
}

const runWindowsBuild = async () => {
  const archiveArch = WINDOWS_ARCHIVE_ARCH_BY_NODE_ARCH[process.arch]
  if (!archiveArch) {
    console.log(`Skipping bundled rg build (unsupported Windows architecture: ${process.arch}).`)
    return
  }

  const sourceOverride = getWindowsSourceOverride(process.arch)
  if (sourceOverride) {
    copyRgBinary({ sourcePath: sourceOverride, targetPath: WINDOWS_RG_DEST })
  } else if (!fileExists(WINDOWS_RG_DEST)) {
    await downloadWindowsRgBinary({
      targetPath: WINDOWS_RG_DEST,
      archiveArch
    })
  }

  if (!fileExists(WINDOWS_RG_DEST)) {
    throw new Error(`Missing Windows rg.exe at ${WINDOWS_RG_DEST}`)
  }

  if (!validateRgBinary(WINDOWS_RG_DEST)) {
    throw new Error(`Invalid Windows rg.exe at ${WINDOWS_RG_DEST}`)
  }

  console.error(`Windows rg bundle ready (version ${RG_VERSION}): ${WINDOWS_RG_DEST}`)
}

const main = async () => {
  if (process.platform === 'darwin') {
    runDarwinBuild()
    return
  }

  if (process.platform === 'win32') {
    await runWindowsBuild()
    return
  }

  console.log('Skipping bundled rg build (macOS and Windows only).')
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
