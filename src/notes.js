// ================= NOTES =================
// Notes live in the page's shared database (collection "notes"), one document per note:
// { title, folder, body (Markdown with [[wiki links]]), createdAt, updatedAt, trashed? }.
// Older versions of a note are kept under notes/<id>/history.
const GROUPS = [
  { id: 'canon', name: 'Canon', desc: 'The source of truth, the index and the decisions log.', folders: ['Current Canon', 'Start Here'] },
  { id: 'design', name: 'Game design', desc: 'Progression, memories, death, co-op, races and rest.', folders: ['Game Design'] },
  { id: 'combat', name: 'Combat', desc: 'Movement, wallrun, melee, blocking and parrying.', folders: ['Combat & Movement'] },
  { id: 'magic', name: 'Magic', desc: 'Magic in the world, the six schools, the spell loadout, fusion and status effects.', folders: ['Magic System'] },
  { id: 'world', name: 'World', desc: 'The island, rifts, Rift Roads, NPCs and factions, enemies and lore.', folders: ['World', 'Enemies', 'Story & Lore'] },
  { id: 'items', name: 'Items', desc: 'Inventory, crafting, durability and repair.', folders: ['Items Gear Inventory'] },
  { id: 'other', name: 'Plans & archive', desc: 'What is being built first, devlog scripts and archived ideas. Not canon.', folders: ['Vertical Slice', 'Judev (Youtube) Scripts', 'Archive'] }
];
const PIN = ['Current Canon', 'Canon Review', 'Vael Awakening - Master Index', 'Magic in the World', 'Magic Schools Overview'];
const NEW_BODY = 'Status: Draft\n\n';
let rawNotes = [], NOTES = [], byId = new Map(), byTitle = new Map();
let group = store.get('vael.noteGroup') || 'canon', stack = [], current = null, shownSig = '';
let notesCol = null, notesLoaded = false, notesReadOnly = false;
let pendingOpen = /^#n-/.test(location.hash) ? location.hash.slice(3) : null;

const slugify = t => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const fmtDateTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const liveNotes = () => NOTES.filter(n => !n.trashed);
const whoEdited = n => { const w = n.by && window.vaelName ? window.vaelName(n.by) : ''; return w ? ' by ' + w : ''; };
const sigOf = n => n.title + '\u0000' + n.folder + '\u0000' + n.body + '\u0000' + n.trashed;
function setHash(h){ try { if (location.hash !== '#' + h) history.replaceState(null, '', '#' + h); } catch {} }

function statusOf(body){
  const m = /^Status:\s*(.+)$/m.exec(body); const s = m ? m[1].trim() : '';
  if (/archiv/i.test(s)) return { cls: 'archived', label: 'Archived', full: s };
  if (/future/i.test(s)) return { cls: 'future', label: 'Future scope', full: s };
  if (/draft/i.test(s)) return { cls: 'future', label: 'Draft', full: s };
  if (/canon/i.test(s)) return { cls: 'canon', label: 'Canon', full: s };
  return { cls: '', label: s ? 'Note' : '', full: s };
}
const groupOfFolder = f => GROUPS.find(g => g.folders.some(x => f === x || String(f).startsWith(x + '/'))) || GROUPS[GROUPS.length - 1];
const groupOf = n => groupOfFolder(n.folder);
function plain(md){ return String(md).replace(/^#.*$/gm, '').replace(/^Status:.*$/m, '').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_`>#|-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
// Every [[target]] in a note, without alias or #heading.
function linksIn(body){
  const out = [], re = /\[\[([^\]\n]+)\]\]/g; let m;
  while ((m = re.exec(body))){ const t = m[1].split(/\\?\|/)[0].split('#')[0].trim(); if (t) out.push(t); }
  return out;
}
function setNotes(raw){
  rawNotes = raw;
  NOTES = raw.filter(n => n && typeof n.title === 'string' && n.title.trim()).map(n => {
    const body = String(n.body || ''), p = plain(body);
    return { id: n.id, title: n.title.trim(), folder: String(n.folder || ''), body, createdAt: String(n.createdAt || ''), updatedAt: String(n.updatedAt || ''), by: String(n.updatedBy || ''), trashed: !!n.trashed,
      status: statusOf(body), plain: p, lower: (p + ' ' + n.title).toLowerCase(), summary: p.slice(0, 160), out: [...new Set(linksIn(body).map(s => s.toLowerCase()))] };
  });
  byId = new Map(NOTES.map(n => [n.id, n]));
  byTitle = new Map(liveNotes().map(n => [n.title.toLowerCase(), n]));
}
// Show our own write straight away, without waiting for the store to echo it.
function applyLocal(doc){ const i = rawNotes.findIndex(n => n.id === doc.id); const next = rawNotes.slice(); if (i >= 0) next[i] = { ...rawNotes[i], ...doc }; else next.push(doc); setNotes(next); }
function refreshLists(){
  noteTabs(); drawNoteList();
  const n = liveNotes().length;
  $('notesStamp').textContent = !notesLoaded ? '' : notesReadOnly ? `${n} notes. You can read these notes but not change them.` : `${n} notes. Changes save for everyone who can open this page.`;
  applyGroupView();
}

// ---------- list ----------
function noteTabs(){
  const live = liveNotes(), trash = NOTES.length - live.length;
  if (group === 'trash' && !trash) group = 'canon';
  const btn = (id, name, n) => `<button type="button" role="tab" data-g="${id}" aria-selected="${id === group}">${name}${n === '' ? '' : `<span class="n">${n}</span>`}</button>`;
  $('noteTabs').innerHTML = btn('recent', 'Recent', '') + btn('graph', 'Graph', '') + GROUPS.map(g => btn(g.id, g.name, live.filter(n => groupOf(n) === g).length)).join('') + (trash ? btn('trash', 'Trash', trash) : '');
}
$('noteTabs').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (!b) return; group = b.dataset.g; store.set('vael.noteGroup', group); $('noteSearch').value = ''; noteTabs(); drawNoteList(); applyGroupView(); $('notesPane').scrollTop = 0; });

function rowFor(n, snippet){
  const st = n.status;
  return `<button type="button" class="row" data-nid="${esc(n.id)}"><span class="t">${esc(n.title)}</span><span class="r">${st.label ? `<span class="pill ${st.cls}">${esc(st.label)}</span>` : ''}<span class="chev" aria-hidden="true">›</span></span><span class="s">${snippet ?? esc(n.summary)}</span></button>`;
}
function drawNoteList(){
  if (group === 'graph') return;
  const empty = t => `<div class="row"><span class="t muted">${t}</span></div>`;
  if (!notesLoaded){ $('noteList').innerHTML = empty('Loading notes…'); return; }
  const q = $('noteSearch').value.trim().toLowerCase(), live = liveNotes();
  if (q){
    const hits = live.map(n => ({ n, i: n.lower.indexOf(q), t: n.title.toLowerCase().includes(q) })).filter(h => h.t || h.i >= 0).sort((a, b) => (b.t - a.t) || a.n.title.localeCompare(b.n.title));
    $('groupDesc').textContent = `${hits.length} note${hits.length === 1 ? '' : 's'} mention “${$('noteSearch').value.trim()}”.`;
    $('noteList').innerHTML = hits.map(({ n, i }) => {
      let snip = esc(n.summary);
      if (i >= 0 && i < n.plain.length){ const a = Math.max(0, i - 50), raw = n.plain.slice(a, i + q.length + 80), j = raw.toLowerCase().indexOf(q); if (j >= 0) snip = (a ? '…' : '') + esc(raw.slice(0, j)) + '<mark>' + esc(raw.slice(j, j + q.length)) + '</mark>' + esc(raw.slice(j + q.length)) + '…'; }
      return rowFor(n, snip);
    }).join('') || empty('No notes match.');
    return;
  }
  if (group === 'recent'){
    $('groupDesc').textContent = 'The 15 most recently changed notes.';
    $('noteList').innerHTML = live.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15).map(n => rowFor(n, esc(fmtDate(n.updatedAt) + whoEdited(n)) + ' · ' + esc(n.summary))).join('') || empty('No notes yet.');
    return;
  }
  if (group === 'trash'){
    $('groupDesc').textContent = 'Notes moved to the trash. Open one to restore it or delete it for good.';
    $('noteList').innerHTML = NOTES.filter(n => n.trashed).map(n => rowFor(n)).join('');
    return;
  }
  const g = GROUPS.find(x => x.id === group) || GROUPS[0];
  $('groupDesc').textContent = g.desc;
  const list = live.filter(n => groupOf(n) === g).sort((a, b) => {
    const pa = PIN.indexOf(a.title), pb = PIN.indexOf(b.title);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || g.folders.indexOf(a.folder.split('/')[0]) - g.folders.indexOf(b.folder.split('/')[0]) || a.title.localeCompare(b.title);
  });
  $('noteList').innerHTML = list.map(n => rowFor(n)).join('') || empty(notesReadOnly ? 'No notes here yet.' : 'No notes here yet. Tap New note to write the first one.');
}
$('noteSearch').addEventListener('input', drawNoteList);
$('noteList').addEventListener('click', e => { const b = e.target.closest('[data-nid]'); if (b){ stack = []; openNote(b.dataset.nid, true); } });

// ---------- reading ----------
// Wiki links become ordinary Markdown links with a private #wl: target, so the Markdown
// renderer can treat everything else in a note as untrusted text.
function wikiToMd(md){
  return md.replace(/\[\[([^\]\n]+)\]\]/g, (_, inner) => {
    const parts = inner.split(/\\?\|/), target = parts[0].trim(), name = target.split('#')[0].trim();
    if (!name) return _;
    const label = (parts[1] || target).trim().replace(/([\[\]\\])/g, '\\$1');
    return `[${label}](#wl:${encodeURIComponent(name).replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  });
}
if (window.marked) window.marked.use({ renderer: {
  html(h){ return esc(h); },
  image(href, title, text){ return esc(text || ''); },
  // A ```zurivel block in a note becomes a live Zurivel translator (mounted by mountZurivel).
  code(code, lang){ return String(lang || '').trim().toLowerCase() === 'zurivel' ? '<div class="zc" data-zc></div>' : false; },
  link(href, title, text){
    href = String(href || '');
    if (href.startsWith('#wl:')){
      let name = ''; try { name = decodeURIComponent(href.slice(4)); } catch {}
      return byTitle.has(name.toLowerCase()) ? `<a class="wl" data-wl="${esc(name)}" href="#notes">${text}</a>` : `<a class="wl wl-missing" data-wl="${esc(name)}" href="#notes" title="No note with this name yet">${text}</a>`;
    }
    return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : text;
  }
} });
function renderMd(md){ return window.marked ? window.marked.parse(wikiToMd(md), { gfm: true, breaks: false }) : `<pre style="white-space:pre-wrap">${esc(md)}</pre>`; }

// ---------- Zurivel translator ----------
// A ```zurivel block becomes an English <-> Zurivel translator. Its words come from the "Zurivel Dictionary" note
// (every table with Zurivel and English columns), so a row added there is known at once. The grammar below follows
// the "Zurivel Grammar" note: subject-verb-object, describing words after the noun, numbers and belonging words
// before it, endings for plural (-ar/-r), "the" (-en), belonging (-s), past (-ak), future (-ul), command (-a), more (-ir).
const Z_VOW = 'aæeioøuy';
const Z_DI = { ae: 'æ', ch: 'č', dh: 'ð', ng: 'ŋ', oe: 'ø', sh: 'š', th: 'þ', zh: 'ž' };
const Z_KEYS = [['æ', 'ae', 'a in cat'], ['č', 'ch', 'ch in chat'], ['ð', 'dh', 'th in this'], ['ŋ', 'ng', 'ng in sing'], ['ø', 'oe', 'ur in fur'], ['š', 'sh', 'sh in ship'], ['þ', 'th', 'th in thin'], ['ž', 'zh', 's in measure']];
const Z_ONSET = new Set(['br', 'dr', 'gr', 'kr', 'pr', 'tr', 'fr', 'bl', 'gl', 'kl', 'pl', 'fl']);
const Z_END = { ar: 'plural', r: 'plural', en: 'the', s: 'belonging', ak: 'past', ul: 'future', a: 'command', ir: 'more' };
const zUpper = c => c !== c.toLowerCase();
const zCap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// Keyboard -> Zurivel letters (krong -> kroŋ). An apostrophe keeps a pair apart (n'g).
function zType(src){
  let out = '';
  for (let i = 0; i < src.length;){
    const c = src[i];
    if ((c === "'" || c === '’') && i > 0 && i < src.length - 1 && Z_DI[(src[i - 1] + src[i + 1]).toLowerCase()]){ i++; continue; }
    const two = src.substr(i, 2).toLowerCase();
    if (two.length === 2 && Z_DI[two]){ out += zUpper(c) ? Z_DI[two].toUpperCase() : Z_DI[two]; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
// Syllables, for "say it": a doubled vowel is one long vowel; two different vowels are two syllables; one consonant
// between vowels starts the next syllable; two do too if they are a legal start (br, kl...), otherwise they split.
function zSyl(w){
  const s = [...w], low = w.toLowerCase(), nuc = [];
  for (let i = 0; i < low.length; i++) if (Z_VOW.includes(low[i])){ const j = low[i + 1] === low[i] ? i + 1 : i; nuc.push([i, j]); i = j; }
  if (nuc.length < 2) return [w];
  const cuts = [];
  for (let k = 0; k + 1 < nuc.length; k++){
    const a = nuc[k][1] + 1, b = nuc[k + 1][0], run = low.slice(a, b);
    cuts.push(run.length <= 1 ? a : run.length === 2 ? (Z_ONSET.has(run) ? a : a + 1) : b - (Z_ONSET.has(run.slice(-2)) ? 2 : 1));
  }
  const out = []; let p = 0; for (const c of cuts){ out.push(s.slice(p, c).join('')); p = c; } out.push(s.slice(p).join(''));
  return out;
}
const zSay = w => zSyl(w).map((x, i) => i ? x.toLowerCase() : x.toUpperCase()).join('-');
// Say it in English spelling, following the sounds in the Zurivel Alphabet note: the stressed first syllable in
// capitals (KROHNG-hahth). A doubled vowel is held long (šaar: SHAAHR).
const Z_SAYV = { a: 'ah', æ: 'a', e: 'eh', i: 'ee', o: 'oh', ø: 'ur', u: 'oo', y: 'uh' };
const Z_SAYL = { a: 'aah', æ: 'aa', e: 'ehh', i: 'eee', o: 'ohh', ø: 'urr', u: 'ooo', y: 'uhh' };
const Z_SAYC = { č: 'ch', ð: 'dh', ŋ: 'ng', š: 'sh', þ: 'th', ž: 'zh' };
function zPron(w){
  if (!/[aæeioøuy]/i.test(w)) return w;
  return zSyl(w).map((syl, n) => {
    const s = syl.toLowerCase(); let o = '';
    for (let i = 0; i < s.length; i++){
      const c = s[i];
      if (Z_SAYV[c]){ if (s[i + 1] === c){ o += Z_SAYL[c]; i++; } else o += Z_SAYV[c]; }
      else o += Z_SAYC[c] || c;
    }
    return n ? o : o.toUpperCase();
  }).join('-');
}
const zPronLine = text => (text.match(/[A-Za-zÀ-ɏ']+|[.,!?;:]/g) || []).reduce((s, t) => /^[.,!?;:]$/.test(t) ? s + t : s + (s ? ' ' : '') + zPron(t), '');
function zAdd(root, end){
  if (end === 'ar' && Z_VOW.includes(root.slice(-1).toLowerCase())) return root + 'r';
  return root + end;
}

// The dictionary, read from the note and kept until the note changes.
let zDictCache = { sig: null, d: null };
function zDict(){
  const n = byTitle.get('zurivel dictionary'), sig = n ? n.updatedAt + '|' + n.body.length : '';
  if (zDictCache.sig === sig) return zDictCache.d;
  const d = { n: 0, en: new Map(), z: new Map(), note: !!n };
  if (n){
    let cols = null;
    for (const line of n.body.split('\n')){
      const t = line.trim();
      if (!t.startsWith('|')){ cols = null; continue; }
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      if (!cols){ const h = cells.map(c => c.toLowerCase()); if (h.includes('zurivel') && h.includes('english')) cols = { z: h.indexOf('zurivel'), en: h.indexOf('english'), type: h.indexOf('type'), built: h.indexOf('built from') }; continue; }
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      const z = cells[cols.z] || '', en = cells[cols.en] || '';
      if (!z || !en) continue;
      const type = cols.type >= 0 ? String(cells[cols.type] || '').toLowerCase() : '';
      const senses = en.replace(/\([^)]*\)/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const e = { z, zl: z.toLowerCase(), senses, gloss: senses[0] || en, type, built: cols.built >= 0 ? cells[cols.built] || '' : '' };
      d.n++;
      if (!['name', 'prefix', 'suffix'].includes(type)) for (const s of senses){ if (!d.en.has(s)) d.en.set(s, []); d.en.get(s).push(e); }
      if (!['prefix', 'suffix', 'phrase'].includes(type)){ if (!d.z.has(e.zl)) d.z.set(e.zl, []); d.z.get(e.zl).push(e); }
    }
  }
  zDictCache = { sig, d };
  return d;
}

// ---------- English -> Zurivel ----------
const EN_IRR = { went: 'go', gone: 'go', saw: 'see', seen: 'see', took: 'take', taken: 'take', came: 'come', ate: 'eat', eaten: 'eat', drank: 'drink', drunk: 'drink', said: 'say', knew: 'know', known: 'know', gave: 'give', given: 'give', fought: 'fight', heard: 'hear', made: 'make', did: 'do', done: 'do', had: 'have', found: 'find', lost: 'lose', bought: 'buy', sold: 'sell', thought: 'think', told: 'tell', left: 'leave', held: 'hold', ran: 'run', fell: 'fall', fallen: 'fall', stood: 'stand', sat: 'sit', slept: 'sleep', flew: 'fly', flown: 'fly', swam: 'swim', sang: 'sing', sung: 'sing', wrote: 'write', written: 'write', broke: 'break', broken: 'break', built: 'build', brought: 'bring', taught: 'teach', hid: 'hide', hidden: 'hide', led: 'lead', felt: 'feel', kept: 'keep', paid: 'pay', spoke: 'speak', spoken: 'speak', woke: 'wake', grew: 'grow', stole: 'steal', stolen: 'steal', wept: 'weep', sought: 'seek', learnt: 'learn', burnt: 'burn', fled: 'flee', struck: 'hit', bore: 'bear', meant: 'mean', became: 'become', began: 'begin', got: 'get' };
const EN_PAST = {}; for (const [p, b] of Object.entries(EN_IRR)) if (!EN_PAST[b]) EN_PAST[b] = p;
const EN_PL = { men: 'man', women: 'woman', children: 'child', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose', wolves: 'wolf', knives: 'knife', lives: 'life', elves: 'elf', dwarves: 'dwarf', leaves: 'leaf', thieves: 'thief', wives: 'wife', halves: 'half', loaves: 'loaf' };
const EN_PLR = {}; for (const [p, s] of Object.entries(EN_PL)) EN_PLR[s] = p;
const EN_CMP = { better: 'good', best: 'good', worse: 'bad', worst: 'bad' };
const EN_BE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
const EN_DO = new Set(['do', 'does', 'did']);
const EN_WILL = new Set(['will', 'shall', 'would']);
const EN_MODAL = new Set(['can', 'could', 'must', 'should', 'may', 'might']);
// Ways an English word can be a form of a dictionary word: [lemma, what the form adds].
function enForms(w){
  const out = [[w, {}]], add = (s, f) => { if (s.length > 1) out.push([s, f]); };
  if (EN_IRR[w]) add(EN_IRR[w], { past: true });
  if (EN_PL[w]) add(EN_PL[w], { plural: true });
  if (EN_CMP[w]) add(EN_CMP[w], { comp: true });
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y', { plural: true, s3: true });
  if (/(ses|xes|ches|shes|oes|zes)$/.test(w)) add(w.slice(0, -2), { plural: true, s3: true });
  if (/[^s]s$/.test(w)) add(w.slice(0, -1), { plural: true, s3: true });
  if (/ing$/.test(w)){ const b = w.slice(0, -3); add(b, { ing: true }); add(b + 'e', { ing: true }); if (/(.)\1$/.test(b)) add(b.slice(0, -1), { ing: true }); if (/y$/.test(b)) add(b.slice(0, -1) + 'ie', { ing: true }); }
  if (/ed$/.test(w)){ const b = w.slice(0, -2); add(b, { past: true }); add(w.slice(0, -1), { past: true }); if (/(.)\1$/.test(b)) add(b.slice(0, -1), { past: true }); if (/ied$/.test(w)) add(w.slice(0, -3) + 'y', { past: true }); }
  if (/er$/.test(w)){ const b = w.slice(0, -2); add(b, { comp: true }); add(w.slice(0, -1), { comp: true }); if (/(.)\1$/.test(b)) add(b.slice(0, -1), { comp: true }); if (/ier$/.test(w)) add(w.slice(0, -3) + 'y', { comp: true }); }
  return out;
}
const FEAT_OK = { plural: ['noun'], s3: ['verb'], past: ['verb'], ing: ['verb'], comp: ['adj'] };
function enReadings(d, w){
  const out = [];
  for (const [lemma, f] of enForms(w)){
    const es = d.en.get(lemma); if (!es) continue;
    for (const e of es){
      const keys = Object.keys(f);
      if (keys.length && !keys.some(k => FEAT_OK[k].includes(e.type))) continue;
      const ff = {}; for (const k of keys) if (FEAT_OK[k].includes(e.type)) ff[k] = true;
      out.push({ e, f: ff, lemma });
    }
    if (out.length && !Object.keys(f).length) break;   // an exact match wins over guessed forms
  }
  return out;
}
const PREF = {
  np: ['noun', 'adj', 'num', 'question', 'poss', 'pron', 'place', 'verb', 'adv', 'prep', 'conj', 'particle', 'phrase'],
  verb: ['verb', 'adj', 'noun', 'pron', 'adv', 'prep', 'conj', 'particle', 'num', 'question', 'poss', 'place', 'phrase'],
  pred: ['adj', 'noun', 'pron', 'verb', 'num', 'adv', 'prep', 'conj', 'particle', 'question', 'poss', 'place', 'phrase'],
  start: ['pron', 'question', 'num', 'poss', 'particle', 'phrase', 'noun', 'adj', 'adv', 'conj', 'prep', 'place', 'verb'],
  any: ['pron', 'question', 'poss', 'noun', 'verb', 'adj', 'num', 'prep', 'conj', 'adv', 'particle', 'place', 'phrase']
};
const pick = (rs, order) => { for (const t of order){ const r = rs.find(x => x.e.type === t); if (r) return r; } return rs[0]; };

function enTokens(s){
  s = s.replace(/[’‘]/g, "'")
    .replace(/\bwon't\b/gi, 'will not').replace(/\bcan't\b/gi, 'can not').replace(/\bcannot\b/gi, 'can not').replace(/n't\b/gi, ' not')
    .replace(/'m\b/gi, ' am').replace(/'re\b/gi, ' are').replace(/'ll\b/gi, ' will').replace(/'ve\b/gi, ' have').replace(/'d\b/gi, ' would')
    .replace(/\b(it|he|she|that|this|what|where|who|there|here|how|when|why)'s\b/gi, '$1 is');
  return (s.match(/[A-Za-zÀ-ɏ]+(?:'s|s')?|\d+|[.!?,;:]/g) || []).map(t => {
    const poss = /'s$|s'$/.test(t), word = t.replace(/'s$/, '').replace(/'$/, '');
    return { t: word, w: word.toLowerCase(), poss, p: /^[.!?,;:]$/.test(t) };
  });
}
function enSentences(text){
  const toks = enTokens(text), out = []; let cur = [];
  for (const t of toks){ cur.push(t); if (t.p && /[.!?]/.test(t.t)){ out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}

function enToZurivel(text){
  const d = zDict(), res = { sentences: [], missing: [], dropped: [], rows: [] };
  for (let toks of enSentences(text)){
    const end = toks.length && toks[toks.length - 1].p && /[.!?]/.test(toks[toks.length - 1].t) ? toks.pop().t : '';
    const words = toks.filter(t => !t.p);
    if (!words.length){ continue; }
    const q = end === '?';
    // Whole-sentence and multi-word matches first ("thank you", "Starting Town", "how many", "have to").
    const g = [];
    for (let i = 0; i < toks.length;){
      let hit = null;
      for (let n = Math.min(4, toks.length - i); n >= 2 && !hit; n--){
        const span = toks.slice(i, i + n); if (span.some(t => t.p)) continue;
        const key = span.map(t => t.w).join(' ');
        if (d.en.has(key)) hit = { t: span.map(x => x.t).join(' '), w: key, poss: span[n - 1].poss, multi: n };
      }
      if (hit){ g.push(hit); i += hit.multi; } else { g.push(toks[i]); i++; }
    }
    toks = g;
    // A question that starts with can/must/should (after an optional question word): put it after the subject.
    const qi = toks.length && d.en.get(toks[0].w) && d.en.get(toks[0].w).some(e => e.type === 'question') ? 1 : 0;
    if (q && toks[qi] && EN_MODAL.has(toks[qi].w) && toks[qi + 1]){
      let j = qi + 1;
      const isNoun = t => enReadings(d, t.w).some(r => r.e.type === 'noun' || r.e.type === 'pron');
      while (j < toks.length - 1 && !isNoun(toks[j])) j++;
      const [m] = toks.splice(qi, 1); toks.splice(j, 0, m);
    }
    const whFirst = toks.length && (d.en.get(toks[0].w) || []).some(e => e.type === 'question');
    // A command: the sentence starts with a plain verb (or "do not" + verb) and isn't a question.
    let cmd = false;
    if (!q){
      const a = toks[0], b = toks[1], c = toks[2];
      const verbBase = t => t && !t.p && enReadings(d, t.w).some(r => r.e.type === 'verb' && !Object.keys(r.f).length);
      if (a && EN_DO.has(a.w) && b && b.w === 'not' && verbBase(c)) cmd = true;
      else if (verbBase(a) && !['pron', 'noun'].includes(pick(enReadings(d, a.w), PREF.start).e.type) && !(b && (EN_BE.has(b.w) || EN_WILL.has(b.w)))) cmd = true;
      else if (verbBase(a) && (!b || b.p || ['pron', 'poss'].includes((pick(enReadings(d, b.w) || [], PREF.any) || { e: {} }).e.type) || ['the', 'a', 'an', 'to', 'not'].includes(b.w))) cmd = true;
    }

    const out = [];   // units: {k:'w', z, parts, src} | {k:'np', ...} | {k:'p', t}
    let np = null, verbDone = false, cmdDone = false, tense = null, past = false, beSeen = false, bePast = false, neg = false, more = false, ofAt = -1, prev = 'start';
    const newNP = () => ({ k: 'np', poss: [], num: null, pre: [], noun: null, adjs: [], the: false, plural: false, possS: false, src: [] });
    const flush = () => {
      if (!np) return;
      if (np.noun || np.adjs.length || np.poss.length || np.num){
        if (ofAt >= 0 && np.noun){ np.possS = true; const first = out[ofAt]; if (first && first.k === 'np') first.the = false; out.splice(ofAt, 0, np); ofAt = -1; }
        else out.push(np);
      }
      np = null;
    };
    const unit = (r, src, ends) => ({ k: 'w', z: r.e.z, e: r.e, ends: ends || [], src });
    // "going to" is the future only when a plain verb follows ("going to fight"), not a place ("going to the inn").
    const goingToVerb = k => { const t = toks[k]; return !!t && !t.p && enReadings(d, t.w).some(r => r.e.type === 'verb' && !Object.keys(r.f).length) && !['the', 'a', 'an'].includes(t.w); };
    const verbUnit = (r, src) => {
      flush();
      const ends = [];
      let vo = false;
      if (cmd && !cmdDone){ ends.push('a'); cmdDone = true; }
      else if (!verbDone){
        if (r.f.ing && beSeen) vo = true;
        if (tense === 'future') ends.push('ul');
        else if (past || r.f.past || (vo && bePast)) ends.push('ak');
      }
      if (vo) out.push({ k: 'w', z: 'vo', gloss: 'ongoing', src: '' });
      out.push(unit(r, src, ends));
      verbDone = true; tense = null; past = false;
      if (neg){ out.push({ k: 'w', z: 'nu', gloss: 'not', src: 'not' }); neg = false; }
      prev = 'verb';
    };
    for (let i = 0; i < toks.length; i++){
      const tk = toks[i], w = tk.w, nx = toks[i + 1];
      if (tk.p){ flush(); out.push({ k: 'p', t: tk.t }); if (tk.t === ',' || tk.t === ';'){ verbDone = false; prev = 'start'; } continue; }
      const rs = tk.multi ? (d.en.get(w) || []).map(e => ({ e, f: {}, lemma: w })) : enReadings(d, w);
      const known = rs.length > 0;
      const nxR = nx && !nx.p ? enReadings(d, nx.w) : [];
      const nxVerb = nxR.some(r => r.e.type === 'verb') && !nxR.some(r => ['noun', 'pron', 'adj', 'num', 'poss'].includes(r.e.type) && !Object.keys(r.f).length && r.e.type !== 'verb');
      // Grammar words that become endings or disappear.
      if (!tk.multi){
        if (w === 'a' || w === 'an'){ np = np || newNP(); res.dropped.push(w); prev = 'np'; continue; }
        if (w === 'the'){ flush(); np = newNP(); np.the = true; res.dropped.push('the → -en'); prev = 'np'; continue; }
        if (w === 'there' && i === 0 && nx && EN_BE.has(nx.w)){ i++; res.dropped.push('there ' + nx.w); continue; }
        if (EN_BE.has(w)){
          flush();
          let j = i + 1; if (toks[j] && toks[j].w === 'not'){ neg = true; j++; }
          if (toks[j] && toks[j].w === 'going' && toks[j + 1] && toks[j + 1].w === 'to' && goingToVerb(j + 2)){ tense = 'future'; res.dropped.push(w + ' going to → -ul'); i = j + 1; continue; }
          beSeen = true; bePast = w === 'was' || w === 'were';
          if (j > i + 1) i = j - 1;
          res.dropped.push(w); prev = 'pred'; continue;
        }
        if (EN_DO.has(w) && (q || (nx && nx.w === 'not') || nxVerb)){
          if (w === 'did') past = true;
          if (nx && nx.w === 'not'){ neg = true; i++; }
          res.dropped.push(w === 'did' ? 'did → -ak' : w); continue;
        }
        if (EN_WILL.has(w)){ tense = 'future'; res.dropped.push(w + ' → -ul'); if (nx && nx.w === 'not'){ neg = true; i++; } continue; }
        if (w === 'not' || (w === 'no' && words.length > 1 && verbDone)){
          const last = out[out.length - 1];
          if (last && last.k === 'w' && last.e && last.e.type === 'verb'){ out.push({ k: 'w', z: 'nu', gloss: 'not', src: w }); }
          else neg = true;
          continue;
        }
        if (w === 'to' && nxVerb){ res.dropped.push('to'); continue; }
        if (w === 'more' && nxR.some(r => r.e.type === 'adj')){ more = true; res.dropped.push('more → -ir'); continue; }
        if (w === 'of' && np && np.noun){ flush(); ofAt = out.length - 1; res.dropped.push('of → -s'); prev = 'np'; continue; }
        if (w === 'of' && out.length && out[out.length - 1].k === 'np'){ ofAt = out.length - 1; res.dropped.push('of → -s'); prev = 'np'; continue; }
        if (w === 'going' && nx && nx.w === 'to' && beSeen && goingToVerb(i + 2)){ tense = 'future'; i++; beSeen = false; continue; }
      }
      if (!known){
        const asZ = d.z.get(zType(w));
        if ((asZ && /^[A-ZÀ-ɏ]/.test(tk.t)) || (/^[A-Z]/.test(tk.t) && i > 0)){
          np = np && !np.noun ? np : (flush(), newNP());
          np.noun = { name: asZ ? asZ[0].z : tk.t }; np.possS = tk.poss; np.src.push(tk.t); prev = 'noun';
          if (!nx || !enReadings(d, nx.w).some(r => r.e.type === 'noun')) flush();
          continue;
        }
        flush(); out.push({ k: 'w', z: tk.t, bad: true, src: tk.t }); res.missing.push(tk.t); prev = 'any'; continue;
      }
      // Pick a meaning from context.
      let order = prev === 'np' ? PREF.np : prev === 'pred' ? PREF.pred : (prev === 'subj' || prev === 'noun') && !verbDone ? PREF.verb : prev === 'start' ? PREF.start : PREF.any;
      if (cmd && !cmdDone && i <= 2) order = PREF.verb;
      let r = pick(rs, order);
      // "her" before a noun is "her house" (šas), otherwise "her" the person (ša).
      if (rs.some(x => x.e.type === 'poss') && rs.some(x => x.e.type === 'pron')) r = nxR.some(x => ['noun', 'adj', 'num'].includes(x.e.type)) ? rs.find(x => x.e.type === 'poss') : rs.find(x => x.e.type === 'pron');
      const t = r.e.type;
      if (t === 'verb'){ verbUnit(r, tk.t); continue; }
      if (t === 'noun' || (t === 'question' && r.e.senses.includes('how many'))){
        if (t === 'question'){ np = np || newNP(); np.num = r; prev = 'np'; continue; }
        // Two English nouns in a row ("death rift") work like a Zurivel compound: the first describes the second,
        // stays bare and comes first, and the endings go on the last one (dø iluduren, the death rift).
        if (np && np.noun){ if (np.noun.e && np.nounAt === i - 1) np.pre.push(np.noun); else flush(); }
        np = np || newNP();
        np.noun = r; np.nounAt = i; np.plural = !!r.f.plural && !np.num; np.possS = tk.poss; np.src.push(tk.t); prev = 'noun';
        if (!(nx && !nx.p && enReadings(d, nx.w).some(x => x.e.type === 'noun') && !enReadings(d, nx.w).some(x => x.e.type === 'verb'))) flush();
        if (prev === 'noun' && !verbDone) prev = 'subj';
        continue;
      }
      if (t === 'adj'){
        np = np || newNP();
        np.adjs.push({ r, ends: (r.f.comp || more) ? ['ir'] : [], src: tk.t }); more = false;
        if (!(nx && !nx.p && nxR.some(x => ['noun', 'adj'].includes(x.e.type)))) flush();
        prev = 'np'; continue;
      }
      if (t === 'poss'){ flush(); np = newNP(); np.poss.push(r); np.src.push(tk.t); prev = 'np'; continue; }
      if (t === 'num'){ if (np && np.noun) flush(); np = np || newNP(); np.num = r; prev = 'np'; continue; }
      flush();
      out.push(unit(r, tk.t));
      prev = t === 'pron' ? (verbDone ? 'obj' : 'subj') : t === 'prep' ? 'np' : t === 'conj' ? 'start' : t === 'question' ? 'start' : 'any';
      if (t === 'conj'){ verbDone = false; }
    }
    flush();
    if (neg){
      let k = out.length - 1; while (k >= 0 && out[k].k === 'p') k--;
      out.splice(k + 1, 0, { k: 'w', z: 'nu', gloss: 'not', src: 'not' });
    }
    if (q && !whFirst) out.push({ k: 'w', z: 'ka', gloss: 'question', src: '?' });

    // Units to words.
    const zw = [];
    const push = (z, parts, src, extra) => zw.push(Object.assign({ z, parts, src }, extra || {}));
    for (const u of out){
      if (u.k === 'p'){ zw.push({ p: u.t }); continue; }
      if (u.k === 'w'){
        if (u.bad){ push(u.z, [], u.src, { bad: true }); continue; }
        let z = u.z; const parts = [{ z: u.z, g: u.e ? u.e.gloss : u.gloss }];
        for (const en of u.ends || []){ z = zAdd(z, en); parts.push({ z: '-' + (en === 'ar' && z.endsWith('r') && !z.endsWith('ar') ? 'r' : en), g: Z_END[en] }); }
        push(z, parts, u.src);
        continue;
      }
      for (const p of u.poss) push(p.e.z, [{ z: p.e.z, g: p.e.gloss }], p.e.gloss);
      if (u.num) push(u.num.e.z, [{ z: u.num.e.z, g: u.num.e.gloss }], u.num.e.gloss);
      for (const p of u.pre) push(p.e.z, [{ z: p.e.z, g: p.e.gloss }], p.e.gloss);
      if (u.noun){
        let z = u.noun.name || u.noun.e.z; const parts = [{ z, g: u.noun.name ? 'name' : u.noun.e.gloss }];
        if (u.plural){ const before = z; z = zAdd(z, 'ar'); parts.push({ z: '-' + z.slice(before.length), g: 'plural' }); }
        if (u.the){ z += 'en'; parts.push({ z: '-en', g: 'the' }); }
        if (u.possS){ z += 's'; parts.push({ z: '-s', g: 'belonging' }); }
        push(z, parts, u.src.join(' '));
      }
      for (const a of u.adjs){
        let z = a.r.e.z; const parts = [{ z, g: a.r.e.gloss }];
        for (const en of a.ends){ z = zAdd(z, en); parts.push({ z: '-' + en, g: Z_END[en] }); }
        push(z, parts, a.src);
      }
    }
    let s = '';
    for (const x of zw){ if (x.p) s += x.p; else s += (s ? ' ' : '') + x.z; }
    s = zCap(s) + end;
    res.sentences.push({ text: s, words: zw });
    for (const x of zw) if (!x.p && !x.bad) res.rows.push(x);
  }
  res.text = res.sentences.map(x => x.text).join(' ');
  res.missing = [...new Set(res.missing)];
  res.dropped = [...new Set(res.dropped)];
  return res;
}

// ---------- Zurivel -> English ----------
function zAnalyze(d, w, depth = 0){
  const lw = w.toLowerCase(), hit = d.z.get(lw);
  if (hit) return { gloss: hit[0].gloss, parts: [{ z: hit[0].z, g: hit[0].gloss }], e: hit[0] };
  if (depth > 3 || lw.length < 3) return null;
  const ends = [['s', g => g + "'s"], ['en', g => 'the ' + g], ['ar', g => enPlural(g)], ['r', g => enPlural(g)], ['ak', g => enPast(g)], ['ul', g => 'will ' + g], ['ir', g => 'more ' + g], ['ek', g => 'one who ' + g + 's'], ['dar', g => 'place for ' + g], ['a', g => g + ' (command)']];
  for (const [suf, f] of ends){
    if (!lw.endsWith(suf) || lw.length - suf.length < 2) continue;
    const sub = zAnalyze(d, w.slice(0, -suf.length), depth + 1);
    if (sub && !(suf === 'a' && sub.e && sub.e.type !== 'verb') && !(suf === 'ak' && sub.e && sub.e.type !== 'verb')) return { gloss: f(sub.gloss), parts: sub.parts.concat([{ z: '-' + suf, g: suf === 'ek' ? 'one who' : suf === 'dar' ? 'place for' : Z_END[suf] }]), e: sub.e };
  }
  for (const [pre, f, g] of [['ma', x => 'many ' + x, 'many, great'], ['ðe', x => 'not ' + x, 'lacking'], ['ka', x => 'which ' + x, 'question']]){
    if (!lw.startsWith(pre) || lw.length - pre.length < 2) continue;
    const sub = zAnalyze(d, w.slice(pre.length), depth + 1);
    if (sub) return { gloss: f(sub.gloss), parts: [{ z: pre + '-', g }].concat(sub.parts), e: sub.e };
  }
  for (let i = 2; i <= lw.length - 2; i++){
    const a = zAnalyze(d, w.slice(0, i), depth + 2); if (!a) continue;
    let b = zAnalyze(d, w.slice(i), depth + 2), link = false;
    if (!b && lw[i] === 'a' && lw.length - i > 2){ b = zAnalyze(d, w.slice(i + 1), depth + 2); link = !!b; }
    if (b) return { gloss: a.gloss + '-' + b.gloss, parts: a.parts.concat(link ? [{ z: 'a', g: 'link' }] : [], b.parts), e: b.e };
  }
  return null;
}
const enPlural = g => EN_PLR[g] || (/(s|x|ch|sh)$/.test(g) ? g + 'es' : /[^aeiou]y$/.test(g) ? g.slice(0, -1) + 'ies' : g + 's');
const enPast = g => EN_PAST[g] || (/e$/.test(g) ? g + 'd' : g + 'ed');
function zurivelToEnglish(text){
  const d = zDict(), res = { rows: [], missing: [], dropped: [] };
  const toks = zType(text).match(/[^\s.,!?;:]+|[.,!?;:]/g) || [];
  // Glosses word by word; "nu" after a verb moves in front of it, the English way ("will not go").
  const seg = [];
  for (const t of toks){
    if (/^[.,!?;:]$/.test(t)){ seg.push({ p: t }); continue; }
    const lw = t.toLowerCase();
    if (lw === 'ka'){ res.rows.push({ z: t, parts: [{ z: 'ka', g: 'question' }], src: '?' }); continue; }
    if (lw === 'nu'){
      res.rows.push({ z: t, parts: [{ z: 'nu', g: 'not' }], src: 'not' });
      const prev = seg[seg.length - 1];
      if (prev && prev.verb){ prev.g = /^will /.test(prev.g) ? prev.g.replace(/^will /, 'will not ') : prev.pastBase ? 'did not ' + prev.pastBase : 'do not ' + prev.g; }
      else seg.push({ g: 'not' });
      continue;
    }
    if (lw === 'vo'){ res.rows.push({ z: t, parts: [{ z: 'vo', g: 'ongoing' }], src: 'is …ing' }); seg.push({ g: '(ongoing)' }); continue; }
    const a = zAnalyze(d, t);
    if (a){ seg.push({ g: a.gloss, verb: !!(a.e && a.e.type === 'verb'), pastBase: a.parts.some(p => p.z === '-ak') ? a.parts[0].g : '' }); res.rows.push({ z: t, parts: a.parts, src: a.gloss }); }
    else { seg.push({ g: '[' + t + ']' }); res.missing.push(t); }
  }
  let s = '', capNext = true;
  for (const x of seg){
    if (x.p){ s += x.p; if (/[.!?]/.test(x.p)) capNext = true; continue; }
    s += (s ? ' ' : '') + (capNext ? zCap(x.g) : x.g); capNext = false;
  }
  res.text = s;
  res.missing = [...new Set(res.missing)];
  return res;
}

const zcState = { text: 'My house is small and warm. Do you eat the bread?', fwd: true };
function mountZurivel(root){
  for (const el of root.querySelectorAll('[data-zc]')){
    el.removeAttribute('data-zc');
    el.innerHTML = `<div class="zc-top"><span class="label">Zurivel translator</span><div class="zc-mode" role="group" aria-label="Direction"><button type="button" data-zm="1">English → Zurivel</button><button type="button" data-zm="0">Zurivel → English</button></div></div>
      <textarea class="zc-in" rows="3" spellcheck="false" autocomplete="off" autocapitalize="sentences" aria-label="Text to translate"></textarea>
      <div class="zc-keys" aria-label="Insert a special letter">${Z_KEYS.map(([l, k, s]) => `<button type="button" data-zk="${l}" title="${esc(s)} (type ${k})">${l}</button>`).join('')}</div>
      <div class="zc-out" aria-live="polite"></div>
      <p class="zc-pron" hidden><span class="label">Say it</span><span class="zc-pron-t"></span></p>
      <p class="zc-warn" hidden></p>
      <p class="sub zc-gone" hidden></p>
      <div class="zc-acts"><button type="button" data-za="copy">Copy</button><button type="button" data-za="swap">Swap</button><span class="zc-msg" role="status"></span></div>
      <div class="zc-say"></div>
      <p class="sub zc-src"></p>
      <p class="sub zc-pkey">How to read “Say it”: capitals are the stressed syllable. <b>ah</b> as in father, <b>a</b> as in cat, <b>eh</b> as in bed, <b>ee</b> as in see, <b>oh</b> as in go (no glide), <b>ur</b> as in fur (no r), <b>oo</b> as in moon, <b>uh</b> as in about; <b>th</b> as in thin, <b>dh</b> as in this, <b>zh</b> as in measure, <b>g</b> always as in go, <b>r</b> a light tap. A doubled vowel (aah) is held long.</p>`;
    const inp = el.querySelector('.zc-in'), out = el.querySelector('.zc-out'), warn = el.querySelector('.zc-warn'), gone = el.querySelector('.zc-gone'), say = el.querySelector('.zc-say'), msg = el.querySelector('.zc-msg'), src = el.querySelector('.zc-src'), keys = el.querySelector('.zc-keys'), pron = el.querySelector('.zc-pron'), pronT = el.querySelector('.zc-pron-t');
    let last = null;
    const flash = t => { msg.textContent = t; clearTimeout(flash.h); flash.h = setTimeout(() => { msg.textContent = ''; }, 1600); };
    const draw = () => {
      zcState.text = inp.value;
      for (const b of el.querySelectorAll('[data-zm]')) b.setAttribute('aria-pressed', String((b.dataset.zm === '1') === zcState.fwd));
      keys.hidden = zcState.fwd;
      inp.placeholder = zcState.fwd ? 'Type English, e.g. We will not go to the market.' : 'Type Zurivel, e.g. Miar karul nu ta chaten (ch, sh, th… become č, š, þ)';
      const d = zDict();
      src.textContent = d.note ? `Knows ${d.n.toLocaleString('en-US')} words from the Zurivel Dictionary note. Add a row there to teach it a new word.` : 'Can\'t find the Zurivel Dictionary note, so no words are known yet.';
      if (!inp.value.trim()){ out.innerHTML = '<span class="ph">The translation appears here.</span>'; out.classList.toggle('key', !zcState.fwd); warn.hidden = gone.hidden = pron.hidden = true; say.innerHTML = ''; last = null; return; }
      const r = last = zcState.fwd ? enToZurivel(inp.value) : zurivelToEnglish(inp.value);
      out.classList.toggle('key', !zcState.fwd);
      if (zcState.fwd){
        out.innerHTML = r.sentences.map(s => {
          let h = '', first = true;
          for (const x of s.words){
            if (x.p){ h += esc(x.p); continue; }
            const word = first ? zCap(x.z) : x.z; first = false;
            h += (h ? ' ' : '') + (x.bad ? `<span class="bad">${esc(word)}</span>` : esc(word));
          }
          return h + esc(s.text.slice(-1).match(/[.!?]/) ? s.text.slice(-1) : '');
        }).join(' ');
      } else out.innerHTML = esc(r.text).replace(/\[([^\]]+)\]/g, '<span class="bad">$1</span>');
      // The whole line, said out loud: the Zurivel result, or the Zurivel that was typed. Unknown English words are left out.
      const zText = zcState.fwd ? r.sentences.map(s => s.words.filter(x => !x.bad).map(x => x.p || x.z).join(' ') + (s.text.slice(-1).match(/[.!?]/) ? s.text.slice(-1) : '')).join(' ') : zType(inp.value);
      const line = zPronLine(zText);
      pron.hidden = !line; pronT.textContent = line;
      warn.hidden = !r.missing.length;
      if (r.missing.length) warn.innerHTML = `<b>${r.missing.map(esc).join(', ')}</b> ${r.missing.length > 1 ? 'aren\'t' : 'isn\'t'} in the Zurivel Dictionary yet. Add ${r.missing.length > 1 ? 'them' : 'it'} as a row there and the translator will know ${r.missing.length > 1 ? 'them' : 'it'}.`;
      gone.hidden = !(zcState.fwd && r.dropped.length);
      if (zcState.fwd && r.dropped.length) gone.textContent = 'Handled by endings or left out (Zurivel has no "a" and no "to be"): ' + r.dropped.join(', ') + '.';
      const seen = new Set(), rows = r.rows.filter(x => { const k = x.z.toLowerCase(); return !seen.has(k) && seen.add(k); });
      say.innerHTML = rows.slice(0, 14).map(x => `<div class="zc-word"><div><b>${esc(x.z)}</b><small>say ${esc(zPron(x.z))}${x.src && zcState.fwd ? ' · from “' + esc(x.src) + '”' : ''}</small></div><div class="zc-chips">${(x.parts || []).map(p => `<span${p.z.startsWith('-') || p.z.endsWith('-') ? ' class="v"' : ''}><i>${esc(p.z)}</i>${esc(p.g || '')}</span>`).join('')}</div></div>`).join('') + (rows.length > 14 ? `<p class="sub">+ ${rows.length - 14} more words</p>` : '');
    };
    inp.value = zcState.text;
    inp.addEventListener('input', () => {
      if (!zcState.fwd){ const pos = inp.selectionStart, before = inp.value.length, v = zType(inp.value); if (v !== inp.value){ inp.value = v; const p = Math.max(0, pos - (before - v.length)); inp.setSelectionRange(p, p); } }
      draw();
    });
    el.addEventListener('click', e => {
      const m = e.target.closest('[data-zm]'), k = e.target.closest('[data-zk]'), a = e.target.closest('[data-za]');
      if (m){ zcState.fwd = m.dataset.zm === '1'; draw(); }
      else if (k){ inp.focus(); inp.setRangeText(k.dataset.zk, inp.selectionStart, inp.selectionEnd, 'end'); draw(); }
      else if (a && a.dataset.za === 'swap'){ if (last && last.text) inp.value = last.text.replace(/\[([^\]]+)\]/g, '$1'); zcState.fwd = !zcState.fwd; draw(); }
      else if (a && a.dataset.za === 'copy'){
        const text = last && last.text; if (!text) return;
        const fallback = () => { const r = document.createRange(); r.selectNodeContents(out); const s = getSelection(); s.removeAllRanges(); s.addRange(r); flash('Selected. Press Ctrl+C to copy.'); };
        try { navigator.clipboard.writeText(text).then(() => flash('Copied'), fallback); } catch { fallback(); }
      }
    });
    draw();
  }
}

function connHtml(n){
  const seen = new Set(), outs = [];
  for (const t of linksIn(n.body)){ const k = t.toLowerCase(); if (!seen.has(k) && k !== n.title.toLowerCase()){ seen.add(k); outs.push(t); } }
  const key = n.title.toLowerCase(), back = liveNotes().filter(o => o.id !== n.id && o.out.includes(key)).sort((a, b) => a.title.localeCompare(b.title));
  const chips = outs.map(t => { const o = byTitle.get(t.toLowerCase()); return `<button type="button" class="chipbtn${o ? '' : ' missing'}" data-wl="${esc(o ? o.title : t)}">${esc(o ? o.title : t)}</button>`; }).join('');
  const rows = back.map(o => { const i = o.plain.toLowerCase().indexOf(key); const snip = i >= 0 ? (i > 60 ? '…' : '') + o.plain.slice(Math.max(0, i - 60), i + key.length + 80) + '…' : o.summary; return rowFor(o, esc(snip)); }).join('');
  if (!chips && !rows) return `<section class="conn"><p class="label">Connections</p><p class="sub">Nothing links here yet, and this note links nowhere. ${notesReadOnly || n.trashed ? '' : 'Edit it and type [[ to connect it.'}</p></section>`;
  return `<section class="conn">${chips ? `<p class="label">Links to</p><div class="chips">${chips}</div>` : ''}${rows ? `<p class="label">Linked from · ${back.length}</p><div class="list">${rows}</div>` : ''}</section>`;
}
function showNote(n, keepScroll){
  const pane = $('readerPane'), top = pane.scrollTop;
  current = n.id; shownSig = sigOf(n);
  $('reader').hidden = false; $('editor').hidden = true; $('readerBody').hidden = false;
  $('saveNoteBtn').hidden = true; $('editBtn').hidden = notesReadOnly || n.trashed || !notesCol;
  $('backLbl').textContent = 'Back';
  if (!keepScroll) setNoteMsg('');
  const holder = document.createElement('div'); holder.className = 'prose'; holder.innerHTML = renderMd(n.body.replace(/^Status:.*\n?/m, ''));
  for (const t of holder.querySelectorAll('table')){ const w = document.createElement('div'); w.className = 'tbl'; t.replaceWith(w); w.appendChild(t); }
  mountZurivel(holder);
  // Fold each ## section into a tap-to-open block so long notes stay short.
  const h2s = [...holder.querySelectorAll(':scope > h2')], fold = h2s.length >= 3;
  for (const h of h2s){
    const d = document.createElement('details'); d.className = 'sec'; if (!fold) d.open = true;
    const s = document.createElement('summary'); s.textContent = h.textContent; d.appendChild(s);
    const inner = document.createElement('div'); inner.className = 'body'; d.appendChild(inner);
    let el = h.nextSibling; while (el && !(el.nodeType === 1 && el.tagName === 'H2')){ const next = el.nextSibling; inner.appendChild(el); el = next; }
    h.replaceWith(d);
  }
  const st = n.status;
  const trash = n.trashed ? `<div class="notice trashbar"><span>This note is in the trash.</span>${notesReadOnly ? '' : '<button type="button" class="btn ghost" id="restoreBtn">Restore</button><button type="button" class="btn danger" id="purgeBtn">Delete forever</button>'}</div>` : '';
  $('readerBody').innerHTML = `<div class="note-head">${trash}<h1>${esc(n.title)}</h1><div class="note-meta">${st.label ? `<span class="pill ${st.cls}">${esc(st.label)}</span>` : ''}<span>${esc(n.folder)}</span>${n.updatedAt ? `<span>Updated ${esc(fmtDate(n.updatedAt) + whoEdited(n))}</span>` : ''}</div>${st.full && st.cls !== 'canon' ? `<p class="sub">${esc(st.full)}</p>` : ''}${fold ? '<div class="expand"><button type="button" id="openAll">Open all sections</button></div>' : ''}</div>`;
  $('readerBody').appendChild(holder);
  $('readerBody').insertAdjacentHTML('beforeend', connHtml(n) + (n.trashed ? '' : '<div><button type="button" class="chipbtn" data-graph="' + esc(n.id) + '">Show in graph</button></div>'));
  if (fold) $('openAll').addEventListener('click', e => { const all = [...holder.querySelectorAll('details.sec')], open = !all.every(d => d.open); all.forEach(d => d.open = open); e.currentTarget.textContent = open ? 'Close all sections' : 'Open all sections'; });
  const prev = stack.length > 1 ? byId.get(stack[stack.length - 2]) : null;
  $('readerCrumb').textContent = prev ? 'Back to ' + prev.title : 'Back to the list';
  pane.scrollTop = keepScroll ? top : 0;
  setHash('n-' + n.id);
}
function openNote(id, push){
  const n = byId.get(id); if (!n || nEdit) return false;
  if (push && stack[stack.length - 1] !== id) stack.push(id);
  showNote(n); return true;
}
function openFromHash(id){ if (!notesLoaded){ pendingOpen = id; return; } if (nEdit || id === current || !byId.get(id)) return; stack = []; openNote(id, true); }
function closeReader(){ $('reader').hidden = true; current = null; stack = []; setNoteMsg(''); setHash('notes'); }
function goBack(){
  stack.pop();
  while (stack.length && !byId.get(stack[stack.length - 1])) stack.pop();
  if (stack.length) showNote(byId.get(stack[stack.length - 1])); else closeReader();
}
function followLink(title){
  const o = byTitle.get(String(title).toLowerCase());
  if (o){ openNote(o.id, true); return; }
  if (notesReadOnly || !notesCol){ setNoteMsg(`There is no note called “${title}” yet.`, ''); return; }
  const from = byId.get(current);
  startEdit(null, { title, folder: from ? from.folder : '' });
  setNoteMsg(`“${title}” doesn't exist yet. Write it and tap Save to create it.`, '');
}
$('readerBody').addEventListener('click', e => {
  const a = e.target.closest('[data-wl]'); if (a){ e.preventDefault(); followLink(a.dataset.wl); return; }
  const gb = e.target.closest('[data-graph]'); if (gb){ showInGraph(gb.dataset.graph); return; }
  const r = e.target.closest('[data-nid]'); if (r){ openNote(r.dataset.nid, true); return; }
  if (e.target.closest('#restoreBtn')) restoreNote();
  else if (e.target.closest('#purgeBtn')) purgeNote(e.target.closest('#purgeBtn'));
});
$('edPreview').addEventListener('click', e => { if (e.target.closest('a.wl')) e.preventDefault(); });

// ---------- editing ----------
const ta = $('edBody');
let nEdit = null, nBase = '', nSaving = false, nBackArmed = false, nTrashArmed = false, nPreview = false, draftTimer = 0, lastCtx = null, suggFirst = '', histCache = [];
function setNoteMsg(text, kind){ const m = $('noteMsg'); m.textContent = text; m.className = 'smsg' + (kind ? ' ' + kind : ''); }
const edSnap = () => JSON.stringify({ t: $('edTitle').value.trim(), f: $('edFolder').value, b: ta.value });
const noteDirty = () => !!nEdit && edSnap() !== nBase;
const draftKey = () => 'vael.draft.' + (nEdit && nEdit.id ? nEdit.id : 'new');
function resetNoteArms(){ nBackArmed = false; nTrashArmed = false; $('backLbl').textContent = nEdit ? 'Cancel' : 'Back'; $('trashBtn').textContent = 'Move to trash'; $('trashBtn').classList.remove('armed'); }
function autoGrow(){ const pane = $('readerPane'), top = pane.scrollTop; ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; pane.scrollTop = top; }
function fillFolders(value){
  const set = new Set(GROUPS.flatMap(g => g.folders)); for (const n of NOTES) if (n.folder) set.add(n.folder); if (value) set.add(value);
  const list = [...set].sort((a, b) => GROUPS.indexOf(groupOfFolder(a)) - GROUPS.indexOf(groupOfFolder(b)) || a.localeCompare(b));
  $('edFolder').innerHTML = list.map(f => `<option value="${esc(f)}">${esc(groupOfFolder(f).name)} · ${esc(f)}</option>`).join('');
  $('edFolder').value = value || list[0];
}
function setPreview(on){
  nPreview = on; $('prevBtn').setAttribute('aria-pressed', String(on)); $('prevBtn').textContent = on ? 'Write' : 'Preview';
  $('edBodyWrap').hidden = on; $('edPreview').hidden = !on; $('sugg').hidden = true;
  for (const b of document.querySelectorAll('.edtools [data-fmt]')) b.disabled = on;
  if (on){ $('edPreview').innerHTML = renderMd(ta.value.replace(/^Status:.*\n?/m, '')) || '<p class="sub">Nothing to preview yet.</p>'; mountZurivel($('edPreview')); } else autoGrow();
}
function startEdit(n, preset){
  const g = GROUPS.find(x => x.id === group);
  nEdit = { id: n ? n.id : null, base: n ? n.updatedAt : '', createdAt: n ? n.createdAt : '' };
  $('edTitle').value = n ? n.title : (preset && preset.title) || '';
  fillFolders(n ? n.folder : (preset && preset.folder) || (g ? g.folders[0] : 'Story & Lore'));
  ta.value = n ? n.body : NEW_BODY;
  nBase = edSnap();
  setNoteMsg('');
  const saved = store.get(draftKey());
  if (saved) try { const d = JSON.parse(saved); if (d && typeof d.b === 'string' && JSON.stringify({ t: d.t, f: d.f, b: d.b }) !== nBase){ $('edTitle').value = d.t || ''; if (d.f) fillFolders(d.f); ta.value = d.b; setNoteMsg('Restored your unsaved draft from this device. Tap Cancel to drop it.', ''); } } catch {}
  $('reader').hidden = false; $('readerBody').hidden = true; $('editor').hidden = false;
  $('editBtn').hidden = true; $('saveNoteBtn').hidden = false; $('saveNoteBtn').disabled = false;
  $('readerCrumb').textContent = n ? 'Editing' : 'New note';
  $('trashBtn').hidden = !n; $('histBtn').hidden = !n; $('histList').hidden = true;
  resetNoteArms(); setPreview(false);
  $('readerPane').scrollTop = 0;
  if (!n && !$('edTitle').value) $('edTitle').focus();
}
function stopEdit(){ nEdit = null; lastCtx = null; clearTimeout(draftTimer); $('sugg').hidden = true; $('editor').hidden = true; $('saveNoteBtn').hidden = true; resetNoteArms(); }
function afterEdit(){
  autoGrow(); drawSugg();
  if (nBackArmed || nTrashArmed){ resetNoteArms(); setNoteMsg(''); }
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { if (nEdit) store.set(draftKey(), noteDirty() ? edSnap() : ''); }, 500);
}
$('editBtn').addEventListener('click', () => { const n = byId.get(current); if (n) startEdit(n); });
$('newNoteBtn').addEventListener('click', () => { stack = []; current = null; startEdit(null, null); });
$('editor').addEventListener('submit', e => e.preventDefault());
$('edTitle').addEventListener('input', afterEdit);
$('edFolder').addEventListener('input', afterEdit);
ta.addEventListener('input', afterEdit);
ta.addEventListener('click', drawSugg);
ta.addEventListener('keyup', e => { if ((e.key || "").startsWith("Arrow") || e.key === 'Home' || e.key === 'End') drawSugg(); });
ta.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sugg').hidden){ $('sugg').hidden = true; e.stopPropagation(); } });
$('prevBtn').addEventListener('click', () => setPreview(!nPreview));

// [[ suggestions: shown under the toolbar while the caret sits inside an unfinished link.
function linkCtx(){
  const pos = ta.selectionStart; if (pos !== ta.selectionEnd) return null;
  const before = ta.value.slice(0, pos), i = before.lastIndexOf('[['); if (i < 0) return null;
  const q = before.slice(i + 2); if (/[\]\n|#]/.test(q) || q.length > 60) return null;
  return { start: i, pos, q };
}
function drawSugg(){
  const box = $('sugg'); suggFirst = '';
  const c = nEdit && !nPreview ? linkCtx() : null; lastCtx = c;
  if (!c){ box.hidden = true; return; }
  const q = c.q.trim().toLowerCase(), live = liveNotes().filter(n => n.id !== nEdit.id);
  const list = live.filter(n => !q || n.title.toLowerCase().includes(q)).sort((a, b) => (b.title.toLowerCase().startsWith(q) - a.title.toLowerCase().startsWith(q)) || (q ? 0 : b.updatedAt.localeCompare(a.updatedAt)) || a.title.localeCompare(b.title)).slice(0, 7);
  const exact = live.some(n => n.title.toLowerCase() === q);
  suggFirst = list[0] ? list[0].title : '';
  box.innerHTML = list.map((n, i) => `<button type="button" data-pick="${esc(n.title)}"${i ? '' : ' class="act"'}><span>${esc(n.title)}</span><small>${esc(groupOf(n).name)}</small></button>`).join('')
    + (q && !exact ? `<button type="button" data-pick="${esc(c.q.trim())}"><span>Link “${esc(c.q.trim())}”</span><small>new note, write it later</small></button>` : '');
  box.hidden = !box.innerHTML;
}
function pickLink(title){
  const c = lastCtx; if (!c) return;
  let end = c.pos; if (ta.value.slice(end, end + 2) === ']]') end += 2;
  ta.focus(); ta.setRangeText('[[' + title + ']]', c.start, end, 'end');
  afterEdit();
}
$('sugg').addEventListener('pointerdown', e => e.preventDefault());
$('sugg').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) pickLink(b.dataset.pick); });

// Toolbar. Each button works on the selection, or on the current line.
function fmt(kind){
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e), ls = v.lastIndexOf('\n', s - 1) + 1;
  ta.focus();
  if (kind === 'b' || kind === 'i'){
    const m = kind === 'b' ? '**' : '*';
    if (sel) ta.setRangeText(m + sel + m, s, e, 'end'); else { ta.setRangeText(m + m, s, e, 'end'); ta.setSelectionRange(s + m.length, s + m.length); }
  } else if (kind === 'h'){
    const cur = /^(#{1,6}) /.exec(v.slice(ls, ls + 8));
    if (!cur) ta.setRangeText('## ', ls, ls, 'preserve'); else if (cur[1].length === 2) ta.setRangeText('### ', ls, ls + 3, 'preserve'); else ta.setRangeText('', ls, ls + cur[0].length, 'preserve');
  } else if (kind === 'ul' || kind === 'task'){
    const p = kind === 'ul' ? '- ' : '- [ ] ';
    if (!v.slice(ls).startsWith(p)){ ta.setRangeText(p, ls, ls, 'preserve'); if (s === ls) ta.setSelectionRange(s + p.length, e + p.length); }
  } else if (kind === 'link'){
    ta.setRangeText('[[' + sel, s, e, 'end');
  }
  afterEdit();
}
document.querySelector('.edtools').addEventListener('pointerdown', e => { if (e.target.closest('[data-fmt]')) e.preventDefault(); });
document.querySelector('.edtools').addEventListener('click', e => { const b = e.target.closest('[data-fmt]'); if (b && !b.disabled) fmt(b.dataset.fmt); });
// Return picks the top suggestion, and continues or ends a list.
ta.addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  if (!$('sugg').hidden && suggFirst && lastCtx){ e.preventDefault(); pickLink(suggFirst); return; }
  const s = ta.selectionStart; if (s !== ta.selectionEnd) return;
  const v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, m = /^(\s*)(- \[[ xX]\] |[-*] |(\d+)\. )(.*)$/.exec(v.slice(ls, s));
  if (!m) return;
  e.preventDefault();
  if (!m[4].trim()) ta.setRangeText('', ls, s, 'end');
  else ta.setRangeText('\n' + m[1] + (m[3] ? (Number(m[3]) + 1) + '. ' : m[2].startsWith('- [') ? '- [ ] ' : m[2]), s, s, 'end');
  afterEdit();
});

// ---------- saving ----------
async function relink(oldTitle, newTitle, selfId){
  const re = new RegExp('\\[\\[\\s*' + escRe(oldTitle) + '\\s*((?:#[^\\]|\\n]*)?(?:\\\\?\\|[^\\]\\n]*)?)\\]\\]', 'gi');
  let count = 0;
  for (const o of NOTES.slice()){
    if (o.id === selfId) continue;
    const nb = o.body.replace(re, (_, rest) => '[[' + newTitle + rest + ']]');
    if (nb !== o.body){ await notesCol.doc(o.id).update({ body: nb }); applyLocal({ id: o.id, body: nb }); count++; }
  }
  return count;
}
async function pruneHistory(id){
  try { const snap = await notesCol.doc(id).collection('history').orderBy('replacedAt', 'desc').limit(60).get(); for (const d of snap.docs.slice(20)) await notesCol.doc(id).collection('history').doc(d.id).delete(); } catch {}
}
async function saveNote(){
  if (nSaving || !nEdit || !notesCol) return;
  const title = $('edTitle').value.trim().replace(/\s+/g, ' '), folder = $('edFolder').value, body = ta.value.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
  if (!title){ setNoteMsg('Give the note a title before saving.', 'err'); $('edTitle').focus(); return; }
  if (/[\[\]|#^\\]/.test(title)){ setNoteMsg('A title can\'t contain [ ] | # ^ or \\, because links use them.', 'err'); $('edTitle').focus(); return; }
  const clash = byTitle.get(title.toLowerCase());
  if (clash && clash.id !== nEdit.id){ setNoteMsg(`A note called “${clash.title}” already exists. Pick another title.`, 'err'); $('edTitle').focus(); return; }
  const old = nEdit.id ? byId.get(nEdit.id) : null, now = new Date().toISOString();
  let id = nEdit.id;
  if (!id){ id = slugify(title) || 'note'; if (byId.has(id)) id += '-' + Date.now().toString(36); }
  nSaving = true; $('saveNoteBtn').disabled = true; $('saveNoteBtn').textContent = 'Saving…';
  try {
    const ref = notesCol.doc(id);
    if (old && sigOf(old) !== sigOf({ title, folder, body, trashed: old.trashed }))
      await ref.collection('history').doc('h-' + now.replace(/[^0-9TZ]/g, '')).set({ title: old.title, folder: old.folder, body: old.body, savedAt: old.updatedAt || now, replacedAt: now });
    const doc = { title, folder, body, createdAt: (old && old.createdAt) || now, updatedAt: now };
    if (old && old.trashed) doc.trashed = true;
    await ref.set(doc);
    store.set(draftKey(), '');
    applyLocal({ id, ...doc });
    const moved = old && old.title !== title ? await relink(old.title, title, id) : 0;
    const isNew = !old;
    stopEdit(); refreshLists();
    if (isNew) stack.push(id);
    showNote(byId.get(id));
    setNoteMsg(moved ? `Saved. Updated the links in ${moved} other note${moved === 1 ? '' : 's'}.` : 'Saved.', 'ok');
    if (old) pruneHistory(id);
  } catch (e) {
    const c = e && e.code;
    setNoteMsg(c === 'invalid_argument' ? 'This page is read-only for you, so the note was not saved. Your text is kept as a draft on this device. Ask Judah for Editor access.'
      : c === 'quota_exceeded' ? 'The notes database is full. Delete some old notes from the trash and try again.'
      : 'Could not save right now. Check your connection and tap Save again. Your text is kept as a draft on this device.', 'err');
    store.set(draftKey(), edSnap());
  } finally { nSaving = false; $('saveNoteBtn').disabled = false; $('saveNoteBtn').textContent = 'Save'; }
}
$('saveNoteBtn').addEventListener('click', saveNote);
$('readerBack').addEventListener('click', () => {
  if (!nEdit){ goBack(); return; }
  if (noteDirty() && !nBackArmed){ nBackArmed = true; $('backLbl').textContent = 'Discard?'; setNoteMsg('You have unsaved changes. Tap Discard? to drop them, or Save.', 'err'); return; }
  const id = nEdit.id; store.set(draftKey(), ''); stopEdit(); setNoteMsg('');
  const n = id ? byId.get(id) : null;
  if (n) showNote(n); else if (stack.length && byId.get(stack[stack.length - 1])) showNote(byId.get(stack[stack.length - 1])); else closeReader();
});

// ---------- history, trash ----------
$('histBtn').addEventListener('click', async () => {
  const box = $('histList'); if (!box.hidden){ box.hidden = true; return; }
  if (!nEdit || !nEdit.id) return;
  box.hidden = false; box.innerHTML = '<div class="row"><span class="t muted">Loading earlier versions…</span></div>';
  try {
    const snap = await notesCol.doc(nEdit.id).collection('history').orderBy('replacedAt', 'desc').limit(20).get();
    histCache = snap.docs.map(d => d.data());
    box.innerHTML = histCache.map((h, i) => `<button type="button" class="row" data-h="${i}"><span class="t">${esc(fmtDateTime(h.savedAt))}</span><span class="r"><span class="tag">Load</span></span><span class="s">${esc(plain(h.body || '').slice(0, 140))}</span></button>`).join('')
      || '<div class="row"><span class="t muted">No earlier versions yet. One is kept every time this note is saved.</span></div>';
  } catch { box.innerHTML = '<div class="row"><span class="t muted">Earlier versions could not be loaded.</span></div>'; }
});
$('histList').addEventListener('click', e => {
  const b = e.target.closest('[data-h]'); if (!b) return; const h = histCache[Number(b.dataset.h)]; if (!h) return;
  $('edTitle').value = h.title || $('edTitle').value; if (h.folder) fillFolders(h.folder); ta.value = h.body || '';
  setPreview(false); afterEdit(); $('histList').hidden = true; $('readerPane').scrollTop = 0;
  setNoteMsg(`Loaded the version from ${fmtDateTime(h.savedAt)}. Tap Save to bring it back, or Cancel to keep the current one.`, '');
});
$('trashBtn').addEventListener('click', async () => {
  if (!nEdit || !nEdit.id || !notesCol) return;
  const n = byId.get(nEdit.id); if (!n) return;
  if (!nTrashArmed){
    const back = liveNotes().filter(o => o.id !== n.id && o.out.includes(n.title.toLowerCase())).length;
    nTrashArmed = true; $('trashBtn').textContent = 'Yes, move to trash'; $('trashBtn').classList.add('armed');
    setNoteMsg((back ? `${back} note${back === 1 ? ' links' : 's link'} here, and those links will show as missing. ` : '') + 'Tap again to move this note to the trash. You can restore it from the Trash tab.', 'err'); return;
  }
  $('trashBtn').disabled = true;
  try {
    await notesCol.doc(n.id).update({ trashed: true, trashedAt: new Date().toISOString() });
    store.set(draftKey(), ''); applyLocal({ id: n.id, trashed: true }); stopEdit(); refreshLists(); goBack();
  } catch { setNoteMsg('Could not move the note to the trash. Try again.', 'err'); resetNoteArms(); }
  finally { $('trashBtn').disabled = false; }
});
async function restoreNote(){
  const n = byId.get(current); if (!n || !notesCol) return;
  if (byTitle.has(n.title.toLowerCase())){ setNoteMsg(`Another note is now called “${n.title}”. Rename that one first, then restore this.`, 'err'); return; }
  try { await notesCol.doc(n.id).update({ trashed: false }); applyLocal({ id: n.id, trashed: false }); refreshLists(); showNote(byId.get(n.id)); setNoteMsg('Restored.', 'ok'); }
  catch { setNoteMsg('Could not restore the note. Try again.', 'err'); }
}
async function purgeNote(btn){
  const n = byId.get(current); if (!n || !notesCol) return;
  if (!btn.classList.contains('armed')){ btn.classList.add('armed'); btn.textContent = 'Really delete?'; setNoteMsg('This removes the note and its history for good. It cannot be undone.', 'err'); return; }
  btn.disabled = true;
  try {
    const ref = notesCol.doc(n.id), snap = await ref.collection('history').limit(100).get();
    for (const d of snap.docs) await ref.collection('history').doc(d.id).delete();
    await ref.delete();
    setNotes(rawNotes.filter(x => x.id !== n.id)); refreshLists(); goBack();
  } catch { setNoteMsg('Could not delete the note. Try again.', 'err'); btn.disabled = false; }
}

// ---------- data ----------
refreshLists();
(async () => {
  const db = typeof claude !== 'undefined' ? await claude.use('db') : null;
  if (!db){ notesLoaded = true; notesReadOnly = true; refreshLists(); $('noteList').innerHTML = '<div class="row"><span class="t">Open this page on claude.ai while signed in to load the notes.</span></div>'; return; }
  const user = await claude.use('user');
  const [ce, cw] = user ? await Promise.all([user.canEdit(), user.can('data.write')]) : [null, null];
  // Someone the platform tells us nothing about keeps the Edit button; a refused save decides.
  notesReadOnly = ce === false && cw !== null;
  notesCol = db.collection('notes');
  const timer = setTimeout(() => { $('groupDesc').textContent = notesLoaded ? 'The notes may be out of date. Still trying to reach them…' : 'The notes can\'t be reached yet. Still trying…'; }, 10000);
  notesCol.onSnapshot(snap => {
    if (!snap.metadata.fromCache) clearTimeout(timer);
    setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    notesLoaded = true; refreshLists();
    if (pendingOpen){ const id = pendingOpen; pendingOpen = null; if (byId.get(id) && !nEdit){ stack = []; openNote(id, true); } return; }
    if (nEdit){
      const r = nEdit.id ? byId.get(nEdit.id) : null;
      if (r && r.updatedAt !== nEdit.base && !nSaving) setNoteMsg('Someone else changed this note while you were editing. If you save, their version is kept under History.', 'err');
      return;
    }
    if (current && !$('reader').hidden){ const n = byId.get(current); if (!n) goBack(); else if (sigOf(n) !== shownSig) showNote(n, true); }
  }, () => { clearTimeout(timer); notesLoaded = true; refreshLists(); $('noteList').innerHTML = '<div class="row"><span class="t">The notes could not be loaded. Reload the page to try again.</span></div>'; });
})();

