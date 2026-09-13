/* ==========================================================
   GitHub 저장소 백엔드
   웹(GitHub Pages)에서 연 관리도구는 로컬 서버 대신 이 저장소에
   직접 커밋한다. 저장 한 번 = 커밋 한 번 = 사이트 배포 한 번.
   데이터·새 파일·삭제가 한 커밋에 같이 들어가서, 사이트가
   없는 파일을 가리키는 중간 상태가 생기지 않는다.
   ========================================================== */
(function (root) {
  'use strict';

  var API = 'https://api.github.com';
  var DATA_PATH = 'content/data.js';

  function encodeBase64(buf) {
    var bytes = new Uint8Array(buf), s = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return root.btoa(s);
  }

  function decodeUtf8(b64) {
    var bin = root.atob(String(b64).replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function create(cfg) {
    var doFetch = cfg.fetch || function (u, o) { return root.fetch(u, o); };
    var dataSha = null;          // 불러온 data.js 의 blob sha — 그 사이 다른 곳에서 저장했는지 판별
    var blobCache = new Map();   // File → blob sha. 재시도 때 같은 파일을 두 번 올리지 않는다

    function call(method, path, body) {
      var headers = {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (body) headers['Content-Type'] = 'application/json';
      return doFetch(API + '/repos/' + cfg.owner + '/' + cfg.repo + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var err = new Error((j && j.message) || ('HTTP ' + r.status));
            err.status = r.status;
            throw err;
          }
          return j;
        });
      });
    }

    function load() {
      return call('GET', '/contents/' + DATA_PATH + '?ref=' + encodeURIComponent(cfg.branch)).then(function (r) {
        dataSha = r.sha;
        return decodeUtf8(r.content);
      });
    }

    /* uploads: { 경로: File|Blob }, deletes: [파일 또는 폴더 경로]
       force: 다른 곳에서 먼저 저장된 data.js 를 알면서 덮어쓴다 */
    function commit(dataText, uploads, deletes, message, force, onProgress) {
      var progress = onProgress || function () {};
      var upPaths = Object.keys(uploads);

      function attempt(canRetry) {
        var headSha, baseTree, files = {};
        return call('GET', '/git/ref/heads/' + cfg.branch)
          .then(function (ref) {
            headSha = ref.object.sha;
            return call('GET', '/git/commits/' + headSha);
          })
          .then(function (c) {
            baseTree = c.tree.sha;
            return call('GET', '/git/trees/' + baseTree + '?recursive=1');
          })
          .then(function (t) {
            t.tree.forEach(function (e) { if (e.type === 'blob') files[e.path] = e.sha; });
            if (!force && dataSha && files[DATA_PATH] !== dataSha) {
              var err = new Error('다른 곳에서 먼저 저장된 내용이 있습니다');
              err.code = 'conflict';
              throw err;
            }
            /* 하나씩 — 큰 영상 여러 개를 동시에 base64 로 메모리에 들고 있지 않도록 */
            var chain = Promise.resolve();
            upPaths.forEach(function (p, i) {
              chain = chain.then(function () {
                var file = uploads[p];
                if (blobCache.has(file)) return;
                progress('파일 올리는 중 ' + (i + 1) + '/' + upPaths.length);
                return file.arrayBuffer()
                  .then(function (buf) { return call('POST', '/git/blobs', { content: encodeBase64(buf), encoding: 'base64' }); })
                  .then(function (b) { blobCache.set(file, b.sha); });
              });
            });
            return chain;
          })
          .then(function () {
            progress('저장 중…');
            return call('POST', '/git/blobs', { content: dataText, encoding: 'utf-8' });
          })
          .then(function (dataBlob) {
            var tree = [{ path: DATA_PATH, mode: '100644', type: 'blob', sha: dataBlob.sha }];
            upPaths.forEach(function (p) {
              tree.push({ path: p, mode: '100644', type: 'blob', sha: blobCache.get(uploads[p]) });
            });
            /* 폴더 경로(작업 삭제)는 그 아래 파일 전부로 펼친다. sha:null = 삭제 */
            var gone = {};
            deletes.forEach(function (d) {
              Object.keys(files).forEach(function (f) {
                if (f === d || f.indexOf(d + '/') === 0) gone[f] = true;
              });
            });
            Object.keys(gone).forEach(function (f) {
              if (f === DATA_PATH || uploads[f]) return;
              tree.push({ path: f, mode: '100644', type: 'blob', sha: null });
            });
            return call('POST', '/git/trees', { base_tree: baseTree, tree: tree })
              .then(function (nt) { return call('POST', '/git/commits', { message: message, tree: nt.sha, parents: [headSha] }); })
              .then(function (nc) { return call('PATCH', '/git/refs/heads/' + cfg.branch, { sha: nc.sha, force: false }); })
              .then(function () {
                dataSha = dataBlob.sha;
                blobCache.clear();
              });
          })
          .catch(function (e) {
            /* 그 사이 다른 커밋이 끼어들면(빨리감기 불가) 최신 커밋 위에서 한 번 더 */
            if (e.status === 422 && canRetry) return attempt(false);
            throw e;
          });
      }
      return attempt(true);
    }

    /* 로그인 때 쓰기 권한 확인 — 빈 blob 하나만 만든다. 커밋에 안 걸리고
       .nojekyll 과 같은 객체라 저장소에는 아무 변화가 없다 */
    function canWrite() {
      return call('POST', '/git/blobs', { content: '', encoding: 'utf-8' });
    }

    return { load: load, commit: commit, canWrite: canWrite };
  }

  root.GitHubStore = { create: create, DATA_PATH: DATA_PATH };
})(typeof window !== 'undefined' ? window : globalThis);
