# KGSM binary release runbook

## Artifacts (v0.2.0)

Single portable folder in `apps/desktop/dist-release/` (git-ignored,
regenerable) — copy it anywhere and run:

- `kawalight-studio-maker.exe` (~11 MB) — the app.
- `kgsm-worker-x86_64-pc-windows-msvc.exe` (~19 MB) — worker sidecar.
- `kgsm-worker.exe` — same sidecar bytes, short name (fallback alias).

No installer: one folder is the whole distribution (v0.1.0's NSIS
installer is retired).

Launch-verified 2026-10-31 (v0.2.0, exact shipped bytes by SHA-256):
app window appears (title "Kawalight Game Studio Maker"), sidecar spawns
from the exe folder, health 200 with `version: 0.2.0` on 127.0.0.1:4317
(first boot ~30 s while the onefile bundle extracts, then instant),
empty stderr, stable 32 s+, clean kill with zero orphan workers.

## First run

1. Copy the `dist-release` folder anywhere (or unzip the portable set
   into one folder).
2. Launch `kawalight-studio-maker.exe`: the dashboard opens in an app window.
3. The app auto-starts its worker sidecar on `http://127.0.0.1:4317` —
   projects, wizard, Asset Forge/Lab, validation, export, backup all work
   against it. No separate step needed.
4. API keys (Asset Forge, real providers): Settings view, stored locally only.

Playtest notes: the Playtest view runs a UI-side schematic preview
(per-genre canvas sim, works offline in the binary) and can also embed a
staged-game URL. For full-fidelity playtests, stage + serve from a dev
checkout (root README: `stage-demo.mjs` + `smoke.mjs` commands) or open an
exported build directly.

## Architecture

- Tauri 2 shell (`apps/desktop/src-tauri`) serves the dashboard UI and spawns
  the worker sidecar `kgsm-worker` on port 4317 at startup; it is killed on app
  exit. Sidecar stdout is drained so a full pipe can never block it.
- Sidecar resolution: Tauri `externalBin` first (installed layout), fallback to
  a worker exe next to the app exe (portable layout). If neither exists the app
  fails fast with a setup error instead of a half-working UI.
- The worker is the same `kgsm` Python package, frozen with PyInstaller
  (onefile, ~19 MB) carrying `schemas/` + `templates/` inside. Frozen builds
  keep writable data in `%LOCALAPPDATA%\KawalightStudioMaker\`
  (`projects/`, `data/`), overridable via `KGSM_PROJECTS_DIR`/`KGSM_DATA_DIR`/
  `KGSM_HOME`.

## Rebuild from source (Windows, verified 2026-10-30)

Prerequisites: VS 2022 Build Tools (MSVC x64 linker), WebView2 Runtime,
Rust (repo pins nightly via `apps/desktop/rust-toolchain.toml` because the
machine's stable rustc is broken), Node 18+, Python 3.12+ venv at `.venv`.

```powershell
# 0. One-time: JS deps + PyInstaller (build-only)
cd apps/desktop; npm install; cd ../..
.\.venv\Scripts\pip.exe install -r apps/worker/requirements-build.txt

# 1. Freeze the worker sidecar (writes src-tauri/binaries/)
$env:LOCALAPPDATA='<repo>\.local-appdata'
robocopy packages\templates .pyinstaller-work\stage\templates /E `
  /XD node_modules .npm-cache .smoke dist-* pytest-of-* __pycache__ .pytest_cache
# NOTE: pytest scratch MUST stay out of the bundle — deep pytest-of-*
# paths break PyInstaller extraction at boot (MAX_PATH) and the sidecar
# exits before serving (seen 2026-10-31).
.\.venv\Scripts\pyinstaller.exe --noconfirm --clean --onefile --console `
  --name kgsm-worker --paths apps/worker/src `
  --hidden-import=kgsm.api.routes_providers `
  --hidden-import=kgsm.api.routes_ops `
  --add-data "<repo>\packages\schemas;kgsm_data/schemas" `
  --add-data "<repo>\.pyinstaller-work\stage\templates;kgsm_data/templates" `
  --distpath apps/desktop/src-tauri/binaries `
  --workpath .pyinstaller-work\build --specpath .pyinstaller-work `
  apps/worker/kgsm-worker.py
Remove-Item apps/desktop/src-tauri/binaries/kgsm-worker-x86_64-pc-windows-msvc.exe -Force -ErrorAction SilentlyContinue
Rename-Item apps/desktop/src-tauri/binaries/kgsm-worker.exe `
  kgsm-worker-x86_64-pc-windows-msvc.exe

# 2. Smoke-test the sidecar alone (use a scratch port + KGSM_HOME)
$env:KGSM_HOME='<repo>\.pyinstaller-work\frozen-probe'
Start-Process apps/desktop/src-tauri/binaries/kgsm-worker-x86_64-pc-windows-msvc.exe `
  -ArgumentList '--port','4399' -WindowStyle Hidden
Invoke-WebRequest http://127.0.0.1:4399/api/v1/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:4399/api/v1/providers -UseBasicParsing
Stop-Process -Name 'kgsm-worker*' -Force

# 3. Build the portable exe (first run downloads crates; 10-25 min,
#    incremental rebuilds ~1 min; no installer is produced)
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 -no_logo >NUL && cd /d <repo>\apps\desktop && set "CARGO_TARGET_DIR=<writable-temp>\kgsm-target" && node_modules\.bin\tauri.cmd build --no-bundle'

# 4. Collect artifacts (one portable folder; stop any running app first,
#    a live sidecar locks its exe)
Copy-Item <temp>\kgsm-target\release\kawalight-studio-maker.exe apps/desktop/dist-release/
Copy-Item apps/desktop/src-tauri/binaries/kgsm-worker-x86_64-pc-windows-msvc.exe apps/desktop/dist-release/
Copy-Item apps/desktop/src-tauri/binaries/kgsm-worker-x86_64-pc-windows-msvc.exe apps/desktop/dist-release/kgsm-worker.exe

# 5. Instrumented launch check (window must appear, health 200, clean kill;
#    free port 4317 first so the sidecar leg is conclusive)
Stop-Process -Name kawalight-studio-maker, 'kgsm-worker*' -Force -ErrorAction SilentlyContinue
$p = Start-Process apps/desktop/dist-release/kawalight-studio-maker.exe -PassThru `
  -RedirectStandardError apps/desktop/dist-release/app-stderr.log
Start-Sleep -Seconds 15
(Get-Process -Id $p.Id).MainWindowHandle -ne 0  # expect True
(Invoke-WebRequest http://127.0.0.1:4317/api/v1/health -UseBasicParsing).StatusCode  # expect 200
Remove-Item apps/desktop/dist-release/app-stderr.log -Force
Stop-Process -Name kawalight-studio-maker, 'kgsm-worker*' -Force
```

## Troubleshooting

- **App exits instantly (exit 101)**: read `app-stderr.log` next to the exe
  (launch with `-RedirectStandardError` as above). `Failed to setup app ...
  cannot find the file specified` = worker binary missing from both the
  bundle resources and the exe folder — rebuild the sidecar (step 1).
- **Dashboard shows worker offline**: port 4317 busy (another worker running?)
  or sidecar crashed — check for `kgsm-worker*` processes and free the port.
- **Stale `kgsm-worker*` processes pile up**: each app launch spawns one
  sidecar; kill leftovers from your own terminal (`Stop-Process -Name
  'kgsm-worker*' -Force`) or reboot before rebuilding — a live sidecar
  locks its exe and blocks artifact collection.
- **cargo fetch stalls**: the sandbox blocks the local proxy; run cargo steps
  unsandboxed (or set `CARGO_NET_RETRY`, longer `http.timeout`).
- **`gh` push auth fails**: token expired — run `gh auth login` in your own
  terminal, then `git push`.
- **Copying/launching exes under OneDrive from an elevated terminal fails**
  (`Access denied`, files seemingly vanishing): the elevated token lacks
  rights on the per-user OneDrive folder — use a normal terminal.
- **WebView2 `0x800700AA "resource is in use"` at startup**: restricted /
  sandboxed tokens cannot init WebView2 — run from a normal terminal.
