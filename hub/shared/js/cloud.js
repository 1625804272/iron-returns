/* ==========================================================================
   cloud.js · 统一云端同步（GitHub 仓库）+ 冷启动数据继承
   --------------------------------------------------------------------------
   ★ 两套机制，确保「数据绝不丢失」：
     1) 冷启动继承：本机首次使用（无数据且未配置同步）时，匿名从 public 仓库
        的 data/*.json 读取数据并导入本机——无需 Token 即可继承线上数据。
     2) 双向同步：配置 Token 后，启动时拉取合并、每次改动自动防抖推送，
        失败自动重试，换设备/清缓存都能从云端恢复。

   ★ 数据结构与各模块本地存储完全一致（returns/reps、models/inRecs/outRecs），
     与旧系统共用同一批 data 文件，天然继承历史数据。

   依赖：core.js（LH）
   ========================================================================== */
(function () {
  'use strict';

  var CFG_KEY = 'lh_cloud_v1';
  var DEFAULT = { enabled: false, token: '', owner: '1625804272', repo: 'iron-returns' };
  var cfg = null;

  /* ---------- 配置读写 ---------- */
  function loadCfg() {
    var s = LH.store.get(CFG_KEY, null);
    cfg = Object.assign({}, DEFAULT, s || {});
    return cfg;
  }
  function saveCfg(c) {
    cfg = Object.assign({}, DEFAULT, c || {});
    LH.store.set(CFG_KEY, cfg);
    return cfg;
  }
  function getCfg() { return cfg || loadCfg(); }
  function isActive() {
    var c = getCfg();
    return !!(c.enabled && c.token && c.owner && c.repo);
  }

  /* ---------- URL ---------- */
  function apiUrl(path, owner, repo) {
    var o = owner || getCfg().owner, r = repo || getCfg().repo;
    var p = String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' + encodeURIComponent(o) + '/' + encodeURIComponent(r) + '/contents/' + p;
  }
  /** raw 地址（匿名可读，用于冷启动继承） */
  function rawUrl(path, owner, repo, branch) {
    var o = owner || getCfg().owner, r = repo || getCfg().repo;
    var p = String(path || '').replace(/^\/+/, '');
    return 'https://raw.githubusercontent.com/' + o + '/' + r + '/' + (branch || 'main') + '/' + p;
  }
  /** jsDelivr CDN 地址（大陆/移动网络可用，无需 Token，支持 CORS）
      作为 api / raw 主源失败时的「备用读取通道」——解决 api.github.com
      在部分网络（尤其手机/大陆）被阻断导致的「拉取失败：网络不可用」。 */
  function cdnUrl(path, owner, repo, branch) {
    var o = owner || getCfg().owner, r = repo || getCfg().repo;
    var p = String(path || '').replace(/^\/+/, '');
    return 'https://cdn.jsdelivr.net/gh/' + o + '/' + r + '@' + (branch || 'main') + '/' + p;
  }

  /* ---------- 编码 ---------- */
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b64) { return decodeURIComponent(escape(atob(b64))); }

  /* ---------- 错误提示分级 ---------- */
  function errText(e) {
    var s = e && e.status;
    if (s === 401) return 'Token 无效或已过期（401）';
    if (s === 403) return '无权限或触发限流（403）';
    if (s === 404) return '仓库/文件不存在或无权限（404）';
    if (e && e.offline) return '网络不可用（已尝试 CDN 备用通道仍失败），稍后自动重试';
    return (e && e.message) || '未知错误';
  }

  /* ================= 冷启动继承（匿名读取 public 仓库 raw 文件） =================
     返回 Promise<data|null>：成功返回解析后的 JSON；无数据或失败返回 null（静默） */
  function inherit(path, owner, repo, branch) {
    // 主源 raw；网络错误 / 5xx 时自动切 CDN（静默兜底）
    return fetch(rawUrl(path, owner, repo, branch), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      })
      .then(function (j) { return j || null; })
      .catch(function (e) {
        // 404（文件不存在）等明确错误不重试；网络错误 / 5xx 才切 CDN
        if (e && e.status && e.status !== 404 && e.status < 500) return null;
        return fetch(cdnUrl(path, owner, repo, branch), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      });
  }

  /* ================= 云端读取（需 Token） =================
     返回 {ok:true, data, sha} | {ok:true, exists:false} | {ok:false, error} */
  function pull(path) {
    if (!isActive()) return Promise.resolve({ ok: false, error: '未启用云端同步' });
    var headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + getCfg().token };
    return fetch(apiUrl(path), { headers: headers, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return { ok: true, exists: false, data: null, sha: null };
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json().then(function (j) {
          var data = null;
          try { data = JSON.parse(b64dec(j.content)); }
          catch (err) { var e2 = new Error('云端数据解析失败'); e2.status = 0; throw e2; }
          return { ok: true, exists: true, data: data, sha: j.sha || null };
        });
      })
      .catch(function (e) {
        // 网络不可用 / 5xx → 用 CDN 兜底读取（无 sha，但能读到数据）
        if (!e.status || e.status >= 500) {
          return fetch(cdnUrl(path), { cache: 'no-store' })
            .then(function (r) {
              if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.status = r.status; throw e2; }
              return r.json();
            })
            .then(function (data) { return { ok: true, exists: true, data: data, sha: null, viaCdn: true }; })
            .catch(function (e2) { if (!e2.status) e2.offline = true; return { ok: false, error: errText(e2), offline: !e2.status }; });
        }
        return { ok: false, error: errText(e), offline: !!e.offline };
      });
  }

  /* ================= 云端写入（需 Token） =================
     payload 为对象；sha 存在则更新，不存在则新建 */
  function push(path, payload, sha) {
    if (!isActive()) return Promise.resolve({ ok: false, error: '未启用云端同步' });
    var headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + getCfg().token,
      'Content-Type': 'application/json'
    };
    var body = {
      message: 'sync data ' + new Date().toISOString().slice(0, 16),
      content: b64enc(JSON.stringify(payload)),
      committer: { name: 'ledger-hub', email: 'app@local' }
    };
    if (sha) body.sha = sha;
    return fetch(apiUrl(path), { method: 'PUT', headers: headers, body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      })
      .then(function (j) { return { ok: true, sha: (j.content && j.content.sha) || sha }; })
      .catch(function (e) {
        if (!e.status) e.offline = true;
        return { ok: false, error: errText(e), offline: !!e.offline };
      });
  }

  /* ================= Token 校验 ================= */
  function verify(token) {
    return fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token }
    }).then(function (r) {
      if (r.status === 401) { var e = new Error('401'); e.status = 401; throw e; }
      if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.status = r.status; throw e2; }
      return r.json();
    }).then(function (u) { return { ok: true, login: u.login || '' }; })
      .catch(function (e) {
        if (!e.status) e.offline = true;
        return { ok: false, error: errText(e), offline: !!e.offline };
      });
  }

  /* ---------- 导出 ---------- */
  window.LH = window.LH || {};
  window.LH.cloud = {
    CFG_KEY: CFG_KEY,
    loadCfg: loadCfg, saveCfg: saveCfg, getCfg: getCfg, isActive: isActive,
    apiUrl: apiUrl, rawUrl: rawUrl,
    inherit: inherit, pull: pull, push: push, verify: verify
  };
})();
