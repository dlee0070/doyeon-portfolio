/* ==========================================================
   관리도구 — 작업물/스터디/기본정보 편집기
   내 컴퓨터(관리도구.bat)에서는 로컬 서버(tools/serve.ps1) API로,
   웹(GitHub Pages)에서는 GitHub 저장소에 직접 저장합니다 (github.js).
   ========================================================== */
(function () {
  'use strict';

  var DATA = null;
  var dirty = false;
  var view = 'works';        // basic | works | studies | deploy
  var editing = null;        // { list: 'works'|'studies', id: string }
  var uploading = 0;
  var deployTimer = null;    // 배포 화면의 git 상태 자동 새로고침

  /* 웹(GitHub Pages)에서 열리면 로컬 서버 대신 이 저장소에 직접 커밋한다 */
  var GH = { owner: 'doyeonleeportfolio', repo: 'doyeonleeportfolio.github.io', branch: 'main' };
  var SITE_URL = 'https://doyeonleeportfolio.github.io';
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var MAX_WEB_UPLOAD = 50 * 1024 * 1024;   // ponytail: GitHub 이 50MB 넘는 파일에 경고한다 — 더 큰 영상은 압축하거나 로컬 관리도구(git push)로
  var store = null;          // GitHubStore — 웹에서 로그인한 뒤에만 생긴다
  var pendingUploads = {};   // 웹: 저장 전까지 브라우저가 들고 있는 새 파일 { 경로: File }
  var pendingDeletes = {};   // 웹: 저장할 때 함께 지울 경로 (파일 또는 폴더)
  var previewUrls = {};      // 아직 사이트에 없는 파일의 미리보기 주소 (blob:)

  var main = document.getElementById('main');
  var saveBtn = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var banner = document.getElementById('offlineBanner');
  var navBtns = Array.prototype.slice.call(document.querySelectorAll('.side-link'));

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2600);
  }

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function field(labelText, control, hintText) {
    var f = el('div', 'field');
    var lab = el('label', 'field-label', labelText);
    f.appendChild(lab);
    f.appendChild(control);
    if (hintText) f.appendChild(el('p', 'field-hint', hintText));
    return f;
  }

  function input(value, onInput, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value == null ? '' : value;   // 0 도 값이다 (hover 시작점 0초)
    if (placeholder) i.placeholder = placeholder;
    i.addEventListener('input', function () { onInput(i.value); setDirty(); });
    return i;
  }

  function checkbox(checked, onChange, labelText) {
    var lab = el('label', 'check-row');
    var c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!checked;
    c.addEventListener('change', function () { onChange(c.checked); setDirty(); });
    lab.appendChild(c);
    lab.appendChild(document.createTextNode(labelText));
    return lab;
  }

  function select(value, options, onChange) {
    var s = document.createElement('select');
    options.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = String(value);
    s.addEventListener('change', function () { onChange(s.value); setDirty(); });
    return s;
  }

  function textarea(value, rows, onInput) {
    var ta = document.createElement('textarea');
    ta.value = value || '';
    ta.rows = rows;
    ta.addEventListener('input', function () { onInput(ta.value); setDirty(); });
    return ta;
  }

  /* "a, b, c" → ['a','b','c'] */
  function splitList(v) {
    return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function joinList(arr) {
    return Array.isArray(arr) ? arr.join(', ') : String(arr || '');
  }

  /* 홈 문양의 주제 키 — js/home.js MOTIFS 와 같은 어휘 */
  var THEMES = [
    ['heritage', 'Cultural Heritage'],
    ['media', 'Interactive Media Art'],
    ['xr', 'XR'],
    ['data', 'Data Analysis'],
    ['moving', 'Moving Image']
  ];

  function slugBase(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function uniqueId(title) {
    var base = slugBase(title) || 'item';
    /* 'about' / 'studies' 는 공용 미디어 폴더 — 항목 id 로 쓰이면 삭제 시 그 폴더가 날아간다 */
    var all = ['about', 'studies'].concat(DATA.works.concat(DATA.studies).map(function (x) { return x.id; }));
    var id = base, n = 2;
    while (all.indexOf(id) >= 0) { id = base + '-' + n; n++; }
    return id;
  }

  function fileSlug(name) {
    var dot = name.lastIndexOf('.');
    var ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    /* 한글은 보존한다 — 전부 지우면 여러 파일이 같은 이름(file.glb)으로 덮어써진다 */
    var base = String(dot >= 0 ? name.slice(0, dot) : name).toLowerCase()
      .replace(/[^0-9a-z가-힣]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file';
    return base + ext;
  }

  /* 사이트 데이터에서 이미 쓰고 있는 미디어 경로 전부 */
  function usedMediaPaths() {
    var used = {};
    (DATA.works || []).concat(DATA.studies || []).forEach(function (it) {
      if (it.cover) used[it.cover] = true;
      (it.media || []).forEach(function (m) { if (m.src) used[m.src] = true; });
    });
    if (DATA.about && DATA.about.image) used[DATA.about.image] = true;
    if (DATA.about && DATA.about.cvPdf) used[DATA.about.cvPdf] = true;
    if (DATA.studiesGif) used[DATA.studiesGif] = true;
    return used;
  }

  function extType(src) {
    var m = /\.([a-z0-9]+)$/i.exec(src || '');
    var e = m ? m[1].toLowerCase() : '';
    if (['mp4', 'webm', 'mov', 'm4v'].indexOf(e) >= 0) return 'video';
    if (['glb', 'gltf'].indexOf(e) >= 0) return 'model';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'].indexOf(e) >= 0) return 'image';
    return null;
  }

  function setDirty() {
    dirty = true;
    saveStatus.textContent = '저장되지 않은 변경사항이 있습니다';
    saveStatus.classList.add('dirty');
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty || uploading > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- API ---------- */

  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  /* 관리도구 안의 미리보기 주소 — 방금 올려서 아직 사이트에 없는 파일은 브라우저 사본으로 */
  function mediaUrl(src) {
    return previewUrls[src] || '/' + src;
  }

  function apiUpload(file, destRel) {
    if (store) {
      if (file.size > MAX_WEB_UPLOAD) {
        return Promise.reject(new Error('50MB가 넘는 파일은 웹에서 올릴 수 없습니다 — 영상을 압축하거나 YouTube·Vimeo 링크로 넣어 주세요'));
      }
      pendingUploads[destRel] = file;
      delete pendingDeletes[destRel];
      if (previewUrls[destRel]) URL.revokeObjectURL(previewUrls[destRel]);
      previewUrls[destRel] = URL.createObjectURL(file);
      setDirty();
      return Promise.resolve({ ok: true, path: destRel, size: file.size });
    }
    uploading++;
    return fetch('/api/upload?path=' + encodeURIComponent(destRel), { method: 'POST', body: file })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        uploading--;
        if (!j.ok) throw new Error(j.error || 'upload fail');
        return j;
      })
      .catch(function (e) { uploading--; throw e; });
  }

  function apiDelete(destRel) {
    if (store) {
      pendingDeletes[destRel] = true;
      Object.keys(pendingUploads).forEach(function (p) {
        if (p === destRel || p.indexOf(destRel + '/') === 0) delete pendingUploads[p];
      });
      setDirty();
      return Promise.resolve();
    }
    return api('/api/delete?path=' + encodeURIComponent(destRel), { method: 'POST' }).catch(function () {});
  }

  function save() {
    if (!DATA) return;
    if (store) { saveWeb(false); return; }
    saveBtn.disabled = true;
    api('/api/save-data', { method: 'POST', body: JSON.stringify(DATA, null, 2) })
      .then(function (j) {
        saveBtn.disabled = false;
        if (j.ok) {
          dirty = false;
          saveStatus.classList.remove('dirty');
          var t = new Date();
          saveStatus.textContent = '저장됨 ' + t.toTimeString().slice(0, 8);
          toast('저장되었습니다 — 미리보기 탭을 새로고침하면 반영됩니다');
        } else {
          toast('저장 실패: ' + (j.error || '알 수 없는 오류'));
        }
      })
      .catch(function () {
        saveBtn.disabled = false;
        toast('저장 실패 — 서버가 실행 중인지 확인해 주세요');
      });
  }

  /* 웹: 데이터 + 새 파일 + 삭제를 커밋 하나로. 저장이 곧 사이트 반영이다 */
  function saveWeb(force) {
    saveBtn.disabled = true;
    var text = 'window.SITE_DATA = ' + JSON.stringify(DATA, null, 2) + ';\n';
    var ups = {};
    Object.keys(pendingUploads).forEach(function (p) { ups[p] = pendingUploads[p]; });
    var dels = Object.keys(pendingDeletes);
    var msg = '관리도구에서 저장 — ' + new Date().toLocaleString('sv-SE').slice(0, 16);
    saveStatus.textContent = '저장 중…';
    store.commit(text, ups, dels, msg, force, function (m) { saveStatus.textContent = m; })
      .then(function () {
        saveBtn.disabled = false;
        Object.keys(ups).forEach(function (p) { if (pendingUploads[p] === ups[p]) delete pendingUploads[p]; });
        dels.forEach(function (p) { delete pendingDeletes[p]; });
        dirty = false;
        saveStatus.classList.remove('dirty');
        saveStatus.textContent = '저장됨 · 사이트 반영 중…';
        toast('저장되었습니다 — 1분쯤 뒤 사이트에 반영됩니다');
        watchLive(text, function (ok) {
          if (dirty) return;   // 그 사이 또 고쳤으면 상태줄은 그쪽 몫
          saveStatus.textContent = ok
            ? '사이트에 반영됨 ✓ ' + new Date().toTimeString().slice(0, 5)
            : '저장됨 · 반영 확인이 늦어집니다 — 사이트를 새로고침해 보세요';
        });
      })
      .catch(function (e) {
        saveBtn.disabled = false;
        setDirty();
        if (e.code === 'conflict') {
          if (window.confirm('다른 곳(다른 기기나 탭)에서 먼저 저장된 내용이 있습니다.\n\n' +
              '지금 이 화면의 내용으로 덮어쓸까요?\n' +
              '취소하면 아무것도 바뀌지 않습니다 — 새로고침하면 최신 내용을 불러옵니다.')) {
            saveWeb(true);
          }
          return;
        }
        var why = e.status === 401 ? '로그인이 만료되었습니다 — 로그아웃 후 새 토큰으로 다시 로그인해 주세요'
          : e.status === 403 || e.status === 404 ? '저장 권한이 없습니다 — 토큰의 Contents 권한(Read and write)과 조직 승인을 확인해 주세요'
          : '저장 실패';
        toast(why);
        /* 토스트는 금방 사라진다 — 이유는 상단 상태줄에 남긴다 */
        saveStatus.textContent = why + ' · ' + e.message;
      });
  }

  /* 사이트가 방금 저장한 data.js 를 내보내기 시작하면 반영 끝 */
  var liveTimer = null;
  function watchLive(text, done) {
    var want = text.replace(/\r\n/g, '\n');
    var origin = LOCAL ? SITE_URL : location.origin;
    var tries = 0;
    if (liveTimer) clearTimeout(liveTimer);
    function again() {
      if (++tries >= 40) { done(false); return; }   // 6초 × 40 = 4분
      liveTimer = setTimeout(poll, 6000);
    }
    function poll() {
      fetch(origin + '/content/data.js?live=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) { if (t.replace(/\r\n/g, '\n') === want) done(true); else again(); })
        .catch(again);
    }
    poll();
  }

  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  /* ---------- 파일 선택/업로드 공통 ---------- */

  function pickFiles(accept, multiple, cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = !!multiple;
    inp.addEventListener('change', function () {
      if (inp.files.length) cb(Array.prototype.slice.call(inp.files));
    });
    inp.click();
  }

  function uploadInto(folder, files, done) {
    var results = [];
    var taken = usedMediaPaths();
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var name = fileSlug(f.name);
        var rel = 'content/media/' + folder + '/' + name;
        /* 같은 이름이 이미 있으면 -2, -3… 을 붙여 덮어쓰기를 막는다 */
        var dot = name.lastIndexOf('.');
        var base = dot >= 0 ? name.slice(0, dot) : name;
        var ext = dot >= 0 ? name.slice(dot) : '';
        var n = 2;
        while (taken[rel]) {
          rel = 'content/media/' + folder + '/' + base + '-' + n + ext;
          n++;
        }
        taken[rel] = true;
        return apiUpload(f, rel).then(function () { results.push(rel); });
      });
    });
    chain
      .then(function () { done(null, results); })
      .catch(function (e) { done(e, results); });
  }

  function uploadButton(labelText, accept, multiple, folder, onDone) {
    var b = el('button', 'upload-btn', labelText);
    b.addEventListener('click', function () {
      pickFiles(accept, multiple, function (files) {
        b.classList.add('busy');
        b.textContent = '업로드 중…';
        uploadInto(folder, files, function (err, paths) {
          b.classList.remove('busy');
          b.textContent = labelText;
          if (err) { toast('업로드 실패: ' + err.message); }
          if (paths.length) onDone(paths);
        });
      });
    });
    return b;
  }

  /* ---------- 렌더링 ---------- */

  function render() {
    navBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view && !editing);
    });
    if (deployTimer) { clearInterval(deployTimer); deployTimer = null; }
    main.textContent = '';
    if (editing) { renderEditor(); return; }
    if (view === 'basic') renderBasic();
    else if (view === 'works') renderList('works');
    else if (view === 'deploy') renderDeploy();
    else renderList('studies');
  }

  navBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      view = b.getAttribute('data-view');
      editing = null;
      render();
    });
  });

  /* ----- 기본 정보 ----- */

  function renderBasic() {
    main.appendChild(el('h2', 'section-title', '기본 정보'));

    main.appendChild(field('상단에 표시되는 이름', input(DATA.siteName, function (v) { DATA.siteName = v; }), '예: DOYEON LEE'));

    main.appendChild(field('홈 화면 한 줄 소개 (영문)',
      input(DATA.siteTagline, function (v) { DATA.siteTagline = v; }, 'Media artist in Seoul working between …'),
      '화면에는 보이지 않고 검색엔진(구글)만 읽는 소개 문장입니다. 이름·분야·도시가 들어가면 좋습니다.'));

    main.appendChild(field('About — Artist Statement (영문 권장)',
      textarea(DATA.about.statement || DATA.about.text, 8, function (v) { DATA.about.statement = v; DATA.about.text = v; }),
      '1인칭 · 80~120단어 · 빈 줄로 문단 구분. 무엇을 다루고, 어떤 질문을 던지는지.'));

    main.appendChild(field('About — Biography (영문, 3인칭)',
      textarea(DATA.about.bio, 4, function (v) { DATA.about.bio = v; }),
      '"Doyeon Lee is a media artist …" 처럼 3인칭 · 80단어 이내. 큐레이터·전시 도록이 그대로 가져다 쓰는 문단입니다.'));

    main.appendChild(field('연구 방향 키워드 (Directions)',
      input(joinList(DATA.about.directions), function (v) { DATA.about.directions = splitList(v); }, 'Interactive Installation, XR & Immersive Space, …'),
      '쉼표로 구분 · 영문 · 4~8개. About 화면에 한 줄로 이어져 표시됩니다. 앞으로 하고 싶은 것을 솔직하게.'));

    main.appendChild(field('CV (한 줄에 한 항목)',
      textarea(Array.isArray(DATA.about.cv) ? DATA.about.cv.join('\n') : (DATA.about.cv || ''), 10, function (v) {
        DATA.about.cv = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      }),
      '연도로 시작하는 줄(예: 2026  Time of Materiality — Group Exhibition, Seoul)은 연도 열이 자동 분리됩니다.\n"- " 로 시작하면 연도 없는 항목, 그 외(예: Education / Exhibitions / Awards)는 소제목이 됩니다. 영문 권장.'));

    // CV PDF
    var pdfWrap = el('div');
    if (DATA.about.cvPdf) {
      pdfWrap.appendChild(el('div', 'media-src', DATA.about.cvPdf));
      var prm = el('button', 'mini-btn danger', 'PDF 제거');
      prm.addEventListener('click', function () {
        if (!confirm('CV PDF를 제거할까요?\n업로드했던 파일도 함께 삭제됩니다.')) return;
        if (DATA.about.cvPdf.indexOf('content/media/') === 0) apiDelete(DATA.about.cvPdf);
        DATA.about.cvPdf = ''; setDirty(); render();
      });
      pdfWrap.appendChild(prm);
    } else {
      pdfWrap.appendChild(uploadButton('CV PDF 업로드', 'application/pdf,.pdf', false, 'about', function (paths) {
        DATA.about.cvPdf = paths[0];
        setDirty(); render();
      }));
    }
    main.appendChild(field('CV PDF (선택)', pdfWrap, 'About 화면 맨 아래 "Download CV (PDF)" 링크로 표시됩니다.'));

    // About 이미지
    var wrap = el('div');
    if (DATA.about && DATA.about.image) {
      var img = el('img', 'cover-preview');
      img.src = mediaUrl(DATA.about.image);
      wrap.appendChild(img);
      var rm = el('button', 'mini-btn danger', '이미지 제거');
      rm.addEventListener('click', function () { DATA.about.image = ''; setDirty(); render(); });
      wrap.appendChild(rm);
    } else {
      wrap.appendChild(uploadButton('이미지 업로드', 'image/*', false, 'about', function (paths) {
        DATA.about.image = paths[0];
        setDirty(); render();
      }));
    }
    main.appendChild(field('About 사진 (선택)', wrap));

    // Contact
    var cwrap = el('div');
    (DATA.contact || []).forEach(function (c, i) {
      var row = el('div', 'contact-edit-row');
      var l = el('div', 'c-label'); l.appendChild(input(c.label, function (v) { c.label = v; }, '항목 (예: Email)'));
      var v = el('div', 'c-value'); v.appendChild(input(c.value, function (val) { c.value = val; }, '내용'));
      var h = el('div', 'c-href'); h.appendChild(input(c.href, function (val) { c.href = val; }, '링크 주소 (비우면 자동)'));
      var d = el('button', 'mini-btn danger', '삭제');
      d.addEventListener('click', function () { DATA.contact.splice(i, 1); setDirty(); render(); });
      row.appendChild(l); row.appendChild(v); row.appendChild(h); row.appendChild(d);
      cwrap.appendChild(row);
    });
    var add = el('button', 'add-btn', '+ 연락처 추가');
    add.addEventListener('click', function () {
      DATA.contact.push({ label: '', value: '', href: '' });
      setDirty(); render();
    });
    cwrap.appendChild(add);
    main.appendChild(field('Contact 목록', cwrap, '이메일은 링크를 비워 두면 자동으로 메일 링크가 됩니다.'));
  }

  /* ----- 목록 ----- */

  function itemThumb(item) {
    var src = item.cover;
    if (!src && item.media) {
      for (var i = 0; i < item.media.length; i++) {
        if ((item.media[i].type || extType(item.media[i].src)) === 'image') { src = item.media[i].src; break; }
      }
    }
    if (src) {
      var img = el('img', 'item-thumb');
      img.src = mediaUrl(src);
      return img;
    }
    var first = item.media && item.media[0];
    var t = first ? (first.type || extType(first.src) || '—') : '—';
    var label = t === 'video' ? 'VIDEO' : t === 'model' ? '3D' : t === 'embed' ? 'LINK' : '—';
    return el('div', 'item-thumb-blank', label);
  }

  function renderList(listName) {
    var arr = DATA[listName];
    main.appendChild(el('h2', 'section-title', listName === 'works' ? 'Works' : 'Research'));
    main.appendChild(el('p', 'field-hint', listName === 'works'
      ? '맨 위 항목이 첫 화면의 왼쪽 첫 번째로 보입니다. ↑↓로 순서를 바꿀 수 있습니다. 가장 강한 작업을 맨 위에.'
      : '사이트의 Research 페이지에 표시됩니다. 진행 중 → 제안 → 완료 순으로 묶이고, 묶음 안에서는 ↑↓ 순서를 따릅니다.'));

    var list = el('div', 'item-list');
    arr.forEach(function (item, i) {
      var row = el('div', 'item-row');
      row.appendChild(itemThumb(item));
      row.appendChild(el('span', 'item-name', item.title || '(제목 없음)'));
      if (listName === 'studies') {
        var st = { ongoing: '진행 중', proposed: '제안', completed: '완료' }[item.status] || '완료';
        row.appendChild(el('span', 'item-year', st));
      }
      if (listName === 'works' && item.hover && item.hover.enabled === false) {
        row.appendChild(el('span', 'item-year', 'hover 끔'));
      }
      row.appendChild(el('span', 'item-year', item.year || ''));

      var up = el('button', 'mini-btn', '↑');
      up.disabled = i === 0;
      up.addEventListener('click', function () {
        arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
        setDirty(); render();
      });
      var down = el('button', 'mini-btn', '↓');
      down.disabled = i === arr.length - 1;
      down.addEventListener('click', function () {
        arr.splice(i + 1, 0, arr.splice(i, 1)[0]);
        setDirty(); render();
      });
      var edit = el('button', 'mini-btn', '수정');
      edit.addEventListener('click', function () {
        editing = { list: listName, id: item.id };
        render();
      });
      var del = el('button', 'mini-btn danger', '삭제');
      del.addEventListener('click', function () {
        if (!confirm('「' + (item.title || '제목 없음') + '」 항목을 삭제할까요?\n업로드했던 미디어 파일도 함께 삭제됩니다.')) return;
        arr.splice(i, 1);
        apiDelete('content/media/' + item.id);
        setDirty(); render();
      });
      row.appendChild(up); row.appendChild(down); row.appendChild(edit); row.appendChild(del);
      list.appendChild(row);
    });
    main.appendChild(list);

    /* Studies 페이지 장식 GIF — 사이트의 Studies 화면에 표시된다 */
    if (listName === 'studies') {
      var gwrap = el('div');
      if (DATA.studiesGif) {
        var gimg = el('img', 'cover-preview');
        gimg.src = mediaUrl(DATA.studiesGif);
        gwrap.appendChild(gimg);
        var grm = el('button', 'mini-btn danger', 'GIF 제거');
        grm.addEventListener('click', function () {
          if (!confirm('Studies 페이지의 GIF를 제거할까요?\n업로드했던 파일도 함께 삭제됩니다.')) return;
          if (DATA.studiesGif.indexOf('content/media/') === 0) apiDelete(DATA.studiesGif);
          DATA.studiesGif = '';
          setDirty(); render();
        });
        gwrap.appendChild(grm);
      } else {
        gwrap.appendChild(uploadButton('GIF / 이미지 업로드', 'image/*', false, 'studies', function (paths) {
          DATA.studiesGif = paths[0];
          setDirty(); render();
        }));
      }
      main.appendChild(field('Research 페이지 GIF (선택)', gwrap,
        '연구 목록이 비어 있을 때만 표시되는 움직이는 이미지입니다. 항목이 하나라도 있으면 보이지 않습니다.'));
    }

    var add = el('button', 'add-btn', listName === 'works' ? '+ 새 작업 추가' : '+ 새 연구 추가');
    add.addEventListener('click', function () {
      var title = prompt('제목을 입력하세요 (영문 권장 · 나중에 수정 가능)', '');
      if (title === null) return;
      title = title.trim() || (listName === 'works' ? 'New Work' : 'New Research');
      var item = {
        id: uniqueId(title),
        title: title,
        year: String(new Date().getFullYear()),
        cover: '',
        media: [],
        description: '',
        links: []
      };
      if (listName === 'works') {
        item.medium = ''; item.duration = ''; item.format = ''; item.role = '';
        item.tools = ''; item.credits = ''; item.exhibitions = []; item.themes = []; item.descriptionKo = '';
      } else {
        item.status = 'ongoing'; item.keywords = []; item.summary = ''; item.relatedWorks = []; item.themes = [];
      }
      arr.push(item);
      editing = { list: listName, id: item.id };
      setDirty(); render();
    });
    main.appendChild(add);
  }

  /* ----- 편집기 ----- */

  function findEditing() {
    var arr = DATA[editing.list];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === editing.id) return arr[i];
    return null;
  }

  function mediaThumb(m) {
    var t = m.type || extType(m.src) || 'image';
    if (t === 'image') {
      var img = el('img', 'media-thumb');
      img.src = mediaUrl(m.src);
      return img;
    }
    return el('div', 'media-badge', t === 'video' ? 'VIDEO' : t === 'model' ? '3D' : 'LINK');
  }

  function renderEditor() {
    var item = findEditing();
    if (!item) { editing = null; render(); return; }

    var back = el('button', 'editor-back', '← 목록으로 돌아가기');
    back.addEventListener('click', function () { editing = null; render(); });
    main.appendChild(back);

    var isWork = editing.list === 'works';
    main.appendChild(el('h2', 'section-title', isWork ? 'Work 편집' : 'Research 편집'));

    main.appendChild(field('제목 (영문 권장)', input(item.title, function (v) { item.title = v; }),
      isWork ? '소프트웨어 이름은 제목이 아니라 아래 「사용 도구」에. 예: Ethereal' : '예: Materiality of Tteoljam'));
    main.appendChild(field(isWork ? '연도' : '기간', input(item.year, function (v) { item.year = v; }, isWork ? '예: 2026' : '예: 2025– (진행 중) · 2026 (완료)')));

    if (isWork) {
      /* ---- 작품 정보 (톰스톤) — 비워 두면 그 줄은 사이트에 표시되지 않습니다 ---- */
      main.appendChild(field('매체 · 형식', input(item.medium, function (v) { item.medium = v; }, 'Single-channel video, colour, sound'),
        '미술관 라벨처럼. 채널 수 · 색 · 사운드 여부. 첫 화면 커서 라벨에는 쉼표 앞부분만 짧게 붙습니다.'));
      var durRow = el('div', 'link-row');
      var durF = field('길이', input(item.duration, function (v) { item.duration = v; }, '4:32'));
      durF.style.marginBottom = '0'; durF.style.width = '140px';
      var fmtF = field('포맷 (선택)', input(item.format, function (v) { item.format = v; }, '3840×2160, 16:9'));
      fmtF.style.marginBottom = '0'; fmtF.style.flex = '1';
      durRow.appendChild(durF); durRow.appendChild(fmtF);
      main.appendChild(field('길이 · 포맷', durRow));
      main.appendChild(field('역할', input(item.role, function (v) { item.role = v; }, 'Concept, direction, generative pipeline, editing'),
        '이 작업에서 맡은 부분. 공동작업이면 협업자는 아래 「크레딧」에.'));
      main.appendChild(field('사용 도구', input(joinList(item.tools), function (v) { item.tools = v; }, 'Unreal Engine 5, ComfyUI, DaVinci Resolve'),
        '쉼표로 구분. 실제로 쓴 것만 — 배우고 싶은 도구는 Research 키워드에.'));
      main.appendChild(field('크레딧 (선택)', input(item.credits, function (v) { item.credits = v; }, 'Sound: …  ·  Made in Media Art Studio II, Duksung Women\'s University')));
      main.appendChild(field('전시 · 상영 이력 (한 줄에 하나, 선택)',
        textarea(Array.isArray(item.exhibitions) ? item.exhibitions.join('\n') : (item.exhibitions || ''), 3, function (v) {
          item.exhibitions = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        }),
        '예: 2026 — Degree Show, Duksung Women\'s University, Seoul. 온라인 전시·학교 전시도 그대로 적습니다. 없으면 비워 두세요.'));

      var thWrap = el('div', 'check-grid');
      THEMES.forEach(function (t) {
        thWrap.appendChild(checkbox((item.themes || []).indexOf(t[0]) >= 0, function (on) {
          var arr = (item.themes || []).filter(function (k) { return k !== t[0]; });
          if (on) arr.push(t[0]);
          item.themes = THEMES.map(function (x) { return x[0]; }).filter(function (k) { return arr.indexOf(k) >= 0; });
        }, t[1]));
      });
      main.appendChild(field('주제 (홈 화면의 네 키워드)', thWrap,
        '체크한 키워드 위에 마우스를 올리면 이 작품 제목이 함께 나타납니다. 상세 화면 Themes 줄에도 표시됩니다.'));
    } else {
      main.appendChild(field('상태', select(item.status || 'completed', [
        ['ongoing', '진행 중 (Ongoing)'], ['proposed', '제안 · 계획 (Proposed)'], ['completed', '완료 (Completed)']
      ], function (v) { item.status = v; }),
        'Research 페이지에서 진행 중 → 제안 → 완료 순으로 묶입니다. 하고 싶은 연구는 「제안」으로 솔직하게.'));
      var sthWrap = el('div', 'check-grid');
      THEMES.forEach(function (t) {
        sthWrap.appendChild(checkbox((item.themes || []).indexOf(t[0]) >= 0, function (on) {
          var arr = (item.themes || []).filter(function (k) { return k !== t[0]; });
          if (on) arr.push(t[0]);
          item.themes = THEMES.map(function (x) { return x[0]; }).filter(function (k) { return arr.indexOf(k) >= 0; });
        }, t[1]));
      });
      main.appendChild(field('주제 (홈 화면의 키워드)', sthWrap,
        'Research 목록에는 이 큰 주제가, 상세 화면에는 주제와 세부 키워드가 함께 표시됩니다. 홈에서 해당 키워드에 마우스를 올리면 이 연구 제목도 나타납니다.'));

      main.appendChild(field('한 줄 요약 (영문)', input(item.summary, function (v) { item.summary = v; }, 'What the study asks and how — one or two sentences'),
        'Research 목록에서 제목 아래에 보이는 문장. 40단어 이내.'));
      main.appendChild(field('키워드', input(joinList(item.keywords), function (v) { item.keywords = splitList(v); }, 'Cultural Heritage, Generative AI, Technical Image'),
        '쉼표로 구분 · 영문 · 2~5개. 상태와 함께 한 줄로 표시됩니다.'));

      var rwWrap = el('div', 'check-grid');
      (DATA.works || []).forEach(function (w) {
        rwWrap.appendChild(checkbox((item.relatedWorks || []).indexOf(w.id) >= 0, function (on) {
          var arr = (item.relatedWorks || []).filter(function (k) { return k !== w.id; });
          if (on) arr.push(w.id);
          item.relatedWorks = arr;
        }, w.title || w.id));
      });
      if (!(DATA.works || []).length) rwWrap.appendChild(el('p', 'field-hint', '등록된 작업이 없습니다.'));
      main.appendChild(field('관련 작품', rwWrap, '체크한 작품의 상세 화면에 이 연구로 가는 링크(Research 줄)가 생기고, 연구 상세에는 작품 링크가 생깁니다.'));
    }

    main.appendChild(field(isWork ? 'Statement (영문 권장)' : 'Abstract (영문 권장)',
      textarea(item.description, 8, function (v) { item.description = v; }),
      '상세 화면에 표시됩니다. 빈 줄로 문단을 나눌 수 있습니다.'));
    if (isWork) {
      main.appendChild(field('국문 설명 (선택)',
        textarea(item.descriptionKo, 5, function (v) { item.descriptionKo = v; }),
        '영문 아래에 옅은 선 하나 건너 표시됩니다. 영문만 쓰려면 비워 두세요.'));
    }

    /* 미디어 */
    var mwrap = el('div');
    var mlist = el('div', 'media-list');
    (item.media || []).forEach(function (m, i) {
      var row = el('div', 'media-row');
      row.appendChild(mediaThumb(m));

      var info = el('div', 'media-info');
      var cap = document.createElement('input');
      cap.className = 'media-caption-input';
      cap.value = m.caption || '';
      cap.placeholder = '사진/영상 설명 (선택)';
      cap.addEventListener('input', function () { m.caption = cap.value; setDirty(); });
      info.appendChild(cap);
      info.appendChild(el('div', 'media-src', m.src));
      row.appendChild(info);

      var btns = el('div', 'row-btns');
      var up = el('button', 'mini-btn', '↑');
      up.disabled = i === 0;
      up.addEventListener('click', function () {
        item.media.splice(i - 1, 0, item.media.splice(i, 1)[0]);
        setDirty(); render();
      });
      var down = el('button', 'mini-btn', '↓');
      down.disabled = i === item.media.length - 1;
      down.addEventListener('click', function () {
        item.media.splice(i + 1, 0, item.media.splice(i, 1)[0]);
        setDirty(); render();
      });
      var del = el('button', 'mini-btn danger', '삭제');
      del.addEventListener('click', function () {
        if (!confirm('이 미디어를 삭제할까요?')) return;
        var t = m.type || extType(m.src);
        if (t !== 'embed' && m.src && m.src.indexOf('content/media/') === 0) apiDelete(m.src);
        item.media.splice(i, 1);
        setDirty(); render();
      });
      btns.appendChild(up); btns.appendChild(down); btns.appendChild(del);
      row.appendChild(btns);
      mlist.appendChild(row);
    });
    mwrap.appendChild(mlist);

    var urow = el('div', 'upload-row');
    urow.appendChild(uploadButton('+ 파일 추가 (이미지 · 영상 · 3D)', 'image/*,video/mp4,video/webm,.glb,.gltf', true, item.id, function (paths) {
      paths.forEach(function (p) {
        item.media.push({ type: extType(p) || 'image', src: p, caption: '' });
      });
      setDirty(); render();
    }));
    var embedBtn = el('button', 'upload-btn', '+ YouTube / Vimeo 링크 추가');
    embedBtn.addEventListener('click', function () {
      var url = prompt('YouTube 또는 Vimeo 영상 주소를 붙여넣으세요');
      if (!url) return;
      item.media.push({ type: 'embed', src: url.trim(), caption: '' });
      setDirty(); render();
    });
    urow.appendChild(embedBtn);
    mwrap.appendChild(urow);

    main.appendChild(field('미디어 (위에서부터 순서대로 표시)', mwrap,
      '이미지: jpg/png/webp · 영상: mp4 권장 (50MB 이하) · 3D: .glb 권장 (Blender에서 내보내기 → glTF 2.0).\n첫 번째 미디어가 영상이면 첫 화면에서 마우스를 올렸을 때 자동 재생됩니다 — 구간은 아래에서 정합니다.'));

    if (isWork) renderHoverControls(item);

    /* 대표 이미지 */
    var cwrap = el('div');
    if (item.cover) {
      var img = el('img', 'cover-preview');
      img.src = mediaUrl(item.cover);
      cwrap.appendChild(img);
      var rm = el('button', 'mini-btn danger', '대표 이미지 제거');
      rm.addEventListener('click', function () { item.cover = ''; setDirty(); render(); });
      cwrap.appendChild(rm);
    } else {
      cwrap.appendChild(uploadButton('대표 이미지 업로드', 'image/*', false, item.id, function (paths) {
        item.cover = paths[0];
        setDirty(); render();
      }));
    }
    main.appendChild(field('대표 이미지 (선택)', cwrap, isWork
      ? '비워 두면 첫 번째 이미지가 자동으로 사용됩니다. 3D 작업이나 영상 작업의 목록 썸네일로 쓰입니다.'
      : '비워 두면 첫 번째 이미지가 자동으로 사용됩니다. Research 목록의 썸네일(112×63)과 상세 화면 상단에 표시됩니다.'));

    /* 링크 */
    var lwrap = el('div');
    (item.links || []).forEach(function (l, i) {
      var row = el('div', 'link-row');
      var a = el('div'); a.style.width = '180px'; a.appendChild(input(l.label, function (v) { l.label = v; }, '링크 이름'));
      var b = el('div'); b.style.flex = '1'; b.appendChild(input(l.href, function (v) { l.href = v; }, 'https://…'));
      var d = el('button', 'mini-btn danger', '삭제');
      d.addEventListener('click', function () { item.links.splice(i, 1); setDirty(); render(); });
      row.appendChild(a); row.appendChild(b); row.appendChild(d);
      lwrap.appendChild(row);
    });
    var addLink = el('button', 'mini-btn', '+ 링크 추가 (논문 PDF, 외부 페이지 등)');
    addLink.addEventListener('click', function () {
      if (!item.links) item.links = [];
      item.links.push({ label: '', href: '' });
      setDirty(); render();
    });
    lwrap.appendChild(addLink);
    main.appendChild(field('외부 링크 (선택)', lwrap));
  }

  /* ----- 첫 화면 hover 자동 재생 설정 ----- */

  function fmtTime(t) {
    if (!isFinite(t)) return '–';
    var m = Math.floor(t / 60), s = (t - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function renderHoverControls(item) {
    var first = item.media && item.media[0];
    var isVid = first && (first.type || extType(first.src)) === 'video';
    var TITLE = '마우스를 올렸을 때 자동 재생 (첫 화면)';
    if (!isVid) {
      main.appendChild(field(TITLE, el('p', 'field-hint', '첫 번째 미디어가 영상일 때 설정할 수 있습니다. (영상을 맨 위로 올리면 됩니다)')));
      return;
    }
    var hv = item.hover || {};
    function H() { return item.hover || (item.hover = {}); }   // 편집 화면을 열기만 해도 저장되지 않게 — 바꿀 때만 생성
    var enabled = hv.enabled !== false;
    var start = (typeof hv.start === 'number' && isFinite(hv.start)) ? hv.start : null;
    var length = (+hv.length >= 1) ? Math.min(+hv.length, 30) : 4;
    var rate = (+hv.rate > 0) ? +hv.rate : 1;
    var loop = hv.loop !== false;

    var wrap = el('div');
    wrap.appendChild(checkbox(enabled, function (on) { H().enabled = on; render(); },
      '마우스를 올리면 자동 재생 (끄면 대표 이미지만 보입니다)'));

    var row = el('div', 'link-row');
    var startIn = input(start == null ? '' : start, function (v) {
      H().start = v === '' ? null : Math.max(0, parseFloat(v) || 0);
      updateStatus();
    }, '자동 (중간)');
    startIn.type = 'number'; startIn.min = 0; startIn.step = 0.1;
    var sf = field('시작 지점 (초)', startIn); sf.style.marginBottom = '0'; sf.style.width = '140px';

    var lenIn = input(length, function (v) {
      var x = parseFloat(v);
      H().length = x >= 1 ? Math.min(x, 30) : 4;
      updateStatus();
    });
    lenIn.type = 'number'; lenIn.min = 1; lenIn.max = 30; lenIn.step = 0.5;
    var lf = field('재생 길이 (초)', lenIn); lf.style.marginBottom = '0'; lf.style.width = '140px';

    var rateSel = select(rate, [['0.5', '0.5×'], ['0.75', '0.75×'], ['1', '1× (기본)'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']],
      function (v) { H().rate = parseFloat(v); updateStatus(); });
    var rf = field('재생 속도', rateSel); rf.style.marginBottom = '0'; rf.style.width = '120px';
    row.appendChild(sf); row.appendChild(lf); row.appendChild(rf);
    wrap.appendChild(row);

    wrap.appendChild(checkbox(loop, function (on) { H().loop = on; },
      '구간이 끝나면 처음부터 반복 (끄면 마지막 장면에서 멈춤)'));

    /* 미리보기 — 네이티브 컨트롤의 스크러버가 곧 「장면 고르기」 */
    var pv = document.createElement('video');
    pv.src = mediaUrl(first.src);
    pv.muted = true; pv.playsInline = true; pv.controls = true; pv.preload = 'metadata';
    pv.className = 'hover-preview';
    wrap.appendChild(pv);

    var btns = el('div', 'row-btns');
    var playBtn = el('button', 'mini-btn', '▶ 하이라이트 미리보기');
    var setBtn = el('button', 'mini-btn', '현재 위치를 시작점으로');
    btns.appendChild(playBtn); btns.appendChild(setBtn);
    wrap.appendChild(btns);
    var status = el('p', 'field-hint', '영상 정보를 읽는 중…');
    wrap.appendChild(status);

    var hlStart = 0, hlEnd = 0;
    function calc() {
      var d = pv.duration;
      if (!isFinite(d) || d <= 0) return false;
      var cur = item.hover || {};
      var s = (typeof cur.start === 'number' && isFinite(cur.start)) ? cur.start : null;
      var L = (+cur.length >= 1) ? Math.min(+cur.length, 30) : 4;
      hlStart = (s == null || s >= d) ? d / 2 : Math.min(s, Math.max(0, d - 0.5));
      hlEnd = Math.min(hlStart + L, d);
      return true;
    }
    function updateStatus() {
      if (!calc()) return;
      var cur = item.hover || {};
      var s = (typeof cur.start === 'number' && isFinite(cur.start)) ? cur.start : null;
      var r = (+cur.rate > 0) ? +cur.rate : 1;
      if (s != null && s >= pv.duration) {
        status.textContent = '⚠ 시작 지점이 영상 길이(' + fmtTime(pv.duration) + ')를 넘어 사이트에서는 중간부터 재생됩니다';
      } else {
        status.textContent = '영상 길이 ' + fmtTime(pv.duration) + ' · 하이라이트 ' + fmtTime(hlStart) + ' → ' + fmtTime(hlEnd) +
          ' (' + (hlEnd - hlStart).toFixed(1) + '초 · ' + r + '×)';
      }
      startIn.max = Math.floor(pv.duration * 10) / 10;
    }
    pv.addEventListener('loadedmetadata', updateStatus);
    pv.addEventListener('timeupdate', function () {
      if (pv.paused || !pv._hl) return;
      if (pv.currentTime >= hlEnd) {
        var cur = item.hover || {};
        if (cur.loop !== false) pv.currentTime = hlStart; else { pv.pause(); pv._hl = false; }
      }
    });
    /* 구간 끝 = 영상 끝이면 브라우저가 먼저 멈춘다 — ended 에서 되감는다 (사이트와 같은 처리) */
    pv.addEventListener('pause', function () { if (!pv.ended) pv._hl = false; });
    pv.addEventListener('ended', function () {
      var cur = item.hover || {};
      if (pv._hl && cur.loop !== false) { pv.currentTime = hlStart; pv.play(); } else pv._hl = false;
    });
    playBtn.addEventListener('click', function () {
      if (!calc()) { toast('영상 정보를 아직 읽지 못했습니다'); return; }
      var cur = item.hover || {};
      pv.playbackRate = (+cur.rate > 0) ? +cur.rate : 1;
      pv.currentTime = hlStart;
      pv._hl = true;
      var p = pv.play(); if (p && p.catch) p.catch(function () {});
    });
    setBtn.addEventListener('click', function () {
      if (!isFinite(pv.currentTime)) return;
      H().start = Math.round(pv.currentTime * 10) / 10;
      setDirty(); render();
    });

    [startIn, lenIn, rateSel, playBtn, setBtn].forEach(function (c) { c.disabled = !enabled; });
    if (!enabled) { row.style.opacity = '0.4'; pv.style.opacity = '0.4'; }

    main.appendChild(field(TITLE, wrap,
      '첫 번째 영상의 이 구간이 첫 화면에서 마우스를 올렸을 때 소리 없이 재생됩니다. 터치 기기에서는 화면 가운데 온 작품이 같은 설정으로 재생됩니다.'));
  }

  /* ----- 배포 (내 컴퓨터에서 연 관리도구 전용 — 웹에서는 저장이 곧 반영) ----- */

  function renderDeploy() {
    main.appendChild(el('h2', 'section-title', '배포 — 사이트에 반영하기'));

    /* 1. 로컬 변경사항 (git) */
    var gitBox = el('div', 'deploy-box');
    main.appendChild(field('아직 사이트에 반영되지 않은 변경', gitBox,
      '「변경사항 저장」으로 저장한 내용이 여기에 나타납니다. 반영하기를 누르면 GitHub에 올라가고 1분쯤 뒤 사이트에 반영됩니다.'));

    /* 2. 반영 버튼 */
    var ctl = el('div');
    var msgIn = document.createElement('input');
    msgIn.type = 'text';
    msgIn.placeholder = '변경 내용 메모 (선택 — 예: 새 작업 추가)';
    ctl.appendChild(msgIn);
    var row = el('div', 'upload-row');
    var depBtn = el('button', 'upload-btn deploy-btn', '사이트에 반영하기');
    row.appendChild(depBtn);
    var depState = el('span', 'deploy-state-msg', '');
    row.appendChild(depState);
    ctl.appendChild(row);
    main.appendChild(field('반영', ctl));

    /* 3. 사이트 주소 */
    var site = el('p', 'deploy-note');
    var link = el('a');
    link.href = SITE_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(el('u', null, SITE_URL.replace(/^https?:\/\//, '') + ' ↗'));
    site.appendChild(link);
    main.appendChild(field('사이트', site));

    function loadGit() {
      return fetch('/api/git-status').then(function (r) { return r.json(); }).then(function (j) {
        gitBox.textContent = '';
        if (!j.ok) { gitBox.appendChild(el('p', 'deploy-err', j.error || 'git 상태를 읽지 못했습니다')); return; }
        if (j.files.length) {
          var ul = el('div', 'deploy-files');
          j.files.forEach(function (f) {
            var mark = f.code === '??' || f.code === 'A' ? '+ ' : f.code === 'D' ? '− ' : '· ';
            ul.appendChild(el('div', null, mark + f.path));
          });
          gitBox.appendChild(ul);
        }
        if (j.ahead > 0) {
          gitBox.appendChild(el('p', 'deploy-note', '푸시되지 않은 커밋 ' + j.ahead + '개'));
        }
        if (!j.files.length && j.ahead === 0) {
          gitBox.appendChild(el('p', 'deploy-note ok', '모든 변경이 반영되어 있습니다 ✓'));
        }
        if (j.last) {
          gitBox.appendChild(el('p', 'deploy-last', '마지막 커밋: ' + j.last.subject + '  (' + j.last.hash + ')'));
        }
      }).catch(function () {
        gitBox.textContent = '';
        gitBox.appendChild(el('p', 'deploy-err', '서버에 연결하지 못했습니다'));
      });
    }

    depBtn.addEventListener('click', function () {
      if (dirty) { toast('먼저 우측 상단 「변경사항 저장」을 눌러 주세요'); return; }
      if (uploading > 0) { toast('업로드가 끝난 뒤 다시 시도해 주세요'); return; }
      depBtn.classList.add('busy');
      depBtn.textContent = '반영 중…';
      depState.textContent = 'GitHub에 올리는 중…';
      api('/api/deploy', { method: 'POST', body: msgIn.value.trim() })
        .then(function (j) {
          depBtn.classList.remove('busy');
          depBtn.textContent = '사이트에 반영하기';
          if (!j.ok) { depState.textContent = ''; toast(j.error || '반영 실패'); return; }
          if (j.nothing) { depState.textContent = ''; toast('반영할 변경사항이 없습니다'); return; }
          msgIn.value = '';
          depState.textContent = '사이트에 반영되는 중… (1분쯤)';
          toast('GitHub에 올렸습니다 — 1분쯤 뒤 사이트에 반영됩니다');
          loadGit();
          fetch('/content/data.js', { cache: 'no-store' })
            .then(function (r) { return r.text(); })
            .then(function (text) {
              watchLive(text, function (ok) {
                depState.textContent = ok ? '사이트에 반영됨 ✓' : '반영 확인이 늦어집니다 — 사이트를 새로고침해 보세요';
              });
            });
        })
        .catch(function () {
          depBtn.classList.remove('busy');
          depBtn.textContent = '사이트에 반영하기';
          depState.textContent = '';
          toast('서버 연결 실패');
        });
    });

    loadGit();
    deployTimer = setInterval(loadGit, 8000);
  }

  /* ---------- 웹 모드 (GitHub Pages) ---------- */

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  function bootWeb() {
    /* 웹에서는 저장이 곧 사이트 반영 — 배포 탭은 필요 없다 */
    navBtns.forEach(function (b) { if (b.getAttribute('data-view') === 'deploy') b.style.display = 'none'; });
    var help = document.querySelector('.side-help');
    if (help) help.innerHTML = '수정 후 우측 상단<br>「변경사항 저장」을 누르면<br>1분쯤 뒤 사이트에 반영됩니다.';
    var token = storage('gh-token');
    if (!token) { showLogin(); return; }
    connect(token).catch(function (e) {
      if (e && e.handled) return;
      showLogin(e.status === 401 ? '토큰이 만료되었거나 올바르지 않습니다 — 새로 만들어 붙여넣어 주세요' : '불러오기 실패: ' + e.message);
    });
  }

  function connect(token) {
    var s = window.GitHubStore.create({ owner: GH.owner, repo: GH.repo, branch: GH.branch, token: token });
    return s.load().then(function (text) {
      store = s;
      storage('gh-token', token);
      addLogout();
      start(text);
    });
  }

  function showLogin(msg) {
    banner.textContent = '';
    var box = el('div', 'login-box');
    box.appendChild(el('p', 'login-title', '관리도구 로그인'));
    var how = el('p', 'deploy-note');
    how.innerHTML =
      '처음 한 번만 GitHub 토큰이 필요합니다.<br>' +
      '1. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener"><u>토큰 만들기 ↗</u></a> (GitHub 로그인)<br>' +
      '2. Resource owner: <b>' + GH.owner + '</b> · Repository access: <b>Only select repositories</b> → <b>' + GH.repo + '</b><br>' +
      '3. Permissions → <b>Contents</b> → <b>Read and write</b> → Generate token<br>' +
      '4. 만들어진 토큰을 아래에 붙여넣기 — 이 브라우저에만 저장됩니다';
    box.appendChild(how);
    var tok = document.createElement('input');
    tok.type = 'password';
    tok.placeholder = 'github_pat_…';
    tok.autocomplete = 'off';
    box.appendChild(tok);
    var go = el('button', 'banner-retry', '로그인');
    box.appendChild(go);
    var err = el('p', 'deploy-err', msg || '');
    box.appendChild(err);
    function submit() {
      var t = tok.value.trim();
      if (!t) return;
      go.disabled = true;
      err.textContent = '';
      connect(t).catch(function (e) {
        go.disabled = false;
        if (e && e.handled) return;
        err.textContent = e.status === 401 ? '토큰이 올바르지 않습니다'
          : e.status === 404 ? '저장소를 찾을 수 없습니다 — 2번의 저장소 선택을 확인해 주세요'
          : '로그인 실패: ' + e.message;
      });
    }
    go.addEventListener('click', submit);
    tok.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    banner.appendChild(box);
    banner.hidden = false;
    tok.focus();
  }

  function addLogout() {
    if (document.getElementById('logoutBtn')) return;
    var b = el('button', 'bar-link', '로그아웃');
    b.id = 'logoutBtn';
    b.addEventListener('click', function () {
      if (dirty && !window.confirm('저장하지 않은 변경사항이 사라집니다. 로그아웃할까요?')) return;
      storage('gh-token', null);
      dirty = false;
      location.reload();
    });
    saveBtn.parentNode.insertBefore(b, saveBtn);
  }

  /* ---------- boot ---------- */

  function start(text) {
    try {
      var a = text.indexOf('{');
      var b = text.lastIndexOf('}');
      DATA = JSON.parse(text.slice(a, b + 1));
    } catch (e) {
      showBanner(LOCAL ? [
        'content/data.js 파일을 읽는 중 문제가 발생했습니다.',
        'content/backups 폴더의 가장 최근 백업 파일을 복사해서 content/data.js 를 덮어쓰면 복구됩니다.'
      ] : [
        'content/data.js 파일을 읽는 중 문제가 발생했습니다.',
        'GitHub 저장소의 커밋 기록(History)에서 이전 버전으로 되돌리면 복구됩니다.'
      ]);
      throw { handled: true };
    }
    DATA.works = DATA.works || [];
    DATA.studies = DATA.studies || [];
    DATA.studies.forEach(function (s) { if (s.status === 'past') s.status = 'completed'; });   // 구 표기 정규화
    DATA.studiesGif = DATA.studiesGif || '';
    DATA.siteTagline = DATA.siteTagline || '';
    DATA.contact = DATA.contact || [];
    DATA.about = DATA.about || { text: '', image: '' };
    DATA.about.statement = DATA.about.statement || DATA.about.text || '';
    DATA.about.bio = DATA.about.bio || '';
    DATA.about.directions = DATA.about.directions || [];
    DATA.about.cv = DATA.about.cv || [];
    DATA.about.cvPdf = DATA.about.cvPdf || '';
    banner.hidden = true;
    render();
  }


  function showBanner(lines, showRetry) {
    banner.textContent = '';
    var box = el('div');
    lines.forEach(function (ln) { box.appendChild(el('p', null, ln)); });
    if (showRetry !== false) {
      var btn = el('button', 'banner-retry', '다시 시도');
      btn.addEventListener('click', function () { location.reload(); });
      box.appendChild(btn);
    }
    banner.appendChild(box);
    banner.hidden = false;
  }

  /* 서버가 늦게 뜨는 경우를 위해 3초간 재시도한 뒤에만 오류를 보여준다 */
  function pingRetry(tries) {
    return fetch('/api/ping', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error('ping'); })
      .catch(function (e) {
        if (tries <= 1) throw e;
        return new Promise(function (res) { setTimeout(res, 500); })
          .then(function () { return pingRetry(tries - 1); });
      });
  }

  function boot() {
    if (location.protocol === 'file:') {
      showBanner([
        '이 페이지는 파일로 직접 열 수 없습니다.',
        '사이트 폴더의 관리도구.bat 을 더블클릭해서 열어 주세요.'
      ], false);
      return;
    }
    if (!LOCAL) { bootWeb(); return; }
    pingRetry(6)
      .catch(function () {
        showBanner([
          '로컬 서버에 연결하지 못했습니다.',
          '사이트 폴더의 관리도구.bat 을 더블클릭해서 다시 열어 주세요.',
          '검은 서버 창이 열려 있어야 저장·업로드가 됩니다.'
        ]);
        throw { handled: true };
      })
      .then(function () {
        return fetch('/content/data.js?ts=' + Date.now(), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('data.js HTTP ' + r.status);
          return r.text();
        });
      })
      .then(start)
      .catch(function (e) {
        if (!e || e.handled !== true) {
          showBanner([
            '데이터를 불러오지 못했습니다.',
            '검은 서버 창이 열려 있는지 확인한 뒤 다시 시도해 주세요.'
          ]);
        }
      });
  }

  boot();
})();
