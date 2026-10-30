# KGSM image providers

Wave-1 providers: `mock` (deterministic offline placeholders, free) and
`openai-compat` (a real OpenAI-compatible image adapter, bring-your-own-key).
Both implement `kgsm.providers.base.ImageProvider` and are served through
`GET /providers` (`docs/api-contract.md` §5).

## Setup

No installs: the adapter uses stdlib `urllib` only (no OpenAI SDK). All
configuration lives in the local secret store (`.kgsm/secrets.json`,
owner-only permissions); values are write-only and never appear in API
responses, logs, builds, or manifests.

| Secret name | Required | Meaning |
| --- | --- | --- |
| `openai_compat_api_key` | yes (to generate) | Bearer token for the images endpoint |
| `openai_compat_base_url` | no | Endpoint root, default `https://api.openai.com/v1` |
| `openai_compat_model` | no | Model name, default `gpt-image-1` |
| `openai_compat_price_cents_per_image` | no | Your per-image cost in cents (enables estimates) |

Set them via the worker API (names only are ever listed back):

```bash
curl -X PUT 127.0.0.1:4317/api/v1/secrets/openai_compat_api_key \
  -H 'Content-Type: application/json' -d '{"value":"sk-..."}'
curl -X PUT 127.0.0.1:4317/api/v1/secrets/openai_compat_base_url \
  -H 'Content-Type: application/json' -d '{"value":"http://127.0.0.1:9999/v1"}'
```

Settings resolve lazily on every call (constructor argument, then secret,
then default), so keys and models rotate without a worker restart.

## Supported endpoints

`GET /providers` returns every registered adapter in contract shape:

```json
{"providers": [{"id": "mock", "displayName": "Mock (offline placeholders)",
                "model": "mock-1"},
               {"id": "openai-compat",
                "displayName": "OpenAI-compatible (BYOK)",
                "model": "gpt-image-1"}]}
```

Generation goes through `POST /projects/{id}/assets/generate` (contract §4),
which re-quotes, enforces `costs.authorize`, calls the adapter, saves each
image with provenance (`prompt`/`provider`/`model`/`seed`), and records
spend. There is no separate provider-generate route. Generation history is
the project asset list (`GET /projects/{id}/assets`): every generated asset
carries its provenance in its `.meta.json` sidecar.

The adapter speaks `POST {base_url}/images/generations` with
`{"model","prompt","n","size":"WxH"}` and accepts `data[].b64_json` (primary)
or `data[].url` (downloaded without forwarding your API key). Responses are
normalized to PNG; non-PNG bytes (JPEG, WebP) are converted with Pillow.
`size` is passed through verbatim -- use dimensions your endpoint supports
(strict OpenAI endpoints reject arbitrary sizes with a surfaced `400`, which
becomes a `502 provider-error` with the provider message attached).
`style` appends a prompt suffix (`pixel-art` → `, pixel art`,
`illustrated-2d` → `, detailed 2D illustration`); unknown styles pass through
unchanged.

## Cost behavior

- `mock`: always 0 cents, no confirmation needed.
- `openai-compat`: cost is **unknown (`cents: null`) unless you set
  `openai_compat_price_cents_per_image`**. There is deliberately no hardcoded
  price table -- pricing varies by model/size/quality and changes often, so a
  baked-in table would lie. Unknown cost always requires `confirmed: true`
  (`409 needs-confirmation` otherwise); confirmed unknown-cost generations
  record 0 cents actual spend. With a configured price, quotes return
  `price × nImages` and still require confirmation; spend limits
  (`PUT /costs/limits`) block over-limit generations even when confirmed
  (`402 cost-blocked`).
- Failures are `502 provider-error` and write nothing: no partial assets, no
  ledger entries, last good build untouched (NFR-003).

## How to add a provider

1. Subclass `kgsm.providers.base.ImageProvider` (`id`, `display_name`,
   `model`, `estimate_cents`, `generate`). Raise `ProviderError` -- never a
   raw exception -- on any failure, and never include secrets in messages.
2. Return `None` from `estimate_cents` whenever the true price is unknown.
3. Register in `kgsm/providers/registry.py` `_ensure_builtins()` (lazy,
   setdefault-style so tests and custom adapters are never clobbered).
4. Add tests that mock HTTP (see `apps/worker/tests/test_openai_provider.py`
   for the `urlopen` fake pattern): request shape, parsing, validation,
   every error mapping, and the quote/authorize gate. No test may touch the
   network.
5. Document secrets, cost behavior, and quirks in this file.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `502 ... no API key configured` | Set `openai_compat_api_key` |
| `502 ... HTTP 401` | Wrong/revoked key; check the provider message in the error |
| `502 ... HTTP 400` | Rejected payload (often an unsupported `size`); use a size your endpoint supports |
| `502 ... request failed` | Network/DNS/timeout reaching `base_url` (120 s timeout) |
| `409 needs-confirmation` | Resend with `confirmed: true` after showing the quote |
| `402 cost-blocked` | Monthly spend limit hit; raise or clear via `PUT /costs/limits` |
