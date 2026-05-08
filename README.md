[![Release Status](https://github.com/SoSly/foundryvtt-obsidian-bridge/workflows/release/badge.svg)](https://github.com/SoSly/foundryvtt-obsidian-bridge/actions)
[![Downloads](https://img.shields.io/github/downloads/SoSly/foundryvtt-obsidian-bridge/latest/module.zip)](https://github.com/SoSly/foundryvtt-obsidian-bridge/releases/latest)
[![Forge Install %](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fobsidian-bridge&colorB=4aa94a)](https://forge-vtt.com/bazaar#package=obsidian-bridge)
[![Supported Foundry Versions](https://img.shields.io/endpoint?url=https://foundryshields.com/version?url=https://raw.githubusercontent.com/SoSly/foundryvtt-obsidian-bridge/main/module.json)](https://foundryvtt.com/)

# Obsidian Bridge

A FoundryVTT module for bidirectional synchronization between Obsidian MD vaults and Foundry journal entries.

## Features

### Import
- Import Obsidian MD vaults into Foundry journal entries
- Preserve folder structure
- Convert Obsidian links to Foundry UUIDs
- Convert callout blocks to styled callouts
- Properly editable journals after import
- Overwrite existing journals on re-import

### Export
- Export Foundry journals back to Obsidian format
- Reconstruct folder structure
- Convert Foundry UUIDs back to Obsidian `[[links]]`
- Convert styled callouts back to callout blocks
- Overwrite existing files in vault

## Compatibility

| Obsidian Bridge Version | Foundry Version |
| -- | -- |
| v1.* | v12-v14 |

## Installation

Install via the Foundry module browser, or manually using this manifest URL:

```
https://github.com/SoSly/foundryvtt-obsidian-bridge/bundle/module.json
```

## Usage

### Importing from Obsidian

1. Under the Journal tab, click the "Import from Obsidian" button
2. Select your vault folder or a subfolder within it
3. Configure import options
4. Click Import

### Controlling player visibility

By default, every imported journal entry, page, and block is GM-only — Foundry's standard behavior for new documents. The module gives you three levels of control over what your players can see, applied directly from the source markdown so the settings survive every re-import.

#### Page-level visibility (frontmatter)

Add `show-players: true` to a file's YAML frontmatter to grant players access to that page:

```markdown
---
show-players: true
---

# Tavern Description

Visible to your players.
```

By default, opted-in pages are granted **OWNER** permission (players can edit). Use `player-permission` to lower that:

```markdown
---
show-players: true
player-permission: observer
---

# Read-only Lore Page
```

Valid values for `player-permission`: `owner` (default), `observer` (read-only), `limited` (sidebar visibility only — title shown, body hidden).

`player-permission` is ignored when `show-players` is absent or false.

The `show-players` and `player-permission` keys are stripped from the rendered page body and round-trip cleanly on re-import. Manual visibility changes you make in Foundry to pages **without** `show-players` are preserved across re-imports — the source file is only authoritative when it asserts visibility.

#### Entry-level discoverability (automatic)

When at least one page within a journal entry has `show-players: true`, the **entry** is automatically raised to **LIMITED** ownership so it appears in your players' journal sidebar. This is necessary for player-visible pages to be reachable through the journal directory.

Sibling pages within that entry that do **not** have `show-players: true` are explicitly set to **NONE** to prevent accidental title leakage via inheritance — players will see the visible page but not the names of hidden siblings.

The importer only **raises** entry ownership; it never lowers a manually-elevated entry. If you intentionally promote an entry to OBSERVER or OWNER in Foundry, re-imports will leave that elevated state alone.

#### Block-level redaction within a visible page (`[!secret]` callouts)

Within an otherwise player-visible page, wrap content in a `[!secret]` callout to hide it from non-GM players at the block level using Foundry's native secret-block feature:

```markdown
---
show-players: true
---

# Mysterious Tomb Entrance

The doors are carved with intricate runes.

> [!secret] GM Notes
> The runes spell out the password "ARGENT".
> Anyone reading them takes 2d6 psychic damage.

The party can attempt to translate the runes with a DC 18 Arcana check.
```

Players see only the visible paragraphs; the GM sees everything. The title (after `[!secret]`) is optional and renders as a bolded heading inside the secret block.

Secret blocks created via Foundry's editor toolbar export back to Obsidian as `> [!secret]` callouts, so the round-trip is preserved.

#### Quick reference

| Goal | What to do |
|---|---|
| Hide an entire page | Do nothing — that's the default |
| Show a page (read+edit) | `show-players: true` |
| Show a page (read-only) | `show-players: true` + `player-permission: observer` |
| Show only the page title | `show-players: true` + `player-permission: limited` |
| Hide a block within a visible page | Wrap it in `> [!secret]` |
| Make the parent entry discoverable | Automatic — set any contained page to player-visible |

### Exporting to Obsidian

1. Under the Journal tab, click the "Export to Obsidian" button
2. Select which journals to export
3. Choose export location
4. Click Export

## Known Issues

- Folder depth is limited to Foundry's folder depth limit
- Not all Obsidian markdown features are supported in Foundry
  - Code blocks work but without syntax highlighting
  - Embeds are linked but not embedded
  - Math/LaTeX is not supported

## License

Obsidian Bridge is released under the MIT License.

## Contact

The best place to track bugs is to create a [new issue](https://github.com/SoSly/foundryvtt-obsidian-bridge/issues/new).
