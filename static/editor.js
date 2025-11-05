// ----- Edit Modal -----
const backdrop = document.getElementById('editBackdrop');
const editFile = document.getElementById('editFile');
const editTags = document.getElementById('editTags');
const editDesc = document.getElementById('editDesc');
const editSave = document.getElementById('editSave');
const editCancel = document.getElementById('editCancel');

let EDIT_INDEX = null;
let EDIT_TAGS = [];

function openEditModal(origIndex){
  EDIT_INDEX = origIndex;
  const it = DATA[origIndex];
  editFile.value = it.file || '';
  EDIT_TAGS = [...(it.tags||[])];
  editDesc.value = it.desc || '';
  editTags.value = '';
  renderEditTagUI();
  backdrop.classList.add('show');
}
function closeEditModal(){
  EDIT_INDEX = null;
  EDIT_TAGS = [];
  backdrop.classList.remove('show');
}

editTags.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    e.preventDefault();
    const t = editTags.value.trim();
    if(t && !EDIT_TAGS.includes(t)){
      EDIT_TAGS.push(t);
      editTags.value = '';
      renderEditTagUI();
    }
  }
});
editTags.addEventListener('input', ()=> renderEditTagUI());

function renderEditTagUI(){
  const chips = document.getElementById('editTagChips');
  chips.innerHTML='';
  EDIT_TAGS.forEach((t,i)=>{
    const chip = document.createElement('div');
    chip.className='chip active';
    chip.textContent = t + ' ×';
    chip.onclick = ()=>{ EDIT_TAGS.splice(i,1); renderEditTagUI(); };
    chips.appendChild(chip);
  });
  const hints = document.getElementById('editTagHints');
  const q = editTags.value.trim();
  const candidates = ALL_TAGS.filter(t=>!EDIT_TAGS.includes(t)).filter(t=> q ? t.includes(q) : true).slice(0,12);
  hints.innerHTML='';
  candidates.forEach(t=>{
    const chip = document.createElement('div');
    chip.className='chip';
    chip.textContent = t;
    chip.onclick = ()=>{ EDIT_TAGS.push(t); editTags.value=''; renderEditTagUI(); };
    hints.appendChild(chip);
  });
}

editSave.addEventListener('click', async ()=>{
  if(EDIT_INDEX==null) return;
  const it = DATA[EDIT_INDEX] || {};
  const body = {
    file: editFile.value.trim(),
    tags: EDIT_TAGS,
    desc: editDesc.value.trim(),
    used: it.used ? true : false
  };
  try{
    try{
      await api(`/api/data/${encodeURIComponent(currentProject)}/${EDIT_INDEX}`, {method:'PUT', body: JSON.stringify(body)});
    }catch(e){
      await api(`/api/data/${encodeURIComponent(currentProject)}/${EDIT_INDEX}`, {method:'POST', body: JSON.stringify(body)});
    }
    closeEditModal();
    await loadProjectData(currentProject, {keepFilters:true});
  }catch(e){
    alert('خطا در ذخیره ویرایش: ' + e.message);
  }
});
editCancel.addEventListener('click', closeEditModal);

// ================= Workspace Feature (temporary board) =================
(function(){
  const LS_KEY = 'workspaceItems:v1';
  const resultsContainer = document.getElementById('results');
  const workspace = {
    list: document.getElementById('workspace-list'),
    clearBtn: document.getElementById('workspace-clear')
  };

  if (!workspace.list) {
    return;
  }

  document.body.classList.add('workspace-enabled');

  window.Workspace = {
    init,
    addById,
    removeById,
    render,
    clearAll
  };

  function getProjectKey(){
    return (typeof currentProject === 'string' && currentProject) ? currentProject : '__default__';
  }

  function readStorage(){
    try{
      const raw = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(raw)) {
        return { '__default__': raw };
      }
      return raw || {};
    }catch(err){
      return {};
    }
  }

  function writeStorage(map){
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  }

  function loadIds(){
    const map = readStorage();
    return map[getProjectKey()] || [];
  }

  function saveIds(ids){
    const map = readStorage();
    map[getProjectKey()] = ids;
    writeStorage(map);
  }

  function uniq(arr){
    return Array.from(new Set(arr));
  }

  function hash32(str){
    let h = 2166136261 >>> 0;
    for(let i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h>>>0).toString(16);
  }

  function ensureCardId(card){
    if (card.dataset.itemId) return card.dataset.itemId;
    const item = resolveItemFromCard(card);
    if (item){
      const id = makeItemId(item);
      card.dataset.itemId = id;
      return id;
    }
    const fallback = 'ws_' + hash32((card.innerText || '').slice(0,512));
    card.dataset.itemId = fallback;
    return fallback;
  }

  function resolveItemFromCard(card){
    let idx = null;
    const editBtn = card.querySelector('[data-edit]');
    if (editBtn){
      const parsed = Number(editBtn.getAttribute('data-edit'));
      if (!Number.isNaN(parsed)) idx = parsed;
    }
    if (idx!=null && Array.isArray(DATA) && DATA[idx]){
      return DATA[idx];
    }
    const toggleBtn = card.querySelector('[data-toggle]');
    if (toggleBtn){
      const parsed = Number(toggleBtn.getAttribute('data-toggle'));
      if (!Number.isNaN(parsed) && DATA[parsed]){
        return DATA[parsed];
      }
    }
    const pathEl = card.querySelector('.path');
    if (pathEl){
      const text = pathEl.textContent.trim();
      if (text && Array.isArray(DATA)){
        return DATA.find(it => (it.file||'').trim() === text) || null;
      }
    }
    return null;
  }

  function makeItemId(item){
    return encodeURIComponent(item.file || '');
  }

  function findItemById(id){
    const file = decodeURIComponent(id || '');
    if (!Array.isArray(DATA)) return null;
    let candidate = DATA.find(it => (it.file||'') === file);
    if (!candidate && file){
      const lower = file.toLowerCase();
      candidate = DATA.find(it => (it.file||'').toLowerCase() === lower);
    }
    return candidate || null;
  }

  function init(){
    workspace.list.addEventListener('dragover', handleListDragOver);
    workspace.list.addEventListener('dragleave', () => workspace.list.classList.remove('workspace-dropzone'));
    workspace.list.addEventListener('drop', handleListDrop);

    if (workspace.clearBtn){
      workspace.clearBtn.addEventListener('click', () => {
        if (confirm('همه آیتم‌ها از میز کار حذف شود؟')){
          clearAll();
        }
      });
    }

    injectPinButtons();
    makeCardsDraggable();
    render();

    if (resultsContainer){
      const observer = new MutationObserver(()=>{
        ensureCardIds();
        injectPinButtons();
        makeCardsDraggable();
        render();
      });
      observer.observe(resultsContainer, {childList:true, subtree:true});
    }
  }

  function ensureCardIds(){
    getResultCards().forEach(card => ensureCardId(card));
  }

  function getResultCards(){
    return Array.from(document.querySelectorAll('#results .file'));
  }

  function injectPinButtons(){
    getResultCards().forEach(card => {
      ensureCardId(card);
      if (card.querySelector('.pin-to-workspace')) return;
      const toolbar = card.querySelector('.toolbar');
      if (!toolbar) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ghost pin-to-workspace';
      btn.title = 'افزودن به میز کار';
      btn.textContent = '📌';
      btn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        addById(ensureCardId(card));
      });
      toolbar.appendChild(btn);
    });
  }

  function makeCardsDraggable(){
    getResultCards().forEach(card => {
      if (card.dataset.workspaceDraggable === '1') return;
      card.dataset.workspaceDraggable = '1';
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (ev)=>{
        const id = ensureCardId(card);
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData('text/x-card-id', id);
        ev.dataTransfer.setData('text/plain', id);
      });
    });
  }

  function handleListDragOver(ev){
    ev.preventDefault();
    workspace.list.classList.add('workspace-dropzone');
  }

  function handleListDrop(ev){
    ev.preventDefault();
    workspace.list.classList.remove('workspace-dropzone');
    const reorderId = ev.dataTransfer.getData('text/x-workspace-id');
    if (reorderId){
      const ids = loadIds();
      const from = ids.indexOf(reorderId);
      if (from >= 0){
        ids.splice(from,1);
        ids.push(reorderId);
        saveIds(ids);
        render();
      }
      return;
    }
    const id = ev.dataTransfer.getData('text/x-card-id');
    if (id){
      addById(id);
    }
  }

  function addById(id){
    const ids = uniq(loadIds().concat(id));
    saveIds(ids);
    render();
  }

  function removeById(id){
    const ids = loadIds().filter(x => x !== id);
    saveIds(ids);
    render();
  }

  function clearAll(){
    saveIds([]);
    render();
  }

  function createWorkspaceCard(id, item){
    const card = document.createElement('div');
    card.className = 'workspace-card file';
    card.dataset.itemId = id;

    const header = document.createElement('div');
    header.className = 'path';
    header.textContent = item ? item.file : id;
    card.appendChild(header);

    if (item && item.desc){
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = item.desc;
      card.appendChild(desc);
    }

    if (item && Array.isArray(item.tags) && item.tags.length){
      const tags = document.createElement('div');
      tags.innerHTML = (item.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
      card.appendChild(tags);
    }

    const actions = document.createElement('div');
    actions.className = 'toolbar';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workspace-remove';
    removeBtn.textContent = '✖';
    removeBtn.title = 'حذف از میز کار';
    removeBtn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      removeById(id);
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    enableReorder(card);
    return card;
  }

  function enableReorder(card){
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (ev)=>{
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/x-workspace-id', card.dataset.itemId || '');
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', ()=>{
      card.classList.remove('dragging');
    });
    card.addEventListener('dragover', (ev)=>{
      ev.preventDefault();
      const dragging = workspace.list.querySelector('.workspace-card.dragging');
      if (!dragging || dragging === card) return;
      const cards = Array.from(workspace.list.children);
      const draggingIdx = cards.indexOf(dragging);
      const targetIdx = cards.indexOf(card);
      const rect = card.getBoundingClientRect();
      const before = (ev.clientY - rect.top) < rect.height / 2;
      if (before){
        workspace.list.insertBefore(dragging, card);
        rearrangeIds(draggingIdx, targetIdx);
      } else {
        workspace.list.insertBefore(dragging, card.nextSibling);
        rearrangeIds(draggingIdx, targetIdx + 1);
      }
    });
  }

  function rearrangeIds(from, to){
    const ids = loadIds();
    if (from < 0 || to < 0 || from === to) return;
    const item = ids.splice(from,1)[0];
    const targetIndex = to > from ? to - 1 : to;
    ids.splice(targetIndex, 0, item);
    saveIds(ids);
  }

  function render(){
    if (!workspace.list) return;
    const ids = loadIds();
    workspace.list.innerHTML = '';

    const missing = [];
    if (!ids.length){
      workspace.list.innerHTML = '<p class="workspace-empty">برای اضافه کردن کارت، بکش و بنداز اینجا یا روی 📌 کلیک کن</p>';
      return;
    }

    ids.forEach(id => {
      const item = findItemById(id);
      if (!item){
        missing.push(id);
        return;
      }
      const card = createWorkspaceCard(id, item);
      workspace.list.appendChild(card);
    });

    if (missing.length){
      const remaining = loadIds().filter(x => !missing.includes(x));
      if (remaining.length !== ids.length){
        saveIds(remaining);
        if (!remaining.length){
          workspace.list.innerHTML = '<p class="workspace-empty">برای اضافه کردن کارت، بکش و بنداز اینجا یا روی 📌 کلیک کن</p>';
        }
      }
    }
  }
})();
