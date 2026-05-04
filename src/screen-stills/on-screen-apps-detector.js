const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeAppString, unionStringLists } = require('../utils/strings');
const {
  resolveWindowsForegroundScriptPath,
  runWindowsForeground
} = require('../ocr/windows-foreground');

const execFileAsync = promisify(execFile);

const DEFAULT_MIN_VISIBLE_AREA = 3000;
const DEFAULT_ARGS = ['--json', '--min-visible-area', String(DEFAULT_MIN_VISIBLE_AREA)];
const FILE_EXISTS_OPTIONS = fs.constants.F_OK;
const E2E_VISIBLE_WINDOWS_ENV_KEY = 'FAMILIAR_E2E_VISIBLE_WINDOWS_JSON';

const fileExists = async (candidatePath) => {
  if (!candidatePath) {
    return false;
  }
  try {
    await fs.promises.access(candidatePath, FILE_EXISTS_OPTIONS);
    return true;
  } catch (_error) {
    return false;
  }
};

const normalizeWindowCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const name = normalizeAppString(candidate.name, '');
  const bundleId = normalizeAppString(candidate.bundleId, null);
  const title = normalizeAppString(candidate.title, '');
  const active = candidate.active === true;
  const pid = Number.isFinite(candidate.pid) ? Number(candidate.pid) : null;

  if (!name && !bundleId && !title) {
    return null;
  }

  return { name, bundleId, title, pid, active };
};

const resolveActiveWindowBinaryPath = async ({ logger = console } = {}) => {
  const envOverride = process.env.FAMILIAR_LIST_ON_SCREEN_APPS_BINARY;
  if (await fileExists(envOverride)) {
    return envOverride;
  }

  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (resourcesPath) {
    const packagedCandidate = path.join(resourcesPath, 'list-on-screen-apps-helper');
    if (await fileExists(packagedCandidate)) {
      return packagedCandidate;
    }
  }

  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const desktopAppCandidate = path.join(
    repoRoot,
    'code',
    'desktopapp',
    'scripts',
    'bin',
    'list-on-screen-apps-helper'
  );
  if (await fileExists(desktopAppCandidate)) {
    return desktopAppCandidate;
  }

  const devCandidate = path.join(
    repoRoot,
    'scripts',
    'bin',
    'list-on-screen-apps-helper'
  );
  if (await fileExists(devCandidate)) {
    return devCandidate;
  }

  logger.warn('list-on-screen-apps helper binary not found', {
    env: envOverride || null,
    resourcesPath: resourcesPath || null,
    desktopAppCandidate,
    devCandidate
  });
  return '';
};

const extractVisibleWindowNames = (windows) => {
  if (!Array.isArray(windows)) {
    return [];
  }

  const seen = new Set();
  const names = [];

  for (const candidate of windows) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const name = candidate.name;
    if (typeof name !== 'string' || name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
};

const parseWindowList = (value) => {
  if (!value || typeof value !== 'string') {
    return [];
  }

  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map(normalizeWindowCandidate)
    .filter((candidate) => candidate !== null);
};

const readVisibleWindowsOverride = ({ logger = console } = {}) => {
  const raw = process.env[E2E_VISIBLE_WINDOWS_ENV_KEY];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn('Ignoring invalid visible windows override; expected array payload.');
      return [];
    }
    return parsed
      .map(normalizeWindowCandidate)
      .filter((candidate) => candidate !== null);
  } catch (error) {
    logger.warn('Ignoring invalid visible windows override JSON', {
      error: error?.message || String(error)
    });
    return [];
  }
};

const runWindowList = async ({ binaryPath, args = DEFAULT_ARGS, logger = console }) => {
  if (!binaryPath) {
    throw new Error('list-on-screen-apps helper binary path required.');
  }

  const resolvedArgs = Array.isArray(args) && args.length > 0 ? args : DEFAULT_ARGS;
  const { stdout } = await execFileAsync(binaryPath, resolvedArgs, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });

  const windows = parseWindowList(stdout);
  if (!Array.isArray(windows)) {
    logger.warn('Unexpected on-screen app helper output format', {
      outputType: typeof stdout
    });
    return [];
  }

  return windows;
};

const pickActiveWindow = (windows) => {
  const candidate = windows.find((window) => window?.active === true);
  if (candidate) {
    return candidate;
  }

  return null;
};

const isSameActiveWindow = (leftWindow, rightWindow) => {
  return (
    normalizeAppString(leftWindow?.bundleId, null) === normalizeAppString(rightWindow?.bundleId, null) &&
    normalizeAppString(leftWindow?.name, null) === normalizeAppString(rightWindow?.name, null) &&
    normalizeAppString(leftWindow?.title, null) === normalizeAppString(rightWindow?.title, null)
  );
};

const detectWindowSnapshot = async ({ activeWindowDetector: detector } = {}) => {
  let candidates = [];
  if (typeof detector?.detectWindowCandidates === 'function') {
    candidates = await detector.detectWindowCandidates();
  } else if (typeof detector?.detectActiveWindow === 'function') {
    const activeWindow = await detector.detectActiveWindow();
    candidates = activeWindow ? [activeWindow] : [];
  }

  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  return {
    visibleWindows: safeCandidates,
    visibleWindowNames: extractVisibleWindowNames(safeCandidates),
    activeWindow: pickActiveWindow(safeCandidates)
  };
};

const buildVisibleWindowCandidateKey = (window) => {
  if (!window || typeof window !== 'object') {
    return '';
  }
  return [
    normalizeAppString(window.bundleId, ''),
    normalizeAppString(window.name, ''),
    normalizeAppString(window.title, ''),
    Number.isFinite(window.pid) ? String(window.pid) : '',
    window.active === true ? 'active' : 'inactive'
  ].join('|');
};

const unionVisibleWindows = (left = [], right = []) => {
  const seen = new Set();
  const merged = [];
  const values = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];

  for (const value of values) {
    const key = buildVisibleWindowCandidateKey(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(value);
  }

  return merged;
};

const resolveCaptureAppContext = ({ beforeSnapshot, afterSnapshot, logger } = {}) => {
  const beforeWindow = beforeSnapshot?.activeWindow || null;
  const afterWindow = afterSnapshot?.activeWindow || null;
  const visibleWindows = unionVisibleWindows(beforeSnapshot?.visibleWindows, afterSnapshot?.visibleWindows);
  const beforeVisibleWindowNames = beforeSnapshot?.visibleWindowNames;
  const afterVisibleWindowNames = afterSnapshot?.visibleWindowNames;
  const unchanged = isSameActiveWindow(beforeWindow, afterWindow);
  if (!unchanged && logger && typeof logger.warn === 'function') {
    logger.warn('Active window changed between pre/post still capture detection', {
      beforeAppName: beforeWindow?.name || null,
      afterAppName: afterWindow?.name || null
    });
  }
  const activeWindow = unchanged ? (afterWindow || beforeWindow) : null;
  const appName = normalizeAppString(activeWindow?.name, null);
  const appBundleId = normalizeAppString(activeWindow?.bundleId, null);
  const appTitle = normalizeAppString(activeWindow?.title, null);
  const appLabelSource = unchanged && afterWindow ? 'after' : unchanged && beforeWindow ? 'before' : null;

  const missingFieldValues = [];
  if (appName === null) {
    missingFieldValues.push('appName');
  }
  if (appBundleId === null) {
    missingFieldValues.push('appBundleId');
  }
  if (appTitle === null) {
    missingFieldValues.push('appTitle');
  }

  if (logger && typeof logger.warn === 'function' && activeWindow && missingFieldValues.length > 0) {
    logger.warn('Active window metadata contained missing values after normalization', {
      missingFieldValues,
      beforeWindow: beforeWindow || null,
      afterWindow: afterWindow || null
    });
  }

  return {
    appName,
    appBundleId,
    appTitle,
    appLabelSource,
    visibleWindows,
    visibleWindowNames: unionStringLists(beforeVisibleWindowNames, afterVisibleWindowNames)
  };
};

const createActiveWindowDetector = (options = {}) => {
  const {
    logger = console,
    platform = process.platform,
    resolveBinaryPathImpl = resolveActiveWindowBinaryPath,
    runWindowListImpl = runWindowList,
    resolveWindowsForegroundScriptPathImpl = resolveWindowsForegroundScriptPath,
    runWindowsForegroundImpl = runWindowsForeground
  } = options;
  const hasWindowListOverride =
    Object.prototype.hasOwnProperty.call(options, 'resolveBinaryPathImpl') ||
    Object.prototype.hasOwnProperty.call(options, 'runWindowListImpl');
  const useWindowsForeground = platform === 'win32' && !hasWindowListOverride;
  let binaryPathPromise = null;

  const resolveBinaryPathOnce = async () => {
    if (!binaryPathPromise) {
      binaryPathPromise = useWindowsForeground
        ? Promise.resolve(resolveWindowsForegroundScriptPathImpl({ logger }))
        : resolveBinaryPathImpl({ logger });
    }
    return binaryPathPromise;
  };

  const detectActiveWindow = async () => {
    const windows = await detectWindowCandidates();
    const candidate = pickActiveWindow(windows);
    if (!candidate) {
      throw new Error('No active window detected from helper output.');
    }

    return candidate;
  };

  const detectWindowCandidates = async () => {
    const overrideCandidates = readVisibleWindowsOverride({ logger });
    if (overrideCandidates !== null) {
      return overrideCandidates;
    }

    const binaryPath = await resolveBinaryPathOnce();
    if (!binaryPath) {
      if (useWindowsForeground) {
        const error = new Error('Windows foreground helper path unavailable.');
        error.metadataUnavailable = true;
        error.reason = 'missing_windows_foreground_helper';
        throw error;
      }
      throw new Error(
        'list-on-screen-apps helper missing; build it and ensure it is shipped with the app.'
      );
    }

    if (useWindowsForeground) {
      const result = await runWindowsForegroundImpl({ scriptPath: binaryPath, platform, logger });
      if (!result?.ok || !result?.window) {
        const error = new Error(result?.message || 'Windows foreground metadata unavailable.');
        error.metadataUnavailable = true;
        error.reason = result?.reason || 'foreground_unavailable';
        throw error;
      }
      const candidate = normalizeWindowCandidate(result.window);
      return candidate ? [candidate] : [];
    }

    return runWindowListImpl({ binaryPath, logger, args: DEFAULT_ARGS });
  };

  const detectVisibleWindowNames = async () => {
    const candidates = await detectWindowCandidates();
    return extractVisibleWindowNames(candidates);
  };

  return {
    detectActiveWindow,
    detectWindowCandidates,
    detectVisibleWindowNames,
    metadataFailureIsNonFatal: useWindowsForeground,
    supportsWindowMetadata: useWindowsForeground || platform === 'darwin' || hasWindowListOverride,
    resolveBinaryPath: resolveBinaryPathOnce
  };
};

module.exports = {
  DEFAULT_ARGS,
  extractVisibleWindowNames,
  createActiveWindowDetector,
  DEFAULT_MIN_VISIBLE_AREA,
  parseWindowList,
  pickActiveWindow,
  resolveActiveWindowBinaryPath,
  runWindowList,
  isSameActiveWindow,
  detectWindowSnapshot,
  resolveCaptureAppContext,
  unionVisibleWindows,
  readVisibleWindowsOverride
};
