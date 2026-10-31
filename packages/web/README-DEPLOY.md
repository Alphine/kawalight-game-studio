# KGSM web bundle — Hostinger deploy guide

This folder is a ready-to-upload build of Kawalight Game Studio Maker:

```text
index.html          landing page (links to studio + games)
studio/             full dashboard UI (static files)
games/<genre>/      5 playable game demos (pure static, work anywhere)
server/             reference configs for VPS full-stack hosting
README-DEPLOY.md    this file
.htaccess           compression + caching for Apache/LiteSpeed
```

Built by `packages/web/tools/make-web-bundle.mjs` in the repo. Rebuild
anytime; never hand-edit this folder on the server.

## Option A — Shared hosting (simplest)

1. On your PC, zip the **contents** of this folder (select all inside →
   right-click → Compress; the ZIP must contain `index.html` at its root,
   not a wrapper folder).
2. hPanel → Websites → File Manager → `public_html` → Upload the ZIP →
   right-click → Extract here.
3. Open your domain. The landing page, all 5 games, and the Studio UI load.
4. Studio needs a worker: open Studio → Settings → set **Worker base URL**
   to your reachable worker (your PC via tunnel, or a VPS worker from
   Option B), then reload. Games always work without any worker.

## Option B — VPS full-stack (studio + worker on one domain)

1. Upload this folder to `/var/www/kgsm` on the VPS.
2. Install the worker: copy the repo's `apps/worker` to `/opt/kgsm`
   (Python 3.12+, no pip packages needed — stdlib only), create user
   `kgsm`, then install `server/kgsm-worker.service`:
   `cp server/kgsm-worker.service /etc/systemd/system/ &&
   systemctl daemon-reload && systemctl enable --now kgsm-worker`.
3. Install `server/nginx-kgsm.conf` (replace YOUR-DOMAIN), reload nginx,
   add TLS (Certbot). Studio's worker URL is then just `https://YOUR-DOMAIN`.

## Notes

- The dashboard uses hash routing (`#/home`), so no URL-rewrite rules are
  needed on the host.
- First worker boot on a slow disk can take ~30 s (onefile extraction);
  subsequent boots are instant. Health: `GET /api/v1/health`.
- Never upload `.kgsm/`, `projects/`, or any `secrets.json` — API keys stay
  on the machine that runs the worker, never in this bundle.
