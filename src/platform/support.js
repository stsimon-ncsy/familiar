const SUPPORTED_DESKTOP_PLATFORMS = new Set(['darwin', 'win32'])

const isSupportedDesktopPlatform = (platform = process.platform) =>
  SUPPORTED_DESKTOP_PLATFORMS.has(platform)

const shouldInitializeRecordingForPlatform = ({
  platform = process.platform,
  isE2E = false
} = {}) => isSupportedDesktopPlatform(platform) || isE2E === true

module.exports = {
  SUPPORTED_DESKTOP_PLATFORMS,
  isSupportedDesktopPlatform,
  shouldInitializeRecordingForPlatform
}
