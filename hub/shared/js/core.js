/* ==========================================================================
   core.js · 共享核心工具库
   --------------------------------------------------------------------------
   提供：DOM 助手 / 转义 / 日期 / 数字格式化 / localStorage 存储封装
        / Toast 提示 / 模态框 / 确认框 / 表格助手 / CSV 导出 / 迷你折线图
   所有模块（熨斗台账 · 喷头库存 · 胸章台账）共用，保证交互与视觉一致。
   挂载到 window.LH 命名空间，避免污染全局。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- DOM 助手 ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var byId = function (id) { return document.getElementById(id); };

  /* HTML 转义，防止用户输入破坏结构（XSS） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 日期 / 数字 ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  /** 今天 YYYY-MM-DD */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /** 相对今天的偏移日期（n 天前，负数表示未来） */
  function dayAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /** 短日期：2026-08-28 → 08/28 */
  function shortDate(s) { return s ? String(s).slice(5).replace('-', '/') : '—'; }
  /** 金额：1280 → ¥1,280.00（needCents=false 则 ¥1,280） */
  function money(n, needCents) {
    var v = Number(n) || 0;
    return '¥' + v.toLocaleString('zh-CN', {
      minimumFractionDigits: needCents ? 2 : 0,
      maximumFractionDigits: needCents ? 2 : 0
    });
  }
  /** 千分位整数 */
  function num(n) { return (Number(n) || 0).toLocaleString('zh-CN'); }

  /* ---------- ID ---------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 本地存储封装（带 JSON 容错） ---------- */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.warn('[store] 读取失败：' + key, e);
        return fallback;
      }
    },
    set: function (key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch (e) {
        console.warn('[store] 写入失败：' + key, e);
        toast('本地存储写入失败，可能空间不足');
        return false;
      }
    },
    del: function (key) { localStorage.removeItem(key); }
  };

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = byId('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2300);
  }

  /* ---------- 模态框 ---------- */
  /** 打开指定 id 的模态框（锁定滚动） */
  function openModal(id) {
    var m = byId(id);
    if (!m) return;
    m.classList.add('open');
    lockScroll(true);
  }
  function closeModal(id) {
    var m = byId(id);
    if (!m) return;
    m.classList.remove('open');
    lockScroll(false);
  }
  function lockScroll(on) {
    document.body.style.overflow = on ? 'hidden' : '';
  }
  /** 点击遮罩空白处关闭 */
  function bindMaskClose(maskId) {
    var m = byId(maskId);
    if (!m) return;
    m.addEventListener('mousedown', function (e) {
      if (e.target === m) closeModal(maskId);
    });
  }

  /* ---------- 确认框（异步 Promise 风格） ---------- */
  var _confirmResolve = null;
  function confirmBox(msg, okText) {
    var mask = byId('confirmMask');
    if (!mask) { return Promise.resolve(window.confirm(msg)); }
    byId('confirmText').textContent = msg;
    byId('confirmOk').textContent = okText || '确定';
    openModal('confirmMask');
    return new Promise(function (resolve) { _confirmResolve = resolve; });
  }
  function resolveConfirm(ok) {
    closeModal('confirmMask');
    if (_confirmResolve) { _confirmResolve(ok); _confirmResolve = null; }
  }

  /* ---------- 表格空状态 ---------- */
  /** list 为空时显示空态：showEmpty('emptyId', 'tableId', list, {...}) */
  function showEmpty(emptyId, tableId, list, opt) {
    opt = opt || {};
    var e = byId(emptyId), t = byId(tableId);
    var none = !list || list.length === 0;
    if (e) {
      e.classList.toggle('show', none);
      if (none) {
        e.innerHTML =
          '<div class="e-ico">' + (opt.icon || '📭') + '</div>' +
          '<div class="e-title">' + esc(opt.title || '暂无记录') + '</div>' +
          '<div class="e-sub">' + esc(opt.sub || '调整筛选条件或新增一条记录') + '</div>' +
          (opt.action || '');
      }
    }
    if (t) t.style.display = none ? 'none' : '';
  }

  /* ---------- 迷你折线图（SVG，无依赖） ---------- */
  /** values: 数字数组；返回内联 SVG 字符串 */
  function sparkline(values, color) {
    values = (values || []).map(function (v) { return Number(v) || 0; });
    if (values.length < 2) return '';
    var w = 72, h = 26, pad = 2;
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var span = (max - min) || 1;
    var step = (w - pad * 2) / (values.length - 1);
    var pts = values.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return [x.toFixed(1), y.toFixed(1)];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ');
    var area = line + ' L' + (w - pad) + ' ' + h + ' L' + pad + ' ' + h + ' Z';
    var c = color || 'var(--primary)';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<path class="sp-fill" d="' + area + '" fill="' + c + '" stroke="none" opacity=".12"/>' +
      '<path d="' + line + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  /* ---------- CSV 导出（Excel/WPS 可直接打开，带 BOM 防中文乱码） ---------- */
  function exportCSV(filename, head, rows) {
    var esc2 = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = '\ufeff' + [head].concat(rows).map(function (r) {
      return r.map(esc2).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
    toast('已导出 ' + filename);
  }

  /* ---------- 数组助手 ---------- */
  function sum(arr, fn) {
    return (arr || []).reduce(function (a, r) { return a + (fn ? (Number(fn(r)) || 0) : (Number(r) || 0)); }, 0);
  }
  /** 按 key 分组计数 → [{key, count}] */
  function groupCount(arr, keyFn) {
    var m = {};
    (arr || []).forEach(function (r) {
      var k = keyFn(r);
      if (k == null || k === '') return;
      m[k] = (m[k] || 0) + 1;
    });
    return Object.keys(m).map(function (k) { return { key: k, count: m[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /* ---------- 分页状态助手 ---------- */
  function paginate(list, page, per) {
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / per));
    var p = Math.min(Math.max(1, page), pages);
    var start = (p - 1) * per;
    return { rows: list.slice(start, start + per), page: p, pages: pages, total: total, start: start };
  }

  /* ---------- 统一存储键（三模块 + 主页共用，lh_ 前缀避免与其它系统冲突） ---------- */
  var KEYS = {
    iron: { returns: 'lh_iron_returns_v1', reps: 'lh_iron_reps_v1' },
    printhead: { models: 'lh_ph_models_v1', inRecs: 'lh_ph_in_v1', outRecs: 'lh_ph_out_v1' },
    badge: { models: 'lh_badge_models_v1', returns: 'lh_badge_returns_v1', reps: 'lh_badge_reps_v1' }
  };
  /** 清空全部台账数据（主页「清空全部」用） */
  function wipeAll() {
    Object.keys(KEYS).forEach(function (m) {
      Object.keys(KEYS[m]).forEach(function (k) { localStorage.removeItem(KEYS[m][k]); });
    });
  }

  /* ---------- 导出 ---------- */
  window.LH = {
    $: $, $$: $$, byId: byId, esc: esc,
    KEYS: KEYS, wipeAll: wipeAll,
    today: today, dayAgo: dayAgo, shortDate: shortDate, money: money, num: num, pad2: pad2, uid: uid,
    store: store, toast: toast,
    openModal: openModal, closeModal: closeModal, lockScroll: lockScroll, bindMaskClose: bindMaskClose,
    confirm: confirmBox, resolveConfirm: resolveConfirm,
    showEmpty: showEmpty, sparkline: sparkline, exportCSV: exportCSV,
    sum: sum, groupCount: groupCount, paginate: paginate
  };
})();
