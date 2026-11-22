import { TIERS, LEVELS, THEMES, buildCatalog } from './catalog.js';
import { BASE_RARITY, KINDS, STYLED, alsoOf, baseOpts, compile, effectiveStyles, entryLook, evaluate, labelName, labelProblem, matches, merge, itemTierOf, kindsOf, presetTier, tierOf } from './compile.js';
import * as game from './game-folder.js';

const STORE = 'pd2r-filter-builder';
const SOUNDS = Array.from({ length: 16 }, (_, i) => `Filter${String(i + 1).padStart(2, '0')}`);
const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'triangleDown', 'star', 'spark', 'kite', 'hexagon', 'cross', 'chevron', 'bullseye'];
const RARITIES = ['inferior', 'normal', 'superior', 'magic', 'rare', 'set', 'unique', 'crafted'];
const TIER_IDS = TIERS.map(t => t.id);
const LOOK = { unique: '#c7b377', set: '#1eff00', rare: '#ffff64', magic: '#7878ff', crafted: '#ffa800', rune: '#ffa800', gray: '#9a9a9a', normal: '#ffffff', superior: '#ffffff', inferior: '#9a9a9a', gold: '#ffffff', 'potion-r': '#e070e0', 'potion-h': '#ffffff' };

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const uid = () => Math.random().toString(36).slice(2);

let data, catalog, groupsById, groupOfCode, state, styles, view = 'runes', search = '';
const expanded = new Set();
const openOpts = new Set(); // base rows whose options are showing
let tierEdit = null; // tier whose style editor is open inside a category view
let lookOpen = null; // entry whose own-look editor is open: 'row:<group id>' or 'item:<code>'
let lookKind = ''; // Looks & sounds: '' edits every item, otherwise one rarity kind

/* ---------- state ---------- */

const defaults = () => ({ name: 'My PD2R filter', level: 1, overrides: {}, itemOverrides: {}, baseOptions: {}, theme: THEMES[0].id, styleEdits: {}, rarityEdits: {}, rowLooks: {}, itemLooks: {}, picks: [], imported: null });
const hex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '');
const itemByCode = code => (Object.hasOwn(data.misc, code) ? data.misc[code] : Object.hasOwn(data.bases, code) ? data.bases[code] : undefined);
const typeName = t => data.types[t]?.n ?? t;

// Settings can arrive from a shared link, so keep only values we understand.
function sanitize(raw) {
  const s = defaults();
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.name === 'string') s.name = raw.name.slice(0, 60);
  if (Number.isInteger(raw.level) && raw.level >= 0 && raw.level < LEVELS.length) s.level = raw.level;
  for (const [code, t] of Object.entries(raw.itemOverrides ?? {})) if (groupOfCode.has(code) && TIER_IDS.includes(t)) s.itemOverrides[code] = t;
  for (const [id, t] of Object.entries(raw.overrides ?? {})) {
    if (!TIER_IDS.includes(t)) continue;
    if (groupsById.has(id)) s.overrides[id] = t;
    // Runes and orbs used to have a row each, keyed by item code: keep those choices as item tiers.
    else if (groupOfCode.has(id)) s.itemOverrides[id] ??= t;
  }
  for (const [id, o] of Object.entries(raw.baseOptions ?? {})) {
    if (!groupsById.get(id)?.opts || !o || typeof o !== 'object') continue;
    const e = {};
    if (Object.hasOwn(BASE_RARITY, o.rarity)) e.rarity = o.rarity;
    for (const k of ['min', 'max']) if (Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 6) e[k] = o[k];
    if (['any', 'only', 'no'].includes(o.eth)) e.eth = o.eth;
    s.baseOptions[id] = e;
  }
  if (THEMES.some(t => t.id === raw.theme)) s.theme = raw.theme;
  s.styleEdits = cleanEdits(raw.styleEdits);
  for (const k of KINDS) {
    const e = cleanEdits(raw.rarityEdits?.[k.id]);
    if (Object.keys(e).length) s.rarityEdits[k.id] = e;
  }
  for (const [id, r] of Object.entries(raw.rowLooks ?? {})) { const e = cleanEdit(r); if (groupsById.has(id) && Object.keys(e).length) s.rowLooks[id] = e; }
  for (const [code, r] of Object.entries(raw.itemLooks ?? {})) { const e = cleanEdit(r); if (groupOfCode.has(code) && Object.keys(e).length) s.itemLooks[code] = e; }
  for (const p of Array.isArray(raw.picks) ? raw.picks.slice(0, 200) : []) {
    const item = itemByCode(p?.code);
    if (!item || !TIER_IDS.includes(p.tier)) continue;
    s.picks.push({
      id: uid(), code: p.code, label: item.n, tier: p.tier,
      rarity: RARITIES.includes(p.rarity) ? p.rarity : '', ethereal: p.ethereal === true,
      sockets: Number.isInteger(p.sockets) && p.sockets > 0 && p.sockets <= 6 ? p.sockets : 0,
    });
  }
  const imp = raw.imported;
  if (imp && Array.isArray(imp.rules)) {
    const rules = imp.rules.map(cleanRule).filter(Boolean).slice(0, MAX_KEPT);
    if (rules.length) s.imported = { from: String(imp.from ?? 'an older filter').slice(0, 120), rules };
  }
  return s;
}

// Per-tier look edits: { S: { border, sound, icon, ... }, ... }.
function cleanEdits(raw) {
  const out = {};
  for (const tier of STYLED) {
    const r = raw?.[tier];
    if (r && typeof r === 'object') out[tier] = cleanEdit(r);
  }
  return out;
}

// One look edit: only the fields it changes.
function cleanEdit(r) {
  const e = {};
  if (!r || typeof r !== 'object') return e;
  for (const k of ['text', 'border', 'background']) if (k in r) e[k] = hex(r[k]);
  if (typeof r.bgAlpha === 'number') e.bgAlpha = Math.min(1, Math.max(0, r.bgAlpha));
  if ('sound' in r) e.sound = SOUNDS.includes(r.sound) ? r.sound : '';
  if (labelName(r.name)) e.name = labelName(r.name);
  if ('icon' in r) {
    e.icon = r.icon && SHAPES.includes(r.icon.shape)
      ? { shape: r.icon.shape, size: Math.min(128, Math.max(4, Math.round(r.icon.size) || 10)), fill: hex(r.icon.fill) || '#ffffff', border: hex(r.icon.border) || '#000000' }
      : null;
  }
  return e;
}

// A rule from another filter: one show/hide block with a conditions object. It is rebuilt from the fields
// Pyre knows, each checked, because these come from shared links and files and are shown on the page.
const MAX_KEPT = 3300; // with 200 picks and the builder's rows, stays under Pyre's 4096 rules
const RGBA_RE = /^RGBA\(\d{1,3}, ?\d{1,3}, ?\d{1,3}(, ?(0|1|0?\.\d+))?\)$/i;
function cleanRule(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const keys = Object.keys(r);
  if (keys.length !== 1 || !['show', 'hide'].includes(keys[0])) return null;
  const b = r[keys[0]];
  if (!b || typeof b !== 'object' || !b.conditions || typeof b.conditions !== 'object' || Array.isArray(b.conditions)) return null;
  const out = { conditions: b.conditions };
  if (typeof b.ruleName === 'string') out.ruleName = b.ruleName.slice(0, 200);
  if (typeof b.name === 'string' && labelName(b.name) === b.name) out.name = b.name;
  if (typeof b.continue === 'boolean') out.continue = b.continue;
  if (keys[0] === 'show') {
    const tt = {};
    for (const k of ['textColor', 'borderColor', 'backgroundColor']) if (RGBA_RE.test(b.tooltip?.[k] ?? '')) tt[k] = b.tooltip[k];
    if (Object.keys(tt).length) out.tooltip = tt;
    if (typeof b.dropSound === 'string' && /^[\w .-]{1,60}$/.test(b.dropSound)) out.dropSound = b.dropSound;
    const m = b.minimapIcon;
    if (m && SHAPES.includes(m.shape) && Number.isFinite(m.size) && RGBA_RE.test(m.borderColor ?? '') && RGBA_RE.test(m.fillColor ?? '')) {
      out.minimapIcon = { shape: m.shape, size: Math.min(128, Math.max(4, Math.round(m.size))), borderColor: m.borderColor, fillColor: m.fillColor };
    }
  }
  return { [keys[0]]: out };
}

function loadState() {
  const m = location.hash.match(/^#f=(.+)$/);
  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch { /* storage blocked */ }
  if (m && (!saved || confirm('Open the shared filter? It replaces the filter saved in this browser.'))) {
    try { return sanitize(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); } catch { /* fall through to the saved copy */ }
  }
  try { return sanitize(JSON.parse(saved)); } catch { return defaults(); }
}

const portable = () => ({ ...state, picks: state.picks.map(({ id, label, ...p }) => p) });

// The UI's tier colour is the theme's own colour for that tier, lifted when too dark to read on black.
function tierColor(style, fallback) {
  const hexes = [style.icon?.fill, style.border, style.background, style.text].filter(c => /^#[0-9a-f]{6}$/i.test(c ?? ''));
  const lum = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const pick = hexes.find(c => lum(c) >= 0.12) ?? hexes[0];
  if (!pick) return fallback;
  return lum(pick) >= 0.12 ? pick : `color-mix(in srgb, ${pick} 45%, #ffffff)`;
}
const DEFAULT_TIER_COLORS = { S: '#ff4b4b', A: '#ff9a1f', N: '#ffd24a', B: '#c9c1a0' };
function applyTierColors() {
  for (const t of ['S', 'A', 'N', 'B']) document.documentElement.style.setProperty(`--t-${t}`, tierColor(styles[t], DEFAULT_TIER_COLORS[t]));
}

function save() {
  styles = effectiveStyles(state);
  applyTierColors();
  try { localStorage.setItem(STORE, JSON.stringify(portable())); } catch { /* private mode: still works for this visit */ }
  renderSidebar();
  renderExport();
}

/* ---------- labels, icons, pickers ---------- */

function iconSvg(icon, px = 18) {
  if (!icon) return '';
  const pts = {
    diamond: '10,2 18,10 10,18 2,10', triangle: '10,2.5 18,17 2,17', triangleDown: '2,3 18,3 10,17.5',
    star: '10,1.5 12.6,7.2 18.8,7.6 14,11.6 15.5,17.8 10,14.4 4.5,17.8 6,11.6 1.2,7.6 7.4,7.2',
    spark: '10,1 12,8 19,10 12,12 10,19 8,12 1,10 8,8', kite: '10,1 16,8 10,19 4,8',
    hexagon: '10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75',
    cross: '7,2 13,2 13,7 18,7 18,13 13,13 13,18 7,18 7,13 2,13 2,7 7,7', chevron: '2,4 10,11 18,4 18,10 10,17 2,10',
  };
  const fill = String(icon.fill).toLowerCase(), border = String(icon.border).toLowerCase();
  const a = `fill="${esc(fill)}" stroke="${esc(border)}" stroke-width="1.5"`;
  const shape = icon.shape === 'circle' ? `<circle cx="10" cy="10" r="7.5" ${a}/>`
    : icon.shape === 'square' ? `<rect x="3" y="3" width="14" height="14" ${a}/>`
    : icon.shape === 'bullseye' ? `<circle cx="10" cy="10" r="8" ${a}/><circle cx="10" cy="10" r="3.2" fill="${esc(border)}"/>`
    : `<polygon points="${pts[icon.shape]}" ${a}/>`;
  const size = Math.max(8, Math.min(px, Math.round(6 + icon.size * 0.75)));
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${shape}</svg>`;
}

const alphaHex = a => Math.round((a ?? 0.85) * 255).toString(16).padStart(2, '0');

function dropLabel(text, look, tier, st = styles) {
  if (tier === 'HIDE') return `<span class="drop is-hidden">${esc(text)}</span><span class="ico"></span>`;
  const s = st[tier], css = [`color:${s.text || LOOK[look] || '#fff'}`];
  if (s.border) css.push(`border-color:${s.border}`);
  if (s.background) css.push(`background:${s.background}${alphaHex(s.bgAlpha)}`);
  return `<span class="drop${s.name ? ' named' : ''}" style="${css.join(';')}">${esc(s.name || text)}</span><span class="ico">${iconSvg(s.icon)}</span>`;
}

function tierPicker(name, current, label) {
  const t = TIERS.find(x => x.id === current);
  return `<select class="tier-select" name="${esc(name)}" data-t="${current}" data-tier-pick aria-label="${esc(label)}: tier" title="${esc(t.name + ': ' + t.hint)}">${TIERS.map(x => `<option value="${x.id}" ${x.id === current ? 'selected' : ''}>${x.name}</option>`).join('')}</select>`;
}

const groupSample = group => group.sample ?? itemByCode(group.codes[0])?.n ?? group.label;
const kindStyles = kind => (kind ? effectiveStyles(state, kind) : styles);
// A row covering exactly one rarity kind previews that kind's look.
const groupStyles = group => { const k = kindsOf(group.when ?? alsoOf(group, state)); return kindStyles(k.length === 1 ? k[0] : ''); };
// The styles an entry previews with: its tier look with the entry's own look on top.
const entryStyles = (group, code) => {
  const st = groupStyles(group), look = entryLook(state, group, code);
  return look ? Object.fromEntries(Object.entries(st).map(([t, v]) => [t, merge(v, look)])) : st;
};
const entryOf = key => { const [kind, id] = key.split(':'); return kind === 'item' ? { group: groupOfCode.get(id), code: id } : { group: groupsById.get(id), code: null }; };
const lookStore = code => (code ? state.itemLooks : state.rowLooks);
const lookBtn = (key, text, look, tier, st, name) => `<button class="label-cell look-btn" type="button" data-look="${esc(key)}" aria-expanded="${lookOpen === key}" aria-label="${esc(name)}: change this look" title="Change this look">${dropLabel(text, look, tier, st)}</button>`;

function groupDetail(group) {
  if (group.codes) {
    return [...new Set(group.codes.map(c => itemByCode(c)?.n ?? c))].join(', ');
  }
  const w = group.when, parts = [];
  if (w.rarity) parts.push([].concat(w.rarity).join(' or '));
  if (w.tier) parts.push(w.tier);
  if (w.ethereal) parts.push('ethereal');
  if (w.sockets) parts.push('1+ sockets');
  if (w.itemType) parts.push([].concat(w.itemType).map(typeName).join(' or '));
  if (w.code) parts.push(itemByCode(w.code)?.n ?? w.code);
  return parts.join(' · ');
}

/* ---------- category rows ---------- */

function rowHtml(group) {
  const tier = tierOf(group, state);
  const own = (group.codes ?? []).filter(c => c in state.itemOverrides).length;
  const ownLooks = (group.codes ?? []).filter(c => c in state.itemLooks).length, rowLook = group.id in state.rowLooks;
  const changed = group.id in state.overrides || own > 0 || rowLook || ownLooks > 0 || Object.keys(state.baseOptions[group.id] ?? {}).length > 0;
  const preset = TIERS.find(t => t.id === presetTier(group, state.level)).name;
  const many = group.codes?.length > 1, open = expanded.has(group.id);
  return `<li class="row${changed ? ' changed' : ''}${open ? ' open' : ''}" data-group="${group.id}">
    ${lookBtn('row:' + group.id, groupSample(group), group.look, tier, entryStyles(group), group.label)}
    <div class="row-name"><b>${esc(group.label)}</b>${rowLook ? '<span class="badge look-badge">Own look</span>' : ''}</div>
    <div class="row-tools">${tierPicker('g-' + group.id, tier, group.label)}
      <button class="reset" type="button" data-reset="${group.id}" aria-label="Reset ${esc(group.label)} to ${preset}" title="Back to ${preset} for every item, with default options and looks">↺</button></div>
    <div class="row-detail"><small>${esc(groupDetail(group))}</small>
      ${group.opts ? `<details class="base-opts-wrap"${openOpts.has(group.id) ? ' open' : ''}>
      <summary data-opts="${group.id}"><span>Base options</span> ${esc(baseSummary(baseOpts(group, state)))}</summary>${baseOptsHtml(group)}</details>` : ''}
      ${many ? `<button class="expand" type="button" data-expand="${group.id}" aria-expanded="${open}">${open ? 'Collapse' : `Set the ${group.codes.length} items one by one${own + ownLooks ? ` · ${own + ownLooks} set separately` : ''}`}</button>` : ''}</div>
    ${lookOpen === 'row:' + group.id ? `<div class="entry-wrap">${entryEditor('row:' + group.id)}</div>` : ''}
    ${open ? itemsHtml(group, tier) : ''}
  </li>`;
}

const opt = (value, label, current) => `<option value="${value}" ${String(value) === String(current) ? 'selected' : ''}>${label}</option>`;
const SOCKET_COUNTS = [1, 2, 3, 4, 5, 6];

// Which bases a runeword base row matches. Defaults come from the catalog; changes mark the row as changed.
function baseOptsHtml(group) {
  const o = baseOpts(group, state), id = group.id;
  return `<div class="base-opts" role="group" aria-label="${esc(group.label)}: which bases count">
    <label>Rarity <select data-opt="rarity">${opt('both', 'Normal or superior', o.rarity)}${opt('normal', 'Normal only', o.rarity)}${opt('superior', 'Superior only', o.rarity)}</select></label>
    <label>Sockets <select data-opt="min">${opt(0, 'Any', o.min)}${SOCKET_COUNTS.map(n => opt(n, `${n} or more`, o.min)).join('')}</select></label>
    <label>Up to <select data-opt="max">${opt(0, 'No limit', o.max)}${SOCKET_COUNTS.filter(n => n >= o.min).map(n => opt(n, String(n), o.max)).join('')}</select></label>
    <label>Ethereal <select data-opt="eth">${opt('any', 'Either', o.eth)}${opt('only', 'Ethereal only', o.eth)}${opt('no', 'Not ethereal', o.eth)}</select></label>
  </div>`;
}

function baseSummary(o) {
  const rarity = { both: 'normal or superior', normal: 'normal only', superior: 'superior only' }[o.rarity];
  const sockets = !o.min && !o.max ? 'any sockets' : o.max && o.max === o.min ? `exactly ${o.min} sockets` : o.max ? `${o.min || 0} to ${o.max} sockets` : `${o.min}+ sockets`;
  const eth = { any: '', only: ', ethereal only', no: ', not ethereal' }[o.eth];
  return `${rarity}, ${sockets}${eth}`;
}

function setBaseOpt(group, key, raw) {
  const value = key === 'min' || key === 'max' ? Number(raw) : raw;
  const e = { ...state.baseOptions[group.id], [key]: value };
  if (key === 'min' && e.max && e.max < value) e.max = value; // keep the range valid
  for (const k of Object.keys(e)) if (e[k] === group.opts[k]) delete e[k];
  if (Object.keys(e).length) state.baseOptions[group.id] = e; else delete state.baseOptions[group.id];
}

function itemsHtml(group, groupTier) {
  return `<div class="items"><p class="items-help">Pick a tier for any item to pull it out of the group. Pick <b>${esc(TIERS.find(t => t.id === groupTier).name)}</b> to put it back. Click an item's label to give it its own look.</p>
    <ul>${group.codes.map(code => {
      const own = code in state.itemOverrides, tier = itemTierOf(group, code, state), name = itemByCode(code)?.n ?? code, key = 'item:' + code;
      return `<li class="item${own ? ' own' : ''}" data-code="${esc(code)}">
        <div class="item-name">${lookBtn(key, name, group.look, tier, entryStyles(group, code), name)}
          <span class="badge">${own ? 'Own tier' : 'In group'}</span>${code in state.itemLooks ? '<span class="badge look-badge">Own look</span>' : ''}</div>
        ${tierPicker('i-' + code, tier, name)}</li>${lookOpen === key ? `<li class="entry-wrap">${entryEditor(key)}</li>` : ''}`;
    }).join('')}</ul></div>`;
}

const FIELD_NAMES = { name: 'Label text', text: 'Text colour', border: 'Border', background: 'Background', bgAlpha: 'Background opacity', sound: 'Drop sound', icon: 'Minimap icon' };

// The own-look editor for one row or item. Only changed fields are kept; the rest follow the tier.
function entryEditor(key) {
  const { group, code } = entryOf(key);
  const tier = code ? itemTierOf(group, code, state) : tierOf(group, state);
  const name = code ? itemByCode(code)?.n ?? code : group.label;
  const t = TIERS.find(x => x.id === tier), edit = lookStore(code)[code ?? group.id] ?? {};
  const fields = Object.keys(edit);
  const head = `<div class="inline-head"><h3>${esc(name)} <span>· own look</span></h3>
      ${fields.length ? '<button class="link-btn" type="button" data-entry-reset>Back to tier look</button>' : ''}
      <button class="link-btn" type="button" data-entry-close>Close</button></div>`;
  if (tier === 'HIDE') {
    return `<section class="entry-look" data-entry="${esc(key)}" style="--c:var(--t-HIDE)" aria-label="${esc(name)} own look">${head}
      <p class="kind-help">Hidden items have no look. ${fields.length ? 'Your own look comes back when you show this again.' : 'Pick a shown tier to style this.'}</p></section>`;
  }
  const st = entryStyles(group, code), inherits = code && group.id in state.rowLooks ? ` and the ${esc(group.label)} row's own look` : '';
  return `<section class="entry-look" data-entry="${esc(key)}" data-tier="${tier}" style="--c:var(--t-${tier})" aria-label="${esc(name)} own look">${head}
    <p class="kind-help">Anything you don't change follows the ${esc(t.name)} look${inherits}. Changing the tier keeps this look.</p>
    ${fields.length ? `<div class="own-fields"><span>Changed here</span>${fields.map(f => `<button type="button" data-field-reset="${f}" aria-label="${FIELD_NAMES[f]}: back to tier look" title="Back to tier look">${FIELD_NAMES[f]} <span aria-hidden="true">×</span></button>`).join('')}</div>` : ''}
    <div class="ground">${entryGround(key)}</div>
    ${nameCtl('e-' + key.replace(/\W/g, '-'), edit.name, code ? st[tier].name || name : groupSample(group), !code)}
    ${controlsHtml('e-' + key.replace(/\W/g, '-'), st[tier], name)}</section>`;
}
function nameCtl(id, value, placeholder, row) {
  return `<div class="ctl name-ctl"><label for="nm-${id}">Label text</label>
    <textarea id="nm-${id}" data-style="name" rows="2" spellcheck="false" placeholder="${esc(placeholder)}" aria-describedby="nm-help-${id}">${esc(value ?? '')}</textarea>
    <small id="nm-help-${id}" class="name-help">Shown on the ground instead of ${row ? "each item's" : "the item's"} name. Up to 3 lines of 55 characters, plain letters, numbers and symbols. Leave empty to keep the game's name.</small></div>`;
}

const entryGround = key => {
  const { group, code } = entryOf(key), tier = code ? itemTierOf(group, code, state) : tierOf(group, state);
  return `<span class="label-cell">${dropLabel(code ? itemByCode(code)?.n ?? code : groupSample(group), group.look, tier, entryStyles(group, code))}</span>`;
};


function categoryView(cat) {
  return `<div class="cat-head"><div><h2>${esc(cat.label)}</h2><p>${esc(cat.blurb)}</p></div>
    <div class="bulk"><label for="bulk">Set all to</label>
      <select id="bulk" data-cat="${cat.id}"><option value="">Choose…</option>${TIERS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
      <button class="link-btn" type="button" data-reset-cat="${cat.id}">Reset</button></div></div>
    ${tierBars(cat)}
    <ul class="rows">${cat.groups.map(rowHtml).join('')}</ul>`;
}

// One slim strip of the tiers this category uses. Clicking a tier opens its look-and-sound editor under the strip.
function tierBars(cat) {
  const used = new Map();
  for (const g of cat.groups) {
    const tiers = g.codes ? g.codes.map(c => itemTierOf(g, c, state)) : [tierOf(g, state)];
    for (const t of new Set(tiers)) {
      if (!STYLED.includes(t)) continue;
      if (!used.has(t)) used.set(t, { group: g, kinds: new Set() });
      kindsOf(g.when ?? alsoOf(g, state)).forEach(k => used.get(t).kinds.add(k));
    }
  }
  const tiers = STYLED.filter(t => used.has(t));
  if (tierEdit && !used.has(tierEdit)) tierEdit = null;
  const open = tierEdit, tier = TIERS.find(x => x.id === open);
  const present = open ? KINDS.filter(k => used.get(open).kinds.has(k.id)) : [];
  return `<div class="tier-bars">
    <div class="tier-legend" role="group" aria-label="Tier looks in ${esc(cat.label)}">
      <span class="tl-label">Looks</span>
      ${tiers.map(t => {
        const { group } = used.get(t), { name, hint } = TIERS.find(x => x.id === t);
        return `<button class="tl-item${t === open ? ' open' : ''}" type="button" style="--c:var(--t-${t})" data-edit-tier="${t}" aria-expanded="${t === open}" aria-label="Edit the ${esc(name)} look and sound" title="${esc(`${name}: ${hint}. Click to edit its look and sound.`)}">
          <span class="tl-name">${esc(name)}</span>${dropLabel(groupSample(group), group.look, t, groupStyles(group))}</button>`;
      }).join('')}
    </div>
    ${open ? `<section class="inline-look" style="--c:var(--t-${open})" aria-label="${esc(tier.name)} style">
      <div class="inline-head">
        <h3>${esc(tier.name)} style <span>· every category</span></h3>
        ${styles[open].sound ? `<button class="play-name" type="button" data-play="${styles[open].sound}">▶ Play ${styles[open].sound}</button>` : ''}
        <button class="link-btn" type="button" data-edit-tier="${open}">Close</button>
      </div>
      <div class="kinds" role="group" aria-label="Which ${esc(tier.name)} items to style">
        ${[{ id: '', name: 'All items' }, ...present].map(k => `<button class="kind${k.id === lookKind ? ' active' : ''}" type="button" data-kind="${k.id}" aria-pressed="${k.id === lookKind}">${esc(k.name)}${k.id && Object.keys(state.rarityEdits[k.id]?.[open] ?? {}).length ? ' <span class="dot" aria-label="(changed)">•</span>' : ''}</button>`).join('')}</div>
      <p class="kind-help">${lookKind ? `Changes apply to every ${esc(KINDS.find(k => k.id === lookKind).name.toLowerCase())} item at ${esc(tier.name)}, in every category.` : `Changes apply to every ${esc(tier.name)} item in every category. Pick a rarity to style only those.`}</p>
      ${lookSection(open)}</section>` : ''}
  </div>`;
}

function searchView() {
  const q = search.toLowerCase();
  const hits = catalog.map(cat => ({
    cat, groups: cat.groups.filter(g => [g.label, cat.label, groupSample(g), groupDetail(g)].join(' ').toLowerCase().includes(q)),
  })).filter(h => h.groups.length);
  if (!hits.length) {
    return `<p class="empty">Nothing matches “${esc(search)}”. To filter one exact base or item, add it under <button class="link-btn" type="button" data-view="picks">My picks</button>.</p>`;
  }
  return hits.map(h => `<div class="cat-head"><div><h2>${esc(h.cat.label)}</h2></div></div><ul class="rows">${h.groups.map(rowHtml).join('')}</ul>`).join('');
}

/* ---------- looks & sounds ---------- */

const LOOK_SAMPLES = {
  '': [['Ber Rune', 'rune'], ['Harlequin Crest', 'unique'], ['Grand Charm', 'magic'], ['Ethereal Thresher', 'gray']],
  unique: [['Harlequin Crest', 'unique'], ['Annihilus', 'unique'], ['Hellfire Torch', 'unique']],
  set: [["Tal Rasha's Guardianship", 'set'], ["Immortal King's Pillar", 'set']],
  rare: [['Rare Ring', 'rare'], ['Rare Diadem', 'rare'], ['Rare Jewel', 'rare']],
  crafted: [['Crafted Amulet', 'crafted'], ['Crafted Gloves', 'crafted']],
  magic: [['Grand Charm', 'magic'], ['Small Charm', 'magic'], ['Jewel', 'magic']],
  base: [['Monarch [4]', 'gray'], ['Archon Plate [3]', 'gray'], ['Ethereal Thresher', 'gray']],
};
const groundHtml = id => (lookKind ? LOOK_SAMPLES[lookKind] : [THEME_SAMPLES[id], ...LOOK_SAMPLES[''].slice(1)]).map(([n, l]) => `<span class="label-cell">${dropLabel(n, l, id, kindStyles(lookKind))}</span>`).join('');
const lookEdits = () => (lookKind ? (state.rarityEdits[lookKind] ??= {}) : state.styleEdits);
const hasEdits = edits => Object.values(edits ?? {}).some(e => Object.keys(e).length);
const THEME_SAMPLES = { S: ['Ber Rune', 'rune'], A: ['Ist Rune', 'rune'], N: ['Lem Rune', 'rune'], B: ['Perfect Ruby', 'normal'], SHOW: ['Tal Rune', 'rune'] };

function themeCards() {
  const edits = hasEdits(state.styleEdits) || Object.values(state.rarityEdits).some(hasEdits);
  return `<section class="themes" aria-labelledby="themes-title">
    <div class="cat-head"><div><h2 id="themes-title">Colour themes</h2><p>Switch the look of every tier at once. Your own tweaks below stay on top of the theme.</p></div>
      ${edits ? '<button class="link-btn" type="button" data-reset-looks>Remove my tweaks</button>' : ''}</div>
    ${[...new Set(THEMES.map(t => t.group))].map(group => `<h3 class="theme-group">${esc(group === 'FilterBlade styles' ? 'FilterBlade styles (NeverSink tier colours, our own minimap icons)' : group)}</h3>
    <div class="theme-grid">${THEMES.filter(t => t.group === group).map(th => {
      const st = effectiveStyles({ theme: th.id, styleEdits: {} });
      const active = th.id === state.theme;
      return `<button class="theme${active ? ' active' : ''}" type="button" data-theme="${th.id}" aria-pressed="${active}">
        <span class="theme-name">${esc(th.name)}${active ? '<span class="badge">Active</span>' : ''}</span>
        <span class="theme-swatch">${STYLED.map(t => `<span class="theme-row"><span>${TIERS.find(x => x.id === t).name}</span><span class="label-cell">${dropLabel(THEME_SAMPLES[t][0], THEME_SAMPLES[t][1], t, st)}</span></span>`).join('')}</span>
      </button>`;
    }).join('')}</div>`).join('')}</section>`;
}

function looksView() {
  const kind = KINDS.find(k => k.id === lookKind);
  return `<nav class="jump" aria-label="Looks and sounds sections">
      <button type="button" data-jump="themes-title">Colour themes</button>
      <button type="button" data-jump="tweak-title">Tweak each tier, per rarity</button></nav>
    ${themeCards()}
    <div class="cat-head"><div><h2 id="tweak-title">Tweak each tier</h2><p>Item text keeps its normal game colour unless you pick one. Changes here apply on top of the active theme.</p></div></div>
    <div class="kinds" role="group" aria-label="Which items to tweak">
      ${[{ id: '', name: 'All items' }, ...KINDS].map(k => `<button class="kind${k.id === lookKind ? ' active' : ''}" type="button" data-kind="${k.id}" aria-pressed="${k.id === lookKind}">${esc(k.name)}${k.id && hasEdits(state.rarityEdits[k.id]) ? ' <span class="dot" aria-label="(changed)">•</span>' : ''}</button>`).join('')}</div>
    <p class="kind-help">${kind
      ? `Only ${esc(kind.name.toLowerCase())} items change: rows that check for ${esc(kind.rarities.join(' or '))}, such as ${kind.id === 'magic' ? 'magic charms and jewels' : kind.id === 'base' ? 'runeword bases' : `${esc(kind.name.toLowerCase())} jewelry and gear`}. Anything you leave alone uses the All items look. Rows that do not check rarity (runes, currency, maps) always use All items.`
      : 'These looks apply to every item in a tier. Pick a rarity above to give, for example, magic charms a different border or sound than Notable runes.'}</p>
    <div class="looks">${STYLED.map(lookSection).join('')}</div>`;
}

function lookSection(id) {
      const t = TIERS.find(x => x.id === id), st = kindStyles(lookKind)[id], edited = Object.keys(lookEdits()[id] ?? {}).length > 0;
      return `<section class="look" style="--c:var(--t-${id})" data-tier="${id}">
        <div class="look-head"><div><h3>${t.name}</h3><small>${esc(t.hint)}</small></div>
          ${edited ? `<button class="link-btn" type="button" data-reset-tier="${id}">${lookKind ? 'Back to All items look' : 'Back to theme'}</button>` : ''}</div>
        <div class="ground">${groundHtml(id)}</div>
        ${controlsHtml(id, st, t.name)}</section>`;
}

function controlsHtml(id, st, name) {
  return `<div class="controls">
          ${colorCtl('text', 'Text colour', 'Use game colour', st.text)}
          ${colorCtl('border', 'Border', 'No border', st.border)}
          ${colorCtl('background', 'Background', 'Default dark', st.background)}
          <label class="ctl">Background opacity <input type="range" min="0" max="1" step="0.05" value="${st.bgAlpha}" data-style="bgAlpha" ${st.background ? '' : 'disabled'}></label>
          <div class="ctl"><label for="snd-${id}">Drop sound</label><span class="inline">
            <select id="snd-${id}" data-style="sound"><option value="">None</option>${SOUNDS.map(s => `<option ${s === st.sound ? 'selected' : ''}>${s}</option>`).join('')}</select>
            <button class="play" type="button" data-play="${st.sound}" ${st.sound ? '' : 'disabled'} aria-label="Play ${esc(name)} sound">▶</button></span></div>
          <div class="ctl"><label for="ico-${id}">Minimap icon</label>
            <select id="ico-${id}" data-style="shape"><option value="">None</option>${SHAPES.map(s => `<option value="${s}" ${s === st.icon?.shape ? 'selected' : ''}>${s.replace(/([A-Z])/g, ' $1').toLowerCase()}</option>`).join('')}</select></div>
          ${st.icon ? `<label class="ctl">Icon size ${st.icon.size}px <input type="range" min="4" max="32" step="1" value="${st.icon.size}" data-style="size"></label>
          <div class="ctl">Icon colours <span class="inline"><input type="color" value="${st.icon.fill}" data-style="fill" aria-label="Icon fill"> fill
            <input type="color" value="${st.icon.border}" data-style="iconBorder" aria-label="Icon outline"> outline</span></div>` : ''}
        </div>`;
}

function colorCtl(key, label, off, value) {
  return `<div class="ctl">${label}<span class="inline">
    <input type="color" value="${value || '#ffffff'}" data-style="${key}" ${value ? '' : 'disabled'} aria-label="${label}">
    <label class="inline"><input type="checkbox" data-style-off="${key}" ${value ? '' : 'checked'}> ${off}</label></span></div>`;
}

function editStyle(el, live = false) {
  const tier = el.closest('[data-tier]').dataset.tier;
  const entryKey = el.closest('[data-entry]')?.dataset.entry, entry = entryKey && entryOf(entryKey);
  const e = entry ? (lookStore(entry.code)[entry.code ?? entry.group.id] ??= {}) : (lookEdits()[tier] ??= {});
  const cur = entry ? entryStyles(entry.group, entry.code)[tier] : kindStyles(lookKind)[tier];
  const key = el.dataset.style ?? el.dataset.styleOff;
  if (key === 'name') {
    const problem = labelProblem(el.value), help = el.parentElement.querySelector('.name-help');
    el.toggleAttribute('aria-invalid', Boolean(problem));
    if (problem) { help.textContent = problem; help.classList.add('bad'); return; }
    if (labelName(el.value)) e.name = labelName(el.value); else delete e.name;
    if (!Object.keys(e).length) delete lookStore(entry.code)[entry.code ?? entry.group.id];
    styles = effectiveStyles(state);
    refreshRow(entry.group.id, `[data-entry="${entryKey}"] [data-style="name"]`);
    return save();
  }
  const icon = () => ({ shape: 'circle', size: 10, fill: '#ffffff', border: '#000000', ...cur.icon });
  if (el.dataset.styleOff) e[key] = el.checked ? '' : el.closest('.ctl').querySelector('input[type=color]').value;
  else if (key === 'bgAlpha') e.bgAlpha = Number(el.value);
  else if (key === 'sound') { e.sound = el.value; if (el.value) play(el.value); }
  else if (key === 'shape') e.icon = el.value ? { ...icon(), shape: el.value } : null;
  else if (key === 'size') e.icon = { ...icon(), size: Number(el.value) };
  else if (key === 'fill') e.icon = { ...icon(), fill: el.value };
  else if (key === 'iconBorder') e.icon = { ...icon(), border: el.value };
  else e[key] = el.value;
  styles = effectiveStyles(state);
  if (entry && live) {
    el.closest('.entry-look').querySelector('.ground').innerHTML = entryGround(entryKey);
    if (key === 'size') el.closest('label.ctl').firstChild.textContent = `Icon size ${entryStyles(entry.group, entry.code)[tier].icon.size}px `;
  } else if (entry) {
    refreshRow(entry.group.id, `[data-entry="${entryKey}"] [data-style="${key}"], [data-entry="${entryKey}"] [data-style-off="${key}"]`);
  } else if (live) {
    // Keep the slider or colour picker focused while dragging: only repaint the preview strip.
    el.closest('.look').querySelector('.ground').innerHTML = groundHtml(tier);
    if (key === 'size') el.closest('label.ctl').firstChild.textContent = `Icon size ${kindStyles(lookKind)[tier].icon.size}px `;
  } else {
    renderView();
    document.querySelector(`[data-tier="${tier}"] [data-style="${key}"], [data-tier="${tier}"] [data-style-off="${key}"]`)?.focus();
  }
  save();
}

/* ---------- my picks ---------- */

function picksView() {
  return `<div class="cat-head"><div><h2>My picks</h2><p>Add exact bases or items you want to treat differently, like a Monarch with 4 sockets. Picks beat every other rule.</p></div></div>
    <div class="pick-search"><label for="pick-q" class="visually-hidden">Find an item to add</label>
      <input id="pick-q" type="search" placeholder="Find a base or item to add, e.g. Monarch, Phase Blade, Ber" autocomplete="off">
      <ul id="pick-results" class="results" hidden></ul></div>
    ${state.picks.length ? `<ul class="rows">${state.picks.map(pickRow).join('')}</ul>` : '<p class="empty">No picks yet. Search above to add one.</p>'}
    ${state.imported ? importedHtml() : ''}`;
}

function importedHtml() {
  const rules = state.imported.rules;
  return `<div class="cat-head"><div><h2>Kept from ${esc(state.imported.from)}</h2>
      <p>These ${rules.length} rules came from a filter this builder did not make. They run right after your picks and before every builder row, exactly as written. Remove any you no longer want.</p></div>
      <button class="link-btn" type="button" data-drop-imported>Remove all</button></div>
    <ul class="rows">${rules.map((r, i) => {
      const b = r.show ?? r.hide, c = b.conditions;
      const what = Object.entries(c).map(([k, v]) => `${k}: ${typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : [].concat(v).map(x => itemByCode(x)?.n ?? x).join(', ')}`).join(' · ');
      return `<li class="row imported"><div class="label-cell"><span class="drop${r.hide ? ' is-hidden' : ''}" style="${r.show ? `color:${cssColor(b.tooltip?.textColor) || '#fff'};border-color:${cssColor(b.tooltip?.borderColor) || 'transparent'};background:${cssColor(b.tooltip?.backgroundColor) || '#000c'}` : ''}">${esc(b.ruleName || (r.show ? 'Show' : 'Hide'))}</span></div>
        <div class="row-name"><b>${r.show ? 'Show' : 'Hide'}${b.dropSound ? ' · ' + esc(b.dropSound) : ''}</b></div>
        <div class="row-tools"><button class="remove" type="button" data-drop-rule="${i}">Remove</button></div>
        <div class="row-detail"><small>${esc(what)}</small></div></li>`;
    }).join('')}</ul>`;
}

function pickRow(p) {
  const item = itemByCode(p.code);
  const text = (p.ethereal ? 'Ethereal ' : '') + p.label + (p.sockets ? ` [${p.sockets}+]` : '');
  return `<li class="row" data-pick="${p.id}">
    <div class="label-cell">${dropLabel(text, p.rarity || (p.ethereal || p.sockets ? 'gray' : item.kind ? 'normal' : 'rune'), p.tier)}</div>
    <div class="row-name"><b>${esc(p.label)}</b><small>${esc(p.code)} · ${esc(typeName(item.t))}${item.tier ? ' · ' + item.tier : ''}</small></div>
    <div class="row-tools">${tierPicker('p-' + p.id, p.tier, p.label)}</div>
    <div class="pick-opts">
      <label>Rarity <select data-pick-opt="rarity"><option value="">Any</option>${RARITIES.map(r => `<option ${r === p.rarity ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      ${item.kind ? `<label><input type="checkbox" data-pick-opt="ethereal" ${p.ethereal ? 'checked' : ''}> Ethereal only</label>
      <label>Min sockets <input type="number" min="0" max="6" value="${p.sockets}" data-pick-opt="sockets"></label>` : ''}
      <button class="remove" type="button" data-remove="${p.id}">Remove</button>
    </div></li>`;
}

let searchIndex;
function itemSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  searchIndex ??= [...Object.entries(data.bases), ...Object.entries(data.misc)]
    .filter(([, v]) => v.n).map(([code, v]) => ({ code, ...v, key: `${v.n} ${code}`.toLowerCase() }));
  return searchIndex.filter(x => x.key.includes(q)).slice(0, 30);
}

function renderResults(listEl, q, attr) {
  const hits = itemSearch(q);
  listEl.hidden = !q.trim();
  listEl.innerHTML = hits.length ? hits.map(x => `<li><button type="button" ${attr}="${esc(x.code)}"><span>${esc(x.n)}</span>
    <small>${esc(typeName(x.t))}${x.tier ? ' · ' + x.tier : ''} · ${esc(x.code)}</small></button></li>`).join('')
    : '<li class="empty" style="padding:10px 12px">No item with that name.</li>';
}

function addPick(code) {
  const item = itemByCode(code);
  if (state.picks.length >= 200) return flash('My picks holds up to 200 items. Remove one to add another.');
  state.picks.push({ id: uid(), code, label: item.n, tier: 'A', rarity: '', ethereal: false, sockets: 0 });
  renderView(); save();
  flash(`Added ${item.n} to My picks.`);
  $('#pick-q')?.focus();
}

/* ---------- simulate & test ---------- */

const SCENARIOS = [
  { id: 'mixed', name: 'Mixed Hell drops', hint: 'A bit of everything a Hell monster pack drops.' },
  { id: 'leveling', name: 'Leveling', hint: 'Normal and Nightmare: potions, low runes, magic gear.' },
  { id: 'maps', name: 'Endgame map', hint: 'High-tier map: orbs, maps, rares, bases and runes.' },
  { id: 'uber', name: 'Uber boss', hint: 'Pinnacle boss: uber pieces, high runes and chase uniques.' },
];
let sim = { scenario: 'mixed', items: [], ctrl: false, selected: null, sound: true };

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;

function randomGear(tiers, rarities) {
  const pool = Object.entries(data.bases).filter(([, b]) => tiers.includes(b.tier) && b.n);
  const [code, b] = pick(pool);
  const rarity = pick(rarities);
  const white = ['normal', 'superior', 'inferior'].includes(rarity);
  return { code, rarity, ethereal: white && chance(0.15) && b.kind, sockets: white && b.sock && chance(0.35) ? 1 + Math.floor(Math.random() * b.sock) : 0 };
}

const miscOfType = types => Object.keys(data.misc).filter(c => types.includes(data.misc[c].t));

function rollItem(scenario) {
  const runes = (lo, hi) => ({ code: 'r' + String(lo + Math.floor(Math.random() * (hi - lo + 1))).padStart(2, '0'), rarity: 'normal' });
  const code = list => ({ code: pick(list), rarity: 'normal' });
  const currency = ['imma', 'imrn', 'imra', 'rera', 'scou', 'upma', 'fort', 'upmp', 'wss', 'jewf', 'lpp', 'crfb', 'crfc', 'toa', 'scrb'];
  const ubers = ['pk1', 'pk2', 'pk3', 'dhn', 'bey', 'mbr', 'tes', 'ceh', 'bet', 'fed', 'dcma', 'rtma', 'xa1', 'ua1', 'um1'];
  const potions = ['hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'mp2', 'mp4', 'mp5', 'rvs', 'rvl', 'vps', 'yps'];
  const misc = ['tsc', 'isc', 'key', 'aqv', 'cqv', 'gld', 'gld'];
  const gems = miscOfType(['gema', 'gemt', 'gems', 'geme', 'gemr', 'gemd', 'gemz']);
  const maps = miscOfType(['t1m', 't2m', 't3m']);
  const jewelry = () => ({ code: pick(['rin', 'amu', 'jew', 'cm1', 'cm2', 'cm3']), rarity: pick(['magic', 'magic', 'rare', 'unique', 'set']) });
  const table = {
    leveling: [[potions, 6], [misc, 4], [() => runes(1, 14), 2], [gems, 2], [() => randomGear(['normal', 'exceptional'], ['inferior', 'normal', 'superior', 'magic', 'magic', 'rare']), 7], [jewelry, 1]],
    mixed: [[potions, 3], [misc, 2], [() => runes(1, 26), 3], [gems, 2], [() => randomGear(['exceptional', 'elite'], ['normal', 'superior', 'magic', 'magic', 'rare', 'unique', 'set']), 7], [jewelry, 2], [currency, 1]],
    maps: [[currency, 4], [maps, 3], [() => runes(10, 30), 3], [() => randomGear(['elite'], ['normal', 'superior', 'magic', 'rare', 'rare', 'unique', 'crafted']), 6], [jewelry, 2], [potions, 2], [gems, 1]],
    uber: [[ubers, 4], [() => runes(20, 33), 3], [currency, 3], [() => randomGear(['elite'], ['unique', 'unique', 'set', 'rare']), 4], [() => ({ code: pick(['cm3', 'cs2', 'tch', 'cjw']), rarity: 'unique' }), 1], [potions, 1]],
  }[scenario];
  const total = table.reduce((n, [, w]) => n + w, 0);
  let roll = Math.random() * total;
  for (const [source, w] of table) {
    if ((roll -= w) > 0) continue;
    return { id: uid(), ...(typeof source === 'function' ? source() : code(source)) };
  }
}

function rerollLoot() {
  sim.items = Array.from({ length: 18 }, () => rollItem(sim.scenario)).filter(Boolean);
  sim.selected = null;
  if (sim.sound) {
    const filter = compile(catalog, state);
    const loudest = sim.items.map(i => evaluate(filter, i, data)).filter(r => r.visible && r.rule?.dropSound)
      .sort((a, b) => a.index - b.index)[0];
    if (loudest) play(loudest.rule.dropSound);
  }
}

function lookOf(item) {
  if (item.code.startsWith('r') && /^r\d\d$/.test(item.code)) return 'rune';
  if (['unique', 'set', 'rare', 'magic', 'crafted'].includes(item.rarity)) return item.rarity;
  return item.ethereal || item.sockets || item.rarity === 'inferior' ? 'gray' : 'normal';
}

function nameOf(item) {
  const base = itemByCode(item.code)?.n ?? item.code;
  if (item.code === 'gld') return `${(item.gold ??= 50 + Math.floor(Math.random() * 4000))} Gold`;
  return [item.rarity === 'superior' ? 'Superior' : item.rarity === 'inferior' ? 'Cracked' : '', base].filter(Boolean).join(' ')
    + (item.sockets ? ` [${item.sockets}]` : '') + (item.ethereal ? ' (eth)' : '');
}

// Colours can come from a file on disk, so only plain colour syntax reaches a style attribute.
const cssColor = v => (/^(rgba?\([\d.,\s]+\)|#[0-9a-f]{3,8}|[a-z]+)$/i.test(String(v ?? '')) ? String(v).toLowerCase() : '');

function simLabel(item, result) {
  const r = result.rule, tt = r?.tooltip ?? {};
  const css = [`color:${cssColor(tt.textColor) || LOOK[lookOf(item)]}`];
  if (tt.borderColor) css.push(`border-color:${cssColor(tt.borderColor)}`);
  if (tt.backgroundColor) css.push(`background:${cssColor(tt.backgroundColor)}`);
  const icon = r?.minimapIcon && result.visible ? iconSvg({ shape: r.minimapIcon.shape, size: r.minimapIcon.size, fill: r.minimapIcon.fillColor, border: r.minimapIcon.borderColor }, 14) : '';
  return `<button class="sim-drop${result.visible ? '' : ' is-hidden'}${sim.selected === item.id ? ' selected' : ''}" type="button" data-sim="${item.id}" style="${css.join(';')}">${esc(result.visible && r?.name ? r.name : nameOf(item))}${icon ? `<span class="sim-ico">${icon}</span>` : ''}</button>`;
}

function simulateView() {
  const filter = compile(catalog, state);
  const results = sim.items.map(item => [item, evaluate(filter, item, data)]);
  const shown = results.filter(([, r]) => r.visible).length;
  const sel = sim.items.find(i => i.id === sim.selected);
  return `<div class="cat-head"><div><h2>Simulate & test loot</h2><p>Drops random loot and runs it through your filter exactly as compiled. Click any label to see which rule caught it and change its properties.</p></div></div>
    <div class="sim-bar">
      <label class="ctl">Scenario <select data-sim-scenario>${SCENARIOS.map(s => `<option value="${s.id}" ${s.id === sim.scenario ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
      <button class="button primary sim-roll" type="button" data-roll>Drop new loot</button>
      <label class="inline"><input type="checkbox" data-sim-ctrl ${sim.ctrl ? 'checked' : ''}> Hold <kbd>Ctrl</kbd> (show hidden items)</label>
      <label class="inline"><input type="checkbox" data-sim-sound ${sim.sound ? 'checked' : ''}> Play the top drop sound</label>
    </div>
    <p class="fine">${esc(SCENARIOS.find(s => s.id === sim.scenario).hint)} ${shown} shown, ${results.length - shown} hidden.</p>
    <div class="sim-ground" aria-label="Ground loot">${results.filter(([, r]) => r.visible || sim.ctrl).map(([i, r]) => simLabel(i, r)).join('') || '<p class="empty">Everything here is hidden. Tick Hold Ctrl to see it.</p>'}</div>
    <div class="sim-split">
      <section class="sim-why" aria-live="polite">${sel ? whyHtml(sel, evaluate(filter, sel, data), filter) : '<h3>Why did this show or hide?</h3><p class="fine">Click a label on the ground.</p>'}</section>
      <section class="sim-test"><h3>Test any item</h3><p class="fine">Drop one specific item onto the ground.</p>
        <label for="sim-q" class="visually-hidden">Find an item to drop</label>
        <input id="sim-q" type="search" placeholder="e.g. Shako, Ber Rune, Grand Charm" autocomplete="off">
        <ul id="sim-results" class="results" hidden></ul></section>
    </div>`;
}

// The builder row that decides this item, if a builder row (not a pick or kept rule) matched it.
function groupForItem(item, rule) {
  for (const cat of catalog) {
    if (!rule?.ruleName?.startsWith(cat.label + ':')) continue;
    for (const g of cat.groups) {
      if (g.codes ? g.codes.includes(item.code) && matches(alsoOf(g, state) ?? {}, item, data) : matches(g.when, item, data)) return { cat, g };
    }
  }
  return null;
}

function whyHtml(item, result, filter) {
  const base = data.bases[item.code], r = result.rule;
  const verdict = result.visible ? 'Shown' : 'Hidden';
  return `<h3>${esc(nameOf(item))}</h3>
    <p class="why-verdict ${result.visible ? 'yes' : 'no'}">${verdict}${r ? ` by rule ${result.index + 1} of ${filter.rules.length}: <b>${esc(r.ruleName)}</b>` : ': no rule matched, so the game shows it normally.'}</p>
    ${r?.dropSound && result.visible ? `<p class="fine">Drop sound ${esc(r.dropSound)}${SOUNDS.includes(r.dropSound) ? ` <button class="play" type="button" data-play="${r.dropSound}" aria-label="Play ${r.dropSound}">▶</button>` : ''}</p>` : ''}
    <div class="sim-props" data-sim-item="${item.id}">
      <label>Rarity <select data-prop="rarity">${RARITIES.map(x => `<option ${x === item.rarity ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      ${base ? `<label><input type="checkbox" data-prop="ethereal" ${item.ethereal ? 'checked' : ''}> Ethereal</label>
      <label>Sockets <input type="number" min="0" max="6" value="${item.sockets ?? 0}" data-prop="sockets"></label>` : ''}
    </div>
    ${whyFix(item, result.rule)}
    <p class="fine">${esc(typeName(itemByCode(item.code)?.t))}${base ? ' · ' + base.tier : ''}</p>`;
}

function whyFix(item, rule) {
  const hit = groupForItem(item, rule);
  if (!hit) return '';
  const { cat, g } = hit, own = Boolean(g.codes);
  const tier = own ? itemTierOf(g, item.code, state) : tierOf(g, state);
  const what = own && g.codes.length > 1 ? nameOf(item).replace(/^(Ethereal |Superior )/, '') : g.label;
  return `<div class="why-fix" data-fix-group="${g.id}" data-fix-code="${own ? esc(item.code) : ''}">
      <label>Tier for <b>${esc(what)}</b> ${tierPicker('why-' + g.id, tier, what)}</label>
      <button class="link-btn" type="button" data-goto="${g.id}">Go to ${esc(cat.label)} › ${esc(g.label)}</button></div>`;
}

/* ---------- strictness ---------- */

function renderLevels() {
  $('#levels').innerHTML = LEVELS.map((l, i) => `<button class="level" type="button" role="radio" aria-checked="${i === state.level}" tabindex="${i === state.level ? 0 : -1}" data-level="${i}">
    <b>${l.name}</b><small>${l.tag}</small>
    <span class="meter" aria-hidden="true">${LEVELS.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</span></button>`).join('');
  const l = LEVELS[state.level];
  const groups = catalog.flatMap(c => c.groups);
  const hiddenNow = groups.filter(g => presetTier(g, state.level) === 'HIDE');
  const newly = hiddenNow.filter(g => state.level === 0 || presetTier(g, state.level - 1) !== 'HIDE');
  const changed = Object.keys(state.overrides).length + Object.keys(state.itemOverrides).length;
  $('#level-hint').innerHTML = `<div class="level-copy"><p><b>${esc(l.name)}.</b> ${esc(l.text)}</p><p class="fine"><b>Best for:</b> ${esc(l.who)}</p></div>
    <div class="level-facts">${newly.length
      ? `<p class="fine"><b>Newly hidden at ${esc(l.name)}</b> (${hiddenNow.length} groups hidden in total):</p><ul class="chips">${newly.map(g => `<li>${esc(g.label)}</li>`).join('')}</ul>`
      : '<p class="fine">No group is hidden at this level.</p>'}
      ${changed ? `<p class="fine">${changed === 1 ? 'Your 1 manual change stays' : `Your ${changed} manual changes stay`} when you switch. <button class="link-btn" type="button" data-clear-overrides>Clear them</button></p>` : ''}</div>`;
}

/* ---------- frame ---------- */

function renderView() {
  applyTierColors();
  const el = $('#view');
  if (search) el.innerHTML = searchView();
  else if (view === 'looks') el.innerHTML = looksView();
  else if (view === 'picks') el.innerHTML = picksView();
  else if (view === 'simulate') el.innerHTML = simulateView();
  else el.innerHTML = categoryView(catalog.find(c => c.id === view));
}

function renderSidebar() {
  const pips = groups => {
    const tiers = groups.flatMap(g => (g.codes ? g.codes.map(c => itemTierOf(g, c, state)) : [tierOf(g, state)]));
    const hot = tiers.filter(t => t === 'S' || t === 'A').length, hidden = tiers.filter(t => t === 'HIDE').length;
    return `<span class="pips">${hot ? `<span class="pip hot" title="${hot} Chase or High Value">★${hot}</span>` : ''}${hidden ? `<span class="pip hide" title="${hidden} hidden">⊘${hidden}</span>` : ''}</span>`;
  };
  const item = (id, label, extra = '') => `<li><button type="button" data-view="${id}" aria-current="${!search && view === id}">${esc(label)}${extra}</button></li>`;
  $('#categories').innerHTML = catalog.map(c => item(c.id, c.label, pips(c.groups))).join('')
    + '<li class="sep" role="presentation"></li>'
    + item('picks', 'My picks', state.picks.length ? `<span class="pips"><span class="pip">${state.picks.length}</span></span>` : '')
    + item('looks', 'Looks & sounds')
    + item('simulate', 'Simulate & test');
}

let lastJson = '';
function renderExport() {
  const filter = compile(catalog, state);
  // The plugin ignores unknown top-level keys, so the file carries its own builder settings for reopening.
  lastJson = JSON.stringify({ ...filter, builder: { format: 'pd2r-filter-builder', version: 1, settings: portable() } }, null, 2);
  renderGame();
  $('#json').textContent = lastJson;
  const all = catalog.flatMap(c => c.groups).map(g => tierOf(g, state));
  const hidden = all.filter(t => t === 'HIDE').length, hot = all.filter(t => t === 'S' || t === 'A').length;
  $('#summary').textContent = `${filter.rules.length} rules · ${hot} groups highlighted · ${hidden} hidden · ${state.picks.length} ${state.picks.length === 1 ? 'pick' : 'picks'}. Items not covered show as normal.`;
  if (document.activeElement !== $('#filter-name')) $('#filter-name').value = state.name;
}

function refreshRow(groupId, focusSelector) {
  const old = document.querySelector(`.row[data-group="${groupId}"]`);
  if (!old) return;
  const t = document.createElement('template');
  t.innerHTML = rowHtml(groupsById.get(groupId)).trim();
  old.replaceWith(t.content.firstChild);
  // The tier bars list the tiers this category uses, so a row's new tier can add or drop one.
  const bars = document.querySelector('.tier-bars'), cat = catalog.find(c => c.id === view);
  if (bars && cat) { t.innerHTML = tierBars(cat).trim(); bars.replaceWith(t.content.firstChild); }
  if (focusSelector) document.querySelector(focusSelector)?.focus();
}

let audio;
function play(sound) {
  if (!SOUNDS.includes(sound)) return;
  audio?.pause();
  audio = new Audio(`sounds/${sound}.flac`);
  audio.volume = 0.5;
  audio.play().catch(() => flash('This browser could not play the sound.'));
}

function flash(msg) {
  $('#export-status').textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => ($('#export-status').textContent = ''), 4000);
}

function setLevel(i) {
  state.level = i;
  renderLevels(); renderView(); save();
  document.querySelector(`.level[data-level="${i}"]`)?.focus();
}

function clearGroup(g) {
  delete state.overrides[g.id]; delete state.baseOptions[g.id]; delete state.rowLooks[g.id];
  (g.codes ?? []).forEach(c => { delete state.itemOverrides[c]; delete state.itemLooks[c]; });
}

function openLook(key) {
  const before = lookOpen && entryOf(lookOpen).group;
  lookOpen = key;
  if (before) refreshRow(before.id);
  if (key) refreshRow(entryOf(key).group.id);
}

function setGroupTier(group, tier) {
  if (tier === presetTier(group, state.level)) delete state.overrides[group.id]; else state.overrides[group.id] = tier;
}

function show(next) {
  view = next; search = ''; $('#search').value = '';
  if (next === 'simulate' && !sim.items.length) { sim.sound = false; rerollLoot(); sim.sound = true; }
  renderView(); renderSidebar();
}

/* ---------- events ---------- */

function bind() {
  $('#levels').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (b) setLevel(Number(b.dataset.level));
  });
  $('#levels').addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); setLevel((state.level + d + LEVELS.length) % LEVELS.length); }
  });
  $('#level-hint').addEventListener('click', e => {
    if (!e.target.closest('[data-clear-overrides]')) return;
    state.overrides = {}; state.itemOverrides = {};
    renderLevels(); renderView(); save();
  });

  $('#categories').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    show(b.dataset.view);
    if (matchMedia('(max-width:820px)').matches) $('.editor').scrollIntoView({ block: 'start' });
  });
  $('#search').addEventListener('input', e => { search = e.target.value.trim(); renderView(); renderSidebar(); });

  const viewEl = $('#view');
  viewEl.addEventListener('change', e => {
    const el = e.target, row = el.closest('.row');
    const itemEl = el.closest('.item');
    if (el.hasAttribute('data-tier-pick') && el.closest('.why-fix')) {
      const fix = el.closest('.why-fix'), g = groupsById.get(fix.dataset.fixGroup), code = fix.dataset.fixCode;
      if (code) { if (el.value === tierOf(g, state)) delete state.itemOverrides[code]; else state.itemOverrides[code] = el.value; }
      else setGroupTier(g, el.value);
      renderLevels(); save(); renderView(); $('.why-fix .tier-select')?.focus();
    } else if (el.dataset.opt && row?.dataset.group) {
      const g = groupsById.get(row.dataset.group);
      setBaseOpt(g, el.dataset.opt, el.value);
      refreshRow(g.id, `.row[data-group="${g.id}"] [data-opt="${el.dataset.opt}"]`); save();
    } else if (el.hasAttribute('data-tier-pick') && itemEl) {
      const g = groupsById.get(row.dataset.group), code = itemEl.dataset.code;
      if (el.value === tierOf(g, state)) delete state.itemOverrides[code]; else state.itemOverrides[code] = el.value;
      refreshRow(g.id, `select[name="i-${code}"]`); renderLevels(); save();
    } else if (el.hasAttribute('data-tier-pick') && row?.dataset.group) {
      const g = groupsById.get(row.dataset.group);
      setGroupTier(g, el.value);
      refreshRow(g.id, `select[name="g-${g.id}"]`); renderLevels(); save();
    } else if (el.hasAttribute('data-tier-pick') && row?.dataset.pick) {
      state.picks.find(p => p.id === row.dataset.pick).tier = el.value;
      renderView(); save();
    } else if (el.dataset.pickOpt) {
      const p = state.picks.find(x => x.id === row.dataset.pick), k = el.dataset.pickOpt;
      p[k] = k === 'ethereal' ? el.checked : k === 'sockets' ? Math.min(6, Math.max(0, parseInt(el.value, 10) || 0)) : el.value;
      renderView(); save();
    } else if (el.id === 'bulk' && el.value) {
      for (const g of catalog.find(c => c.id === el.dataset.cat).groups) {
        setGroupTier(g, el.value);
        (g.codes ?? []).forEach(c => delete state.itemOverrides[c]);
      }
      renderView(); renderLevels(); save();
    } else if (el.dataset.style || el.dataset.styleOff) {
      editStyle(el);
    } else if (el.dataset.simScenario !== undefined) {
      sim.scenario = el.value; rerollLoot(); renderView();
    } else if (el.dataset.simCtrl !== undefined) {
      sim.ctrl = el.checked; renderView();
    } else if (el.dataset.simSound !== undefined) {
      sim.sound = el.checked;
    } else if (el.dataset.prop) {
      const item = sim.items.find(i => i.id === el.closest('[data-sim-item]').dataset.simItem);
      item[el.dataset.prop] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.min(6, Math.max(0, parseInt(el.value, 10) || 0)) : el.value;
      renderView();
      document.querySelector(`[data-prop="${el.dataset.prop}"]`)?.focus();
    }
  });
  viewEl.addEventListener('input', e => {
    const t = e.target;
    if ((t.type === 'color' || t.type === 'range') && t.closest('[data-tier]')) editStyle(t, true);
    else if (t.id === 'pick-q') renderResults($('#pick-results'), t.value, 'data-add');
    else if (t.id === 'sim-q') renderResults($('#sim-results'), t.value, 'data-sim-add');
  });
  viewEl.addEventListener('click', e => {
    const t = e.target.closest('button, summary[data-opts]') ?? e.target;
    const d = t.dataset ?? {};
    if (d.reset) {
      const g = groupsById.get(d.reset);
      clearGroup(g);
      refreshRow(g.id); renderLevels(); save();
    } else if (d.expand) {
      expanded.has(d.expand) ? expanded.delete(d.expand) : expanded.add(d.expand);
      refreshRow(d.expand, `[data-expand="${d.expand}"]`);
    } else if (d.resetCat) {
      catalog.find(c => c.id === d.resetCat).groups.forEach(clearGroup);
      renderView(); renderLevels(); save();
    } else if (d.theme) { state.theme = d.theme; styles = effectiveStyles(state); renderView(); save(); $(`[data-theme="${d.theme}"]`)?.focus(); }
    else if (t.hasAttribute?.('data-reset-looks')) { state.styleEdits = {}; state.rarityEdits = {}; styles = effectiveStyles(state); renderView(); save(); }
    else if (d.resetTier) { delete lookEdits()[d.resetTier]; styles = effectiveStyles(state); renderView(); save(); }
    else if (d.opts) { e.preventDefault(); openOpts.has(d.opts) ? openOpts.delete(d.opts) : openOpts.add(d.opts); refreshRow(d.opts, `summary[data-opts="${d.opts}"]`); }
    else if (d.look) { const key = lookOpen === d.look ? null : d.look; openLook(key); document.querySelector(`[data-look="${d.look}"]`)?.focus(); }
    else if (t.hasAttribute?.('data-entry-close')) { const key = lookOpen; openLook(null); document.querySelector(`[data-look="${key}"]`)?.focus(); }
    else if (t.hasAttribute?.('data-entry-reset')) {
      const { group, code } = entryOf(lookOpen);
      delete lookStore(code)[code ?? group.id];
      refreshRow(group.id, `[data-look="${lookOpen}"]`); save();
    }
    else if (d.fieldReset) {
      const { group, code } = entryOf(lookOpen), store = lookStore(code), id = code ?? group.id;
      delete store[id][d.fieldReset];
      if (!Object.keys(store[id]).length) delete store[id];
      refreshRow(group.id, `[data-entry="${lookOpen}"] [data-field-reset], [data-entry="${lookOpen}"] .controls select`); save();
    }
    else if (d.goto) {
      const g = groupsById.get(d.goto), cat = catalog.find(c => c.groups.includes(g));
      if (g.codes?.length > 1) expanded.add(g.id);
      show(cat.id);
      const rowEl = document.querySelector(`.row[data-group="${g.id}"]`);
      rowEl?.scrollIntoView({ block: 'center' }); rowEl?.querySelector('.tier-select')?.focus();
    }
    else if (d.editTier) { tierEdit = tierEdit === d.editTier ? null : d.editTier; lookKind = ''; renderView(); $(`[data-edit-tier="${d.editTier}"]`)?.focus(); }
    else if (d.jump) document.getElementById(d.jump)?.scrollIntoView({ block: 'start' });
    else if ('kind' in d) { lookKind = d.kind; renderView(); $(`[data-kind="${d.kind}"]`)?.focus(); }
    else if (d.play) play(d.play);
    else if (d.dropRule) { state.imported.rules.splice(Number(d.dropRule), 1); if (!state.imported.rules.length) state.imported = null; renderView(); save(); }
    else if (t.hasAttribute?.('data-drop-imported')) { state.imported = null; renderView(); save(); }
    else if (d.remove) { state.picks = state.picks.filter(p => p.id !== d.remove); renderView(); save(); }
    else if (d.view) show(d.view);
    else if (d.add) addPick(d.add);
    else if (t.hasAttribute?.('data-roll')) { rerollLoot(); renderView(); }
    else if (d.sim) { sim.selected = d.sim; renderView(); document.querySelector(`[data-sim="${d.sim}"]`)?.focus(); }
    else if (d.simAdd) {
      const item = { id: uid(), code: d.simAdd, rarity: data.bases[d.simAdd] ? 'unique' : 'normal', ethereal: false, sockets: 0 };
      sim.items.unshift(item); sim.selected = item.id; renderView();
    }
  });
  viewEl.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lookOpen && e.target.closest('[data-entry], [data-look]')) {
      const key = lookOpen; openLook(null); document.querySelector(`[data-look="${key}"]`)?.focus(); return;
    }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'pick-q') { e.preventDefault(); document.querySelector('#pick-results [data-add]')?.click(); }
    if (e.target.id === 'sim-q') { e.preventDefault(); document.querySelector('#sim-results [data-sim-add]')?.click(); }
  });

  $('#game').addEventListener('click', e => {
    const b = e.target.closest('[data-game], [data-game-open]');
    if (b) gameAction(b.dataset.game ?? 'open', Number(b.dataset.gameOpen));
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && gameUi.conn) { e.preventDefault(); gameAction('save'); }
  });
  $('#filter-name').addEventListener('input', e => { state.name = e.target.value.slice(0, 60); save(); });
  $('#download').addEventListener('click', () => {
    const slug = (state.name || 'filter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'filter';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([lastJson + '\n'], { type: 'application/json' })), download: `${slug}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(`Downloaded ${slug}.json. Install steps are below.`);
  });
  $('#copy-json').addEventListener('click', () => copy(lastJson, 'Filter JSON copied.'));
  $('#share').addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}#f=${btoa(unescape(encodeURIComponent(JSON.stringify(portable()))))}`;
    copy(link, 'Share link copied. Anyone who opens it gets your settings.');
  });
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); flash(done); } catch { flash('Copy was blocked. Use “Preview the file” and copy it from there.'); }
}

/* ---------- game folder ---------- */

const gameUi = { conn: null, files: [], linked: null, savedJson: null, remembered: null, error: '' };
const slug = () => (state.name || 'filter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'filter';
const dirty = () => Boolean(gameUi.linked) && gameUi.savedJson !== lastJson;
const sameFile = (a, b) => a && b && a.name === b.name && a.where === b.where;

function renderGame() {
  const el = $('#game');
  if (!el) return;
  if (!game.supported) {
    el.innerHTML = '<p class="fine">Open this page in Chrome or Edge on a computer to install straight into your game folder. In this browser, use Download and the steps below.</p>';
    return;
  }
  const g = gameUi;
  if (!g.conn) {
    el.innerHTML = `${g.remembered ? `<button class="button primary" type="button" data-game="reconnect"><span aria-hidden="true">/</span> Reconnect to ${esc(g.remembered.name)}</button>` : ''}
      <button class="button ${g.remembered ? 'secondary' : 'primary'}" type="button" data-game="connect"><span aria-hidden="true">/</span> Connect game folder</button>
      <p class="fine">Pick your Diablo II Resurrected folder. The builder only reads and writes <code>mods\\PD2Resurrected\\d2rloader\\config</code>. Nothing leaves your computer.</p>
      ${g.error ? `<p class="status error" role="alert">${esc(g.error)}</p>` : ''}`;
    return;
  }
  const name = g.linked?.name ?? `${slug()}.json`;
  el.innerHTML = `<p class="game-conn">Connected to <b>${esc(g.conn.root.name)}</b> <button class="link-btn" type="button" data-game="connect">Change</button> <button class="link-btn" type="button" data-game="disconnect">Disconnect</button></p>
    <button class="button primary" type="button" data-game="save"><span aria-hidden="true">/</span> ${g.linked ? `Save to ${esc(name)}` : `Install filter as ${esc(name)}`}</button>
    <p class="save-state ${dirty() ? 'dirty' : g.linked ? 'clean' : ''}" role="status">${!g.linked ? 'Not installed yet.' : dirty() ? 'Unsaved changes. Press Save or Ctrl+S; the game reloads the filter on save.' : 'Saved. The game reloads it automatically.'}</p>
    ${g.linked ? '<button class="link-btn" type="button" data-game="save-new">Save as a new file instead</button>' : ''}
    ${g.linked?.where === 'config' ? '<p class="fine">This is the mod’s own <code>config\\filter.json</code>. A mod update replaces it. “Save as a new file” keeps your copy in the filter folder.</p>' : ''}
    <h3 class="game-files">Filters in your game</h3>
    ${g.files.length ? `<ul class="files">${g.files.map((f, i) => `<li${sameFile(g.linked, f) ? ' class="current"' : ''}>
      <span><b>${esc(f.name)}</b><small>${f.where === 'config' ? 'config\\filter.json (mod default)' : 'filter folder'} · ${new Date(f.modified).toLocaleString()}</small></span>
      ${sameFile(g.linked, f) ? '<span class="badge">Editing</span>' : `<button class="button secondary" type="button" data-game-open="${i}">Open</button>`}</li>`).join('')}</ul>`
      : '<p class="fine">No filters yet. Install one above.</p>'}
    <p class="fine">In game: <b>Esc → Options → Gameplay → Loot Filter Profile</b>, then pick the file.</p>
    ${g.error ? `<p class="status error" role="alert">${esc(g.error)}</p>` : ''}`;
}

async function gameAction(action, arg) {
  const g = gameUi;
  g.error = '';
  try {
    if (action === 'connect') { g.conn = await game.connect(); g.linked = null; g.savedJson = null; rememberLink(); await refreshFiles(); }
    else if (action === 'reconnect') { g.conn = await game.reconnect(g.remembered.handle); await refreshFiles(); await relink(); }
    else if (action === 'disconnect') { await game.forget(); Object.assign(g, { conn: null, files: [], linked: null, savedJson: null, remembered: null }); rememberLink(); }
    else if (action === 'save' || action === 'save-new') await saveToGame(action === 'save-new');
    else if (action === 'open') await openFromGame(g.files[arg]);
  } catch (err) {
    if (err?.name !== 'AbortError') g.error = err?.message || String(err);
  }
  renderGame();
}

async function refreshFiles() { gameUi.files = await game.listFilters(gameUi.conn); }

// Remember which game file is being edited, so a reload picks it up again.
function rememberLink() {
  const l = gameUi.linked;
  try { l ? localStorage.setItem(STORE + ':file', JSON.stringify({ name: l.name, where: l.where })) : localStorage.removeItem(STORE + ':file'); } catch { /* storage blocked */ }
}

async function relink() {
  let want = null;
  try { want = JSON.parse(localStorage.getItem(STORE + ':file')); } catch { /* none */ }
  const entry = want && gameUi.files.find(f => sameFile(f, want));
  if (!entry) return;
  gameUi.linked = entry;
  gameUi.savedJson = (await game.readFilter(entry)).trim();
}

async function saveToGame(asNew) {
  const g = gameUi;
  const entry = asNew ? null : g.linked;
  let name = entry?.name ?? `${slug()}.json`;
  if (!entry && await game.exists(g.conn, name)) {
    if (asNew) {
      for (let n = 2; await game.exists(g.conn, name); n++) name = `${slug()}-${n}.json`;
    } else if (!confirm(`${name} already exists in your filter folder. Replace it?`)) return;
  }
  g.linked = await game.writeFilter(g.conn, entry, name, lastJson + '\n');
  g.savedJson = lastJson;
  rememberLink();
  await refreshFiles();
  flash(`Saved ${g.linked.name}. If it is the active profile, the game has already reloaded it.`);
}

async function openFromGame(entry) {
  if (dirty() && !confirm('You have unsaved changes. Open another filter anyway?')) return;
  const text = await game.readFilter(entry);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${entry.name} is not valid JSON, so it cannot be opened here.`); }
  const ours = json?.builder?.format === 'pd2r-filter-builder';
  if (ours) {
    state = sanitize(json.builder.settings);
    flash(`Opened ${entry.name}.`);
  } else if (Array.isArray(json?.rules)) {
    state = sanitize({ name: typeof json.name === 'string' ? json.name : entry.name.replace(/\.json$/i, ''), level: 0, imported: { from: entry.name, rules: json.rules } });
    view = 'picks';
    const kept = state.imported?.rules.length ?? 0, dropped = json.rules.length - kept;
    flash(`Opened ${entry.name}. ${kept} rules are kept under My picks${dropped ? `; ${dropped} could not be read and were left out` : ''}. Saving writes a new file, so the original stays as it was.`);
  } else {
    throw new Error(`${entry.name} does not look like a loot filter (it has no rules list).`);
  }
  styles = effectiveStyles(state);
  gameUi.linked = ours ? entry : null;
  rememberLink();
  search = ''; $('#search').value = '';
  renderLevels(); renderView(); save();
  // A builder file saved by this version compiles to the same text; anything else counts as changed until saved.
  gameUi.savedJson = ours && text.trim() === lastJson ? lastJson : text.trim();
  renderGame();
}

async function startGame() {
  if (!game.supported) return renderGame();
  const r = await game.remembered();
  if (r?.granted) {
    try { gameUi.conn = await game.reconnect(r.handle); await refreshFiles(); await relink(); } catch { gameUi.remembered = { name: r.handle.name, handle: r.handle }; }
  } else if (r) gameUi.remembered = { name: r.handle.name, handle: r.handle };
  renderGame();
}

/* ---------- start ---------- */

async function start() {
  try {
    data = await (await fetch('data/pd2r-items.json')).json();
  } catch {
    $('#view').innerHTML = '<p class="empty">Could not load the item data. Reload the page to try again.</p>';
    return;
  }
  catalog = buildCatalog(data);
  groupsById = new Map(catalog.flatMap(c => c.groups).map(g => [g.id, g]));
  groupOfCode = new Map(catalog.flatMap(c => c.groups).flatMap(g => (g.codes ?? []).map(code => [code, g])));
  state = loadState();
  styles = effectiveStyles(state);
  if (location.hash) history.replaceState(null, '', location.pathname); // settings are now saved locally
  $('#data-source').href = `https://github.com/${data.source.repo}/tree/${data.source.commit}`;
  $('#data-source').textContent = `pd2-resurrected (${data.source.commit})`;
  renderLevels(); renderSidebar(); renderView(); renderExport(); bind();
  save();
  startGame();
}

start();
