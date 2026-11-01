# KGSM Playtest Serve Contract

REAL-game playtest backend: the worker stages the project's **stored**
`config.json` with the shared Phaser exporter (`stage_export`, the same
bytes as a playable export) and serves the staged files back as RAW
BYTES with each file's MIME type (the one non-JSON reply in the API —
a Playtest iframe points at it). Owner modules: `kgsm/playtest.py`,
`kgsm/api/routes_playtest.py`. Tests: `tests/test_playtest.py`.

Base: `KGSM_WORKER_URL` + `/api/v1` (same as the worker contract).
All paths below are relative to `/api/v1`.

## Flow

1. Client ensures a stored config exists (`PUT /projects/{id}/config`
   or `POST /projects/{id}/blueprint/assemble`).
2. Client stages (or re-stages) the build:

   `POST /projects/{id}/playtest` (empty body) →
   `201 {"url": "/api/v1/projects/{id}/playtest/", "stagedAt": "<UTC ISO-8601>"}`

   Staging writes `<project>/builds/playtest/` fresh every time
   (`stage_export` removes the output dir first), so a rebuild
   overwrites cleanly and never leaves stale files. The staged tree is
   secret-scanned exactly like an export (NFR-002): if a stored secret
   value appears anywhere in the staged bytes, staging fails with
   `502 export-error` instead of serving the secret over localhost.
   `url` is the API path of the staged root; append a staged-relative
   path to fetch a file. Prefix it with `KGSM_WORKER_URL` to form a
   fetchable URL.
3. Client fetches files:

   `GET /projects/{id}/playtest` → the staged `index.html`
   (trailing slash works too: `.../playtest/` lands here — and game
   pages MUST be loaded with the trailing slash so relative asset URLs
   resolve inside the staged tree).

   `GET /projects/{id}/playtest/<path...>` → the staged file at
   `<path...>`, e.g. `js/game/main.js`, `assets/player.png`.

   Success is `200` with the raw file bytes and the MIME type from
   the table below (e.g. `Content-Type: text/html; charset=utf-8`).
   Point an iframe at `KGSM_WORKER_URL + url` to play the staged game;
   errors stay JSON (`playtest-not-found`, `project-not-found`).

## Serve rules

- Staged root and layout are exactly what `stage_export` produces for
  the `playable` variant: `index.html`, `js/runtime/*`, `js/game/*`,
  `js/vendor/phaser.min.js` (when vendored), `assets/*`, `config.json`,
  `kgsm-manifest.json`.
- Only regular files are served. Directories (e.g. `assets`, `js`)
  return 404 — there is no directory listing.
- Serve guard (every violation is 404, never 400/500, so probes are
  indistinguishable from missing files):
  - no `..`, `.`, or empty segments (including percent-encoded
    `%2e%2e`, which the router decodes before the guard runs);
  - no absolute paths (`/...`, `C:/...`, `C:...`) and no backslashes;
  - the staged tree is symlink-free: any symlink at any level of the
    requested path — even one pointing inside the staged dir — is 404,
    and a symlinked staged root is 404;
  - the resolved target must stay inside `<project>/builds/playtest/`.

## Errors

| Status | Code | When |
| ------ | ---- | ---- |
| 404 | `project-not-found` | unknown project id |
| 404 | `config-not-found` | POST with no stored `config.json` |
| 404 | `playtest-not-found` | GET before any staging, missing file, directory, or any guard violation |
| 500 | `internal` | stored `config.json` is corrupt (not an object) |
| 502 | `export-error` | stored config fails validation/staging in `stage_export`, or a stored secret value was found in the staged bytes |

## MIME table

Explicit and platform-independent (never OS `mimetypes`):

| Extension | Content-Type |
| --------- | ------------ |
| `.html`, `.htm` | `text/html; charset=utf-8` |
| `.js`, `.mjs` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.json`, `.map` | `application/json; charset=utf-8` |
| `.txt` | `text/plain; charset=utf-8` |
| `.md` | `text/markdown; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.ico` | `image/x-icon` |
| `.wav` | `audio/wav` |
| `.mp3` | `audio/mpeg` |
| `.ogg` | `audio/ogg` |
| `.mp4` | `video/mp4` |
| `.webm` | `video/webm` |
| `.woff` | `font/woff` |
| `.woff2` | `font/woff2` |
| `.ttf` | `font/ttf` |
| `.wasm` | `application/wasm` |
| anything else | `application/octet-stream` |

Matching is case-insensitive on the final extension.
