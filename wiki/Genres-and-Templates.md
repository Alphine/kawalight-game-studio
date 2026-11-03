# Genres and Templates

Each genre is a deterministic Phaser template under
`packages/templates/phaser/<genre>/`. The gameplay logic is tested, so the same
config and seed always play the same way. AI only supplies art, text, and config.

| Genre | Template | How it plays |
| --- | --- | --- |
| Space shooter | `space-shooter` | Dodge and shoot waves of enemies |
| Endless runner | `endless-runner` | Run forever, jump hazards, collect coins |
| Side scroller | `side-scroller` | Platform across levels, reach the exit |
| Battle 2D | `battle-2d` | Top-down arena fights with loot drops |
| Farming | `farming` | Plant, water, and harvest crops for coins |

`puzzle-match` is also in the repo. It is not in the README milestone table, so
treat it as experimental.

Starter themes: each genre ships with three themes in the New Game wizard.

Every template has a `logic.test.js` that runs without a browser, and a smoke
test that loads the staged game in headless Chrome.
