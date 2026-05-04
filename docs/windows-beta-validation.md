# Windows Beta Validation

Date: 2026-05-04

Run these checks from the repo root on a normal, non-admin Windows account:

```powershell
cd "C:\Users\saadi\Documents\New project"
```

Do not launch PowerShell as administrator. A UAC prompt, machine-wide install requirement, or admin-only workaround is a beta blocker.

## Build And Unit Checks

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dist:win
npm.cmd run validate:win-packaged-resources
```

`validate:win-packaged-resources` checks `dist\win-unpacked` for:

- `Familiar.exe`
- `resources\windows\windows-media-ocr-probe.ps1`
- `resources\windows\windows-ocr.ps1`
- `resources\windows\windows-foreground.ps1`
- `resources\rg.exe`
- `resources\rg.exe --version`
- structured JSON from the packaged OCR probe

An OCR probe result with `backend_available: false` is acceptable only when it returns structured JSON with a clear `reason`, such as `package_identity_required`, `winrt_ocr_unavailable`, or `ocr_language_pack_unavailable`.

## Unpacked No-Admin Launch Smoke

```powershell
$exe = Resolve-Path 'dist\win-unpacked\Familiar.exe'
$proc = Start-Process -FilePath $exe -ArgumentList '--open-settings' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
$running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($running) {
  Stop-Process -Id $proc.Id -Force
  Write-Output "unpacked-launch-smoke-ok pid=$($proc.Id)"
  exit 0
}
Write-Output "unpacked-launch-smoke-exited exitCode=$($proc.ExitCode)"
exit 1
```

Expected: Familiar starts without a UAC prompt and stays running for the smoke window.

## Portable No-Admin Smoke

```powershell
$version = node -p "require('./package.json').version"
$before = @(Get-Process -Name Familiar -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$portable = Resolve-Path "dist\Familiar $version.exe"
$proc = Start-Process -FilePath $portable -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 10
$after = @(Get-Process -Name Familiar -ErrorAction SilentlyContinue)
$new = @($after | Where-Object { $before -notcontains $_.Id })
$launcher = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
$ids = @()
if ($launcher) { $ids += $launcher.Id }
$ids += @($new | Select-Object -ExpandProperty Id)
$ids = @($ids | Select-Object -Unique)
foreach ($id in $ids) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
if ($new.Count -gt 0 -or $launcher) {
  Write-Output "portable-smoke-ok stopped=$($ids -join ',')"
  exit 0
}
Write-Output "portable-smoke-no-running-process launcherExitCode=$($proc.ExitCode)"
exit 1
```

Expected: the portable artifact launches from user space without a UAC prompt.

## NSIS Per-User Smoke

```powershell
$version = node -p "require('./package.json').version"
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$installDir = Join-Path $env:TEMP ('familiar-nsis-test-' + [guid]::NewGuid().ToString('N'))
$resolvedInstallDir = [System.IO.Path]::GetFullPath($installDir)
if (-not $resolvedInstallDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Output "nsis-smoke-unsafe-install-dir installDir=$resolvedInstallDir tempRoot=$tempRoot"
  exit 1
}
$installer = Resolve-Path "dist\Familiar Setup $version.exe"
$install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$resolvedInstallDir") -PassThru -Wait -WindowStyle Hidden
if ($install.ExitCode -ne 0) {
  Write-Output "nsis-install-failed exitCode=$($install.ExitCode) installDir=$resolvedInstallDir"
  exit 1
}
$exe = Join-Path $resolvedInstallDir 'Familiar.exe'
$probe = Join-Path $resolvedInstallDir 'resources\windows\windows-media-ocr-probe.ps1'
$ocr = Join-Path $resolvedInstallDir 'resources\windows\windows-ocr.ps1'
$foreground = Join-Path $resolvedInstallDir 'resources\windows\windows-foreground.ps1'
$rg = Join-Path $resolvedInstallDir 'resources\rg.exe'
$uninstaller = Join-Path $resolvedInstallDir 'Uninstall Familiar.exe'
$allExist = (Test-Path $exe) -and (Test-Path $probe) -and (Test-Path $ocr) -and (Test-Path $foreground) -and (Test-Path $rg)
if ($uninstaller -and (Test-Path $uninstaller)) {
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  $uninstallExit = $uninstall.ExitCode
} else {
  $uninstallExit = 'missing'
}
if ($resolvedInstallDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force -ErrorAction SilentlyContinue
}
$uninstallOk = $uninstallExit -eq 0
if ($allExist -and $uninstallOk) {
  Write-Output "nsis-smoke-ok installDir=$resolvedInstallDir uninstallExit=$uninstallExit"
  exit 0
}
Write-Output "nsis-smoke-failed resourcesOk=$allExist uninstallExit=$uninstallExit installDir=$resolvedInstallDir"
exit 1
```

Expected: silent install succeeds into the temp per-user directory, the required resources exist, and uninstall does not require elevation.

## OCR Probe Smoke

Development helper:

```powershell
node scripts\windows\validate-windows-ocr.js
```

Packaged helper:

```powershell
node scripts\windows\validate-windows-ocr.js --script dist\win-unpacked\resources\windows\windows-media-ocr-probe.ps1
```

Expected: structured JSON. `backend_available: true` means Windows.Media.Ocr works on this machine. `backend_available: false` with a clear `reason` means the app must keep running and leave OCR work paused/unavailable instead of crashing.

## Foreground Metadata Smoke

```powershell
node -e "const { runWindowsForeground } = require('./src/ocr/windows-foreground'); runWindowsForeground({ platform: 'win32', scriptPath: 'dist\\\\win-unpacked\\\\resources\\\\windows\\\\windows-foreground.ps1' }).then((result) => { console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1); }).catch((error) => { console.error(error); process.exit(1); });"
```

Expected in an interactive desktop session: `ok: true` with the current foreground process name and window title when available. A structured `foreground_unavailable`, `timeout`, or `invalid_json` result must not crash recording; with blacklisted apps configured, capture should fail closed and skip the still.

## Packaged RG Redaction Smoke

```powershell
$env:FAMILIAR_RG_BINARY = (Resolve-Path 'dist\win-unpacked\resources\rg.exe').Path
node -e "const { scanAndRedactContent } = require('./src/security/rg-redaction'); scanAndRedactContent({ content: 'openai=sk-abcdefghijklmnopqrstuvwxyz123456' }).then((result) => { console.log(JSON.stringify({ redactionBypassed: result.redactionBypassed, content: result.content }, null, 2)); process.exit(!result.redactionBypassed && result.content.includes('[REDACTED:openai_sk]') ? 0 : 1); }).catch((error) => { console.error(error); process.exit(1); });"
$nodeExit = $LASTEXITCODE
Remove-Item Env:\FAMILIAR_RG_BINARY -ErrorAction SilentlyContinue
exit $nodeExit
```

Expected: `redactionBypassed: false` and the token replaced with `[REDACTED:openai_sk]`.

## Blacklisted-App Capture Privacy Expectations

Automated coverage:

```powershell
node --test test\capture-privacy.test.js test\screen-stills-capture-privacy.test.js test\screen-stills-recorder-recovery.test.js
```

Expected Windows behavior:

- If the detected foreground app matches a blacklisted app before capture, Familiar skips before source resolution, renderer startup, file write, and queue enqueue.
- If the foreground app becomes blacklisted after capture, Familiar discards the encoded bytes before file write and queue enqueue.
- If Windows foreground detection fails while blacklisted apps are configured, Familiar skips the still before capture work whenever the failure happens before capture.
- If no blacklisted apps are configured, foreground metadata failure is non-fatal and capture continues with null app/window metadata.

## Known Risks And Non-Goals

- Windows.Media.Ocr can be unavailable because of package identity, WinRT activation, OCR language pack, or OS policy issues. The beta requirement is structured unavailability and no crash, not guaranteed OCR on every machine.
- Windows foreground metadata is foreground-window only. Full visible-window enumeration and browser URL extraction are not part of this beta.
- Blacklisted-app capture privacy on Windows protects the detected foreground app and fails closed when detection fails with blacklist settings. It does not yet detect every non-foreground visible sensitive window.
- Corporate policy, SmartScreen, PowerShell execution restrictions, or blocked unpacked binaries can stop the portable or NSIS artifacts without involving UAC.
- If `rg.exe` is missing or blocked, redaction falls back to the existing warning path with `redactionBypassed: true`; that is non-crashing but not beta-ideal.
- No Windows settings UI was added in this phase.
