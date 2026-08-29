/* ==========================================================================
   modules.js · 模块注册表（主页导航的唯一数据源）
   --------------------------------------------------------------------------
   ★ 扩展方式：新增业务模块时，只需要在 LH.MODULES 里追加一项配置，
     主页会自动渲染入口卡片、侧边导航、底部导航与统计数字，
     不需要改动 index.html 或 home.js 的任何逻辑。

   ★ 配置项说明：
     id     模块唯一标识（也用于侧栏/底部导航的 data-v）
     name   卡片标题（模块全称）
     short  移动端短名
     desc   一句话说明
     icon   图标（emoji 或文字）
     tone   主题色：blue / teal / violet / green / amber / red
     href   页面地址（与项目路由结构一致：各模块一个独立 HTML）
     stats  卡片上的统计项（数组，每项 {label, get, warn}）
              label —— 显示名称
              get   —— 计算函数（返回数字，内部读取 localStorage）
              warn  —— true 时数字标红（用于「待补发 / 预警」类指标）

   ★ 只读取各模块的本地数据，绝不修改，与各模块业务逻辑解耦。
   ========================================================================== */
(function () {
  'use strict';

  var K = LH.KEYS;

  /* ---------- 通用小工具 ---------- */
  function read(key, fallback) { return LH.store.get(key, fallback); }
  function sumQty(list) { return LH.sum(list, function (r) { return r.qty; }); }

  /* --- 熨斗 / 胸章：补发（换新）完成量 --- */
  function repQtyOf(reps, retId) {
    return LH.sum(reps.filter(function (r) { return r.returnId === retId; }), function (r) { return r.qty; });
  }
  /** 未结清数量：needless(r) 返回 true 表示该笔无需补发/换新 */
  function leftQty(returns, reps, needless) {
    var left = 0;
    returns.forEach(function (r) {
      if (needless(r)) return;
      left += Math.max(0, (Number(r.qty) || 0) - repQtyOf(reps, r.id));
    });
    return left;
  }

  /* --- 喷头：库存 --- */
  function phStock(name, inRecs, outRecs) {
    return LH.sum(inRecs.filter(function (r) { return r.model === name; }), function (r) { return r.qty; }) -
      LH.sum(outRecs.filter(function (r) { return r.model === name; }), function (r) { return r.qty; });
  }

  /* ================= 模块配置表 ================= */
  var MODULES = [
    {
      id: 'iron',
      name: '熨斗退货台账',
      short: '熨斗',
      desc: '登记退货熨斗的型号 / 颜色 / 电压与检验情况，跟踪供应商补发进度，按型号·供应商·时间段统计对账。',
      icon: '🔥',
      tone: 'blue',
      href: 'iron.html',
      quick: { label: '登记退货', href: 'iron.html' },
      stats: [
        {
          label: '退货笔数',
          get: function () { return read(K.iron.returns, []).length; }
        },
        {
          label: '退货台数',
          get: function () { return sumQty(read(K.iron.returns, [])); }
        },
        {
          label: '待补发',
          warn: true,
          get: function () {
            // 检验合格的记录视为无需补发，不计入缺口
            return leftQty(read(K.iron.returns, []), read(K.iron.reps, []), function (r) { return r.insp === '合格'; });
          }
        }
      ]
    },
    {
      id: 'printhead',
      name: '喷头库存管理',
      short: '喷头',
      desc: '喷头出入库登记（含订单号、批次号、供应商、单价、领用人），实时库存计算与低库存预警。',
      icon: '🖨️',
      tone: 'teal',
      href: 'printhead.html',
      quick: { label: '喷头入库 / 出库', href: 'printhead.html' },
      stats: [
        {
          label: '在管型号',
          get: function () {
            var ms = read(K.printhead.models, []);
            var ins = read(K.printhead.inRecs, []);
            var outs = read(K.printhead.outRecs, []);
            var s = {};
            ms.forEach(function (m) { s[m.name] = 1; });
            ins.forEach(function (r) { s[r.model] = 1; });
            outs.forEach(function (r) { s[r.model] = 1; });
            return Object.keys(s).length;
          }
        },
        {
          label: '在库台数',
          get: function () {
            var ins = read(K.printhead.inRecs, []), outs = read(K.printhead.outRecs, []);
            var ms = read(K.printhead.models, []);
            var names = {};
            ms.forEach(function (m) { names[m.name] = 1; });
            ins.forEach(function (r) { names[r.model] = 1; });
            outs.forEach(function (r) { names[r.model] = 1; });
            return Object.keys(names).reduce(function (a, n) { return a + phStock(n, ins, outs); }, 0);
          }
        },
        {
          label: '库存预警',
          warn: true,
          get: function () {
            var ins = read(K.printhead.inRecs, []), outs = read(K.printhead.outRecs, []);
            var ms = read(K.printhead.models, []);
            var low = 0;
            ms.forEach(function (m) {
              var th = Number(m.threshold) || 5;
              if (phStock(m.name, ins, outs) < th) low++;
            });
            return low;
          }
        }
      ]
    },
    {
      id: 'badge',
      name: '胸章退货台账',
      short: '胸章',
      desc: '登记胸章退货的客户 / 型号 / 工艺与检验结果，跟踪换新进度，按型号·客户·原因维度统计分析。',
      icon: '🎖️',
      tone: 'violet',
      href: 'badge.html',
      quick: { label: '登记胸章退货', href: 'badge.html' },
      stats: [
        {
          label: '退货笔数',
          get: function () { return read(K.badge.returns, []).length; }
        },
        {
          label: '退货数量',
          get: function () { return sumQty(read(K.badge.returns, [])); }
        },
        {
          label: '待换新',
          warn: true,
          get: function () {
            // 检验合格或处理方式为「无需处理」的，视为无需换新
            return leftQty(read(K.badge.returns, []), read(K.badge.reps, []), function (r) {
              return r.insp === '合格' || r.handle === '无需处理';
            });
          }
        }
      ]
    }
  ];

  /* ---------- 主题色 → CSS 变量映射 ---------- */
  var TONE = {
    blue: { bg: 'var(--primary-soft)', fg: 'var(--primary)' },
    teal: { bg: 'var(--teal-soft)', fg: 'var(--teal)' },
    violet: { bg: 'var(--violet-soft)', fg: 'var(--violet)' },
    green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
    amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' }
  };

  window.LH = window.LH || {};
  window.LH.MODULES = MODULES;
  window.LH.TONE = TONE;
  /** 按 id 取模块配置 */
  window.LH.getModule = function (id) {
    return MODULES.filter(function (m) { return m.id === id; })[0] || null;
  };
  /** 计算某模块的统计值（容错：计算失败返回 0，不影响主页渲染） */
  window.LH.moduleStats = function (mod) {
    return (mod.stats || []).map(function (s) {
      var v = 0;
      try { v = Number(s.get()) || 0; } catch (e) { console.warn('[modules] 统计失败：' + mod.id, e); }
      return { label: s.label, value: v, warn: !!s.warn };
    });
  };
})();
