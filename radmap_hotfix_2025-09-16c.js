
(function(){
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function t(s){ return (s||'').replace(/\s+/g,' ').trim(); }
  function el(q, r){ return (r||document).querySelector(q); }
  function els(q, r){ return Array.prototype.slice.call((r||document).querySelectorAll(q)); }

  function hideBrokenDuplicate(){
    var broken = document.getElementById('filterUsedBtn');
    if (broken) broken.style.display = 'none';
  }

  function detectProjectFromBanner(){
    var nodes = els('h1,h2,h3,div,span,small');
    for (var i=0;i<nodes.length;i++){
      var s = t(nodes[i].textContent || '');
      if (!s) continue;
      if (/پروژه/.test(s) && /«[^»]+»/.test(s)){
        var m = s.match(/«([^»]+)»/);
        if (m && m[1]) return m[1];
      }
    }
    return null;
  }
  function detectProject(cb){
    var fromBanner = detectProjectFromBanner();
    if (fromBanner) return cb(fromBanner);
    if (window.currentProject && typeof window.currentProject === 'string') return cb(window.currentProject);
    var sel = el('#projectSelect'); if (sel && sel.value) return cb(sel.value);
    fetch('/api/projects').then(r=>r.json()).then(list=>cb(list && list[0] || '')).catch(()=>{});
  }

  function renderGlobalTagsFor(projectName){
    if (!projectName) return;
    var title = els('h1,h2,h3,h4,h5,.title,.card-title').find(function(h){
      return /پیشنهاد *تگ‌های *مرتبط/.test(t(h.textContent));
    });
    if (!title) return;
    var panel = title.closest('.card, .panel, .box, .container, .section') || title.parentElement || document.body;

    var boxId = 'rm_all_tags_overview_box';
    var box = document.getElementById(boxId);
    if (!box){
      box = document.createElement('div');
      box.id = boxId;
      var header = document.createElement('div');
      header.className = title.className || 'title';
      header.style.marginTop = '10px';
      header.style.marginBottom = '6px';
      header.textContent = 'نمای کلی تگ‌ها';
      var host = document.createElement('div');
      host.className = 'chips';
      host.style.marginBottom = '12px';
      box.appendChild(header);
      box.appendChild(host);
      panel.appendChild(box);
    }
    var hostNode = box.lastChild;

    fetch('/api/data/' + encodeURIComponent(projectName))
      .then(function(r){ return r.json(); })
      .then(function(rows){
        var map = new Map();
        (rows||[]).forEach(function(row){
          (row.tags||[]).forEach(function(tag){
            tag = t(tag);
            if (!tag) return;
            map.set(tag, (map.get(tag)||0) + 1);
          });
        });
        hostNode.innerHTML = '';
        var arr = Array.from(map.entries()).sort(function(a,b){
          if (b[1] !== a[1]) return b[1]-a[1];
          return a[0].localeCompare(b[0], 'fa');
        });
        arr.forEach(function(pair){
          var name = pair[0], count = pair[1];
          var chip = document.createElement('div');
          chip.className = 'chip';
          chip.textContent = count>1 ? (name + ' ('+count+')') : name;
          chip.style.cursor = 'pointer';
          chip.onclick = function(){
            var input = el('input[type="search"], input[type="text"]');
            if (input){
              input.value = name;
              input.dispatchEvent(new Event('input', {bubbles:true}));
              input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
              input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', bubbles:true}));
            }
          };
          hostNode.appendChild(chip);
        });
      })
      .catch(function(){});
  }

  function boot(){
    hideBrokenDuplicate();
    detectProject(function(p){
      renderGlobalTagsFor(p);
      var sel = el('#projectSelect');
      if (sel){
        sel.addEventListener('change', function(){ renderGlobalTagsFor(sel.value); });
      }
    });
  }
  ready(boot);
})();
