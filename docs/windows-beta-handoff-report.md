# Windows Beta Handoff Report

Date: 2026-05-04 01:13:43 -04:00

## Environment

- Workspace: `C:\Users\saadi\Documents\New project`
- Branch: `windows-port-from-fork`
- OS: Microsoft Windows NT 10.0.22000.0
- Account: normal user account, not an administrator PowerShell session
- Node: `v24.11.0`
- npm: `11.6.1`
- Windows PowerShell: `5.1.22000.2538`

Codex sandbox note: the first sandboxed focused `node --test` attempt failed with Windows child-process `spawn EPERM`. Validation commands that spawn test workers, Electron, PowerShell, or packaged binaries were rerun outside the sandbox from the same workspace. No admin/UAC workaround was used.

## Artifacts

- Unpacked app: `dist\win-unpacked\Familiar.exe`
- Portable beta artifact: `dist\Familiar 0.0.67.exe` (`104240359` bytes)
- NSIS installer: `dist\Familiar Setup 0.0.67.exe` (`104466765` bytes)
- NSIS blockmap: `dist\Familiar Setup 0.0.67.exe.blockmap`
- Packaged Windows helpers:
  - `dist\win-unpacked\resources\windows\windows-media-ocr-probe.ps1`
  - `dist\win-unpacked\resources\windows\windows-ocr.ps1`
  - `dist\win-unpacked\resources\windows\windows-foreground.ps1`
  - `dist\win-unpacked\resources\rg.exe`

## Package Configuration

Confirmed through `package.json` inspection and `test\packaging-architectures.test.js`:

- Windows targets: `portable`, `nsis`
- Windows requested execution level: `asInvoker`
- NSIS `perMachine`: `false`
- NSIS `allowElevation`: `false`
- NSIS `allowToChangeInstallationDirectory`: `true`
- Required Windows helper and `rg.exe` resources are configured under `build.win.extraResources`.

## Commands Run

- `node --test test\packaging-architectures.test.js test\windows-packaged-resources-validation.test.js`
  - Initial sandbox attempt: failed with `spawn EPERM`.
  - Outside sandbox result: `14` passing, `0` failing.
- `npm.cmd test`
  - Result: `381` tests, `375` passing, `6` skipped.
- `npm.cmd run dist:win`
  - Result: exit `0`; produced portable, NSIS, and `dist\win-unpacked` artifacts.
  - Note: emitted the existing Node `DEP0190` shell-args deprecation warning from packaging tooling.
- `npm.cmd run validate:win-packaged-resources`
  - Result: `ok`.
  - Required files: all present.
  - `rg.exe --version`: `ripgrep 15.1.0 (rev af60c2de9d)`.
  - OCR probe: structured JSON, `backend_available=true`, `reason=ok`.
- `dist\win-unpacked\Familiar.exe --open-settings` launch smoke
  - Result: `unpacked-launch-smoke-ok pid=27232`.
- `dist\Familiar 0.0.67.exe` portable smoke
  - Result: `portable-smoke-ok stopped=30676,5780,29648,32560`.
- `dist\Familiar Setup 0.0.67.exe` silent per-user temp install/uninstall smoke
  - Result: `nsis-smoke-ok`.
  - Install dir: `C:\Users\saadi\AppData\Local\Temp\familiar-nsis-test-dd0f23f0c6bc4b2d939810ef776a90f7`.
  - Uninstall exit: `0`.
- `node scripts\windows\validate-windows-ocr.js --script dist\win-unpacked\resources\windows\windows-media-ocr-probe.ps1`
  - Result: `ok`, `backend_available=true`, `reason=ok`.
  - Recognized line: `Familiar OCR probe 123`.
- Packaged foreground metadata smoke using `dist\win-unpacked\resources\windows\windows-foreground.ps1`
  - Result: `ok`.
  - Foreground window: `name=Codex`, `title=Codex`, `pid=17660`, `bundleId=null`, `active=true`.
- Packaged `rg.exe` redaction smoke
  - Result: `redactionBypassed=false`.
  - Output content: `openai=[REDACTED:openai_sk]`.
- `node --test test\capture-privacy.test.js test\screen-stills-capture-privacy.test.js test\screen-stills-recorder-recovery.test.js`
  - Result: `26` passing, `0` failing.

## No-Admin Result

The no-admin beta path is validated on this Windows machine:

- The packaged app is configured for `asInvoker`.
- NSIS is configured as per-user with elevation disabled.
- Unpacked launch, portable launch, and silent NSIS per-user install/uninstall all completed without an observed UAC prompt.
- The NSIS smoke installed only under `%TEMP%`, verified the install path was inside `%TEMP%`, then removed it after uninstall.

This does not prove that SmartScreen, corporate policy, endpoint protection, or PowerShell restrictions will allow the artifacts on every beta machine.

## Runtime Helper Results

- OCR: packaged probe returned `backend_available=true` and recognized `Familiar OCR probe 123`.
- Foreground metadata: packaged helper returned the active Codex foreground window in the current interactive desktop session.
- Redaction: packaged `rg.exe` was runnable and redacted an OpenAI-key fixture with no bypass.
- Blacklisted-app privacy: focused automated tests confirmed pre-capture skip, post-capture byte discard, and fail-closed behavior when Windows foreground detection fails while blacklisted apps are configured.

## Known Risks

- Windows.Media.Ocr may be unavailable on other machines because of package identity, WinRT activation, missing OCR language packs, OS version, or policy restrictions. The beta requirement remains structured unavailability and no crash.
- Windows foreground metadata is foreground-window only. Full visible-window enumeration and browser URL extraction remain non-goals for this beta.
- Windows blacklisted-app capture privacy protects the detected foreground app and fails closed when detection fails with blacklist settings. It does not yet detect every non-foreground visible sensitive window.
- Corporate policy, SmartScreen, PowerShell execution restrictions, endpoint protection, or blocked unpacked helper binaries can still stop portable or NSIS artifacts without involving UAC.
- If packaged `rg.exe` is missing or blocked on a beta machine, redaction remains non-crashing but uses the warning/bypass path with `redactionBypassed: true`.
- No Windows settings UI or Windows CI was added.

## Recommendation

Go for a focused no-admin Windows beta handoff on this build. Run `docs\windows-beta-validation.md` on each target beta machine and record machine-specific OCR, foreground metadata, redaction, SmartScreen, and policy results before widening the beta.
