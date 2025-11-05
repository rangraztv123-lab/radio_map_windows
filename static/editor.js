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

// Workspace manager
(() => {
  class Workspace {
    constructor() {
      this.root = document.getElementById('workspace');
      this.list = document.getElementById('ws-list');
      this.toggle = document.getElementById('ws-toggle');
      this.clear = document.getElementById('ws-clear');
      this.resizer = this.root ? this.root.querySelector('.ws-resizer') : null;
      this.items = [];
      if (!this.root || !this.list || !this.toggle || !this.clear) {
        this.root = null;
        return;
      }
      this.load();
      this.bind();
    }

    safeParse(raw) {
      try {
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    load() {
      const storedWidth = parseInt(localStorage.getItem('workspace.width') || '', 10);
      if (!Number.isNaN(storedWidth)) {
        this.root.style.setProperty('--wsw', `${storedWidth}px`);
      }
      const savedItems = this.safeParse(localStorage.getItem('workspace.items'));
      this.items = Array.isArray(savedItems) ? savedItems.filter(Boolean) : [];
      const storedOpen = localStorage.getItem('workspace.open');
      const isOpen = storedOpen === null ? true : storedOpen === 'true';
      this.setOpen(isOpen, false);
      this.render();
    }

    persist() {
      if (!this.root) return;
      localStorage.setItem('workspace.open', String(this.isOpen()));
      const width = this.width();
      if (width) {
        localStorage.setItem('workspace.width', width);
      }
      localStorage.setItem('workspace.items', JSON.stringify(this.items));
    }

    isOpen() {
      return this.root?.dataset.open === 'true';
    }

    width() {
      if (!this.root) return 0;
      const raw = getComputedStyle(this.root).getPropertyValue('--wsw').trim();
      const value = parseInt(raw || '0', 10);
      return Number.isNaN(value) ? 0 : value;
    }

    setOpen(value, persist = true) {
      if (!this.root) return;
      this.root.dataset.open = String(value);
      this.root.classList.toggle('is-closed', !value);
      this.toggle?.setAttribute('aria-expanded', String(value));
      if (persist) {
        this.persist();
      }
    }

    bind() {
      this.toggle.addEventListener('click', () => this.setOpen(!this.isOpen()));
      this.clear.addEventListener('click', () => {
        this.items = [];
        this.render();
        this.persist();
      });

      if (this.resizer) {
        this.resizer.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const startX = ev.clientX;
          const startWidth = this.width();
          const min = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--wsw-min'), 10) || 280;
          const max = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--wsw-max'), 10) || 640;

          const onMove = (moveEv) => {
            const currentX = moveEv.clientX;
            const dx = currentX - startX;
            let next = startWidth - dx;
            next = Math.min(Math.max(next, min), max);
            this.root.style.setProperty('--wsw', `${next}px`);
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this.persist();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      const dropHighlightOn = () => this.root?.classList.add('ws-drop-ok');
      const dropHighlightOff = () => this.root?.classList.remove('ws-drop-ok');

      this.list.addEventListener('dragover', (ev) => {
        if (!ev.dataTransfer) return;
        ev.preventDefault();
        dropHighlightOn();
        const types = Array.from(ev.dataTransfer.types || []);
        ev.dataTransfer.dropEffect = types.includes('text/ws') ? 'move' : 'copy';
      });

      this.list.addEventListener('dragenter', dropHighlightOn);
      this.list.addEventListener('dragleave', (ev) => {
        if (ev.relatedTarget && this.list.contains(ev.relatedTarget)) return;
        dropHighlightOff();
      });

      this.list.addEventListener('drop', (ev) => {
        if (!ev.dataTransfer) return;
        ev.preventDefault();
        const types = Array.from(ev.dataTransfer.types || []);
        if (types.includes('text/ws')) return;
        dropHighlightOff();
        const id = ev.dataTransfer.getData('text/plain');
        this.add(id);
      });

      this.list.addEventListener('dragstart', (ev) => {
        const el = ev.target.closest('[data-ws-id]');
        if (!el || !ev.dataTransfer) return;
        ev.dataTransfer.setData('text/ws', el.dataset.wsId);
        ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });

      this.list.addEventListener('dragend', (ev) => {
        const el = ev.target.closest('[data-ws-id]');
        el?.classList.remove('dragging');
        dropHighlightOff();
      });

      this.list.addEventListener('dragover', (ev) => {
        const types = Array.from(ev.dataTransfer?.types || []);
        if (!types.includes('text/ws')) return;
        ev.preventDefault();
      });

      this.list.addEventListener('drop', (ev) => {
        const types = Array.from(ev.dataTransfer?.types || []);
        if (!types.includes('text/ws')) return;
        ev.preventDefault();
        dropHighlightOff();
        const src = ev.dataTransfer.getData('text/ws');
        const target = ev.target.closest('[data-ws-id]');
        if (!src || !target || src === target.dataset.wsId) return;
        const from = this.items.indexOf(src);
        const to = this.items.indexOf(target.dataset.wsId);
        if (from === -1 || to === -1) return;
        this.items.splice(to, 0, this.items.splice(from, 1)[0]);
        this.render();
        this.persist();
      });
    }

    add(id) {
      if (!id) return;
      if (!this.items.includes(id)) {
        this.items.push(id);
        this.render();
        this.persist();
      } else {
        this.render();
      }
      if (!this.isOpen()) {
        this.setOpen(true);
      }
    }

    remove(id) {
      const index = this.items.indexOf(id);
      if (index === -1) return;
      this.items.splice(index, 1);
      this.render();
      this.persist();
    }

    refresh() {
      this.render();
    }

    render() {
      if (!this.list) return;
      this.list.innerHTML = '';
      this.items.forEach((id) => {
        const card = document.createElement('div');
        card.className = 'ws-card';
        card.draggable = true;
        card.dataset.wsId = id;
        const source = document.querySelector(`.result-card[data-id="${CSS.escape(id)}"] .card-title`);
        card.textContent = source?.textContent?.trim() || id;
        this.list.appendChild(card);
      });
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const manager = new Workspace();
    if (manager.root) {
      window.__workspace = manager;
    }
  });
})();
