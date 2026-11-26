# Loot Filter Builder

A buildless web app that makes a loot filter for **Project Diablo 2: Resurrected**: pick a strictness and colour theme, adjust any row or item, test it on random loot, and download `filter.json` for the [Pyre Loot Filter](https://github.com/Pyre-Flies/D2R-Mods/blob/main/plugins/pyre-lootfilter/README.md) plugin (schema v3). In Chrome, Edge or Opera, **Connect game folder** saves straight into the game, which reloads the filter while it runs.

## Hosting

Live at https://synpoox.github.io/pd2r-lootfilter/. Nothing deploys on push: run the `GitHub Pages` workflow by hand (Actions → Run workflow). Settings stay in the visitor's browser and in share links.

## Development

Serve the folder with any static server that sends `.js` as `text/javascript` (Python's default on Windows does not); `.claude/launch.json` does, on port 8766.

```
python tools/build-data.py ../pd2-resurrected
node tools/check.mjs
```

The first regenerates the item data from the mod tables, the second checks the catalog and compiled filters.

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Interface, browser autosave, share links. |
| `catalog.js` | Tiers, strictness levels, rows, value ratings and themes. Rows run top to bottom; the first match wins. |
| `compile.js` | Turns settings into `filter.json` and matches items the way the plugin does. |
| `game-folder.js` | Reads and writes filters in the game folder. |
| `data/pd2r-items.json` | Generated. Do not edit. |
| `sounds/` | The plugin's drop sounds, for preview, from the Pyre Loot Filter release. |
| `tools/export.mjs` | Writes a ready filter at a strictness level. |

## Limits

- Pyre matches a base, rarity and tier, so uniques sharing a base share one toggle.
- Stat and item level conditions are not offered.

## Credits

- Strictness levels follow [HiimFilter](https://github.com/Maaaaaarrk/HiimFilter-PD2-Filter)'s standard filter; the unique and set star ratings are copied from its `builderfilter/data/unique-set-tiers.json`. Ratings and gold amounts are snapshots.
- FilterBlade style themes use the tier label colours of [NeverSink's filter styles](https://github.com/NeverSinkDev/NeverSink-Filter) (MIT).
- The idea follows the [D2R Reimagined filter builder](https://www.d2r-reimagined.com/loot-filterv2) and [FilterBlade](https://www.filterblade.xyz/); no code from either is used.
- Item data comes from [pd2-resurrected](https://github.com/synpoox/pd2-resurrected).
