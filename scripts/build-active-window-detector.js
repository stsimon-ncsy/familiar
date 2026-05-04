#!/usr/bin/env node

const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'darwin') {
  console.log('Skipping active-window detector helper build (macOS only).')
  process.exit(0)
}

const scriptPath = path.join(__dirname, 'build-list-on-screen-apps-helper.sh')
const result = spawnSync('bash', [scriptPath], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..')
})

if (result.error) {
  console.error(`Failed to run active-window detector build: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
