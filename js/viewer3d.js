/* ==========================================================
   Viewer3D — three.js GLB/GLTF 360° 뷰어
   lib/three.bundle.js 로드 후 사용 가능 (app.js가 지연 로드함)
   ========================================================== */
(function () {
  'use strict';

  window.Viewer3D = {
    /**
     * @param {HTMLElement} container  뷰어를 넣을 요소
     * @param {string} src             .glb / .gltf 경로
     * @param {function} onReady       (err) => void
     * @returns {function} dispose
     */
    mount: function (container, src, onReady) {
      var THREE = window.THREE;
      var disposed = false;
      var rafId = null;
      var resumeTimer = null;

      var renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0xffffff, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      var pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new window.RoomEnvironment(), 0.04).texture;

      var dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(3, 5, 4);
      scene.add(dir);

      var camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
      camera.position.set(0, 0.6, 3);

      var controls = new window.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.4;
      controls.addEventListener('start', function () {
        controls.autoRotate = false;
        if (resumeTimer) clearTimeout(resumeTimer);
      });
      controls.addEventListener('end', function () {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function () { controls.autoRotate = true; }, 4000);
      });

      function resize() {
        var w = container.clientWidth || 1;
        var h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      var ro = new ResizeObserver(resize);
      ro.observe(container);

      var loader = new window.GLTFLoader();
      var draco = new window.DRACOLoader();
      draco.setDecoderPath('lib/draco/');
      loader.setDRACOLoader(draco);

      loader.load(
        src,
        function (gltf) {
          if (disposed) return;
          var model = gltf.scene;
          scene.add(model);

          // 모델을 중앙 정렬하고 카메라 거리를 맞춘다
          var box = new THREE.Box3().setFromObject(model);
          var center = box.getCenter(new THREE.Vector3());
          var sphere = box.getBoundingSphere(new THREE.Sphere());
          var r = Math.max(sphere.radius, 0.001);

          controls.target.copy(center);
          var dist = r / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.25;
          camera.position.set(center.x + dist * 0.55, center.y + dist * 0.35, center.z + dist * 0.85);
          camera.near = r / 100;
          camera.far = r * 100;
          camera.updateProjectionMatrix();
          controls.minDistance = r * 0.35;
          controls.maxDistance = r * 8;
          controls.update();

          if (onReady) onReady(null);
        },
        undefined,
        function (err) {
          if (onReady && !disposed) onReady(err || new Error('load error'));
        }
      );

      function loop() {
        rafId = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
      }
      loop();

      return function dispose() {
        if (disposed) return;
        disposed = true;
        if (rafId != null) cancelAnimationFrame(rafId);
        if (resumeTimer) clearTimeout(resumeTimer);
        ro.disconnect();
        controls.dispose();
        draco.dispose();
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mat) {
              for (var k in mat) {
                if (mat[k] && mat[k].isTexture) mat[k].dispose();
              }
              mat.dispose();
            });
          }
        });
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    },

    /**
     * Works 스트립 hover 미리보기 — 드래그 없이 마우스 위치를 따라 360° 회전.
     * @param {HTMLElement} container
     * @param {string} src
     * @param {function} onReady  (err) => void
     * @returns {{setPointer:function, setActive:function, dispose:function}}
     */
    mountHover: function (container, src, onReady) {
      var THREE = window.THREE;
      var disposed = false;
      var rafId = null;
      var yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;

      var renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0xffffff, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      var pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new window.RoomEnvironment(), 0.04).texture;

      var dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(3, 5, 4);
      scene.add(dir);

      var camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);

      /* 모델을 pivot 중앙에 두고 pivot만 돌린다 */
      var pivot = new THREE.Group();
      scene.add(pivot);

      function resize() {
        var w = container.clientWidth || 1;
        var h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      var ro = new ResizeObserver(resize);
      ro.observe(container);

      var loader = new window.GLTFLoader();
      var draco = new window.DRACOLoader();
      draco.setDecoderPath('lib/draco/');
      loader.setDRACOLoader(draco);

      loader.load(
        src,
        function (gltf) {
          if (disposed) return;
          var model = gltf.scene;
          var box = new THREE.Box3().setFromObject(model);
          var center = box.getCenter(new THREE.Vector3());
          var sphere = box.getBoundingSphere(new THREE.Sphere());
          var r = Math.max(sphere.radius, 0.001);

          model.position.sub(center);
          pivot.add(model);

          var dist = r / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.35;
          camera.position.set(0, dist * 0.18, dist);
          camera.near = r / 100;
          camera.far = r * 100;
          camera.updateProjectionMatrix();
          camera.lookAt(0, 0, 0);

          if (onReady) onReady(null);
        },
        undefined,
        function (err) {
          if (onReady && !disposed) onReady(err || new Error('load error'));
        }
      );

      function loop() {
        rafId = requestAnimationFrame(loop);
        yaw += (targetYaw - yaw) * 0.12;
        pitch += (targetPitch - pitch) * 0.12;
        pivot.rotation.y = yaw;
        pivot.rotation.x = pitch;
        renderer.render(scene, camera);
      }

      return {
        /* nx, ny ∈ [-1, 1] — 가로 전체가 ±180°(360°), 세로는 살짝 기울임 */
        setPointer: function (nx, ny) {
          targetYaw = nx * Math.PI;
          targetPitch = ny * 0.35;
        },
        setActive: function (on) {
          if (disposed) return;
          if (on && rafId == null) loop();
          if (!on && rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
        },
        dispose: function () {
          if (disposed) return;
          disposed = true;
          if (rafId != null) cancelAnimationFrame(rafId);
          ro.disconnect();
          draco.dispose();
          scene.traverse(function (o) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mat) {
                for (var k in mat) {
                  if (mat[k] && mat[k].isTexture) mat[k].dispose();
                }
                mat.dispose();
              });
            }
          });
          pmrem.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        }
      };
    }
  };
})();
