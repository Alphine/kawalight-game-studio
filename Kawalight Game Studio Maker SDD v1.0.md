## Software Design Document (SDD) v1.0

**Owner:** Kawalight Studio\
**Status:** Proposed baseline for implementation\
**Product type:** Local-first AI-assisted 2D game creation studio\
**Primary platform:** Windows desktop first\
**Initial runtime:** Phaser 3 / HTML5\
**Secondary runtime:** Godot 4 through a separate exporter and template adapter\
**Art styles:** Pixel art and illustrated 2D\
**Initial genres:** Space shooter, endless runner, side-scroller, battle 2D, farming\
**AI strategy:** Multi-provider API adapters; AI assists content and configuration, deterministic templates run gameplay\
**Document purpose:** Define scope, architecture, modules, interfaces, data model, pipeline, testing, security, milestones, and acceptance criteria.

---

# 1. Executive Summary

Kawalight Game Studio Maker (KGSM) is a desktop application that helps a solo developer create playable 2D games from a structured brief. The user selects a genre, theme, visual style, target runtime, and gameplay options. The application creates a game blueprint, generates or imports assets, validates those assets, assembles them into a proven genre template, supports preview/playtesting, and exports a runnable project.

KGSM is not a system that asks an LLM to invent and rewrite an entire game without constraints. Its core design is a **template-driven game factory**:

- A shared runtime provides common services such as input, scene lifecycle, audio, UI, asset loading, save data, and debug hooks.
- Each genre has a tested gameplay module and a configuration schema.
- AI generates or assists with art, descriptions, content, level parameters, and structured configuration.
- A validation layer rejects invalid configuration before it reaches runtime.
- A test harness checks core gameplay invariants and detects runtime errors.
- Export adapters produce engine-specific projects.

This approach reduces unpredictable code generation and makes it possible to reuse improvements across games.

## 1.1 Product promise

**Choose a theme and genre → generate assets and content → assemble a playable game → test and tune it → export the project.**

The system should make the first playable result easy to obtain, while keeping the underlying project inspectable and editable.

## 1.2 Product goals

1. Create a playable 2D game from a structured wizard without requiring the user to start from an empty project.
2. Support five initial genre families: space shooter, endless runner, side-scroller, battle 2D, and farming.
3. Support pixel art and illustrated 2D assets.
4. Generate assets through swappable AI provider adapters.
5. Provide an asset pipeline for organizing, processing, validating, and exporting generated images.
6. Assemble games from tested templates and data-driven configuration.
7. Offer an in-app preview/playtest loop with logs and diagnostic tools.
8. Export a playable HTML5 build and a source project.
9. Support a Godot 4 project export path without pretending Phaser and Godot are interchangeable.
10. Keep API keys on the local machine and control potentially billable operations.
11. Make generated assets, prompts, model choices, configuration, and exports traceable.
12. Keep the first release realistic for a solo developer using a desktop laptop.

## 1.3 Non-goals for v1

- Fully autonomous creation of arbitrary genres without templates.
- A general-purpose replacement for Unity, Unreal, Godot, or a professional game editor.
- Training foundation models or requiring a local GPU.
- Guaranteed one-click commercial-quality art or animation.
- Automatically solving every gameplay bug with an AI coding agent.
- Multiplayer, online accounts, cloud project collaboration, or public publishing service.
- A public SaaS, billing system, or marketplace.
- 3D game generation.
- Fully automatic rigging, skeletal animation, voice acting, music composition, or advanced narrative tooling.
- Guaranteed store compliance, commercial rights, or copyright clearance.

---

# 2. Product Scope and User Experience

## 2.1 Target user

A solo indie developer or small team that wants to prototype and produce 2D games quickly, without building repetitive systems for every new project.

## 2.2 Core user journey

1. Create a project.
2. Choose genre, theme, visual style, target runtime, and project name.
3. Complete a game-design wizard.
4. Review the generated game blueprint.
5. Generate or import assets.
6. Validate assets and resolve blocking issues.
7. Assemble the selected genre template.
8. Run the game in the embedded preview or external browser.
9. Tune difficulty, controls, progression, and content.
10. Run automated smoke tests and view diagnostics.
11. Export HTML5 ZIP and editable source project.
12. Optionally export a Godot 4 project through its adapter.
13. Reopen the project later and continue editing.

## 2.3 Main application areas

- **Home / Projects:** recent projects, status, recent builds, and storage usage.
- **New Game Wizard:** genre, theme, style, resolution, controls, difficulty, and target.
- **Game Blueprint:** game loop, player abilities, enemies, level progression, scoring, win/lose conditions.
- **Asset Forge:** prompt editor, provider selection, generation history, image variations, asset library.
- **Asset Lab:** crop, alpha inspection, sprite slicing, frame ordering, palette and tile diagnostics.
- **Level Studio:** configure waves, obstacles, platform layouts, farming plots, encounters, and progression.
- **Game Settings:** movement, speed, health, damage, economy, spawn rates, difficulty curves.
- **Playtest:** run, pause, restart, inspect console, capture test results.
- **Validation Center:** asset, configuration, runtime, export, and security warnings.
- **Export Center:** HTML5 package, Phaser source project, Godot project, manifest and reports.
- **Settings:** providers, API keys, cost limits, storage path, runtime versions, diagnostics.

## 2.4 Project states

`draft → blueprint_ready → assets_pending → assembling → playable → validating → export_ready → exported`

A project may return to an earlier state when its configuration or assets change. The UI must explain why a previously valid build has become stale.

---

# 3. Genre Catalogue and Requirements

Each genre is a module with its own gameplay logic, configuration schema, starter assets, validation rules, and tests. Shared services should be reused where appropriate.

## 3.1 Space Shooter — first vertical slice

**Reference feel:** classic horizontal shooter such as Space Impact, without copying its protected art or exact content.

Core gameplay:

- Player ship movement within configured bounds.
- Primary weapon and projectile pooling.
- Enemy spawn patterns and wave progression.
- Collision, damage, player lives/health, and invulnerability windows.
- Score, pickups, weapon power-ups, and difficulty scaling.
- Boss encounter as a configurable optional feature.
- Pause, game over, restart, and victory state.
- Keyboard controls; gamepad support can be added later.

Required screens:

- Title/menu.
- Gameplay HUD.
- Pause overlay.
- Game over / score summary.
- Optional stage-clear screen.

Minimum acceptance:

- Player can move and shoot.
- Enemies spawn and move according to configuration.
- Collisions produce correct damage and score.
- The game can reach a game-over or stage-clear state.
- Restart returns the game to a clean state without duplicated event handlers.

## 3.2 Endless Runner

Core gameplay:

- Automatic player movement or world scrolling.
- Jump, slide, or lane-switch mechanic selected by the template.
- Obstacles and collectible items.
- Distance/score calculation.
- Speed and difficulty ramp.
- Collision, game-over, restart, and persistent high score.
- Deterministic seed option for repeatable test runs.

## 3.3 Side-Scroller

Core gameplay:

- Horizontal movement and jump.
- Configurable gravity, acceleration, and jump parameters.
- Platforms, hazards, enemies, checkpoints, and exits.
- Camera follow and level boundaries.
- Player damage/respawn or life system.
- Level completion and restart.
- Collision layers and tile collision metadata.

## 3.4 Battle 2D

For v1, battle means a bounded 2D action/combat encounter, not an unrestricted RPG system.

Core gameplay:

- Player health and one or more attacks.
- Enemy states such as idle, approach, attack, hurt, and defeated.
- Hitboxes/hurtboxes, damage, knockback, cooldowns, and invulnerability.
- Wave-based encounters and optional boss configuration.
- Health bars, victory/defeat state, and reward drops.
- A turn-based combat variant is a later extension, not assumed in the first action-battle template.

## 3.5 Farming

Core gameplay:

- Grid-based farm plot.
- Soil state and crop planting.
- Crop growth stages driven by in-game time.
- Watering or maintenance mechanic.
- Harvesting and inventory.
- Sell/buy loop, currency, and seed shop.
- Day cycle and save/load.
- Basic quest/objective system may be added after the core loop is stable.

Farming has a different simulation and UI profile from action games. It should reuse project, asset, save, and export infrastructure, but not be forced into the same gameplay module as a shooter.

## 3.6 Genre selection priority

Recommended implementation order:

1. Space Shooter.
2. Endless Runner.
3. Side-Scroller.
4. Battle 2D.
5. Farming.

This order prioritizes a compact and testable action loop before more complex physics, combat state, and simulation systems.

---

# 4. System Requirements

## 4.1 Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-001 | Create, rename, duplicate, archive, and delete local projects | P0 |
| FR-002 | Create a project from one of the five genre templates | P0 |
| FR-003 | Select pixel-art or illustrated 2D style | P0 |
| FR-004 | Generate a structured game blueprint from wizard inputs | P0 |
| FR-005 | Allow the user to inspect and edit the blueprint before assembly | P0 |
| FR-006 | Generate images using at least one real provider and a mock provider | P0 |
| FR-007 | Support a provider-adapter interface for adding providers | P0 |
| FR-008 | Store API credentials securely on the local machine | P0 |
| FR-009 | Show estimated/unknown cost and require confirmation before paid generation | P0 |
| FR-010 | Import local PNG, JPEG, and WebP assets | P0 |
| FR-011 | Organize assets by project, entity, animation, and role | P0 |
| FR-012 | Slice sprite sheets and define animations | P0 |
| FR-013 | Validate image dimensions, frame geometry, alpha, and metadata | P0 |
| FR-014 | Assemble a playable game from a tested genre template and validated configuration | P0 |
| FR-015 | Run game preview and support restart | P0 |
| FR-016 | Display runtime errors and structured validation reports | P0 |
| FR-017 | Export playable HTML5 ZIP and editable Phaser source | P0 |
| FR-018 | Export a neutral manifest with asset provenance and project settings | P0 |
| FR-019 | Save and reopen projects without losing configuration or asset links | P0 |
| FR-020 | Include automated smoke tests for the Space Shooter template | P0 |
| FR-021 | Generate a Godot-oriented project through a separate exporter | P1 |
| FR-022 | Support per-project and monthly spend limits | P0 |
| FR-023 | Support level/wave/content generation through schema-constrained data | P1 |
| FR-024 | Support background removal through a pluggable local or remote processor | P1 |
| FR-025 | Support palette diagnostics and pixel-art nearest-neighbor scaling | P1 |
| FR-026 | Support seed/reproducibility settings where available | P1 |
| FR-027 | Support project backup and restore | P1 |
| FR-028 | Support keyboard remapping and gamepad input | P2 |
| FR-029 | Support modular audio/SFX generation and import | P2 |
| FR-030 | Support one-click packaging of all required assets and source files | P0 |

## 4.2 Non-functional requirements

- **NFR-001 Local-first:** project data and generated files remain local by default.
- **NFR-002 Security:** API keys never enter frontend source, game builds, project ZIPs, or logs.
- **NFR-003 Reliability:** provider failure cannot corrupt the current project or overwrite the last successful build.
- **NFR-004 Determinism:** the same template, config, and runtime version should produce repeatable gameplay behavior when random seeds are fixed.
- **NFR-005 Testability:** genre logic, asset pipeline, provider adapters, validators, and exporters are independently testable.
- **NFR-006 Portability:** exported HTML5 games run without the desktop application.
- **NFR-007 Inspectability:** generated configuration and source code remain readable and editable.
- **NFR-008 Performance:** target 60 FPS for simple 2D templates on a typical modern desktop/laptop; performance must be measured, not assumed.
- **NFR-009 Bounded AI:** model output must be parsed and schema-validated before use.
- **NFR-010 Recovery:** interrupted generation or export should be recoverable without losing earlier assets.
- **NFR-011 Cost control:** no unbounded retries or batch generation without confirmation.
- **NFR-012 Versioning:** templates, config schemas, exporters, and project files have explicit versions.

---

# 5. Architecture Decisions

## 5.1 Recommended stack

| Layer | Technology | Rationale |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Lightweight desktop packaging and controlled local access |
| UI | HTML5, CSS, Vanilla JS | Fast development and familiar web workflow |
| Initial game runtime | Phaser 3 | HTML5-first, fast preview, suitable for 2D templates |
| Local orchestration | Python 3.12+ | Provider API integration, image processing, validation |
| Image processing | Pillow; optional OpenCV | Image inspection, cropping, slicing, frame analysis |
| Database | SQLite | Single-user local projects without server setup |
| Config format | JSON + JSON Schema/Pydantic | Explicit, validated, inspectable data |
| Game template code | JavaScript ES modules | Shared Phaser runtime and genre modules |
| Godot export | GDScript/resource templates + test harness | Separate engine-specific implementation |
| Testing | pytest + JS tests + Playwright where appropriate | Unit, contract, smoke, and end-to-end coverage |
| Packaging | Tauri bundler and packaged worker | Desktop installer |

## 5.2 Process boundaries

- **Desktop UI:** renders project editing, forms, preview controls, and validation reports.
- **Local orchestration worker:** handles provider requests, asset processing, project metadata, and export jobs.
- **Game preview runtime:** runs the generated game in a controlled browser/webview context.
- **Exported game:** a standalone HTML5 project with no dependency on the local worker.
- **Optional AI coding agent:** may propose changes to approved template code in a later version; must not have unrestricted access to credentials or arbitrary project files.

## 5.3 High-level architecture

```
Desktop UI (Tauri + HTML/CSS/JS)
        |
        +---- Game Wizard / Blueprint Editor
        |
        +---- Asset Forge / Asset Lab
        |
        +---- Level Studio / Settings
        |
        +---- Preview / Validation / Export
        |
        v
Local Application Service (Python)
        |
        +---- Project Service ---- SQLite
        |
        +---- Provider Registry ---- Cloud Image APIs
        |
        +---- Asset Pipeline ---- Local Filesystem
        |
        +---- Blueprint & Config Validator
        |
        +---- Export Orchestrator
                    |
                    +---- Phaser Template Adapter
                    |
                    +---- Godot Template Adapter
```
