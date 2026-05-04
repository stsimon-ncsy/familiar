const path = require('node:path')

const prefersPosixPath = (value) =>
  typeof value === 'string' && value.includes('/') && !value.includes('\\')

const getPathApiFor = (...values) =>
  values.some(prefersPosixPath) ? path.posix : path

const joinPathLike = (basePath, ...segments) =>
  getPathApiFor(basePath).join(basePath, ...segments)

const dirnamePathLike = (targetPath) =>
  getPathApiFor(targetPath).dirname(targetPath)

const parsePathLike = (targetPath) =>
  getPathApiFor(targetPath).parse(targetPath)

const relativePathLike = (fromPath, toPath) =>
  getPathApiFor(fromPath, toPath).relative(fromPath, toPath)

module.exports = {
  dirnamePathLike,
  getPathApiFor,
  joinPathLike,
  parsePathLike,
  prefersPosixPath,
  relativePathLike
}
