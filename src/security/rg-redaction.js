const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')

const {
  RULES,
  SSN_LABEL_REGEX
} = require('./rg-redaction-rules')

// Matches formatted (123-45-6789, 123 45 6789) AND bare (123456789)
// 9-digit sequences. Used only by the document-level SSN pass — bare
// 9-digit numbers on pages without any SSN label stay untouched, since
// they're overwhelmingly phone / account / order numbers.
const SSN_DOC_NUMBER_REGEX = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g
const SSN_DOC_REDACTION_ID = 'us_ssn_page_contextual'

const applyDocumentLevelSsnRedaction = (content) => {
  if (!SSN_LABEL_REGEX.test(content)) {
    return { content, findings: 0 }
  }
  let findings = 0
  const next = content.replace(SSN_DOC_NUMBER_REGEX, (match) => {
    if (match.includes('[REDACTED:')) return match
    findings += 1
    return `[REDACTED:${SSN_DOC_REDACTION_ID}]`
  })
  return { content: next, findings }
}

// PEM private-key blocks span many lines, so the line-by-line JS pass
// in redactLine can never catch them. This pre-pass runs against the
// whole document and collapses every BEGIN…END PRIVATE KEY block to a
// single sentinel. Covers RSA/EC/DSA/OPENSSH/PKCS8/ENCRYPTED/PGP.
const PEM_PRIVATE_KEY_REGEX = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----/g
const PEM_REDACTION_ID = 'pem_private_key'

const applyDocumentLevelPemRedaction = (content) => {
  let findings = 0
  const next = content.replace(PEM_PRIVATE_KEY_REGEX, () => {
    findings += 1
    return `[REDACTED:${PEM_REDACTION_ID}]`
  })
  return { content: next, findings }
}

const RG_WARNING_CODE = 'rg-redaction-unavailable'
const DROP_REASON_PAYMENT_KEYWORD_AND_CARD_NUMBER = 'payment-keyword-and-card-number'
const DROP_REASON_CRYPTO_SEED_PHRASE = 'crypto-seed-phrase'

function noop () {}

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

const getRgBinaryName = ({ platform, arch } = {}) => {
  if (platform === 'win32') {
    return 'rg.exe'
  }

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'rg-darwin-arm64'
    }
    if (arch === 'x64') {
      return 'rg-darwin-x64'
    }
  }

  return ''
}

const resolveExecutableInvocation = ({ executablePath, args = [] } = {}) => {
  if (process.platform === 'win32' && typeof executablePath === 'string' && /\.js$/i.test(executablePath)) {
    return {
      command: process.execPath,
      args: [executablePath, ...args]
    }
  }

  return {
    command: executablePath,
    args
  }
}

const resolveRgBinaryPath = async ({
  platform = process.platform,
  arch = process.arch,
  repoRoot = path.resolve(__dirname, '..', '..'),
  resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
  logger = console
} = {}) => {
  const envOverride = process.env.FAMILIAR_RG_BINARY
  if (envOverride && (await fileExists(envOverride))) {
    return envOverride
  }

  const binaryName = getRgBinaryName({ platform, arch })
  if (!binaryName) {
    logger.warn('RG redaction unsupported platform or architecture', {
      platform,
      arch
    })
    return ''
  }

  if (resourcesPath) {
    const packagedCandidates = platform === 'win32'
      ? [
          path.join(resourcesPath, binaryName),
          path.join(resourcesPath, 'rg', binaryName)
        ]
      : [path.join(resourcesPath, 'rg', binaryName)]

    for (const packagedCandidate of packagedCandidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await fileExists(packagedCandidate)) {
        return packagedCandidate
      }
    }
  }

  const legacyRepoRoot = path.resolve(__dirname, '..', '..', '..', '..')
  const devCandidates = [
    path.join(repoRoot, 'scripts', 'bin', 'rg', binaryName),
    path.join(legacyRepoRoot, 'code', 'desktopapp', 'scripts', 'bin', 'rg', binaryName)
  ].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index)

  for (const devCandidate of devCandidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(devCandidate)) {
      return devCandidate
    }
  }

  logger.warn('RG redaction binary not found', {
    env: envOverride || null,
    resourcesPath: resourcesPath || null,
    devCandidates,
    platform,
    arch
  })

  return ''
}

const normalizeContent = (content) => String(content).replace(/\r\n?/g, '\n')

const collectCandidateLineIndexes = async ({ rgBinaryPath, content }) => {
  const args = [
    '--json',
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '--multiline'
  ]
  for (const rule of RULES) {
    args.push('-e', rule.rgPattern)
  }
  args.push('-')

  return await new Promise((resolve, reject) => {
    const invocation = resolveExecutableInvocation({ executablePath: rgBinaryPath, args })
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      reject(new Error(`Failed to start rg redaction scanner: ${error.message}`))
    })

    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`rg redaction scanner terminated by signal: ${signal}`))
        return
      }

      if (code !== 0 && code !== 1) {
        reject(
          new Error(`rg redaction scanner failed with exit code ${code}. stderr: ${stderr.trim()}`)
        )
        return
      }

      const candidateLineIndexes = new Set()
      const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)

      for (const line of lines) {
        let event
        try {
          event = JSON.parse(line)
        } catch (error) {
          reject(new Error(`Failed parsing rg JSON event: ${error.message}`))
          return
        }

        if (event.type !== 'match') {
          continue
        }

        const lineNumber = event?.data?.line_number
        if (typeof lineNumber === 'number' && lineNumber > 0) {
          const lineText = event?.data?.lines?.text
          if (typeof lineText === 'string' && lineText.length > 0) {
            const normalizedLineText = lineText.endsWith('\n')
              ? lineText.slice(0, -1)
              : lineText
            const matchedLineCount = Math.max(1, normalizedLineText.split('\n').length)
            for (let offset = 0; offset < matchedLineCount; offset += 1) {
              candidateLineIndexes.add(lineNumber - 1 + offset)
            }
          } else {
            candidateLineIndexes.add(lineNumber - 1)
          }
        }
      }

      resolve(candidateLineIndexes)
    })

    child.stdin.end(content)
  })
}

const maskValueAfterSeparator = ({ matchText, ruleId }) => {
  const separatorIndex = matchText.search(/[:=]/)
  if (separatorIndex < 0) {
    return `[REDACTED:${ruleId}]`
  }

  const beforeSeparator = matchText.slice(0, separatorIndex + 1)
  const remainder = matchText.slice(separatorIndex + 1)
  const leadingWhitespace = (remainder.match(/^\s*/) || [''])[0]
  const trimmedRemainder = remainder.slice(leadingWhitespace.length)

  if (!trimmedRemainder) {
    return `${beforeSeparator}${leadingWhitespace}[REDACTED:${ruleId}]`
  }

  const openingQuote = trimmedRemainder[0] === '"' || trimmedRemainder[0] === "'"
    ? trimmedRemainder[0]
    : ''
  const trailingQuote = openingQuote && trimmedRemainder.endsWith(openingQuote)
    ? openingQuote
    : ''

  if (!openingQuote) {
    const trailingWhitespace = (trimmedRemainder.match(/\s*$/) || [''])[0]
    return `${beforeSeparator}${leadingWhitespace}[REDACTED:${ruleId}]${trailingWhitespace}`
  }

  return `${beforeSeparator}${leadingWhitespace}${openingQuote}[REDACTED:${ruleId}]${trailingQuote}`
}

const shouldSkipMatch = (matchText) => {
  const upper = String(matchText).toUpperCase()
  if (upper.includes('[REDACTED:')) {
    return true
  }
  return false
}

const redactLine = ({ line, compiledRules }) => {
  if (!line) {
    return {
      redactedLine: line,
      findings: 0,
      ruleCounts: {},
      matchedRuleCounts: {},
      matchedDropCategories: {}
    }
  }

  let redactedLine = line
  let findings = 0
  const ruleCounts = {}
  const matchedRuleCounts = {}
  const matchedDropCategories = {}

  for (const { id, regex, maskStrategy, action, dropCategory } of compiledRules) {
    redactedLine = redactedLine.replace(regex, (matchText) => {
      if (shouldSkipMatch(matchText)) {
        return matchText
      }

      matchedRuleCounts[id] = (matchedRuleCounts[id] || 0) + 1
      if (action === 'drop' && dropCategory) {
        matchedDropCategories[dropCategory] = (matchedDropCategories[dropCategory] || 0) + 1
      }

      if (action !== 'redact') {
        return matchText
      }

      findings += 1
      ruleCounts[id] = (ruleCounts[id] || 0) + 1

      if (maskStrategy === 'value_after_separator') {
        return maskValueAfterSeparator({ matchText, ruleId: id })
      }
      return `[REDACTED:${id}]`
    })
  }

  return {
    redactedLine,
    findings,
    ruleCounts,
    matchedRuleCounts,
    matchedDropCategories
  }
}

const compileRules = () =>
  RULES.map((rule) => ({
    id: rule.id,
    action: rule.action || 'redact',
    dropCategory: typeof rule.dropCategory === 'string' ? rule.dropCategory : '',
    maskStrategy: rule.maskStrategy,
    regex: new RegExp(rule.jsPattern, rule.jsFlags)
  }))

const scanAndRedactContent = async ({
  content,
  fileType = 'text',
  fileIdentifier = '',
  onRedactionWarning = noop
} = {}) => {
  if (typeof content !== 'string') {
    throw new Error('RG redaction expected string content.')
  }

  const rawNormalizedContent = normalizeContent(content)
  const pemPass = applyDocumentLevelPemRedaction(rawNormalizedContent)
  const ssnPass = applyDocumentLevelSsnRedaction(pemPass.content)
  const normalizedContent = ssnPass.content
  const compiledRules = compileRules()

  // Starter accumulators include whatever the doc-level passes found.
  // Every return path rolls these in so the caller's counts stay accurate.
  const buildInitialCounts = () => {
    const ruleCounts = {}
    const matchedRuleCounts = {}
    let findings = 0
    if (pemPass.findings > 0) {
      ruleCounts[PEM_REDACTION_ID] = pemPass.findings
      matchedRuleCounts[PEM_REDACTION_ID] = pemPass.findings
      findings += pemPass.findings
    }
    if (ssnPass.findings > 0) {
      ruleCounts[SSN_DOC_REDACTION_ID] = ssnPass.findings
      matchedRuleCounts[SSN_DOC_REDACTION_ID] = ssnPass.findings
      findings += ssnPass.findings
    }
    return { findings, ruleCounts, matchedRuleCounts }
  }

  const rgBinaryPath = await resolveRgBinaryPath()
  if (!rgBinaryPath) {
    const warning = {
      code: RG_WARNING_CODE,
      fileType,
      fileIdentifier,
      message: 'RG binary unavailable for redaction. Saving content without redaction.'
    }
    onRedactionWarning(warning)
    const initial = buildInitialCounts()
    return {
      content: normalizedContent,
      findings: initial.findings,
      ruleCounts: initial.ruleCounts,
      matchedRuleCounts: initial.matchedRuleCounts,
      matchedDropCategories: {},
      dropContent: false,
      dropReason: null,
      redactionBypassed: true
    }
  }

  let candidateLineIndexes = null
  let lastError = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      candidateLineIndexes = await collectCandidateLineIndexes({
        rgBinaryPath,
        content: normalizedContent
      })
      break
    } catch (error) {
      lastError = error
      console.warn('RG redaction scan attempt failed', {
        attempt,
        fileType,
        fileIdentifier,
        error: error?.message || error
      })
    }
  }

  if (!candidateLineIndexes) {
    const warning = {
      code: RG_WARNING_CODE,
      fileType,
      fileIdentifier,
      message: 'RG redaction scan failed after retry. Saving content without redaction.',
      error: lastError?.message || String(lastError || '')
    }
    onRedactionWarning(warning)
    const initial = buildInitialCounts()
    return {
      content: normalizedContent,
      findings: initial.findings,
      ruleCounts: initial.ruleCounts,
      matchedRuleCounts: initial.matchedRuleCounts,
      matchedDropCategories: {},
      dropContent: false,
      dropReason: null,
      redactionBypassed: true
    }
  }

  if (candidateLineIndexes.size === 0) {
    const initial = buildInitialCounts()
    return {
      content: normalizedContent,
      findings: initial.findings,
      ruleCounts: initial.ruleCounts,
      matchedRuleCounts: initial.matchedRuleCounts,
      matchedDropCategories: {},
      dropContent: false,
      dropReason: null,
      redactionBypassed: false
    }
  }

  const lines = normalizedContent.split('\n')
  const initial = buildInitialCounts()
  let findings = initial.findings
  const ruleCounts = { ...initial.ruleCounts }
  const matchedRuleCounts = { ...initial.matchedRuleCounts }
  const matchedDropCategories = {}

  for (const lineIndex of candidateLineIndexes) {
    if (lineIndex < 0 || lineIndex >= lines.length) {
      continue
    }

    const result = redactLine({
      line: lines[lineIndex],
      compiledRules
    })

    lines[lineIndex] = result.redactedLine
    findings += result.findings

    for (const [ruleId, count] of Object.entries(result.ruleCounts)) {
      ruleCounts[ruleId] = (ruleCounts[ruleId] || 0) + count
    }
    for (const [ruleId, count] of Object.entries(result.matchedRuleCounts || {})) {
      matchedRuleCounts[ruleId] = (matchedRuleCounts[ruleId] || 0) + count
    }
    for (const [category, count] of Object.entries(result.matchedDropCategories || {})) {
      matchedDropCategories[category] = (matchedDropCategories[category] || 0) + count
    }
  }

  const seedPhraseDrop = (matchedDropCategories.crypto_seed_keyword || 0) > 0
  const paymentDrop = (matchedDropCategories.payment_keyword || 0) > 0 &&
    (matchedDropCategories.payment_card_number || 0) > 0
  const dropContent = seedPhraseDrop || paymentDrop
  let dropReason = null
  if (seedPhraseDrop) {
    dropReason = DROP_REASON_CRYPTO_SEED_PHRASE
  } else if (paymentDrop) {
    dropReason = DROP_REASON_PAYMENT_KEYWORD_AND_CARD_NUMBER
  }

  return {
    content: lines.join('\n'),
    findings,
    ruleCounts,
    matchedRuleCounts,
    matchedDropCategories,
    dropContent,
    dropReason,
    redactionBypassed: false
  }
}

module.exports = {
  RG_WARNING_CODE,
  DROP_REASON_PAYMENT_KEYWORD_AND_CARD_NUMBER,
  DROP_REASON_CRYPTO_SEED_PHRASE,
  RULES,
  SSN_DOC_REDACTION_ID,
  PEM_REDACTION_ID,
  normalizeContent,
  resolveRgBinaryPath,
  scanAndRedactContent,
  redactLine,
  maskValueAfterSeparator,
  shouldSkipMatch,
  collectCandidateLineIndexes,
  applyDocumentLevelSsnRedaction,
  applyDocumentLevelPemRedaction,
  resolveExecutableInvocation
}
