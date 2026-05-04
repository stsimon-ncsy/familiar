#!/usr/bin/env node

const { spawnSync } = require('node:child_process')

const { devDependencies = {} } = require('../package.json')

const electronVersion = String(devDependencies.electron || '').replace(/^[^\d]*/, '')
const npmArgs = ['rebuild', 'better-sqlite3', '--build-from-source']

const resolveNpmInvocation = () => {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm.cmd', ...npmArgs].join(' ')]
    }
  }

  return {
    command: 'npm',
    args: npmArgs
  }
}

if (!electronVersion) {
  console.error('Unable to determine Electron version from package.json.')
  process.exit(1)
}

const npmInvocation = resolveNpmInvocation()

const result = spawnSync(
  npmInvocation.command,
  npmInvocation.args,
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers'
    }
  }
)

if (result.error) {
  console.error(`Failed to rebuild better-sqlite3 for Electron: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
