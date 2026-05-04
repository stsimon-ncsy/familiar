# Windows Port Audit

Date: 2026-05-04

## Scope

This note covers Phase 0, Phase 1, the Phase 1A OCR validation spike, Phase 2 Windows OCR extractor work, Phase 3 Windows foreground metadata, Phase 4 Windows capture privacy hardening, Phase 5 Windows `rg.exe` redaction bundling, Phase 6 Windows beta readiness hardening, and Phase 7 Windows beta handoff validation for porting Familiar to Windows. The JTLR `windows-support` branch is a reference implementation only; do not merge the fork wholesale.

## Refs Compared

- Upstream: `familiar-software/familiar@main` at `eeae7e56637203a44ed615685c92de1a14f2209e`.
- Reference fork: `JTLR/familiar@windows-support` at `86d2f0d`.
- Merge base: `490fe52aa80a06a47fe6038bc151cba2ace845f5`.
- GitHub issue: <https://github.com/familiar-software/familiar/issues/24>.
- GitHub compare reports the fork is 11 commits ahead and 205 commits behind current upstream main.

## Current Upstream Shape

- Current upstream has the newer React dashboard under `src/dashboard/components/**`; the fork replaces this with an older non-React dashboard, so fork UI files should not be copied.
- Current upstream has privacy/redaction modules under `src/security/**`, capture privacy under `src/screen-stills/capture-privacy.js`, storage cleanup under `src/storage/**`, installed-app helpers, harness adapters, logs IPC, and newer tray/update behavior that the fork predates or deletes.
- Build config is in `package.json` under `build`. Before this port, macOS helpers were configured as top-level `extraResources`, which would make Windows packaging look for macOS-only helper outputs.
- Package metadata currently uses MIT in `package.json` and the root `LICENSE`. The fork changes license metadata and adds `COMMERCIAL_LICENSE.md`; do not transplant those license/package metadata changes.

## Useful Fork Changes

Files or ideas to transplant carefully:

- `src/ocr/windows-ocr.js` and `src/ocr/windows-ocr.ps1`: useful Windows.Media.Ocr PowerShell approach, JSON contract, timeout idea, control-character sanitization, and packaged-resource requirement.
- `src/ocr/windows-foreground.js` and `src/ocr/windows-foreground.ps1`: useful foreground metadata reference for a later phase.
- `src/screen-stills/windows-ocr-extractor.js`: useful extractor shape, but must be rewritten against current upstream extractor/worker contracts.
- `src/screen-capture/permissions.js`: useful Windows permission no-op/granted behavior.
- `package.json`: useful Windows `win`/`nsis` packaging direction, but must preserve upstream scripts, React build, MIT metadata, and current mac resources.
- `scripts/rebuild-for-electron.js` and `scripts/build-apple-vision-ocr.js`: useful cross-platform wrapper pattern.

## Fork Changes To Rewrite Or Avoid

- Avoid all fork dashboard files. Current upstream uses React and has newer settings/onboarding architecture.
- Avoid copying fork `src/main.js` wholesale; upstream main has newer recording-off reminders, cleanup scheduling, redaction warnings, launch intent, and IPC wiring.
- Avoid copying fork settings wholesale; upstream settings now persist storage cleanup and capture privacy.
- Avoid fork package-lock/license changes.
- Treat fork browser URL extraction as unproven. For first beta, return `url: null` / `url_source: unavailable` unless a reliable implementation is added later.

## Current Build Scripts

- macOS distribution scripts currently build Apple Vision OCR, active-window detector, bundled `rg`, Tailwind CSS, and Electron Builder mac artifacts.
- Development scripts run helper builds before start/dev. These need Node wrappers so Windows shells can skip macOS-only helpers without needing `bash`.
- Unit tests currently need a cross-platform test runner instead of shelling through Unix `find`/`xargs`.

## Phase 1 Build Plan

- Keep macOS behavior and helper resources under `build.mac.extraResources`.
- Add Windows Electron Builder targets:
  - `portable` for no-install beta testing.
  - `nsis` for per-user install.
- Configure NSIS as:
  - `oneClick: false`
  - `perMachine: false`
  - `allowElevation: false`
  - `allowToChangeInstallationDirectory: true`
- Set Windows requested execution level to `asInvoker`.
- Add scripts:
  - `dist:win`
  - `dist:win:portable`
  - `dist:win:nsis`
- Allow the main app to start on `win32`, create a tray, open settings, and initialize the existing capture controller without macOS-only permission prompts.
- Keep default Windows storage under user-writable app data. Settings should prefer `%APPDATA%\Familiar`; default context storage should prefer `%LOCALAPPDATA%\familiar`.

## Phase 1A OCR Validation Plan

First implementation target is Phase 1 plus an OCR validation spike, not the full OCR extractor.

- Add a minimal PowerShell 5.1 `Windows.Media.Ocr` probe at `scripts/windows/windows-media-ocr-probe.ps1`.
- Add a Node harness at `scripts/windows/validate-windows-ocr.js`.
- Package the probe as `extraResources` so it can be run from development, unpacked/portable, and NSIS-installed builds.
- The probe must return structured JSON and treat package identity or WinRT activation errors as backend-unavailable results.
- The probe must not request admin, change execution policy globally, or introduce UAC prompts.

## OCR / Package Identity Risk

`Windows.Media.Ocr` may fail without package identity on some Windows systems. That is not an administrator-privilege problem. If the probe reports `APPMODEL_ERROR_NO_PACKAGE`, `E_ILLEGAL_METHOD_CALL`, WinRT activation failures, missing `Windows.Media.Ocr`, or package-identity-required messages, the backend should be marked unavailable and the app should keep running. Acceptable next backend paths are:

- bundled local OCR engine for portable/no-admin distribution
- MSIX or sparse package identity
- native C# / C++ / Rust helper
- Windows App SDK OCR backend

## Known Risks

- Windows `rg.exe` is now bundled for development and Windows packages. If the binary is missing or cannot be spawned, redaction still uses the existing explicit warning path and saves content with `redactionBypassed: true` instead of crashing.
- Windows foreground metadata is implemented via a foreground-only helper. Blacklisted-app capture privacy is fail-safe for the detected foreground app, but full visible-window enumeration and browser URL extraction are still not implemented.
- Corporate policy, PowerShell restrictions, execution restrictions on unpacked helper binaries, or SmartScreen can block portable/NSIS artifacts even without UAC.

## Proposed Commit Stack

1. Add this audit and Windows port plan.
2. Add Windows build targets and Node wrappers for macOS-only helper steps.
3. Add portable and per-user NSIS packaging config.
4. Add OCR validation harness and document probe results.
5. Add `windows_ocr` extractor and packaged PowerShell helper.
6. Add foreground metadata helper and markdown frontmatter fields.
7. Add Windows blacklisted-app capture privacy hardening and tests.
8. Bundle and validate Windows `rg.exe` for redaction parity.
9. Later: add Windows settings UI.
10. Later: add Windows CI and beta docs.

## OCR Validation Result

Development checkout result: yes, `Windows.Media.Ocr` works from PowerShell 5.1 without admin on this Windows machine.

Command:

```powershell
node scripts/windows/validate-windows-ocr.js
```

Exit code: `0`

Result:

```json
{
  "ok": true,
  "backend_available": true,
  "reason": "ok",
  "ocr_engine": "windows_media_ocr",
  "image_width": 520,
  "image_height": 160,
  "line_count": 1,
  "lines": ["Familiar OCR probe 123"]
}
```

Direct PowerShell probe result: yes, also works without admin.

Command:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts\windows\windows-media-ocr-probe.ps1
```

Exit code: `0`

Packaged-resource probe result from `dist\win-unpacked`: yes, also works without admin.

Command:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File dist\win-unpacked\resources\windows\windows-media-ocr-probe.ps1
```

Exit code: `0`

Portable/no-admin remains viable on this machine for the PowerShell `Windows.Media.Ocr` backend. This is not proof that every clean Windows 10/11 machine will work; keep the backend-unavailable path for package identity, WinRT activation, and missing language-pack failures.

## Phase 1 Verification

- `npm.cmd install`: succeeded.
- `npm.cmd test`: succeeded with `336` passing and `7` skipped.
- `npm.cmd run dist:win:portable`: succeeded.
- `npm.cmd run dist:win:nsis`: succeeded.
- `npm.cmd run dist:win`: succeeded and produced both `dist\Familiar 0.0.67.exe` and `dist\Familiar Setup 0.0.67.exe`.
- Unpacked launch smoke: `dist\win-unpacked\Familiar.exe --open-settings` stayed running for the smoke window and was stopped.
- Portable artifact smoke: `dist\Familiar 0.0.67.exe` launched spawned Familiar processes without an observed UAC prompt; test processes were stopped.
- NSIS per-user smoke: silent install to `%TEMP%\familiar-nsis-test-*` succeeded, included `Familiar.exe` and `resources\windows\windows-media-ocr-probe.ps1`, and silent uninstall exited `0`.

## Phase 2 OCR Extractor Result

Phase 2 added a `windows_ocr` local extractor without changing macOS Apple Vision behavior or making cloud/LLM OCR the default.

- Added `src/ocr/windows-ocr.js` as the Node wrapper for `powershell.exe` plus JSON parsing, timeout handling, PowerShell control-character cleanup, helper path resolution, and backend-unavailable classification.
- Added `scripts/windows/windows-ocr.ps1` as the production Windows.Media.Ocr helper. It runs under Windows PowerShell 5.1, does not request elevation, and emits structured JSON for one or more images.
- Added `src/screen-stills/windows-ocr-extractor.js` for the current stills markdown worker contract.
- Added `windows_ocr` extractor selection. On Windows, local/default extraction resolves to `windows_ocr` when Windows OCR is available. On macOS, Apple Vision OCR remains the default. Existing `llm` settings are treated as non-default and normalize back to the local platform extractor.
- Packaged `scripts/windows/windows-ocr.ps1` via `build.win.extraResources` to `resources\windows\windows-ocr.ps1`, outside the asar.
- Windows OCR markdown uses `format: familiar-layout-v0` and includes:
  - `extractor: windows_ocr`
  - `ocr_engine: windows_media_ocr`
  - `platform: windows`
  - `image_width`
  - `image_height`
  - `timestamp`
  - `url: null`
  - `url_source: unavailable`
- Browser URL extraction, Windows foreground metadata, settings UI, exclusion ordering, and CI were not added in this phase.

Backend-unavailable behavior is explicit and non-crashing. The wrapper/extractor return no markdown result and mark/cache the backend unavailable for:

- `APPMODEL_ERROR_NO_PACKAGE`
- package identity required / no package identity
- `E_ILLEGAL_METHOD_CALL`
- WinRT activation failures, including PowerShell WinRT activation failures
- missing or unavailable `Windows.Media.Ocr`
- missing Windows OCR language pack
- timeout
- invalid helper JSON

The stills markdown worker continues to handle missing OCR results through its existing failed-row path instead of crashing the recorder or worker process.

## Phase 2 Verification

- Focused tests: `node --test test\stills-markdown-extractor-type-default.test.js test\windows-ocr.test.js test\windows-ocr-extractor.test.js test\packaging-architectures.test.js` succeeded with `22` passing.
- Full unit suite: `npm.cmd test` succeeded with `348` passing and `7` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded and produced portable plus NSIS artifacts.
- Packaged helper check: `dist\win-unpacked\resources\windows\windows-ocr.ps1` exists alongside `windows-media-ocr-probe.ps1`.
- Development helper smoke: `scripts\windows\windows-ocr.ps1` recognized `Familiar OCR probe 123` from a generated PNG and reported `backend_available: true`.
- Extractor smoke: `createWindowsOcrExtractor()` returned one markdown result for a generated PNG with recognized text and required `familiar-layout-v0` metadata.
- Packaged helper smoke: `dist\win-unpacked\resources\windows\windows-ocr.ps1` recognized `Familiar OCR probe 123` from a generated PNG and reported `backend_available: true`.

## Phase 3 Windows Foreground Metadata Result

Phase 3 added local Windows foreground-window metadata for still captures without adding browser URL extraction.

- Added `src/ocr/windows-foreground.js` as the Node wrapper for `powershell.exe`, helper path resolution, JSON parsing, timeout handling, control-character cleanup, and unavailable-result normalization.
- Added `scripts/windows/windows-foreground.ps1` as the production Win32 foreground helper. It calls `GetForegroundWindow`, `GetWindowText`, and `GetWindowThreadProcessId`, then reads the owning process name with `Get-Process`. It does not request elevation or change system execution policy.
- Packaged `scripts/windows/windows-foreground.ps1` via `build.win.extraResources` to `resources\windows\windows-foreground.ps1`, outside the asar.
- Integrated Windows foreground metadata through the existing `on-screen-apps-detector` boundary. On Windows, the default detector now returns at most one active foreground candidate with:
  - `name`: process name when available
  - `bundleId`: `null` because Windows has no macOS bundle id equivalent here
  - `title`: foreground window title when available
  - `pid`: owning process id when available
  - `active: true`
- The recorder now enables this detector on Windows and keeps using the existing before/after snapshot path. Stable before/after foreground metadata is stored in the stills queue as `app_name`, `app_title`, `app_label_source`, and `visible_window_names`.
- `windows_ocr` markdown now receives real `app`, `window_title_raw`, `window_title_norm`, `app_label_source`, and `visible_windows` fields from the existing queue path when foreground detection succeeds.
- Browser URL extraction remains intentionally disabled. Windows OCR markdown still emits `url: null` and `url_source: unavailable`.

Unavailable/failure behavior is non-crashing:

- Invalid foreground-helper JSON returns `reason: invalid_json` and `window: null`.
- Timeout returns `reason: timeout` and `window: null`.
- Missing helper path returns `reason: missing_windows_foreground_helper` and `window: null`.
- Helper process failure returns `reason: foreground_unavailable` and `window: null`.
- A Windows foreground helper failure is treated as missing metadata, not a recorder failure, when no blacklisted-app capture privacy rule is active. If blacklisted apps are configured and detection fails, the existing privacy-preserving skip behavior remains.
- macOS active-window behavior remains on the existing native `list-on-screen-apps-helper` path.

## Phase 3 Verification

- Red/focused test first run failed as expected for the missing foreground module, missing package resource, Windows detector still using the macOS helper path, and recorder optional-failure behavior.
- Focused tests: `node --test test\windows-foreground.test.js test\on-screen-apps-detector.test.js test\screen-stills-recorder-recovery.test.js test\packaging-architectures.test.js test\windows-ocr.test.js test\windows-ocr-extractor.test.js` succeeded with `45` passing.
- Full unit suite: `npm.cmd test` succeeded with `358` passing and `7` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded after stopping stale temp-launched `Familiar.exe` processes from the previous portable smoke that had locked the old artifact.
- Packaged helper check: `dist\win-unpacked\resources\windows\windows-foreground.ps1` exists.
- Development wrapper smoke: `runWindowsForeground({ platform: 'win32' })` returned `ok: true` with the current foreground window on this machine: `name: Codex`, `title: Codex`, `pid: 17660`, `bundleId: null`, `active: true`.
- Packaged wrapper smoke: `runWindowsForeground({ platform: 'win32', scriptPath: 'dist\\win-unpacked\\resources\\windows\\windows-foreground.ps1' })` returned the same foreground metadata.
- Direct PowerShell helper invocation from the sandboxed shell returned `foreground_unavailable` with `No foreground window handle was available`; the app path uses the Node wrapper, and the wrapper smoke succeeded when allowed to spawn PowerShell normally.

## Phase 4 Windows Capture Privacy Hardening Result

Phase 4 made Windows blacklisted-app capture behavior explicit, tested, and fail-safe using the Phase 3 foreground metadata path.

- The recorder now defers initial screen source thumbnail resolution and hidden renderer capture startup when blacklisted apps are configured. The first pre-capture foreground check runs before source resolution, renderer start, renderer capture, file write, or queue enqueue.
- The recorder tracks the renderer's active capture source separately from the last resolved screen source. If capture proceeds after the privacy pre-check, the renderer is started lazily; if the display/source changes later, the renderer capture source is restarted intentionally.
- A Windows pre-capture foreground match skips the still before source resolution, renderer startup/capture, write, and enqueue.
- A Windows post-capture foreground match drops the encoded bytes before any file write or queue enqueue.
- A Windows foreground detection failure or unavailable result with blacklisted apps configured skips the still before source resolution, renderer startup/capture, write, and enqueue.
- A Windows foreground detection failure or unavailable result with no blacklisted apps remains metadata-only: capture continues, the still is written/enqueued, and app/window metadata fields are `null` / empty.
- A successful Windows foreground detection with no blacklisted apps still stores `app_name`, `app_title`, `app_label_source`, and `visible_window_names` through the existing queue path.
- macOS active/visible-window privacy behavior remains on the existing detector path and stayed green in focused and full tests.
- Recorder and worker behavior remains non-crashing; privacy skips are ordinary skipped captures, not recorder failures.

Unavailable/failure behavior after Phase 4:

- With no blacklisted apps: Windows foreground metadata failure is non-fatal, capture continues, and queued metadata is null/empty.
- With blacklisted apps: Windows foreground metadata failure is privacy-sensitive, so capture is skipped before source/renderer work whenever the failure happens pre-capture.
- If the foreground app changes to a blacklisted app after capture, the in-memory encoded bytes are discarded before write/enqueue.

## Phase 4 Verification

- Red/focused test first run failed as expected: the new pre-capture ordering tests observed source/renderer startup before blacklist detection, and the post-capture test observed the old eager source-resolution count.
- Focused tests: `node --test test\capture-privacy.test.js test\screen-stills-capture-privacy.test.js test\screen-stills-recorder-recovery.test.js test\on-screen-apps-detector.test.js test\windows-foreground.test.js test\windows-ocr.test.js test\windows-ocr-extractor.test.js test\stills-markdown-worker.test.js test\stills-markdown-extractor-type-default.test.js` succeeded with `68` passing.
- Full unit suite: `npm.cmd test` succeeded with `364` passing and `7` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded and produced portable plus NSIS artifacts.

## Phase 5 Windows rg Redaction Bundling Result

Phase 5 made Windows OCR and clipboard markdown redaction use a local bundled `rg.exe` in development and packaged builds while preserving macOS `rg` behavior.

- `resolveRgBinaryPath()` now supports Windows as `rg.exe`, prefers `FAMILIAR_RG_BINARY`, then packaged `resources\rg.exe`, then development `scripts\bin\rg\rg.exe`.
- macOS lookup remains `resources\rg\rg-darwin-*` and `scripts\bin\rg\rg-darwin-*`, with the same architecture-specific binary names as before.
- `scripts/build-rg-bundle.js` now keeps the macOS shell-wrapper path on macOS and prepares Windows `scripts\bin\rg\rg.exe` on Windows. Windows builds can copy `FAMILIAR_RG_WINDOWS_SOURCE`, `FAMILIAR_RG_WINDOWS_X64_SOURCE`, or `FAMILIAR_RG_WINDOWS_ARM64_SOURCE`; otherwise they download the matching official ripgrep Windows zip.
- Windows `dist:win`, `dist:win:portable`, and `dist:win:nsis` now run `build:rg-bundle` before Electron Builder.
- Windows Electron Builder config packages `scripts\bin\rg\rg.exe` to `resources\rg.exe`.
- `scripts/bin/` is ignored as generated helper output; the build script recreates it.
- The rg parity test now checks the Windows bundled `rg.exe` when present and skips only when no usable env, bundled, or PATH rg can be spawned.

Unavailable/failure behavior after Phase 5:

- Missing `rg.exe`, unsupported platform/architecture, or scanner spawn/exit failures remain non-crashing.
- The redaction path still calls `onRedactionWarning` with `code: rg-redaction-unavailable`, returns normalized content, sets `redactionBypassed: true`, and lets clipboard/stills markdown callers log their existing "saved without redaction" warnings.
- Document-level redactions that do not depend on rg, such as PEM private-key blocks and page-scoped SSNs, still run before an rg scanner bypass.

## Phase 5 Verification

- Red/focused test first run failed as expected for the missing Windows resolver support, missing Windows package resource, Windows dist scripts not invoking `build:rg-bundle`, and missing Windows rg bundle wrapper behavior.
- `npm.cmd run build:rg-bundle` succeeded with `FAMILIAR_RG_WINDOWS_X64_SOURCE` pointed at the local rg source and produced `scripts\bin\rg\rg.exe`.
- Focused rg/package tests after bundling: `node --test test\rg-redaction-rule-parity.test.js test\rg-redaction.test.js test\packaging-architectures.test.js` succeeded with `27` passing and `0` skipped.
- Broader focused tests: `node --test test\rg-redaction.test.js test\rg-redaction-rule-parity.test.js test\packaging-architectures.test.js test\windows-ocr.test.js test\windows-ocr-extractor.test.js test\windows-ocr-validation.test.js test\stills-markdown-worker.test.js test\clipboard-storage.test.js` succeeded with `64` passing.
- Development redaction smoke outside the sandbox resolved `scripts\bin\rg\rg.exe`, redacted an API-key fixture, and returned `redactionBypassed: false`.
- Full unit suite: first `npm.cmd test` run hit one timing-sensitive recorder recovery failure; isolated `node --test test\screen-stills-recorder-recovery.test.js` then passed with `14` passing; a fresh second `npm.cmd test` succeeded with `369` passing and `6` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded and produced portable plus NSIS artifacts. The build emitted a Node deprecation warning from tooling but exited `0`.
- Packaged resource check: `dist\win-unpacked\resources\rg.exe` exists and `dist\win-unpacked\resources\rg.exe --version` succeeded.
- Packaged-resource redaction smoke outside the sandbox resolved `dist\win-unpacked\resources\rg.exe`, redacted a token fixture, and returned `redactionBypassed: false`.

## Phase 6 Windows Beta Readiness Hardening Result

Phase 6 added focused package/runtime smoke coverage and beta handoff documentation without changing the dashboard, settings UI, macOS helper paths, OCR backend behavior, foreground metadata behavior, capture privacy behavior, or redaction behavior.

- Added `scripts/windows/validate-packaged-resources.js` as a local/offline validator for `dist\win-unpacked`.
- Added `npm.cmd run validate:win-packaged-resources` for the packaged resource smoke.
- The validator checks:
  - `Familiar.exe`
  - `resources\windows\windows-media-ocr-probe.ps1`
  - `resources\windows\windows-ocr.ps1`
  - `resources\windows\windows-foreground.ps1`
  - `resources\rg.exe`
  - `resources\rg.exe --version`
  - structured JSON from the packaged OCR probe
- The OCR probe runtime check treats both available and known backend-unavailable results as valid structured behavior. Backend unavailability remains a non-crashing runtime state.
- Added `test/windows-packaged-resources-validation.test.js` for resource-path validation, `rg.exe --version` validation, structured backend-unavailable OCR probe output, and runtime failure reporting.
- Hardened `test/packaging-architectures.test.js` to keep the packaged-resource validation script available alongside the existing portable, NSIS, `asInvoker`, `allowElevation: false`, and required-resource assertions.
- Added `docs/windows-beta-validation.md` with exact local beta validation commands for build, packaged resources, unpacked launch, portable launch, NSIS per-user install/uninstall, OCR probe, foreground metadata, packaged rg redaction, and blacklisted-app capture privacy expectations.

## Phase 6 Verification

- Red/focused tests failed as expected before implementation:
  - `node --test test\windows-packaged-resources-validation.test.js` failed because `scripts/windows/validate-packaged-resources.js` did not exist.
  - `node --test test\packaging-architectures.test.js test\windows-packaged-resources-validation.test.js` failed because the package script and validator module did not exist.
- Focused tests: `node --test test\packaging-architectures.test.js test\windows-packaged-resources-validation.test.js test\windows-ocr-validation.test.js test\windows-ocr.test.js test\windows-ocr-extractor.test.js test\windows-foreground.test.js test\on-screen-apps-detector.test.js test\rg-redaction.test.js test\rg-redaction-rule-parity.test.js test\capture-privacy.test.js test\screen-stills-capture-privacy.test.js test\screen-stills-recorder-recovery.test.js test\stills-markdown-worker.test.js` succeeded with `100` passing.
- Full unit suite: `npm.cmd test` succeeded with `375` passing and `6` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded and produced `dist\Familiar 0.0.67.exe`, `dist\Familiar Setup 0.0.67.exe`, and `dist\win-unpacked`. The build emitted the existing Electron Builder/Node `DEP0190` shell-args deprecation warning but exited `0`.
- Packaged-resource validation: `npm.cmd run validate:win-packaged-resources` succeeded. All required files existed, `resources\rg.exe --version` returned `ripgrep 15.1.0 (rev af60c2de9d)`, and the packaged OCR probe returned structured JSON with `backend_available=true` and `reason=ok`.
- Unpacked no-admin launch smoke: `dist\win-unpacked\Familiar.exe --open-settings` stayed running for the smoke window and was stopped.
- Portable no-admin smoke: `dist\Familiar 0.0.67.exe` launched Familiar processes without an observed UAC prompt; test processes were stopped.
- NSIS per-user smoke: silent install to `%TEMP%\familiar-nsis-test-*` succeeded, included `Familiar.exe`, all three Windows PowerShell helpers, and `resources\rg.exe`; silent uninstall exited `0`; the temp install directory was removed.
- Packaged foreground helper smoke: `runWindowsForeground({ platform: 'win32', scriptPath: 'dist\\win-unpacked\\resources\\windows\\windows-foreground.ps1' })` returned `ok: true` with `name: Codex`, `title: Codex`, `pid: 17660`, `bundleId: null`, and `active: true`.
- Packaged rg redaction smoke: `scanAndRedactContent()` with `FAMILIAR_RG_BINARY=dist\win-unpacked\resources\rg.exe` redacted an OpenAI-key fixture and returned `redactionBypassed: false`.

## Phase 7 Windows Beta Handoff Validation Result

Phase 7 re-ran the documented Windows beta validation flow against current local artifacts and produced a standalone handoff report at `docs/windows-beta-handoff-report.md`. No Windows feature work or code/test changes were needed for this phase.

Package configuration remained in the intended no-admin beta shape:

- Windows targets are `portable` and `nsis`.
- Windows `requestedExecutionLevel` is `asInvoker`.
- NSIS `perMachine` is `false`.
- NSIS `allowElevation` is `false`.
- Required packaged resources are configured for `windows-media-ocr-probe.ps1`, `windows-ocr.ps1`, `windows-foreground.ps1`, and `rg.exe`.

## Phase 7 Verification

- Focused package/resource tests: first sandboxed attempt hit a Codex Windows child-process `spawn EPERM`; rerun outside the sandbox succeeded with `14` passing.
- Full unit suite: `npm.cmd test` succeeded with `381` tests, `375` passing, and `6` skipped.
- Windows distribution build: `npm.cmd run dist:win` succeeded and produced `dist\win-unpacked`, `dist\Familiar 0.0.67.exe`, and `dist\Familiar Setup 0.0.67.exe`. The build emitted the existing Node `DEP0190` shell-args deprecation warning but exited `0`.
- Packaged-resource validation: `npm.cmd run validate:win-packaged-resources` succeeded. All required files existed, `resources\rg.exe --version` returned `ripgrep 15.1.0 (rev af60c2de9d)`, and the packaged OCR probe returned structured JSON with `backend_available=true` and `reason=ok`.
- Unpacked no-admin launch smoke: `dist\win-unpacked\Familiar.exe --open-settings` stayed running for the smoke window and was stopped.
- Portable no-admin smoke: `dist\Familiar 0.0.67.exe` launched Familiar processes without an observed UAC prompt; test processes were stopped.
- NSIS per-user smoke: silent install to `%TEMP%\familiar-nsis-test-*` succeeded, included `Familiar.exe`, all three Windows PowerShell helpers, and `resources\rg.exe`; silent uninstall exited `0`; the temp install directory was removed after verifying it was under `%TEMP%`.
- Packaged OCR probe smoke: `node scripts\windows\validate-windows-ocr.js --script dist\win-unpacked\resources\windows\windows-media-ocr-probe.ps1` returned `backend_available=true`, `reason=ok`, and recognized `Familiar OCR probe 123`.
- Packaged foreground helper smoke: `runWindowsForeground({ platform: 'win32', scriptPath: 'dist\\win-unpacked\\resources\\windows\\windows-foreground.ps1' })` returned `ok: true` with `name: Codex`, `title: Codex`, `pid: 17660`, `bundleId: null`, and `active: true`.
- Packaged rg redaction smoke: `scanAndRedactContent()` with `FAMILIAR_RG_BINARY=dist\win-unpacked\resources\rg.exe` redacted an OpenAI-key fixture and returned `redactionBypassed: false`.
- Blacklisted-app privacy focused tests: `node --test test\capture-privacy.test.js test\screen-stills-capture-privacy.test.js test\screen-stills-recorder-recovery.test.js` succeeded with `26` passing.

## Remaining Windows Beta Risks

- Windows.Media.Ocr may still be unavailable on other Windows machines because of package identity, WinRT activation, missing OCR language packs, OS version, or policy restrictions. This phase validates structured/no-crash behavior and confirms availability on this machine, not universal backend availability.
- Windows foreground metadata remains foreground-window only. Full visible-window enumeration and browser URL extraction are still non-goals for this beta.
- Windows blacklisted-app capture privacy protects the detected foreground app and fails closed when detection fails with blacklist settings. It does not yet detect every non-foreground visible sensitive window.
- Corporate policy, SmartScreen, PowerShell restrictions, endpoint protection, or blocked unpacked binaries can still prevent portable or NSIS artifacts from running even though no UAC/admin path is required.
- If packaged `rg.exe` is missing or blocked on a beta machine, the app remains non-crashing but redaction uses the warning/bypass path with `redactionBypassed: true`.
- No Windows settings UI or Windows CI was added in this phase.

## Beta Handoff Status

Stop here for this phase. The portable and NSIS no-admin beta path is validated on this Windows machine by package config tests, a full Windows build, packaged-resource validation, hidden unpacked/portable launch smokes, an NSIS per-user install/uninstall smoke, packaged OCR/foreground/rg smokes, and focused blacklisted-app privacy tests. No additional implementation work remains before a focused no-admin Windows beta handoff, beyond running the beta validation doc on target beta machines and collecting machine-specific OCR/foreground/security-policy results.
