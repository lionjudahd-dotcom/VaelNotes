// ---------- graph ----------
// The Graph tab: every note is a dot and every NPC a square; every [[link]] is a line. Links to things that don't
// exist yet show as dashed dots. Node keys: n:<note title>, p:<npc id>, m:<missing name>.
const G = { nodes: [], edges: [], byKey: new Map(), pos: new Map(), cam: { x: 0, y: 0, s: 1 }, w: 1, h: 1, sel: null, drag: null, alpha: 0, raf: 0, settled: false, colors: null,
  show: Object.assign({ notes: true, npcs: true, lone: false }, (() => { try { return JSON.parse(store.get('vael.graphShow') || '{}'); } catch { return {}; } })()) };
window.__vaelGraph = G;
const gcv = $('graphCv'), gctx = gcv.getContext('2d');
const graphOpen = () => !$('v-graph').hidden;
const hash01 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
function graphColors(){
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  G.colors = { ink: v('--ink'), muted: v('--muted'), bg: v('--bg'), key: v('--key'), npc: v('--npc'), g: GROUPS.map((_, i) => v('--g' + i)) };
}
const linkKey = t => { const o = resolveLink(t); return o && o.note ? 'n:' + o.note.title.toLowerCase() : o && o.npc ? 'p:' + o.npc.id : 'm:' + String(t).trim().toLowerCase(); };
function buildGraph(){
  const nodes = [], byKey = new Map(), edges = [], seen = new Set(), sh = G.show;
  const add = nd => { nd.deg = 0; nodes.push(nd); byKey.set(nd.key, nd); return nd; };
  if (sh.notes) for (const n of liveNotes()) add({ key: 'n:' + n.title.toLowerCase(), kind: 'note', id: n.id, title: n.title, gi: GROUPS.indexOf(groupOf(n)) });
  if (sh.npcs) for (const r of NPCX.list) add({ key: 'p:' + r.id, kind: 'npc', id: r.id, title: npcShown(r), tier: r.tier, gi: -1 });
  const link = (a, t) => {
    const k = linkKey(t); if (k === a.key) return;
    let b = byKey.get(k);
    if (!b){ if (k[0] !== 'm') return; b = add({ key: k, kind: 'missing', id: null, title: String(t).trim(), gi: -1 }); }
    const ek = a.key < k ? a.key + '\u0000' + k : k + '\u0000' + a.key; if (seen.has(ek)) return;
    seen.add(ek); edges.push([a, b]); a.deg++; b.deg++;
  };
  for (const nd of nodes.slice()){
    if (nd.kind === 'note'){ const n = byId.get(nd.id); for (const t of linksIn(n.body)) link(nd, t); }
    else if (nd.kind === 'npc'){ const r = NPCX.byId.get(nd.id); if (r) for (const t of linksIn(npcText(r))) link(nd, t); }
  }
  // NPCs that link nowhere stay out of the way unless asked for.
  const keep = sh.lone ? nodes : nodes.filter(n => n.kind !== 'npc' || n.deg > 0);
  const hubs = new Set(keep.slice().sort((x, y) => y.deg - x.deg).slice(0, 6).filter(n => n.deg > 2));
  for (const nd of keep){
    const p = G.pos.get(nd.key);
    if (p){ nd.x = p.x; nd.y = p.y; }
    else { const slot = nd.kind === 'npc' ? 6.5 : nd.gi < 0 ? 7 : nd.gi; const ang = (slot / 8) * Math.PI * 2 + hash01(nd.key) * 0.7, rad = 120 + hash01(nd.key + 'r') * 140; nd.x = Math.cos(ang) * rad; nd.y = Math.sin(ang) * rad; }
    nd.vx = 0; nd.vy = 0; nd.r = (nd.kind === 'npc' ? (nd.tier === 'k' ? 5.5 : 4.2) : 4.5) + Math.sqrt(nd.deg) * 1.25; nd.sr = nd.r; nd.hub = hubs.has(nd);
  }
  G.nodes = keep; G.edges = edges; G.byKey = new Map(keep.map(n => [n.key, n]));
  if (G.sel && !G.byKey.has(G.sel)) G.sel = null;
}
function gTick(a){
  const N = G.nodes;
  for (let i = 0; i < N.length; i++){
    const p = N[i];
    for (let j = i + 1; j < N.length; j++){
      const q = N[j]; let dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 < 1){ dx = hash01(p.key) - .5; dy = hash01(q.key) - .5; d2 = 1; }
      const d = Math.sqrt(d2), gap = p.r + q.r + 26;
      const f = (9000 / d2 + (d < gap ? (gap - d) * .35 : 0)) * a; dx = dx / d * f; dy = dy / d * f;   // spread out, and never overlap
      p.vx += dx; p.vy += dy; q.vx -= dx; q.vy -= dy;
    }
    // pull toward the middle, harder along the screen's short side so the layout fills a tall phone
    p.vx -= p.x * (G.h > G.w ? .024 : .013) * a; p.vy -= p.y * (G.w > G.h ? .024 : .013) * a;
  }
  for (const [p, q] of G.edges){
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 120) * 0.035 * a / Math.sqrt(Math.min(p.deg, q.deg)), fx = dx / d * f, fy = dy / d * f;
    p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
  }
  for (const p of N){
    if (p === G.drag){ p.vx = p.vy = 0; continue; }
    p.vx *= 0.8; p.vy *= 0.8; p.x += Math.max(-28, Math.min(28, p.vx)); p.y += Math.max(-28, Math.min(28, p.vy));
  }
}
function gSavePos(){ for (const n of G.nodes) G.pos.set(n.key, { x: n.x, y: n.y }); }
function gFit(){
  if (!G.nodes.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of G.nodes){ x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  const top = 92, bottom = 84;   // room for the legend, the buttons and the selection bar
  G.cam.s = Math.max(.25, Math.min(2, Math.min((G.w - 48) / Math.max(1, x1 - x0), (G.h - top - bottom - 30) / Math.max(1, y1 - y0))));
  G.cam.x = (x0 + x1) / 2; G.cam.y = (y0 + y1) / 2 - (top - bottom) / 2 / G.cam.s;
}
function drawGraph(){
  if (!G.colors) graphColors();
  const c = G.colors, dpr = window.devicePixelRatio || 1, s = G.cam.s;
  const X = x => (x - G.cam.x) * s + G.w / 2, Y = y => (y - G.cam.y) * s + G.h / 2;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0); gctx.clearRect(0, 0, G.w, G.h);
  const sel = G.sel ? G.byKey.get(G.sel) : null, near = new Set();
  if (sel){ near.add(sel); for (const [a, b] of G.edges){ if (a === sel) near.add(b); else if (b === sel) near.add(a); } }
  for (const [a, b] of G.edges){
    if (!G.byKey.has(a.key) || !G.byKey.has(b.key)) continue;
    const hot = sel && (a === sel || b === sel);
    gctx.globalAlpha = sel ? (hot ? .95 : .08) : .26; gctx.strokeStyle = hot ? c.key : c.muted; gctx.lineWidth = hot ? 1.7 : 1;
    gctx.beginPath(); gctx.moveTo(X(a.x), Y(a.y)); gctx.lineTo(X(b.x), Y(b.y)); gctx.stroke();
  }
  for (const n of G.nodes){
    const r = Math.max(3.5, n.r * Math.min(1.5, Math.max(.75, s))); n.sr = r;
    gctx.globalAlpha = sel && !near.has(n) ? .22 : 1;
    gctx.beginPath();
    if (n.kind === 'npc'){ const q = r * .9; gctx.roundRect ? gctx.roundRect(X(n.x) - q, Y(n.y) - q, q * 2, q * 2, q * .35) : gctx.rect(X(n.x) - q, Y(n.y) - q, q * 2, q * 2); }
    else gctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2);
    if (n.kind === 'missing'){ gctx.fillStyle = c.bg; gctx.fill(); gctx.setLineDash([3, 3]); gctx.strokeStyle = c.muted; gctx.lineWidth = 1.4; gctx.stroke(); gctx.setLineDash([]); }
    else { gctx.fillStyle = n.kind === 'npc' ? c.npc : c.g[n.gi] || c.muted; gctx.fill(); if (n === sel){ gctx.strokeStyle = c.ink; gctx.lineWidth = 2.5; gctx.stroke(); } }
  }
  gctx.font = '600 12.5px "Alegreya Sans", "Segoe UI", system-ui, sans-serif'; gctx.textAlign = 'center'; gctx.textBaseline = 'top'; gctx.lineJoin = 'round';
  // Labels: the selected dot first, then the most connected. A label is skipped if it would sit on one already drawn.
  const boxes = [], order = (sel ? [...near] : G.nodes.slice()).sort((a, b) => (b === sel) - (a === sel) || b.deg - a.deg);
  for (const n of order){
    const x = X(n.x), y = Y(n.y) + n.sr + 3, w = gctx.measureText(n.title).width, box = [x - w / 2 - 3, y - 2, x + w / 2 + 3, y + 15];
    if (n !== sel && boxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
    boxes.push(box);
    gctx.globalAlpha = 1; gctx.strokeStyle = c.bg; gctx.lineWidth = 3.5; gctx.strokeText(n.title, x, y);
    gctx.fillStyle = n.kind === 'missing' ? c.muted : c.ink; gctx.fillText(n.title, x, y);
  }
  gctx.globalAlpha = 1;
}
function gRun(){
  cancelAnimationFrame(G.raf);
  const step = () => {
    if (!graphOpen()) return;
    if (G.alpha > .02){ gTick(G.alpha); G.alpha *= .97; gSavePos(); }
    drawGraph();
    if (G.alpha > .02 || G.drag) G.raf = requestAnimationFrame(step);
  };
  G.raf = requestAnimationFrame(step);
}
function gResize(){
  const r = $('graphView').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (r.width < 2 || r.height < 2) return false;
  G.w = r.width; G.h = r.height; gcv.width = Math.round(G.w * dpr); gcv.height = Math.round(G.h * dpr);
  return true;
}
function gSelect(nd){
  G.sel = nd ? nd.key : null;
  const n = nd && nd.kind === 'note' ? byId.get(nd.id) : null, r = nd && nd.kind === 'npc' ? NPCX.byId.get(nd.id) : null;
  const conn = nd ? `${nd.deg} connection${nd.deg === 1 ? '' : 's'}` : '';
  $('gselTitle').textContent = nd ? nd.title : 'Tap a dot to see what it connects to.';
  $('gselMeta').textContent = !nd ? 'Tap it again to open it. Pinch to zoom, drag to move around.'
    : nd.kind === 'missing' ? `Not written yet · linked from ${nd.deg} place${nd.deg === 1 ? '' : 's'}`
    : r ? ['NPC', npcName(r) && npcRole(r), npcPlace(r), conn].filter(Boolean).join(' · ')
    : `${n ? groupOf(n).name : ''} · ${conn}`;
  $('gselOpen').textContent = nd && nd.kind === 'missing' ? 'Write it' : nd && nd.kind === 'npc' ? 'Open sheet' : 'Open';
  $('gselOpen').hidden = !nd || (nd.kind === 'missing' && (notesReadOnly || !notesCol));
  $('graphSel').classList.toggle('idle', !nd);
  drawGraph();
}
function gOpenSel(){
  const nd = G.sel ? G.byKey.get(G.sel) : null; if (!nd) return;
  if (nd.kind === 'npc'){ openNpcTab(nd.id); return; }
  showView('notes');
  parkNoteEdit(); stack = [];
  if (nd.kind === 'missing'){ if (!notesReadOnly && notesCol){ current = null; startEdit(null, { title: nd.title, folder: 'Story & Lore' }); } }
  else openNote(nd.id, true);
}
function openGraph(){
  if (!gResize()) return;
  graphColors(); buildGraph(); drawLegend();
  if (!G.settled && G.nodes.length){
    for (let i = 0, a = 1; i < 320; i++, a = Math.max(.05, a * .988)) gTick(a);   // settle before the first frame
    gSavePos(); gFit(); G.settled = true; G.alpha = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .08;
  } else if (G.nodes.length && G.alpha < .2) G.alpha = .2;
  gSelect(G.sel ? G.byKey.get(G.sel) : null);
  gRun();
}
// Notes or NPCs changed: rebuild the graph if it is on screen (otherwise it rebuilds when opened).
let graphTimer = 0;
function graphChanged(){ clearTimeout(graphTimer); graphTimer = setTimeout(() => { if (graphOpen()) openGraph(); }, 120); }
function showInGraph(key){
  showView('graph');
  const nd = G.byKey.get(key);
  if (!nd && key[0] === 'p' && !G.show.lone){ G.show.lone = true; store.set('vael.graphShow', JSON.stringify(G.show)); openGraph(); }
  const n2 = G.byKey.get(key);
  if (n2){ G.cam.s = Math.max(G.cam.s, 1); G.cam.x = n2.x; G.cam.y = n2.y + 20 / G.cam.s; gSelect(n2); }
}
function drawLegend(){
  const tg = (k, label) => `<button type="button" class="gtog" data-gs="${k}" aria-pressed="${!!G.show[k]}">${label}</button>`;
  $('graphLegend').innerHTML = `<div class="gtogs">${tg('notes', 'Notes')}${tg('npcs', 'NPCs')}${G.show.npcs ? tg('lone', 'Unlinked NPCs') : ''}</div><div class="gkey">`
    + (G.show.notes ? GROUPS.map((g, i) => `<span><i style="background:var(--g${i})"></i>${g.name}</span>`).join('') : '')
    + (G.show.npcs ? '<span><i class="sq"></i>NPC</span>' : '') + '<span><i class="un"></i>Not written yet</span></div>';
}
$('graphLegend').addEventListener('click', e => {
  const b = e.target.closest('[data-gs]'); if (!b) return;
  G.show[b.dataset.gs] = !G.show[b.dataset.gs]; store.set('vael.graphShow', JSON.stringify(G.show));
  openGraph(); if (!G.sel){ gFit(); drawGraph(); }
});
$('graphFit').addEventListener('click', () => { gFit(); drawGraph(); });
$('gselOpen').addEventListener('click', gOpenSel);
window.addEventListener('vael:view', e => { if (e.detail === 'graph') openGraph(); else cancelAnimationFrame(G.raf); });

// Touch and mouse: drag the background to move, drag a dot to rearrange, pinch or scroll to zoom.
const gp = new Map(); let gdrag = null, gpinch = null;
const glocal = e => { const r = gcv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function gHit(sx, sy){
  let best = null, bd = 1e9;
  for (const n of G.nodes){ const d = Math.hypot((n.x - G.cam.x) * G.cam.s + G.w / 2 - sx, (n.y - G.cam.y) * G.cam.s + G.h / 2 - sy); if (d < n.sr + 13 && d < bd){ bd = d; best = n; } }
  return best;
}
function gZoom(sx, sy, f){
  const wx = (sx - G.w / 2) / G.cam.s + G.cam.x, wy = (sy - G.h / 2) / G.cam.s + G.cam.y;
  G.cam.s = Math.max(.2, Math.min(3, G.cam.s * f));
  G.cam.x = wx - (sx - G.w / 2) / G.cam.s; G.cam.y = wy - (sy - G.h / 2) / G.cam.s; drawGraph();
}
gcv.addEventListener('pointerdown', e => {
  gcv.setPointerCapture(e.pointerId); const p = glocal(e); gp.set(e.pointerId, p);
  if (gp.size === 2){ const [a, b] = [...gp.values()]; gpinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; gdrag = null; G.drag = null; return; }
  gdrag = { node: gHit(p[0], p[1]), last: p, dist: 0 };
});
gcv.addEventListener('pointermove', e => {
  if (!gp.has(e.pointerId)) return;
  const p = glocal(e); gp.set(e.pointerId, p);
  if (gpinch && gp.size === 2){ const [a, b] = [...gp.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (gpinch.d > 0) gZoom((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / gpinch.d); gpinch.d = d; return; }
  if (!gdrag) return;
  const dx = p[0] - gdrag.last[0], dy = p[1] - gdrag.last[1]; gdrag.last = p; gdrag.dist += Math.abs(dx) + Math.abs(dy);
  if (gdrag.dist < 7) return;
  if (gdrag.node){ gdrag.node.x += dx / G.cam.s; gdrag.node.y += dy / G.cam.s; if (G.drag !== gdrag.node){ G.drag = gdrag.node; } G.alpha = Math.max(G.alpha, .22); gRun(); }
  else { G.cam.x -= dx / G.cam.s; G.cam.y -= dy / G.cam.s; drawGraph(); }
});
const gEnd = e => {
  if (!gp.has(e.pointerId)) return;
  gp.delete(e.pointerId);
  if (gp.size < 2) gpinch = null;
  if (gdrag && !gp.size){
    if (gdrag.dist < 7 && e.type === 'pointerup'){ const nd = gdrag.node; if (nd && G.sel === nd.key) gOpenSel(); else gSelect(nd); }
    G.drag = null; gdrag = null; gSavePos();
  }
};
gcv.addEventListener('pointerup', gEnd); gcv.addEventListener('pointercancel', gEnd);
gcv.addEventListener('wheel', e => { e.preventDefault(); const p = glocal(e); gZoom(p[0], p[1], Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0016))); }, { passive: false });
new ResizeObserver(() => { if (graphOpen() && gResize()) drawGraph(); }).observe($('graphView'));
const gRetheme = () => { graphColors(); if (graphOpen()) drawGraph(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', gRetheme);
new MutationObserver(gRetheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (graphOpen()) requestAnimationFrame(openGraph);

