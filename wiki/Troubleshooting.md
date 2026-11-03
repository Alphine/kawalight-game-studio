# Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Image generation returns 409 "needs confirmation" | Cost gate is working as designed | Confirm the cost in the Assets view and generate again |
| Story text comes back empty | A reasoning model used its whole token budget | Use the default `meta-text` settings (minimal reasoning) |
| "Worker unreachable" | The worker is not running | Start the worker, or check the systemd service on the VPS |
| "config.json not found" in Playtest | No stored config yet | Save a config (PUT config) or assemble the blueprint, then playtest again |
| Playtest blank or game does not load | Phaser could not load from the CDN | Check your connection and retry; the game needs Phaser to start |
| Live page keeps showing old UI | Browser cache | Hard reload (Ctrl+F5) |
| Playtest iframe refuses to load on the live site | Content Security Policy on the server | The studio uses `srcdoc` for schematic previews; server CSP changes need operator approval |

If your problem is not listed, open an issue with the project id, the request
you made, and the error text. Never include an API key.
