# Desktop shell (SDD §5.1: Tauri 2 + vanilla HTML/CSS/JS)

## M1 status

- `ui/` is the functional M1 dashboard (no build step, vanilla JS): all SDD §2.3
  views — Home/Projects, New Game wizard, Game Blueprint, Asset Forge, Asset
  Lab, Level Studio, Game Settings, Playtest, Validation Center, Export Center,
  Settings — wired to the frozen worker contract (`docs/api-contract.md` v1)
  via `fetch()`.
- `ui/js/` modules: `util.js` (pure helpers), `api.js` (all 39 endpoints),
  `ui.js` (toasts/modal/panels), `state.js` (store + localStorage), `views.js`
  (registry), `views-*.js` (one file per view group), `util.test.js`
  (`node --test`). `ui/app.js` is the hash-router + health-poll boot script.
- Worker base URL defaults to `http://127.0.0.1:4317` (override in Settings,
  persisted in localStorage). Offline state is graceful: banner + per-view
  empty states + retry; health re-checks every 15 s.
- Every control either works or toasts its M2 reason (non-space-shooter
  assembly/config, auto-stage, storage paths, runtime pins, demo video).
- `src-tauri/` is a minimal Tauri 2 app with one `app_version` command proving
  the invoke bridge. Bundling is off (`bundle.active: false`) until M4.

## Develop the UI without Rust

```powershell
npx --yes http-server apps/desktop/ui -p 1420
# open http://127.0.0.1:1420
```

Point the app at a worker via Settings → Worker base URL
(default `http://127.0.0.1:4317`).

## Run the UI logic tests

```powershell
node --test apps/desktop/ui/js/util.test.js
node --check apps/desktop/ui/app.js  # repeat per js/*.js for a syntax pass
```

## Run the Tauri shell

```powershell
cd apps/desktop
npm install
npm run dev
```

First run downloads the Tauri crate graph and needs MSVC link.exe. The pinned
`rust-toolchain.toml` (nightly) works around a broken stable rustc on this
machine; see the file for the permanent fix.
