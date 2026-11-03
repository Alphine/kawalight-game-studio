# AI Providers

KGSM can generate images and story text. The default providers are Meta's Muse
models. Other providers are optional. The full reference is
[docs/providers.md](../docs/providers.md).

| Provider id | Used for | Notes |
| --- | --- | --- |
| `meta-image` | Images (default) | Muse `muse-image-1.0` at `api.meta.ai` |
| `meta-text` | Story text (default) | Muse `muse-spark-1.3`, minimal reasoning effort |
| `llama-image`, `llama-text` | Images and text | Bring your own key; Together, Groq, OpenRouter, Hugging Face presets |
| `openai-compat` | Images | Any OpenAI-compatible endpoint |
| `mock` | Testing | No cost, no network |

## Set up a key

1. Open **Settings** in the studio.
2. Paste your key. It is stored locally and is write-only: the UI shows only
   the name, never the value.
3. Pick the provider in the Assets view.

## Costs

- Each image generation asks for confirmation first.
- Spend is recorded in the Costs ledger and checked against your daily limits.
- Providers without a known price show an unknown cost, not a zero cost.

## Privacy

Keys never enter a build, export ZIP, or log file.
