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
  const ITEMS_KEY = 'workspaceItems';
  const COLLAPSED_KEY = 'workspaceCollapsed';
  const LEGACY_KEY_PREFIX = 'workspace:items:';
  const LEGACY_OPEN_KEY = 'workspaceOpen';
  const DEFAULT_WIDTH = 360;

  let workspaceEl;
  let list;
  let collapseBtn;
  let clearBtn;
  let confirmWrap;
  let confirmYes;
  let confirmNo;
  let chevBtn;

  let collapsed = false;
  let initialized = false;
  let projectKey = '__default__';
  let items = [];

  function init(){
    workspaceEl = document.getElementById('workspace');
    list = document.getElementById('workspace-list');
    collapseBtn = document.getElementById('workspaceCollapse');
    clearBtn = document.getElementById('workspaceClear');
    confirmWrap = document.getElementById('workspaceClearConfirm');
    confirmYes = document.getElementById('workspaceConfirmYes');
    confirmNo = document.getElementById('workspaceConfirmNo');
    chevBtn = document.getElementById('workspace-chev');

    if (!workspaceEl || !list) return;

    document.body.classList.add('workspace-ready');
    document.body.style.setProperty('--workspace-width', DEFAULT_WIDTH + 'px');

    setCollapsed(readStoredCollapsed(), false);

    items = readStoredItems();
    renderWorkspaceItems();

    collapseBtn?.addEventListener('click', () => setCollapsed(!collapsed));
    chevBtn?.addEventListener('click', () => setCollapsed(!collapsed));

    clearBtn?.addEventListener('click', showClearConfirm);
    confirmYes?.addEventListener('click', () => {
      items = [];
      persistItems();
      renderWorkspaceItems();
      hideClearConfirm();
    });
    confirmNo?.addEventListener('click', hideClearConfirm);

    setupDropZone();

    initialized = true;
  }

  function readStoredCollapsed(){
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
    const legacy = localStorage.getItem(LEGACY_OPEN_KEY);
    if (legacy === null) return false;
    return legacy !== 'true';
  }

  function persistCollapsed(){
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function setCollapsed(state, persist=true){
    collapsed = !!state;
    workspaceEl.classList.toggle('collapsed', collapsed);
    workspaceEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    document.body.classList.toggle('workspace-open', !collapsed);
    document.body.classList.toggle('workspace-collapsed', collapsed);
    if (collapseBtn){
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const label = collapsed ? 'باز کردن میز کار' : 'جمع کردن میز کار';
      collapseBtn.setAttribute('aria-label', label);
      collapseBtn.title = label;
      collapseBtn.textContent = collapsed ? '❮' : '❯';
    }
    if (chevBtn){
      chevBtn.textContent = collapsed ? '❮' : '❯';
      chevBtn.setAttribute('aria-label', collapsed ? 'باز کردن میز کار' : 'جمع کردن میز کار');
    }
    if (collapsed){
      list?.classList.remove('drop-ready');
    }
    if (persist){
      persistCollapsed();
    }
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

  function setupDropZone(){
    if (!list) return;
    ['dragover','dragleave','drop'].forEach(evt => {
      list.addEventListener(evt, handleDropEvents);
    });
  }

  function handleDropEvents(ev){
    if (!ev.dataTransfer) return;
    const types = Array.from(ev.dataTransfer.types || []);
    const hasCard = types.includes('application/x-card-id');
    const hasWorkspaceItem = types.includes('text/x-workspace-item');
    if (!hasCard && !hasWorkspaceItem) return;
    if (collapsed){
      setCollapsed(false);
    }
    if (ev.type === 'dragover'){
      ev.preventDefault();
      if (hasWorkspaceItem){
        ev.dataTransfer.dropEffect = 'move';
        reorderDuringDrag(ev);
      }else{
        ev.dataTransfer.dropEffect = 'copy';
        list.classList.add('drop-ready');
      }
      return;
    }
    if (ev.type === 'dragleave'){
      const within = ev.relatedTarget ? list.contains(ev.relatedTarget) : false;
      if (!within){
        list.classList.remove('drop-ready');
      }
      return;
    }
    if (ev.type === 'drop'){
      ev.preventDefault();
      list.classList.remove('drop-ready');
      const workspaceId = ev.dataTransfer.getData('text/x-workspace-item');
      if (workspaceId){
        commitReorder();
        return;
      }
      const cardId = ev.dataTransfer.getData('application/x-card-id');
      if (!cardId) return;
      addItem(cardId);
    }
  }

  function readStoredItems(){
    const legacyKey = `${LEGACY_KEY_PREFIX}${projectKey}`;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy){
      try{
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)){
          localStorage.removeItem(legacyKey);
          return parsed.map(id => createSnapshot(id)).filter(Boolean);
        }
      }catch(err){ /* ignore */ }
    }

    try{
      const raw = localStorage.getItem(ITEMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      if (parsed.length && parsed.every(entry => typeof entry === 'string')){
        return parsed.map(id => createSnapshot(id)).filter(Boolean);
      }
      const collected = [];
      parsed.forEach(entry => {
        if (typeof entry === 'string'){
          const snap = createSnapshot(entry);
          if (snap) collected.push(snap);
          return;
        }
        if (!entry || typeof entry !== 'object') return;
        if (entry.project && entry.project !== projectKey) return;
        if (!entry.project && projectKey !== '__default__') return;
        const normalized = normalizeEntry(entry);
        if (normalized) collected.push(normalized);
      });
      return collected;
    }catch(err){
      return [];
    }
  }

  function persistItems(){
    let existing = [];
    try{
      const raw = localStorage.getItem(ITEMS_KEY);
      if (raw){
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)){
          existing = parsed.filter(entry => entry && typeof entry === 'object' && entry.project !== projectKey);
        }
      }
    }catch(err){
      existing = [];
    }

    const payload = items.map(item => ({
      project: projectKey,
      id: item.id,
      file: item.file,
      desc: item.desc || '',
      tags: Array.isArray(item.tags) ? item.tags.slice() : []
    }));

    localStorage.setItem(ITEMS_KEY, JSON.stringify([...existing, ...payload]));
  }

  function normalizeEntry(entry){
    if (!entry || typeof entry !== 'object') return null;
    const rawId = typeof entry.id === 'string' ? entry.id : (entry.file ? encodeURIComponent(entry.file) : null);
    if (!rawId) return null;
    const tags = Array.isArray(entry.tags)
      ? entry.tags
          .map(tag => typeof tag === 'string' ? tag.trim() : '')
          .filter(tag => tag.length)
      : [];
    return {
      id: rawId,
      file: entry.file || entry.title || decodeURIComponentSafe(rawId),
      desc: typeof entry.desc === 'string' ? entry.desc : (typeof entry.description === 'string' ? entry.description : ''),
      tags
    };
  }

  function renderWorkspaceItems(){
    if (!list) return;
    list.innerHTML = '';
    hideClearConfirm();
    if (!items.length){
      const empty = document.createElement('p');
      empty.className = 'workspace-empty';
      empty.textContent = 'برای اضافه کردن کارت، بکش و بنداز اینجا یا روی 📌 کلیک کن';
      list.appendChild(empty);
      return;
    }

    const refreshed = [];
    let dirty = false;
    items.forEach(entry => {
      const hydrated = hydrateEntry(entry) || entry;
      if (hydrated !== entry){
        dirty = true;
      }
      refreshed.push(hydrated);
      const card = renderWorkspaceCard(hydrated);
      list.appendChild(card);
    });

    items = refreshed;
    if (dirty){
      persistItems();
    }
  }

  function renderWorkspaceCard(item){
    const node = document.createElement('div');
    node.className = 'workspace-item';
    node.dataset.cardId = item.id;
    node.setAttribute('role', 'listitem');
    node.draggable = true;

    const title = document.createElement('div');
    title.className = 'workspace-item-title';
    title.textContent = item.file || decodeURIComponentSafe(item.id);
    node.appendChild(title);

    if (Array.isArray(item.tags) && item.tags.length){
      const tagWrap = document.createElement('div');
      tagWrap.className = 'workspace-item-tags';
      item.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagWrap.appendChild(span);
      });
      node.appendChild(tagWrap);
    }

    const footer = document.createElement('div');
    footer.className = 'workspace-item-footer';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workspace-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeItem(item.id);
    });
    footer.appendChild(removeBtn);
    node.appendChild(footer);

    node.addEventListener('dragstart', (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/x-workspace-item', item.id);
      node.classList.add('dragging');
      document.body.classList.add('dragging');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      document.body.classList.remove('dragging');
    });

    return node;
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
    const order = Array.from(list.querySelectorAll('.workspace-item')).map(el => el.dataset.cardId).filter(Boolean);
    const lookup = new Map(items.map(entry => [entry.id, entry]));
    const reordered = order.map(id => lookup.get(id)).filter(Boolean);
    if (reordered.length !== items.length){
      const seen = new Set(order);
      items.forEach(entry => {
        if (!seen.has(entry.id)) reordered.push(entry);
      });
    }
    items = reordered;
    persistItems();
  }

  function getItemAfter(y){
    if (!list) return null;
    const siblings = Array.from(list.querySelectorAll('.workspace-item:not(.dragging)'));
    return siblings.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset){
        return {offset, element: child};
      }
      return closest;
    }, {offset: Number.NEGATIVE_INFINITY, element: null}).element;
  }

  function createSnapshot(id, fallback={}){
    if (!id) return null;
    const key = typeof id === 'string' ? id : String(id);
    const data = findItemById(key) || null;
    const tags = data?.tags && Array.isArray(data.tags)
      ? data.tags.map(tag => String(tag).trim()).filter(Boolean)
      : Array.isArray(fallback.tags)
        ? fallback.tags.map(tag => String(tag).trim()).filter(Boolean)
        : [];
    return {
      id: key,
      file: data?.file || fallback.file || decodeURIComponentSafe(key),
      desc: typeof data?.desc === 'string' ? data.desc : (typeof fallback.desc === 'string' ? fallback.desc : ''),
      tags
    };
  }

  function hydrateEntry(entry){
    if (!entry) return entry;
    const data = findItemById(entry.id);
    if (!data) return entry;
    const tags = Array.isArray(data.tags) ? data.tags.slice() : [];
    const desc = typeof data.desc === 'string' ? data.desc : '';
    const file = data.file || entry.file;
    const changed = file !== entry.file || desc !== (entry.desc || '') || !arraysEqual(tags, entry.tags || []);
    if (!changed) return entry;
    return {
      id: entry.id,
      file,
      desc,
      tags
    };
  }

  function arraysEqual(a, b){
    if (!Array.isArray(a) || !Array.isArray(b)) return Array.isArray(a) === Array.isArray(b);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++){
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function decodeURIComponentSafe(val){
    try{
      return decodeURIComponent(val);
    }catch(err){
      return val;
    }
  }

  function findItemById(id){
    const file = decodeURIComponentSafe(id);
    return (DATA || []).find(item => (item.file || '') === file) || null;
  }

  function removeItem(id){
    const next = items.filter(entry => entry.id !== id);
    if (next.length === items.length) return;
    items = next;
    persistItems();
    renderWorkspaceItems();
  }

  function addItem(id){
    if (!id) return;
    if (items.some(entry => entry.id === id)){
      highlightExisting(id);
      return;
    }
    hideClearConfirm();
    const payload = createSnapshot(id);
    if (!payload) return;
    items.push(payload);
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

  function registerResultCard(card, item){
    if (!card) return;
    const id = makeCardId(item);
    card.dataset.cardId = id;
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

function toast(msg){
  if (!msg) return;
  let node = document.getElementById('app-toast');
  if (!node){
    node = document.createElement('div');
    node.id = 'app-toast';
    node.className = 'app-toast';
    document.body.appendChild(node);
  }
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(node._hideTimer);
  node._hideTimer = setTimeout(() => {
    node.classList.remove('show');
  }, 2200);
}

const dragMimeTypes = ['application/x-card-id', 'text/x-workspace-item'];

function eventHasCardData(ev){
  const types = ev?.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types);
  return dragMimeTypes.some(type => list.includes(type));
}

if (elResults){
  elResults.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const card = handle.closest('.result-card');
    if (!card) return;

    card.setAttribute('draggable', 'true');

    const onDragStart = (ev) => {
      const id = card.dataset.cardId;
      if (!id || !ev.dataTransfer){
        ev.preventDefault();
        return;
      }
      ev.dataTransfer.setData('application/x-card-id', id);
      ev.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('dragging');
      card.classList.add('dragging');
    };

    card.addEventListener('dragstart', onDragStart, {once:true});

    handle.addEventListener('mouseup', () => {
      card.removeAttribute('draggable');
    }, {once:true});
  });
}

document.addEventListener('dragend', () => {
  document.body.classList.remove('dragging');
  document.querySelectorAll('.result-card.dragging').forEach(card => {
    card.classList.remove('dragging');
    card.removeAttribute('draggable');
  });
  const workspaceList = document.getElementById('workspace-list');
  workspaceList?.classList.remove('drop-ready');
}, {capture:true});

document.addEventListener('dragover', (e) => {
  if (eventHasCardData(e)){
    e.preventDefault();
  }
}, {passive:false});

document.addEventListener('drop', (e) => {
  if (!eventHasCardData(e)) return;
  if (!e.target.closest('#workspace-list')){
    e.preventDefault();
    toast('برای افزودن، کارت را روی «میز کار» رها کنید.');
  }
}, {passive:false});

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
      const card = document.createElement('div');
      card.className = `result-card${f.used ? ' used' : ''}`;

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'drag-handle';
      handle.setAttribute('aria-label', 'Drag card');
      handle.title = 'Drag';
      handle.textContent = '⋮⋮';
      card.appendChild(handle);

      const body = document.createElement('div');
      body.className = 'result-card-body';
      card.appendChild(body);

      const path = document.createElement('div');
      path.className = 'path';
      path.innerHTML = `${escapeHtml(f.file)} ${f.used ? '<span class="badge used">استفاده شده</span>' : ''}`;
      body.appendChild(path);

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = f.desc || '';
      body.appendChild(desc);

      const tagWrap = document.createElement('div');
      (f.tags || []).forEach(t => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = t;
        tagWrap.appendChild(span);
      });
      body.appendChild(tagWrap);

      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      toolbar.innerHTML = `
          <button class="btn" data-toggle="${orig}">${f.used ? 'برداشتن علامت' : 'علامت‌گذاری به‌عنوان استفاده‌شده'}</button>
          <button class="btn" data-edit="${orig}">ویرایش</button>
          <button class="btn danger" data-del="${orig}">حذف</button>
          <button class="btn ghost" data-cut="${orig}">کات</button>
          <button class="btn ghost" data-pin="${orig}">📌</button>`;
      body.appendChild(toolbar);

      elResults.appendChild(card);
      Workspace.registerResultCard(card, f);
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
      const card = btn.closest('.result-card');
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
