// Self-check: every catalog code exists in the PD2R data and every compiled filter fits Pyre's schema.
// Run: node tools/check.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildCatalog, upgradeLevel, upgradeRows, LEVELS, THEMES } from '../catalog.js';
import { compile, presetTier, evaluate, itemKey, labelName, labelProblem } from '../compile.js';

const data = JSON.parse(readFileSync(new URL('../data/pd2r-items.json', import.meta.url), 'utf8'));
const catalog = buildCatalog(data);
const known = code => code in data.misc || code in data.bases;
const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'triangleDown', 'star', 'spark', 'kite', 'hexagon', 'cross', 'chevron', 'bullseye'];
const CONDITIONS = new Set(['code', 'baseName', 'itemType', 'tier', 'rarity', 'quantity', 'itemLevel', 'sockets', 'ethereal', 'identified', 'sellPrice']);
const BLOCK = new Set(['ruleName', 'conditions', 'continue', 'name', 'tooltip', 'dropSound', 'minimapIcon']);
const RGBA = /^RGBA\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\)$/;
const list = v => (Array.isArray(v) ? v : [v]);

const ids = new Set();
for (const category of catalog) {
  for (const group of category.groups) {
    assert(!ids.has(group.id), `duplicate group id ${group.id}`);
    ids.add(group.id);
    for (const code of group.codes ?? list(group.when.code ?? [])) assert(known(code), `${group.id}: unknown item code ${code}`);
    for (const type of list(group.when?.itemType ?? [])) assert(type in data.types, `${group.id}: unknown itemType ${type}`);
    assert(group.codes?.length !== 0, `${group.id}: no items`);
  }
}

function validate(filter) {
  assert.equal(filter.version, 3);
  assert(filter.rules.length > 0 && filter.rules.length <= 4096);
  for (const r of filter.rules) {
    const keys = Object.keys(r);
    assert(keys.length === 1 && (keys[0] === 'show' || keys[0] === 'hide'), 'rule must be show or hide');
    const block = r[keys[0]];
    for (const k of Object.keys(block)) assert(BLOCK.has(k), `bad block key ${k}`);
    if ('name' in block) assert.equal(labelName(block.name), block.name, `${block.ruleName}: name Pyre would refuse`);
    for (const [k, v] of Object.entries(block.conditions)) {
      assert(CONDITIONS.has(k), `bad condition ${k}`);
      if (Array.isArray(v)) assert(v.length >= 1 && v.length <= 64, `${block.ruleName}: ${k} has ${v.length} values`);
    }
    for (const c of Object.values(block.tooltip ?? {})) assert.match(c, RGBA);
    if (block.dropSound) assert.match(block.dropSound, /^Filter(0[1-9]|1[0-6])$/);
    if (block.minimapIcon) {
      assert(SHAPES.includes(block.minimapIcon.shape));
      assert(block.minimapIcon.size >= 4 && block.minimapIcon.size <= 128);
      assert.match(block.minimapIcon.fillColor, RGBA);
    }
  }
}

const base = { name: 'Check', overrides: {}, itemOverrides: {}, theme: 'resurrected', styleEdits: {}, picks: [] };
for (const theme of THEMES) assert.equal(theme.styles.S.sound, 'Filter06', `${theme.id}: Chase plays Filter06`);
for (const theme of THEMES) validate(compile(catalog, { ...base, level: 0, theme: theme.id }));
const counts = LEVELS.map((_, level) => {
  const filter = compile(catalog, { ...base, level });
  validate(filter);
  return filter.rules.filter(r => r.hide).length;
});
for (let i = 1; i < counts.length; i++) assert(counts[i] >= counts[i - 1], 'stricter levels must not hide fewer rules');

// Stricter never shows something an easier level hid.
const order = ['S', 'A', 'N', 'B', 'SHOW', 'HIDE'];
for (const group of catalog.flatMap(c => c.groups)) {
  for (let l = 1; l < LEVELS.length; l++) {
    assert(order.indexOf(presetTier(group, l)) >= order.indexOf(presetTier(group, l - 1)), `${group.id} gets louder at level ${l}`);
  }
}

const withPick = compile(catalog, { ...base, level: 2, overrides: { 'runes-start': 'S' }, picks: [{ code: 'uap', label: 'Shako', tier: 'A', ethereal: false, sockets: 0, rarity: '' }] });
validate(withPick);
assert.deepEqual(withPick.rules[0].show.conditions, { code: 'uap' }, 'picks come first');
assert(withPick.rules.some(r => r.show && [].concat(r.show.conditions.code).includes('r01')), 'override is applied');

// Per-item tiers split a group; the simulator agrees with the compiled rules.
const split = compile(catalog, { ...base, level: 1, itemOverrides: { m01: 'HIDE' } });
validate(split);
const sim = (filter, item) => evaluate(filter, item, data);
assert.equal(sim(split, { code: 'm01', rarity: 'normal' }).visible, false, 'item override hides one map');
assert.equal(sim(split, { code: 'm04', rarity: 'normal' }).visible, true, 'rest of the map group still shows');
const regular = compile(catalog, { ...base, level: 1 });
assert.equal(sim(regular, { code: 'r30', rarity: 'normal' }).rule.dropSound, 'Filter06', 'Ber is Chase');
assert.equal(sim(regular, { code: 'ssd', rarity: 'inferior' }).visible, false, 'inferior hidden at Regular');
assert.equal(sim(regular, { code: 'uap', rarity: 'unique' }).rule.ruleName, 'Uniques & sets: High Value');
assert.equal(sim(regular, { code: 'uap', rarity: 'normal', sockets: 2 }).rule.ruleName, 'Runeword & crafting bases: Notable');
assert.equal(sim(regular, { code: 'cm3', rarity: 'magic' }).rule.ruleName, 'Charms, jewels & jewelry: Magic grand charms', 'itemType follows parents');
// Runeword bases need their sockets; fewer fall through to White bases.
assert.equal(sim(regular, { code: 'uit', rarity: 'normal', sockets: 4 }).rule.ruleName, 'Runeword & crafting bases: High Value');
assert.equal(sim(regular, { code: 'uit', rarity: 'normal', sockets: 2 }).rule.ruleName, 'White bases: Socketed elite bases');
assert.equal(sim(regular, { code: 'uit', rarity: 'magic', sockets: 4 }).rule.ruleName, 'Rare, crafted & magic gear: Magic elite gear');
assert.equal(sim(regular, { code: 'uvg', rarity: 'magic' }).rule.ruleName, 'Runeword & crafting bases: Magic elite gloves, belts and boots');

// Base row options: rarity, socket range and ethereal replace the row's defaults.
const opts = compile(catalog, { ...base, level: 1, baseOptions: { 'rw-monarch': { rarity: 'superior', min: 0, max: 0, eth: 'no' } } });
validate(opts);
assert.equal(sim(opts, { code: 'uit', rarity: 'superior' }).rule.ruleName, 'Runeword & crafting bases: High Value', 'unsocketed superior Monarch counts');
assert.notEqual(sim(opts, { code: 'uit', rarity: 'normal', sockets: 4 }).rule.ruleName, 'Runeword & crafting bases: High Value', 'normal Monarch no longer counts');
assert.notEqual(sim(opts, { code: 'uit', rarity: 'superior', ethereal: true }).rule.ruleName, 'Runeword & crafting bases: High Value', 'ethereal excluded');
const exact = compile(catalog, { ...base, level: 1, baseOptions: { 'rw-monarch': { min: 4, max: 4 } } });
assert.deepEqual(exact.rules.find(r => r.show?.ruleName.startsWith('Runeword') && [].concat(r.show?.conditions.code ?? []).includes('uit')).show.conditions.sockets, { gte: 4, lte: 4 });

// Per-rarity looks: a rule covering two rarities splits only when one of them looks different.
const ring = f => f.rules.filter(r => r.show?.ruleName === 'Charms, jewels & jewelry: Rare amulets and crafted rings and amulets');
assert.equal(ring(regular).length, 2, 'each rarity keeps its own game colour');
const byRarity = compile(catalog, { ...base, level: 1, rarityEdits: { crafted: { N: { border: '#00ff00' } }, magic: { N: { sound: 'Filter12' } } } });
validate(byRarity);
assert.deepEqual(ring(byRarity).map(r => [r.show.conditions.rarity, r.show.tooltip.borderColor]), [['rare', regular.rules.find(r => r.show?.ruleName === ring(regular)[0].show.ruleName).show.tooltip.borderColor], ['crafted', 'RGBA(0, 255, 0, 1)']]);
assert.equal(sim(byRarity, { code: 'cm3', rarity: 'magic' }).rule.dropSound, 'Filter12', 'magic charms take the magic look');
assert.equal(sim(byRarity, { code: 'r22', rarity: 'normal' }).rule.dropSound, sim(regular, { code: 'r22', rarity: 'normal' }).rule.dropSound, 'rules without rarity keep the tier look');
assert.equal(sim(regular, { code: 'gld', rarity: 'normal', gold: 5000 }).visible, true);

// Own looks: a row look, an item look on top of it, kept through a tier change, and stacked on a rarity edit.
const own = compile(catalog, { ...base, level: 1, rowLooks: { 'runes-high': { sound: 'Filter01' } }, itemLooks: { r30: { text: '#00ff88' } } });
validate(own);
assert.equal(sim(own, { code: 'r31', rarity: 'normal' }).rule.dropSound, 'Filter01', 'row look applies to the row');
assert.equal(sim(own, { code: 'r31', rarity: 'normal' }).rule.tooltip?.textColor, sim(regular, { code: 'r31', rarity: 'normal' }).rule.tooltip?.textColor, 'untouched fields follow the tier');
const ber = sim(own, { code: 'r30', rarity: 'normal' }).rule;
assert.deepEqual([ber.conditions.code, ber.tooltip.textColor, ber.dropSound], ['r30', 'RGBA(0, 255, 136, 1)', 'Filter01'], 'item look stacks on the row look in its own rule');
const moved = compile(catalog, { ...base, level: 1, itemOverrides: { r30: 'A' }, itemLooks: { r30: { text: '#00ff88' } } });
assert.equal(sim(moved, { code: 'r30', rarity: 'normal' }).rule.tooltip.textColor, 'RGBA(0, 255, 136, 1)', 'a tier change keeps the own look');
assert.equal(sim(compile(catalog, { ...base, level: 1, itemOverrides: { r30: 'HIDE' }, itemLooks: { r30: { text: '#00ff88' } } }), { code: 'r30', rarity: 'normal' }).visible, false, 'hidden stays hidden');
const stacked = compile(catalog, { ...base, level: 1, rarityEdits: { crafted: { N: { border: '#00ff00' } } }, rowLooks: { 'rare-jewelry': { sound: 'Filter03' } } });
validate(stacked);
assert.deepEqual(ring(stacked).map(r => [r.show.conditions.rarity, r.show.tooltip.borderColor === 'RGBA(0, 255, 0, 1)', r.show.dropSound]), [['rare', false, 'Filter03'], ['crafted', true, 'Filter03']], 'own look sits on top of each rarity');

// Own label text: row names reach every item, an item's own name wins, and names Pyre refuses never reach the file.
const named = compile(catalog, { ...base, level: 1, rowLooks: { 'runes-high': { name: 'HIGH RUNE' } }, itemLooks: { r30: { name: 'BER\n!!!' } } });
validate(named);
assert.equal(sim(named, { code: 'r31', rarity: 'normal' }).rule.name, 'HIGH RUNE');
assert.equal(sim(named, { code: 'r30', rarity: 'normal' }).rule.name, 'BER\n!!!');
assert.equal(sim(compile(catalog, { ...base, level: 1, rowLooks: { 'runes-high': { name: 'Bér' } } }), { code: 'r31', rarity: 'normal' }).rule.name, undefined);
assert.equal(labelProblem('a\n\nb'), 'Remove the empty line.');
assert.equal(labelProblem('1\n2\n3\n4'), 'Use at most 3 lines.');
assert.equal(labelProblem('x'.repeat(56)), 'Keep each line to 55 characters.');
assert.equal(labelProblem('x'.repeat(50) + '\n' + 'y'.repeat(40)), 'Keep the whole label to 79 characters.');
assert.equal(labelName('  Ber  \r\n  rune '), 'Ber\nrune');

// Gold amount: small piles hide before the Gold row, bigger ones still show.
const goldy = compile(catalog, { ...base, level: 1, goldMin: 1000 });
validate(goldy);
assert.equal(sim(goldy, { code: 'gld', rarity: 'normal', gold: 999 }).visible, false, 'pile under the amount hides');
assert.equal(sim(goldy, { code: 'gld', rarity: 'normal', gold: 1000 }).visible, true, 'pile at the amount shows');
assert.equal(sim(regular, { code: 'gld', rarity: 'normal', gold: 999 }).visible, false, 'the level sets the gold amount');
assert.equal(sim(compile(catalog, { ...base, level: 6, goldMin: 0 }), { code: 'gld', rarity: 'normal', gold: 5 }).visible, true, 'Off beats the level');

// Levels: seven, saved five-level settings keep their name, and the valuables never hide.
assert.deepEqual(LEVELS.map(l => l.name), ['Starter', 'Regular', 'Semi strict', 'Strict', 'Very strict', 'Ultra strict', 'Endgame']);
assert.deepEqual([0, 1, 2, 3, 4].map(level => upgradeLevel({ level })), [0, 1, 3, 4, 6]);
assert.equal(upgradeLevel({ v: 2, level: 5 }), 5);
const endgame = compile(catalog, { ...base, level: 6 });
for (const [code, rarity] of [['uap', 'unique'], ['r20', 'normal'], ['rvl', 'normal'], ['skz', 'normal']]) {
  assert.equal(sim(endgame, { code, rarity }).visible, true, `${code} stays at Endgame`);
}
const at = (level, code, rarity = 'normal') => sim(compile(catalog, { ...base, level }), { code, rarity });
assert.deepEqual([at(5, 'r20').visible, at(5, 'r19').visible, at(4, 'r19').visible], [true, false, true], 'Ultra strict hides runes under Mid');
assert.deepEqual([at(3, 'hp5').visible, at(4, 'hp5').visible, at(4, 'mp5').visible], [true, false, false], 'super potions hide from Very strict');
for (const [level] of LEVELS.entries()) for (const code of catalog.find(c => c.id === 'maps').groups.flatMap(g => g.codes)) {
  const { rule } = at(level, code);
  assert.equal(rule.dropSound, 'Filter04', `${code} map sound`);
  assert.equal(rule.ruleName, 'Maps: Notable · own look');
}
assert.equal(sim(compile(catalog, { ...base, level: 1, rowLooks: { t3m: { sound: '' } } }), { code: catalog.find(c => c.id === 'maps').groups[0].codes[0], rarity: 'normal' }).rule.dropSound, undefined, 'a player can silence maps');

// Unique and set rows: one toggle per base, listed in one row only, named, and independent of base rows on that code.
for (const rarity of ['unique', 'set']) {
  const rows = catalog.flatMap(c => c.groups).filter(g => g.rarity === rarity), codes = rows.flatMap(g => g.codes);
  assert.equal(new Set(codes).size, codes.length, `a ${rarity} base is in two rows`);
  for (const code of Object.keys(data[rarity + 's']).filter(c => data.bases[c])) assert(codes.includes(code), `${rarity} ${code} has no row`);
}
const one = compile(catalog, { ...base, level: 1, itemOverrides: { 'uit@unique': 'HIDE' }, itemLooks: { 'uap@unique': { sound: 'Filter12' } } });
validate(one);
assert.equal(sim(one, { code: 'uit', rarity: 'unique' }).visible, false, 'one unique hides');
assert.equal(sim(one, { code: 'uit', rarity: 'normal', sockets: 4 }).visible, true, 'its white base stays');
assert.equal(sim(one, { code: 'uap', rarity: 'unique' }).rule.dropSound, 'Filter12');
assert.equal(sim(one, { code: 'uap', rarity: 'normal', sockets: 2 }).rule.dropSound !== 'Filter12', true);

for (const [level] of LEVELS.entries()) for (const code of ['u-new', 's-new'].map(id => catalog.flatMap(c => c.groups).find(g => g.id === id).codes[0])) {
  const rarity = catalog.flatMap(c => c.groups).some(g => g.id === 'u-new' && g.codes.includes(code)) ? 'unique' : 'set';
  assert.equal(at(level, code, rarity).visible, level < 2, `unlisted ${rarity} ${code} at level ${level}`);
}
assert.equal(at(1, 'r30').rule.dropSound, 'Filter06');
assert.equal(at(1, 'lbox').rule.dropSound, 'Filter06', 'Chase currency keeps the Chase sound');
for (const code of ['upma', 'crfb', 'tes', 'pk1', 'std']) assert.equal(at(6, code).rule.dropSound, 'Filter02', `${code} sound`);
assert.equal(sim(compile(catalog, { ...base, level: 1, overrides: { dclone: 'B' } }), { code: 'dcma', rarity: 'normal' }).rule.dropSound, 'Filter02', 'the sound follows the tier a row is moved to');
for (const [code, rarity] of [['rin', 'unique'], ['amu', 'unique'], ['jew', 'unique'], ['cjw', 'unique']]) assert.equal(at(6, code, rarity).rule.dropSound, 'Filter06', `unique ${code} is Chase`);

// Preset looks keep the game's name colours: 2 stars border, 3 stars a darker box, 4 stars a pale box.
const tt = (code, rarity) => at(1, code, rarity).rule.tooltip;
assert.equal(tt('uit', 'unique').borderColor, 'RGBA(199, 179, 119, 1)');
assert.equal(tt('uit', 'unique').textColor, undefined, 'Notable keeps the game text colour');
assert.equal(tt('uap', 'unique').backgroundColor, 'RGBA(109, 98, 65, 0.95)');
assert.equal(tt('uap', 'unique').textColor, 'RGBA(255, 255, 255, 1)');
assert.equal(tt('r30', 'normal').backgroundColor, 'RGBA(255, 255, 255, 0.95)');
assert.equal(tt('r30', 'normal').textColor, 'RGBA(140, 92, 0, 1)', 'runes stay orange');
assert.deepEqual(upgradeRows({}, { 'rare-jewelry': 'HIDE' }), { 'rare-jewelry': 'HIDE', 'rare-ring': 'HIDE' });
assert.deepEqual(upgradeRows({ v: 2 }, { 'rare-jewelry': 'HIDE' }), { 'rare-jewelry': 'HIDE' });
// A socketed base never hides while the same base with fewer sockets shows, and presets leave ethereal ones visible.
for (const [level] of LEVELS.entries()) {
  const f = compile(catalog, { ...base, level });
  for (const code of Object.keys(data.bases).filter(c => data.bases[c].tier === 'elite')) {
    const at = (sockets, ethereal) => sim(f, { code, rarity: 'normal', sockets, ethereal }).visible;
    for (let n = 1; n <= 6; n++) {
      if (at(1)) assert(at(n), `${code} with ${n} sockets hides before 1 socket at level ${level}`);
      assert(at(n, true), `ethereal ${code} with ${n} sockets hides at level ${level}`);
    }
  }
}

// Worst case the app allows (200 picks, 2900 kept rules, every rarity and every item looked) stays under Pyre's 4096 rules.
const allKinds = Object.fromEntries(['unique', 'set', 'rare', 'crafted', 'magic', 'base'].map(k => [k, Object.fromEntries(['S', 'A', 'N', 'B', 'SHOW'].map(t => [t, { sound: 'Filter01' }]))]));
const everyCode = catalog.flatMap(c => c.groups).flatMap(g => (g.codes ?? []).map(c => itemKey(g, c)));
const worst = compile(catalog, { ...base, level: 0, rarityEdits: allKinds,
  itemLooks: Object.fromEntries(everyCode.map((c, i) => [c, { text: '#' + (i * 2654435).toString(16).slice(-6).padStart(6, '0') }])),
  picks: Array.from({ length: 200 }, () => ({ code: 'uap', label: 'Shako', tier: 'A', ethereal: false, sockets: 0, rarity: '' })),
  imported: { from: 'x', rules: Array.from({ length: 2900 }, () => ({ show: { ruleName: 'x', conditions: { code: 'r01' } } })) } });
validate(worst);

console.log(`ok: ${ids.size} groups, rules per level ${LEVELS.map((_, l) => compile(catalog, { ...base, level: l }).rules.length).join('/')}, hide rules ${counts.join('/')}`);
