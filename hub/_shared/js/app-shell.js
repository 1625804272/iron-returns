/* ==========================================================================
   app-shell.js · 应用外壳（侧边栏 / 顶栏 / 移动端导航）
   --------------------------------------------------------------------------
   各页面通过 LH.shell.init({ nav, brand, title, sub, badge }) 初始化统一外壳：
     nav   —— 侧边栏与底部导航的视图切换项
     brand —— 左上角品牌（点击回主页）
   依赖：core.js（LH）
   ========================================================================== */
(function () {
  'use strict';

  var state = { views: [], current: '', onChange: null };

  /* ---------- 构建侧边栏 ---------- */
  function renderSideNav(cfg) {
    var wrap = document.getElementById('sideNav');
    if (!wrap) return;
    var html = '';
    (cfg.nav || []).forEach(function (item) {
      if (item.label) { html += '<div class="nav-label">' + LH.esc(item.label) + '</div>'; return; }
      html += '<button class="nav-item' + (item.id === cfg.current ? ' active' : '') + '" data-v="' + item.id + '">' +
        '<span class="ni-ico">' + (item.ico || '•') + '</span>' +
        '<span>' + LH.esc(item.name) + '</span>' +
        (item.badge ? '<span class="nav-badge" data-badge="' + item.id + '">' + LH.esc(item.badge) + '</span>' : '') +
        '</button>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.getAttribute('data-v')); });
    });
  }

  /* ---------- 构建移动端底部导航（最多 5 项） ---------- */
  function renderBottomNav(cfg) {
    var wrap = document.getElementById('bottomNav');
    if (!wrap) return;
    var items = (cfg.nav || []).filter(function (i) { return !i.label; }).slice(0, 5);
    wrap.innerHTML = items.map(function (item) {
      return '<button class="bn-item' + (item.id === cfg.current ? ' active' : '') + '" data-v="' + item.id + '">' +
        '<span class="bn-ico">' + (item.ico || '•') + '</span>' +
        '<span>' + LH.esc(item.short || item.name) + '</span>' +
        '</button>';
    }).join('');
    wrap.querySelectorAll('.bn-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.getAttribute('data-v')); });
    });
  }

  /* ---------- 构建模块内页签导航（桌面端替代侧边栏的视图切换） ---------- */
  function renderTabs(cfg) {
    var wrap = document.getElementById('pageTabs');
    if (!wrap || !cfg.tabs || !cfg.tabs.length) return;
    wrap.innerHTML = cfg.tabs.map(function (item) {
      return '<button class="pt-btn' + (item.id === cfg.current ? ' active' : '') + '" data-v="' + item.id + '">' +
        '<span class="pt-ico">' + (item.ico || '•') + '</span>' +
        '<span>' + LH.esc(item.name) + '</span>' +
        '</button>';
    }).join('');
    wrap.querySelectorAll('.pt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.getAttribute('data-v')); });
    });
  }

  /* ---------- 视图切换 ---------- */
  function switchView(id) {
    if (!id || id === state.current) return;
    state.current = id;
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === id);
    });
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-v') === id);
    });
    document.querySelectorAll('.bn-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-v') === id);
    });
    document.querySelectorAll('.pt-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-v') === id);
    });
    closeSidebar();
    if (typeof state.onChange === 'function') state.onChange(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 侧边栏开合（移动端） ---------- */
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
    LH.lockScroll(true);
  }
  function closeSidebar() {
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebarOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('open');
    LH.lockScroll(false);
  }

  /* ---------- 更新导航徽标（如待办数量） ---------- */
  function setBadge(id, text) {
    var el = document.querySelector('.nav-badge[data-badge="' + id + '"]');
    if (!el) return;
    el.textContent = text;
    el.style.display = (text && text !== '0') ? '' : 'none';
  }

  /* ---------- 初始化 ---------- */
  function init(cfg) {
    cfg = cfg || {};
    state.onChange = cfg.onChange || null;
    state.current = cfg.current || '';

    // 品牌区
    var bName = document.getElementById('brandName');
    var bSub = document.getElementById('brandSub');
    var bMark = document.getElementById('brandMark');
    if (bName && cfg.brand) bName.textContent = cfg.brand;
    if (bSub && cfg.brandSub) bSub.textContent = cfg.brandSub;
    if (bMark && cfg.brandIcon) bMark.textContent = cfg.brandIcon;

    // 顶栏标题
    var t = document.getElementById('pageTitle');
    var s = document.getElementById('pageSub');
    if (t && cfg.title) t.textContent = cfg.title;
    if (s && cfg.sub) s.textContent = cfg.sub;

    renderSideNav(cfg);
    renderTabs(cfg);
    renderBottomNav(cfg);

    // 汉堡菜单
    var burger = document.getElementById('tbBurger');
    if (burger) burger.addEventListener('click', openSidebar);
    var ov = document.getElementById('sidebarOverlay');
    if (ov) ov.addEventListener('click', closeSidebar);

    // ESC 关闭侧栏 / 模态
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeSidebar();
      document.querySelectorAll('.modal-mask.open').forEach(function (m) {
        m.classList.remove('open');
        LH.lockScroll(false);
      });
    });

    // 响应式：窗口变化时重绘（各页面自行监听 render）
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1023) closeSidebar();
    });
  }

  window.LH = window.LH || {};
  window.LH.shell = {
    init: init,
    switchView: switchView,
    setBadge: setBadge,
    closeSidebar: closeSidebar,
    current: function () { return state.current; }
  };
})();
