/* ==========================================================
   HomeFX — 홈 화면 석고 부조 인터랙티브 (Adinkra 문양 4종)
   4개의 문양이 화면에 무작위로 흩어져 있고, 커서가 다가가면
   그 문양이 석고 부조로 떠오르며 주제 키워드가 나타난다.
   바깥 영역은 순수한 흰 화면. 조정값은 아래 FX 블록.
   ========================================================== */
(function () {
  'use strict';

  var FX = {
    RADIUS: 0.36,      // 부조 원 반경 (화면 짧은 변 대비 비율. 0.36 = 36%)
    FEATHER: 7,        // 페더(가장자리 부드러움). 높일수록 가장자리가 더 옅고 넓게 풀림
    STRENGTH: 52.0,    // 커서 중심의 bump 최대 높이
    FOLLOW: 0.05,      // 커서를 따라오는 관성 (낮을수록 느긋하게 따라옴)
    RISE: 0.05,        // 부조가 떠오르고 가라앉는 속도
    MOTIF_SIZE: 0.5,   // 각 문양의 목표 크기 (화면 짧은 변 대비 비율 — 겹치지 않는 한도에서 자동 축소됨)
    LABEL_RANGE: 0.65, // 키워드가 뜨는 커서 거리 (문양 크기 대비 비율)
    GRAIN: 1.5,        // 입자 한 알의 크기 (CSS px) — 화면의 모든 것이 이 알갱이로 그려진다
    SCATTER: 3.2,      // 가장자리 입자가 흩어지는 최대 거리 (입자 크기 배수)
    DRAG: 0.55         // 마우스를 움직일 때 입자가 딸려오는 정도 (0 = 없음)
  };

  /* 문양 4종과 주제 키워드 (Adinkra) */
  var MOTIFS = [
    { key: 'heritage', label: 'Cultural Heritage',     src: 'assets/pattern/adinkra-heritage.svg' },  // Mate Masie
    { key: 'media',    label: 'Interactive Media Art', src: 'assets/pattern/adinkra-media.svg' },     // Dame-Dame
    { key: 'xr',       label: 'XR',                    src: 'assets/pattern/adinkra-xr.svg' },        // Abode Santann
    { key: 'data',     label: 'Data Analyzing',        src: 'assets/pattern/adinkra-data.svg' }       // Nea Onnim No Sua A, Ohu
  ];
  var SCALES = [1.0, 0.96, 1.04, 0.94];   // 문양마다 살짝 다른 크기 (유기적 배치감)

  var canvas = null, gl = null, prog = null, quad = null, texHeight = null;
  var uni = {};
  var ready = false, active = false, failed = false, rafId = null, initPromise = null;

  var images = [];      // 로드된 문양 이미지
  var placed = [];      // 현재 배치 [{x, y, size}] (CSS px) — 리사이즈 시 재분산
  var labelEl = null;
  var rescatterTimer = null;

  var dpr = 1;
  var mouseX = -1e4, mouseY = -1e4;
  var smX = -1e4, smY = -1e4;
  var velX = 0, velY = 0;          // 부드럽게 완화된 커서 속도 (CSS px/frame)
  var prevSmX = -1e4, prevSmY = -1e4;
  var amp = 0;
  var lastPointer = -1e9;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VS =
    'attribute vec2 aPos;' +
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';

  var FS = [
    'precision highp float;',
    'uniform sampler2D uHeightT;',
    'uniform vec2 uRes;',       // 캔버스 크기 (device px)
    'uniform vec2 uMouse;',     // 커서 (device px, y는 위에서 아래)
    'uniform float uAmp;',      // 전체 진폭 0..1
    'uniform float uRadius;',   // 부조 반경 (device px)
    'uniform float uFeather;',  // 가장자리 페더 지수 (FX.FEATHER)
    'uniform float uStrength;', // 중심 bump 세기 (FX.STRENGTH)
    'uniform vec2 uTexel;',     // 높이 텍스처 1픽셀 크기
    'uniform float uTime;',     // 초 단위 시간 (입자의 유기적 움직임)
    'uniform float uGrain;',    // 입자 한 알의 크기 (device px)
    'uniform float uScatter;',  // 가장자리 산란 최대 거리 (입자 크기 배수)
    'uniform vec2 uVel;',       // 커서 속도 (device px/frame) — 입자가 딸려오는 흐름
    '',
    'float H(vec2 uv){ return texture2D(uHeightT, uv).r; }',
    'float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }',
    '',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',   // 페이지 좌표계 (y 아래)
    '',
    '  float d = distance(p, uMouse);',
    // 종형 커널: 커서 중심에서 bump 높이 최대, 가장자리로 갈수록 0으로 감소 (페더)
    '  float t = clamp(d / uRadius, 0.0, 1.0);',
    '  float m = uAmp * pow(1.0 - t * t, uFeather);',
    '',
    // ---- 입자 격자: 화면을 입자 하나 크기의 셀로 나누고 셀마다 고유 난수를 뽑는다 ----
    '  float G = uGrain;',
    '  vec2 cell = floor(p / G);',
    '  float r1 = hash(cell);',
    '  float r2 = hash(cell + 19.19);',
    '  float r3 = hash(cell + 47.7);',
    '',
    // ---- 유기적 산란: 셀마다 아주 느리게 도는 오프셋 위치에서 필드를 읽는다 ----
    // 도형 내부는 통계적으로 동일해 형태가 그대로 유지되고,
    // 경계에서만 입자들이 안팎으로 흩어지며 살아있는 것처럼 숨쉰다
    '  float ang = r1 * 6.2831853 + uTime * (0.22 + 0.8 * r2);',
    '  float rad = G * (0.5 + (uScatter - 0.5) * r2 * r2);',       // 대부분은 가까이, 일부만 멀리
    '',
    // ---- 커서 드래그: 커서가 움직이면 근처 입자들이 이동 방향으로 딸려온다 ----
    // 셀마다 딸려오는 양이 달라 문양의 입자들이 흐름을 따라 늘어지고 서로 섞인다
    '  float drag = exp(-d / (uRadius * 0.55));',
    '  vec2 dragOff = -uVel * drag * (0.35 + 0.95 * r2);',
    '',
    '  vec2 p2 = p + vec2(cos(ang), sin(ang)) * rad + dragOff;',
    '  vec2 uv2 = p2 / uRes;',
    '',
    // ---- 석고 부조 라이팅 (산란된 위치 기준) ----
    '  float hx = H(uv2 + vec2(uTexel.x, 0.0)) - H(uv2 - vec2(uTexel.x, 0.0));',
    '  float hy = H(uv2 + vec2(0.0, uTexel.y)) - H(uv2 - vec2(0.0, uTexel.y));',
    '  float str = uStrength * m;',                                // 부조 높이는 오직 m(거리 감쇠)으로만 조절
    '  vec3 n = normalize(vec3(-hx * str, -hy * str, 1.0));',
    '',
    '  vec3 Ldir = normalize(vec3(-0.5, -0.62, 0.6));',            // 좌상단 광원
    '  float diff = max(dot(n, Ldir), 0.0);',
    '  vec3 Hv = normalize(Ldir + vec3(0.0, 0.0, 1.0));',
    '  float spec = pow(max(dot(n, Hv), 0.0), 30.0);',
    '',
    // ---- 석고 부조 음영 (산란·드래그된 위치 기준 — 가장자리는 자연히 입자로 부서진다) ----
    '  float plaster = 0.997 + (diff - 0.6) * 0.42 + spec * 0.05;',
    '',
    // ---- 명암 → 입자 밀도: 그늘 사면일수록 입자가 빽빽하고, 빛 받는 면은 비어 있다 ----
    '  float shade = clamp((0.60 - diff) * 2.1, 0.0, 1.0);',
    '  float sil = smoothstep(0.04, 0.6, H(uv2));',                // 실루엣 전체에 옅은 입자 먼지
    '  float ink = m * clamp(shade * 0.9 + sil * 0.10 - spec * 0.35, 0.0, 1.0);',
    '',
    // ---- 셀 안에 둥근 입자 하나 (중심을 흔들어 격자 느낌 제거) ----
    '  vec2 f = fract(p / G) - 0.5 + (vec2(r1, r3) - 0.5) * 0.55;',
    '  float grain = 1.0 - smoothstep(0.32, 0.48, length(f));',
    '',
    // ---- 석고 음영 위에 고운 입자를 얹는다 (석고 질감 + 유기적 grain) ----
    // step(0.02, ink): 해시 밴딩으로 빈 화면에 잔점이 생기지 않게 완전 흰 영역은 차단
    '  float on = step(r3, ink * 1.15) * step(0.02, ink);',
    '  float lum = clamp(plaster, 0.0, 1.0) - grain * on * (0.34 + 0.28 * r2);',
    '  gl_FragColor = vec4(vec3(clamp(lum, 0.0, 1.0)), 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('pattern load fail: ' + url)); };
      img.src = url;
    });
  }

  /* ---------- 배치: 화면 4분면에 고르게 분산 (지터 격자 + 자동 크기 맞춤) ---------- */

  function scatter() {
    if (!canvas) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var minSide = Math.min(w, h);
    var narrow = w <= 860;                 // 모바일: 상단에 가로 메뉴가 있다
    var topSafe = narrow ? 126 : 86;       // 헤더(+메뉴) 아래부터 배치
    var pad = 14;

    // 2x2 지터 격자 — 어떤 화면 비율에서도 네 구역에 하나씩 고르게
    var usableH = h - topSafe - pad;
    var stagger = (w > h ? 0.05 : 0.025) * usableH;   // 열끼리 살짝 어긋나게 (유기적 분산)
    var cells = [];
    for (var ci = 0; ci < 2; ci++) {
      for (var ri = 0; ri < 2; ri++) {
        cells.push({
          x: w * (ci === 0 ? 0.26 : 0.74) + (Math.random() - 0.5) * w * 0.05,
          y: topSafe + usableH * (ri === 0 ? 0.27 : 0.70) +
             (ci === 0 ? -1 : 1) * stagger + (Math.random() - 0.5) * usableH * 0.04
        });
      }
    }
    // 문양 ↔ 자리 무작위 배정 (접속할 때마다 다른 배치)
    for (var i = cells.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }

    // 목표 크기(FX.MOTIF_SIZE)에서 시작해, 서로/가장자리와 충돌하지 않는 최대 크기로 자동 축소
    var maxScale = 1.04;                   // SCALES의 최댓값
    var cap = minSide * FX.MOTIF_SIZE;
    var edgeTop = topSafe - 46;            // 문양 위쪽은 헤더 라인 살짝 아래까지 허용
    var edgeBleed = maxScale * 0.92;       // 가장자리는 문양의 ~4%까지 살짝 걸쳐도 허용 (더 크게)
    for (var a = 0; a < cells.length; a++) {
      cap = Math.min(cap,
        2 * (cells[a].x - pad) / edgeBleed,
        2 * (w - pad - cells[a].x) / edgeBleed,
        2 * (cells[a].y - edgeTop) / edgeBleed,
        2 * (h - pad - cells[a].y) / edgeBleed);
      for (var b = a + 1; b < cells.length; b++) {
        var d = Math.hypot(cells[a].x - cells[b].x, cells[a].y - cells[b].y);
        cap = Math.min(cap, d / (0.90 * maxScale));   // 문양 외곽에 여백이 있어 살짝의 근접은 허용
      }
    }
    placed = cells.map(function (c, k) {
      return { x: c.x, y: c.y, size: cap * SCALES[k] };
    });
  }

  /* 문양들을 화면 크기의 높이맵 한 장으로 합성해 텍스처로 올린다 */
  function compose() {
    if (!gl || !images.length || !placed.length) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var s = Math.min(1, 2048 / Math.max(w, h));
    var cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    // 화면 해상도 기준의 블러를 합성 시점에 추가해, 문양 크기와 무관하게
    // 석고 특유의 완만한 경사(부드러운 높이 그라데이션)를 만든다
    try { ctx.filter = 'blur(2.4px)'; } catch (e) {}
    placed.forEach(function (p, i) {
      ctx.drawImage(images[i], (p.x - p.size / 2) * s, (p.y - p.size / 2) * s, p.size * s, p.size * s);
    });
    try { ctx.filter = 'none'; } catch (e) {}
    gl.bindTexture(gl.TEXTURE_2D, texHeight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);   // NPOT: 밉맵 없음
    gl.uniform2f(uni.uTexel, 1 / cw, 1 / ch);
  }

  /* ---------- 키워드 라벨 ---------- */

  function ensureLabel() {
    if (labelEl || !canvas) return;
    labelEl = document.createElement('div');
    labelEl.className = 'home-label';
    (canvas.parentNode || document.body).appendChild(labelEl);
  }

  function updateLabel(cssX, cssY, ampV) {
    if (!labelEl || !placed.length) return;
    var best = -1, bestD = 1e9;
    for (var i = 0; i < placed.length; i++) {
      var d = Math.hypot(cssX - placed[i].x, cssY - placed[i].y);
      if (d < bestD) { bestD = d; best = i; }
    }
    var p = placed[best];
    var show = best >= 0 && ampV > 0.25 && bestD < p.size * FX.LABEL_RANGE;
    if (show) {
      if (labelEl.textContent !== MOTIFS[best].label) {
        labelEl.textContent = MOTIFS[best].label;
      }
      // 커서 끝을 그대로 따라다닌다 (화면 밖으로 나가지 않게만 보정)
      var w = canvas.clientWidth, h = canvas.clientHeight;
      var lw = labelEl.offsetWidth || 140;
      var x = cssX + 18, y = cssY + 26;
      if (x + lw > w - 10) x = cssX - lw - 16;
      if (y > h - 32) y = cssY - 34;
      labelEl.style.left = x + 'px';
      labelEl.style.top = y + 'px';
      labelEl.classList.add('on');
    } else {
      labelEl.classList.remove('on');
    }
  }

  /* ---------- GL 초기화 ---------- */

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var W = Math.round(w * dpr), Hh = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== Hh) {
      canvas.width = W; canvas.height = Hh;
      if (gl) {
        gl.viewport(0, 0, W, Hh);
        // 화면 크기가 바뀌면 새 비율에 맞춰 문양을 다시 분산 배치 (반응형)
        if (rescatterTimer) clearTimeout(rescatterTimer);
        rescatterTimer = setTimeout(function () {
          scatter();
          compose();
        }, 160);
      }
    }
  }

  function init(cnv) {
    if (initPromise) return initPromise;
    canvas = cnv;
    initPromise = new Promise(function (resolve, reject) {
      try {
        gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false })
          || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('no webgl');
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          throw new Error('link: ' + gl.getProgramInfoLog(prog));
        }
        gl.useProgram(prog);
        quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        ['uHeightT', 'uRes', 'uMouse', 'uAmp', 'uRadius', 'uFeather', 'uStrength', 'uTexel', 'uTime', 'uGrain', 'uScatter', 'uVel'].forEach(function (n) {
          uni[n] = gl.getUniformLocation(prog, n);
        });
        texHeight = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(uni.uHeightT, 0);
        resize();
        ensureLabel();
        Promise.all(MOTIFS.map(function (m) { return loadImage(m.src); })).then(function (imgs) {
          images = imgs;
          scatter();
          compose();
          ready = true;
          resolve();
        }).catch(reject);
      } catch (e) { reject(e); }
    });
    initPromise.catch(function () {
      failed = true;
      if (canvas) canvas.style.display = 'none';
    });
    return initPromise;
  }

  /* 프레임 하나를 지정 상태로 그린다 (테스트에서도 사용) */
  function renderAt(cssX, cssY, ampV, timeSec) {
    if (!ready) return false;
    resize();
    gl.uniform2f(uni.uRes, canvas.width, canvas.height);
    gl.uniform2f(uni.uMouse, cssX * dpr, cssY * dpr);
    gl.uniform1f(uni.uAmp, ampV);
    gl.uniform1f(uni.uRadius, Math.min(canvas.width, canvas.height) * FX.RADIUS);
    gl.uniform1f(uni.uFeather, FX.FEATHER);
    gl.uniform1f(uni.uStrength, FX.STRENGTH);
    gl.uniform1f(uni.uTime, timeSec || 0);
    gl.uniform1f(uni.uGrain, Math.max(2, FX.GRAIN * dpr));
    gl.uniform1f(uni.uScatter, FX.SCATTER);
    gl.uniform2f(uni.uVel, velX * dpr * FX.DRAG, velY * dpr * FX.DRAG);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    updateLabel(cssX, cssY, ampV);
    return true;
  }

  function frame(now) {
    rafId = active ? requestAnimationFrame(frame) : null;
    if (!ready) return;

    var idle = (now - lastPointer) > 3500;
    var tx = mouseX, ty = mouseY;
    if (idle && !reduceMotion) {
      // 포인터가 없을 때: 가상의 빛이 문양들 위를 천천히 배회
      var w = canvas.clientWidth, h = canvas.clientHeight;
      tx = w * (0.5 + 0.34 * Math.sin(now * 0.00019));
      ty = h * (0.48 + 0.3 * Math.sin(now * 0.00013 + 1.7));
    }
    var ampTarget = 1;
    if (tx <= -9000) ampTarget = 0;
    if (reduceMotion && idle) ampTarget = 0;

    if (tx > -9000) {
      if (smX < -9000) { smX = tx; smY = ty; }
      smX += (tx - smX) * FX.FOLLOW;
      smY += (ty - smY) * FX.FOLLOW;
    }
    amp += (ampTarget - amp) * FX.RISE;

    // 커서 속도 추적 — 갑작스런 이동은 완충하고, 멈추면 천천히 0으로 돌아온다 (입자가 되돌아오는 느낌)
    if (prevSmX > -9000 && smX > -9000 && !reduceMotion) {
      var dvx = smX - prevSmX, dvy = smY - prevSmY;
      var sp = Math.hypot(dvx, dvy);
      if (sp > 40) { dvx *= 40 / sp; dvy *= 40 / sp; }   // 과속 제한
      velX += (dvx - velX) * 0.10;
      velY += (dvy - velY) * 0.10;
    } else { velX = 0; velY = 0; }
    prevSmX = smX; prevSmY = smY;

    renderAt(smX, smY, amp, reduceMotion ? 0 : now * 0.001);
    // 부조는 관성 있는 위치(smX,smY)를 쓰지만, 키워드 라벨은 커서 끝(tx,ty)을 그대로 따라간다
    if (tx > -9000) updateLabel(tx, ty, amp);
  }

  function onMove(e) {
    mouseX = e.clientX; mouseY = e.clientY;
    lastPointer = performance.now();
  }
  function onTouch(e) {
    if (e.touches && e.touches[0]) {
      mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY;
      lastPointer = performance.now();
    }
  }

  function start(cnv) {
    if (failed) return;
    init(cnv).then(function () {
      if (active && rafId == null) rafId = requestAnimationFrame(frame);
    }).catch(function () {});
    if (active) return;
    active = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('resize', resize);
    if (ready && rafId == null) rafId = requestAnimationFrame(frame);
  }

  function stop() {
    active = false;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (labelEl) labelEl.classList.remove('on');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('resize', resize);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    } else if (active && rafId == null) {
      rafId = requestAnimationFrame(frame);
    }
  });

  window.HomeFX = {
    start: start,
    stop: stop,
    renderAt: renderAt,
    motifs: function () {
      return placed.map(function (p, i) {
        return { key: MOTIFS[i].key, label: MOTIFS[i].label, x: p.x, y: p.y, size: p.size };
      });
    }
  };
})();
