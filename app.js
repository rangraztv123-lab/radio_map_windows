// ---- Helpers ----
const $ = (id) => document.getElementById(id);
const api = async (url, opts={}) => {
  const res = await fetch(url, {headers:{'Content-Type':'application/json'}, ...opts});
  if(!res.ok) throw new Error(await res.text());
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
}
const escapeHtml = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

// ---- State ----
let PROJECTS = [];
let currentProject = null;
let DATA = [];
let activeTags = [];
let useAnd = false;
let showUsedOnly = false;

let tempTags = [];   // new-item temp tags
let ALL_TAGS = [];   // autocomplete dictionary

// ---- Elements ----
const elProject = $('projectSelect');
const elProjectNew = $('projectNew');
const elProjectRename = $('projectRename');
const elProjectDelete = $('projectDelete');

const elSearch = $('search');
const elResults = $('results');
const elSuggestions = $('suggestions');
const elActiveChips = $('activeChips');
const elLogic = $('toggleLogic');
const elLogicLabel = $('logicLabel');
const elStats = $('stats');
const elTotal = $('totalCount');
const addFile = $('addFile');
const addTags = $('addTags');
const addDesc = $('addDesc');
const addBtn = $('addBtn');
const addMsg = $('addMsg');
const exportCsvBtn = $('exportCsv');
const importCsv = $('importCsv');
const showUsedBtn = $('showUsedBtn');

const elAddTagChips = () => $('addTagChips');
const elAddTagHints = () => $('addTagHints');

const Workspace = (() => {
  const WIDTH_KEY = 'workspace:width';
  const COLLAPSE_KEY = 'workspace:collapsed';
  const ITEMS_KEY_PREFIX = 'workspace:items:';
  const DEFAULT_WIDTH = 360;
  const MIN_WIDTH = 260;
  const MAX_WIDTH = 640;

  let drawer;
  let resizer;
  let list;
  let collapseBtn;
  let clearBtn;
  let confirmWrap;
  let confirmYes;
  let confirmNo;
  let toggleTab;
  let content;

  let currentWidth = DEFAULT_WIDTH;
  let collapsed = false;
  let initialized = false;
  let projectKey = '__default__';
  let items = [];

  function init(){
    drawer = document.getElementById('workspaceDrawer');
    if (!drawer) return;
    resizer = document.getElementById('workspaceResizer');
    list = document.getElementById('workspaceItems');
    collapseBtn = document.getElementById('workspaceCollapse');
    clearBtn = document.getElementById('workspaceClear');
    confirmWrap = document.getElementById('workspaceClearConfirm');
    confirmYes = document.getElementById('workspaceConfirmYes');
    confirmNo = document.getElementById('workspaceConfirmNo');
    toggleTab = document.getElementById('wsToggleTab');
    content = document.getElementById('workspaceContent');

    document.body.classList.add('ws-ready');

    currentWidth = readStoredWidth();
    applyWidth(currentWidth, false);
    applyCollapsed(readStoredCollapsed(), false);

    items = readStoredItems();
    renderWorkspaceItems();

    collapseBtn?.addEventListener('click', () => setCollapsed(!collapsed, true));
    toggleTab?.addEventListener('click', () => setCollapsed(false, true));

    clearBtn?.addEventListener('click', showClearConfirm);
    confirmYes?.addEventListener('click', () => {
      items = [];
      persistItems();
      renderWorkspaceItems();
      hideClearConfirm();
    });
    confirmNo?.addEventListener('click', hideClearConfirm);

    if (resizer){
      resizer.addEventListener('mousedown', startResize);
      resizer.addEventListener('touchstart', startResize, {passive:false});
    }
    window.addEventListener('resize', handleResize);

    setupDropZone();

    initialized = true;
    refreshWorkspaceView();
  }

  function clampWidth(px){
    const maxAllowed = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 120));
    return Math.min(Math.max(px, MIN_WIDTH), maxAllowed);
  }

  function readStoredWidth(){
    const stored = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(stored)){
      return clampWidth(stored);
    }
    return DEFAULT_WIDTH;
  }

  function saveStoredWidth(){
    localStorage.setItem(WIDTH_KEY, String(Math.round(currentWidth)));
  }

  function readStoredCollapsed(){
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored === null){
      return window.innerWidth <= 1024;
    }
    return stored === 'true';
  }

  function saveStoredCollapsed(){
    localStorage.setItem(COLLAPSE_KEY, collapsed ? 'true' : 'false');
  }

  function readStoredItems(){
    const key = ITEMS_KEY_PREFIX + projectKey;
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(err){
      return [];
    }
  }

  function persistItems(){
    const key = ITEMS_KEY_PREFIX + projectKey;
    localStorage.setItem(key, JSON.stringify(items));
  }

  function applyWidth(width, persist=true){
    currentWidth = clampWidth(width);
    document.body.style.setProperty('--ws-width', `${currentWidth}px`);
    if (drawer){
      drawer.style.width = `${currentWidth}px`;
    }
    if (!collapsed){
      document.body.classList.add('ws-open');
    }
    if (persist){
      saveStoredWidth();
    }
  }

  function applyCollapsed(state, persist=true){
    collapsed = !!state;
    document.body.classList.toggle('ws-collapsed', collapsed);
    document.body.classList.toggle('ws-open', !collapsed);
    drawer?.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (collapseBtn){
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseBtn.textContent = collapsed ? '⮜' : '⮞';
      const label = collapsed ? 'باز کردن میز کار' : 'جمع کردن میز کار';
      collapseBtn.setAttribute('aria-label', label);
      collapseBtn.title = label;
    }
    if (toggleTab){
      toggleTab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const icon = toggleTab.querySelector('span');
      if (icon){
        icon.textContent = collapsed ? '⮜' : '⮞';
      }
      toggleTab.title = collapsed ? 'باز کردن میز کار' : 'جمع کردن میز کار';
    }
    if (persist){
      saveStoredCollapsed();
    }
  }

  function setCollapsed(state, persist=true){
    if (state === collapsed) return;
    applyCollapsed(state, persist);
  }

  function startResize(ev){
    if (collapsed) return;
    const startX = getClientX(ev);
    if (startX == null) return;
    ev.preventDefault();
    document.body.classList.add('ws-dragging');
    const startWidth = currentWidth;

    const move = (event)=>{
      const point = getClientX(event);
      if (point == null) return;
      if (event.type === 'touchmove'){ event.preventDefault(); }
      const delta = startX - point;
      applyWidth(startWidth + delta, false);
    };

    const stop = ()=>{
      document.body.classList.remove('ws-dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('touchend', stop);
      saveStoredWidth();
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, {passive:false});
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
  }

  function getClientX(event){
    if (event.touches && event.touches[0]){
      return event.touches[0].clientX;
    }
    if (event.changedTouches && event.changedTouches[0]){
      return event.changedTouches[0].clientX;
    }
    return event.clientX ?? null;
  }

  function handleResize(){
    const clamped = clampWidth(currentWidth);
    applyWidth(clamped, clamped !== currentWidth);
  }

  function setupDropZone(){
    if (!content) return;
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      content.addEventListener(evt, handleDropEvents);
    });
  }

  function handleDropEvents(ev){
    if (!ev.dataTransfer) return;
    const types = Array.from(ev.dataTransfer.types || []);
    const hasCard = types.includes('text/x-card-id');
    const hasWorkspaceItem = types.includes('text/x-workspace-item');
    if (!hasCard && !hasWorkspaceItem) return;
    if (collapsed){
      setCollapsed(false, true);
    }

    if (ev.type === 'dragenter'){
      ev.preventDefault();
      drawer?.classList.add('ws-drop-ready');
      return;
    }

    if (ev.type === 'dragover'){
      ev.preventDefault();
      if (hasWorkspaceItem){
        ev.dataTransfer.dropEffect = 'move';
        reorderDuringDrag(ev);
      }else{
        ev.dataTransfer.dropEffect = 'copy';
      }
      drawer?.classList.add('ws-drop-active');
      return;
    }

    if (ev.type === 'dragleave'){
      if (!content.contains(ev.relatedTarget)){
        clearDropVisuals();
      }
      return;
    }

    if (ev.type === 'drop'){
      ev.preventDefault();
      clearDropVisuals();
      const workspaceId = ev.dataTransfer.getData('text/x-workspace-item');
      if (workspaceId){
        commitReorder();
        return;
      }
      const cardId = ev.dataTransfer.getData('text/x-card-id');
      if (!cardId) return;
      const insertIndex = determineInsertIndex(ev.clientY);
      addItem(cardId, insertIndex);
    }
  }

  function clearDropVisuals(){
    drawer?.classList.remove('ws-drop-ready');
    drawer?.classList.remove('ws-drop-active');
  }

  function reorderDuringDrag(ev){
    if (!list) return;
    const dragging = list.querySelector('.workspace-item.dragging');
    if (!dragging) return;
    const after = getItemAfter(ev.clientY);
    if (!after){
      list.appendChild(dragging);
    }else{
      list.insertBefore(dragging, after);
    }
  }

  function commitReorder(){
    if (!list) return;
    items = Array.from(list.querySelectorAll('.workspace-item')).map(el => el.dataset.cardId).filter(Boolean);
    persistItems();
  }

  function getItemAfter(y){
    if (!list) return null;
    const items = Array.from(list.querySelectorAll('.workspace-item:not(.dragging)'));
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset){
        return {offset, element: child};
      }
      return closest;
    }, {offset: Number.NEGATIVE_INFINITY, element: null}).element;
  }

  function determineInsertIndex(y){
    if (!list) return items.length;
    const siblings = Array.from(list.querySelectorAll('.workspace-item'));
    if (!siblings.length) return 0;
    const after = getItemAfter(y);
    if (!after) return siblings.length;
    const idx = siblings.indexOf(after);
    return idx < 0 ? siblings.length : idx;
  }

  function showClearConfirm(){
    if (!items.length){
      hideClearConfirm();
      return;
    }
    confirmWrap?.classList.add('show');
    confirmWrap?.setAttribute('aria-hidden', 'false');
  }

  function hideClearConfirm(){
    confirmWrap?.classList.remove('show');
    confirmWrap?.setAttribute('aria-hidden', 'true');
  }

  function renderWorkspaceItems(){
    if (!list) return;
    list.innerHTML = '';
    hideClearConfirm();
    if (!items.length){
      list.innerHTML = '<p class="workspace-empty">برای اضافه کردن کارت، بکش و بنداز اینجا یا روی 📌 کلیک کن</p>';
      return;
    }

    const missing = [];
    items.forEach(id => {
      const data = findItemById(id);
      if (!data){
        missing.push(id);
        return;
      }
      const card = createWorkspaceItem(id, data);
      list.appendChild(card);
    });

    if (missing.length){
      items = items.filter(id => !missing.includes(id));
      if (missing.length){
        persistItems();
      }
      if (!items.length){
        renderWorkspaceItems();
      }
    }
  }

  function createWorkspaceItem(id, item){
    const node = document.createElement('div');
    node.className = 'workspace-item';
    node.draggable = true;
    node.dataset.cardId = id;

    const title = document.createElement('div');
    title.className = 'workspace-item-title';
    title.textContent = item?.file || decodeURIComponentSafe(id);
    node.appendChild(title);

    if (item && Array.isArray(item.tags) && item.tags.length){
      const tags = document.createElement('div');
      tags.className = 'workspace-item-tags';
      item.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tags.appendChild(span);
      });
      node.appendChild(tags);
    }

    const footer = document.createElement('div');
    footer.className = 'workspace-item-footer';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workspace-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeItem(id);
    });
    footer.appendChild(removeBtn);
    node.appendChild(footer);

    node.addEventListener('dragstart', (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/x-workspace-item', id);
      node.classList.add('dragging');
      document.body.classList.add('ws-dragging');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      document.body.classList.remove('ws-dragging');
    });

    return node;
  }

  function decodeURIComponentSafe(val){
    try{
      return decodeURIComponent(val);
    }catch(err){
      return val;
    }
  }

  function removeItem(id){
    const next = items.filter(itemId => itemId !== id);
    if (next.length === items.length) return;
    items = next;
    persistItems();
    renderWorkspaceItems();
  }

  function addItem(id, position){
    if (!id) return;
    if (items.includes(id)){
      highlightExisting(id);
      return;
    }
    if (typeof position === 'number' && position >= 0 && position <= items.length){
      items.splice(position, 0, id);
    }else{
      items.push(id);
    }
    persistItems();
    renderWorkspaceItems();
    highlightExisting(id);
  }

  function highlightExisting(id){
    if (!list) return;
    const selector = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    const node = list.querySelector(`[data-card-id="${selector}"]`);
    if (!node) return;
    node.classList.remove('pulse');
    void node.offsetWidth;
    node.classList.add('pulse');
    node.scrollIntoView({block:'center', behavior:'smooth'});
  }

  function findItemById(id){
    const file = decodeURIComponentSafe(id);
    return (DATA || []).find(item => (item.file || '') === file) || null;
  }

  function ensureCardHandle(card){
    if (!card.querySelector('.card-drag-handle')){
      const handle = document.createElement('div');
      handle.className = 'card-drag-handle';
      card.appendChild(handle);
    }
  }

  function registerResultCard(card, item){
    if (!card) return;
    const id = makeCardId(item);
    card.dataset.cardId = id;
    card.setAttribute('draggable', 'true');
    ensureCardHandle(card);
    card.querySelectorAll('button, .btn, a, input, textarea, select, label').forEach(el => {
      el.setAttribute('draggable', 'false');
    });
    if (card.dataset.wsBound) return;
    card.dataset.wsBound = '1';
    card.addEventListener('dragstart', handleCardDragStart);
    card.addEventListener('dragend', handleCardDragEnd);
  }

  function handleCardDragStart(ev){
    const card = ev.currentTarget;
    if (!card || !ev.dataTransfer) return;
    if (ev.target && ev.target.closest && ev.target.closest('.toolbar, button, .btn, a, input, textarea, select, label')){
      ev.preventDefault();
      return;
    }
    const id = card.dataset.cardId;
    if (!id){
      ev.preventDefault();
      return;
    }
    hideClearConfirm();
    ev.dataTransfer.effectAllowed = 'copy';
    try{
      ev.dataTransfer.setData('text/x-card-id', id);
    }catch(err){
      /* noop */
    }
    card.classList.add('is-dragging');
    document.body.classList.add('ws-dragging');
  }

  function handleCardDragEnd(ev){
    const card = ev.currentTarget;
    if (!card) return;
    card.classList.remove('is-dragging');
    document.body.classList.remove('ws-dragging');
    clearDropVisuals();
  }

  function makeCardId(item){
    const base = item?.file || '';
    if (base){
      return encodeURIComponent(base);
    }
    return encodeURIComponent((item?.desc || '').slice(0, 80));
  }

  function setProject(name){
    projectKey = name ? String(name) : '__default__';
    items = readStoredItems();
    if (initialized){
      renderWorkspaceItems();
    }
  }

  function refreshWorkspaceView(){
    if (!initialized) return;
    renderWorkspaceItems();
  }

  function addItemFromCard(card){
    if (!card) return;
    const id = card.dataset.cardId;
    if (!id) return;
    addItem(id);
  }

  function addItemById(id){
    addItem(id);
  }

  return {
    init,
    setProject,
    registerResultCard,
    refreshWorkspaceView,
    addItemFromCard,
    addItemById
  };
})();

// ---- Projects ----
async function loadProjects(){
  PROJECTS = await api('/api/projects');
  if(!currentProject) currentProject = PROJECTS[0];
  renderProjectList();
  await loadProjectData(currentProject);
}
function renderProjectList(){
  elProject.innerHTML = '';
  PROJECTS.forEach(name=>{
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if(name===currentProject) opt.selected = true;
    elProject.appendChild(opt);
  });
}
async function loadProjectData(name, opts={keepFilters:false}){
  if(!name){ name = currentProject || PROJECTS[0]; }
  const prevFilters = activeTags.slice();
  DATA = await api(`/api/data/${encodeURIComponent(name)}`);
  activeTags = opts.keepFilters ? prevFilters : [];
  ALL_TAGS = Array.from(new Set((DATA || []).flatMap(x => x.tags || []))).sort();
  tempTags = [];
  Workspace.setProject(name);
  render();
}
elProject.onchange = async ()=>{
  currentProject = elProject.value;
  await loadProjectData(currentProject);  // switching project: clear filters
};
elProjectNew.onclick = async ()=>{
  const name = prompt("نام پروژه جدید:", "سکویی");
  if(!name) return;
  try{
    await api('/api/projects', {method:'POST', body: JSON.stringify({name})});
    await loadProjects();
  }catch(e){ alert('خطا در ساخت پروژه:\n' + e.message); }
};
elProjectRename.onclick = async ()=>{
  const name = prompt("نام جدید پروژه:", currentProject);
  if(!name || name===currentProject) return;
  try{
    await api(`/api/projects/${encodeURIComponent(currentProject)}`, {method:'PUT', body: JSON.stringify({name})});
    currentProject = name;
    await loadProjects();
  }catch(e){ alert('خطا در تغییر نام:\n' + e.message); }
};
elProjectDelete.onclick = async ()=>{
  if(!confirm(`پروژه «${currentProject}» حذف شود؟`)) return;
  try{
    await api(`/api/projects/${encodeURIComponent(currentProject)}`, {method:'DELETE'});
    await loadProjects();
  }catch(e){ alert('خطا در حذف:\n' + e.message); }
};

// Used-only toggle
showUsedBtn.onclick = () => {
  showUsedOnly = !showUsedOnly;
  showUsedBtn.textContent = showUsedOnly ? 'نمایش همه' : 'فقط استفاده‌شده‌ها';
  if (showUsedOnly && !activeTags.length) { /* keep tags as-is; just filter by used */ }
  render();
};


// ---- Search & Render ----
elLogic.onclick = ()=>{ useAnd = !useAnd; elLogicLabel.textContent = useAnd ? 'AND' : 'OR'; render(); };
elSearch.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const t = e.target.value.trim();
    if(t && !activeTags.includes(t)){ activeTags.push(t); e.target.value=''; render(); }
  }
});
function fileMatches(item, tags){
  if(tags.length===0) return true;
  const hay = (item.desc||'') + ' ' + item.file + ' ' + (item.tags||[]).join(' ');
  return useAnd ? tags.every(t => hay.includes(t)) : tags.some(t => hay.includes(t));
}
function render(){
  const results = [];
  const resultIdx = [];
  DATA.forEach((item, idx) => {
    if(fileMatches(item, activeTags) && (!showUsedOnly || item.used)){
      results.push(item);
      resultIdx.push(idx);
    }
  });

  elStats.textContent = `نتایج: ${results.length} مورد — پروژه: «${currentProject}»`;
  elTotal.textContent = DATA.length;

  elActiveChips.innerHTML='';
  activeTags.forEach((t,i)=>{
    const c = document.createElement('div');
    c.className='chip active'; c.textContent=t + ' ×';
    c.onclick=()=>{ activeTags.splice(i,1); render(); };
    elActiveChips.appendChild(c);
  });

  elResults.innerHTML='';
  if(results.length===0){
    elResults.innerHTML = '<div class="muted">چیزی پیدا نشد.</div>';
  }else{
    results.forEach((f, k)=>{
      const orig = resultIdx[k];
      const box = document.createElement('div'); box.className = `file ${f.used? "used": ""}`;
      box.innerHTML = `
        <div class="path">${escapeHtml(f.file)} ${f.used? '<span class="badge used">استفاده شده</span>': ""}</div>
        <div class="desc">${escapeHtml(f.desc||'')}</div>
        <div>${(f.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>
        <div class="toolbar">
          <button class="btn" data-toggle="${orig}">${f.used? "برداشتن علامت": "علامت‌گذاری به‌عنوان استفاده‌شده"}</button>
          <button class="btn" data-edit="${orig}">ویرایش</button>
          <button class="btn danger" data-del="${orig}">حذف</button>
          <button class="btn ghost" data-cut="${orig}">کات</button>
          <button class="btn ghost" data-pin="${orig}">📌</button>
        </div>
      `;
      elResults.appendChild(box);
      Workspace.registerResultCard(box, f);
    });
  }

  // Actions
  elResults.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async () => {
      const orig = Number(btn.getAttribute('data-del'));
      if(confirm('این مورد حذف شود؟')){
        await api(`/api/data/${encodeURIComponent(currentProject)}/${orig}`, {method:'DELETE'});
        await loadProjectData(currentProject, {keepFilters:true});
      }
    }
  });
  elResults.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.onclick = () => openEditModal(Number(btn.getAttribute('data-edit')));
  });
  elResults.querySelectorAll('[data-toggle]').forEach(btn=>{
    btn.onclick = async () => {
      const orig = Number(btn.getAttribute('data-toggle'));
      const it = DATA[orig];
      const body = { file: it.file, tags: it.tags||[], desc: it.desc||'', used: !it.used };
      try{
        try{
          await api(`/api/data/${encodeURIComponent(currentProject)}/${orig}`, {method:'PUT', body: JSON.stringify(body)});
        }catch(e){
          await api(`/api/data/${encodeURIComponent(currentProject)}/${orig}`, {method:'POST', body: JSON.stringify(body)});
        }
        await loadProjectData(currentProject, {keepFilters:true});
      }catch(err){
        alert('خطا در تغییر وضعیت استفاده‌شده');
      }
    };
  });

  elResults.querySelectorAll('[data-pin]').forEach(btn=>{
    btn.onclick = (ev) => {
      ev.preventDefault();
      const card = btn.closest('.file');
      Workspace.addItemFromCard(card);
    };
  });


  // Cut-to-clipboard (Windows)
  elResults.querySelectorAll('[data-cut]').forEach(btn=>{
    btn.onclick = async () => {
      const orig = Number(btn.getAttribute('data-cut'));
      const it = DATA[orig];
      try{
        await api('/api/cut', {method:'POST', body: JSON.stringify({paths:[it.file]})});
        btn.textContent = 'کات شد ✔';
        setTimeout(()=>{ btn.textContent='کات'; }, 1200);
      }catch(e){
        alert('خطا در کات به کلیپ‌بورد: ' + e.message);
      }
    };
  });

  
// --- Filter Used Items ---
document.getElementById('filterUsedBtn').onclick = ()=>{
  const onlyUsed = DATA.filter(it=>it.used);
  renderResults(onlyUsed, true);
};

  // Suggestions
  const tagCount = {};
  results.forEach(f=> (f.tags||[]).forEach(t => { tagCount[t] = (tagCount[t]||0)+1; }));
  activeTags.forEach(t=> delete tagCount[t]);
  const sorted = Object.entries(tagCount).sort((a,b)=> b[1]-a[1]).slice(0,30);
  elSuggestions.innerHTML='';
  sorted.forEach(([t,c])=>{
    const chip = document.createElement('div');
    chip.className='chip'; chip.textContent=`${t} (${c})`;
    chip.onclick=()=>{ activeTags.push(t); render(); };
    elSuggestions.appendChild(chip);
  });

  renderAddTagUI();
  Workspace.refreshWorkspaceView();
}

// ---- Tag entry (Enter + autocomplete) ----
addTags.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const t = addTags.value.trim();
    if (t && !tempTags.includes(t)) {
      tempTags.push(t);
      addTags.value = '';
      renderAddTagUI();
    }
  }
});
addTags.addEventListener('input', () => renderAddTagUI());

function renderAddTagUI() {
  const chips = elAddTagChips();
  if (chips) {
    chips.innerHTML = '';
    tempTags.forEach((t, i) => {
      const chip = document.createElement('div');
      chip.className = 'chip active';
      chip.textContent = t + ' ×';
      chip.title = 'حذف این تگ';
      chip.onclick = () => { tempTags.splice(i, 1); renderAddTagUI(); };
      chips.appendChild(chip);
    });
  }

  const hints = elAddTagHints();
  if (hints) {
    const q = addTags.value.trim();
    const candidates = ALL_TAGS
      .filter(t => !tempTags.includes(t))
      .filter(t => q ? t.includes(q) : true)
      .slice(0, 12);

    hints.innerHTML = '';
    candidates.forEach(t => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = t;
      chip.title = 'افزودن این تگ';
      chip.onclick = () => {
        if (!tempTags.includes(t)) tempTags.push(t);
        addTags.value = '';
        renderAddTagUI();
      };
      hints.appendChild(chip);
    });
  }
}

// ---- Add Item ----
addBtn.onclick = async ()=>{
  const f = addFile.value.trim();
  const typed = addTags.value.split(',').map(s=>s.trim()).filter(Boolean);
  const t = (tempTags.length ? tempTags : typed);
  const d = addDesc.value.trim();
  if(!f){ addMsg.textContent='نام/مسیر فایل لازم است.'; addMsg.className='muted'; return; }
  await api(`/api/data/${encodeURIComponent(currentProject)}`, {method:'POST', body: JSON.stringify({file:f, tags:t, desc:d, used:false})});
  addFile.value=''; addTags.value=''; addDesc.value='';
  tempTags = [];
  addMsg.textContent='✅ اضافه شد.'; addMsg.className='muted';
  await loadProjectData(currentProject, {keepFilters:true});
};

// ---- CSV ----
exportCsvBtn.onclick = ()=>{ window.location = `/api/export_csv/${encodeURIComponent(currentProject)}`; };
importCsv.onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const mode = confirm("OK = جایگزینی کامل داده‌های پروژه\nCancel = افزودن به داده‌های موجود") ? 'replace' : 'append';
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(`/api/import_csv/${encodeURIComponent(currentProject)}?mode=${mode}`, {method: 'POST', body: fd});
  if(!res.ok){ alert('خطا در بارگذاری CSV'); return; }
  await loadProjectData(currentProject, {keepFilters:true});
};

// init
loadProjects();
if (typeof window !== 'undefined') {
  window.Workspace = Workspace;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Workspace.init);
} else {
  Workspace.init();
}
