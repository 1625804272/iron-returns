/* ==========================================================================
   cloud-ui.js · 云同步 UI 与启动流程（三模块共用）
   --------------------------------------------------------------------------
   各模块只需在页面放一个按钮（id=btnCloud），然后调用：
     LH.cloudUI.init({
       path: 'data/returns.json',        // 云端数据文件路径
       app:  'iron-returns',             // 数据标识
       isEmpty:   function(){ ... },     // 本机是否无数据（用于冷启动继承判断）
       getPayload:function(){ ... },     // 组装待推送数据
       applyData: function(data){ ... }, // 合并云端数据 → 返回导入描述文本
       onChanged: function(){ ... }      // 同步完成后的重绘回调
     });
   之后模块每次保存调用 LH.cloudUI.changed() 即可触发防抖推送。

   启动策略（确保数据不丢）：
     ① 已启用同步 → 拉取云端并合并 → 推送本地
     ② 未启用且本机无数据 → 匿名继承线上 data 文件（无需 Token）
     ③ 都失败 → 静默，页面照常用本地数据
   ========================================================================== */
(function () {
  'use strict';

  var opts = null;
  var pushTimer = null, pushRetry = 0;
  var pushing = false;

  /* ---------- 注入弹窗 DOM ---------- */
  function ensureModal() {
    if (document.getElementById('cloudMask')) return;
    var div = document.createElement('div');
    div.className = 'modal-mask';
    div.id = 'cloudMask';
    div.innerHTML =
      '<div class="modal" style="width:520px">' +
      '  <div class="m-head"><h3>云端同步</h3><span class="m-tag">GitHub 仓库</span>' +
      '    <button class="m-close" id="cldClose">✕</button></div>' +
      '  <div class="m-body">' +
      '    <div class="info-strip">数据保存在你的 GitHub 仓库，跨设备可用；Token 仅存本机浏览器。未配置时，首次打开也会自动继承线上已有数据。</div>' +
      '    <div class="f-field" style="margin-bottom:14px">' +
      '      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
      '        <input type="checkbox" id="cldEnabled" style="width:18px;height:18px"> 启用云端同步（跨设备）</label>' +
      '    </div>' +
      '    <div class="f-row">' +
      '      <div class="f-field full"><label>GitHub Token（需 repo 权限）</label>' +
      '        <input class="f-input" type="password" id="cldToken" placeholder="ghp_xxx" autocomplete="off"></div>' +
      '      <div class="f-field"><label>仓库 owner</label><input class="f-input" type="text" id="cldOwner"></div>' +
      '      <div class="f-field"><label>仓库 repo</label><input class="f-input" type="text" id="cldRepo"></div>' +
      '      <div class="f-field full"><label>数据文件</label><input class="f-input" type="text" id="cldPath" disabled></div>' +
      '    </div>' +
      '    <p class="f-hint" id="cldMsg" style="margin-top:10px"></p>' +
      '  </div>' +
      '  <div class="m-foot">' +
      '    <button class="btn ghost" id="cldClear">停用</button>' +
      '    <button class="btn ghost" id="cldCancel">关闭</button>' +
      '    <button class="btn green" id="cldNow">立即同步</button>' +
      '    <button class="btn primary" id="cldSave">保存并连接</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(div);
    var cldClose = document.getElementById('cldClose');
    if (!cldClose) { if (window.console) console.warn('cloud-ui: cldClose 缺失'); return; }
    try {
      cldClose.addEventListener('click', close);
      document.getElementById('cldCancel').addEventListener('click', close);
      document.getElementById('cldSave').addEventListener('click', saveAndConnect);
      document.getElementById('cldNow').addEventListener('click', syncNow);
      document.getElementById('cldClear').addEventListener('click', clearCfg);
      div.addEventListener('mousedown', function (e) { if (e.target === div) close(); });
    } catch (e) {
      if (window.console) console.warn('cloud-ui bind err:', e.message);
    }
  }
  function open() {
    ensureModal();
    var c = LH.cloud.getCfg();
    document.getElementById('cldEnabled').checked = !!c.enabled;
    document.getElementById('cldToken').value = c.token || '';
    document.getElementById('cldOwner').value = c.owner || '';
    document.getElementById('cldRepo').value = c.repo || '';
    document.getElementById('cldPath').value = opts.path;
    msg('');
    LH.openModal('cloudMask');
  }
  function close() { LH.closeModal('cloudMask'); }
  function msg(text, isErr) {
    var el = document.getElementById('cldMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'f-hint' + (isErr ? ' err' : '');
    el.style.color = isErr ? 'var(--red)' : '';
  }
  function state(text) {
    var b = document.getElementById('btnCloud');
    if (b) b.innerHTML = '☁️ <span>' + text + '</span>';
  }

  /* ---------- 读取表单 ---------- */
  function readForm() {
    var token = document.getElementById('cldToken').value.trim();
    var owner = document.getElementById('cldOwner').value.trim();
    var repo = document.getElementById('cldRepo').value.trim();
    if (!owner || !repo) return { ok: false, err: '请填写仓库 owner 与 repo' };
    if (!token) return { ok: false, err: '请填写 GitHub Token' };
    return { ok: true, enabled: document.getElementById('cldEnabled').checked, token: token, owner: owner, repo: repo };
  }

  /* ---------- 保存并连接 ---------- */
  function saveAndConnect() {
    var f = readForm();
    if (!f.ok) return msg(f.err, true);
    LH.cloud.saveCfg({ enabled: f.enabled, token: f.token, owner: f.owner, repo: f.repo });
    if (!f.enabled) { state('本地'); msg('已保存（未启用同步，勾选启用后可连接）'); return; }
    msg('正在验证 Token 并同步……');
    state('连接中');
    LH.cloud.verify(f.token).then(function (v) {
      if (!v.ok) {
        // 验证接口网络不通（非 401/403 鉴权错误）→ 仍尝试同步（走 CDN 通道）
        if (v.offline || (v.error && v.error.indexOf('网络') >= 0)) {
          msg('Token 验证接口网络不通，仍尝试同步（走 CDN 通道）……');
          doPull().then(function () { doPush().then(function () { afterConnect(); }); });
          return;
        }
        msg('Token 验证失败：' + v.error, true); state('验证失败'); return;
      }
      doPull().then(function () { doPush().then(function () { afterConnect(); }); });
    });
  }
  function afterConnect() {
    msg('已连接 ✅ 云端数据已同步（拉取走 CDN 兜底，推送联网后自动完成）');
    state('已同步'); LH.toast('云端同步已开启');
  }

  /* ---------- 立即同步 ---------- */
  function syncNow() {
    var f = readForm();
    if (!f.ok) return msg(f.err, true);
    if (!f.enabled) return msg('请先勾选「启用云端同步」', true);
    LH.cloud.saveCfg({ enabled: true, token: f.token, owner: f.owner, repo: f.repo });
    msg('正在同步（拉取 → 合并 → 推送）……');
    state('同步中');
    doPull().then(function () {
      doPush().then(function (r) {
        if (r && r.ok) { msg('同步完成 ✅ 本地 ↔ 云端一致'); state('已同步'); LH.toast('同步完成'); }
        else if (r && r.offline) { msg('已拉取云端数据，但推送需联网 GitHub API，当前网络不可达（数据已本地保存，联网后自动重试）', true); state('待推送'); }
        else { msg('推送失败：' + (r && r.error), true); state('同步失败'); }
      });
    });
  }

  /* ---------- 停用 ---------- */
  function clearCfg() {
    if (!window.confirm('停用云端同步并清除本机保存的 Token？\n本地数据保留，云端数据也保留。')) return;
    LH.cloud.saveCfg({ enabled: false, token: '', owner: '1625804272', repo: 'iron-returns' });
    open();
    msg('已停用云端同步，Token 已清除');
    state('本地');
  }

  /* ---------- 拉取并合并 ---------- */
  function doPull() {
    state('拉取中');
    return LH.cloud.pull(opts.path).then(function (res) {
      if (!res.ok) { msg('拉取失败：' + res.error, true); state('拉取失败'); return res; }
      if (res.exists && res.data) {
        var info = opts.applyData(res.data) || '';
        if (typeof opts.onChanged === 'function') opts.onChanged();
        msg('已合并云端数据' + (res.viaCdn ? '（via CDN）' : '') + (info ? '：' + info : ''));
        LH.toast('已同步云端数据' + (res.viaCdn ? '（CDN）' : ''));
      }
      state('已同步');
      return res;
    });
  }
  /* ---------- 推送 ---------- */
  function doPush() {
    if (!LH.cloud.isActive()) return Promise.resolve({ ok: false, error: '未启用' });
    var payload = opts.getPayload();
    return LH.cloud.pull(opts.path).then(function (p) {
      return LH.cloud.push(opts.path, payload, p && p.sha ? p.sha : null);
    }).then(function (r) {
      if (!r.ok && r.offline) {
        msg('推送失败：当前网络无法连接 GitHub API（数据已在本地保存，联网后自动重试）', true);
        state('待推送');
      }
      return r;
    });
  }

  /* ---------- 变更防抖推送（模块保存时调用） ---------- */
  function changed() {
    if (!LH.cloud.isActive()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      if (pushing) return;
      pushing = true;
      state('同步中');
      doPush().then(function (r) {
        pushing = false;
        if (r && r.ok) { pushRetry = 0; state('已同步'); }
        else {
          if (pushRetry < 3) { pushRetry++; state('重试中'); pushTimer = setTimeout(function () { pushing = false; changed(); }, 15000); }
          else { pushRetry = 0; state('同步失败'); LH.toast('云端推送失败：' + (r && r.error)); }
        }
      });
    }, 800);
  }

  /* ---------- 冷启动：匿名继承线上数据 ---------- */
  function bootInherit() {
    if (!opts.isEmpty()) return;
    LH.cloud.inherit(opts.path).then(function (data) {
      if (!data) return;
      var list = data.returns || data.inRecs || data.models || [];
      if (!list.length) return;
      var info = opts.applyData(data) || '';
      if (typeof opts.onChanged === 'function') opts.onChanged();
      LH.toast('已从公网继承数据' + (info ? '：' + info : ''));
    });
  }

  /* ---------- 初始化 ---------- */
  function init(o) {
    opts = o;
    LH.cloud.loadCfg();
    ensureModal();
    var btn = document.getElementById('btnCloud');
    if (btn) {
      btn.addEventListener('click', open);
      state(LH.cloud.isActive() ? '云端' : '本地');
    }
    if (LH.cloud.isActive()) {
      state('同步中');
      doPull().then(function () { doPush(); });
    } else {
      bootInherit();
    }
  }

  window.LH = window.LH || {};
  window.LH.cloudUI = { init: init, changed: changed, pull: doPull, push: doPush };
})();
