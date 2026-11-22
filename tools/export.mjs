// Write a ready filter at a strictness level with the builder's defaults, the same file the page downloads.
// Run: node tools/export.mjs <level 0-4> "<filter name>" > filter.json
import { readFileSync } from 'node:fs';
import { buildCatalog, LEVELS, THEMES } from '../catalog.js';
import { compile } from '../compile.js';

const level = Number(process.argv[2] ?? 1), name = process.argv[3] ?? `PD2R ${LEVELS[level]?.name ?? ''}`.trim();
if (!Number.isInteger(level) || !LEVELS[level]) throw new Error(`level must be 0 to ${LEVELS.length - 1}`);
const data = JSON.parse(readFileSync(new URL('../data/pd2r-items.json', import.meta.url), 'utf8'));
// Same shape as the page's saved settings, so the file reopens in the builder.
const settings = { name, level, overrides: {}, itemOverrides: {}, baseOptions: {}, theme: THEMES[0].id, styleEdits: {}, rarityEdits: {}, rowLooks: {}, itemLooks: {}, picks: [], imported: null };
const filter = compile(buildCatalog(data), settings);
process.stdout.write(JSON.stringify({ ...filter, builder: { format: 'pd2r-filter-builder', version: 1, settings } }, null, 2) + '\n');
