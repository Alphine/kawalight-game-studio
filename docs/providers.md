# KGSM image providers

Wave-1 providers: `mock` (deterministic offline placeholders, free) and
`openai-compat` (a real OpenAI-compatible image adapter, bring-your-own-key).
Both implement `kgsm.providers.base.ImageProvider` and are served through
`GET /providers` (`docs/api-contract.md` §5).

The Meta/Llama preset adds `llama-image` and `llama-text` to the same
registry (both appear in `GET /providers`): `llama-image` for the normal
asset-generate flow, `llama-text` -- a `TextProvider` over
OpenAI-compatible `chat/completions` endpoints -- for story/text
generation via `POST /stories/generate` (details below).

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
                "model": "gpt-image-1"},
               {"id": "llama-image",
                "displayName": "Meta Llama images (BYOK)",
                "model": "black-forest-labs/FLUX.1-schnell"},
               {"id": "llama-text",
                "displayName": "Meta Llama text (BYOK)",
                "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo"}]}
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

## Meta/Llama preset (`llama-text` + `llama-image`)

One bring-your-own-key preset for Meta/Llama-compatible endpoints
(Groq-, Together-, OpenRouter-, HuggingFace-style OpenAI-compatible APIs
hosting Llama). It covers **both** modalities:

- `llama-text` — story/text generation via
  `POST {base_url}/chat/completions`
  (`{"model","messages","max_tokens","temperature"}`). It answers the
  story layer's duck-typed `generate_text(prompt, genre=...)` call and
  returns `{"text", "usage": {"model"}}`, so `POST /stories/generate`
  with `providerId: "llama-text"` works with no other wiring (one story
  = one billable unit, same quote → confirm → spend flow as assets).
  Text-capable providers are also listed by `list_text_providers()`.
  `llama-text` is text-only: picking it for asset generation fails
  cleanly with a `502 provider-error`, never a crash.
- `llama-image` — image-asset generation. It subclasses the
  `openai-compat` adapter, so request shape, parsing, validation, SSRF
  guards, cost behavior, and error mapping are identical; only the secret
  names and defaults below differ. It appears in `GET /providers` and
  works with the normal quote → confirm → generate flow.

### Secrets

Key and base URL are shared by both modalities; each modality has its own
model secret. Same store and rules as above (`.kgsm/secrets.json`,
write-only, never logged or returned).

| Secret name | Required | Meaning |
| --- | --- | --- |
| `llama_api_key` | yes (to generate) | Bearer [REDACTED] for the Llama host |
| `llama_base_url` | no | Endpoint root, default `https://api.together.xyz/v1` |
| `llama_text_model` | no | Chat model, default `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `llama_image_model` | no | Image model, default `black-forest-labs/FLUX.1-schnell` |
| `llama_price_cents_per_image` | no | Your per-image cost in cents (enables estimates) |

Resolution order per setting: constructor argument, then secret, then
default -- identical to `openai-compat`.

### Host presets: where to get a key, which fields to fill

Model IDs change; if a call fails with a provider `400/404`, check the
host's model list and update the secret. The same table is available in
code as `kgsm.providers.llama.LLAMA_PRESETS` / `get_preset(name)`.

| Host | Get a key at | `llama_base_url` | `llama_text_model` | Images? |
| --- | --- | --- | --- | --- |
| Together AI (default) | `https://api.together.xyz/settings/api-keys` | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Yes: `llama_image_model` = `black-forest-labs/FLUX.1-schnell` |
| Groq | `https://console.groq.com/keys` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | No (text only; `llama-image` calls fail here) |
| OpenRouter | `https://openrouter.ai/keys` | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` | No (its image API is a different chat modality this adapter does not speak) |
| Hugging Face | `https://huggingface.co/settings/tokens` (token needs Inference permission; gated Llama models need license acceptance) | `https://router.huggingface.co/v1` | `meta-llama/Llama-3.3-70B-Instruct` | No (text only) |

Setup examples (names only are ever listed back):

```bash
# Text via Groq (free tier friendly)
curl -X PUT 127.0.0.1:4317/api/v1/secrets/llama_api_key \
  -H 'Content-Type: application/json' -d '{"value":"gsk-..."}'
curl -X PUT 127.0.0.1:4317/api/v1/secrets/llama_base_url \
  -H 'Content-Type: application/json' -d '{"value":"https://api.groq.com/openai/v1"}'
curl -X PUT 127.0.0.1:4317/api/v1/secrets/llama_text_model \
  -H 'Content-Type: application/json' -d '{"value":"llama-3.3-70b-versatile"}'

# Text + images via Together (the defaults: only the key is required)
curl -X PUT 127.0.0.1:4317/api/v1/secrets/llama_api_key \
  -H 'Content-Type: application/json' -d '{"value":"tgp-..."}'
```

`llama-text` call options: `prompt` (required, non-empty), `genre`
(optional; becomes the system prompt `You are writing a {genre} game
story.` unless an explicit `system` prompt is given), `max_tokens`
(1..8192, default 512), `temperature` (0..2, default 0.7). Responses
without usable assistant content (`choices` missing/empty, no message,
blank content) raise `ProviderError`, as do HTTP errors (surfaced with
the provider message, key redacted) and network failures.

### Cost behavior

- `llama-image`: identical to `openai-compat` -- cost unknown (`cents:
  null`) unless `llama_price_cents_per_image` is set; unknown cost
  requires `confirmed: true`; spend limits apply; failures are `502
  provider-error` and write nothing.
- `llama-text`: text cost is always unknown (`estimate_cents` returns
  `None`), so story generation requires `confirmed: true` and records 0
  cents actual spend; spend limits still apply once priced quotes exist.
  Per-story price tracking is future work.

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

Text adapters additionally subclass `TextProvider` and implement
`generate_text(prompt, genre=...)` returning `{"text", "usage"}` (the
shape `kgsm.story` coerces; `usage` values must be JSON scalars). They
register in the same main registry -- never a side registry -- so the
story route resolves them; a text-only adapter still implements
`estimate_cents` (usually `None`) and a `generate` that raises
`ProviderError`, so mis-selecting it for images is a clean `502`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `502 ... no API key configured` | Set `openai_compat_api_key` (or `llama_api_key` for the Llama preset) |
| `llama-*: ... HTTP 404` | Wrong model ID for that host; check the host preset table above |
| `llama-image` fails on Groq/OpenRouter/HF | Expected: those presets are text-only; use Together for images |
| `502 ... HTTP 401` | Wrong/revoked key; check the provider message in the error |
| `502 ... HTTP 400` | Rejected payload (often an unsupported `size`); use a size your endpoint supports |
| `502 ... request failed` | Network/DNS/timeout reaching `base_url` (120 s timeout) |
| `409 needs-confirmation` | Resend with `confirmed: true` after showing the quote |
| `402 cost-blocked` | Monthly spend limit hit; raise or clear via `PUT /costs/limits` |
