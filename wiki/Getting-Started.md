# Getting Started

## Use the live app

1. Open https://basyid.dev/kgsm/app/ and sign in.
2. Click **New Game** and enter a name.
3. Pick a genre. You can choose a preset genre or write your own (free genre).
   A free genre changes the art prompts only; gameplay still uses a preset template.
4. Pick a starter theme, or describe your own.
5. Generate assets. Image generation costs money, so the studio asks you to
   confirm before it runs and shows the estimate.
6. Open **Playtest** to play the real game in the studio.
7. Open **Export** and download the playable ZIP.

The one-click **Auto** path runs create, blueprint, assemble, validate, config,
and ZIP for you. See `docs/auto-mode.md`.

## Run it on your own machine

You need Python 3.12 or newer and Node 18 or newer.

Start the worker so its local API listens on `127.0.0.1:4317`. The
[README release notes](../README.md#binary-release-v020) describe the packaged
desktop build, which starts the worker for you. Open the studio UI in a browser
from `apps/desktop/ui`. The worker must be running for the UI to work.

Local runs do not require sign-in (`KGSM_REQUIRE_AUTH` is off by default).

Run the test suites with the commands in the repo [README](../README.md#quickstart).

## Where your data lives

- Projects are stored under `projects/` at the repo root (git-ignored).
- Backups go to `.kgsm/backups/` as ZIP files with a SHA-256 sidecar.
- API keys are stored locally and never enter a build, ZIP, or log.
