/* ============================================================
   CONFIG — the one thing to change if the R2 bucket URL ever changes
   ============================================================ */
const PHOTO_BASE_URL = 'https://pub-52ef5d48cdfc41a29a32eb97a46c2221.r2.dev/';

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
      const hay = [s.tag, s.floorName, s.roomName, s.trade, s.severity, s.status, s.location, s.description, s.comments]
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
        <div><span class="tag-code">${s.tag}</span> <span class="badge sev-${s.severity}">${s.severity}</span></div>
        <span class="badge ${statusClass(s.status)}">${s.status}</span>
      </div>
      <div class="card-loc"><b>${s.roomName}</b> · ${s.floorName} · ${s.trade}${s.location ? ' · ' + escapeHtml(s.location) : ''}</div>
      <div class="card-desc">${escapeHtml(s.description)}</div>
      ${s.comments ? `<div class="card-comments">${escapeHtml(s.comments)}</div>` : ''}
      <div class="card-media">${pinHtml}${photoHtml}</div>
      <div class="card-date">logged ${new Date(s.createdAt).toLocaleDateString('en-GB')}</div>
    </div>`;
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
  if (view === 'list') renderGroups();
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
  selectedTags.add(tag);
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

function printRoom(){
  const items = SNAGS.filter(s => s.floorCode === explorerFloor && s.roomCode === explorerRoom);
  const label = roomName(explorerFloor, explorerRoom) + ' — ' + floorName(explorerFloor);
  document.getElementById('printArea').innerHTML = `
    <h1 style="font-family:'Space Grotesk',sans-serif;">Site Snag Report — ${escapeHtml(label)}</h1>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;margin-bottom:16px;">Generated ${new Date().toLocaleString('en-GB')} · ${items.length} item(s)</div>
    ${items.map(s => `
      <div class="print-item">
        <div style="font-family:'IBM Plex Mono',monospace;font-weight:600;">${s.tag} — ${s.severity} — ${s.status}</div>
        <div style="font-weight:600;margin-top:2px;">${escapeHtml(s.trade)}${s.location ? ' · ' + escapeHtml(s.location) : ''}</div>
        <div style="margin-top:4px;">${escapeHtml(s.description)}</div>
        ${s.comments ? `<div style="margin-top:2px;font-style:italic;color:#555;">${escapeHtml(s.comments)}</div>` : ''}
        ${(s.thumbFiles && s.thumbFiles.length) ? `<div style="margin-top:6px;">${s.thumbFiles.map(f => `<img src="${PHOTO_BASE_URL + f}">`).join('')}</div>` : ''}
      </div>
    `).join('')}
  `;
  window.print();
}

/* ============================================================
   INIT
   ============================================================ */
(function init(){
  // Each step runs independently, in priority order — the default view
  // (Floor Plan Explorer) is set up FIRST and wrapped so a problem
  // anywhere else can't silently prevent it from appearing, which is
  // exactly what would happen if one long init() ran top-to-bottom and
  // stopped partway. Errors are logged, not swallowed silently, so a
  // real problem is visible in the browser console rather than invisible.
  function safe(label, fn){
    try { fn(); } catch (e) { console.error('Init step failed: ' + label, e); }
  }
  safe('render stats', renderStats);
  safe('render floor buttons', renderFloorButtons);
  safe('set up drag-select', setupDragSelect);
  safe('mark active group button', () => document.querySelector('[data-group="room"]').classList.add('btn-active'));
  safe('inject active-button style', () => {
    const style = document.createElement('style');
    style.textContent = '.btn-active{background:var(--ink);color:#fff;border-color:var(--ink);}';
    document.head.appendChild(style);
  });
  safe('expand all groups', expandAll); // a builder opening the list view should see everything, not collapsed headers
  safe('render group list', renderGroups);
})();
