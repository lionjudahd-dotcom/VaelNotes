'use strict';
// Vael Notes shell: sign-in, the database layer the page talks to, settings, themes and offline support.
// The page itself (index.html) asks for its data through window.claude.use('db'); this file answers with Supabase.
(function(){
  const CFG = window.VAEL_CONFIG || {};
  const VERSION = '1.0.0';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch {} }, del(k){ try { localStorage.removeItem(k); } catch {} } };
  const readJSON = k => { try { return JSON.parse(ls.get(k) || 'null'); } catch { return null; } };
  const iso = t => { const d = new Date(t); return isNaN(d) ? '' : d.toISOString(); };

  // ---------- look: theme and text size ----------
  const prefs = Object.assign({ theme: 'system', text: 'm' }, readJSON('vael.prefs') || {});
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applyPrefs(){
    const r = document.documentElement;
    if (prefs.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', prefs.theme);
    r.setAttribute('data-text', prefs.text);
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && darkQuery.matches), m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = dark ? '#1A211E' : '#FAFAF5';
  }
  function setPref(k, v){ prefs[k] = v; ls.set('vael.prefs', JSON.stringify(prefs)); applyPrefs(); }
  applyPrefs(); darkQuery.addEventListener('change', applyPrefs);

  // ---------- database layer ----------
  const sb = window.supabase && CFG.url && CFG.key ? window.supabase.createClient(CFG.url, CFG.key) : null;
  const S = { me: null, members: [], offline: false, live: false };
  let resolveReady; const ready = new Promise(r => { resolveReady = r; });
  const cache = { notes: new Map(readJSON('vael.cache.notes') || []), npcs: new Map(readJSON('vael.cache.npcs') || []) };
  const loaded = { notes: false, npcs: false }, subs = { notes: [], npcs: [] }, timers = {};
  const canWrite = () => !!S.me && !S.offline && (S.me.role === 'owner' || S.me.role === 'editor');
  const MAP = {
    notes: {
      doc: r => ({ title: r.title, folder: r.folder, body: r.body, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), trashed: !!r.trashed, updatedBy: r.updated_by || '' }),
      row(d, full){
        const o = {};
        if ('title' in d) o.title = d.title; if ('folder' in d) o.folder = d.folder; if ('body' in d) o.body = d.body;
        if (d.createdAt) o.created_at = d.createdAt; if (d.updatedAt) o.updated_at = d.updatedAt;
        if (full || 'trashed' in d) o.trashed = !!d.trashed;
        if (full || 'trashedAt' in d) o.trashed_at = d.trashedAt || null;
        return o;
      }
    },
    npcs: { doc: r => r.data || {}, row: d => ({ data: d, updated_at: new Date().toISOString() }) }
  };
  const snapshot = (table, fromCache) => {
    const docs = [...cache[table].entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([id, d]) => ({ id, exists: true, data: () => d }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache, hasPendingWrites: false } };
  };
  function emit(table){ const snap = snapshot(table, !loaded[table]); for (const s of subs[table].slice()) { try { s.next(snap); } catch (e) { console.error(e); } } }
  function persist(table){ clearTimeout(timers[table]); timers[table] = setTimeout(() => ls.set('vael.cache.' + table, JSON.stringify([...cache[table].entries()])), 400); }
  function fail(error){
    const m = String((error && error.message) || error);
    const denied = error && (error.code === '42501' || error.status === 401 || error.status === 403 || /row-level security|permission denied/i.test(m));
    throw { code: denied ? 'invalid_argument' : 'unavailable', message: m };
  }
  function needOnline(){ if (!sb || S.offline) throw { code: 'unavailable', message: 'offline' }; }
  async function load(table, attempt){
    if (!sb || S.offline) return;
    const { data, error } = await sb.from(table).select('*');
    if (error){ if (!loaded[table]) setTimeout(() => load(table, (attempt || 0) + 1), Math.min(30000, 3000 * ((attempt || 0) + 1))); return; }
    cache[table] = new Map(data.map(r => [r.id, MAP[table].doc(r)])); loaded[table] = true; persist(table); emit(table);
  }
  function listen(){
    if (!sb || S.live) return; S.live = true;
    let first = true;
    const change = (table, p) => { if (p.eventType === 'DELETE') cache[table].delete(p.old.id); else cache[table].set(p.new.id, MAP[table].doc(p.new)); persist(table); emit(table); };
    sb.channel('vael-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, p => change('notes', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'npcs' }, p => change('npcs', p))
      .subscribe(status => { if (status === 'SUBSCRIBED'){ if (!first){ load('notes'); load('npcs'); } first = false; } });
    let hiddenAt = 0;   // catch up after the phone was asleep
    document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 30000){ load('notes'); load('npcs'); } });
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 20);
  function historyCol(noteId){
    const q = (order, lim) => ({
      orderBy(f, dir){ return q({ col: f === 'savedAt' ? 'saved_at' : 'replaced_at', asc: dir !== 'desc' }, lim); },
      limit(n){ return q(order, n); },
      async get(){
        needOnline();
        let r = sb.from('note_history').select('*').eq('note_id', noteId);
        if (order) r = r.order(order.col, { ascending: order.asc });
        const { data, error } = await r.limit(lim || 100); if (error) fail(error);
        const docs = data.map(h => ({ id: h.id.slice(noteId.length + 1), exists: true, data: () => ({ title: h.title, folder: h.folder, body: h.body, savedAt: iso(h.saved_at), replacedAt: iso(h.replaced_at) }) }));
        return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
      },
      doc(hid){
        const pk = noteId + ':' + hid;
        return { id: hid,
          async set(d){ needOnline(); const { error } = await sb.from('note_history').upsert({ id: pk, note_id: noteId, title: d.title, folder: d.folder, body: d.body, saved_at: d.savedAt || null, replaced_at: d.replacedAt || new Date().toISOString() }); if (error) fail(error); },
          async delete(){ needOnline(); const { error } = await sb.from('note_history').delete().eq('id', pk); if (error) fail(error); } };
      }
    });
    return q(null, 0);
  }
  function docRef(table, id){
    const mine = () => (S.me ? S.me.user_id : '');
    return { id, path: table + '/' + id,
      async set(d){
        needOnline();
        const { error } = await sb.from(table).upsert(Object.assign({ id }, MAP[table].row(d, true))); if (error) fail(error);
        cache[table].set(id, table === 'notes' ? { title: d.title, folder: d.folder, body: d.body, createdAt: d.createdAt || '', updatedAt: d.updatedAt || '', trashed: !!d.trashed, updatedBy: mine() } : d);
        persist(table); emit(table);
      },
      async update(d){
        needOnline();
        const cur = cache[table].get(id) || {}, next = Object.assign({}, cur, d);
        const { data, error } = await sb.from(table).update(table === 'notes' ? MAP.notes.row(d, false) : MAP.npcs.row(next)).eq('id', id).select('id');
        if (error) fail(error); if (!data || !data.length) throw { code: 'invalid_argument', message: 'not allowed, or the row is gone' };
        if (table === 'notes') next.updatedBy = mine();
        cache[table].set(id, next); persist(table); emit(table);
      },
      async delete(){
        needOnline();
        const { data, error } = await sb.from(table).delete().eq('id', id).select('id'); if (error) fail(error);
        if ((!data || !data.length) && cache[table].has(id)) throw { code: 'invalid_argument', message: 'not allowed' };
        cache[table].delete(id); persist(table); emit(table);
      },
      collection(sub){ if (table === 'notes' && sub === 'history') return historyCol(id); throw new TypeError('unknown collection ' + sub); } };
  }
  function tableCol(table){
    if (!MAP[table]) throw new TypeError('unknown collection ' + table);
    return { path: table,
      doc(id){ return docRef(table, id || newId()); },
      onSnapshot(next){
        const s = { next }; subs[table].push(s);
        if (loaded[table] || cache[table].size || S.offline) queueMicrotask(() => next(snapshot(table, !loaded[table])));
        return () => { const i = subs[table].indexOf(s); if (i >= 0) subs[table].splice(i, 1); };
      },
      async get(){ return snapshot(table, !loaded[table]); } };
  }
  const db = {
    collection(path){ const p = String(path).split('/'); if (p.length === 1) return tableCol(p[0]); if (p.length === 3 && p[0] === 'notes' && p[2] === 'history') return historyCol(p[1]); throw new TypeError('unknown collection ' + path); },
    doc(path){ const p = String(path).split('/'); return docRef(p[0], p[1]); }
  };
  const user = { canEdit: async () => canWrite(), can: async () => canWrite(), id: async () => (S.me ? S.me.user_id : null) };
  window.claude = { use: async name => { await ready; return name === 'db' ? db : name === 'user' ? user : null; } };
  window.vaelName = id => { const m = S.members.find(x => x.user_id === id); return m ? (m.display_name || m.email.split('@')[0]) : ''; };

  // ---------- sign-in gate ----------
  const gate = document.createElement('div'); gate.className = 'gate'; gate.id = 'gate';
  gate.innerHTML = `
    <div class="gatebox">
      <p class="gate-eyebrow">Vael Awakening</p>
      <h1>Vael Notes</h1>
      <p class="gate-sub" id="gateSub">The design notes, characters and map of the island.</p>
      <div class="gate-load" id="gateLoad">Opening…</div>
      <div id="gateForms" hidden>
        <div class="gate-tabs" role="tablist"><button type="button" role="tab" id="tabSignin" aria-selected="true">Sign in</button><button type="button" role="tab" id="tabJoin" aria-selected="false">I have an invite</button></div>
        <form id="signinForm" autocomplete="on">
          <label class="fld" for="siEmail">Email<input type="email" id="siEmail" autocomplete="username" inputmode="email" required></label>
          <label class="fld" for="siPass">Password<input type="password" id="siPass" autocomplete="current-password" required></label>
          <button class="btn" type="submit" id="siBtn">Sign in</button>
          <p class="gate-hint">Forgot your password? Ask the owner to allow a reset, then use “I have an invite” with the new code.</p>
        </form>
        <form id="joinForm" autocomplete="on" hidden>
          <label class="fld" for="jnEmail">Your email<input type="email" id="jnEmail" autocomplete="username" inputmode="email" required><span class="help">Use the address your invite was made for.</span></label>
          <label class="fld" for="jnCode">Invite code<input type="text" id="jnCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="8 letters and numbers"></label>
          <label class="fld" for="jnName">Your name<input type="text" id="jnName" autocomplete="name" placeholder="Shown next to your edits"></label>
          <label class="fld" for="jnPass">Choose a password<input type="password" id="jnPass" autocomplete="new-password" minlength="8" required><span class="help">At least 8 characters.</span></label>
          <label class="fld" for="jnPass2">Password again<input type="password" id="jnPass2" autocomplete="new-password" minlength="8" required></label>
          <button class="btn" type="submit" id="jnBtn">Create my login</button>
        </form>
      </div>
      <div id="noAccess" hidden>
        <p class="notice">This login isn't on the Vael Notes team. Ask the owner to invite you, or sign in with a different email.</p>
        <button class="btn ghost" type="button" id="naOut">Sign out</button>
      </div>
      <p class="gate-msg" id="gateMsg" role="status"></p>
    </div>`;
  document.body.appendChild(gate);
  const gmsg = (t, err) => { $('gateMsg').textContent = t; $('gateMsg').className = 'gate-msg' + (err ? ' err' : ''); };
  function gateShow(mode){
    gate.hidden = false; $('gateLoad').hidden = mode !== 'loading'; $('gateForms').hidden = mode !== 'signin' && mode !== 'join'; $('noAccess').hidden = mode !== 'noaccess';
    $('signinForm').hidden = mode !== 'signin'; $('joinForm').hidden = mode !== 'join';
    $('tabSignin').setAttribute('aria-selected', String(mode === 'signin')); $('tabJoin').setAttribute('aria-selected', String(mode === 'join'));
    if (mode !== 'loading') gmsg('');
  }
  $('tabSignin').addEventListener('click', () => gateShow('signin'));
  $('tabJoin').addEventListener('click', () => gateShow('join'));
  const friendly = e => { const m = String((e && e.message) || e); return /Invalid login/i.test(m) ? 'That email and password don\'t match. Check them and try again.' : /fetch|network/i.test(m) ? 'Can\'t reach the server. Check your connection and try again.' : m; };
  async function signIn(email, password){
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    await enter();
  }
  $('signinForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!sb){ gmsg('The app isn\'t connected to its database yet.', true); return; }
    $('siBtn').disabled = true; gmsg('Signing in…');
    try { await signIn($('siEmail').value, $('siPass').value); } catch (err) { gmsg(friendly(err), true); } finally { $('siBtn').disabled = false; }
  });
  $('joinForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!sb){ gmsg('The app isn\'t connected to its database yet.', true); return; }
    const email = $('jnEmail').value.trim().toLowerCase(), password = $('jnPass').value;
    if (password !== $('jnPass2').value){ gmsg('The two passwords don\'t match.', true); return; }
    if (password.length < 8){ gmsg('Choose a password of at least 8 characters.', true); return; }
    $('jnBtn').disabled = true; gmsg('Setting up your login…');
    try {
      const res = await fetch(CFG.url + '/functions/v1/join', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.key, Authorization: 'Bearer ' + CFG.key }, body: JSON.stringify({ email, code: $('jnCode').value, name: $('jnName').value, password }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not set up the login. Try again.');
      await signIn(email, password);
    } catch (err) { gmsg(friendly(err), true); } finally { $('jnBtn').disabled = false; }
  });
  $('naOut').addEventListener('click', signOut);
  async function signOut(){
    try { if (sb) await sb.auth.signOut(); } catch {}
    for (const k of ['vael.cache.notes', 'vael.cache.npcs', 'vael.cache.island', 'vael.cache.mapedits', 'vael.me']) ls.del(k);
    location.reload();
  }
  function goOffline(me){
    S.me = me; S.offline = true; gate.hidden = true; banner('You\'re offline. This is the copy saved on this device, and it can\'t be edited until you\'re back online.');
    window.addEventListener('online', () => location.reload());
    resolveReady(); runIsland(readJSON('vael.cache.island'), readJSON('vael.cache.mapedits'));
  }
  // The island map's scripts live in the database (team only), not in the public site. After sign-in they are
  // fetched, kept on this device for offline use, and run once as ordinary page scripts, in order.
  // The owner's map edits (table map_edits, one row 'main') are loaded first, because the map applies them
  // while it generates. window.vaelMap is how the map's editor saves them.
  let islandRan = false;
  function runIsland(files, edits){
    if (islandRan || !Array.isArray(files) || !files.length) return;
    islandRan = true;
    window.VAEL_MAP_EDITS = edits && typeof edits === 'object' ? edits : {};
    for (const f of files){
      const s = document.createElement('script');
      s.textContent = f.body + '\n//# sourceURL=island/' + f.name;
      document.body.appendChild(s);
    }
  }
  window.vaelMap = {
    canEdit: () => !!S.me && !S.offline && S.me.role === 'owner',
    async save(data){
      if (!window.vaelMap.canEdit()) throw new Error('Only the owner can edit the map.');
      const { error } = await sb.from('map_edits').upsert({ id: 'main', data, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      ls.set('vael.cache.mapedits', JSON.stringify(data));
    }
  };
  async function loadIsland(){
    try {
      const [files, edits] = await Promise.all([
        sb.from('private_files').select('name, body').order('ord'),
        sb.from('map_edits').select('data').eq('id', 'main').maybeSingle()
      ]);
      if (!files.error && files.data && files.data.length){
        const e = edits.error ? readJSON('vael.cache.mapedits') : (edits.data ? edits.data.data : {});
        ls.set('vael.cache.island', JSON.stringify(files.data)); ls.set('vael.cache.mapedits', JSON.stringify(e || {}));
        runIsland(files.data, e); return;
      }
    } catch {}
    runIsland(readJSON('vael.cache.island'), readJSON('vael.cache.mapedits'));
  }
  // Called once a session exists: find this person on the team, then let the page load its data.
  async function enter(){
    const { data: { session } } = await sb.auth.getSession();
    if (!session){ gateShow('signin'); return; }
    const { data, error } = await sb.from('members').select('*');
    if (error){
      const me = readJSON('vael.me');
      if (me && me.user_id === session.user.id){ goOffline(me); return; }
      gateShow('signin'); gmsg(friendly(error), true); return;
    }
    S.members = data; S.me = data.find(m => m.user_id === session.user.id) || null;
    if (!S.me){ gateShow('noaccess'); return; }
    ls.set('vael.me', JSON.stringify(S.me));
    gate.hidden = true; resolveReady();
    load('notes'); load('npcs'); listen(); loadIsland();
  }
  (async () => {
    gateShow('loading');
    const me = readJSON('vael.me'), hasCopy = cache.notes.size > 0;
    if (!sb){ if (me && hasCopy) goOffline(me); else { gateShow('signin'); gmsg(CFG.url ? 'Can\'t load the app\'s sign-in code. Check your connection and reload.' : 'The app isn\'t connected to its database yet.', true); } return; }
    let session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch {}
    if (session) await enter();
    else if (!navigator.onLine && me && hasCopy) goOffline(me);
    else gateShow(location.hash === '#join' ? 'join' : 'signin');
  })();

  // ---------- small helpers on the page ----------
  function banner(text){
    let b = $('appBanner'); if (!b){ b = document.createElement('div'); b.id = 'appBanner'; b.className = 'appbanner'; b.setAttribute('role', 'status'); const top = document.querySelector('.topbar'); top.parentNode.insertBefore(b, top.nextSibling); }
    b.textContent = text; b.hidden = !text;
  }
  window.addEventListener('offline', () => { if (!S.offline) banner('You\'re offline. You can keep reading; saving will work again when you\'re back online.'); });
  window.addEventListener('online', () => { if (!S.offline) banner(''); });
  // Keyboard: Ctrl/Cmd+S saves, Ctrl/Cmd+K jumps to search.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's'){
      const btn = !$('setSheet').hidden ? null : ($('sheet') && !$('sheet').hidden) ? $('saveBtn') : ($('editor') && !$('editor').hidden) ? $('saveNoteBtn') : null;
      if (btn){ e.preventDefault(); if (!btn.disabled) btn.click(); }
    } else if (k === 'k' && gate.hidden){
      e.preventDefault();
      const tab = document.querySelector('.tabbar [data-v="notes"]'); if (tab) tab.click();
      if ($('reader') && !$('reader').hidden) return;
      if ($('notesPane').hidden){ const g = document.querySelector('#noteTabs [data-g="canon"]'); if (g) g.click(); }
      $('noteSearch').focus(); $('noteSearch').select();
    }
  });
  // Word count under the note editor.
  const count = document.createElement('p'); count.className = 'hint edcount'; count.id = 'edCount';
  const edBody = $('edBody');
  if (edBody){
    $('edPreview').insertAdjacentElement('afterend', count);
    const upd = () => { const t = edBody.value.replace(/^Status:.*$/m, '').trim(), w = t ? t.split(/\s+/).length : 0; count.textContent = `${w.toLocaleString()} word${w === 1 ? '' : 's'}`; };
    edBody.addEventListener('input', upd);
    new MutationObserver(upd).observe($('editor'), { attributes: true, attributeFilter: ['hidden'] });
  }

  // ---------- settings ----------
  const setEl = document.createElement('div');
  setEl.innerHTML = `
    <div class="scrim" id="setScrim" hidden></div>
    <aside class="sheet" id="setSheet" hidden role="dialog" aria-modal="true" aria-labelledby="setTitle">
      <div class="shead"><button class="back" id="setClose" type="button"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Close</button><h2 id="setTitle">Settings</h2></div>
      <div class="smsg" id="setMsg" role="status"></div>
      <div class="sform"><div class="inner">
        <section class="setsec"><p class="label">Appearance</p>
          <div class="fld">Theme<div class="segbtn" id="setTheme"><button type="button" data-v="system">Match device</button><button type="button" data-v="light">Light</button><button type="button" data-v="dark">Dark</button></div></div>
          <div class="fld">Reading text size<div class="segbtn" id="setText"><button type="button" data-v="s">Small</button><button type="button" data-v="m">Normal</button><button type="button" data-v="l">Large</button></div></div>
        </section>
        <section class="setsec" id="setYou"><p class="label">You</p>
          <p class="sub" id="setWho"></p>
          <form id="nameForm" class="setrow"><label class="fld" for="setName">Name shown next to your edits<input type="text" id="setName" autocomplete="name" maxlength="60"></label><button class="btn ghost" type="submit">Save name</button></form>
          <form id="passForm" class="setrow" autocomplete="on"><label class="fld" for="setPass">New password<input type="password" id="setPass" autocomplete="new-password" minlength="8"></label><label class="fld" for="setPass2">New password again<input type="password" id="setPass2" autocomplete="new-password" minlength="8"></label><button class="btn ghost" type="submit">Change password</button></form>
          <button class="btn ghost" type="button" id="setOut">Sign out</button>
        </section>
        <section class="setsec" id="setPeople"><p class="label">Team</p>
          <div class="list" id="peopleList"></div>
          <div id="ownerTools" hidden>
            <form id="inviteForm" class="setrow"><label class="fld" for="invEmail">Invite someone by email<input type="email" id="invEmail" inputmode="email" autocomplete="off" required></label>
              <label class="fld" for="invRole">They can<select id="invRole"><option value="editor">Read and edit (writer)</option><option value="viewer">Read only</option></select></label>
              <button class="btn" type="submit">Create invite</button></form>
            <div class="invbox" id="invBox" hidden><p class="sub" id="invText"></p><button class="btn ghost" type="button" id="invCopy">Copy invite message</button></div>
            <div class="list" id="inviteList"></div>
          </div>
        </section>
        <section class="setsec"><p class="label">Backup</p>
          <p class="sub">Save a copy of everything to this device. The Markdown file opens in any notes app, including Obsidian.</p>
          <div class="setbtns"><button class="btn ghost" type="button" id="expMd">Notes as Markdown</button><button class="btn ghost" type="button" id="expJson">Full backup (notes and NPCs)</button></div>
        </section>
        <section class="setsec"><p class="label">App</p>
          <p class="sub" id="installTip"></p>
          <button class="btn" type="button" id="installBtn" hidden>Install Vael Notes</button>
          <p class="sub">Shortcuts on a keyboard: Ctrl or ⌘ + S saves, Ctrl or ⌘ + K searches the notes.</p>
          <p class="sub">Version ${VERSION}</p>
        </section>
      </div></div>
    </aside>`;
  document.body.appendChild(setEl);
  const smsg = (t, kind) => { $('setMsg').textContent = t; $('setMsg').className = 'smsg' + (kind ? ' ' + kind : ''); };
  const markSeg = (id, v) => { for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v)); };
  $('setTheme').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b){ setPref('theme', b.dataset.v); markSeg('setTheme', prefs.theme); } });
  $('setText').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b){ setPref('text', b.dataset.v); markSeg('setText', prefs.text); } });
  const isOwner = () => !!S.me && S.me.role === 'owner' && !S.offline;
  const ROLE = { owner: 'Owner', editor: 'Writer', viewer: 'Reader' };
  let invites = [];
  function newCode(){ const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = new Uint32Array(8); crypto.getRandomValues(r); return [...r].map(x => a[x % a.length]).join(''); }
  function drawPeople(){
    const own = isOwner();
    $('peopleList').innerHTML = S.members.slice().sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || (a.display_name || a.email).localeCompare(b.display_name || b.email)).map(m => {
      const self = S.me && m.user_id === S.me.user_id;
      const ctl = own && !self ? `<div class="pctl"><select data-role="${esc(m.user_id)}" aria-label="Role for ${esc(m.display_name || m.email)}"><option value="editor"${m.role === 'editor' ? ' selected' : ''}>Writer</option><option value="viewer"${m.role === 'viewer' ? ' selected' : ''}>Reader</option></select><button type="button" class="btn ghost" data-reset="${esc(m.user_id)}">Allow password reset</button><button type="button" class="btn danger" data-remove="${esc(m.user_id)}">Remove</button></div>` : '';
      return `<div class="prow"><div><b>${esc(m.display_name || m.email.split('@')[0])}${self ? ' (you)' : ''}</b><span>${own || self ? esc(m.email) + ' · ' : ''}${ROLE[m.role] || m.role}</span></div>${ctl}</div>`;
    }).join('') || '<div class="prow"><span>Team list is not available offline.</span></div>';
    $('ownerTools').hidden = !own;
    $('inviteList').innerHTML = invites.filter(i => !i.used_at || i.reset_ok).map(i => `<div class="prow"><div><b>${esc(i.email)}</b><span>${i.reset_ok ? 'Password reset allowed' : 'Invited as ' + (ROLE[i.role] || i.role)} · code <code>${esc(i.code)}</code></span></div><div class="pctl"><button type="button" class="btn ghost" data-cancel="${esc(i.email)}">Cancel</button></div></div>`).join('');
  }
  async function loadPeople(){
    if (!sb || S.offline){ drawPeople(); return; }
    const m = await sb.from('members').select('*'); if (!m.error){ S.members = m.data; S.me = m.data.find(x => S.me && x.user_id === S.me.user_id) || S.me; }
    if (isOwner()){ const i = await sb.from('invites').select('*').order('created_at', { ascending: false }); invites = i.error ? [] : i.data; } else invites = [];
    drawPeople();
  }
  function showInvite(email, code, reset){
    const url = location.origin + location.pathname + '#join';
    const text = reset
      ? `Your Vael Notes password can be reset.\n1. Open ${url}\n2. Tap "I have an invite"\n3. Enter your email (${email}) and this code: ${code}\n4. Choose a new password.`
      : `You're invited to Vael Notes, the design notes for Vael Awakening.\n1. Open ${url}\n2. Tap "I have an invite"\n3. Enter your email (${email}) and this invite code: ${code}\n4. Choose your own password.\nOn a phone, add the page to your home screen to use it like an app.`;
    $('invText').textContent = text; $('invText').style.whiteSpace = 'pre-wrap'; $('invBox').hidden = false; $('invCopy').dataset.text = text; $('invCopy').textContent = 'Copy invite message';
  }
  $('invCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('invCopy').dataset.text); $('invCopy').textContent = 'Copied'; } catch { const r = document.createRange(); r.selectNodeContents($('invText')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('invCopy').textContent = 'Selected. Copy it now'; } });
  $('inviteForm').addEventListener('submit', async e => {
    e.preventDefault(); const email = $('invEmail').value.trim().toLowerCase(), role = $('invRole').value, code = newCode();
    if (S.members.some(m => m.email === email)){ smsg('That email is already on the team.', 'err'); return; }
    const { error } = await sb.from('invites').upsert({ email, code, role, reset_ok: false, used_at: null, created_by: S.me.user_id });
    if (error){ smsg('Could not create the invite. ' + friendly(error), 'err'); return; }
    $('invEmail').value = ''; smsg('Invite created. Send the message below to them yourself.', 'ok'); showInvite(email, code, false); loadPeople();
  });
  setEl.addEventListener('change', async e => {
    const sel = e.target.closest('select[data-role]'); if (!sel) return;
    const { error } = await sb.from('members').update({ role: sel.value }).eq('user_id', sel.dataset.role);
    smsg(error ? 'Could not change the role. ' + friendly(error) : 'Role changed.', error ? 'err' : 'ok'); loadPeople();
  });
  setEl.addEventListener('click', async e => {
    const rm = e.target.closest('[data-remove]'), rs = e.target.closest('[data-reset]'), cx = e.target.closest('[data-cancel]');
    if (rm){
      const m = S.members.find(x => x.user_id === rm.dataset.remove); if (!m) return;
      if (!rm.classList.contains('armed')){ rm.classList.add('armed'); rm.textContent = 'Really remove?'; smsg(`${m.display_name || m.email} will lose access to the notes straight away.`, 'err'); return; }
      const { error } = await sb.from('members').delete().eq('user_id', m.user_id); if (!error) await sb.from('invites').delete().eq('email', m.email);
      smsg(error ? 'Could not remove them. ' + friendly(error) : 'Removed.', error ? 'err' : 'ok'); loadPeople();
    } else if (rs){
      const m = S.members.find(x => x.user_id === rs.dataset.reset); if (!m) return; const code = newCode();
      const { error } = await sb.from('invites').upsert({ email: m.email, code, role: m.role, reset_ok: true, created_by: S.me.user_id });
      if (error){ smsg('Could not allow the reset. ' + friendly(error), 'err'); return; }
      smsg('Reset allowed. Send them the message below.', 'ok'); showInvite(m.email, code, true); loadPeople();
    } else if (cx){
      const { error } = await sb.from('invites').delete().eq('email', cx.dataset.cancel);
      smsg(error ? 'Could not cancel it. ' + friendly(error) : 'Invite cancelled.', error ? 'err' : 'ok'); $('invBox').hidden = true; loadPeople();
    }
  });
  $('nameForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!sb || S.offline || !S.me){ smsg('You need to be online to change this.', 'err'); return; }
    const name = $('setName').value.trim().slice(0, 60); if (!name){ smsg('Enter a name first.', 'err'); return; }
    const { data, error } = await sb.from('members').update({ display_name: name }).eq('user_id', S.me.user_id).select('user_id');
    if (error || !data.length){ smsg('Could not save the name. ' + (error ? friendly(error) : ''), 'err'); return; }
    S.me.display_name = name; ls.set('vael.me', JSON.stringify(S.me)); smsg('Name saved.', 'ok'); loadPeople();
  });
  $('passForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!sb || S.offline){ smsg('You need to be online to change this.', 'err'); return; }
    const p = $('setPass').value; if (p.length < 8){ smsg('Choose a password of at least 8 characters.', 'err'); return; }
    if (p !== $('setPass2').value){ smsg('The two passwords don\'t match.', 'err'); return; }
    const { error } = await sb.auth.updateUser({ password: p });
    if (error){ smsg('Could not change the password. ' + friendly(error), 'err'); return; }
    $('setPass').value = ''; $('setPass2').value = ''; smsg('Password changed.', 'ok');
  });
  $('setOut').addEventListener('click', e => { const b = e.currentTarget; if (!b.classList.contains('armed')){ b.classList.add('armed'); b.textContent = 'Sign out of this device?'; return; } signOut(); });
  // Backup files
  function download(name, text, type){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('expMd').addEventListener('click', () => {
    const notes = [...cache.notes.values()].filter(n => !n.trashed).sort((a, b) => (a.folder + a.title).localeCompare(b.folder + b.title));
    if (!notes.length){ smsg('There are no notes loaded to export yet.', 'err'); return; }
    download(`vael-notes-${stamp()}.md`, notes.map(n => `# ${n.title}\n\n_Section: ${n.folder} · updated ${String(n.updatedAt).slice(0, 10)}_\n\n${n.body.trim()}\n`).join('\n\n---\n\n'), 'text/markdown');
    smsg(`Saved ${notes.length} notes as one Markdown file.`, 'ok');
  });
  $('expJson').addEventListener('click', () => {
    download(`vael-backup-${stamp()}.json`, JSON.stringify({ exported: new Date().toISOString(), notes: [...cache.notes.entries()].map(([id, d]) => Object.assign({ id }, d)), npcs: [...cache.npcs.entries()].map(([id, d]) => Object.assign({ id }, d)) }, null, 1), 'application/json');
    smsg('Backup saved to this device.', 'ok');
  });
  // Install
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; $('installBtn').hidden = true; });
  function installTip(){
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('installTip').textContent = standalone ? 'Vael Notes is installed on this device.' : ios ? 'To install on iPhone or iPad: open this page in Safari, tap the Share button, then “Add to Home Screen”.' : 'To install: use the button below if it shows, or your browser\'s menu, then “Install app” or “Add to Home screen”.';
  }
  function openSettings(){
    markSeg('setTheme', prefs.theme); markSeg('setText', prefs.text); smsg('');
    $('setWho').textContent = S.me ? `Signed in as ${S.me.email} · ${ROLE[S.me.role] || S.me.role}${S.offline ? ' · offline' : ''}` : '';
    $('setName').value = S.me ? (S.me.display_name || '') : ''; $('setOut').textContent = 'Sign out'; $('setOut').classList.remove('armed'); $('invBox').hidden = true;
    installTip(); drawPeople(); loadPeople();
    $('setScrim').hidden = false; $('setSheet').hidden = false;
  }
  function closeSettings(){ $('setScrim').hidden = true; $('setSheet').hidden = true; }
  $('setClose').addEventListener('click', closeSettings); $('setScrim').addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('setSheet').hidden) closeSettings(); });
  const gear = $('settingsBtn'); if (gear) gear.addEventListener('click', openSettings);

  // ---------- offline app shell ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    window.addEventListener('load', () => { navigator.serviceWorker && navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
