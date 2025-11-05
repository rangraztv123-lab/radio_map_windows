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

// ================= Workspace Manager =================
class WorkspaceManager {
  constructor(){
    this.STORAGE_KEYS = {
      items: 'workspace.items',
      width: 'workspace.width',
      open: 'workspace.open'
    };
    this.CARD_MIME = 'application/x-radio-card-id';
    this.WORKSPACE_MIME = 'application/x-workspace-item';
    this.MIN_WIDTH = 260;
    this.DEFAULT_WIDTH = 320;

    this.panel = null;
    this.list = null;
    this.hint = null;
    this.toggle = null;
    this.resizer = null;
    this.clearBtn = null;

    this.project = null;
    this.data = [];
    this.items = this.loadItems();
    this.width = this.loadWidth();
    this.open = this.loadOpen();

    this.initialized = false;
    this.dropDepth = 0;
    this.lastAddedId = null;
    this.boundResizeHandler = this.handleWindowResize.bind(this);
  }

  init(){
    if (this.initialized) return;

    this.panel = document.getElementById('workspacePanel');
    this.list = document.getElementById('workspaceList');
    this.hint = document.getElementById('workspaceHint');
    this.toggle = document.getElementById('workspaceToggle');
    this.resizer = document.getElementById('workspaceResizer');
    this.clearBtn = document.getElementById('workspaceClear');

    if (!this.panel || !this.list || !this.toggle){
      return;
    }

    document.body.classList.add('workspace-ready');

    this.applyWidth(this.width, false);
    this.applyOpen(this.open, false);

    this.toggle.addEventListener('click', () => this.toggleOpen());
    if (this.clearBtn){
      this.clearBtn.addEventListener('click', () => this.handleClear());
    }

    this.setupResizer();
    this.setupDropZone();
    window.addEventListener('resize', this.boundResizeHandler);

    this.initialized = true;
    this.render();
  }

  destroy(){
    window.removeEventListener('resize', this.boundResizeHandler);
  }

  setProject(projectName, data){
    this.project = projectName || null;
    this.data = Array.isArray(data) ? data : [];
    if (!this.initialized) return;
    this.removeMissingItems();
    this.render();
  }

  refresh(){
    if (!this.initialized) return;
    this.removeMissingItems();
    this.render();
  }

  registerResultCard(card, payload){
    if (!card || !payload) return;
    const project = payload.project || this.project;
    const index = typeof payload.index === 'number' ? payload.index : Number(payload.index);
    if (!project || Number.isNaN(index)) return;
    const id = this.composeId(project, index);
    card.dataset.workspaceId = id;
    const grip = card.querySelector('.card-grip');
    if (!grip || grip.dataset.wsBound === 'true') return;

    grip.dataset.wsBound = 'true';
    grip.setAttribute('draggable', 'true');

    grip.addEventListener('dragstart', (ev) => {
      ev.stopPropagation();
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(this.CARD_MIME, id);
      ev.dataTransfer.setData('text/plain', id);
      card.classList.add('drag-source', 'dragging');
      document.body.classList.add('workspace-dragging');
    });

    grip.addEventListener('dragend', () => {
      card.classList.remove('drag-source', 'dragging');
      document.body.classList.remove('workspace-dragging');
    });
  }

  addItemFromCard(card, targetIndex){
    if (!card) return;
    const id = card.dataset.workspaceId;
    if (!id) return;
    this.addItemById(id, targetIndex);
  }

  addItemById(id, targetIndex){
    const parsed = this.parseId(id);
    if (!parsed || !this.project || parsed.project !== this.project) return;
    if (parsed.index < 0 || parsed.index >= this.data.length) return;

    const projectItems = this.getProjectItems();
    const existing = projectItems.indexOf(id);
    let insertIndex = typeof targetIndex === 'number' ? targetIndex : projectItems.length;
    insertIndex = Math.max(0, Math.min(insertIndex, projectItems.length));

    if (existing !== -1){
      projectItems.splice(existing, 1);
      if (insertIndex > existing) insertIndex -= 1;
    }

    projectItems.splice(insertIndex, 0, id);
    this.replaceProjectItems(projectItems);
    this.lastAddedId = id;
    this.render();
  }

  moveItem(id, targetIndex){
    this.addItemById(id, targetIndex);
  }

  removeItem(id){
    const before = this.items.length;
    this.items = this.items.filter(item => item !== id);
    if (this.items.length !== before){
      this.saveItems();
      this.render();
    }
  }

  handleClear(){
    if (!this.project) return;
    const projectItems = this.getProjectItems();
    if (!projectItems.length) return;
    this.replaceProjectItems([]);
    this.render();
  }

  toggleOpen(){
    this.applyOpen(!this.open);
  }

  setupResizer(){
    if (!this.resizer) return;
    let active = false;
    let startX = 0;
    let startWidth = this.width;

    const onMove = (ev) => {
      if (!active) return;
      const delta = startX - ev.clientX;
      const next = this.clampWidth(startWidth + delta);
      this.applyWidth(next, false);
    };

    const stop = (ev) => {
      if (!active) return;
      active = false;
      this.resizer.releasePointerCapture?.(ev.pointerId);
      document.body.classList.remove('workspace-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      this.applyWidth(this.width, true);
    };

    this.resizer.addEventListener('pointerdown', (ev) => {
      if (!this.open) return;
      ev.preventDefault();
      active = true;
      startX = ev.clientX;
      startWidth = this.width;
      document.body.classList.add('workspace-resizing');
      this.resizer.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    });
  }

  setupDropZone(){
    if (!this.panel) return;

    const onDragEnter = (ev) => {
      if (!this.supportsDrag(ev)) return;
      ev.preventDefault();
      this.dropDepth += 1;
      if (!this.open){
        this.applyOpen(true);
      }
      this.panel.classList.add('is-drop-target');
    };

    const onDragOver = (ev) => {
      if (!this.supportsDrag(ev)) return;
      ev.preventDefault();
      const isReorder = this.isWorkspaceDrag(ev);
      ev.dataTransfer.dropEffect = isReorder ? 'move' : 'copy';
      this.panel.classList.add('is-drop-target');
      this.panel.classList.toggle('is-drop-active', isReorder);
      this.updateDropMarker(ev);
    };

    const onDragLeave = (ev) => {
      if (!this.supportsDrag(ev)) return;
      this.dropDepth = Math.max(0, this.dropDepth - 1);
      if (this.dropDepth === 0){
        this.resetDropState();
      }
    };

    const onDrop = (ev) => {
      if (!this.supportsDrag(ev)) return;
      ev.preventDefault();
      const dropIndex = this.getDropIndex(ev);
      if (this.isWorkspaceDrag(ev)){
        const payload = this.safeParse(ev.dataTransfer.getData(this.WORKSPACE_MIME));
        const id = payload?.id || payload;
        if (id){
          this.moveItem(id, dropIndex);
        }
      }else{
        const id = ev.dataTransfer.getData(this.CARD_MIME) || ev.dataTransfer.getData('text/plain');
        if (id){
          this.addItemById(id, dropIndex);
        }
      }
      this.resetDropState();
    };

    this.panel.addEventListener('dragenter', onDragEnter);
    this.panel.addEventListener('dragover', onDragOver);
    this.panel.addEventListener('dragleave', onDragLeave);
    this.panel.addEventListener('drop', onDrop);
  }

  supportsDrag(ev){
    const types = Array.from(ev?.dataTransfer?.types || []);
    return types.includes(this.CARD_MIME) || types.includes(this.WORKSPACE_MIME);
  }

  isWorkspaceDrag(ev){
    const types = Array.from(ev?.dataTransfer?.types || []);
    return types.includes(this.WORKSPACE_MIME);
  }

  updateDropMarker(ev){
    if (!this.list) return;
    const items = Array.from(this.list.querySelectorAll('.workspace-item'));
    const filtered = items.filter(item => !item.classList.contains('dragging'));
    this.clearDropMarkers(items);
    if (!filtered.length) return;

    const index = this.getDropIndex(ev);
    if (index <= 0){
      filtered[0].classList.add('drop-before');
    }else if (index >= filtered.length){
      filtered[filtered.length - 1].classList.add('drop-after');
    }else{
      filtered[index].classList.add('drop-before');
    }
  }

  clearDropMarkers(items){
    (items || this.list?.querySelectorAll('.workspace-item')).forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  resetDropState(){
    this.dropDepth = 0;
    this.panel?.classList.remove('is-drop-target', 'is-drop-active');
    this.clearDropMarkers();
  }

  getDropIndex(ev){
    if (!this.list) return 0;
    const items = Array.from(this.list.querySelectorAll('.workspace-item')).filter(item => !item.classList.contains('dragging'));
    if (!items.length) return 0;
    const y = ev.clientY;
    for (let i = 0; i < items.length; i += 1){
      const rect = items[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2){
        return i;
      }
    }
    return items.length;
  }

  buildItem(id, data){
    const item = document.createElement('div');
    item.className = 'workspace-item';
    item.dataset.itemId = id;
    item.setAttribute('role', 'listitem');

    if (this.lastAddedId === id){
      item.classList.add('recent');
    }

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'workspace-item-grip';
    grip.setAttribute('aria-label', 'جابجایی کارت');
    item.appendChild(grip);

    const main = document.createElement('div');
    main.className = 'workspace-item-main';
    item.appendChild(main);

    const path = document.createElement('div');
    path.className = 'workspace-item-path';
    path.textContent = data.file || '';
    main.appendChild(path);

    if (data.desc){
      const desc = document.createElement('div');
      desc.className = 'workspace-item-desc';
      desc.textContent = data.desc;
      main.appendChild(desc);
    }

    if (Array.isArray(data.tags) && data.tags.length){
      const tags = document.createElement('div');
      tags.className = 'workspace-item-tags';
      data.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tags.appendChild(span);
      });
      main.appendChild(tags);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workspace-item-remove';
    removeBtn.setAttribute('aria-label', 'حذف از میز کار');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => this.removeItem(id));
    item.appendChild(removeBtn);

    this.attachWorkspaceDragHandlers(item, grip, id);

    return item;
  }

  attachWorkspaceDragHandlers(item, grip, id){
    if (!grip) return;
    const enable = (ev) => {
      ev.preventDefault();
      item.dataset.dragReady = 'true';
      item.draggable = true;
      grip.setPointerCapture?.(ev.pointerId);
    };
    const disable = () => {
      delete item.dataset.dragReady;
      item.draggable = false;
    };

    grip.addEventListener('pointerdown', (ev) => {
      enable(ev);
    });
    grip.addEventListener('pointerup', disable);
    grip.addEventListener('pointercancel', disable);
    grip.addEventListener('lostpointercapture', disable);

    item.addEventListener('dragstart', (ev) => {
      if (item.dataset.dragReady !== 'true'){
        ev.preventDefault();
        return;
      }
      disable();
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData(this.WORKSPACE_MIME, JSON.stringify({id}));
      ev.dataTransfer.setData('text/plain', id);
      item.classList.add('dragging');
      this.panel.classList.add('is-drop-target', 'is-drop-active');
      this.clearDropMarkers();
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      this.resetDropState();
    });
  }

  render(){
    if (!this.initialized || !this.list) return;
    this.list.innerHTML = '';

    const projectItems = this.getProjectItems();
    const validated = [];

    projectItems.forEach(id => {
      const parsed = this.parseId(id);
      if (!parsed) return;
      const row = this.data[parsed.index];
      if (!row) return;
      validated.push(id);
      this.list.appendChild(this.buildItem(id, row));
    });

    if (validated.length !== projectItems.length){
      this.replaceProjectItems(validated);
    }

    if (this.hint){
      this.hint.style.display = validated.length ? 'none' : '';
    }
    if (this.clearBtn){
      this.clearBtn.disabled = !validated.length;
    }

    this.lastAddedId = null;
  }

  getProjectItems(){
    if (!this.project) return [];
    return this.items.filter(id => this.isProjectItem(id));
  }

  replaceProjectItems(newProjectItems){
    const next = [];
    let inserted = false;
    this.items.forEach(id => {
      if (this.isProjectItem(id)){
        if (!inserted){
          newProjectItems.forEach(itemId => next.push(itemId));
          inserted = true;
        }
      }else{
        next.push(id);
      }
    });
    if (!inserted){
      newProjectItems.forEach(itemId => next.push(itemId));
    }
    this.items = next;
    this.saveItems();
  }

  removeMissingItems(){
    if (!this.project) return;
    const current = this.getProjectItems();
    const valid = current.filter(id => {
      const parsed = this.parseId(id);
      return parsed && parsed.project === this.project && parsed.index >= 0 && parsed.index < this.data.length;
    });
    if (valid.length !== current.length){
      this.replaceProjectItems(valid);
    }
  }

  composeId(project, index){
    return `${project}|${index}`;
  }

  parseId(id){
    if (typeof id !== 'string') return null;
    const [project, indexStr] = id.split('|');
    if (!project) return null;
    const index = Number(indexStr);
    if (!Number.isFinite(index)) return null;
    return {project, index};
  }

  isProjectItem(id){
    const parsed = this.parseId(id);
    return !!(parsed && this.project && parsed.project === this.project);
  }

  loadItems(){
    try{
      const raw = localStorage.getItem(this.STORAGE_KEYS.items);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)){
        return parsed.filter(item => typeof item === 'string');
      }
    }catch(err){
      console.warn('Workspace: failed to read items', err);
    }
    return [];
  }

  saveItems(){
    try{
      localStorage.setItem(this.STORAGE_KEYS.items, JSON.stringify(this.items));
    }catch(err){
      console.warn('Workspace: failed to persist items', err);
    }
  }

  loadWidth(){
    const stored = Number(localStorage.getItem(this.STORAGE_KEYS.width));
    if (Number.isFinite(stored)){
      return this.clampWidth(stored);
    }
    return this.DEFAULT_WIDTH;
  }

  saveWidth(width){
    try{
      localStorage.setItem(this.STORAGE_KEYS.width, String(Math.round(width)));
    }catch(err){
      console.warn('Workspace: failed to persist width', err);
    }
  }

  loadOpen(){
    const stored = localStorage.getItem(this.STORAGE_KEYS.open);
    if (stored === null) return true;
    return stored === 'true';
  }

  saveOpen(open){
    try{
      localStorage.setItem(this.STORAGE_KEYS.open, open ? 'true' : 'false');
    }catch(err){
      console.warn('Workspace: failed to persist open state', err);
    }
  }

  clampWidth(width){
    const max = this.getMaxWidth();
    return Math.min(Math.max(width, this.MIN_WIDTH), max);
  }

  getMaxWidth(){
    return Math.max(this.MIN_WIDTH, Math.floor(window.innerWidth * 0.6));
  }

  applyWidth(width, persist = true){
    this.width = this.clampWidth(width || this.DEFAULT_WIDTH);
    document.body.style.setProperty('--workspace-width', `${this.width}px`);
    if (persist){
      this.saveWidth(this.width);
    }
  }

  applyOpen(open, persist = true){
    this.open = !!open;
    document.body.classList.toggle('workspace-open', this.open);
    this.panel?.setAttribute('aria-hidden', this.open ? 'false' : 'true');
    this.toggle?.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    if (this.toggle){
      this.toggle.textContent = this.open ? '❯' : '❮';
      this.toggle.setAttribute('aria-label', this.open ? 'بستن میز کار' : 'باز کردن میز کار');
    }
    if (persist){
      this.saveOpen(this.open);
    }
  }

  handleWindowResize(){
    const max = this.getMaxWidth();
    if (this.width > max){
      this.applyWidth(max, true);
    }
  }

  safeParse(raw){
    try{
      return JSON.parse(raw);
    }catch(_err){
      return null;
    }
  }
}

window.Workspace = new WorkspaceManager();
