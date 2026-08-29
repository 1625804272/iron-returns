/* ==========================================================================
   home.js · 门户主页（配置驱动的模块导航中心，无侧栏落地页）
   --------------------------------------------------------------------------
   设计原则：
   1) 本文件不含任何模块硬编码——入口卡片、Hero 汇总全部读取
      LH.MODULES 配置渲染；新增模块只需在 _shared/js/modules.js 追加配置。
   2) 主页不套用工作台外壳（无侧边栏 / 无底部导航），只做「导航门户」：
      品牌行 + Hero + 入口卡片 + 数据速览 + 数据说明。

   依赖：core.js · modules.js · seed.js · echarts（可选）
   ========================================================================== */
(function () {
  'use strict';

  var K = LH.KEYS;

  /* ---------- 数据读取（容错：任一模块无数据按空处理） ---------- */
  function loadAll() {
    return {
      iron: { returns: LH.store.get(K.iron.returns, []), reps: LH.store.get(K.iron.reps, []) },
      ph: {
        models: LH.store.get(K.printhead.models, []),
        inRecs: LH.store.get(K.printhead.inRecs, []),
        outRecs: LH.store.get(K.printhead.outRecs, [])
      },
      badge: { models: LH.store.get(K.badge.models, []), returns: LH.store.get(K.badge.returns, []), reps: LH.store.get(K.badge.reps, []) }
    };
  }

  /* ================= 入口卡片（配置驱动） ================= */
  function renderEntries() {
    var wrap = LH.byId('entryGrid');
    if (!wrap) return;
    wrap.innerHTML = LH.MODULES.map(function (mod) {
      var tone = LH.TONE[mod.tone] || LH.TONE.blue;
      // 统计项：取配置中前 3 项展示在卡片上
      var stats = LH.moduleStats(mod).slice(0, 3);
      return '<a class="entry" href="' + LH.esc(mod.href) + '" data-mod="' + LH.esc(mod.id) + '">' +
        '<div class="e-ico" style="background:' + tone.bg + ';color:' + tone.fg + '">' + LH.esc(mod.icon) + '</div>' +
        '<h3>' + LH.esc(mod.name) + '</h3>' +
        '<div class="e-desc">' + LH.esc(mod.desc) + '</div>' +
        '<div class="e-stats">' +
        stats.map(function (s) {
          return '<div class="es-item">' +
            '<div class="es-num"' + (s.warn ? ' style="color:var(--red)"' : '') + '>' + LH.num(s.value) + '</div>' +
            '<div class="es-lb">' + LH.esc(s.label) + '</div></div>';
        }).join('') +
        '</div>' +
        '<div class="e-go">进入模块 <span>→</span></div>' +
        '</a>';
    }).join('');
  }

  /** 取某模块第 index 个统计值 */
  function statOf(modId, index) {
    var mod = LH.getModule(modId);
    if (!mod) return 0;
    var s = LH.moduleStats(mod);
    return s[index] ? s[index].value : 0;
  }

  /* ================= 图表 ================= */
  function renderTrend(d) {
    var el = LH.byId('chartTrend');
    if (!el || typeof echarts === 'undefined') return;
    var months = [], ironData = [], badgeData = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = dt.getFullYear() + '-' + LH.pad2(dt.getMonth() + 1);
      months.push((dt.getMonth() + 1) + '月');
      ironData.push(monthQty(d.iron.returns, key));
      badgeData.push(monthQty(d.badge.returns, key));
    }
    var chart = echarts.init(el);
    chart.setOption({
      grid: { left: 44, right: 16, top: 34, bottom: 28 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['熨斗退货', '胸章退货'], right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11.5, color: '#67718A' } },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: '#E7EAF1' } }, axisLabel: { color: '#98A1B6', fontSize: 11 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F1F3F8' } }, axisLabel: { color: '#98A1B6', fontSize: 11 } },
      series: [
        { name: '熨斗退货', type: 'bar', data: ironData, barMaxWidth: 22, itemStyle: { color: '#2447C9', borderRadius: [5, 5, 0, 0] } },
        { name: '胸章退货', type: 'bar', data: badgeData, barMaxWidth: 22, itemStyle: { color: '#6D4BD8', borderRadius: [5, 5, 0, 0] } }
      ]
    });
    window.addEventListener('resize', function () { chart.resize(); });
  }
  function monthQty(list, key) {
    return LH.sum(list.filter(function (r) { return String(r.date || '').slice(0, 7) === key; }), function (r) { return r.qty; });
  }
  function renderStock(d) {
    var el = LH.byId('chartStock');
    if (!el || typeof echarts === 'undefined') return;
    var names = {}, ins = d.ph.inRecs, outs = d.ph.outRecs;
    d.ph.models.forEach(function (m) { names[m.name] = 1; });
    ins.forEach(function (r) { names[r.model] = 1; });
    outs.forEach(function (r) { names[r.model] = 1; });
    var keys = Object.keys(names);
    var data = keys.map(function (n) {
      return LH.sum(ins.filter(function (r) { return r.model === n; }), function (r) { return r.qty; }) -
        LH.sum(outs.filter(function (r) { return r.model === n; }), function (r) { return r.qty; });
    });
    var chart = echarts.init(el);
    chart.setOption({
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#F1F3F8' } }, axisLabel: { color: '#98A1B6', fontSize: 11 } },
      yAxis: { type: 'category', data: keys, axisLine: { lineStyle: { color: '#E7EAF1' } }, axisLabel: { color: '#67718A', fontSize: 11.5 }, axisTick: { show: false } },
      series: [{
        type: 'bar', data: data, barMaxWidth: 16,
        itemStyle: { borderRadius: [0, 4, 4, 0], color: function (p) { return p.value < 5 ? '#D5384C' : '#0E9888'; } },
        label: { show: true, position: 'right', fontSize: 11, color: '#67718A' }
      }]
    });
    window.addEventListener('resize', function () { chart.resize(); });
  }

  /* ================= 仪表盘：问候 + 日期 ================= */
  function renderGreet() {
    var g = LH.byId('dashGreet');
    if (g) {
      var h = new Date().getHours();
      var say = h < 6 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      g.textContent = say + '，欢迎回来 👋';
    }
    var d = LH.byId('dashDate');
    if (d) {
      var w = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];
      var now = new Date();
      d.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + w +
        ' · 系统数据保存在本机';
    }
  }

  /* ================= 仪表盘：系统概览（配置驱动） ================= */
  function renderDashStats() {
    var wrap = LH.byId('dashStats');
    if (!wrap) return;
    var d = loadAll();
    var totalRecords = d.iron.returns.length + d.badge.returns.length;
    var phStock = statOf('printhead', 1);
    var todo = 0;
    LH.MODULES.forEach(function (mod) {
      LH.moduleStats(mod).forEach(function (s) { if (s.warn) todo += s.value; });
    });
    var items = [
      { lb: '退货总记录', val: totalRecords, unit: '笔', ic: 'ic-blue', ico: '📋', meta: '熨斗 + 胸章' },
      { lb: '喷头在库', val: phStock, unit: '台', ic: 'ic-teal', ico: '🖨️', meta: '入库 − 出库' },
      { lb: '待处理事项', val: todo, unit: '项', ic: todo ? 'ic-red' : 'ic-green', ico: '⚠️', meta: todo ? '需跟进处理' : '全部处理完成' },
      { lb: '在管模块', val: LH.MODULES.length, unit: '个', ic: 'ic-violet', ico: '🗂️', meta: '熨斗 · 喷头 · 胸章' }
    ];
    wrap.innerHTML = items.map(function (it) {
      return '<div class="stat-card">' +
        '<div class="stat-icon ' + it.ic + '">' + it.ico + '</div>' +
        '<div class="stat-main"><div class="stat-label">' + it.lb + '</div>' +
        '<div class="stat-value">' + LH.num(it.val) + '<span class="stat-unit">' + it.unit + '</span></div>' +
        '<div class="stat-meta">' + LH.esc(it.meta) + '</div></div></div>';
    }).join('');
  }

  /* ================= 仪表盘：快捷操作（配置驱动） ================= */
  function renderQuick() {
    var wrap = LH.byId('dashQuick');
    if (!wrap) return;
    var quicks = LH.MODULES.filter(function (m) { return m.quick; });
    if (!quicks.length) return;
    wrap.innerHTML = quicks.map(function (m, i) {
      return '<a class="btn ' + (i === 0 ? 'primary' : 'ghost') + '" href="' + LH.esc(m.quick.href) + '">' +
        LH.esc(m.quick.label) + '</a>';
    }).join('');
  }

  /* ================= 刷新 ================= */
  function refresh() {
    renderGreet();
    renderDashStats();
    renderQuick();
    renderEntries();
    var d = loadAll();
    renderTrend(d);
    renderStock(d);
  }

  /* ================= 初始化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    refresh();
  });
})();
