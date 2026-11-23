// ---------- graph ----------
// Every note is a dot, every [[link]] a line. Links to notes that don't exist yet show as dashed dots.
const G = { nodes: [], edges: [], byKey: new Map(), pos: new Map(), cam: { x: 0, y: 0, s: 1 }, w: 1, h: 1, sel: null, drag: null, alpha: 0, raf: 0, settled: false, colors: null };
window.__vaelGraph = G;
const gcv = $('graphCv'), gctx = gcv.getContext('2d');
const hash01 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
function graphColors(){
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  G.colors = { ink: v('--ink'), muted: v('--muted'), bg: v('--bg'), key: v('--key'), g: GROUPS.map((_, i) => v('--g' + i)) };
}
function buildGraph(){
  const live = liveNotes(), nodes = [], byKey = new Map(), edges = [], seen = new Set();
  for (const n of live){ const nd = { key: n.title.toLowerCase(), id: n.id, title: n.title, gi: GROUPS.indexOf(groupOf(n)), missing: false, deg: 0 }; nodes.push(nd); byKey.set(nd.key, nd); }
  for (const n of live){
    const a = byKey.get(n.title.toLowerCase());
    for (const t of linksIn(n.body)){
      const k = t.toLowerCase(); if (k === a.key) continue;
      let b = byKey.get(k); if (!b){ b = { key: k, id: null, title: t, gi: -1, missing: true, deg: 0 }; nodes.push(b); byKey.set(k, b); }
      const ek = a.key < k ? a.key + '\u0000' + k : k + '\u0000' + a.key; if (seen.has(ek)) continue;
      seen.add(ek); edges.push([a, b]); a.deg++; b.deg++;
    }
  }
  const hubs = new Set(nodes.slice().sort((x, y) => y.deg - x.deg).slice(0, 6).filter(n => n.deg > 2));
  for (const nd of nodes){
    const p = G.pos.get(nd.key);
    if (p){ nd.x = p.x; nd.y = p.y; }
    else { const ang = ((nd.gi < 0 ? 7 : nd.gi) / 8) * Math.PI * 2 + hash01(nd.key) * 0.7, rad = 120 + hash01(nd.key + 'r') * 140; nd.x = Math.cos(ang) * rad; nd.y = Math.sin(ang) * rad; }
    nd.vx = 0; nd.vy = 0; nd.r = 4.5 + Math.sqrt(nd.deg) * 1.25; nd.sr = nd.r; nd.hub = hubs.has(nd);
  }
  G.nodes = nodes; G.edges = edges; G.byKey = byKey;
  if (G.sel && !byKey.has(G.sel)) G.sel = null;
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
  const top = 44, bottom = 84;   // room for the legend and the selection bar
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
    const hot = sel && (a === sel || b === sel);
    gctx.globalAlpha = sel ? (hot ? .95 : .08) : .26; gctx.strokeStyle = hot ? c.key : c.muted; gctx.lineWidth = hot ? 1.7 : 1;
    gctx.beginPath(); gctx.moveTo(X(a.x), Y(a.y)); gctx.lineTo(X(b.x), Y(b.y)); gctx.stroke();
  }
  for (const n of G.nodes){
    const r = Math.max(3.5, n.r * Math.min(1.5, Math.max(.75, s))); n.sr = r;
    gctx.globalAlpha = sel && !near.has(n) ? .22 : 1;
    gctx.beginPath(); gctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2);
    if (n.missing){ gctx.fillStyle = c.bg; gctx.fill(); gctx.setLineDash([3, 3]); gctx.strokeStyle = c.muted; gctx.lineWidth = 1.4; gctx.stroke(); gctx.setLineDash([]); }
    else { gctx.fillStyle = c.g[n.gi] || c.muted; gctx.fill(); if (n === sel){ gctx.strokeStyle = c.ink; gctx.lineWidth = 2.5; gctx.stroke(); } }
  }
  gctx.font = '600 12.5px "Alegreya Sans", "Segoe UI", system-ui, sans-serif'; gctx.textAlign = 'center'; gctx.textBaseline = 'top'; gctx.lineJoin = 'round';
  // Labels: the selected note first, then the most connected. A label is skipped if it would sit on one already drawn.
  const boxes = [], order = (sel ? [...near] : G.nodes.slice()).sort((a, b) => (b === sel) - (a === sel) || b.deg - a.deg);
  for (const n of order){
    const x = X(n.x), y = Y(n.y) + n.sr + 3, w = gctx.measureText(n.title).width, box = [x - w / 2 - 3, y - 2, x + w / 2 + 3, y + 15];
    if (n !== sel && boxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
    boxes.push(box);
    gctx.globalAlpha = 1; gctx.strokeStyle = c.bg; gctx.lineWidth = 3.5; gctx.strokeText(n.title, x, y);
    gctx.fillStyle = n.missing ? c.muted : c.ink; gctx.fillText(n.title, x, y);
  }
  gctx.globalAlpha = 1;
}
function gRun(){
  cancelAnimationFrame(G.raf);
  const step = () => {
    if ($('graphView').hidden) return;
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
  const n = nd && !nd.missing ? byId.get(nd.id) : null;
  $('gselTitle').textContent = nd ? nd.title : 'Tap a note to see what it connects to.';
  $('gselMeta').textContent = !nd ? 'Tap it again to open it. Pinch to zoom, drag to move around.'
    : nd.missing ? `Not written yet · linked from ${nd.deg} note${nd.deg === 1 ? '' : 's'}`
    : `${n ? groupOf(n).name : ''} · ${nd.deg} connection${nd.deg === 1 ? '' : 's'}`;
  $('gselOpen').textContent = nd && nd.missing ? 'Write it' : 'Open';
  $('gselOpen').hidden = !nd || (nd.missing && (notesReadOnly || !notesCol));
  $('graphSel').classList.toggle('idle', !nd);
  drawGraph();
}
function gOpenSel(){
  const nd = G.sel ? G.byKey.get(G.sel) : null; if (!nd) return;
  stack = [];
  if (nd.missing){ if (!notesReadOnly && notesCol){ current = null; startEdit(null, { title: nd.title, folder: 'Story & Lore' }); } }
  else openNote(nd.id, true);
}
function openGraph(){
  if (!gResize()) return;
  graphColors(); buildGraph();
  if (!G.settled && G.nodes.length){
    for (let i = 0, a = 1; i < 320; i++, a = Math.max(.05, a * .988)) gTick(a);   // settle before the first frame
    gSavePos(); gFit(); G.settled = true; G.alpha = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .08;
  } else if (G.nodes.length && G.alpha < .2) G.alpha = .2;
  gSelect(G.sel ? G.byKey.get(G.sel) : null);
  gRun();
}
function applyGroupView(){
  const g = group === 'graph';
  $('notesPane').hidden = g; $('graphView').hidden = !g;
  $('newNoteBtn').hidden = !notesLoaded || notesReadOnly || !notesCol || g;
  if (g) openGraph();
}
function showInGraph(id){
  const n = byId.get(id); if (!n) return;
  group = 'graph'; store.set('vael.noteGroup', group);
  closeReader(); noteTabs(); applyGroupView();
  const nd = G.byKey.get(n.title.toLowerCase());
  if (nd){ G.cam.s = Math.max(G.cam.s, 1); G.cam.x = nd.x; G.cam.y = nd.y + 20 / G.cam.s; gSelect(nd); }
}
$('graphLegend').innerHTML = GROUPS.map((g, i) => `<span><i style="background:var(--g${i})"></i>${g.name}</span>`).join('') + '<span><i class="un"></i>Not written yet</span>';
$('graphFit').addEventListener('click', () => { gFit(); drawGraph(); });
$('gselOpen').addEventListener('click', gOpenSel);

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
new ResizeObserver(() => { if (!$('graphView').hidden && gResize()) drawGraph(); }).observe($('graphView'));
const gRetheme = () => { graphColors(); if (!$('graphView').hidden) drawGraph(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', gRetheme);
new MutationObserver(gRetheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

