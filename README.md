<p align="center">
   <img src="./src/icon.png" width="96" alt="Familiar icon" />
</p>

<h1 align="center">Let AI watch you work</h1>

<h4 align="center">Familiar watches your screen so your AI can update its memory, skills, and knowledge.</h4>

<p align="center">
   <a href="https://looksfamiliar.org">https://looksfamiliar.org</a>
</p>

<p align="center">
  <a href="https://github.com/familiar-software/familiar/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" /></a>
</p>

---

We created Familiar to capture our screen (and clipboard) every 4 seconds and save it as markdown. That way our local agent can use that as context (through a cron, skill, or slash command).

## Windows beta

This branch includes beta Windows support in addition to the upstream macOS app. Windows builds are intended to run without admin/UAC prompts:

- NSIS per-user installer: `dist\Familiar Setup 0.0.67.exe`
- Portable executable: `dist\Familiar 0.0.67.exe`

The installer artifacts are generated locally and are not committed to git. If you need to install on another machine, build from this branch on that machine or distribute the installer through a private release/file share. Do not attach private beta installers to a public fork.

On Windows, Familiar stores settings in `%APPDATA%\Familiar\settings.json` and defaults the context folder parent to `%LOCALAPPDATA%`. Captured output still lives under the selected context folder in `familiar\stills\` and `familiar\stills-markdown\`.

Windows OCR uses the local `Windows.Media.Ocr` APIs through bundled PowerShell helpers. Foreground-window metadata is also collected locally through a bundled Windows helper. Browser URL extraction and a Windows-specific settings UI are not part of this beta.

## Use Familiar with your favorite agent

### Self-updating

<img src="./docs/cowork-scheduled.gif" alt="Familiar used in a scheduled Cowork task" width="500" />

### As a skill

<img src="./docs/cowork-skill.gif" alt="Familiar used as a skill inside Cowork" width="500" />

## What people use Familiar for

- Fill the gap between AI tools: meeting transcribers, auto-memory layers, second brain
- Update Claude's skills/memory based on their workday (in a scheduled task/heartbeat)
- Typing "help me with what I'm working on right now" without having to prompt/describe what's going on their screen
- Enriching meeting transcripts with what was actually on screen (and vice versa)
- Forking it into their coaching app so coaches can see what learners did between sessions
- Someone new to tech used Familiar during a trial week at a YC startup, so that AI could coach him every few hours (and got the job)

## How agents use the output

Early users often report AI using Familiar's context as "connective tissue" or a "routing layer" to help agents map between resources. Recently, my agent "saw" that I spent a long time on a document, so it fetched the full doc directly. We've also seen the agent traverse the markdown, then decide to fetch the original image (so cool).

## The Bitter Lesson comes to our screens

We stand on the shoulders of giants: screenpipe, rewind, dayflow, etc. Since then: 1) Local agents got good at handling massive amounts of messy text files 2) Local agents have their own memory and skills systems.

Familiar is our "bitter lesson" version: just hand over context and get out of the way. The right way to do that piece is open source / free / offline.

## Privacy

Familiar keeps OCR and redaction local/offline. On macOS it uses Apple's native OCR helper; on Windows it uses local `Windows.Media.Ocr` helpers. Familiar deletes screenshot images after 48 hours and redacts passwords/credit card numbers/SSNs/API tokens/etc. before writing extracted markdown and clipboard mirrors. We'd love contributions on what else to block: https://github.com/familiar-software/familiar/tree/main/src/ or in general ways to improve privacy.


## Additional Details

- Settings on macOS: `~/.familiar/settings.json`
- Settings on Windows: `%APPDATA%\Familiar\settings.json`
- Captured still images: `<contextFolderPath>/familiar/stills/`
- Extracted markdown for captured still images: `<contextFolderPath>/familiar/stills-markdown/`
- Clipboard text mirrors while recording: `<contextFolderPath>/familiar/stills-markdown/<sessionId>/<timestamp>.clipboard.txt`
- Before still markdown and clipboard text are written, Familiar runs `rg`-based redaction for password/API-key patterns. If the scanner fails twice, Familiar still saves the file and shows a one-time warning toast per recording session.

## Build locally

```bash
git clone https://github.com/familiar-software/familiar.git
cd familiar
npm install
npm run dist:mac
```

`npm run dist:mac*` includes `npm run build:rg-bundle`, which prepares `scripts/bin/rg/*` and packages it into Electron resources at `resources/rg/`.

`build-rg-bundle.sh` downloads official ripgrep binaries when missing (or copies from `FAMILIAR_RG_DARWIN_ARM64_SOURCE` / `FAMILIAR_RG_DARWIN_X64_SOURCE` if provided). The binaries are generated locally and are not committed.

### Build the Windows beta locally

```powershell
git clone --branch windows-port-from-fork https://github.com/stsimon-ncsy/familiar.git
cd familiar
npm.cmd install
npm.cmd run dist:win
npm.cmd run validate:win-packaged-resources
```

`npm.cmd run dist:win` creates both the portable and NSIS per-user installer artifacts under `dist\`. The Windows package includes local OCR, foreground metadata, and `rg.exe` redaction resources.
