/* ==========================================================
   DOYEON LEE — Portfolio · app.js
   데이터는 content/data.js (window.SITE_DATA) 에서 읽어옵니다.
   ========================================================== */
(function () {
  'use strict';

  var DATA = window.SITE_DATA || { siteName: 'PORTFOLIO', works: [], studies: [], about: {}, contact: [] };
  var SECTIONS = ['home', 'works', 'about', 'contact', 'studies'];

  /* 홈 문양의 주제 키 ↔ 표시 이름 (home.js MOTIFS 와 같은 어휘) */
  var THEME_LABELS = {
    heritage: 'Cultural Heritage',
    media: 'Interactive Media Art',
    xr: 'XR',
    data: 'Data Analysis',
    moving: 'Moving Image'
  };
  var STATUS_LABELS = { ongoing: 'Ongoing', proposed: 'Proposed', completed: 'Completed', past: 'Completed' };
  var STATUS_ORDER = { ongoing: 0, proposed: 1, completed: 2, past: 2 };

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

  /* 배열이든 쉼표 문자열이든 → 다듬은 배열 */
  function listOf(x) {
    if (Array.isArray(x)) return x.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return String(x || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
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

  function firstImage(item) {
    if (item.cover) return item.cover;
    for (var k = 0; k < (item.media || []).length; k++) {
      if (mediaType(item.media[k]) === 'image') return item.media[k].src;
    }
    return '';
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

  /* hover 자동 재생 설정 — 관리도구가 저장한 값. 없으면 현행 동작(중간부터 4초 반복, 1×) */
  function hoverSettings(w) {
    var hv = w.hover || {};
    return {
      on: hv.enabled !== false,
      start: (hv.start != null && hv.start !== '' && isFinite(+hv.start) && +hv.start >= 0) ? +hv.start : null,
      len: (+hv.length >= 1) ? Math.min(+hv.length, 30) : 4,
      rate: (+hv.rate > 0) ? +hv.rate : 1,
      loop: hv.loop !== false
    };
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
  // document.title 은 index.html 의 SEO 제목을 그대로 둔다 (검색엔진은 렌더된 제목을 읽는다)

  /* ---------- works strip ---------- */

  function buildStrip() {
    var v = stage.works;
    v.textContent = '';
    if (!DATA.works || !DATA.works.length) {
      v.appendChild(el('p', 'strip-empty', 'No works yet.'));
      return;
    }
    var strip = el('div', 'strip');
    /* 터치 기기: hover가 없으니 벽 중앙에 온 작품이 스스로 재생된다 */
    var touchMode = window.matchMedia && window.matchMedia('(hover: none)').matches;
    var touchIO = null;
    if (touchMode && window.IntersectionObserver) {
      touchIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.target._pv) return;
          if (en.intersectionRatio >= 0.7) en.target._pv.enter();
          else en.target._pv.leave();
        });
      }, { root: v, threshold: [0, 0.7] });
    }
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
        var hv = hoverSettings(w);
        var hlStart = 0, hlEnd = 0;

        var vid = document.createElement('video');
        vid.src = firstMedia.src;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'metadata';

        vid.addEventListener('loadedmetadata', function () {
          var d = vid.duration;
          if (!isFinite(d) || d <= 0) return;
          hlStart = (hv.start == null || hv.start >= d) ? d / 2 : Math.min(hv.start, Math.max(0, d - 0.5));
          hlEnd = Math.min(hlStart + hv.len, d);
          /* 커버 없는 영상은 이 seek 이 곧 대표 프레임 — preload=metadata 만으로는 한 프레임도 안 그려진다.
             커버가 있으면 영상이 그 뒤에 숨어 있으니 hover 전엔 굳이 받아오지 않는다 */
          if (!w.cover || a.classList.contains('previewing')) vid.currentTime = hlStart;
        });
        /* 하이라이트 구간만 — 반복이거나, 끝에서 멈추거나 */
        vid.addEventListener('timeupdate', function () {
          if (vid.paused || !hlEnd) return;
          if (vid.currentTime >= hlEnd) {
            if (hv.loop) vid.currentTime = hlStart;
            else vid.pause();
          }
        });
        /* 구간 끝이 영상 끝과 같으면 브라우저가 먼저 멈춘다 — ended 에서 되감아야 반복이 이어진다 */
        vid.addEventListener('ended', function () {
          if (!hv.loop || !a.classList.contains('previewing')) return;
          vid.currentTime = hlStart;
          var p = vid.play();
          if (p && p.catch) p.catch(function () {});
        });

        var enterPv = function () {
          a.classList.add('previewing');
          vid.playbackRate = hv.rate;
          if (hlStart) vid.currentTime = hlStart;
          var p = vid.play();
          if (p && p.catch) p.catch(function () {});
        };
        var leavePv = function () {
          a.classList.remove('previewing');
          vid.pause();
          vid.currentTime = hlStart; // 정지 상태의 대표 프레임
        };
        if (hv.on) {
          a.addEventListener('mouseenter', enterPv);
          a.addEventListener('mouseleave', leavePv);
          if (touchIO) {
            a._pv = { enter: enterPv, leave: leavePv };
            touchIO.observe(a);
          }
        }

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
        node = document.createElement('img');
        node.src = firstImage(w) || PLACEHOLDER;
        node.alt = w.title || '';
        node.loading = i > 5 ? 'lazy' : 'eager';
        node.draggable = false;
      }
      a.appendChild(node);

      /* 터치 기기 전용 이름표 (데스크톱 벽은 침묵 — 커서 라벨이 말한다) */
      a.appendChild(el('span', 'strip-caption', (w.title || '') + (w.year ? ' — ' + w.year : '')));

      a.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch') return;
        var medium = String(w.medium || '').split(/[,—–]/)[0].trim();
        showLabel(w.title + (w.year ? ' — ' + w.year : '') + (medium ? ' · ' + medium : ''));
      });
      a.addEventListener('pointerleave', hideLabel);
      strip.appendChild(a);
    });
    v.appendChild(strip);

    /* 벽 진행선 — 넘칠 때만 나타난다 */
    var prog = el('div', 'strip-progress');
    var thumb = document.createElement('i');
    prog.appendChild(thumb);
    v.appendChild(prog);
    function updProgress() {
      var max = v.scrollWidth - v.clientWidth;
      prog.style.display = max > 4 ? '' : 'none';
      if (max <= 0) return;
      // thumb 폭 = 보이는 비율 — 벽이 얼마나 긴지 정직하게 말한다
      thumb.style.width = Math.max(12, prog.clientWidth * v.clientWidth / v.scrollWidth) + 'px';
      var track = prog.clientWidth - thumb.offsetWidth;
      thumb.style.transform = 'translateX(' + (v.scrollLeft / max) * track + 'px)';
    }
    v.addEventListener('scroll', updProgress);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(updProgress);
      ro.observe(v);       // 뷰가 드러나거나 크기가 바뀔 때
      ro.observe(strip);   // 이미지가 로드되어 벽이 길어질 때
    } else {
      window.addEventListener('resize', updProgress);
    }
    updProgress();
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
    function endDrag() {
      down = false;
      v.classList.remove('dragging');
    }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
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

  /* ---------- research (studies) ---------- */

  function statusOf(s) {
    var k = String(s.status || 'completed').toLowerCase();
    return STATUS_LABELS[k] ? k : 'completed';
  }

  function buildStudies() {
    var v = stage.studies;
    v.textContent = '';
    v.appendChild(el('p', 'view-label', 'Research'));
    var items = (DATA.studies || []).slice();
    var hasList = items.length > 0;
    var list = el('div', 'studies-list');
    if (!hasList) {
      if (!DATA.studiesGif) list.appendChild(el('p', 'strip-empty', 'No research entries yet.'));
    } else {
      /* 진행 중 → 제안 → 완료 순, 같은 묶음 안에서는 관리도구 순서 */
      items.sort(function (a, b) {
        return STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)];
      });
      items.forEach(function (s) {
        var row = el('a', 'study-row');
        row.href = '#s/' + encodeURIComponent(s.id);
        row.appendChild(el('span', 'study-year', s.year || ''));

        var main = el('div', 'study-main');
        main.appendChild(el('div', 'study-title', s.title || ''));
        /* 상태 · 홈의 큰 주제 키워드 — 세부 키워드는 상세 화면에 */
        var themeNames = listOf(s.themes).map(function (k) { return THEME_LABELS[k] || k; });
        var sub = [STATUS_LABELS[statusOf(s)]].concat(themeNames.length ? themeNames : listOf(s.keywords)).join(' · ');
        main.appendChild(el('div', 'study-sub', sub));
        if (s.summary) main.appendChild(el('p', 'study-summary', s.summary));
        row.appendChild(main);

        var img = firstImage(s);
        if (img) {
          var th = el('img', 'study-thumb');
          th.src = img;
          th.alt = '';
          th.loading = 'lazy';
          th.draggable = false;
          row.appendChild(th);
        }
        list.appendChild(row);
      });
    }
    if (hasList || !DATA.studiesGif) v.appendChild(list);
    /* GIF 는 목록 아래에 늘 걸린다 (소유자 요청 — 방의 볼거리) */
    if (DATA.studiesGif) {
      var gif = el('img', 'studies-gif');
      gif.src = DATA.studiesGif;
      gif.alt = '';
      gif.draggable = false;
      v.appendChild(gif);
    }
  }

  /* ---------- about / contact ---------- */

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  function buildAbout() {
    var v = stage.about;
    v.textContent = '';
    v.appendChild(el('p', 'view-label', 'About'));
    var inner = el('div', 'about-inner');
    var ab = DATA.about || {};
    if (ab.image) {
      var img = el('img', 'about-photo');
      img.src = ab.image;
      img.alt = siteName;
      inner.appendChild(img);
    }

    var statement = paragraphs(ab.statement || ab.text);
    if (statement.length) {
      inner.appendChild(el('h2', 'about-heading', 'Statement'));
      var txt = el('div', 'about-text');
      statement.forEach(function (p) { txt.appendChild(el('p', null, p)); });
      inner.appendChild(txt);
    }

    var bio = paragraphs(ab.bio);
    if (bio.length) {
      inner.appendChild(el('h2', 'about-heading', 'Biography'));
      var bt = el('div', 'about-text');
      bio.forEach(function (p) { bt.appendChild(el('p', null, p)); });
      inner.appendChild(bt);
    }

    var dirs = listOf(ab.directions);
    if (dirs.length) {
      inner.appendChild(el('h2', 'about-heading', 'Directions'));
      inner.appendChild(el('p', 'about-directions', dirs.join(' · ')));
    }

    /* CV — 한 줄 = 한 항목. 연도로 시작하면 행, "- " 로 시작하면 연도 없는 행, 나머지는 소제목 */
    var cv = Array.isArray(ab.cv) ? ab.cv : String(ab.cv || '').split('\n');
    cv = cv.map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (cv.length) {
      inner.appendChild(el('h2', 'about-heading', 'CV'));
      var cvWrap = el('div', 'about-cv');
      cv.forEach(function (line) {
        var m = /^(\d{4}(?:\s*[–-]\s*(?:\d{4}|\d{2}|present)?)?)\s+(.+)$/i.exec(line);
        if (m) {
          var r = el('div', 'cv-row');
          r.appendChild(el('span', 'cv-year', m[1].replace(/\s+/g, '')));
          r.appendChild(el('span', 'cv-text', m[2]));
          cvWrap.appendChild(r);
        } else if (/^[-–•]\s*/.test(line)) {
          var r2 = el('div', 'cv-row');
          r2.appendChild(el('span', 'cv-year', ''));
          r2.appendChild(el('span', 'cv-text', line.replace(/^[-–•]\s*/, '')));
          cvWrap.appendChild(r2);
        } else {
          cvWrap.appendChild(el('div', 'cv-section', line));
        }
      });
      inner.appendChild(cvWrap);
    }

    if (ab.cvPdf) {
      var pdf = el('a', 'about-cvlink', 'Download CV (PDF)');
      pdf.href = ab.cvPdf;
      pdf.target = '_blank';
      pdf.rel = 'noopener';
      inner.appendChild(pdf);
    }
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
    v.appendChild(el('p', 'view-label', 'Contact'));
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

  /* ---------- crawlable index — data.js 전체를 검색엔진이 읽을 수 있게 DOM에 올린다 ---------- */

  function buildIndex() {
    var sec = el('section', 'site-index');
    sec.id = 'index';
    sec.hidden = true;   // display:none — 스크린리더는 중복을 건너뛰고, 검색엔진(모바일 우선)은 읽는다
    sec.appendChild(el('h1', null, siteName + ' — Media Artist, Seoul'));
    if (DATA.siteTagline) sec.appendChild(el('p', null, DATA.siteTagline));
    var ab = DATA.about || {};
    paragraphs(ab.statement || ab.text).forEach(function (p) { sec.appendChild(el('p', null, p)); });
    paragraphs(ab.bio).forEach(function (p) { sec.appendChild(el('p', null, p)); });
    [['Works', 'w', DATA.works], ['Research', 's', DATA.studies]].forEach(function (grp) {
      if (!grp[2] || !grp[2].length) return;
      sec.appendChild(el('h2', null, grp[0]));
      grp[2].forEach(function (it) {
        var art = el('article');
        var h = el('h3');
        var a = el('a', null, it.title || '');
        a.href = '#' + grp[1] + '/' + encodeURIComponent(it.id);
        h.appendChild(a);
        art.appendChild(h);
        var meta = [it.year, it.medium, listOf(it.tools).join(', '), listOf(it.keywords).join(', ')].filter(Boolean).join(' · ');
        if (meta) art.appendChild(el('p', null, meta));
        if (it.description) art.appendChild(el('p', null, it.description));
        sec.appendChild(art);
      });
    });
    (DATA.contact || []).forEach(function (c) {
      sec.appendChild(el('p', null, (c.label ? c.label + ': ' : '') + (c.value || '')));
    });
    document.body.appendChild(sec);

    /* 작품 목록 JSON-LD — data.js 에서 만들어지니 낡을 수 없다 */
    var canon = document.querySelector('link[rel="canonical"]');
    var SITE = (canon && canon.href) || (location.origin + '/');
    var ld = {
      '@context': 'https://schema.org', '@type': 'ItemList', '@id': SITE + '#works', name: 'Works',
      itemListElement: (DATA.works || []).map(function (w, i) {
        var item = {
          '@type': 'VisualArtwork', '@id': SITE + '#w/' + encodeURIComponent(w.id),
          url: SITE + '#w/' + encodeURIComponent(w.id),
          name: w.title,
          creator: { '@id': SITE + '#person' }
        };
        if (w.year) item.dateCreated = w.year;
        if (w.description) item.description = w.description;
        if (w.medium) item.artMedium = w.medium;
        var img = firstImage(w);
        if (img) item.image = SITE + img;
        return { '@type': 'ListItem', position: i + 1, item: item };
      })
    };
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
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

  function setInert(on) {
    ['stage'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.inert = on;
    });
    var nav = document.querySelector('.side-nav');
    if (nav) nav.inert = on;
    var head = document.querySelector('.site-header');
    if (head) head.inert = on;
  }

  function metaRow(label, valueNode) {
    if (valueNode == null || valueNode === '') return null;
    var r = el('div', 'meta-row');
    r.appendChild(el('span', 'meta-label', label));
    var v = el('span', 'meta-value');
    if (typeof valueNode === 'string') v.textContent = valueNode;
    else v.appendChild(valueNode);
    r.appendChild(v);
    return r;
  }

  function linkList(pairs) {
    /* [{label, href}] → "a · a · a" */
    var frag = document.createDocumentFragment();
    pairs.forEach(function (p, i) {
      if (i) frag.appendChild(document.createTextNode(' · '));
      var a = el('a', null, p.label);
      a.href = p.href;
      frag.appendChild(a);
    });
    return frag;
  }

  /* 작품 → 이 작품이 속한 연구 (studies[].relatedWorks 를 훑는다 — 진실은 한 곳에) */
  function studiesOfWork(id) {
    return (DATA.studies || []).filter(function (s) {
      return listOf(s.relatedWorks).indexOf(id) >= 0;
    });
  }

  function openDetail(item, kind) {
    hideLabel();
    disposeViewers();
    overlayTitle.textContent = item.title || '';
    var koTitle = /[가-힣]/.test(item.title || '');
    overlayTitle.classList.toggle('ko', koTitle);
    overlayTitle.lang = koTitle ? 'ko' : '';
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
        wrap.appendChild(el('p', 'viewer3d-hint', 'Drag to rotate · Scroll to zoom'));
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

    /* 톰스톤 — 비어 있는 줄은 그리지 않는다 (가짜 없음) */
    var meta = el('div', 'detail-meta');
    var rows = [];
    if (kind === 's') {
      rows.push(metaRow('Status', STATUS_LABELS[statusOf(item)]));   // 기간은 머리글의 연도가 이미 말한다
      var sThemes = listOf(item.themes).map(function (k) { return THEME_LABELS[k] || k; });
      rows.push(metaRow('Themes', sThemes.join(', ')));
      rows.push(metaRow('Keywords', listOf(item.keywords).join(' · ')));
      var rel = listOf(item.relatedWorks).map(function (id) { return findItem('w', id); }).filter(Boolean);
      if (rel.length) {
        rows.push(metaRow('Works', linkList(rel.map(function (w) {
          return { label: w.title + (w.year ? ' (' + w.year + ')' : ''), href: '#w/' + encodeURIComponent(w.id) };
        }))));
      }
    } else {
      rows.push(metaRow('Medium', item.medium || ''));
      rows.push(metaRow('Duration', item.duration || ''));
      rows.push(metaRow('Format', item.format || ''));
      rows.push(metaRow('Role', item.role || ''));
      rows.push(metaRow('Tools', listOf(item.tools).join(', ')));
      rows.push(metaRow('Credits', item.credits || ''));
      /* 전시 이력은 한 줄 = 한 항목 (장소, 도시 처럼 쉼표를 품는다) */
      var ex = Array.isArray(item.exhibitions) ? item.exhibitions
        : String(item.exhibitions || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      ex.forEach(function (x, i) {
        var text = typeof x === 'string' ? x : [x.year, x.venue, x.city].filter(Boolean).join(' — ');
        rows.push(metaRow(i === 0 ? 'Exhibited' : '', text));
      });
      var themes = listOf(item.themes).map(function (k) { return THEME_LABELS[k] || k; });
      rows.push(metaRow('Themes', themes.join(', ')));
      var partOf = studiesOfWork(item.id);
      if (partOf.length) {
        rows.push(metaRow('Research', linkList(partOf.map(function (s) {
          return { label: s.title, href: '#s/' + encodeURIComponent(s.id) };
        }))));
      }
    }
    rows = rows.filter(Boolean);
    if (rows.length) {
      rows.forEach(function (r) { meta.appendChild(r); });
      overlayBody.appendChild(meta);
    }

    if (item.description) {
      overlayBody.appendChild(el('h2', 'detail-heading', kind === 's' ? 'Abstract' : 'Statement'));
      overlayBody.appendChild(el('div', 'detail-desc', item.description));
    }
    if (item.descriptionKo) {
      var ko = el('div', 'detail-desc ko', item.descriptionKo);
      ko.lang = 'ko';
      overlayBody.appendChild(ko);
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
      if (links.childNodes.length) {
        overlayBody.appendChild(el('h2', 'detail-heading', 'Related'));
        overlayBody.appendChild(links);
      }
    }

    if (overlay.hidden) lastFocus = document.activeElement;   // 오버레이 안에서 다른 항목으로 건너가도 돌아갈 자리는 처음 것
    overlay.hidden = false;
    setInert(true);   // 오버레이가 열려 있는 동안 뒤 페이지는 잠긴다 (Tab이 새지 않도록)
    requestAnimationFrame(function () { overlay.classList.add('open'); });
    overlayClose.focus();
  }

  function closeDetail() {
    if (overlay.hidden) return;
    var wasOpen = overlay.classList.contains('open');   // 열림 전환이 아직이면 스냅 닫기
    overlay.classList.remove('open');
    disposeViewers();
    setInert(false);
    /* 초점은 열었던 자리로 — 그 자리가 사라졌거나 숨겨졌으면 활성 메뉴로 */
    var back = (lastFocus && lastFocus !== document.body && lastFocus.isConnected && !lastFocus.closest('[hidden]'))
      ? lastFocus : document.querySelector('.side-nav a.active');
    if (back && back.focus) back.focus();
    /* 퇴장 모션(0.3s)이 끝난 뒤에 숨긴다 — 진입만 있고 퇴장이 스냅이면 값싸 보인다 */
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      overlay.removeEventListener('transitionend', onEnd);
      if (!overlay.classList.contains('open')) overlay.hidden = true;
    }
    function onEnd(e) { if (e.target === overlay) finish(); }   // 자식(닫기 버튼)의 전환이 올라와 끊지 않게
    if (reduce || !wasOpen) { finish(); return; }
    overlay.addEventListener('transitionend', onEnd);
    setTimeout(finish, 400);
  }

  function mountModel(box, src) {
    var status = el('div', 'viewer3d-status', 'LOADING');
    box.appendChild(status);
    ensureThree().then(function () {
      if (!box.isConnected) return;
      var dispose = window.Viewer3D.mount(box, src, function onReady(err) {
        if (err) { status.textContent = 'Could not load the model'; }
        else if (status.parentNode) { status.parentNode.removeChild(status); }
      });
      activeViewers.push(dispose);
    }).catch(function (e) {
      status.textContent = '3D viewer error: ' + ((e && e.message) || 'library failed to load');
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

  var leaveTimer = null;
  function setSection(name) {
    var prev = lastSection;
    /* 떠나는 뷰는 위로 사라진 뒤 숨긴다 — 들어올 땐 아래에서, 나갈 땐 위로 (홈은 배경이라 즉시) */
    if (prev && prev !== name && prev !== 'home' && stage[prev] && !stage[prev].hidden) {
      var pv = stage[prev];
      pv.classList.add('leaving');
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(function () {
        pv.classList.remove('leaving');
        if (pv !== stage[lastSection]) pv.hidden = true;   // 그새 다시 활성됐다면 그대로 둔다
      }, 220);
    }
    SECTIONS.forEach(function (s) {
      if (s === name) {
        stage[s].classList.remove('leaving');
        stage[s].hidden = false;
      } else if (s !== prev || prev === 'home' || prev === name) {
        stage[s].hidden = true;
      }
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
    var h;
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = ''; }   // 깨진 공유 링크에도 화면은 뜬다
    h = h || 'home';
    var m = /^([ws])\/(.+)$/.exec(h);
    if (m) {
      var item = findItem(m[1], m[2]);
      if (item) {
        /* 오버레이 안에서 건너뛴 링크면 뒤 방은 그대로 — 닫으면 출발한 방으로 돌아간다 */
        if (overlay.hidden) setSection(m[1] === 's' ? 'studies' : 'works');
        openDetail(item, m[1]);
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
  buildIndex();
  route();
})();
