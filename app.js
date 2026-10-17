/* ============================================================
   CONFIG — the one thing to change if the R2 bucket URL ever changes
   ============================================================ */
const PHOTO_BASE_URL = 'https://pub-52ef5d48cdfc41a29a32eb97a46c2221.r2.dev/';
// API_BASE_URL comes from config.js (loaded before this file).

/* ============================================================
   DATA — nothing is embedded in the site any more. After login the
   Worker returns the ORIGINAL snags (read-only), the builder's OVERLAY
   (trade / status / contractor changes), all comments, and the
   contractor suggestion list. applyOverlay() lays the overlay on top of
   the originals to build SNAGS, which the rest of the page uses exactly
   as before — so every view, filter, search and export shows the
   builder's changes without the original data ever being modified.
   ============================================================ */
let RAW_SNAGS = [];
let OVERLAY = {};          // tag -> {trade, status, contractor, updatedBy, updatedAt}
let COMMENTS_BY_TAG = {};  // tag -> [{id, userId, username, body, createdAt, editedAt}]
let CONTRACTORS = [];
let SNAGS = [];

function applyOverlay(){
  SNAGS = RAW_SNAGS.map(s => {
    const o = OVERLAY[s.tag] || {};
    return Object.assign({}, s, {
      trade: o.trade || s.trade,
      status: o.status || s.status,
      originalTrade: s.trade,
      originalStatus: s.status,
      contractor: o.contractor || '',
      overlayBy: o.updatedBy || ''
    });
  });
}

/* ============================================================
   AUTH / SESSION
   ============================================================ */
const SESSION_KEY = 'snagSiteSession'; // localStorage: {token, username, role}
let currentUser = null; // {id, username, role} once logged in

function getSession(){
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function setSession(token, username, role){
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, username, role })); } catch (e) { /* private browsing: session just won't survive a reload */ }
}
function clearSession(){
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}
// Decodes the token payload WITHOUT verifying it — only a UX shortcut to
// decide whether to try a stored token. The Worker verifies every request.
function decodeTokenUnsafe(token){
  try {
    const b64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
  } catch (e) { return null; }
}
// UI gating only — the Worker enforces all of these rules itself.
function isAdmin(){ return !!currentUser && currentUser.role === 'admin'; }
function canEditOverlay(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'builder'); }
function canModifyComment(c){
  if (!currentUser) return false;
  return currentUser.role === 'admin' || (currentUser.role === 'builder' && c.userId === currentUser.id);
}

async function apiFetch(path, opts){
  opts = opts || {};
  const session = getSession();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
  const resp = await fetch(API_BASE_URL + path, Object.assign({}, opts, { headers }));
  if (resp.status === 401){
    clearSession();
    showLoginScreen('Your session has ended — please sign in again.');
    throw new Error('Session expired');
  }
  return resp;
}

function clearRenderedData(){
  // Don't leave snag data sitting in the page behind the login screen.
  ['groupsContainer', 'selectedSnagsList', 'activeSnagDetail', 'fullRoomListBody', 'adminUsersBody', 'adminContractors'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  RAW_SNAGS = []; OVERLAY = {}; COMMENTS_BY_TAG = {}; CONTRACTORS = []; SNAGS = [];
}
function showLoginScreen(errorMsg){
  clearRenderedData();
  document.getElementById('loginScreen').classList.add('show');
  document.getElementById('sessionBar').style.display = 'none';
  document.getElementById('mainApp').style.display = 'none';
  const errEl = document.getElementById('loginError');
  if (errorMsg){ errEl.textContent = errorMsg; errEl.classList.add('show'); }
  else { errEl.textContent = ''; errEl.classList.remove('show'); }
}
function showMainApp(){
  document.getElementById('loginScreen').classList.remove('show');
  document.getElementById('sessionBar').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('sessionUsername').textContent = currentUser.username;
  const chip = document.getElementById('sessionRoleChip');
  chip.textContent = currentUser.role === 'viewer' ? 'read only' : currentUser.role;
  chip.className = 'role-chip role-' + currentUser.role;
  document.getElementById('adminTabBtn').style.display = isAdmin() ? 'inline-block' : 'none';
  setMainView('explore');
}
function userFromToken(token, username, role){
  const payload = decodeTokenUnsafe(token) || {};
  return { id: payload.sub, username, role };
}
async function doLogin(){
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.remove('show');
  if (!username || !password){ errEl.textContent = 'Enter a username and password.'; errEl.classList.add('show'); return; }
  let resp, body;
  try {
    resp = await fetch(API_BASE_URL + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    body = await resp.json();
  } catch (e) { errEl.textContent = 'Could not reach the server — check your connection and try again.'; errEl.classList.add('show'); return; }
  if (!resp.ok){ errEl.textContent = body.error || 'Login failed.'; errEl.classList.add('show'); return; }
  setSession(body.token, body.username, body.role);
  currentUser = userFromToken(body.token, body.username, body.role);
  document.getElementById('loginPassword').value = '';
  await bootApp();
}
function doLogout(){
  clearSession();
  currentUser = null;
  showLoginScreen();
}

async function loadAppData(){
  const resp = await apiFetch('/api/data');
  const body = await resp.json();
  RAW_SNAGS = body.snags || [];
  OVERLAY = body.overlay || {};
  CONTRACTORS = body.contractors || [];
  COMMENTS_BY_TAG = {};
  (body.comments || []).forEach(c => { (COMMENTS_BY_TAG[c.tag] = COMMENTS_BY_TAG[c.tag] || []).push(c); });
  applyOverlay();
  populateContractorDatalist();
}
function populateContractorDatalist(){
  const dl = document.getElementById('contractorList');
  if (dl) dl.innerHTML = CONTRACTORS.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}
// Re-draws everything that shows snag data, WITHOUT resetting the user's
// place (selected room, selection, expanded groups).
function rerenderAll(){
  applyOverlay();
  populateContractorDatalist();
  try { renderStats(); } catch (e) { console.error(e); }
  try { renderFloorButtons(); if (explorerFloor) renderRoomButtons(); } catch (e) { console.error(e); }
  if (document.getElementById('view-list').classList.contains('active')) renderGroups();
  renderSelectedList();
  renderActiveDetail();
  if (explorerFloor && explorerRoom) renderFullRoomList();
}
async function refreshDataAndRerender(){
  await loadAppData();
  rerenderAll();
}

/* ============================================================
   HELPERS — reused conventions from the snagging app for consistency
   ============================================================ */
function roomName(floorCode, roomCode){
  const f = FLOORS.find(x => x.code === floorCode);
  if (!f) return roomCode;
  const r = f.rooms.find(x => x[0] === roomCode);
  return r ? r[1] : roomCode;
}
function floorName(floorCode){
  const f = FLOORS.find(x => x.code === floorCode);
  return f ? f.name : floorCode;
}
const STATUS_CLASS_MAP = { 'Open':'st-open','In Progress':'st-inprogress','Awaiting Parts':'st-awaiting','Fixed - To Verify':'st-tofix','Verified/Closed':'st-verified' };
function statusClass(s){ return STATUS_CLASS_MAP[s] || 'st-open'; }
const STATUS_LIST = Object.keys(STATUS_CLASS_MAP);
const SEVERITY_LIST = ['Critical','Major','Minor','Cosmetic'];
function escapeAttr(s){ return escapeHtml(s == null ? '' : String(s)); }
function escapeHtml(s){ return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function getZoomFactor(floorCode, roomCode){
  return (ROOM_ZOOM_OVERRIDES[floorCode] && ROOM_ZOOM_OVERRIDES[floorCode][roomCode]) || 1.5;
}
const SEVERITY_ORDER = ['Critical','Major','Minor','Cosmetic'];

/* ============================================================
   STATS
   ============================================================ */
function renderStats(){
  document.getElementById('pageTitle').textContent = `${SNAGS.length} snags logged`;
  document.getElementById('statTotal').textContent = SNAGS.length;
  document.getElementById('statOpen').textContent = SNAGS.filter(s => s.status !== 'Verified/Closed').length;
  document.getElementById('statMajor').textContent = SNAGS.filter(s => (s.severity === 'Major' || s.severity === 'Critical') && s.status !== 'Verified/Closed').length;
  document.getElementById('statVerified').textContent = SNAGS.filter(s => s.status === 'Verified/Closed').length;
}

/* ============================================================
   FILTER + GROUP
   ============================================================ */
let groupBy = 'room';
let expandedGroups = new Set();

function setGroupBy(g){
  groupBy = g;
  expandedGroups = new Set();
  document.querySelectorAll('[data-group]').forEach(b => b.classList.toggle('btn-active', b.dataset.group === g));
  renderGroups();
}

function filteredSnags(){
  const status = document.getElementById('fStatus').value;
  const qWords = document.getElementById('fSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SNAGS.filter(s => {
    if (status && s.status !== status) return false;
    if (qWords.length){
      const hay = [s.tag, s.floorName, s.roomName, s.trade, s.contractor, s.severity, s.status, s.location, s.description, s.comments, (COMMENTS_BY_TAG[s.tag] || []).map(c => c.body).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!qWords.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

function groupKeyAndLabel(s){
  if (groupBy === 'room') return [s.floorCode + '|' + s.roomCode, `${s.roomName} — ${s.floorName}`];
  if (groupBy === 'trade') return [s.trade, s.trade];
  if (groupBy === 'severity') return [s.severity, s.severity];
  if (groupBy === 'floor') return [s.floorCode, s.floorName];
  if (groupBy === 'contractor') return [s.contractor || '~unassigned', s.contractor || 'No contractor assigned'];
  return ['?', '?'];
}

function sortGroupKeys(keys){
  if (groupBy === 'severity'){
    return keys.sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b));
  }
  if (groupBy === 'floor'){
    const order = FLOORS.map(f => f.code);
    return keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (groupBy === 'room'){
    // Order by the same floor→room order the app itself uses
    const order = [];
    FLOORS.forEach(f => f.rooms.forEach(r => order.push(f.code + '|' + r[0])));
    return keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (groupBy === 'contractor') return keys.sort((x, y) => x === '~unassigned' ? 1 : y === '~unassigned' ? -1 : x.localeCompare(y));
  return keys.sort(); // trade — alphabetical is fine
}

/* ============================================================
   RENDER
   ============================================================ */
function renderGroups(){
  const container = document.getElementById('groupsContainer');
  const items = filteredSnags();
  if (items.length === 0){
    container.innerHTML = `<div class="empty-state">No snags match the current filters.</div>`;
    return;
  }

  const groups = {}; // key -> { label, items }
  items.forEach(s => {
    const [key, label] = groupKeyAndLabel(s);
    if (!groups[key]) groups[key] = { label, items: [] };
    groups[key].items.push(s);
  });
  const keys = sortGroupKeys(Object.keys(groups));

  container.innerHTML = keys.map(key => {
    const g = groups[key];
    const openCount = g.items.filter(s => s.status !== 'Verified/Closed').length;
    const isExpanded = expandedGroups.has(key);
    const bodyHtml = isExpanded ? g.items.map(snagCardHtml).join('') : '';
    return `
      <div class="group-section ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}">
        <div class="group-header" onclick="toggleGroup('${key.replace(/'/g, "\\'")}')">
          <div class="group-title"><span class="caret">▶</span>${escapeHtml(g.label)}</div>
          <div class="group-counts">
            ${openCount > 0 ? `<span class="chip open">${openCount} open</span>` : `<span class="chip clear">all clear</span>`}
            <span class="chip" style="background:var(--grey-bg);color:var(--text-soft);">${g.items.length} total</span>
          </div>
        </div>
        <div class="group-body">${bodyHtml}</div>
      </div>`;
  }).join('');
}

function toggleGroup(key){
  if (expandedGroups.has(key)) expandedGroups.delete(key); else expandedGroups.add(key);
  renderGroups();
}
function expandAll(){
  const items = filteredSnags();
  items.forEach(s => { const [key] = groupKeyAndLabel(s); expandedGroups.add(key); });
  renderGroups();
}
function collapseAll(){ expandedGroups = new Set(); renderGroups(); }

function snagCardHtml(s){
  const thumbs = s.thumbFiles || [];
  const fulls = s.photoFiles && s.photoFiles.length ? s.photoFiles : thumbs;
  const photoHtml = thumbs.map((t, i) => {
    const fullUrl = PHOTO_BASE_URL + (fulls[i] || t);
    const thumbUrl = PHOTO_BASE_URL + t;
    return `<img src="${thumbUrl}" loading="lazy" onclick="openPhotoLightbox('${fullUrl.replace(/'/g, "\\'")}')">`;
  }).join('');
  const pinHtml = (s.pins && s.pins.length)
    ? (() => { const p = buildMiniPinStyle(s.floorCode, s.roomCode, s.pins[0].x, s.pins[0].y); const extra = s.pins.length > 1 ? ` +${s.pins.length - 1}` : ''; return `<div class="pin-mini" style="${p.bg}" onclick="openPinLightbox('${s.tag}')" title="Tap to see where this is${extra}"><div class="marker" style="left:${p.markerLeft}px;top:${p.markerTop}px;"></div></div>`; })()
    : '';
  return `
    <div class="snag-card sev-${s.severity}">
      <div class="card-top">
        <div><span class="tag-code">${s.tag}</span> <span class="badge sev-${s.severity}">${s.severity}</span>${s.contractor ? ` <span class="contractor-chip">🛠 ${escapeHtml(s.contractor)}</span>` : ''}</div>
        <span class="badge ${statusClass(s.status)}">${s.status}</span>
      </div>
      <div class="card-loc"><b>${s.roomName}</b> · ${s.floorName} · ${escapeHtml(s.trade)}${s.location ? ' · ' + escapeHtml(s.location) : ''}</div>
      ${s.trade !== s.originalTrade ? `<div class="overlay-note">Trade changed by ${escapeHtml(s.overlayBy || 'builder')} — originally “${escapeHtml(s.originalTrade)}”</div>` : ''}
      ${s.status !== s.originalStatus ? `<div class="overlay-note">Status updated by ${escapeHtml(s.overlayBy || 'builder')} — originally “${escapeHtml(s.originalStatus)}”</div>` : ''}
      <div class="card-desc">${escapeHtml(s.description)}</div>
      ${s.comments ? `<div class="card-original-note"><b>Original note</b> ${escapeHtml(s.comments)}</div>` : ''}
      <div class="card-media">${pinHtml}${photoHtml}</div>
      ${builderPanelHtml(s)}
      ${commentsHtml(s.tag)}
      ${adminEditHtml(s)}
      <div class="card-date">logged ${new Date(s.createdAt).toLocaleDateString('en-GB')}</div>
    </div>`;
}

/* ============================================================
   BUILDER / ADMIN CONTROLS ON EACH SNAG (overlay edits, comments,
   admin edit of originals). All gating here is UX only; the Worker
   refuses anything the account isn't allowed to do.
   ============================================================ */
function builderPanelHtml(s){
  if (!canEditOverlay()) return '';
  const tradeOpts = TRADES.map(t => `<option value="${escapeAttr(t)}" ${t === s.trade ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const statusOpts = STATUS_LIST.map(t => `<option value="${escapeAttr(t)}" ${t === s.status ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const tradeChanged = s.trade !== s.originalTrade, statusChanged = s.status !== s.originalStatus;
  return `
    <div class="builder-panel" data-tag="${escapeAttr(s.tag)}">
      <div class="bp-title">Builder details</div>
      <div class="bp-grid">
        <div><label>Contractor responsible</label>
          <input type="text" list="contractorList" data-field="contractor" value="${escapeAttr(s.contractor)}" placeholder="Type a name or pick one…" maxlength="80" onchange="onOverlayFieldChange(this)"></div>
        <div><label>Designated trade</label>
          <select data-field="trade" onchange="onOverlayFieldChange(this)">${tradeOpts}</select>
          ${tradeChanged ? `<div class="bp-orig">Original: ${escapeHtml(s.originalTrade)} · <a href="#" onclick="onOverlayRestore(this,'trade');return false;">restore</a></div>` : ''}</div>
        <div><label>Status</label>
          <select data-field="status" onchange="onOverlayFieldChange(this)">${statusOpts}</select>
          ${statusChanged ? `<div class="bp-orig">Original: ${escapeHtml(s.originalStatus)} · <a href="#" onclick="onOverlayRestore(this,'status');return false;">restore</a></div>` : ''}</div>
      </div>
      <div class="inline-msg" style="display:none;"></div>
    </div>`;
}
function showInlineMsg(el, text, ok){
  if (!el) return;
  el.textContent = text; el.className = 'inline-msg ' + (ok ? 'ok' : 'err'); el.style.display = 'block';
}
async function saveOverlay(tag, patch, msgEl){
  try {
    const resp = await apiFetch('/api/overlay/' + encodeURIComponent(tag), { method: 'PUT', body: JSON.stringify(patch) });
    const body = await resp.json();
    if (!resp.ok){ showInlineMsg(msgEl, body.error || 'Could not save.', false); return false; }
    await refreshDataAndRerender();
    return true;
  } catch (e) {
    if (e.message !== 'Session expired') showInlineMsg(msgEl, 'Could not save — check your connection.', false);
    return false;
  }
}
async function onOverlayFieldChange(el){
  const panel = el.closest('.builder-panel');
  const tag = panel.dataset.tag, field = el.dataset.field;
  const value = field === 'contractor' ? el.value.replace(/\s+/g, ' ').trim() : el.value;
  await saveOverlay(tag, { [field]: value }, panel.querySelector('.inline-msg'));
}
async function onOverlayRestore(link, field){
  const panel = link.closest('.builder-panel');
  await saveOverlay(panel.dataset.tag, { [field]: null }, panel.querySelector('.inline-msg'));
}

function commentsHtml(tag){
  const list = COMMENTS_BY_TAG[tag] || [];
  const listHtml = list.length
    ? `<div class="comments-list">${list.map(c => `
        <div class="comment-item" data-id="${c.id}">
          <div class="comment-meta">
            <span>${escapeHtml(c.username)} · ${new Date(c.createdAt).toLocaleString('en-GB')}${c.editedAt ? ' (edited)' : ''}</span>
            ${canModifyComment(c) ? `<span class="comment-actions"><button onclick="startEditComment(this)">Edit</button><button onclick="deleteComment(this)">Delete</button></span>` : ''}
          </div>
          <div class="comment-body">${escapeHtml(c.body)}</div>
        </div>`).join('')}</div>`
    : `<div class="no-comments-hint">No builder comments yet.</div>`;
  const formHtml = canEditOverlay()
    ? `<div class="comment-form">
        <textarea placeholder="Add a comment…" maxlength="2000"></textarea>
        <button class="btn small" onclick="submitCommentFromCard(this)">Post comment</button>
        <div class="inline-msg" style="display:none;"></div>
      </div>`
    : '';
  return `<div class="comments-section" data-tag="${escapeAttr(tag)}">${listHtml}${formHtml}</div>`;
}
async function submitCommentFromCard(btn){
  const section = btn.closest('.comments-section');
  const tag = section.dataset.tag;
  const textarea = section.querySelector('.comment-form textarea');
  const msgEl = section.querySelector('.comment-form .inline-msg');
  const text = textarea.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const resp = await apiFetch('/api/comments', { method: 'POST', body: JSON.stringify({ tag, body: text }) });
    const body = await resp.json();
    if (!resp.ok){ showInlineMsg(msgEl, body.error || 'Could not post comment.', false); btn.disabled = false; return; }
    await refreshDataAndRerender();
  } catch (e) {
    if (e.message !== 'Session expired') showInlineMsg(msgEl, 'Could not post — check your connection.', false);
    btn.disabled = false;
  }
}
function startEditComment(btn){
  const item = btn.closest('.comment-item');
  const bodyEl = item.querySelector('.comment-body');
  const original = bodyEl.textContent;
  const wrap = document.createElement('div');
  wrap.className = 'comment-edit';
  wrap.innerHTML = `<textarea maxlength="2000"></textarea>
    <button class="btn small" onclick="saveEditedComment(this)">Save</button>
    <button class="btn small" onclick="rerenderAll()">Cancel</button>
    <div class="inline-msg" style="display:none;"></div>`;
  wrap.querySelector('textarea').value = original;
  bodyEl.replaceWith(wrap);
}
async function saveEditedComment(btn){
  const item = btn.closest('.comment-item');
  const id = item.dataset.id;
  const text = item.querySelector('textarea').value.trim();
  const msgEl = item.querySelector('.inline-msg');
  if (!text){ showInlineMsg(msgEl, 'A comment cannot be empty — use Delete to remove it.', false); return; }
  try {
    const resp = await apiFetch('/api/comments/' + id, { method: 'PUT', body: JSON.stringify({ body: text }) });
    const body = await resp.json();
    if (!resp.ok){ showInlineMsg(msgEl, body.error || 'Could not save.', false); return; }
    await refreshDataAndRerender();
  } catch (e) { if (e.message !== 'Session expired') showInlineMsg(msgEl, 'Could not save — check your connection.', false); }
}
async function deleteComment(btn){
  if (!confirm('Delete this comment?')) return;
  const item = btn.closest('.comment-item');
  try {
    const resp = await apiFetch('/api/comments/' + item.dataset.id, { method: 'DELETE' });
    if (!resp.ok){ const body = await resp.json(); alert(body.error || 'Could not delete.'); return; }
    await refreshDataAndRerender();
  } catch (e) { /* session expiry handled by apiFetch */ }
}

/* Admin only: edit or delete the ORIGINAL snag record. Note these edits
   live on the website database; the Snagging App stays the master copy, so
   the next time originals are refreshed from an app export they are
   replaced by the app's version. */
function adminEditHtml(s){
  if (!isAdmin()) return '';
  const opts = (list, cur) => list.map(t => `<option value="${escapeAttr(t)}" ${t === cur ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  return `
    <details class="admin-edit" data-tag="${escapeAttr(s.tag)}">
      <summary>Admin: edit or delete the original record</summary>
      <div class="ae-warn">Changes here are overwritten the next time the data is refreshed from the Snagging App — make lasting corrections in the app too.</div>
      <div class="ae-grid">
        <div><label>Trade (original)</label><select data-f="trade">${opts(TRADES, s.originalTrade)}</select></div>
        <div><label>Severity</label><select data-f="severity">${opts(SEVERITY_LIST, s.severity)}</select></div>
        <div><label>Status (original)</label><select data-f="status">${opts(STATUS_LIST, s.originalStatus)}</select></div>
      </div>
      <label>Location</label><input type="text" data-f="location" value="${escapeAttr(s.location)}">
      <label style="margin-top:6px;">Description</label><textarea data-f="description" rows="3">${escapeHtml(s.description)}</textarea>
      <label style="margin-top:6px;">Original note</label><textarea data-f="comments" rows="2">${escapeHtml(s.comments)}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button class="btn small" onclick="adminSaveOriginal(this)">Save changes</button>
        <button class="btn small danger" onclick="adminDeleteSnag(this)">Delete this snag</button>
      </div>
      <div class="inline-msg" style="display:none;"></div>
    </details>`;
}
async function adminSaveOriginal(btn){
  const box = btn.closest('.admin-edit');
  const msgEl = box.querySelector('.inline-msg');
  const payload = {};
  box.querySelectorAll('[data-f]').forEach(el => { payload[el.dataset.f] = el.value; });
  try {
    const resp = await apiFetch('/api/snags/' + encodeURIComponent(box.dataset.tag), { method: 'PUT', body: JSON.stringify(payload) });
    const body = await resp.json();
    if (!resp.ok){ showInlineMsg(msgEl, body.error || 'Could not save.', false); return; }
    await refreshDataAndRerender();
  } catch (e) { if (e.message !== 'Session expired') showInlineMsg(msgEl, 'Could not save — check your connection.', false); }
}
async function adminDeleteSnag(btn){
  const box = btn.closest('.admin-edit');
  const tag = box.dataset.tag;
  if (!confirm(`Delete snag ${tag} and all its builder comments and changes? This cannot be undone.`)) return;
  if (!confirm(`Really delete ${tag}?`)) return;
  try {
    const resp = await apiFetch('/api/snags/' + encodeURIComponent(tag), { method: 'DELETE' });
    if (!resp.ok){ const body = await resp.json(); alert(body.error || 'Could not delete.'); return; }
    selectedTags.delete(tag);
    if (activeTag === tag) activeTag = null;
    await refreshDataAndRerender();
  } catch (e) { /* session expiry handled by apiFetch */ }
}

/* ============================================================
   ADMIN PANEL — accounts + contractor suggestions
   ============================================================ */
async function loadAndRenderAdmin(){
  const msgEl = document.getElementById('adminMsg');
  msgEl.innerHTML = '';
  try {
    const resp = await apiFetch('/api/users');
    const body = await resp.json();
    if (!resp.ok){ msgEl.innerHTML = `<div class="inline-msg err">${escapeHtml(body.error || 'Could not load accounts.')}</div>`; return; }
    document.getElementById('adminUsersBody').innerHTML = body.users.map(u => `
      <tr class="${u.active ? '' : 'inactive'}">
        <td>${escapeHtml(u.username)}</td>
        <td><span class="role-chip role-${u.role}">${u.role === 'viewer' ? 'read only' : u.role}</span></td>
        <td>${u.active ? 'Active' : 'Deactivated'}</td>
        <td>${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
        <td style="white-space:nowrap;">
          <button class="btn small" onclick="promptResetPassword(${u.id}, '${escapeAttr(u.username).replace(/'/g, '&#39;')}')">Reset password</button>
          <button class="btn small" onclick="toggleUserActive(${u.id}, ${u.active ? 'false' : 'true'})">${u.active ? 'Deactivate' : 'Reactivate'}</button>
        </td>
      </tr>`).join('');
  } catch (e) { return; }
  renderAdminContractors();
}
function renderAdminContractors(){
  const el = document.getElementById('adminContractors');
  el.innerHTML = CONTRACTORS.length
    ? CONTRACTORS.map(n => `<div class="contractor-row"><span>${escapeHtml(n)}</span><button class="btn small danger" data-name="${escapeAttr(n)}" onclick="removeContractorSuggestion(this)">Remove</button></div>`).join('')
    : '<div class="no-comments-hint">No contractors yet — they appear here as ccbs adds them.</div>';
}
async function removeContractorSuggestion(btn){
  const name = btn.dataset.name;
  if (!confirm(`Remove "${name}" from the suggestion list? Snags already tagged with it keep the name.`)) return;
  try {
    const resp = await apiFetch('/api/contractors/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!resp.ok){ const body = await resp.json(); alert(body.error || 'Could not remove.'); return; }
    await refreshDataAndRerender();
    renderAdminContractors();
  } catch (e) { /* handled */ }
}
async function promptResetPassword(userId, username){
  const newPassword = prompt(`New password for "${username}" (min. 8 characters).\nThis signs that account out everywhere.`);
  if (!newPassword) return;
  const msgEl = document.getElementById('adminMsg');
  try {
    const resp = await apiFetch(`/api/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({ password: newPassword }) });
    const body = await resp.json();
    if (!resp.ok){ msgEl.innerHTML = `<div class="inline-msg err">${escapeHtml(body.error || 'Could not reset password.')}</div>`; return; }
    msgEl.innerHTML = `<div class="inline-msg ok">Password reset for "${escapeHtml(username)}".</div>`;
    if (currentUser && username === currentUser.username){
      // Resetting your own password signs you out too.
      clearSession(); currentUser = null; showLoginScreen('Password changed — please sign in again.');
    }
  } catch (e) { /* handled */ }
}
async function toggleUserActive(userId, activate){
  const msgEl = document.getElementById('adminMsg');
  try {
    const resp = await apiFetch(`/api/users/${userId}/${activate ? 'activate' : 'deactivate'}`, { method: 'POST' });
    const body = await resp.json();
    if (!resp.ok){ msgEl.innerHTML = `<div class="inline-msg err">${escapeHtml(body.error || 'Could not update account.')}</div>`; return; }
    await loadAndRenderAdmin();
  } catch (e) { /* handled */ }
}
async function createUser(){
  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const msgEl = document.getElementById('createUserMsg');
  msgEl.textContent = ''; msgEl.className = 'inline-msg';
  try {
    const resp = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
    const body = await resp.json();
    if (!resp.ok){ msgEl.textContent = body.error || 'Could not create account.'; msgEl.className = 'inline-msg err'; return; }
    msgEl.textContent = `Account "${username}" created.`; msgEl.className = 'inline-msg ok';
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    await loadAndRenderAdmin();
  } catch (e) { /* handled */ }
}

/* ============================================================
   PHOTO LIGHTBOX
   ============================================================ */
function openPhotoLightbox(url){
  document.getElementById('photoLightboxImg').src = url;
  document.getElementById('photoLightbox').classList.add('show');
}

/* ============================================================
   PIN LIGHTBOX — same layout-safe pattern as the app (measure the
   container AFTER it's actually visible, not before)
   ============================================================ */
const PIN_IMG_W = 1500, PIN_IMG_H = 1059;
let pinLightboxState = null;

function waitForLayout(el, maxFrames){
  maxFrames = maxFrames || 15;
  return new Promise((resolve) => {
    function check(n){
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || n >= maxFrames) resolve(rect);
      else requestAnimationFrame(() => check(n + 1));
    }
    check(0);
  });
}
function applyZoomBackground(el, floorCode, cxPct, cyPct, containerW, containerH, zoom){
  const scaledW = containerW * zoom, scaledH = containerH * zoom;
  let targetX = (cxPct / 100) * scaledW, targetY = (cyPct / 100) * scaledH;
  targetX = Math.min(Math.max(targetX, containerW / 2), scaledW - containerW / 2);
  targetY = Math.min(Math.max(targetY, containerH / 2), scaledH - containerH / 2);
  const posX = containerW / 2 - targetX, posY = containerH / 2 - targetY;
  const imgFile = floorCode === '1F' ? 'ff' : floorCode === '2F' ? 'sf' : 'gf';
  el.style.backgroundImage = `url(plans/${imgFile}.jpg)`;
  el.style.backgroundSize = `${scaledW}px ${scaledH}px`;
  el.style.backgroundPosition = `${posX}px ${posY}px`;
  return { scaledW, scaledH, posX, posY };
}
function buildMiniPinStyle(floorCode, roomCode, x, y){
  const containerW = 96, containerH = 68;
  const zoom = getZoomFactor(floorCode, roomCode);
  const scaledW = PIN_IMG_W * zoom, scaledH = PIN_IMG_H * zoom;
  let targetX = (x / 100) * scaledW, targetY = (y / 100) * scaledH;
  targetX = Math.min(Math.max(targetX, containerW / 2), scaledW - containerW / 2);
  targetY = Math.min(Math.max(targetY, containerH / 2), scaledH - containerH / 2);
  const posX = containerW / 2 - targetX, posY = containerH / 2 - targetY;
  const markerLeft = (x / 100) * scaledW + posX, markerTop = (y / 100) * scaledH + posY;
  const imgFile = floorCode === '1F' ? 'ff' : floorCode === '2F' ? 'sf' : 'gf';
  const bg = `background-image:url(plans/${imgFile}.jpg);background-size:${scaledW}px ${scaledH}px;background-position:${posX}px ${posY}px;`;
  return { bg, markerLeft, markerTop };
}
async function openPinLightbox(tag){
  const s = SNAGS.find(x => x.tag === tag);
  if (!s || !s.pins || !s.pins.length) return;
  const overlay = document.getElementById('pinLightbox');
  const plan = document.getElementById('pinLightboxPlan');
  overlay.classList.add('show');
  const coords = PIN_COORDS[s.floorCode] || [];
  const entry = coords.find(c => c[0] === s.roomCode);
  const centerX = entry ? entry[1] : 50, centerY = entry ? entry[2] : 50;
  pinLightboxState = { floorCode: s.floorCode, centerX, centerY, pins: s.pins };
  const slider = document.getElementById('pinZoomSlider');
  slider.value = 1;
  document.getElementById('pinZoomValue').textContent = '1.0x';
  await renderPinLightboxZoom();
}
async function renderPinLightboxZoom(){
  if (!pinLightboxState) return;
  const plan = document.getElementById('pinLightboxPlan');
  const zoom = parseFloat(document.getElementById('pinZoomSlider').value) || 1;
  const rect = await waitForLayout(plan);
  const containerW = rect.width || 320;
  const containerH = rect.height || Math.round(containerW * PIN_IMG_H / PIN_IMG_W);
  const { scaledW, scaledH, posX, posY } = applyZoomBackground(plan, pinLightboxState.floorCode, pinLightboxState.centerX, pinLightboxState.centerY, containerW, containerH, zoom);
  plan.querySelectorAll('.marker').forEach(m => m.remove());
  pinLightboxState.pins.forEach(pin => {
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.style.left = ((pin.x / 100) * scaledW + posX) + 'px';
    marker.style.top = ((pin.y / 100) * scaledH + posY) + 'px';
    plan.appendChild(marker);
  });
}
function onPinZoomChange(){
  document.getElementById('pinZoomValue').textContent = parseFloat(document.getElementById('pinZoomSlider').value).toFixed(1) + 'x';
  renderPinLightboxZoom();
}

/* ============================================================
   FLOOR PLAN EXPLORER — the new default view. Pick a floor, pick a
   room, see every snag in that room plotted on the plan, drag-select
   or tap pins to build a working list, click into one for full detail.
   ============================================================ */
let explorerFloor = null;
let explorerRoom = null;
let selectedTags = new Set();
let activeTag = null;
let explorerZoom = 1.5;
let explorerPinPositions = []; // [{tag, left, top, el}] in wrap-relative px, refreshed each render
let fullListExpanded = false;

function setMainView(view){
  document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-explore').classList.toggle('active', view === 'explore');
  document.getElementById('view-list').classList.toggle('active', view === 'list');
  document.getElementById('view-admin').classList.toggle('active', view === 'admin');
  if (view === 'list') renderGroups();
  if (view === 'admin' && isAdmin()) loadAndRenderAdmin();
}

function renderFloorButtons(){
  const el = document.getElementById('floorButtons');
  el.innerHTML = FLOORS.filter(f => f.code !== 'WH').map(f => {
    const count = SNAGS.filter(s => s.floorCode === f.code).length;
    return `<button class="pill-btn ${explorerFloor === f.code ? 'active' : ''} ${count === 0 ? 'empty' : ''}" onclick="selectExplorerFloor('${f.code}')">${f.name} <span class="pill-count">${count}</span></button>`;
  }).join('');
}
function selectExplorerFloor(floorCode){
  explorerFloor = floorCode;
  explorerRoom = null;
  selectedTags = new Set();
  activeTag = null;
  renderFloorButtons();
  renderRoomButtons();
  document.getElementById('roomExplorerArea').style.display = 'none';
}
function renderRoomButtons(){
  const el = document.getElementById('roomButtons');
  const floor = FLOORS.find(f => f.code === explorerFloor);
  el.innerHTML = floor.rooms.map(([code, name]) => {
    const count = SNAGS.filter(s => s.floorCode === explorerFloor && s.roomCode === code).length;
    return `<button class="pill-btn ${explorerRoom === code ? 'active' : ''} ${count === 0 ? 'empty' : ''}" onclick="selectExplorerRoom('${code}')">${name} <span class="pill-count">${count}</span></button>`;
  }).join('');
}
async function selectExplorerRoom(roomCode){
  explorerRoom = roomCode;
  selectedTags = new Set();
  activeTag = null;
  fullListExpanded = false;
  renderRoomButtons();
  document.getElementById('roomExplorerArea').style.display = 'block';
  const zoom = getZoomFactor(explorerFloor, roomCode);
  explorerZoom = zoom;
  document.getElementById('explorerZoomSlider').value = zoom;
  document.getElementById('explorerZoomValue').textContent = zoom.toFixed(1) + 'x';
  document.getElementById('fullRoomListBody').style.display = 'none';
  document.getElementById('fullListCaret').textContent = '▶';
  await renderExplorerPlan();
  renderSelectedList();
  renderActiveDetail();
  renderFullRoomList();
}

async function renderExplorerPlan(){
  const wrap = document.getElementById('explorerPlanWrap');
  const coords = PIN_COORDS[explorerFloor] || [];
  const entry = coords.find(c => c[0] === explorerRoom);
  const centerX = entry ? entry[1] : 50, centerY = entry ? entry[2] : 50;
  const rect = await waitForLayout(wrap);
  const containerW = rect.width || 320;
  const containerH = rect.height || Math.round(containerW * PIN_IMG_H / PIN_IMG_W);
  const { scaledW, scaledH, posX, posY } = applyZoomBackground(wrap, explorerFloor, centerX, centerY, containerW, containerH, explorerZoom);

  wrap.querySelectorAll('.explorer-pin').forEach(p => p.remove());
  if (!document.getElementById('selectionBoxEl')){
    const box = document.createElement('div');
    box.className = 'selection-box';
    box.id = 'selectionBoxEl';
    wrap.appendChild(box);
  }

  const roomSnags = SNAGS.filter(s => s.floorCode === explorerFloor && s.roomCode === explorerRoom && s.pins && s.pins.length);
  explorerPinPositions = [];
  roomSnags.forEach(s => {
    s.pins.forEach(pin => {
      const left = (pin.x / 100) * scaledW + posX;
      const top = (pin.y / 100) * scaledH + posY;
      const marker = document.createElement('div');
      marker.className = 'explorer-pin sev-' + s.severity;
      marker.style.left = left + 'px';
      marker.style.top = top + 'px';
      marker.title = s.tag + ': ' + s.description;
      marker.addEventListener('click', (e) => { e.stopPropagation(); onPinClick(s.tag); });
      wrap.appendChild(marker);
      explorerPinPositions.push({ tag: s.tag, left, top, el: marker });
    });
  });
  applyPinStates();
}
function applyPinStates(){
  explorerPinPositions.forEach(p => {
    p.el.classList.remove('pin-selected', 'pin-active', 'pin-muted');
    if (activeTag){
      p.el.classList.add(p.tag === activeTag ? 'pin-active' : 'pin-muted');
    } else if (selectedTags.has(p.tag)){
      p.el.classList.add('pin-selected');
    }
  });
}
function onPinClick(tag){
  // Replaces the current selection rather than adding to it — tapping a
  // single pin shows just that one, consistent with drag-select doing the
  // same (see the pointerup handler below).
  selectedTags = new Set([tag]);
  activeTag = tag;
  applyPinStates();
  renderSelectedList();
  renderActiveDetail();
}
function onExplorerZoomChange(){
  explorerZoom = parseFloat(document.getElementById('explorerZoomSlider').value);
  document.getElementById('explorerZoomValue').textContent = explorerZoom.toFixed(1) + 'x';
  renderExplorerPlan();
}

/* Drag-select — bound once to the plan container, not re-bound on every
   render (the container element itself is fixed in the page; only its
   pins are rebuilt per room). */
function setupDragSelect(){
  const wrap = document.getElementById('explorerPlanWrap');
  let startX, startY, dragging = false, moved = false;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('explorer-pin')) return; // the pin's own click handler deals with this
    const rect = wrap.getBoundingClientRect();
    startX = e.clientX - rect.left; startY = e.clientY - rect.top;
    dragging = true; moved = false;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* not supported everywhere — drag-select still works fine without it */ }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = wrap.getBoundingClientRect();
    const curX = e.clientX - rect.left, curY = e.clientY - rect.top;
    if (Math.abs(curX - startX) > 4 || Math.abs(curY - startY) > 4) moved = true;
    if (!moved) return;
    const box = document.getElementById('selectionBoxEl');
    if (!box) return;
    const x1 = Math.min(startX, curX), y1 = Math.min(startY, curY);
    const x2 = Math.max(startX, curX), y2 = Math.max(startY, curY);
    box.style.display = 'block';
    box.style.left = x1 + 'px'; box.style.top = y1 + 'px';
    box.style.width = (x2 - x1) + 'px'; box.style.height = (y2 - y1) + 'px';
  });
  wrap.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const box = document.getElementById('selectionBoxEl');
    if (moved && box){
      const bx1 = parseFloat(box.style.left), by1 = parseFloat(box.style.top);
      const bx2 = bx1 + parseFloat(box.style.width), by2 = by1 + parseFloat(box.style.height);
      // Replaces the current selection with exactly what's in this drag —
      // previously this added to whatever was already selected, so
      // repeated drags kept accumulating instead of each one standing on
      // its own.
      selectedTags = new Set();
      explorerPinPositions.forEach(p => {
        if (p.left >= bx1 && p.left <= bx2 && p.top >= by1 && p.top <= by2) selectedTags.add(p.tag);
      });
      activeTag = null; // a drag-select builds the list; it doesn't jump into one snag's detail on its own
      applyPinStates();
      renderSelectedList();
      renderActiveDetail();
    } else if (!moved){
      // a plain tap on empty plan (not a pin, not a drag) clears the active detail
      activeTag = null;
      applyPinStates();
      renderActiveDetail();
    }
    if (box){ box.style.display = 'none'; box.style.width = '0'; box.style.height = '0'; }
  });
}

function renderSelectedList(){
  const el = document.getElementById('selectedSnagsList');
  document.getElementById('selCount').textContent = selectedTags.size;
  if (selectedTags.size === 0){
    el.innerHTML = '<div class="empty-hint">Tap or drag-select pins on the plan to list them here.</div>';
    return;
  }
  const items = [...selectedTags].map(tag => SNAGS.find(s => s.tag === tag)).filter(Boolean);
  el.innerHTML = items.map(s => `
    <div class="selected-snag-item ${activeTag === s.tag ? 'active' : ''}" onclick="onSelectedItemClick('${s.tag}')">
      <span class="tag-code">${s.tag}</span>
      <span class="badge sev-${s.severity}">${s.severity}</span> <span class="badge ${statusClass(s.status)}">${s.status}</span>
      <div style="margin-top:4px;">${escapeHtml(s.description).slice(0, 70)}</div>
    </div>
  `).join('');
}
function onSelectedItemClick(tag){
  activeTag = tag;
  applyPinStates();
  renderSelectedList();
  renderActiveDetail();
}
function clearSelection(){
  selectedTags = new Set();
  activeTag = null;
  applyPinStates();
  renderSelectedList();
  renderActiveDetail();
}
function renderActiveDetail(){
  const el = document.getElementById('activeSnagDetail');
  if (!activeTag){ el.innerHTML = ''; return; }
  const s = SNAGS.find(x => x.tag === activeTag);
  el.innerHTML = s ? `<div class="active-detail-box">${snagCardHtml(s)}</div>` : '';
}

function toggleFullRoomList(){
  fullListExpanded = !fullListExpanded;
  document.getElementById('fullRoomListBody').style.display = fullListExpanded ? 'block' : 'none';
  document.getElementById('fullListCaret').textContent = fullListExpanded ? '▼' : '▶';
}
function renderFullRoomList(){
  const items = SNAGS.filter(s => s.floorCode === explorerFloor && s.roomCode === explorerRoom);
  document.getElementById('fullListCount').textContent = items.length;
  document.getElementById('fullRoomListBody').innerHTML = items.map(snagCardHtml).join('');
}

/* Lands the page fully populated on first load — floor plan, Selected
   Snags list, and the detail panel all showing something real — rather
   than requiring a floor and room click before anything's visible.
   Picks the first floor that has any snags, then within it the room
   with the most snags (the most informative place to land), selects
   every snag in that room, and shows the first one's detail. */
async function autoSelectDefaultRoom(){
  const floor = FLOORS.find(f => f.code !== 'WH' && SNAGS.some(s => s.floorCode === f.code));
  if (!floor) return;
  let bestRoom = null, bestCount = 0;
  floor.rooms.forEach(([code]) => {
    const count = SNAGS.filter(s => s.floorCode === floor.code && s.roomCode === code).length;
    if (count > bestCount){ bestCount = count; bestRoom = code; }
  });
  if (!bestRoom) return;
  selectExplorerFloor(floor.code);
  await selectExplorerRoom(bestRoom);
  const roomSnags = SNAGS.filter(s => s.floorCode === floor.code && s.roomCode === bestRoom);
  roomSnags.forEach(s => selectedTags.add(s.tag));
  if (roomSnags.length) activeTag = roomSnags[0].tag;
  applyPinStates();
  renderSelectedList();
  renderActiveDetail();
}

function printRoom(){
  const items = SNAGS.filter(s => s.floorCode === explorerFloor && s.roomCode === explorerRoom);
  const label = roomName(explorerFloor, explorerRoom) + ' — ' + floorName(explorerFloor);
  document.getElementById('printArea').innerHTML = `
    <h1 style="font-family:'Space Grotesk',sans-serif;">Site Snag Report — ${escapeHtml(label)}</h1>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;margin-bottom:16px;">Generated ${new Date().toLocaleString('en-GB')} · ${items.length} item(s)</div>
    ${items.map(s => `
      <div class="print-item">
        <div style="font-family:'IBM Plex Mono',monospace;font-weight:600;">${s.tag} — ${s.severity} — ${s.status}</div>
        <div style="font-weight:600;margin-top:2px;">${escapeHtml(s.trade)}${s.contractor ? ' · Contractor: ' + escapeHtml(s.contractor) : ''}${s.location ? ' · ' + escapeHtml(s.location) : ''}</div>
        <div style="margin-top:4px;">${escapeHtml(s.description)}</div>
        ${s.comments ? `<div style="margin-top:2px;font-style:italic;color:#555;">${escapeHtml(s.comments)}</div>` : ''}
        ${(s.thumbFiles && s.thumbFiles.length) ? `<div style="margin-top:6px;">${s.thumbFiles.map(f => `<img src="${PHOTO_BASE_URL + f}">`).join('')}</div>` : ''}
      </div>
    `).join('')}
  `;
  window.print();
}

/* ============================================================
   EXCEL EXPORT — builds a real .xlsx (via the bundled SheetJS
   library, xlsx.full.min.js) with one row per snag, no photos.
   ============================================================ */
const EXPORT_COLUMNS = [
  ['Tag', s => s.tag],
  ['Floor', s => s.floorName],
  ['Room', s => s.roomName],
  ['Trade', s => s.trade],
  ['Contractor', s => s.contractor || ''],
  ['Severity', s => s.severity],
  ['Status', s => s.status],
  ['Location', s => s.location || ''],
  ['Description', s => s.description || ''],
  ['Original note', s => s.comments || ''],
  ['Builder comments', s => (COMMENTS_BY_TAG[s.tag] || []).map(c => `${c.username} (${new Date(c.createdAt).toLocaleDateString('en-GB')}): ${c.body}`).join('\n')],
  ['Original trade (if changed)', s => s.trade !== s.originalTrade ? s.originalTrade : ''],
  ['Original status (if changed)', s => s.status !== s.originalStatus ? s.originalStatus : ''],
  ['Photo count', s => (s.photoFiles && s.photoFiles.length) || (s.thumbFiles && s.thumbFiles.length) || 0],
  ['Logged', s => s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB') : ''],
  ['Last updated', s => s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-GB') : '']
];

function sortSnagsForExport(items){
  const floorOrder = FLOORS.map(f => f.code);
  const roomOrderByFloor = {};
  FLOORS.forEach(f => { roomOrderByFloor[f.code] = f.rooms.map(r => r[0]); });
  return [...items].sort((a, b) => {
    const fa = floorOrder.indexOf(a.floorCode), fb = floorOrder.indexOf(b.floorCode);
    if (fa !== fb) return fa - fb;
    const ra = (roomOrderByFloor[a.floorCode] || []).indexOf(a.roomCode);
    const rb = (roomOrderByFloor[b.floorCode] || []).indexOf(b.roomCode);
    if (ra !== rb) return ra - rb;
    return a.tag.localeCompare(b.tag);
  });
}

function buildWorksheetRows(items){
  const sorted = sortSnagsForExport(items);
  return sorted.map(s => {
    const row = {};
    EXPORT_COLUMNS.forEach(([label, getter]) => { row[label] = getter(s); });
    return row;
  });
}

function downloadSnagsAsExcel(items, filename){
  const rows = buildWorksheetRows(items);
  const ws = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS.map(c => c[0]) });
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 26 }, { wch: 22 }, { wch: 10 }, { wch: 16 },
    { wch: 28 }, { wch: 44 }, { wch: 34 }, { wch: 44 }, { wch: 26 }, { wch: 26 }, { wch: 11 }, { wch: 12 }, { wch: 12 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Snags');
  XLSX.writeFile(wb, filename);
}

function populateExportDropdowns(){
  const roomSelect = document.getElementById('exportRoomSelect');
  const roomOptions = [];
  FLOORS.forEach(f => {
    f.rooms.forEach(([code, name]) => {
      const count = SNAGS.filter(s => s.floorCode === f.code && s.roomCode === code).length;
      if (count > 0) roomOptions.push(`<option value="${f.code}|${code}">${escapeHtml(name)} — ${escapeHtml(f.name)} (${count})</option>`);
    });
  });
  roomSelect.innerHTML = roomOptions.join('');

  const contractorSelect = document.getElementById('exportContractorSelect');
  contractorSelect.innerHTML = CONTRACTORS.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)} (${SNAGS.filter(s => s.contractor === n).length})</option>`).join('')
    + `<option value="__none__">(no contractor assigned) (${SNAGS.filter(s => !s.contractor).length})</option>`;

  const tradeSelect = document.getElementById('exportTradeSelect');
  tradeSelect.innerHTML = TRADES.map(t => {
    const count = SNAGS.filter(s => s.trade === t).length;
    return `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${count})</option>`;
  }).join('');
}

function currentExportScope(){
  const el = document.querySelector('input[name="exportScope"]:checked');
  return el ? el.value : 'all';
}

function getExportItems(){
  const scope = currentExportScope();
  if (scope === 'all') return SNAGS;
  if (scope === 'filtered') return filteredSnags();
  if (scope === 'selected') return [...selectedTags].map(tag => SNAGS.find(s => s.tag === tag)).filter(Boolean);
  if (scope === 'room'){
    const val = document.getElementById('exportRoomSelect').value;
    if (!val) return [];
    const [floorCode, roomCode] = val.split('|');
    return SNAGS.filter(s => s.floorCode === floorCode && s.roomCode === roomCode);
  }
  if (scope === 'trade'){
    const trade = document.getElementById('exportTradeSelect').value;
    if (!trade) return [];
    return SNAGS.filter(s => s.trade === trade);
  }
  if (scope === 'contractor'){
    const c = document.getElementById('exportContractorSelect').value;
    if (!c) return [];
    return c === '__none__' ? SNAGS.filter(s => !s.contractor) : SNAGS.filter(s => s.contractor === c);
  }
  return [];
}

function exportFilenameForScope(){
  const scope = currentExportScope();
  const stamp = new Date().toISOString().slice(0, 10);
  if (scope === 'all') return `snags-all-${stamp}.xlsx`;
  if (scope === 'filtered') return `snags-filtered-${stamp}.xlsx`;
  if (scope === 'selected') return `snags-selected-${stamp}.xlsx`;
  if (scope === 'room'){
    const val = document.getElementById('exportRoomSelect').value;
    const roomCode = (val || '').split('|')[1] || 'room';
    return `snags-room-${roomCode}-${stamp}.xlsx`;
  }
  if (scope === 'trade'){
    const trade = document.getElementById('exportTradeSelect').value || 'trade';
    const safe = trade.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    return `snags-trade-${safe}-${stamp}.xlsx`;
  }
  if (scope === 'contractor'){
    const c = document.getElementById('exportContractorSelect').value || 'contractor';
    const safe = (c === '__none__' ? 'unassigned' : c).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    return `snags-contractor-${safe}-${stamp}.xlsx`;
  }
  return `snags-export-${stamp}.xlsx`;
}

function updateExportCountLine(){
  const items = getExportItems();
  const el = document.getElementById('exportCountLine');
  el.textContent = items.length === 1 ? '1 snag will be exported' : `${items.length} snags will be exported`;
}

function onExportScopeChange(){
  const scope = currentExportScope();
  document.getElementById('exportRoomSelect').disabled = scope !== 'room';
  document.getElementById('exportTradeSelect').disabled = scope !== 'trade';
  document.getElementById('exportContractorSelect').disabled = scope !== 'contractor';
  updateExportCountLine();
}
function onExportSubSelectChange(){
  updateExportCountLine();
}

function openExportModal(){
  populateExportDropdowns();

  const hasSelection = selectedTags && selectedTags.size > 0;
  document.getElementById('exportSelectedOption').style.display = hasSelection ? 'block' : 'none';
  document.getElementById('exportSelectedCount').textContent = selectedTags ? selectedTags.size : 0;

  const filterStatus = document.getElementById('fStatus').value;
  const filterSearch = document.getElementById('fSearch').value.trim();
  const hint = document.getElementById('exportFilteredHint');
  if (filterStatus || filterSearch){
    const parts = [];
    if (filterStatus) parts.push(`status: ${filterStatus}`);
    if (filterSearch) parts.push(`search: "${filterSearch}"`);
    hint.textContent = `Active filters — ${parts.join(', ')}`;
  } else {
    hint.textContent = 'No search/status filter currently active — same as "All snags"';
  }

  // Default to a sensible starting choice: the current selection if there
  // is one, otherwise "all".
  const defaultScope = hasSelection ? 'selected' : 'all';
  document.querySelectorAll('input[name="exportScope"]').forEach(r => { r.checked = (r.value === defaultScope); });
  onExportScopeChange();

  document.getElementById('exportModal').classList.add('show');
}

function runExcelExport(){
  const items = getExportItems();
  if (items.length === 0){
    alert('Nothing to export for this selection — pick a different option.');
    return;
  }
  downloadSnagsAsExcel(items, exportFilenameForScope());
  document.getElementById('exportModal').classList.remove('show');
}

/* ============================================================
   INIT — gated behind login. bootApp() runs once a session is confirmed
   (a still-valid stored token on page load, or a successful doLogin()),
   fetches the live data, then runs the render pipeline.
   ============================================================ */
let dragSelectBound = false, activeButtonStyleAdded = false;
async function initRenderPipeline(){
  // Each step is isolated so one failing can't stop the others; errors
  // are logged to the browser console rather than swallowed.
  function safe(label, fn){ try { fn(); } catch (e) { console.error('Init step failed: ' + label, e); } }
  // A second login in the same page must start from a clean slate.
  explorerFloor = null; explorerRoom = null; selectedTags = new Set(); activeTag = null; expandedGroups = new Set();
  document.getElementById('roomExplorerArea').style.display = 'none';
  safe('render stats', renderStats);
  safe('render floor buttons', renderFloorButtons);
  safe('set up drag-select', () => { if (!dragSelectBound){ setupDragSelect(); dragSelectBound = true; } });
  try { await autoSelectDefaultRoom(); } catch (e) { console.error('Init step failed: auto-select a default room', e); }
  safe('mark active group button', () => {
    document.querySelectorAll('[data-group]').forEach(b => b.classList.toggle('btn-active', b.dataset.group === groupBy));
  });
  safe('inject active-button style', () => {
    if (activeButtonStyleAdded) return;
    const style = document.createElement('style');
    style.textContent = '.btn-active{background:var(--ink);color:#fff;border-color:var(--ink);}';
    document.head.appendChild(style);
    activeButtonStyleAdded = true;
  });
  safe('expand all groups', expandAll);
  safe('render group list', renderGroups);
}

async function bootApp(){
  showMainApp();
  try {
    await loadAppData();
  } catch (e) {
    // On a 401 apiFetch already showed the login screen again; any other
    // problem (network, server down) gets a visible message, not a blank page.
    if (e.message !== 'Session expired'){
      document.getElementById('groupsContainer').innerHTML = `<div class="empty-state">Could not load the snag list — check your connection and reload. (${escapeHtml(e.message || String(e))})</div>`;
    }
    return;
  }
  await initRenderPipeline();
}

(function boot(){
  const session = getSession();
  if (session && session.token){
    const payload = decodeTokenUnsafe(session.token);
    if (payload && payload.exp && Math.floor(Date.now() / 1000) < payload.exp){
      currentUser = userFromToken(session.token, session.username, session.role);
      bootApp();
      return;
    }
    clearSession();
  }
  showLoginScreen();
})();
