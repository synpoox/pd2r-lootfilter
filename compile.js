// Turns builder settings into a Pyre Loot Filter filter.json (schema v3, first matching rule wins),
// and evaluates items against it the way the plugin does, for the simulator.
import { TIERS, THEMES } from './catalog.js';

const MAX_VALUES = 64; // Pyre rejects condition arrays longer than this
export const STYLED = ['S', 'A', 'N', 'B', 'SHOW'];

export function presetTier(group, level) {
  let tier = group.t;
  for (const [from, t] of Object.entries(group.s)) if (level >= Number(from)) tier = t;
  return tier;
}

// Extra conditions of a base row: its default options with the player's changes on top.
export const BASE_RARITY = { both: ['normal', 'superior'], normal: 'normal', superior: 'superior' };
export const baseOpts = (group, state) => ({ ...group.opts, ...state.baseOptions?.[group.id] });
export function alsoOf(group, state) {
  if (!group.opts) return undefined;
  const o = baseOpts(group, state);
  const also = { rarity: BASE_RARITY[o.rarity] };
  const sockets = {};
  if (o.min > 0) sockets.gte = o.min;
  if (o.max > 0) sockets.lte = Math.max(o.max, o.min);
  if (Object.keys(sockets).length) also.sockets = sockets;
  if (o.eth !== 'any') also.ethereal = o.eth === 'only';
  return also;
}

export const tierOf = (group, state) => state.overrides[group.id] ?? presetTier(group, state.level);
export const itemTierOf = (group, code, state) => state.itemOverrides?.[code] ?? tierOf(group, state);

// Rarity groups that can get their own look per tier, on top of the tier look.
export const KINDS = [
  { id: 'unique', name: 'Unique', rarities: ['unique'] },
  { id: 'set', name: 'Set', rarities: ['set'] },
  { id: 'rare', name: 'Rare', rarities: ['rare'] },
  { id: 'crafted', name: 'Crafted', rarities: ['crafted', 'tempered'] },
  { id: 'magic', name: 'Magic', rarities: ['magic'] },
  { id: 'base', name: 'White bases', rarities: ['inferior', 'normal', 'superior'] },
];
const KIND_OF = Object.fromEntries(KINDS.flatMap(k => k.rarities.map(r => [r, k.id])));
// The kinds a rule's rarity condition covers; empty when it does not check rarity.
export const kindsOf = conditions => [...new Set(list(conditions?.rarity ?? []).map(r => KIND_OF[r]).filter(Boolean))];

export const merge = (base, edit = {}) => {
  const icon = 'icon' in edit ? edit.icon : base.icon;
  return { ...base, ...edit, icon: icon && { ...(base.icon ?? {}), ...icon } };
};

// An entry's own look: the row's edit, then the item's edit on top. Only changed fields, so the rest follow the tier.
export function entryLook(state, group, code) {
  const row = state.rowLooks?.[group.id], item = code ? state.itemLooks?.[code] : null;
  if (!row && !item) return null;
  if (!row || !item) return { ...(row ?? item) };
  const out = { ...row, ...item };
  if (row.icon && item.icon) out.icon = { ...row.icon, ...item.icon };
  return out;
}

// The chosen theme with the player's own edits on top, then the edits for one rarity kind if given.
export function effectiveStyles(state, kind) {
  const theme = (THEMES.find(t => t.id === state.theme) ?? THEMES[0]).styles;
  const out = {};
  for (const tier of STYLED) {
    out[tier] = merge(theme[tier], state.styleEdits?.[tier]);
    if (kind) out[tier] = merge(out[tier], state.rarityEdits?.[kind]?.[tier]);
  }
  return out;
}

// Pyre's own label text: 1 to 3 lines of 1 to 55 plain ASCII characters, 79 at most in all.
// One bad name makes Pyre refuse the whole file, so anything else is reported and never written.
export function labelProblem(v) {
  const text = String(v ?? '').replace(/\r/g, '').trim();
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim());
  if (lines.length > 3) return 'Use at most 3 lines.';
  if (lines.some(l => !l)) return 'Remove the empty line.';
  if (lines.some(l => !/^[\x20-\x7e]+$/.test(l))) return 'Use plain English letters, numbers and symbols only (no accents or emoji).';
  if (lines.some(l => l.length > 55)) return 'Keep each line to 55 characters.';
  if (lines.join('\n').length > 79) return 'Keep the whole label to 79 characters.';
  return '';
}
export const labelName = v => (labelProblem(v) ? '' : String(v ?? '').replace(/\r/g, '').trim().split('\n').map(l => l.trim()).join('\n'));

export function rgba(hex, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `RGBA(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function decorate(block, style) {
  const tooltip = {};
  if (style.text) tooltip.textColor = rgba(style.text);
  if (style.border) tooltip.borderColor = rgba(style.border);
  if (style.background) tooltip.backgroundColor = rgba(style.background, style.bgAlpha ?? 0.85);
  if (Object.keys(tooltip).length) block.tooltip = tooltip;
  if (labelName(style.name)) block.name = labelName(style.name);
  if (style.sound) block.dropSound = style.sound;
  if (style.icon) {
    block.minimapIcon = { shape: style.icon.shape, borderColor: rgba(style.icon.border), fillColor: rgba(style.icon.fill), size: style.icon.size };
  }
  return block;
}

function rule(tier, ruleName, conditions, styles, look) {
  const block = { ruleName, conditions };
  return tier === 'HIDE' ? { hide: block } : { show: decorate(block, look ? merge(styles[tier], look) : styles[tier]) };
}

// One rule, styled for the rarities it checks. A rule spanning kinds that look different is split per kind.
function emit(rules, tier, ruleName, conditions, state, styles, look = null) {
  const kinds = tier === 'HIDE' ? [] : kindsOf(conditions);
  const edited = kinds.filter(k => Object.keys(state.rarityEdits?.[k]?.[tier] ?? {}).length);
  if (kinds.length === 1 || (kinds.length > 1 && !edited.length)) return rules.push(rule(tier, ruleName, conditions, styles(edited[0] ?? kinds[0]), look));
  if (!kinds.length) return rules.push(rule(tier, ruleName, conditions, styles(), look));
  for (const k of kinds) {
    const rarity = list(conditions.rarity).filter(r => KIND_OF[r] === k);
    rules.push(rule(tier, ruleName, { ...conditions, rarity: rarity.length === 1 ? rarity[0] : rarity }, styles(k), look));
  }
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

export function pickConditions(pick) {
  const conditions = { code: pick.code };
  if (pick.rarity) conditions.rarity = pick.rarity;
  if (pick.ethereal) conditions.ethereal = true;
  if (pick.sockets) conditions.sockets = { gte: pick.sockets };
  return conditions;
}

export function compile(catalog, state) {
  const rules = [];
  const cache = {};
  const styles = (kind = '') => (cache[kind] ??= effectiveStyles(state, kind));
  const tierName = id => TIERS.find(t => t.id === id).name;

  for (const pick of state.picks) {
    emit(rules, pick.tier, `My pick: ${pick.label}`, pickConditions(pick), state, styles);
  }
  // Rules kept from a filter the builder did not make, exactly as they were.
  rules.push(...(state.imported?.rules ?? []));

  for (const category of catalog) {
    // Gold under the chosen amount: hidden before the Gold row shows the rest. Pyre reads a pile's amount as its quantity.
    const gold = category.groups.find(g => g.id === 'gold');
    if (gold && state.goldMin > 0 && tierOf(gold, state) !== 'HIDE') {
      rules.push({ hide: { ruleName: `${category.label}: Gold under ${state.goldMin}`, conditions: { code: 'gld', quantity: { lt: state.goldMin } } } });
    }
    // Code groups never overlap each other, so merge their items per tier (and extra conditions) to keep the file short.
    const byTier = new Map();
    for (const group of category.groups) {
      if (group.codes) {
        for (const code of group.codes) {
          const tier = itemTierOf(group, code, state);
          const also = alsoOf(group, state);
          const look = tier === 'HIDE' ? null : entryLook(state, group, code);
          const key = tier + JSON.stringify(also ?? {}) + JSON.stringify(look);
          if (!byTier.has(key)) byTier.set(key, { tier, also, look, codes: [] });
          byTier.get(key).codes.push(code);
        }
      } else {
        emit(rules, tierOf(group, state), `${category.label}: ${group.label}`, group.when, state, styles, entryLook(state, group));
      }
    }
    for (const { tier, also, look, codes } of byTier.values()) {
      for (const part of chunk([...new Set(codes)], MAX_VALUES)) {
        emit(rules, tier, `${category.label}: ${tierName(tier)}${look ? ' · own look' : ''}`, { code: part.length === 1 ? part[0] : part, ...also }, state, styles, look);
      }
    }
  }

  const filter = { version: 3, rules };
  if (state.name?.trim()) return { name: state.name.trim(), ...filter };
  return filter;
}

/* ---------- evaluation (simulator) ---------- */

// Every item type an item belongs to, by code and by name, following itemtypes.txt parents.
function typesOf(code, data) {
  const item = data.misc[code] ?? data.bases[code];
  const seen = new Set();
  const walk = t => {
    if (!t || seen.has(t) || !data.types[t]) return;
    seen.add(t);
    data.types[t].p.forEach(walk);
  };
  walk(item?.t);
  return new Set([...seen, ...[...seen].map(t => data.types[t].n)]);
}

const list = v => (Array.isArray(v) ? v : [v]);
const num = (test, value) => Boolean(test) && typeof test === 'object' && Object.entries(test).every(([op, n]) =>
  op === 'eq' ? value === n : op === 'gt' ? value > n : op === 'gte' ? value >= n : op === 'lt' ? value < n : op === 'lte' ? value <= n : true);

export function matches(conditions, item, data) {
  const base = data.bases[item.code];
  for (const [key, want] of Object.entries(conditions)) {
    if (key === 'code' && !list(want).includes(item.code)) return false;
    if (key === 'itemType') { const types = typesOf(item.code, data); if (!list(want).some(t => types.has(t))) return false; }
    if (key === 'rarity' && !list(want).includes(item.rarity)) return false;
    if (key === 'tier' && (!base || !list(want).includes(base.tier))) return false;
    if (key === 'ethereal' && Boolean(item.ethereal) !== want) return false;
    if (key === 'sockets' && !num(want, item.sockets ?? 0)) return false;
    if (key === 'quantity' && !num(want, item.gold ?? item.quantity ?? 1)) return false;
  }
  return true;
}

// Returns { rule, index, visible } for the first matching rule, or the plugin default (shown, unstyled).
export function evaluate(filter, item, data) {
  const index = filter.rules.findIndex(r => matches((r.show ?? r.hide).conditions, item, data));
  if (index < 0) return { rule: null, index, visible: true };
  const r = filter.rules[index];
  return { rule: r.show ?? r.hide, index, visible: Boolean(r.show) };
}
