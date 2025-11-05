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

const dragMimeTypes = ['application/x-card-id', 'text/x-workspace-item', 'text/x-workspace-html'];

function eventHasCardData(ev){
  const types = ev?.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types);
  return dragMimeTypes.some(type => list.includes(type));
}

document.addEventListener('dragend', () => {
  document.body.classList.remove('ws-dragging');
  document.querySelectorAll('.result-card.drag-source').forEach(card => {
    card.classList.remove('drag-source', 'dragging');
    card.removeAttribute('aria-grabbed');
  });
  document.getElementById('workspaceList')?.removeAttribute('aria-dropeffect');
  document.getElementById('workspacePanel')?.classList.remove('drop-target');
}, {capture:true});

document.addEventListener('dragover', (e) => {
  if (eventHasCardData(e)){
    e.preventDefault();
  }
}, {passive:false});

document.addEventListener('drop', (e) => {
  if (!eventHasCardData(e)) return;
  if (e.target.closest('#workspacePanel')) return;
  e.preventDefault();
  if (!e.target.closest('.result-card')){
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
      handle.className = 'card-grip';
      handle.setAttribute('aria-label', 'Drag card');
      handle.title = 'Drag';
      handle.innerHTML = '';
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
const Workspace = (() => {
  const STORAGE_KEY = 'rm_workspace:v1';
  const DEFAULT_WIDTH = 360;
  const MIN_WIDTH = 280;
  const MAX_RATIO = 0.5;
  const CARD_MIME = 'application/x-card-id';
  const WORKSPACE_MIME = 'text/x-workspace-item';
  const CARD_HTML_MIME = 'text/x-workspace-html';
  const LEGACY_SELECTORS = ['#workbench', '.workbench', '.workspace-legacy', '.ws-bottom', '[data-role="workspace-bottom"]'];

  let panel;
  let list;
  let toggleBtn;
  let resizer;
  let clearBtn;
  let hint;

  let state = {open:false, width:DEFAULT_WIDTH, items:[]};
  let items = [];
  let open = false;
  let width = DEFAULT_WIDTH;
  let initialized = false;
  let dropDepth = 0;
  let legacyObserver;

  function init(){
    panel = document.getElementById('workspacePanel');
    list = document.getElementById('workspaceList');
    toggleBtn = document.getElementById('workspaceToggle');
    resizer = document.getElementById('workspaceResizer');
    clearBtn = document.getElementById('workspaceClear');
    hint = document.getElementById('workspaceHint');

    if (!panel || !list || !toggleBtn) return;

    removeLegacyNodes();
    observeLegacyNodes();

    state = loadState();
    width = clampWidth(state.width || DEFAULT_WIDTH);
    open = !!state.open;

    applyWidth(width, false);
    setOpen(open, false);

    items = hydrateItems(state.items);
    render();

    toggleBtn.addEventListener('click', () => setOpen(!open));
    clearBtn?.addEventListener('click', handleClear);
    document.addEventListener('keydown', handleKeyboardToggle);

    setupResizer();
    setupDropzone();

    window.addEventListener('resize', handleWindowResize);

    initialized = true;
  }

  function handleKeyboardToggle(ev){
    if (ev.ctrlKey && ev.altKey && (ev.key === 'w' || ev.key === 'W')){
      ev.preventDefault();
      setOpen(!open);
    }
  }

  function handleClear(){
    if (!items.length) return;
    if (!confirm('همه کارت‌های میز کار پاک شوند؟')) return;
    items = [];
    persistState(true);
    render();
  }

  function setupResizer(){
    if (!resizer) return;
    let resizing = false;
    let startX = 0;
    let startWidth = width;

    const onMove = (ev) => {
      if (!resizing) return;
      const delta = startX - ev.clientX;
      const next = clampWidth(startWidth + delta);
      applyWidth(next);
    };

    const onUp = (ev) => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove('ws-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      resizer.releasePointerCapture?.(ev.pointerId);
      persistState(false);
    };

    resizer.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      resizing = true;
      startX = ev.clientX;
      startWidth = width;
      document.body.classList.add('ws-resizing');
      resizer.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, {once:false});
    });
  }

  function setupDropzone(){
    if (!panel) return;
    ['dragenter','dragover','dragleave','drop'].forEach(evt => panel.addEventListener(evt, handleDropEvent));
  }

  function handleDropEvent(ev){
    if (!ev.dataTransfer) return;
    const types = Array.from(ev.dataTransfer.types || []);
    const hasCard = types.includes(CARD_MIME);
    const hasWorkspaceItem = types.includes(WORKSPACE_MIME);
    if (!hasCard && !hasWorkspaceItem) return;

    if (!open && hasCard){
      setOpen(true);
    }

    if (ev.type === 'dragenter'){
      dropDepth++;
      panel.classList.add('drop-target');
      list.setAttribute('aria-dropeffect', hasWorkspaceItem ? 'move' : 'copy');
      return;
    }

    if (ev.type === 'dragover'){
      ev.preventDefault();
      if (hasWorkspaceItem){
        ev.dataTransfer.dropEffect = 'move';
        reorderDuringDrag(ev.clientY);
      }else{
        ev.dataTransfer.dropEffect = 'copy';
      }
      return;
    }

    if (ev.type === 'dragleave'){
      dropDepth = Math.max(0, dropDepth - 1);
      if (!panel.contains(ev.relatedTarget) || dropDepth === 0){
        resetDropState();
      }
      return;
    }

    if (ev.type === 'drop'){
      ev.preventDefault();
      const workspaceId = ev.dataTransfer.getData(WORKSPACE_MIME);
      if (workspaceId){
        resetDropState();
        commitReorder();
        return;
      }
      const cardId = ev.dataTransfer.getData(CARD_MIME);
      if (cardId){
        const fallbackHtml = ev.dataTransfer.getData(CARD_HTML_MIME) || '';
        addItem(cardId, fallbackHtml);
      }
      resetDropState();
    }
  }

  function resetDropState(){
    dropDepth = 0;
    panel?.classList.remove('drop-target');
    list?.removeAttribute('aria-dropeffect');
  }

  function handleWindowResize(){
    const capped = clampWidth(width);
    if (capped !== width){
      applyWidth(capped);
      persistState(false);
    }
  }

  function applyWidth(value, persist=true){
    width = clampWidth(value);
    document.documentElement.style.setProperty('--ws-w', `${width}px`);
    if (persist){
      persistState(false);
    }
  }

  function setOpen(state, persist=true){
    open = !!state;
    panel.classList.toggle('ws--closed', !open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('ws-open', open);
    toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', open ? 'بستن میز کار' : 'باز کردن میز کار');
    if (!open){
      resetDropState();
    }
    if (persist){
      persistState(false);
    }
  }

  function clampWidth(val){
    const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_RATIO));
    return Math.min(Math.max(Number(val) || DEFAULT_WIDTH, MIN_WIDTH), max);
  }

  function loadState(){
    const defaults = {open:false, width:DEFAULT_WIDTH, items:[]};
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        open: !!parsed.open,
        width: typeof parsed.width === 'number' ? parsed.width : DEFAULT_WIDTH,
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    }catch(err){
      return defaults;
    }
  }

  function saveState(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(err){ /* ignore */ }
  }

  function persistState(includeItems=true){
    if (!state || typeof state !== 'object'){
      state = {open:false, width:DEFAULT_WIDTH, items:[]};
    }
    state.open = open;
    state.width = width;
    if (includeItems){
      state.items = items.map(entry => ({id: entry.id, html: entry.html}));
    }
    saveState();
  }

  function hydrateItems(stored){
    if (!Array.isArray(stored)) return [];
    return stored.map(entry => makeItem(entry?.id, entry?.html)).filter(Boolean);
  }

  function render(){
    if (!list) return;
    list.innerHTML = '';

    if (!items.length){
      if (hint){
        hint.style.display = '';
      }
    }else{
      if (hint){
        hint.style.display = 'none';
      }
      items.forEach(item => list.appendChild(renderWorkspaceItem(item)));
    }

    if (clearBtn){
      const disabled = items.length === 0;
      clearBtn.disabled = disabled;
      clearBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

    persistState(true);
  }

  function renderWorkspaceItem(item){
    const node = document.createElement('div');
    node.className = 'ws-item';
    node.dataset.cardId = item.id;
    node.setAttribute('role', 'listitem');
    node.draggable = true;

    const content = document.createElement('div');
    content.className = 'ws-item__content';
    content.innerHTML = item.html;
    node.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'ws-item__actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ws-item__remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', 'حذف کارت از میز کار');
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeItem(item.id);
    });
    footer.appendChild(removeBtn);
    node.appendChild(footer);

    node.addEventListener('dragstart', (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData(WORKSPACE_MIME, item.id);
      node.classList.add('dragging');
      document.body.classList.add('ws-dragging');
      list.setAttribute('aria-dropeffect', 'move');
    });

    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      document.body.classList.remove('ws-dragging');
      resetDropState();
      commitReorder();
    });

    return node;
  }

  function reorderDuringDrag(clientY){
    if (!list) return;
    const dragging = list.querySelector('.ws-item.dragging');
    if (!dragging) return;
    const after = getItemAfter(clientY);
    if (!after){
      list.appendChild(dragging);
    }else{
      list.insertBefore(dragging, after);
    }
  }

  function getItemAfter(y){
    const siblings = Array.from(list.querySelectorAll('.ws-item:not(.dragging)'));
    return siblings.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset){
        return {offset, element: child};
      }
      return closest;
    }, {offset: Number.NEGATIVE_INFINITY, element: null}).element;
  }

  function commitReorder(){
    if (!list) return;
    const order = Array.from(list.querySelectorAll('.ws-item'))
      .map(el => el.dataset.cardId)
      .filter(Boolean);
    if (!order.length) return;
    const lookup = new Map(items.map(entry => [entry.id, entry]));
    const reordered = order.map(id => lookup.get(id)).filter(Boolean);
    if (reordered.length !== items.length){
      const seen = new Set(order);
      items.forEach(entry => {
        if (!seen.has(entry.id)){
          reordered.push(entry);
        }
      });
    }
    items = reordered;
    persistState(true);
  }

  function removeItem(id){
    const next = items.filter(entry => entry.id !== id);
    if (next.length === items.length) return;
    items = next;
    render();
  }

  function addItem(id, fallbackHtml=''){
    if (!id) return;
    if (items.some(entry => entry.id === id)){
      highlightExisting(id);
      if (!open){
        setOpen(true);
      }
      return;
    }
    const snapshot = makeItem(id, fallbackHtml);
    if (!snapshot) return;
    items.push(snapshot);
    render();
    highlightExisting(id);
    if (!open){
      setOpen(true);
    }
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

  function makeItem(id, fallbackHtml=''){
    const key = typeof id === 'string' ? id : String(id || '');
    if (!key) return null;
    const snapshot = composeSnapshot(key);
    if (snapshot) return snapshot;
    const html = typeof fallbackHtml === 'string' && fallbackHtml.trim().length
      ? fallbackHtml
      : buildFallbackHtml(key);
    return {id: key, html};
  }

  function composeSnapshot(id){
    const data = findItemById(id);
    if (!data) return null;
    return {id, html: buildWorkspaceHtml(data, id)};
  }

  function buildWorkspaceHtml(data, id){
    const file = escapeHtml(data.file || decodeURIComponentSafe(id));
    const badge = data.used ? `<span class="ws-card__badge">استفاده شده</span>` : '';
    const desc = data.desc ? `<p class="ws-card__desc">${escapeHtml(data.desc)}</p>` : '';
    const tags = Array.isArray(data.tags) && data.tags.length
      ? `<div class="ws-card__tags">${data.tags.filter(Boolean).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
    return `<div class="ws-card"><div class="ws-card__path">${file}${badge}</div>${desc}${tags}</div>`;
  }

  function buildFallbackHtml(id){
    const label = escapeHtml(decodeURIComponentSafe(id));
    return `<div class="ws-card"><div class="ws-card__path">${label}</div></div>`;
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

  function makeCardId(item){
    const base = item?.file || '';
    if (base){
      return encodeURIComponent(base);
    }
    return encodeURIComponent((item?.desc || '').slice(0, 120));
  }

  function onCardDragStart(ev, card){
    if (!ev.dataTransfer) return ev.preventDefault();
    const handle = ev.target?.closest('.card-grip');
    if (!handle) return ev.preventDefault();
    const id = card.dataset.cardId;
    if (!id){
      ev.preventDefault();
      return;
    }
    ev.dataTransfer.setData(CARD_MIME, id);
    const snapshot = composeSnapshot(id);
    const fallbackHtml = snapshot?.html || serializeCardForWorkspace(card);
    if (fallbackHtml){
      ev.dataTransfer.setData(CARD_HTML_MIME, fallbackHtml);
    }
    ev.dataTransfer.effectAllowed = 'copy';
    card.classList.add('drag-source');
    card.classList.add('dragging');
    card.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('ws-dragging');
  }

  function serializeCardForWorkspace(card){
    const body = card.querySelector('.result-card-body');
    return body ? `<div class="ws-card">${body.innerHTML}</div>` : card.innerHTML;
  }

  function onCardDragEnd(card){
    card.classList.remove('drag-source', 'dragging');
    card.removeAttribute('aria-grabbed');
    document.body.classList.remove('ws-dragging');
    resetDropState();
  }

  function guardCardDrop(ev){
    if (eventHasCardData(ev)){
      ev.preventDefault();
      if (ev.dataTransfer){
        ev.dataTransfer.dropEffect = 'none';
      }
    }
  }

  function addItemFromCard(card){
    if (!card) return;
    const id = card.dataset.cardId;
    if (!id) return;
    const snapshot = composeSnapshot(id);
    const fallbackHtml = snapshot?.html || serializeCardForWorkspace(card);
    addItem(id, fallbackHtml);
  }

  function addItemById(id){
    addItem(id);
  }

  function registerResultCard(card, item){
    if (!card) return;
    const id = makeCardId(item);
    card.dataset.cardId = id;
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (ev) => onCardDragStart(ev, card));
    card.addEventListener('dragend', () => onCardDragEnd(card));
    card.addEventListener('dragover', guardCardDrop);
    card.addEventListener('drop', guardCardDrop);

    if (!card.querySelector('.card-grip')){
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'card-grip';
      grip.setAttribute('aria-label', 'Drag card');
      grip.title = 'Drag';
      grip.innerHTML = '';
      card.insertBefore(grip, card.firstChild);
    }
  }

  function refreshWorkspaceView(){
    if (!initialized) return;
    items = items.map(item => makeItem(item.id, item.html)).filter(Boolean);
    render();
  }

  function setProject(){
    if (!initialized) return;
    refreshWorkspaceView();
  }

  function removeLegacyNodes(root=document){
    LEGACY_SELECTORS.forEach(sel => {
      root.querySelectorAll?.(sel).forEach(node => node.remove());
    });
    if (root instanceof Element && LEGACY_SELECTORS.some(sel => root.matches?.(sel))){
      root.remove();
    }
  }

  function observeLegacyNodes(){
    if (legacyObserver){
      legacyObserver.disconnect();
    }
    legacyObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element){
            removeLegacyNodes(node);
          }
        });
      });
    });
    legacyObserver.observe(document.body, {childList:true, subtree:true});
  }

  return {
    init,
    registerResultCard,
    refreshWorkspaceView,
    addItemFromCard,
    addItemById,
    setProject
  };
})();
