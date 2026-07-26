/* ==========================================================
   DOYEON LEE — Portfolio · app.js
   데이터는 content/data.js (window.SITE_DATA) 에서 읽어옵니다.
   ========================================================== */
(function () {
  'use strict';

  var DATA = window.SITE_DATA || { siteName: 'PORTFOLIO', works: [], studies: [], about: {}, contact: [] };
  var SECTIONS = ['home', 'works', 'about', 'contact', 'studies'];

  var stage = {
    home: document.getElementById('view-home'),
    works: document.getElementById('view-works'),
    studies: document.getElementById('view-studies'),
    about: document.getElementById('view-about'),
    contact: document.getElementById('view-contact')
  };
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.side-nav a'));
  var overlay = document.getElementById('detailOverlay');
  var overlayTitle = document.getElementById('detailTitle');
  var overlayYear = document.getElementById('detailYear');
  var overlayBody = document.getElementById('detailBody');
  var overlayClose = document.getElementById('detailClose');
  var cursorLabel = document.getElementById('cursorLabel');

  var lastSection = 'home';
  var lastFocus = null;
  var activeViewers = [];   // three.js 뷰어 dispose 목록

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function extOf(src) {
    var m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src || '');
    return m ? m[1].toLowerCase() : '';
  }

  function mediaType(m) {
    if (m.type) return m.type;
    var e = extOf(m.src);
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].indexOf(e) >= 0) return 'video';
    if (['glb', 'gltf'].indexOf(e) >= 0) return 'model';
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(m.src || '')) return 'embed';
    return 'image';
  }

  function embedSrc(url) {
    var m;
    if ((m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/.exec(url))) {
      return 'https://www.youtube-nocookie.com/embed/' + m[1];
    }
    if ((m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url))) {
      return 'https://player.vimeo.com/video/' + m[1];
    }
    return url;
  }

  var PLACEHOLDER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">' +
      '<rect width="800" height="600" fill="#fff"/>' +
      '<g fill="none" stroke="#000" stroke-width="1">' +
      '<path d="M300 380 L400 320 L500 380 L400 440 Z"/>' +
      '<path d="M300 380 L300 250 L400 190 L500 250 L500 380"/>' +
      '<path d="M300 250 L400 310 L500 250 M400 310 L400 440"/>' +
      '</g></svg>'
    );

  /* ---------- header / title ---------- */

  var siteName = DATA.siteName || 'PORTFOLIO';
  document.getElementById('siteName').textContent = siteName;
  document.title = siteName + ' — Portfolio';

  /* ---------- works strip ---------- */

  function buildStrip() {
    var v = stage.works;
    v.textContent = '';
    if (!DATA.works || !DATA.works.length) {
      v.appendChild(el('p', 'strip-empty', '아직 등록된 작업물이 없습니다 — 관리도구로 추가해 주세요.'));
      return;
    }
    var strip = el('div', 'strip');
    DATA.works.forEach(function (w, i) {
      var a = el('a', 'strip-item');
      a.href = '#w/' + encodeURIComponent(w.id);
      a.style.setProperty('--i', i);
      a.setAttribute('aria-label', w.title || '');

      var firstMedia = (w.media && w.media[0]) || null;
      var modelMedia = null;
      if (w.media) {
        for (var mIdx = 0; mIdx < w.media.length; mIdx++) {
          if (mediaType(w.media[mIdx]) === 'model') { modelMedia = w.media[mIdx]; break; }
        }
      }
      var node;
      if (firstMedia && mediaType(firstMedia) === 'video') {
        var HIGHLIGHT_LEN = 4; // hover 시 재생할 하이라이트 길이(초)
        var hlStart = 0;

        var vid = document.createElement('video');
        vid.src = firstMedia.src;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'metadata';

        vid.addEventListener('loadedmetadata', function () {
          if (isFinite(vid.duration) && vid.duration > 0) {
            hlStart = vid.duration / 2;
            if (a.classList.contains('previewing')) vid.currentTime = hlStart;
          }
        });
        /* 하이라이트 구간만 반복 */
        vid.addEventListener('timeupdate', function () {
          if (vid.paused) return;
          if (vid.currentTime >= hlStart + HIGHLIGHT_LEN || vid.ended) vid.currentTime = hlStart;
        });

        a.addEventListener('mouseenter', function () {
          a.classList.add('previewing');
          if (hlStart) vid.currentTime = hlStart;
          var p = vid.play();
          if (p && p.catch) p.catch(function () {});
        });
        a.addEventListener('mouseleave', function () {
          a.classList.remove('previewing');
          vid.pause();
          if (!w.cover) vid.currentTime = 0; // 커버 없으면 첫 프레임이 대표이미지 역할
        });

        if (w.cover) {
          /* 대표이미지가 바닥, 영상은 hover 시에만 위로 페이드인 */
          node = document.createElement('img');
          node.src = w.cover;
          node.alt = w.title || '';
          node.loading = i > 5 ? 'lazy' : 'eager';
          node.draggable = false;
          vid.className = 'strip-preview is-ready';
          a.appendChild(vid);
        } else {
          node = vid;
        }
      } else if (modelMedia) {
        /* 3D 모델 — hover 시 대표이미지 위로 마우스 추적 360° 뷰어 페이드인 */
        node = document.createElement('img');
        node.src = w.cover || PLACEHOLDER;
        node.alt = w.title || '';
        node.loading = i > 5 ? 'lazy' : 'eager';
        node.draggable = false;

        var box3d = el('div', 'strip-preview strip-preview3d');
        a.appendChild(box3d);

        var hoverViewer = null;
        var mounting3d = false;

        a.addEventListener('mouseenter', function () {
          a.classList.add('previewing');
          if (hoverViewer) { hoverViewer.setActive(true); return; }
          if (mounting3d) return;
          mounting3d = true;
          ensureThree().then(function () {
            if (!box3d.isConnected) return;
            hoverViewer = window.Viewer3D.mountHover(box3d, modelMedia.src, function (err) {
              if (!err) box3d.classList.add('is-ready');
            });
            hoverViewer.setActive(a.classList.contains('previewing'));
          }).catch(function (e) {
            mounting3d = false;
            if (window.console && console.error) console.error('[strip3d]', e);
          });
        });
        a.addEventListener('mousemove', function (e) {
          if (!hoverViewer) return;
          var rect = a.getBoundingClientRect();
          hoverViewer.setPointer(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            ((e.clientY - rect.top) / rect.height) * 2 - 1
          );
        });
        a.addEventListener('mouseleave', function () {
          a.classList.remove('previewing');
          if (hoverViewer) hoverViewer.setActive(false);
        });
      } else {
        var src = w.cover;
        if (!src && w.media) {
          for (var k = 0; k < w.media.length; k++) {
            if (mediaType(w.media[k]) === 'image') { src = w.media[k].src; break; }
          }
        }
        node = document.createElement('img');
        node.src = src || PLACEHOLDER;
        node.alt = w.title || '';
        node.loading = i > 5 ? 'lazy' : 'eager';
        node.draggable = false;
      }
      a.appendChild(node);

      a.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch') return;
        showLabel(w.title + (w.year ? ' — ' + w.year : ''));
      });
      a.addEventListener('pointerleave', hideLabel);
      strip.appendChild(a);
    });
    v.appendChild(strip);
  }

  /* wheel → horizontal */
  stage.works.addEventListener('wheel', function (e) {
    e.preventDefault();
    stage.works.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
  }, { passive: false });

  /* drag to scroll (suppress click after real drag) */
  (function () {
    var down = false, dragged = false, startX = 0, startLeft = 0;
    var v = stage.works;
    v.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // 터치는 네이티브 스크롤
      down = true; dragged = false;
      startX = e.clientX; startLeft = v.scrollLeft;
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 6) {
        dragged = true;
        v.classList.add('dragging');
        v.scrollLeft = startLeft - dx;
      }
    });
    window.addEventListener('pointerup', function () {
      down = false;
      v.classList.remove('dragging');
    });
    v.addEventListener('click', function (e) {
      if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
    }, true);
  })();

  /* ---------- cursor label ---------- */

  var mouseX = 0, mouseY = 0, labelX = 0, labelY = 0, labelOn = false, rafId = null;

  document.addEventListener('pointermove', function (e) {
    mouseX = e.clientX; mouseY = e.clientY;
    if (labelOn && rafId == null) tick();
  });

  function tick() {
    labelX += (mouseX - labelX) * 0.22;
    labelY += (mouseY - labelY) * 0.22;
    cursorLabel.style.transform =
      'translate(' + (labelX + 18) + 'px,' + (labelY + 22) + 'px)';
    if (labelOn || Math.abs(mouseX - labelX) > 0.5 || Math.abs(mouseY - labelY) > 0.5) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }

  function showLabel(text) {
    cursorLabel.textContent = text;
    labelX = mouseX; labelY = mouseY;
    cursorLabel.classList.add('on');
    labelOn = true;
    if (rafId == null) tick();
  }
  function hideLabel() {
    cursorLabel.classList.remove('on');
    labelOn = false;
  }

  /* ---------- studies ---------- */

  function buildStudies() {
    var v = stage.studies;
    v.textContent = '';
    var list = el('div', 'studies-list');
    if (!DATA.studies || !DATA.studies.length) {
      list.appendChild(el('p', 'strip-empty', '아직 등록된 항목이 없습니다.'));
    } else {
      DATA.studies.forEach(function (s) {
        var row = el('a', 'study-row');
        row.href = '#s/' + encodeURIComponent(s.id);
        row.appendChild(el('span', 'study-year', s.year || ''));
        row.appendChild(el('span', 'study-title', s.title || ''));
        list.appendChild(row);
      });
    }
    v.appendChild(list);
  }

  /* ---------- about / contact ---------- */

  function buildAbout() {
    var v = stage.about;
    v.textContent = '';
    var inner = el('div', 'about-inner');
    var ab = DATA.about || {};
    if (ab.image) {
      var img = el('img', 'about-photo');
      img.src = ab.image;
      img.alt = siteName;
      inner.appendChild(img);
    }
    var txt = el('div', 'about-text');
    String(ab.text || '').split(/\n\s*\n/).forEach(function (parag) {
      if (parag.trim()) txt.appendChild(el('p', null, parag.trim()));
    });
    inner.appendChild(txt);
    v.appendChild(inner);
  }

  function contactHref(item) {
    if (item.href) return item.href;
    var val = String(item.value || '');
    if (val.indexOf('@') > 0 && val.indexOf(' ') < 0) return 'mailto:' + val;
    if (/^https?:\/\//.test(val)) return val;
    return '';
  }

  function buildContact() {
    var v = stage.contact;
    v.textContent = '';
    var list = el('div', 'contact-list');
    (DATA.contact || []).forEach(function (c) {
      var row = el('div', 'contact-row');
      row.appendChild(el('span', 'contact-label', c.label || ''));
      var valWrap = el('span', 'contact-value');
      var href = contactHref(c);
      if (href) {
        var a = el('a', null, c.value || '');
        a.href = href;
        if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
        valWrap.appendChild(a);
      } else {
        valWrap.textContent = c.value || '';
      }
      row.appendChild(valWrap);
      list.appendChild(row);
    });
    v.appendChild(list);
  }

  /* ---------- detail overlay ---------- */

  function findItem(kind, id) {
    var arr = kind === 's' ? DATA.studies : DATA.works;
    for (var i = 0; i < (arr || []).length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  function disposeViewers() {
    activeViewers.forEach(function (d) { try { d(); } catch (e) {} });
    activeViewers = [];
  }

  function openDetail(item) {
    hideLabel();
    disposeViewers();
    overlayTitle.textContent = item.title || '';
    overlayYear.textContent = item.year || '';
    overlayBody.textContent = '';
    overlayBody.scrollTop = 0;

    (item.media || []).forEach(function (m) {
      var wrap = el('div', 'detail-media');
      var t = mediaType(m);

      if (t === 'video') {
        var vid = document.createElement('video');
        vid.src = m.src;
        vid.controls = true;
        vid.playsInline = true;
        vid.preload = 'metadata';
        if (item.cover) vid.poster = item.cover;
        wrap.appendChild(vid);
      } else if (t === 'model') {
        var box = el('div', 'viewer3d');
        wrap.appendChild(box);
        wrap.appendChild(el('p', 'viewer3d-hint', '드래그로 회전 · 휠로 확대 — drag to rotate'));
        mountModel(box, m.src);
      } else if (t === 'embed') {
        var ifr = document.createElement('iframe');
        ifr.src = embedSrc(m.src);
        ifr.allow = 'autoplay; fullscreen; picture-in-picture';
        ifr.allowFullscreen = true;
        ifr.title = item.title || 'embed';
        wrap.appendChild(ifr);
      } else {
        var img = document.createElement('img');
        img.src = m.src;
        img.alt = m.caption || item.title || '';
        img.loading = 'lazy';
        wrap.appendChild(img);
      }

      if (m.caption) wrap.appendChild(el('p', 'media-caption', m.caption));
      overlayBody.appendChild(wrap);
    });

    if (item.description) {
      overlayBody.appendChild(el('div', 'detail-desc', item.description));
    }
    if (item.links && item.links.length) {
      var links = el('div', 'detail-links');
      item.links.forEach(function (l) {
        if (!l.href) return;
        var a = el('a', null, l.label || l.href);
        a.href = l.href;
        a.target = '_blank';
        a.rel = 'noopener';
        links.appendChild(a);
      });
      overlayBody.appendChild(links);
    }

    lastFocus = document.activeElement;
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('open'); });
    overlayClose.focus();
  }

  function closeDetail() {
    if (overlay.hidden) return;
    overlay.classList.remove('open');
    disposeViewers();
    overlay.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function mountModel(box, src) {
    var status = el('div', 'viewer3d-status', 'LOADING');
    box.appendChild(status);
    ensureThree().then(function () {
      if (!box.isConnected) return;
      var dispose = window.Viewer3D.mount(box, src, function onReady(err) {
        if (err) { status.textContent = '모델을 불러오지 못했습니다'; }
        else if (status.parentNode) { status.parentNode.removeChild(status); }
      });
      activeViewers.push(dispose);
    }).catch(function (e) {
      status.textContent = '3D 뷰어 오류: ' + ((e && e.message) || '라이브러리 로드 실패');
      if (window.console && console.error) console.error('[viewer3d]', e);
    });
  }

  var threePromise = null;
  function ensureThree() {
    if (window.THREE) return Promise.resolve();
    if (threePromise) return threePromise;
    threePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'lib/three.bundle.js?v=2';
      s.onload = function () { resolve(); };
      s.onerror = function () { threePromise = null; reject(new Error('three load fail')); };
      document.head.appendChild(s);
    });
    return threePromise;
  }

  overlayClose.addEventListener('click', function () {
    location.hash = lastSection;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) location.hash = lastSection;
  });

  /* ---------- router ---------- */

  function setSection(name) {
    SECTIONS.forEach(function (s) {
      stage[s].hidden = (s !== name);
    });
    navLinks.forEach(function (a) {
      var on = a.getAttribute('data-view') === name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.classList.toggle('on-home', name === 'home');
    if (window.HomeFX) {
      if (name === 'home') window.HomeFX.start(document.getElementById('homeCanvas'));
      else window.HomeFX.stop();
    }
    lastSection = name;
  }

  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'home';
    var m = /^([ws])\/(.+)$/.exec(h);
    if (m) {
      var item = findItem(m[1], m[2]);
      if (item) {
        setSection(m[1] === 's' ? 'studies' : 'works');
        openDetail(item);
        return;
      }
      location.hash = 'works';
      return;
    }
    closeDetail();
    if (SECTIONS.indexOf(h) < 0) h = 'home';
    setSection(h);
  }

  window.addEventListener('hashchange', route);

  /* ---------- boot ---------- */

  buildStrip();
  buildStudies();
  buildAbout();
  buildContact();
  route();
})();
