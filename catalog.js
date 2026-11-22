// What the builder lets players tier, in rule order: earlier groups win over later ones.
// Each group has a default tier `t` and optional strictness steps `s` ({level: tier}, applied from that level up).

// `B` keeps the id it had when it was the third tier, so saved filters still load.
export const TIERS = [
  { id: 'S', name: 'Chase', hint: 'Loudest sound, big minimap star, bright box' },
  { id: 'A', name: 'High Value', hint: 'Sound, minimap icon, coloured box' },
  { id: 'N', name: 'Notable', hint: 'Soft sound, small minimap icon, coloured border' },
  { id: 'B', name: 'Good', hint: 'Coloured border, small minimap dot' },
  { id: 'SHOW', name: 'Show', hint: 'Normal label, no extras' },
  { id: 'HIDE', name: 'Hide', hint: 'No label on the ground. Hold Ctrl to pick it up anyway' },
];

export const LEVELS = [
  {
    name: 'Starter', tag: 'Everything', who: 'A fresh character, Normal difficulty, or anyone who wants to see every drop.',
    text: 'Nothing is hidden. Valuable drops still get borders, sounds and minimap icons, so the good stuff stands out from the clutter. Use it while you still need potions, scrolls, ammo and any gear with stats.',
  },
  {
    name: 'Regular', tag: 'Light cleanup', who: 'Most of Nightmare, and anyone farming early Hell.',
    text: 'Removes items you almost never pick up once you have a belt of potions and a few upgrades: low potions, utility potions, ammo, chipped gems, inferior items, plain normal-tier bases and normal-tier magic gear. Every rune, charm, jewel and higher-tier item still shows.',
  },
  {
    name: 'Strict', tag: 'Medium', who: 'Hell difficulty and early maps, once your gear is mostly set.',
    text: 'Also hides low runes (El to Ral), flawed gems, greater potions, scrolls, tomes, keys, magic exceptional gear, magic rings and amulets, plain exceptional bases and socketed normal-tier bases. Socketed elite and exceptional bases, ethereal bases, rares and all currency stay visible.',
  },
  {
    name: 'Very strict', tag: 'Heavy', who: 'Mapping and boss farming with a finished build.',
    text: 'Also hides runes up to Dol, regular gems, super potions, plain elite bases, socketed exceptional bases, magic elite gear, rare normal-tier gear, large charms and magic circlets. You keep high runes, currency, maps, uber items, charms, jewels, uniques, sets and good bases.',
  },
  {
    name: 'Endgame', tag: 'Valuables only', who: 'High-tier maps and ubers, where screens fill with loot.',
    text: 'Only items with real trade or crafting value stay. Also hides mid runes up to Fal, flawless gems, small rejuvenation potions, superior elite bases, ethereal exceptional bases, rare exceptional gear and normal-tier set items. Full rejuvenation potions and gold always show.',
  },
];

const range = (prefix, from, to, pad = 2) =>
  Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(pad, '0'));

// Rune bands, highest first: [id, label, from, to, tier, strictness steps]. Rune numbers: El 1 ... Zod 33.
const RUNE_BANDS = [
  ['runes-high', 'High runes', 28, 33, 'S', {}],
  ['runes-upper', 'Upper mid runes', 23, 27, 'A', {}],
  ['runes-mid', 'Mid runes', 20, 22, 'N', {}],
  ['runes-lmid', 'Lower mid runes', 15, 19, 'B', { 4: 'HIDE' }],
  ['runes-low', 'Low runes', 9, 14, 'SHOW', { 3: 'HIDE' }],
  ['runes-start', 'Starter runes', 1, 8, 'SHOW', { 2: 'HIDE' }],
];

const gem = (q, codes) => codes.map(c => q + c);
const GEM_COLORS = ['v', 'y', 'b', 'g', 'r', 'w'];

export function buildCatalog(data) {
  const name = code => data.misc[code]?.n ?? data.bases[code]?.n ?? code;
  const codes = (id, label, list, t, s = {}, look = 'normal') => ({ id, label, codes: list, t, s, look });
  const when = (id, label, conditions, t, s = {}, look = 'normal', sample) => ({ id, label, when: conditions, t, s, look, sample });
  const mapsOf = type => Object.keys(data.misc).filter(c => data.misc[c].t === type);
  const sample = (list, tier) => (list[tier] ?? [])[0];
  // Runeword bases: by default white or superior, with at least the sockets the usual runewords need.
  // Players can change rarity, socket range and ethereal per row (compile.js alsoOf). Other bases fall through to White bases.
  const taken = new Set();
  const base = (id, label, list, sockets, t, s = {}) => {
    list.forEach(c => taken.add(c));
    return { ...codes(id, label, list, t, s, 'gray'), opts: { rarity: 'both', min: sockets, max: 0, eth: 'any' } };
  };
  const family = (id, label, types, sockets, t, s) => base(id, label,
    Object.keys(data.bases).filter(c => data.bases[c].tier === 'elite' && types.includes(data.bases[c].t) && !taken.has(c)), sockets, t, s);

  return [
    {
      id: 'runes', label: 'Runes', blurb: 'Runes in bands from Zod down to El. Expand a band to tier single runes.',
      groups: RUNE_BANDS.map(([id, label, from, to, t, s]) => {
        const list = Array.from({ length: to - from + 1 }, (_, i) => 'r' + String(to - i).padStart(2, '0')); // highest first
        const short = c => name(c).replace(/ Rune$/, '');
        return codes(id, `${label} (${short(list[0])} to ${short(list.at(-1))})`, list, t, s, 'rune');
      }),
    },
    {
      id: 'currency', label: 'Orbs & currency', blurb: 'PD2 crafting currency: orbs, shards, puzzle pieces and infusions.',
      groups: [
        codes('cur-pinnacle', 'Pinnacle currency', ['lbox', 'cwss'], 'S', {}, 'crafted'),
        codes('cur-map', 'Map orbs', ['upmp', 'fort', 'scou'], 'A', {}, 'crafted'),
        codes('cur-orbs', 'Crafting orbs', ['upma', 'imra', 'rera', 'imma', 'imrn'], 'A', {}, 'crafted'),
        codes('infused', 'Infused orbs', ['irma', 'irrn', 'irra', 'rrra', 'urma'], 'A', {}, 'crafted'),
        codes('wss', 'Worldstone and Catalyst shards', ['wss', 'iwss'], 'A', {}, 'crafted'),
        codes('cur-mats', 'Larzuk, Horadrim and uber materials', ['cm2f', 'lpp', 'scrb', 'rkey', 'toa'], 'A', {}, 'crafted'),
        codes('crft', 'Craft infusions', ['crfb', 'crfc', 'crfs', 'crfh', 'crfv', 'crfu', 'crfp'], 'B', {}, 'crafted'),
        codes('cur-minor', 'Malus and jewel fragments', ['lmal', 'jewf'], 'B', {}, 'crafted'),
        codes('elx', name('elx') + ' and ' + name('0sc'), ['elx', '0sc'], 'B'),
      ],
    },
    {
      id: 'ubers', label: 'Ubers & bosses', blurb: 'Keys, organs, essences and pinnacle boss pieces.',
      groups: [
        codes('dclone', 'Diablo Clone pieces', ['dcma', 'dcbl', 'dcho', 'dcso'], 'S', {}, 'unique'),
        codes('rathma', 'Rathma and Lilith pieces', ['rtma', 'rtmo', 'rtmv', 'rtmf', 'llmr', 'lsvl'], 'S', {}, 'unique'),
        codes('navigator', name('rtp') + ' and ' + name('rid'), ['rtp', 'rid'], 'S', {}, 'unique'),
        codes('luv', name('luv'), ['luv'], 'S', {}, 'unique'),
        codes('ancients', 'Ancients relics and sigils', ['uba', 'ubaa', 'ubab', 'ubac', 'ubtm'], 'A', {}, 'unique'),
        codes('lucion', 'Lucion pieces', ['luca', 'lucb', 'lucc', 'lucd'], 'A', {}, 'unique'),
        codes('ears', 'Corrupted ears', ['ivea', 'ivez', 'iveb', 'ived', 'iven', 'ivep', 'ives'], 'A', {}, 'unique'),
        codes('ukeys', 'Uber keys', ['pk1', 'pk2', 'pk3'], 'A', {}, 'unique'),
        codes('organs', 'Uber organs', ['dhn', 'bey', 'mbr'], 'A', {}, 'unique'),
        codes('shards', 'Worldstone fragments', range('xa', 1, 5, 1), 'A', {}, 'unique'),
        codes('essences', 'Essences', ['tes', 'ceh', 'bet', 'fed'], 'N', {}, 'unique'),
        codes('tokens', 'Defender, Protector and Guardian tokens', range('um', 1, 6, 1), 'B', {}, 'unique'),
        codes('std', name('std'), ['std'], 'B', {}, 'unique'),
      ],
    },
    {
      id: 'maps', label: 'Maps', blurb: 'Map drops by tier. Rarity does not change these rows.',
      groups: [
        codes('t3m', 'Tier 3 maps', mapsOf('t3m'), 'A'),
        codes('t2m', 'Tier 2 maps', mapsOf('t2m'), 'N'),
        codes('t1m', 'Tier 1 maps', mapsOf('t1m'), 'B'),
      ],
    },
    {
      id: 'gems', label: 'Gems', blurb: 'All seven gem colours by quality.',
      groups: [
        codes('gem-perfect', 'Perfect gems', [...gem('gp', GEM_COLORS), 'skz'], 'B'),
        codes('gem-flawless', 'Flawless gems', [...['gzv', 'gly', 'glb', 'glg', 'glr', 'glw'], 'skl'], 'SHOW', { 4: 'HIDE' }),
        codes('gem-normal', 'Gems', [...gem('gs', GEM_COLORS), 'sku'], 'SHOW', { 3: 'HIDE' }),
        codes('gem-flawed', 'Flawed gems', [...gem('gf', GEM_COLORS), 'skf'], 'SHOW', { 2: 'HIDE' }),
        codes('gem-chipped', 'Chipped gems', [...gem('gc', GEM_COLORS), 'skc'], 'SHOW', { 1: 'HIDE' }),
      ],
    },
    {
      id: 'jewelry', label: 'Charms, jewels & jewelry', blurb: 'Rings, amulets, charms, jewels and circlets by rarity.',
      groups: [
        when('cs2', 'Sunder charms', { code: 'cs2' }, 'S', {}, 'unique', 'Grand Charm'),
        when('uniq-charm', 'Unique charms', { itemType: 'char', rarity: 'unique' }, 'S', {}, 'unique', 'Annihilus'),
        when('torch', 'Torches', { code: 'tch' }, 'S', {}, 'unique', 'Hellfire Torch'),
        when('cjw', 'Colossal jewels', { code: 'cjw' }, 'A', {}, 'unique', 'Colossal Jewel'),
        when('uniq-jewelry', 'Unique rings and amulets', { itemType: ['ring', 'amul'], rarity: 'unique' }, 'A', {}, 'unique', "The Stone of Jordan"),
        when('uniq-jewel', 'Unique jewels', { itemType: 'jewl', rarity: 'unique' }, 'A', {}, 'unique', 'Rainbow Facet'),
        when('set-jewelry', 'Set rings and amulets', { itemType: ['ring', 'amul'], rarity: 'set' }, 'N', {}, 'set', "Tal Rasha's Adjudication"),
        when('rare-jewelry', 'Rare and crafted rings and amulets', { itemType: ['ring', 'amul'], rarity: ['rare', 'crafted'] }, 'N', {}, 'rare', 'Rare Ring'),
        when('rare-jewel', 'Rare and crafted jewels', { itemType: 'jewl', rarity: ['rare', 'crafted'] }, 'B', {}, 'rare', 'Rare Jewel'),
        when('rare-circlet', 'Rare and crafted circlets', { itemType: 'circ', rarity: ['rare', 'crafted'] }, 'B', {}, 'rare', 'Rare Diadem'),
        when('gc', 'Magic grand charms', { itemType: 'lcha', rarity: 'magic' }, 'N', {}, 'magic', 'Grand Charm'),
        when('sc', 'Magic small charms', { itemType: 'scha', rarity: 'magic' }, 'B', {}, 'magic', 'Small Charm'),
        when('lc', 'Magic large charms', { itemType: 'mcha', rarity: 'magic' }, 'SHOW', { 3: 'HIDE' }, 'magic', 'Large Charm'),
        when('magic-jewel', 'Magic jewels', { itemType: 'jewl', rarity: 'magic' }, 'SHOW', {}, 'magic', 'Jewel'),
        when('magic-circlet', 'Magic circlets', { itemType: 'circ', rarity: 'magic' }, 'SHOW', { 3: 'HIDE' }, 'magic', 'Circlet'),
        when('magic-jewelry', 'Magic rings and amulets', { itemType: ['ring', 'amul'], rarity: 'magic' }, 'SHOW', { 2: 'HIDE' }, 'magic', 'Amulet'),
      ],
    },
    {
      id: 'uniques', label: 'Uniques & sets', blurb: 'Equipment by base tier. A filter cannot tell two uniques on the same base apart.',
      groups: [
        when('u-elite', 'Elite uniques', { rarity: 'unique', tier: 'elite' }, 'A', {}, 'unique', sample(data.uniques, 'elite')),
        when('u-exc', 'Exceptional uniques', { rarity: 'unique', tier: 'exceptional' }, 'N', {}, 'unique', sample(data.uniques, 'exceptional')),
        when('u-norm', 'Normal uniques', { rarity: 'unique', tier: 'normal' }, 'B', { 2: 'SHOW' }, 'unique', sample(data.uniques, 'normal')),
        when('u-other', 'Other uniques', { rarity: 'unique' }, 'B', {}, 'unique', 'Unique item'),
        when('s-elite', 'Elite set items', { rarity: 'set', tier: 'elite' }, 'N', {}, 'set', sample(data.sets, 'elite')),
        when('s-exc', 'Exceptional set items', { rarity: 'set', tier: 'exceptional' }, 'SHOW', {}, 'set', sample(data.sets, 'exceptional')),
        when('s-norm', 'Normal set items', { rarity: 'set', tier: 'normal' }, 'SHOW', { 4: 'HIDE' }, 'set', sample(data.sets, 'normal')),
        when('s-other', 'Other set items', { rarity: 'set' }, 'SHOW', {}, 'set', 'Set item'),
      ],
    },
    {
      id: 'rwbases', label: 'Runeword & crafting bases',
      blurb: 'Elite white and superior bases with enough sockets for the usual runewords, plus magic bases for crafting. Bases with fewer sockets fall through to White bases.',
      groups: [
        base('rw-armor', 'Premier body armours', ['utp', 'uui', 'uea', 'urs', 'uar', 'uth', 'uld', 'uul', 'upl'], 3, 'A'),
        base('rw-pb', 'Phase Blades', ['7cr', '7cr2'], 5, 'A'),
        base('rw-zerk', 'Berserker Axes', ['7wa'], 5, 'A'),
        base('rw-monarch', 'Monarch, Aegis and Ward', ['uit', 'uow', 'uts'], 4, 'A'),
        family('rw-pala', 'Paladin shields', ['ashd'], 4, 'A'),
        family('rw-pole', 'Elite polearms and scythes', ['pole', 'sc9'], 4, 'A'),
        base('rw-diadem', 'Diadems and tiaras', ['ci3', 'ci2'], 2, 'A'),
        family('rw-helm', 'Elite helms', ['helm'], 2, 'N'),
        family('rw-tors', 'Other elite body armours', ['tors'], 3, 'N'),
        family('rw-shield', 'Other elite shields', ['shie'], 2, 'N'),
        family('rw-class', 'Elite class items: orbs, heads, pelts, barbarian helms, grimoires', ['orb', 'head', 'pelt', 'phlm', 'grim'], 2, 'N'),
        family('rw-sword', 'Elite swords', ['swor', '2hcs'], 4, 'N'),
        family('rw-axe', 'Elite axes', ['axe'], 4, 'N'),
        family('rw-bow', 'Elite bows and crossbows', ['bow', 'xbow', 'abow'], 4, 'N'),
        family('rw-spear', 'Elite spears', ['spea', 'aspe'], 4, 'N'),
        family('rw-blunt', 'Elite maces, hammers and clubs', ['mace', 'hamm', 'club'], 3, 'N'),
        family('rw-caster', 'Elite staves, wands and scepters', ['staf', 'wand', 'scep'], 2, 'N'),
        family('rw-claw', 'Elite claws', ['h2h2'], 3, 'N'),
        family('rw-small', 'Elite daggers, javelins and throwing weapons', ['knif', 'tkni', 'taxe', 'jave', 'ajav'], 2, 'B'),
        when('craft-magic', 'Magic elite gloves, belts and boots', { itemType: ['glov', 'belt', 'boot'], rarity: 'magic', tier: 'elite' }, 'N', {}, 'magic', 'Vampirebone Gloves'),
      ],
    },
    {
      id: 'bases', label: 'White bases', blurb: 'Normal and superior gear for runewords and crafting.',
      groups: [
        when('eth-elite', 'Ethereal elite bases', { rarity: ['normal', 'superior'], tier: 'elite', ethereal: true }, 'A', {}, 'gray', 'Ethereal Thresher'),
        when('sock-elite', 'Socketed elite bases', { rarity: ['normal', 'superior'], tier: 'elite', sockets: { gte: 1 } }, 'N', {}, 'gray', 'Monarch [4]'),
        when('sup-elite', 'Superior elite bases', { rarity: 'superior', tier: 'elite' }, 'SHOW', { 4: 'HIDE' }, 'normal', 'Superior Archon Plate'),
        when('elite', 'Plain elite bases', { rarity: 'normal', tier: 'elite' }, 'SHOW', { 3: 'HIDE' }, 'normal', 'Archon Plate'),
        when('eth-exc', 'Ethereal exceptional bases', { rarity: ['normal', 'superior'], tier: 'exceptional', ethereal: true }, 'SHOW', { 4: 'HIDE' }, 'gray', 'Ethereal Cryptic Axe'),
        when('sock-exc', 'Socketed exceptional bases', { rarity: ['normal', 'superior'], tier: 'exceptional', sockets: { gte: 1 } }, 'SHOW', { 3: 'HIDE' }, 'gray', 'Crystal Sword [4]'),
        when('exc', 'Plain exceptional bases', { rarity: ['normal', 'superior'], tier: 'exceptional' }, 'SHOW', { 2: 'HIDE' }, 'normal', 'Sharkskin Gloves'),
        when('sock-norm', 'Socketed normal bases', { rarity: ['normal', 'superior'], tier: 'normal', sockets: { gte: 1 } }, 'SHOW', { 2: 'HIDE' }, 'gray', 'Broad Sword [3]'),
        when('norm', 'Plain normal bases', { rarity: ['normal', 'superior'], tier: 'normal' }, 'SHOW', { 1: 'HIDE' }, 'normal', 'Short Sword'),
        when('inferior', 'Inferior items', { rarity: 'inferior' }, 'SHOW', { 1: 'HIDE' }, 'gray', 'Cracked Short Sword'),
      ],
    },
    {
      id: 'magic', label: 'Rare, crafted & magic gear', blurb: 'Weapons and armour with affixes.',
      groups: [
        when('crafted', 'Crafted gear', { rarity: 'crafted' }, 'N', {}, 'crafted', 'Crafted Gloves'),
        when('r-elite', 'Rare elite gear', { rarity: 'rare', tier: 'elite' }, 'SHOW', {}, 'rare', 'Rare Elite Helm'),
        when('r-exc', 'Rare exceptional gear', { rarity: 'rare', tier: 'exceptional' }, 'SHOW', { 4: 'HIDE' }, 'rare', 'Rare Exceptional Boots'),
        when('r-norm', 'Rare normal gear', { rarity: 'rare', tier: 'normal' }, 'SHOW', { 3: 'HIDE' }, 'rare', 'Rare Gloves'),
        when('m-elite', 'Magic elite gear', { rarity: 'magic', tier: 'elite' }, 'SHOW', { 3: 'HIDE' }, 'magic', 'Magic Monarch'),
        when('m-exc', 'Magic exceptional gear', { rarity: 'magic', tier: 'exceptional' }, 'SHOW', { 2: 'HIDE' }, 'magic', 'Magic Grim Shield'),
        when('m-norm', 'Magic normal gear', { rarity: 'magic', tier: 'normal' }, 'SHOW', { 1: 'HIDE' }, 'magic', 'Magic Buckler'),
      ],
    },
    {
      id: 'misc', label: 'Potions & misc', blurb: 'Potions, scrolls, keys, ammo and gold. Gold is always picked up, even when hidden.',
      groups: [
        codes('rvl', name('rvl'), ['rvl'], 'SHOW', {}, 'potion-r'),
        codes('rvs', name('rvs'), ['rvs'], 'SHOW', { 4: 'HIDE' }, 'potion-r'),
        codes('pot5', 'Super healing and mana potions', ['hp5', 'mp5'], 'SHOW', { 3: 'HIDE' }, 'potion-h'),
        codes('pot4', 'Greater healing and mana potions', ['hp4', 'mp4'], 'SHOW', { 2: 'HIDE' }, 'potion-h'),
        codes('pot-low', 'Minor, light and plain healing and mana potions', ['hp1', 'hp2', 'hp3', 'mp1', 'mp2', 'mp3'], 'SHOW', { 1: 'HIDE' }, 'potion-h'),
        codes('pot-util', 'Stamina, antidote and thawing potions', ['vps', 'yps', 'wms'], 'SHOW', { 1: 'HIDE' }),
        codes('scrolls', 'Town portal and identify scrolls', ['tsc', 'isc'], 'SHOW', { 2: 'HIDE' }),
        codes('tomes', 'Tomes', ['tbk', 'ibk'], 'SHOW', { 2: 'HIDE' }),
        codes('keys', 'Keys', ['key'], 'SHOW', { 2: 'HIDE' }),
        codes('ammo', 'Arrows and bolts', ['aqv', 'aqv2', 'aqv3', 'cqv', 'cqv2', 'cqv3'], 'SHOW', { 1: 'HIDE' }),
        codes('gold', 'Gold', ['gld'], 'SHOW', {}, 'gold'),
      ],
    },
  ];
}

// Colour presets for Looks & sounds. The FilterBlade styles use the apex/A/B/C currency tier label colours of
// NeverSink's PoE filter styles (MIT, github.com/NeverSinkDev/NeverSink-Filter) for Chase/High Value/Notable/Good.
// NeverSink gives every style the same minimap icons; ours give each style its own shapes in its own palette.
// Player edits are layered on top of the chosen theme.
const icon = (shape, size, fill, border = '#ffffff') => ({ shape, size, fill, border });
const look = (border, background, sound, ic, text = '', bgAlpha = 0.85) => ({ text, border, background, bgAlpha, sound, icon: ic });
const plain = look('', '', '', null);

export const THEMES = [
  { id: 'resurrected', group: 'Resurrected', name: 'Resurrected', styles: {
    S: look('#ff3c3c', '#5a0000', 'Filter06', icon('star', 16, '#ff4444'), '', 0.9),
    A: look('#ff9100', '#2b1500', 'Filter05', icon('diamond', 12, '#ff9100')),
    N: look('#ffd24a', '#1f1a08', 'Filter07', icon('kite', 10, '#ffd24a')),
    B: look('#c9c1a0', '', '', icon('circle', 8, '#e6d278', '#000000')),
    SHOW: plain } },
  { id: 'sanctuary', group: 'Resurrected', name: 'Sanctuary Gold', styles: {
    S: look('#ffe08a', '#3b2a05', 'Filter06', icon('star', 16, '#ffd24a')),
    A: look('#e0a040', '#24170a', 'Filter04', icon('diamond', 12, '#e0a040')),
    N: look('#b99555', '', 'Filter08', icon('kite', 10, '#b99555')),
    B: look('#7d6a4a', '', '', icon('circle', 8, '#9d8a6a', '#000000')),
    SHOW: plain } },
  { id: 'neon', group: 'Resurrected', name: 'Neon', styles: {
    S: look('#ff3df2', '#2a0028', 'Filter06', icon('star', 16, '#ff3df2')),
    A: look('#00e5ff', '#002228', 'Filter05', icon('hexagon', 12, '#00e5ff')),
    N: look('#7dff5a', '#0b1f06', 'Filter08', icon('diamond', 10, '#7dff5a')),
    B: look('#8c7dff', '', '', icon('circle', 8, '#8c7dff', '#000000')),
    SHOW: plain } },
  { id: 'bloodmoon', group: 'Resurrected', name: 'Blood Moon', styles: {
    S: look('#ffb347', '#4a0a00', 'Filter06', icon('bullseye', 16, '#ff5a1f')),
    A: look('#e02424', '#2a0000', 'Filter05', icon('diamond', 12, '#e02424')),
    N: look('#ff7a3d', '', 'Filter09', icon('triangle', 10, '#ff7a3d')),
    B: look('#a04848', '', '', icon('circle', 8, '#a04848', '#000000')),
    SHOW: plain } },
  { id: 'frost', group: 'Resurrected', name: 'Frost', styles: {
    S: look('#9af3ff', '#062a33', 'Filter06', icon('spark', 16, '#9af3ff')),
    A: look('#4aa8ff', '#061a33', 'Filter04', icon('diamond', 12, '#4aa8ff')),
    N: look('#4de0c0', '', 'Filter10', icon('hexagon', 10, '#4de0c0')),
    B: look('#7f9ab5', '', '', icon('circle', 8, '#7f9ab5', '#000000')),
    SHOW: plain } },
  { id: 'minimal', group: 'Resurrected', name: 'Minimal', styles: {
    S: look('#ffffff', '', 'Filter06', icon('star', 14, '#ffffff', '#000000')),
    A: look('#bdbdbd', '', 'Filter05', icon('circle', 10, '#bdbdbd', '#000000')),
    N: look('#8a8a8a', '', '', icon('circle', 7, '#8a8a8a', '#000000')),
    B: look('#555555', '', '', null),
    SHOW: plain } },
  { id: 'fb-classic', name: 'Classic', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff4040', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#f05a23', 'Filter05', icon('diamond', 14, '#f05a23', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#f05a23', 'Filter07', icon('triangle', 12, '#f99619', '#000000'), '#000000', 1.0),
    B: look('#000000', '#f99619', '', icon('circle', 9, '#ffffff', '#000000'), '#000000', 1.0),
    SHOW: plain } },
  { id: 'fb-abyss', name: 'Abyss', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('bullseye', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ff0000', '#280005', 'Filter05', icon('hexagon', 14, '#ff4040', '#ffffff'), '#ff0000', 1.0),
    N: look('#90e538', '#002905', 'Filter07', icon('diamond', 12, '#90e538', '#000000'), '#90e538', 1.0),
    B: look('#90e538', '#141400', '', icon('circle', 9, '#6fae2a', '#000000'), '#90e538', 1.0),
    SHOW: plain } },
  { id: 'fb-alloy', name: 'Alloy', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#eab22b', 'Filter05', icon('square', 14, '#eab22b', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#eab22b', 'Filter07', icon('diamond', 12, '#eab22b', '#000000'), '#000000', 1.0),
    B: look('#000000', '#c9c0bb', '', icon('circle', 9, '#c9c0bb', '#000000'), '#000000', 1.0),
    SHOW: plain } },
  { id: 'fb-azurite', name: 'Azurite', group: 'FilterBlade styles', styles: {
    S: look('#0094ff', '#ffffff', 'Filter06', icon('spark', 16, '#0094ff', '#ffffff'), '#0094ff', 1.0),
    A: look('#ffffff', '#0094ff', 'Filter05', icon('diamond', 14, '#4fb3ff', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#82d6ff', 'Filter07', icon('kite', 12, '#82d6ff', '#000000'), '#000000', 1.0),
    B: look('#000000', '#82d6ff', '', icon('circle', 9, '#ffffff', '#000000'), '#000000', 1.0),
    SHOW: plain } },
  { id: 'fb-cobalt', name: 'Cobalt', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#b90078', 'Filter05', icon('hexagon', 14, '#e0189a', '#ffffff'), '#ffffff', 1),
    N: look('#ffffff', '#821ebe', 'Filter07', icon('diamond', 12, '#9b3ad8', '#000000'), '#ffffff', 1),
    B: look('#ffffff', '#3246be', '', icon('circle', 9, '#4a63e0', '#000000'), '#ffffff', 1),
    SHOW: plain } },
  { id: 'fb-crimson', name: 'Crimson', group: 'FilterBlade styles', styles: {
    S: look('#d71414', '#ffffff', 'Filter06', icon('bullseye', 16, '#ff3030', '#ffffff'), '#d71414', 1.0),
    A: look('#ffffff', '#d71414', 'Filter05', icon('diamond', 14, '#ff4b4b', '#ffffff'), '#ffffff', 1.0),
    N: look('#ffffff', '#970707', 'Filter07', icon('triangle', 12, '#c73030', '#000000'), '#ffffff', 1.0),
    B: look('#c7c7c7', '#970707', '', icon('circle', 9, '#c7c7c7', '#000000'), '#c7c7c7', 1.0),
    SHOW: plain } },
  { id: 'fb-elder', name: 'Elder', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffaa78', '#280c0c', 'Filter05', icon('hexagon', 14, '#ffaa78', '#ffffff'), '#ffaa78', 1.0),
    N: look('#ffaa78', '#141400', 'Filter07', icon('kite', 12, '#ffaa78', '#000000'), '#ffaa78', 1.0),
    B: look('#f5c378', '#141400', '', icon('circle', 9, '#f5c378', '#000000'), '#f5c378', 1.0),
    SHOW: plain } },
  { id: 'fb-gaia', name: 'Gaia', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('spark', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#fa6e5a', 'Filter05', icon('diamond', 14, '#fa6e5a', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#fa6e5a', 'Filter07', icon('kite', 12, '#fa6e5a', '#000000'), '#000000', 1.0),
    B: look('#000000', '#e39b2c', '', icon('circle', 9, '#e39b2c', '#000000'), '#000000', 1.0),
    SHOW: plain } },
  { id: 'fb-lunaris', name: 'Lunaris', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#f05a23', 'Filter05', icon('chevron', 14, '#f05a23', '#ffffff'), '#ffffff', 1.0),
    N: look('#ff6400', '#530e0e', 'Filter07', icon('triangle', 12, '#ff6400', '#000000'), '#ff6400', 1.0),
    B: look('#ffcf84', '#4c330c', '', icon('circle', 9, '#ffcf84', '#000000'), '#ffcf84', 1.0),
    SHOW: plain } },
  { id: 'fb-necros', name: 'Necros', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('cross', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#fcffff', '#d97f0a', 'Filter05', icon('diamond', 14, '#d97f0a', '#ffffff'), '#fcffff', 1.0),
    N: look('#fcffb4', '#d97f0a', 'Filter07', icon('kite', 12, '#fcffb4', '#000000'), '#fcffb4', 1.0),
    B: look('#fcffb4', '#928300', '', icon('circle', 9, '#c9b800', '#000000'), '#fcffb4', 1.0),
    SHOW: plain } },
  { id: 'fb-purple', name: 'Purple', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('star', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#f05a23', 'Filter05', icon('hexagon', 14, '#f05a23', '#ffffff'), '#ffffff', 1.0),
    N: look('#140028', '#f05a23', 'Filter07', icon('diamond', 12, '#f99619', '#000000'), '#140028', 1.0),
    B: look('#140028', '#f99619', '', icon('circle', 9, '#9b6bff', '#000000'), '#140028', 1.0),
    SHOW: plain } },
  { id: 'fb-vaal', name: 'Vaal', group: 'FilterBlade styles', styles: {
    S: look('#ff0000', '#ffffff', 'Filter06', icon('bullseye', 16, '#ff2020', '#ffffff'), '#ff0000', 1.0),
    A: look('#ffffff', '#be1e1e', 'Filter05', icon('triangleDown', 14, '#e03030', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#be1e1e', 'Filter07', icon('diamond', 12, '#ff5a3a', '#000000'), '#000000', 1.0),
    B: look('#000000', '#b44c3a', '', icon('circle', 9, '#b44c3a', '#000000'), '#000000', 1.0),
    SHOW: plain } },
  { id: 'fb-velvet', name: 'Velvet', group: 'FilterBlade styles', styles: {
    S: look('#ea57df', '#ffffff', 'Filter06', icon('star', 16, '#ea57df', '#ffffff'), '#ea57df', 1.0),
    A: look('#ffffff', '#ea57df', 'Filter05', icon('kite', 14, '#ea57df', '#ffffff'), '#ffffff', 1.0),
    N: look('#000000', '#ea57df', 'Filter07', icon('diamond', 12, '#c865f2', '#000000'), '#000000', 1.0),
    B: look('#000000', '#c865f2', '', icon('circle', 9, '#ffffff', '#000000'), '#000000', 1.0),
    SHOW: plain } },
];
