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

const dragMimeTypes = ['application/x-radio-card-id', 'application/x-workspace-item'];

function eventHasCardData(ev){
  const types = ev?.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types);
  return dragMimeTypes.some(type => list.includes(type));
}

document.addEventListener('dragend', () => {
  document.body.classList.remove('workspace-dragging');
  document.querySelectorAll('.result-card.drag-source').forEach(card => {
    card.classList.remove('drag-source', 'dragging');
    card.removeAttribute('aria-grabbed');
  });
  const panel = document.getElementById('workspacePanel');
  panel?.classList.remove('is-drop-target', 'is-drop-active');
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
  if (window.Workspace && typeof window.Workspace.setProject === 'function') {
    window.Workspace.setProject(name, DATA);
  }
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
      const cardId = `${currentProject}:${orig}`;
      const card = document.createElement('div');
      card.className = `result-card${f.used ? ' used' : ''}`;
      card.dataset.id = cardId;
      card.dataset.project = currentProject;
      card.dataset.index = String(orig);
      card.dataset.file = f.file || '';
      card.dataset.desc = f.desc || '';
      card.dataset.tags = (f.tags || []).join(',');
      card.dataset.used = f.used ? '1' : '0';
      card.setAttribute('draggable', 'true');

      const grip = document.createElement('div');
      grip.className = 'drag-grip';
      grip.title = 'Drag card';
      card.appendChild(grip);

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
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', cardId);
        event.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
      card.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
      });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      if (window.Workspace && typeof window.Workspace.registerResultCard === 'function') {
        window.Workspace.registerResultCard(card, {project: currentProject, index: orig, data: f});
      }
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
      if (window.Workspace && typeof window.Workspace.addItemFromCard === 'function') {
        window.Workspace.addItemFromCard(card);
      }
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
  if (window.Workspace && typeof window.Workspace.refresh === 'function') {
    window.Workspace.refresh();
  }
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

function startApp(){
  loadProjects();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
