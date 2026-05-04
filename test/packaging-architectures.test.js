const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');

test('package scripts build mac dist for both arm64 and x64', () => {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    assert.equal(
        packageJson.scripts['dist:mac'],
        'npm run clean && npm run build:apple-vision-ocr && npm run build:active-window-detector && npm run build:rg-bundle && npm run css:build && electron-builder --mac --arm64 --x64'
    );
    assert.equal(
        packageJson.scripts['dist:mac:arm64'],
        'npm run clean && npm run build:apple-vision-ocr && npm run build:active-window-detector && npm run build:rg-bundle && npm run css:build && electron-builder --mac --arm64'
    );
    assert.equal(
        packageJson.scripts['dist:mac:x64'],
        'npm run clean && npm run build:apple-vision-ocr && npm run build:active-window-detector && npm run build:rg-bundle && npm run css:build && electron-builder --mac --x64'
    );
});

test('Apple Vision OCR build script compiles universal helper', () => {
    const buildScriptPath = path.join(appRoot, 'scripts', 'build-apple-vision-ocr.sh');
    const script = fs.readFileSync(buildScriptPath, 'utf-8');

    assert.match(script, /-arch arm64/);
    assert.match(script, /-arch x86_64/);
    assert.match(script, /lipo -info/);
    assert.match(script, /for arch in arm64 x86_64/);
});

test('package includes bundled rg resources and build script', () => {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const macResources = Array.isArray(packageJson.build?.mac?.extraResources)
        ? packageJson.build.mac.extraResources
        : [];

    assert.equal(packageJson.scripts['build:rg-bundle'], 'node scripts/build-rg-bundle.js');
    assert.equal(
        macResources.some(
            (resource) =>
                resource.from === 'scripts/bin/familiar-ocr-helper' &&
                resource.to === 'familiar-ocr-helper'
        ),
        true
    );
    assert.equal(
        macResources.some((resource) => resource.from === 'scripts/bin/rg' && resource.to === 'rg'),
        true
    );
});

test('RG bundle script prepares binaries from official releases or env overrides', () => {
    const buildScriptPath = path.join(appRoot, 'scripts', 'build-rg-bundle.sh');
    const script = fs.readFileSync(buildScriptPath, 'utf-8');

    assert.match(script, /FAMILIAR_RG_VERSION/);
    assert.match(script, /github\.com\/BurntSushi\/ripgrep\/releases\/download/);
    assert.match(script, /FAMILIAR_RG_DARWIN_ARM64_SOURCE/);
    assert.match(script, /FAMILIAR_RG_DARWIN_X64_SOURCE/);
});

test('RG bundle node wrapper prepares Windows rg.exe from official releases or env overrides', () => {
    const buildScriptPath = path.join(appRoot, 'scripts', 'build-rg-bundle.js');
    const script = fs.readFileSync(buildScriptPath, 'utf-8');

    assert.match(script, /FAMILIAR_RG_VERSION/);
    assert.match(script, /FAMILIAR_RG_WINDOWS_X64_SOURCE/);
    assert.match(script, /FAMILIAR_RG_WINDOWS_ARM64_SOURCE/);
    assert.match(script, /github\.com\/BurntSushi\/ripgrep\/releases\/download/);
    assert.match(script, /rg\.exe/);
});

test('package scripts expose Windows portable and per-user NSIS builds', () => {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    assert.equal(
        packageJson.scripts['validate:win-packaged-resources'],
        'node scripts/windows/validate-packaged-resources.js --unpacked-dir dist/win-unpacked'
    );
    assert.equal(
        packageJson.scripts['dist:win'],
        'npm run clean && npm run build:rg-bundle && npm run react:build:dashboard && npm run css:build && electron-builder --win'
    );
    assert.equal(
        packageJson.scripts['dist:win:portable'],
        'npm run clean && npm run build:rg-bundle && npm run react:build:dashboard && npm run css:build && electron-builder --win portable'
    );
    assert.equal(
        packageJson.scripts['dist:win:nsis'],
        'npm run clean && npm run build:rg-bundle && npm run react:build:dashboard && npm run css:build && electron-builder --win nsis'
    );
});

test('package config builds Windows portable and no-elevation per-user NSIS artifacts', () => {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const winTargets = packageJson.build?.win?.target || [];
    const winResources = Array.isArray(packageJson.build?.win?.extraResources)
        ? packageJson.build.win.extraResources
        : [];

    assert.deepEqual(winTargets, ['portable', 'nsis']);
    assert.equal(packageJson.build?.win?.requestedExecutionLevel, 'asInvoker');
    assert.equal(packageJson.build?.nsis?.oneClick, false);
    assert.equal(packageJson.build?.nsis?.perMachine, false);
    assert.equal(packageJson.build?.nsis?.allowElevation, false);
    assert.equal(packageJson.build?.nsis?.allowToChangeInstallationDirectory, true);
    assert.equal(
        winResources.some(
            (resource) =>
                resource.from === 'scripts/windows/windows-media-ocr-probe.ps1' &&
                resource.to === 'windows/windows-media-ocr-probe.ps1'
        ),
        true
    );
    assert.equal(
        winResources.some(
            (resource) =>
                resource.from === 'scripts/windows/windows-ocr.ps1' &&
                resource.to === 'windows/windows-ocr.ps1'
        ),
        true
    );
    assert.equal(
        winResources.some(
            (resource) =>
                resource.from === 'scripts/windows/windows-foreground.ps1' &&
                resource.to === 'windows/windows-foreground.ps1'
        ),
        true
    );
    assert.equal(
        winResources.some(
            (resource) =>
                resource.from === 'scripts/bin/rg/rg.exe' &&
                resource.to === 'rg.exe'
        ),
        true
    );
});

test('package scripts use cross-platform node wrappers for Windows shells', () => {
    const packageJsonPath = path.join(appRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    assert.equal(packageJson.scripts['build:apple-vision-ocr'], 'node scripts/build-apple-vision-ocr.js');
    assert.equal(packageJson.scripts['build:active-window-detector'], 'node scripts/build-active-window-detector.js');
    assert.equal(packageJson.scripts['rebuild:electron'], 'node scripts/rebuild-for-electron.js');
    assert.equal(packageJson.scripts.test, 'npm run rebuild:node && node scripts/run-unit-tests.js');
});
