const fs = require('node:fs/promises')
const {
  dirnamePathLike,
  joinPathLike,
  parsePathLike
} = require('./path-style')

const buildExtractionPath = (inputPath) => {
  if (!inputPath) {
    return inputPath
  }

  const parsed = parsePathLike(inputPath)
  if (!parsed.ext) {
    return `${inputPath}-extraction.md`
  }

  return joinPathLike(parsed.dir, `${parsed.name}-extraction.md`)
}

const writeExtractionFile = async ({ imagePath, markdown }) => {
  if (!imagePath) {
    throw new Error('Image path is required for extraction output.')
  }

  const outputPath = buildExtractionPath(imagePath)
  await fs.mkdir(dirnamePathLike(outputPath), { recursive: true })
  const payload = markdown.endsWith('\n') ? markdown : `${markdown}\n`
  await fs.writeFile(outputPath, payload, 'utf-8')
  return outputPath
}

module.exports = {
  buildExtractionPath,
  writeExtractionFile
}
