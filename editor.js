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
(function () {
  const LS_KEY = 'workspaceItems:v1';

  // Body padding to make room for the fixed workspace column
  if (!document.body.classList.contains('workspace-padding')) {
    document.body.classList.add('workspace-padding');
  }

  function loadIds() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function saveIds(ids) {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  }
  function uniq(arr){ return Array.from(new Set(arr)); }

  // ---- ID helpers: each result card must have a stable data-item-id
  function ensureCardId(el) {
    if (el.dataset && el.dataset.itemId) return el.dataset.itemId;
    // fallback: hash from text (not perfect but stable for current session)
    const text = (el.innerText || '').slice(0, 2000);
    const id = 'auto_' + hash32(text);
    if (el.dataset) el.dataset.itemId = id;
    return id;
  }
  function hash32(s){
    let h = 2166136261 >>> 0;
    for (let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h>>>0).toString(16);
  }

  // ---- DOM getters
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const workspace = {
    list: null,
    clearBtn: null,
  };

  // Public API
  window.Workspace = {
    init,
    addById,
    removeById,
    render,
    clearAll,
  };

  // Initialize events and first render
  function init() {
    workspace.list = $('#workspace-list');
    workspace.clearBtn = $('#workspace-clear');

    if (!workspace.list) return; // workspace not on page

    // Drag target (from results) -> workspace
    workspace.list.addEventListener('dragover', (e) => {
      e.preventDefault();
      workspace.list.classList.add('workspace-dropzone');
    });
    workspace.list.addEventListener('dragleave', () => {
      workspace.list.classList.remove('workspace-dropzone');
    });
    workspace.list.addEventListener('drop', (e) => {
      e.preventDefault();
      workspace.list.classList.remove('workspace-dropzone');
      const id = e.dataTransfer.getData('text/x-card-id');
      if (id) addById(id);
    });

    // Clear button
    if (workspace.clearBtn) {
      workspace.clearBtn.addEventListener('click', () => {
        if (confirm('همه آیتم‌ها از میز کار حذف شود؟')) clearAll();
      });
    }

    // Global delegation: add 📌 button to each card (non-destructive)
    injectPinButtons();

    // Make result cards draggable
    makeCardsDraggable();

    // First render
    render();

    // Re-inject after dynamic updates (if your app re-renders the list)
    const mo = new MutationObserver(() => {
      injectPinButtons();
      makeCardsDraggable();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function injectPinButtons() {
    // Likely card containers (add more if needed)
    const cards = $$('.result-card, .card, .item-card, [data-card], .search-result');
    cards.forEach(card => {
      // Skip if pin already exists
      if (card.querySelector('.pin-to-workspace')) return;
      // Place button near existing action buttons (edit/cut/delete) if present
      const bar = card.querySelector('.actions, .btn-group, .card-actions') || card;
      const btn = document.createElement('button');
      btn.className = 'pin-to-workspace';
      btn.type = 'button';
      btn.title = 'افزودن به میز کار';
      btn.textContent = '📌';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = ensureCardId(card);
        addById(id);
      });
      bar.appendChild(btn);
    });
  }

  function makeCardsDraggable() {
    const cards = $$('.result-card, .card, .item-card, [data-card], .search-result');
    cards.forEach(card => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        const id = ensureCardId(card);
        e.dataTransfer.setData('text/x-card-id', id);
        e.dataTransfer.effectAllowed = 'copyMove';
      });
    });
  }

  // Workspace operations
  function addById(id) {
    const ids = uniq(loadIds().concat(id));
    saveIds(ids);
    render();
  }
  function removeById(id) {
    const ids = loadIds().filter(x => x !== id);
    saveIds(ids);
    render();
  }
  function clearAll() {
    saveIds([]);
    render();
  }

  // Reorder support
  function enableReorder(cardEl) {
    cardEl.setAttribute('draggable', 'true');
    cardEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-ws-id', cardEl.dataset.itemId);
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
    });
    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
    });
  }

  function render() {
    if (!workspace.list) return;
    const ids = loadIds();
    workspace.list.innerHTML = '';

    if (!ids.length) {
      workspace.list.innerHTML = '<p class="workspace-empty">برای اضافه کردن کارت، بکش و بنداز اینجا یا روی 📌 کلیک کن</p>';
      return;
    }

    ids.forEach(id => {
      // Try to find the original card to clone its markup (keeps look identical)
      const src = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`) ||
                  document.querySelector(`.result-card, .card, .item-card, [data-card], .search-result`);
      let clone;
      if (src) {
        // Ensure id on source
        ensureCardId(src);
        clone = src.cloneNode(true);
      } else {
        // Fallback minimal card
        clone = document.createElement('div');
        clone.textContent = id;
        clone.className = 'workspace-card';
      }

      // Make it a workspace card
      clone.classList.add('workspace-card');
      clone.dataset.itemId = id;

      // Remove inner "pin" buttons inside workspace clone
      clone.querySelectorAll('.pin-to-workspace').forEach(b => b.remove());

      // Add remove button
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✖';
      removeBtn.title = 'حذف از میز کار';
      removeBtn.style.cssText = 'float:inline-end;margin-inline-start:6px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#ddd;padding:2px 6px;border-radius:6px;cursor:pointer;';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeById(id);
      });
      clone.prepend(removeBtn);

      // Enable reorder within workspace
      enableReorder(clone);

      // Handle drop position (reorder)
      clone.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = workspace.list.querySelector('.workspace-card.dragging');
        if (!dragging || dragging === clone) return;
        const cards = Array.from(workspace.list.children);
        const draggingIdx = cards.indexOf(dragging);
        const targetIdx = cards.indexOf(clone);
        const rect = clone.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        if (before) {
          workspace.list.insertBefore(dragging, clone);
          rearrangeIds(draggingIdx, targetIdx);
        } else {
          workspace.list.insertBefore(dragging, clone.nextSibling);
          rearrangeIds(draggingIdx, targetIdx + 1);
        }
      });

      workspace.list.appendChild(clone);
    });
  }

  function rearrangeIds(from, to) {
    const arr = loadIds();
    if (from < 0 || to < 0 || from === to) return;
    const item = arr.splice(from, 1)[0];
    arr.splice(to > from ? to - 1 : to, 0, item);
    saveIds(arr);
  }
})();
