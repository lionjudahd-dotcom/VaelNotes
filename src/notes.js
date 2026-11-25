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
  // A ```zurivel block in a note becomes a live Zurivel converter (mounted by mountZurivel).
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

// ---------- Zurivel converter ----------
// The Zurivel alphabet: [letter, sound, keyboard typing, example word, meaning]. Order = Zurivel alphabetical order.
const ZL = [
  ['a','a in father','a','an','one'], ['æ','a in cat','ae','hær','man'], ['b','b in bat','b','boþ','bread'],
  ['č','ch in chat','ch','čat','market'], ['d','d in dog','d','dun','house'], ['ð','th in this','dh','ðik','to see'],
  ['e','e in bed','e','kel','fire'], ['f','f in fan','f','fen','fish'], ['g','g in go, always hard','g','grak','wolf'],
  ['h','h in hat','h','haþ','hill'], ['i','ee in machine','i','lin','person'], ['k','k in kit','k','kar','to go'],
  ['l','l in lip','l','lum','bright'], ['m','m in man','m','mena','moon'], ['n','n in net','n','nor','good'],
  ['ŋ','ng in sing','ng','kroŋ','stone'], ['o','o in go, with no glide','o','tor','ground'], ['ø','ur in fur, without the r','oe','grø','bad'],
  ['p','p in pat','p','pil','bird'], ['r','a light tapped r','r','rok','road'], ['s','s in sit','s','sel','friend'],
  ['š','sh in ship','sh','šik','sword'], ['t','t in tap','t','tir','three'], ['þ','th in thin','th','vaþ','water'],
  ['u','oo in moon','u','zuri','sun'], ['v','v in van','v','vin','wind'], ['w','w in wet','w','wel','tree'],
  ['y','a in about, short and weak','y','tyl','story'], ['z','z in zoo','z','zol','gold'], ['ž','s in measure','zh','žel','shadow']
].map((r, i) => ({ lo: r[0], sound: r[1], key: r[2], ex: r[3], gloss: r[4], pos: i, vowel: 'aæeioøuy'.includes(r[0]) }));
const ZBY = {}, ZDI = {}, ZDICT = {};
for (const L of ZL){ ZBY[L.lo] = L; ZDICT[L.ex] = L.gloss; if (L.key.length === 2) ZDI[L.key] = L.lo; }
const zUpper = c => c !== c.toLowerCase(), zLetter = c => /\p{L}/u.test(c), zApos = c => c === "'" || c === '’';
// Keyboard -> Zurivel. Two-key combos (ae, ch, dh, ng, oe, sh, th, zh) win; an apostrophe between them keeps them apart (n'g).
function zToZ(src){
  const t = [];
  for (let i = 0; i < src.length;){
    const c = src[i];
    if (zApos(c) && i > 0 && i < src.length - 1 && ZDI[(src[i - 1] + src[i + 1]).toLowerCase()]){ i++; continue; }
    const two = src.substr(i, 2).toLowerCase();
    if (two.length === 2 && ZDI[two]){ const lo = ZDI[two]; t.push({ k: 'L', lo, text: zUpper(c) ? lo.toUpperCase() : lo }); i += 2; continue; }
    const lo = c.toLowerCase();
    t.push(ZBY[lo] ? { k: 'L', lo, text: c } : { k: zLetter(c) ? 'bad' : 'o', text: c }); i++;
  }
  return t;
}
// Zurivel -> keyboard. Adds an apostrophe where two single letters would otherwise read as a combo.
function zToKey(src){
  const t = []; let prev = null;
  for (const c of src){
    const L = ZBY[c.toLowerCase()];
    if (!L){ t.push({ k: zLetter(c) ? 'bad' : 'o', text: c }); prev = null; continue; }
    let p = L.key; if (zUpper(c)) p = p[0].toUpperCase() + p.slice(1);
    if (prev && prev.length === 1 && ZDI[(prev + p[0]).toLowerCase()]) t.push({ k: 'sep', text: "'" });
    t.push({ k: 'L', lo: L.lo, text: p }); prev = p;
  }
  return t;
}
const zJoin = t => t.map(x => x.text).join('');
function zCmp(a, b){
  const k = s => [...s.toLowerCase()].filter(c => ZBY[c]).map(c => ZBY[c].pos), x = k(a), y = k(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
const zcState = { text: 'zhel dhik grak\nkrong, zol, shik', fwd: true };
function mountZurivel(root){
  for (const el of root.querySelectorAll('[data-zc]')){
    el.removeAttribute('data-zc');
    el.innerHTML = `<div class="zc-top"><span class="label">Zurivel converter</span><div class="zc-mode" role="group" aria-label="Direction"><button type="button" data-zm="1">Keyboard → Zurivel</button><button type="button" data-zm="0">Zurivel → Keyboard</button></div></div>
      <textarea class="zc-in" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Text to convert"></textarea>
      <div class="zc-keys" aria-label="Insert a special letter">${ZL.filter(L => L.key.length === 2).map(L => `<button type="button" data-zk="${L.lo}" title="${esc(L.sound)} (type ${L.key})">${L.lo}</button>`).join('')}</div>
      <div class="zc-out" aria-live="polite"></div>
      <p class="zc-warn" hidden></p>
      <div class="zc-acts"><button type="button" data-za="copy">Copy</button><button type="button" data-za="swap">Swap</button><button type="button" data-za="sort">Sort lines A–Ž</button><span class="zc-msg" role="status"></span></div>
      <div class="zc-say"></div>`;
    const inp = el.querySelector('.zc-in'), out = el.querySelector('.zc-out'), warn = el.querySelector('.zc-warn'), say = el.querySelector('.zc-say'), msg = el.querySelector('.zc-msg');
    const conv = () => zcState.fwd ? zToZ(inp.value) : zToKey(inp.value);
    const flash = t => { msg.textContent = t; clearTimeout(flash.h); flash.h = setTimeout(() => { msg.textContent = ''; }, 1600); };
    const draw = () => {
      zcState.text = inp.value;
      for (const b of el.querySelectorAll('[data-zm]')) b.setAttribute('aria-pressed', String((b.dataset.zm === '1') === zcState.fwd));
      inp.placeholder = zcState.fwd ? 'Type on a normal keyboard, e.g. krong' : 'Paste Zurivel letters, e.g. kroŋ';
      const t = conv();
      out.classList.toggle('key', !zcState.fwd);
      out.innerHTML = inp.value.trim() ? t.map(x => x.k === 'bad' ? `<span class="bad">${esc(x.text)}</span>` : x.k === 'sep' ? `<span class="sep">${esc(x.text)}</span>` : esc(x.text)).join('') : '<span class="ph">The converted text appears here.</span>';
      const bad = [...new Set(t.filter(x => x.k === 'bad').map(x => x.text.toLowerCase()))];
      warn.hidden = !bad.length;
      if (bad.length) warn.innerHTML = `<b>${bad.map(esc).join(', ')}</b> ${bad.length > 1 ? 'are not Zurivel letters' : 'is not a Zurivel letter'}. Zurivel has no c, j, q or x (c only appears inside ch).`;
      // Letter-by-letter pronunciation, one row per distinct word.
      const words = []; let cur = [];
      for (const x of (zcState.fwd ? t : zToZ(inp.value))){ if (x.k === 'o'){ if (cur.length) words.push(cur); cur = []; } else cur.push(x); }
      if (cur.length) words.push(cur);
      const seen = new Set(), uniq = words.filter(w => { const s = zJoin(w).toLowerCase(); return !seen.has(s) && seen.add(s); });
      say.innerHTML = uniq.slice(0, 8).map(w => {
        const word = zJoin(w), g = ZDICT[word.toLowerCase()];
        return `<div class="zc-word"><div><b>${esc(word)}</b><small${g ? ' class="known"' : ''}>${g ? '“' + esc(g) + '”' : 'not in the word list'}</small></div><div class="zc-chips">${w.map(x => x.k === 'bad'
          ? `<span class="x"><i>${esc(x.text)}</i>not a letter</span>`
          : `<span${ZBY[x.lo].vowel ? ' class="v"' : ''}><i>${esc(x.text)}</i>${esc(ZBY[x.lo].sound)}</span>`).join('')}</div></div>`;
      }).join('') + (uniq.length > 8 ? `<p class="sub">+ ${uniq.length - 8} more words</p>` : '');
    };
    inp.value = zcState.text;
    inp.addEventListener('input', draw);
    el.addEventListener('click', e => {
      const m = e.target.closest('[data-zm]'), k = e.target.closest('[data-zk]'), a = e.target.closest('[data-za]');
      if (m){ zcState.fwd = m.dataset.zm === '1'; draw(); }
      else if (k){ inp.focus(); inp.setRangeText(k.dataset.zk, inp.selectionStart, inp.selectionEnd, 'end'); draw(); }
      else if (a && a.dataset.za === 'swap'){ inp.value = zJoin(conv()); zcState.fwd = !zcState.fwd; draw(); }
      else if (a && a.dataset.za === 'sort'){
        const z = l => zcState.fwd ? zJoin(zToZ(l)) : l;
        inp.value = inp.value.split('\n').filter(l => l.trim()).sort((x, y) => zCmp(z(x), z(y))).join('\n'); draw(); flash('Sorted in Zurivel order');
      } else if (a && a.dataset.za === 'copy'){
        const text = zJoin(conv()); if (!text) return;
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

