const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const scriptPath = path.join(__dirname, '..', 'scripts', 'rebuild-for-electron.js')

const runScriptWithPlatform = ({ platform = 'win32', spawnResult = { status: 0 } } = {}) => {
  const calls = []
  const exits = []
  const source = fs.readFileSync(scriptPath, 'utf-8')
  const sandbox = {
    console: {
      error: () => {}
    },
    process: {
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe'
      },
      exit: (code) => {
        exits.push(code)
        throw Object.assign(new Error('process.exit'), { code })
      },
      platform
    },
    require: (request) => {
      if (request === 'node:child_process') {
        return {
          spawnSync: (...args) => {
            calls.push(args)
            return spawnResult
          }
        }
      }
      if (request === '../package.json') {
        return {
          devDependencies: {
            electron: '^40.0.0'
          }
        }
      }
      return require(request)
    }
  }

  try {
    vm.runInNewContext(source, sandbox, { filename: scriptPath })
  } catch (error) {
    if (error?.message !== 'process.exit') {
      throw error
    }
  }

  return { calls, exits }
}

test('rebuild-for-electron invokes npm through cmd.exe on Windows', () => {
  const { calls, exits } = runScriptWithPlatform({ platform: 'win32' })

  assert.equal(exits[0], 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(Array.from(calls[0][1]), [
    '/d',
    '/s',
    '/c',
    'npm.cmd rebuild better-sqlite3 --build-from-source'
  ])
  assert.equal(calls[0][2].env.npm_config_runtime, 'electron')
  assert.equal(calls[0][2].env.npm_config_target, '40.0.0')
  assert.equal(calls[0][2].env.npm_config_disturl, 'https://electronjs.org/headers')
})
