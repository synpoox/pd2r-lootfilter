# Loot Filter Builder

A standalone, buildless web app that builds a loot filter for **Project Diablo 2: Resurrected**. Players pick a strictness, change any row they disagree with (or expand a row and tier its items one by one), pick a colour theme and tweak how each tier looks and sounds (for all items, or per rarity: unique, set, rare, crafted, magic, white bases), give any row or single item its own look (colours, sound, icon and its own label text) by clicking its preview label, test the result on random loot in the simulator, and download `filter.json` for the [Pyre Loot Filter](https://github.com/Pyre-Flies/D2R-Mods/blob/main/plugins/pyre-lootfilter/README.md) plugin the mod ships (schema v3).

The idea follows the [D2R Reimagined filter builder v2](https://www.d2r-reimagined.com/loot-filterv2) and [FilterBlade](https://www.filterblade.xyz/): tiers, strictness presets, styles and sounds. No code from either is used. Item data comes from [pd2-resurrected](https://github.com/synpoox/pd2-resurrected), not Reimagined.

## Run it locally

Any static server works. On Windows, Python's built-in server sends `.js` as `text/plain`, which browsers refuse for modules; `.claude/launch.json` serves it with the right types on port 8765.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Page and launcher theme (tokens copied from `site/themes.css`). |
| `catalog.js` | Tiers (Chase, High Value, Notable, Good, Show, Hide), strictness levels, categories, rows and colour themes. Rows run top to bottom; the first match wins. |
| `compile.js` | Turns settings into `filter.json`, and matches items against it the way the plugin does (used by the simulator). |
| `app.js` | Interface, browser autosave, share links. |
| `game-folder.js` | Connects to the player's game folder: lists, opens and saves filters in `mods\PD2Resurrected\d2rloader\config\filter\`. |
| `data/pd2r-items.json` | Generated from the mod tables. Do not edit. |
| `sounds/Filter01-16.flac` | The plugin's drop sounds, for preview. From the Pyre Loot Filter release the mod pins. |

## Installing into the game

In Chrome, Edge or Opera on a computer, **Connect game folder** asks for the Diablo II Resurrected folder (the mod folder, `d2rloader`, `config` or `filter` also work). The builder then:

- installs the filter as `config\filter\<name>.json`, and afterwards saves to the same file (button or Ctrl+S). The plugin reloads a changed file on its own, so saving updates the game while it runs;
- lists every filter in the `filter` folder plus the mod's `config\filter.json`, and opens any of them. A file the builder made carries its settings in a top-level `builder` key, which the plugin ignores, and reopens exactly. Other filters open with their rules kept as-is under My picks, ahead of the builder rows;
- remembers the folder (IndexedDB) and the file being edited, and shows when there are unsaved changes.

Firefox and Safari do not offer folder access, so they get Download and the manual steps.

## Themes

The Resurrected themes are our own. The FilterBlade styles copy the apex, A, B and C currency tier label colours of [NeverSink's PoE filter styles](https://github.com/NeverSinkDev/NeverSink-Filter) (MIT), which FilterBlade uses, onto Chase, High Value, Notable and Good. NeverSink uses the same minimap icons in every style; ours give each style its own icon shapes in its own palette. Drop sounds stay the PD2R ones; Chase plays Filter06 in every theme.

Runeword & crafting bases match elite white or superior bases only when they have the sockets the usual runewords need (for example Phase Blade 5+, Monarch 4+); fewer sockets fall through to the White bases rows. Each row can change rarity (normal, superior or both), socket range and ethereal.

## Update the item data

```
python tools/build-data.py ../pd2-resurrected
node tools/check.mjs
```

The check confirms every code and item type in `catalog.js` exists in the mod data, every compiled filter fits the plugin's schema (rule keys, 64-value condition arrays, colours, sounds, icon shapes), stricter levels never show what an easier level hid, per-item tiers split a group, and the simulator's matcher picks the expected rule for sample items.

## Limits

- Pyre matches a base, rarity and tier, not a specific unique or set item. Two uniques on the same base cannot be told apart.
- Stat conditions (`stats`) and item level are not offered yet.
- Settings live in the visitor's browser (`localStorage`) and in share links. There are no accounts.

## Hosting

Live at https://synpoox.github.io/pd2r-lootfilter/. The `GitHub Pages` workflow only runs when started by hand (Actions → Run workflow), and Pages must be enabled with **GitHub Actions** as the source. Nothing deploys on push.
