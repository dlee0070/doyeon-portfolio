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
    GRAIN: 0.5,        // 입자 한 알의 크기 (CSS px) — 화면의 모든 것이 이 알갱이로 그려진다
    SCATTER: 3.2,      // 가장자리 입자가 흩어지는 최대 거리 (입자 크기 배수)
    DRAG: 0.55,        // 마우스를 움직일 때 입자가 딸려오는 정도 (0 = 없음)
    BURST_R: 0.26,     // 클릭 파문의 최대 반경 (화면 짧은 변 대비 비율)
    BURST_MS: 1700,    // 파문이 퍼지고 가라앉기까지의 시간 — 모래는 서두르지 않는다
    PRESS_DRAG: 2.2,   // 누른 채 끌 때 딸려오는 힘의 배수
    STIR: 3.5          // 누른 채 있을 때 알갱이가 휘저어지는(섞이는) 세기
  };

  /* 문양 5종과 주제 키워드 (Adinkra) */
  var MOTIFS = [
    { key: 'heritage', label: 'Cultural Heritage',     src: 'assets/pattern/adinkra-heritage.svg' },  // Mate Masie
    { key: 'media',    label: 'Interactive Media Art', src: 'assets/pattern/adinkra-media.svg' },     // Dame-Dame
    { key: 'xr',       label: 'XR',                    src: 'assets/pattern/adinkra-xr.svg' },        // Abode Santann
    { key: 'data',     label: 'Data Analysis',         src: 'assets/pattern/adinkra-data.svg' },      // Nea Onnim No Sua A, Ohu
    { key: 'moving',   label: 'Moving Image',          src: 'assets/pattern/adinkra-art.svg' }        // 예술 (소유자 제공 문양)
  ];

  /* 이 주제(key)에 속한 작품·연구 제목들 — works[].themes / studies[].themes 로 연결 (컬렉션의 평면도) */
  function worksOfTheme(key) {
    var d = window.SITE_DATA || {};
    var all = (d.works || []).concat(d.studies || []);
    return all.filter(function (w) {
      var t = Array.isArray(w.themes) ? w.themes : String(w.themes || '').split(',');
      return w.title && t.map(function (s) { return String(s).trim(); }).indexOf(key) >= 0;
    }).map(function (w) {
      /* 연구는 부제 앞까지만 — 라벨 한 줄이 벽화가 되지 않게 */
      return String(w.title).split(':')[0].split('—')[0].trim();
    }).join(' · ');
  }
  /* 다섯 문양은 같은 크기 — 위계 없이 대등하게 */
  var SCALES = [1.0, 1.0, 1.0, 1.0, 1.0];
  var MAX_SCALE = Math.max.apply(null, SCALES);

  var canvas = null, gl = null, prog = null, quad = null, texHeight = null;
  var uni = {};
  var ready = false, active = false, failed = false, rafId = null, initPromise = null;

  var images = [];      // 로드된 문양 이미지
  var damaskImg = null; // 배경 다마스크 부조 (벽지처럼 아주 옅게 깔린다)
  var placed = [];      // 현재 배치 [{x, y, size}] (CSS px) — 리사이즈 시 재분산
  var labelEl = null, labelMain = null, labelWorks = null;
  var labelIdx = -1;    // 현재 라벨이 가리키는 문양
  var rescatterTimer = null;

  var dpr = 1;
  var mouseX = -1e4, mouseY = -1e4;
  var burstX = -1e4, burstY = -1e4, burstStart = -1e9;   // 클릭/터치 파문
  var pressAmp = 0, pressTarget = 0, churn = 0;          // 누른 채 드래그 — 교반 상태
  var smX = -1e4, smY = -1e4;
  var lblX = -1e4, lblY = -1e4;    // 키워드 라벨 위치 (커서보다 살짝 무겁게 따라온다)
  var idleStart = 0;               // 배회 빛의 시작 시각 — 첫 문양 위에서 출발
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
    'uniform vec3 uBurst;',     // 클릭 파문 (x, y, 최대 반경 — device px)
    'uniform float uBurstT;',   // 파문 진행도 0..1 (1 = 없음)
    'uniform float uPress;',    // 누름 상태 0..1 (부드럽게 완화됨)
    'uniform float uChurn;',    // 누른 동안 누적되는 교반 위상
    'uniform float uStir;',     // 교반 세기 (FX.STIR)
    'uniform float uPressDrag;',// 누른 채 끌 때 딸려오는 배수 (FX.PRESS_DRAG)
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
    // ---- 누른 채 드래그: 손가락 아래 모래가 휘저어진다 ----
    // 알갱이마다 도는 속도가 달라 이웃한 입자들이 서로 자리를 바꾸며 섞인다.
    // 위상(ang)은 press가 아니라 uChurn 자체로 유지된다 — 저은 모래는 되감기지 않고,
    // JS 쪽에서 uChurn이 천천히 잦아들며 제자리로 「가라앉는다」
    '  float prox = exp(-d / (uRadius * 0.35));',
    '  float stir = uPress * prox;',
    '  ang += uChurn * (0.6 + 1.4 * r2) * prox;',
    '  rad *= 1.0 + uStir * stir * (0.4 + 0.6 * r3);',
    '',
    // ---- 커서 드래그: 커서가 움직이면 근처 입자들이 이동 방향으로 딸려온다 ----
    // 셀마다 딸려오는 양이 달라 문양의 입자들이 흐름을 따라 늘어지고 서로 섞인다
    // 누른 채 끌면 훨씬 강하게 — 모래가 손에 붙어 끌려오는 느낌
    '  float drag = exp(-d / (uRadius * 0.55));',
    '  vec2 dragOff = -uVel * drag * (0.35 + 0.95 * r2) * (1.0 + uPressDrag * uPress);',
    '',
    // ---- 클릭 파문: 손이 닿은 곳에서 모래알이 낮게 밀렸다 느리게 가라앉는다 ----
    // 감속하는 파면(wavefront)이 천천히 번지고, 알갱이마다 닿는 시점이 어긋나
    // 가장자리가 너덜하다. 대부분은 조금 밀리고 몇 알만 멀리 튄다 (모래의 분포)
    '  float bd = distance(p, uBurst.xy);',
    '  float bw = uBurst.z * (1.0 - (1.0 - uBurstT) * (1.0 - uBurstT));',
    // ~100ms 어택 — 손이 모래에 「꽂히는」 순간이 있고 나서 퍼진다 (0에서 팝 금지)
    '  float env = pow(1.0 - uBurstT, 0.65) * smoothstep(0.0, 0.06, uBurstT);',
    '  float ragged = (r1 - 0.5) * uBurst.z * 0.12;',             // 알갱이마다 파면이 닿는 시점이 다르다
    '  float bk = exp(-abs(bd - bw + ragged) / (uBurst.z * 0.22)) * env;',
    '  vec2 bdir = bd > 0.5 ? (p - uBurst.xy) / bd : vec2(0.0);',
    '  vec2 burstOff = -bdir * bk * uBurst.z * (0.05 + 0.28 * r2 * r2)',   // 대부분 조금, 몇 알만 멀리
    '                  + vec2(-bdir.y, bdir.x) * bk * uBurst.z * 0.08 * (r3 - 0.5);',
    '',
    '  vec2 p2 = p + vec2(cos(ang), sin(ang)) * rad + dragOff + burstOff;',
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
    var topSafe = narrow ? 126 : 90;       // 헤더(+메뉴) 아래부터 배치
    var leftSafe = narrow ? 0 : 200;       // 데스크톱: 내비 축(200px) 오른쪽 — 콘텐츠 페이지와 같은 축
    var pad = 14;

    // 퀸컹스(quincunx) — 네 모서리 + 중앙. 다섯 문양이 주사위 5처럼 앉는다
    var usableH = h - topSafe - pad;
    var usableW = w - leftSafe - pad;
    var stagger = (w > h ? 0.05 : 0.025) * usableH;   // 열끼리 살짝 어긋나게 (유기적 분산)
    var cells = [];
    for (var ci = 0; ci < 2; ci++) {
      for (var ri = 0; ri < 2; ri++) {
        cells.push({
          x: leftSafe + usableW * (ci === 0 ? 0.22 : 0.78) + (Math.random() - 0.5) * usableW * 0.04,
          y: topSafe + usableH * (ri === 0 ? 0.24 : 0.73) +
             (ci === 0 ? -1 : 1) * stagger + (Math.random() - 0.5) * usableH * 0.04
        });
      }
    }
    cells.push({
      x: leftSafe + usableW * 0.5 + (Math.random() - 0.5) * usableW * 0.04,
      y: topSafe + usableH * 0.485 + (Math.random() - 0.5) * usableH * 0.04
    });
    // 문양 ↔ 자리 무작위 배정 (접속할 때마다 다른 배치)
    for (var i = cells.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }

    // 목표 크기(FX.MOTIF_SIZE)에서 시작해, 서로/가장자리와 충돌하지 않는 최대 크기로 자동 축소
    var maxScale = MAX_SCALE;
    var cap = minSide * FX.MOTIF_SIZE;
    var edgeTop = topSafe - 46;            // 문양 위쪽은 헤더 라인 살짝 아래까지 허용
    var edgeLeft = leftSafe ? leftSafe - 40 : pad;   // 내비 축은 문양의 살짝 걸침만 허용
    var edgeBleed = maxScale * 0.92;       // 가장자리는 문양의 ~4%까지 살짝 걸쳐도 허용 (더 크게)
    for (var a = 0; a < cells.length; a++) {
      cap = Math.min(cap,
        2 * (cells[a].x - edgeLeft) / edgeBleed,
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
    // 배경 다마스크 — 벽 전체가 아주 얕게 조각된 석고 벽지 (문양보다 한참 낮은 높이)
    if (damaskImg) {
      ctx.globalAlpha = 0.20;
      var tw = Math.round(Math.max(340, Math.min(w, h) * 0.62) * s);
      var th = tw * 2;   // 원본 비율 1:2
      for (var ty2 = 0; ty2 < ch; ty2 += th) {
        for (var tx2 = 0; tx2 < cw; tx2 += tw) {
          ctx.drawImage(damaskImg, tx2, ty2, tw, th);
        }
      }
      ctx.globalAlpha = 1;
    }
    // 화면 해상도 기준의 블러를 합성 시점에 추가해, 문양 크기와 무관하게
    // 석고 특유의 완만한 경사(부드러운 높이 그라데이션)를 만든다
    // lighten: 문양이 다마스크 위에 "겹쳐 발린" 게 아니라 더 높은 부조로 올라온다
    ctx.globalCompositeOperation = 'lighten';
    try { ctx.filter = 'blur(2.4px)'; } catch (e) {}
    placed.forEach(function (p, i) {
      ctx.drawImage(images[i], (p.x - p.size / 2) * s, (p.y - p.size / 2) * s, p.size * s, p.size * s);
    });
    try { ctx.filter = 'none'; } catch (e) {}
    ctx.globalCompositeOperation = 'source-over';
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
    labelMain = document.createElement('span');
    labelWorks = document.createElement('span');
    labelWorks.className = 'home-label-works';
    labelEl.appendChild(labelMain);
    labelEl.appendChild(labelWorks);
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
      if (labelIdx !== best) {
        labelIdx = best;
        labelMain.textContent = MOTIFS[best].label;
        labelWorks.textContent = worksOfTheme(MOTIFS[best].key);
        var isKo = /[가-힣]/.test(MOTIFS[best].label);
        labelEl.classList.toggle('ko', isKo);
        labelEl.lang = isKo ? 'ko' : '';
      }
      // 커서를 따라다닌다 — 두 줄 라벨이 화면 밖·바닥의 태그라인 띠(100px) 위로 나가지 않게만 보정
      var w = canvas.clientWidth, h = canvas.clientHeight;
      var lw = labelEl.offsetWidth || 320;
      var lh = labelEl.offsetHeight || 50;
      var x = cssX + 24, y = cssY + 34;
      if (x + lw > w - 16) x = Math.max(16, cssX - lw - 20);
      if (y + lh > h - 100) y = cssY - lh - 20;
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
        ['uHeightT', 'uRes', 'uMouse', 'uAmp', 'uRadius', 'uFeather', 'uStrength', 'uTexel', 'uTime', 'uGrain', 'uScatter', 'uVel', 'uBurst', 'uBurstT', 'uPress', 'uChurn', 'uStir', 'uPressDrag'].forEach(function (n) {
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
        // 다마스크는 장식 — 실패해도 홈은 그대로 동작한다
        loadImage('assets/pattern/damask-height.svg').then(function (img) {
          damaskImg = img;
          if (ready) compose();
        }).catch(function () {});
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
    var bt = Math.min(1, Math.max(0, (performance.now() - burstStart) / FX.BURST_MS));
    gl.uniform3f(uni.uBurst, burstX * dpr, burstY * dpr,
      Math.min(canvas.width, canvas.height) * FX.BURST_R);
    gl.uniform1f(uni.uBurstT, reduceMotion ? 1 : bt);
    gl.uniform1f(uni.uPress, reduceMotion ? 0 : pressAmp);
    gl.uniform1f(uni.uChurn, churn);
    gl.uniform1f(uni.uStir, FX.STIR);
    gl.uniform1f(uni.uPressDrag, FX.PRESS_DRAG);
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
      // 포인터가 없을 때: 가상의 빛이 첫 문양 위에서 출발해 천천히 배회한다
      // (도착이지 부재가 아니다 — 첫 방문자가 빈 흰 벽만 보지 않도록)
      if (!idleStart) idleStart = now;
      var ph = now - idleStart;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      var a0 = placed.length ? placed[0] : { x: w * 0.5, y: h * 0.48 };
      tx = Math.max(20, Math.min(w - 20, a0.x + w * 0.30 * Math.sin(ph * 0.00019)));
      ty = Math.max(96, Math.min(h - 20, a0.y + h * 0.26 * Math.sin(ph * 0.00013 + 1.7)));
    } else {
      idleStart = 0;
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

    // 누름 상태 완화 + 교반 위상 누적 — 끌수록 더 섞이고,
    // 손을 떼면 위상이 천천히 잦아든다 (섞임을 되감지 않고 가라앉는다)
    pressAmp += (pressTarget - pressAmp) * 0.12;
    if (pressTarget > 0 && !reduceMotion) {
      churn += (0.035 + 0.012 * Math.min(30, Math.hypot(velX, velY))) * pressAmp;
    } else {
      churn *= 0.985;
    }

    renderAt(smX, smY, amp, reduceMotion ? 0 : now * 0.001);
    // 키워드 라벨도 질량을 가진다 — 커서보다 살짝 늦게(0.22) 따라와 같은 세계의 물건이 된다
    if (tx > -9000) {
      if (lblX < -9000) { lblX = tx; lblY = ty; }
      lblX += (tx - lblX) * 0.22;
      lblY += (ty - lblY) * 0.22;
      updateLabel(lblX, lblY, amp);
    }
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
  function onDown(e) {
    burstX = e.clientX; burstY = e.clientY;
    burstStart = performance.now();
    pressTarget = 1;
    if (e.pointerType === 'touch') {
      mouseX = e.clientX; mouseY = e.clientY;
      lastPointer = burstStart;
    }
  }
  function onUp() { pressTarget = 0; }

  function start(cnv) {
    if (failed) return;
    init(cnv).then(function () {
      if (active && rafId == null) rafId = requestAnimationFrame(frame);
    }).catch(function () {});
    if (active) return;
    active = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    pressTarget = 0;
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
