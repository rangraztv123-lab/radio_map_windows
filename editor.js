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

// ================= Workspace Panel =================
class Workspace {
  constructor() {
    this.root = document.getElementById('workspace');
    this.list = document.getElementById('ws-list');
    this.toggleBtn = document.getElementById('ws-toggle');
    this.clearBtn = document.getElementById('ws-clear');
    this.resizer = this.root ? this.root.querySelector('.ws-resizer') : null;
    this.hint = this.root ? this.root.querySelector('.ws-hint') : null;
    this.cardCache = new Map();
    this.items = [];
    this.draggingId = null;
    this.draggingFromWorkspace = false;
    this.currentProject = '';

    window.Workspace = this;

    if (!this.root || !this.list || !this.toggleBtn) {
      return;
    }

    this.minWidth = this.getSize('--wsw-min', 280);
    this.maxWidth = this.getSize('--wsw-max', 640);

    this.loadState();
    this.applyOpenState(this.isOpen);
    this.applyWidth(this.width);

    this.bindEvents();
    this.render();

    window.Workspace = this;
  }

  getSize(varName, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  parseInitialWidth() {
    const inline = this.root.style.getPropertyValue('--wsw') || getComputedStyle(this.root).getPropertyValue('--wsw');
    const parsed = parseFloat(inline);
    return Number.isFinite(parsed) ? parsed : 360;
  }

  loadState() {
    const storedOpen = localStorage.getItem('workspace:open');
    this.isOpen = storedOpen === null ? this.root.dataset.open === 'true' : storedOpen === 'true';

    const storedWidth = parseFloat(localStorage.getItem('workspace:width'));
    this.width = Number.isFinite(storedWidth) ? storedWidth : this.parseInitialWidth();
    this.width = this.clampWidth(this.width);

    try {
      const saved = JSON.parse(localStorage.getItem('workspace:items'));
      this.items = Array.isArray(saved) ? saved.map((item) => this.normalizeItem(item)).filter(Boolean) : [];
    } catch (e) {
      this.items = [];
    }
  }

  normalizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (!item.id) return null;
    const tags = Array.isArray(item.tags)
      ? item.tags
      : typeof item.tags === 'string'
        ? item.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
    return {
      id: item.id,
      project: item.project || '',
      index: typeof item.index === 'number' ? item.index : Number(item.index) || 0,
      file: item.file || '',
      desc: item.desc || '',
      tags,
      used: !!item.used
    };
  }

  clampWidth(width) {
    return Math.min(this.maxWidth, Math.max(this.minWidth, Number.isFinite(width) ? width : this.parseInitialWidth()));
  }

  applyWidth(width) {
    const val = this.clampWidth(width);
    this.width = val;
    this.root.style.setProperty('--wsw', `${val}px`);
    localStorage.setItem('workspace:width', String(val));
  }

  applyOpenState(open) {
    this.isOpen = !!open;
    this.root.dataset.open = String(this.isOpen);
    this.toggleBtn.setAttribute('aria-expanded', String(this.isOpen));
    this.root.classList.toggle('is-closed', !this.isOpen);
    localStorage.setItem('workspace:open', this.isOpen ? 'true' : 'false');
  }

  bindEvents() {
    this.toggleBtn.addEventListener('click', () => {
      this.applyOpenState(!this.isOpen);
    });

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        if (!this.items.length) return;
        if (!window.confirm('Clear all workspace items?')) return;
        this.items = [];
        this.saveItems();
        this.render();
      });
    }

    if (this.resizer) {
      this.resizer.addEventListener('pointerdown', (e) => this.onResizeStart(e));
    }

    this.list.addEventListener('dragover', (e) => this.onListDragOver(e));
    this.list.addEventListener('dragleave', (e) => this.onListDragLeave(e));
    this.list.addEventListener('drop', (e) => this.onListDrop(e));
  }

  onResizeStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.width;
    if (this.resizer && event.pointerId !== undefined) {
      try {
        this.resizer.setPointerCapture(event.pointerId);
      } catch (err) {
        /* noop */
      }
    }

    const onMove = (e) => {
      const delta = startX - e.clientX;
      this.applyWidth(startWidth + delta);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      if (this.resizer && event.pointerId !== undefined) {
        try {
          this.resizer.releasePointerCapture(event.pointerId);
        } catch (err) {
          /* noop */
        }
      }
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  }

  acceptsDrag(event) {
    const types = event?.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('text/plain');
  }

  onListDragOver(event) {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.list.classList.add('ws-drop-ok');
    event.dataTransfer.dropEffect = this.draggingFromWorkspace ? 'move' : 'copy';
  }

  onListDragLeave(event) {
    if (!this.list.contains(event.relatedTarget)) {
      this.list.classList.remove('ws-drop-ok');
    }
  }

  onListDrop(event) {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.list.classList.remove('ws-drop-ok');
    const id = event.dataTransfer.getData('text/plain');
    if (!id) return;
    const index = this.getDropIndex(event.clientY);
    if (this.draggingFromWorkspace && this.draggingId === id) {
      this.moveItem(id, index);
    } else {
      this.addItem(id, index);
    }
    this.draggingId = null;
    this.draggingFromWorkspace = false;
  }

  getDropIndex(clientY) {
    const cards = Array.from(this.list.querySelectorAll('.ws-card'));
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  addItem(id, index) {
    const raw = this.cardCache.get(id) || this.extractFromDom(id);
    const data = this.normalizeItem(raw);
    if (!data) return;

    const existing = this.items.findIndex((item) => item.id === id);
    if (existing !== -1) {
      this.moveItem(id, index);
      return;
    }

    const targetIndex = typeof index === 'number' && index >= 0 ? Math.min(index, this.items.length) : this.items.length;
    this.items.splice(targetIndex, 0, data);
    this.saveItems();
    this.render();
    if (!this.isOpen) this.applyOpenState(true);
  }

  moveItem(id, index) {
    const from = this.items.findIndex((item) => item.id === id);
    if (from === -1) return;

    let to = typeof index === 'number' ? index : this.items.length - 1;
    to = Math.max(0, Math.min(to, this.items.length));
    const [item] = this.items.splice(from, 1);
    if (to > from) to -= 1;
    this.items.splice(to, 0, item);
    this.saveItems();
    this.render();
  }

  removeItem(id) {
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.saveItems();
    this.render();
  }

  saveItems() {
    localStorage.setItem('workspace:items', JSON.stringify(this.items));
  }

  createWorkspaceCard(item) {
    const card = document.createElement('div');
    card.className = 'ws-card card';
    card.dataset.id = item.id;
    card.setAttribute('draggable', 'true');

    const title = document.createElement('div');
    title.textContent = item.file || '(No file)';
    title.style.fontWeight = '600';
    title.style.color = '#d5ddff';
    card.appendChild(title);

    if (item.desc) {
      const desc = document.createElement('div');
      desc.textContent = item.desc;
      desc.style.opacity = '0.8';
      desc.style.fontSize = '0.9rem';
      card.appendChild(desc);
    }

    const meta = [];
    if (item.project) meta.push(`Project: ${item.project}`);
    if (item.used) meta.push('Marked as used');
    if (meta.length) {
      const metaEl = document.createElement('div');
      metaEl.className = 'muted';
      metaEl.style.fontSize = '0.8rem';
      metaEl.textContent = meta.join(' • ');
      card.appendChild(metaEl);
    }

    if (item.tags && item.tags.length) {
      const tags = document.createElement('div');
      tags.style.display = 'flex';
      tags.style.flexWrap = 'wrap';
      tags.style.gap = '6px';
      item.tags.forEach((tag) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tags.appendChild(span);
      });
      card.appendChild(tags);
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = '8px';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this.removeItem(item.id);
    });
    actions.appendChild(remove);
    card.appendChild(actions);

    card.addEventListener('dragstart', (e) => this.onWorkspaceDragStart(e, item.id, card));
    card.addEventListener('dragend', () => this.onWorkspaceDragEnd(card));
    card.addEventListener('dragover', (e) => this.onWorkspaceItemDragOver(e));

    return card;
  }

  onWorkspaceDragStart(event, id, card) {
    this.draggingFromWorkspace = true;
    this.draggingId = id;
    card.classList.add('dragging');
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
  }

  onWorkspaceDragEnd(card) {
    card.classList.remove('dragging');
    this.draggingFromWorkspace = false;
    this.draggingId = null;
  }

  onWorkspaceItemDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  render() {
    if (!this.list) return;
    this.list.classList.remove('ws-drop-ok');
    this.list.innerHTML = '';

    if (!this.items.length) {
      if (this.hint) this.hint.style.display = '';
      return;
    }

    const fragment = document.createDocumentFragment();
    this.items.forEach((item) => {
      fragment.appendChild(this.createWorkspaceCard(item));
    });
    this.list.appendChild(fragment);
    if (this.hint) this.hint.style.display = 'none';
  }

  extractFromDom(id) {
    if (!id) return null;
    if (this.cardCache.has(id)) {
      return this.cardCache.get(id);
    }
    const selector = `[data-id="${CSS.escape(id)}"]`;
    const el = document.querySelector(selector);
    if (!el) {
      return this.items.find((item) => item.id === id) || null;
    }
    const info = {
      id,
      project: el.dataset.project || this.currentProject || '',
      index: Number(el.dataset.index) || 0,
      file: el.dataset.file || el.querySelector('.path')?.textContent?.trim() || '',
      desc: el.dataset.desc || '',
      tags: el.dataset.tags ? el.dataset.tags.split(',').filter(Boolean) : Array.from(el.querySelectorAll('.tag')).map((tag) => tag.textContent.trim()),
      used: el.dataset.used === '1' || el.dataset.used === 'true'
    };
    const normalized = this.normalizeItem(info);
    this.cardCache.set(id, normalized);
    return normalized;
  }

  updateItem(info) {
    const idx = this.items.findIndex((item) => item.id === info.id);
    if (idx === -1) return false;
    const current = this.items[idx];
    const next = { ...current, ...info, tags: Array.isArray(info.tags) ? info.tags : current.tags };
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    if (changed) {
      this.items[idx] = next;
      this.saveItems();
    }
    return changed;
  }

  registerResultCard(card, meta = {}) {
    if (!card) return;
    const id = card.dataset.id || this.composeId(meta.project, meta.index);
    if (!id) return;
    card.dataset.id = id;
    if (meta.project) card.dataset.project = meta.project;
    if (typeof meta.index === 'number') card.dataset.index = String(meta.index);

    const info = this.normalizeItem(this.buildInfoFromMeta(id, card, meta));
    if (!info) return;
    this.cardCache.set(id, info);
    this.updateItem(info);
  }

  buildInfoFromMeta(id, card, meta) {
    const dataset = card.dataset || {};
    const data = meta.data || {};
    const tags = Array.isArray(data.tags)
      ? data.tags
      : dataset.tags
        ? dataset.tags.split(',').filter(Boolean)
        : Array.from(card.querySelectorAll('.tag')).map((tag) => tag.textContent.trim());
    const info = {
      id,
      project: meta.project || dataset.project || this.currentProject || '',
      index: typeof meta.index === 'number' ? meta.index : Number(dataset.index) || 0,
      file: data.file || dataset.file || card.querySelector('.path')?.textContent?.trim() || '',
      desc: data.desc || dataset.desc || '',
      tags,
      used: Boolean(data.used || dataset.used === '1' || dataset.used === 'true')
    };
    if (info.tags && !Array.isArray(info.tags)) {
      info.tags = [info.tags];
    }
    card.dataset.file = info.file;
    card.dataset.desc = info.desc;
    card.dataset.tags = info.tags.join(',');
    card.dataset.used = info.used ? '1' : '0';
    return info;
  }

  addItemFromCard(card) {
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    this.addItem(id, this.items.length);
  }

  refresh() {
    let changed = false;
    this.items = this.items.map((item) => {
      const cached = this.cardCache.get(item.id);
      if (!cached) return item;
      const next = this.normalizeItem({ ...item, ...cached, tags: Array.isArray(cached.tags) ? cached.tags : item.tags });
      if (JSON.stringify(item) !== JSON.stringify(next)) {
        changed = true;
      }
      return next;
    });
    if (changed) {
      this.saveItems();
    }
    this.render();
  }

  setProject(project, data) {
    this.currentProject = project;
    if (!Array.isArray(data)) {
      return;
    }
    data.forEach((item, index) => {
      const id = this.composeId(project, index);
      const info = {
        id,
        project,
        index,
        file: item.file,
        desc: item.desc || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        used: !!item.used
      };
      const normalized = this.normalizeItem(info);
      this.cardCache.set(id, normalized);
      this.updateItem(normalized);
    });
    this.render();
  }

  composeId(project, index) {
    if (!project || typeof index !== 'number') return null;
    return `${project}:${index}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__workspace = new Workspace();
});
