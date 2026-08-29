/* ==========================================================================
   printhead.js · 喷头库存管理业务逻辑
   --------------------------------------------------------------------------
   模块： 库存概览（实时库存 = 入库 − 出库，低于阈值预警）
          入库管理（订单号 / 批次 / 供应商 / 单价）
          出库管理（订单号 / 领用人 / 用途，超库存提醒）
          型号管理（增删改 + 预警阈值）
          记录查询（类型 / 型号 / 时间范围）
   数据： localStorage（LH.KEYS.printhead），全程离线
   ========================================================================== */
(function () {
  'use strict';

  var K = LH.KEYS.printhead;
  var DEFAULT_THRESHOLD = 5;
  var PRESET = ['XP600', '3200', '1600', '3200U1', '3200八柱', 'DX7'];

  /* ---------- 状态 ---------- */
  var models = LH.store.get(K.models, null);
  if (!models) {
    models = PRESET.map(function (n, i) {
      return { id: 'phm' + i + '_' + LH.uid(), name: n, threshold: DEFAULT_THRESHOLD, note: '' };
    });
    LH.store.set(K.models, models);
  }
  var inRecs = LH.store.get(K.inRecs, []);
  var outRecs = LH.store.get(K.outRecs, []);

  var edit = { in: null, out: null, model: null };
  var page = { in: 1, out: 1, query: 1 };
  var qType = '';
  var PER = 12;

  function saveModels() { LH.store.set(K.models, models); cloudChanged(); }
  function saveIn() { LH.store.set(K.inRecs, inRecs); cloudChanged(); }
  function saveOut() { LH.store.set(K.outRecs, outRecs); cloudChanged(); }
  function cloudChanged() { if (window.LH.cloudUI) LH.cloudUI.changed(); }

  /* ================= 云端同步：数据适配 ================= */
  var CLOUD_PATH = 'data/printhead.json';
  function cloudIsEmpty() { return inRecs.length === 0 && outRecs.length === 0; }
  function cloudPayload() {
    return {
      app: 'printhead', version: 1, savedAt: new Date().toISOString(),
      models: models, inRecs: inRecs, outRecs: outRecs
    };
  }
  /** 合并云端数据：出入库按 id 去重，型号按名称去重（本机优先），返回导入描述 */
  function cloudApply(data) {
    var n0 = inRecs.length + outRecs.length;
    if ((data.models || []).length) {
      var byName = {};
      (data.models || []).concat(models).forEach(function (m) { byName[m.name] = m; });
      models = Object.keys(byName).map(function (k) { return byName[k]; });
      LH.store.set(K.models, models);
    }
    var m1 = {};
    (data.inRecs || []).concat(inRecs).forEach(function (r) { m1[r.id] = r; });
    inRecs = Object.keys(m1).map(function (k) { return m1[k]; });
    var m2 = {};
    (data.outRecs || []).concat(outRecs).forEach(function (r) { m2[r.id] = r; });
    outRecs = Object.keys(m2).map(function (k) { return m2[k]; });
    LH.store.set(K.inRecs, inRecs);
    LH.store.set(K.outRecs, outRecs);
    return '型号 ' + models.length + ' 个、记录 ' + (inRecs.length + outRecs.length) +
      ' 条（新增 ' + (inRecs.length + outRecs.length - n0) + '）';
  }

  /* ================= 计算 ================= */
  /** 某型号当前库存 */
  function stockOf(name) {
    return LH.sum(inRecs.filter(function (r) { return r.model === name; }), function (r) { return r.qty; }) -
      LH.sum(outRecs.filter(function (r) { return r.model === name; }), function (r) { return r.qty; });
  }
  /** 型号阈值（未登记型号用默认值） */
  function thresholdOf(name) {
    var m = models.filter(function (x) { return x.name === name; })[0];
    return m ? (Number(m.threshold) || DEFAULT_THRESHOLD) : DEFAULT_THRESHOLD;
  }
  /** 参与统计的型号列表（型号表 + 有流水记录的型号，避免删除型号后库存「消失」） */
  function allNames() {
    var s = {};
    models.forEach(function (m) { s[m.name] = 1; });
    inRecs.forEach(function (r) { s[r.model] = 1; });
    outRecs.forEach(function (r) { s[r.model] = 1; });
    return Object.keys(s);
  }
  function idxOf(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }

  /* ================= 视图1：库存概览 ================= */
  function renderStock() {
    var names = allNames();
    var total = 0, low = 0;
    names.forEach(function (n) {
      var st = stockOf(n);
      total += st;
      if (st < thresholdOf(n)) low++;
    });
    var inTotal = LH.sum(inRecs, function (r) { return r.qty; });
    var outTotal = LH.sum(outRecs, function (r) { return r.qty; });

    LH.byId('stockStats').innerHTML = [
      card('在管型号', names.length, '个', 'ic-blue', '🏷️', '已登记喷头型号'),
      card('在库总量', total, '台', 'ic-teal', '📦', '入库 − 出库'),
      card('累计入库', inTotal, '台', 'ic-green', '⬇️', inRecs.length + ' 条入库记录'),
      card('库存预警', low, '个', low ? 'ic-red' : 'ic-amber', '⚠️', low ? '有型号低于预警阈值' : '全部型号库存充足')
    ].join('');

    LH.byId('stockTip').innerHTML = low
      ? '<span style="color:var(--red);font-weight:600">⚠️ ' + low + ' 个型号库存不足</span>'
      : '✅ 库存正常';

    LH.byId('stockGrid').innerHTML = names.length ? names.map(function (n) {
      var st = stockOf(n), th = thresholdOf(n), isLow = st < th;
      var maxIn = Math.max(LH.sum(inRecs.filter(function (r) { return r.model === n; }), function (r) { return r.qty; }), 1);
      var pct = Math.max(0, Math.min(100, Math.round(st / maxIn * 100)));
      return '<div class="stock-card' + (isLow ? ' low' : '') + '">' +
        '<div class="sc-h"><span class="sc-name">' + LH.esc(n) + '</span>' +
        (isLow ? '<span class="pill st-reject">库存不足</span>' : '<span class="pill st-done">正常</span>') + '</div>' +
        '<div class="sc-num">' + st + '</div>' +
        '<div class="sc-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="sc-meta"><span>入 ' + LH.sum(inRecs.filter(function (r) { return r.model === n; }), function (r) { return r.qty; }) + '</span>' +
        '<span>出 ' + LH.sum(outRecs.filter(function (r) { return r.model === n; }), function (r) { return r.qty; }) + '</span>' +
        '<span' + (isLow ? ' style="color:var(--red);font-weight:700"' : '') + '>阈值 ' + th + '</span></div>' +
        '</div>';
    }).join('') : '<div class="empty show" style="grid-column:1/-1"><div class="e-ico">🏷️</div><div class="e-title">暂无型号</div><div class="e-sub">请到「型号管理」添加喷头型号</div></div>';

    var n = LH.byId('sfN'), q = LH.byId('sfQ'), l = LH.byId('sfLow');
    if (n) n.textContent = names.length;
    if (q) q.textContent = total;
    if (l) l.textContent = low;
  }
  function card(label, val, unit, ic, ico, meta) {
    return '<div class="stat-card"><div class="stat-icon ' + ic + '">' + ico + '</div>' +
      '<div class="stat-main"><div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + LH.num(val) + '<span class="stat-unit">' + unit + '</span></div>' +
      '<div class="stat-meta">' + LH.esc(meta) + '</div></div></div>';
  }

  /* ================= 视图2：入库 ================= */
  function fillModelSelects() {
    var opts = models.map(function (m) {
      return '<option value="' + LH.esc(m.id) + '">' + LH.esc(m.name) + '</option>';
    }).join('');
    var names = allNames().map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join('');
    setHTML('in_model', opts);
    setHTML('out_model', opts);
    ['q_in_model', 'q_out_model', 'q_q_model'].forEach(function (id) {
      var el = LH.byId(id);
      if (!el) return;
      var cur = el.value;
      el.innerHTML = '<option value="">' + (id === 'q_q_model' ? '全部' : '全部型号') + '</option>' + names;
      el.value = cur;
    });
  }
  function setHTML(id, html) {
    var el = LH.byId(id);
    if (!el) return;
    var cur = el.value;
    el.innerHTML = html;
    if (cur) el.value = cur;
  }
  function modelNameById(id) {
    var m = models.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : '';
  }
  function resetInForm() {
    edit.in = null;
    LH.byId('inFormTitle').textContent = '喷头入库登记';
    LH.byId('inSave').textContent = '确认入库';
    LH.byId('inForm').reset();
    LH.byId('in_date').value = LH.today();
    LH.byId('in_qty').value = 1;
    if (models.length) LH.byId('in_model').value = models[0].id;
  }
  function saveInRecord() {
    var rec = {
      id: edit.in || LH.uid(),
      date: LH.byId('in_date').value,
      orderNo: LH.byId('in_order').value.trim(),
      model: modelNameById(LH.byId('in_model').value),
      qty: parseInt(LH.byId('in_qty').value, 10) || 0,
      batch: LH.byId('in_batch').value.trim(),
      supplier: LH.byId('in_supplier').value.trim(),
      price: parseFloat(LH.byId('in_price').value) || 0,
      note: LH.byId('in_note').value.trim()
    };
    if (!rec.date) return bad('in_date', '请选择入库日期');
    if (!rec.orderNo) return bad('in_order', '请填写订单号');
    if (!rec.model) return LH.toast('请选择型号');
    if (rec.qty < 1) return bad('in_qty', '入库数量必须 ≥ 1');
    if (edit.in) { inRecs[idxOf(inRecs, edit.in)] = rec; LH.toast('入库记录已更新'); }
    else { inRecs.unshift(rec); LH.toast('入库登记成功'); }
    saveIn(); resetInForm(); renderAll();
  }
  function bad(id, msg) {
    var el = LH.byId(id);
    if (el) { el.classList.add('invalid'); setTimeout(function () { el.classList.remove('invalid'); }, 600); el.focus(); }
    LH.toast(msg);
  }
  function editIn(id) {
    var r = inRecs[idxOf(inRecs, id)];
    if (!r) return;
    edit.in = id;
    LH.byId('inFormTitle').textContent = '编辑入库记录';
    LH.byId('inSave').textContent = '保存修改';
    LH.byId('in_date').value = r.date || '';
    LH.byId('in_order').value = r.orderNo || '';
    var m = models.filter(function (x) { return x.name === r.model; })[0];
    LH.byId('in_model').value = m ? m.id : (models[0] && models[0].id);
    LH.byId('in_qty').value = r.qty;
    LH.byId('in_batch').value = r.batch || '';
    LH.byId('in_supplier').value = r.supplier || '';
    LH.byId('in_price').value = r.price || '';
    LH.byId('in_note').value = r.note || '';
    LH.shell.switchView('vIn');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function delIn(id) {
    LH.confirm('确定删除这条入库记录？库存将相应减少。', '确定删除').then(function (ok) {
      if (!ok) return;
      inRecs = inRecs.filter(function (x) { return x.id !== id; });
      saveIn(); renderAll(); LH.toast('入库记录已删除');
    });
  }
  function renderIn() {
    var kw = LH.byId('q_in').value.trim().toLowerCase();
    var m = LH.byId('q_in_model').value;
    var list = inRecs.filter(function (r) {
      if (m && r.model !== m) return false;
      if (kw && (r.orderNo + r.model + r.batch + r.supplier + r.note).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    var pg = LH.paginate(list, page.in, PER);
    LH.byId('inBody').innerHTML = pg.rows.map(function (r) {
      return '<tr><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td class="td-num" style="color:var(--primary-strong)">+' + r.qty + '</td>' +
        '<td class="td-muted">' + LH.esc(r.batch || '—') + '</td>' +
        '<td class="td-muted">' + LH.esc(r.supplier || '—') + '</td>' +
        '<td class="td-num">' + LH.money(r.price, true) + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(r.note) + '">' + LH.esc(r.note || '—') + '</td>' +
        '<td class="td-act"><button class="row-btn" data-ei="' + r.id + '">✏️</button>' +
        '<button class="row-btn del" data-di="' + r.id + '">🗑</button></td></tr>';
    }).join('');
    bind(LH.byId('inBody'), 'ei', editIn, 'di', delIn);
    LH.showEmpty('inEmpty', null, pg.rows, { icon: '📥', title: '暂无入库记录', sub: '在上方登记一笔入库' });
    pager('inPager', pg, function (p) { page.in = p; renderIn(); });
    LH.byId('inCount').textContent = '共 ' + list.length + ' 条 / ' + LH.sum(list, function (r) { return r.qty; }) + ' 台';
    LH.byId('inInfo').textContent = '共 ' + pg.total + ' 条，第 ' + pg.page + '/' + pg.pages + ' 页';
  }

  /* ================= 视图3：出库 ================= */
  function resetOutForm() {
    edit.out = null;
    LH.byId('outFormTitle').textContent = '喷头出库登记';
    LH.byId('outSave').textContent = '确认出库';
    LH.byId('outForm').reset();
    LH.byId('out_date').value = LH.today();
    LH.byId('out_qty').value = 1;
    if (models.length) LH.byId('out_model').value = models[0].id;
  }
  function saveOutRecord() {
    var rec = {
      id: edit.out || LH.uid(),
      date: LH.byId('out_date').value,
      orderNo: LH.byId('out_order').value.trim(),
      model: modelNameById(LH.byId('out_model').value),
      qty: parseInt(LH.byId('out_qty').value, 10) || 0,
      user: LH.byId('out_user').value.trim(),
      purpose: LH.byId('out_purpose').value.trim(),
      note: LH.byId('out_note').value.trim()
    };
    if (!rec.date) return bad('out_date', '请选择出库日期');
    if (!rec.orderNo) return bad('out_order', '请填写订单号');
    if (!rec.model) return LH.toast('请选择型号');
    if (rec.qty < 1) return bad('out_qty', '出库数量必须 ≥ 1');
    var cur = stockOf(rec.model);
    if (rec.qty > cur && !window.confirm('该型号当前库存 ' + cur + ' 台，本次出库 ' + rec.qty + ' 台将超出库存，确定继续？')) return;
    if (edit.out) { outRecs[idxOf(outRecs, edit.out)] = rec; LH.toast('出库记录已更新'); }
    else { outRecs.unshift(rec); LH.toast('出库登记成功'); }
    saveOut(); resetOutForm(); renderAll();
  }
  function editOut(id) {
    var r = outRecs[idxOf(outRecs, id)];
    if (!r) return;
    edit.out = id;
    LH.byId('outFormTitle').textContent = '编辑出库记录';
    LH.byId('outSave').textContent = '保存修改';
    LH.byId('out_date').value = r.date || '';
    LH.byId('out_order').value = r.orderNo || '';
    var m = models.filter(function (x) { return x.name === r.model; })[0];
    LH.byId('out_model').value = m ? m.id : (models[0] && models[0].id);
    LH.byId('out_qty').value = r.qty;
    LH.byId('out_user').value = r.user || '';
    LH.byId('out_purpose').value = r.purpose || '';
    LH.byId('out_note').value = r.note || '';
    LH.shell.switchView('vOut');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function delOut(id) {
    LH.confirm('确定删除这条出库记录？库存将相应增加。', '确定删除').then(function (ok) {
      if (!ok) return;
      outRecs = outRecs.filter(function (x) { return x.id !== id; });
      saveOut(); renderAll(); LH.toast('出库记录已删除');
    });
  }
  function renderOut() {
    var kw = LH.byId('q_out').value.trim().toLowerCase();
    var m = LH.byId('q_out_model').value;
    var list = outRecs.filter(function (r) {
      if (m && r.model !== m) return false;
      if (kw && (r.orderNo + r.model + r.user + r.purpose + r.note).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    var pg = LH.paginate(list, page.out, PER);
    LH.byId('outBody').innerHTML = pg.rows.map(function (r) {
      return '<tr><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td class="td-num" style="color:var(--amber)">-' + r.qty + '</td>' +
        '<td>' + LH.esc(r.user || '—') + '</td>' +
        '<td class="td-muted">' + LH.esc(r.purpose || '—') + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(r.note) + '">' + LH.esc(r.note || '—') + '</td>' +
        '<td class="td-act"><button class="row-btn" data-eo="' + r.id + '">✏️</button>' +
        '<button class="row-btn del" data-do="' + r.id + '">🗑</button></td></tr>';
    }).join('');
    bind(LH.byId('outBody'), 'eo', editOut, 'do', delOut);
    LH.showEmpty('outEmpty', null, pg.rows, { icon: '📤', title: '暂无出库记录', sub: '在上方登记一笔出库' });
    pager('outPager', pg, function (p) { page.out = p; renderOut(); });
    LH.byId('outCount').textContent = '共 ' + list.length + ' 条 / ' + LH.sum(list, function (r) { return r.qty; }) + ' 台';
    LH.byId('outInfo').textContent = '共 ' + pg.total + ' 条，第 ' + pg.page + '/' + pg.pages + ' 页';
  }
  function bind(tbody, eKey, eFn, dKey, dFn) {
    tbody.querySelectorAll('[data-' + eKey + ']').forEach(function (b) {
      b.addEventListener('click', function () { eFn(b.getAttribute('data-' + eKey)); });
    });
    tbody.querySelectorAll('[data-' + dKey + ']').forEach(function (b) {
      b.addEventListener('click', function () { dFn(b.getAttribute('data-' + dKey)); });
    });
  }

  /* ================= 视图4：型号管理 ================= */
  function resetModelForm() {
    edit.model = null;
    LH.byId('modelFormTitle').textContent = '新增喷头型号';
    LH.byId('modelSave').textContent = '新增型号';
    LH.byId('modelForm').reset();
    LH.byId('m_threshold').value = DEFAULT_THRESHOLD;
  }
  function saveModel() {
    var name = LH.byId('m_name').value.trim();
    var th = parseInt(LH.byId('m_threshold').value, 10);
    if (!name) return bad('m_name', '请填写型号名称');
    if (isNaN(th) || th < 0) return bad('m_threshold', '阈值不能为负数');
    if (edit.model) {
      models[idxOf(models, edit.model)] = {
        id: edit.model, name: name, threshold: th, note: LH.byId('m_note').value.trim()
      };
      LH.toast('型号已更新');
    } else {
      if (models.some(function (x) { return x.name === name; })) return bad('m_name', '该型号已存在');
      models.push({ id: LH.uid(), name: name, threshold: th, note: LH.byId('m_note').value.trim() });
      LH.toast('型号已新增');
    }
    saveModels(); resetModelForm(); renderAll();
  }
  function editModel(id) {
    var m = models[idxOf(models, id)];
    if (!m) return;
    edit.model = id;
    LH.byId('modelFormTitle').textContent = '编辑型号';
    LH.byId('modelSave').textContent = '保存修改';
    LH.byId('m_name').value = m.name;
    LH.byId('m_threshold').value = m.threshold;
    LH.byId('m_note').value = m.note || '';
    LH.shell.switchView('vModel');
  }
  function delModel(id) {
    var m = models[idxOf(models, id)];
    if (!m) return;
    var used = inRecs.some(function (r) { return r.model === m.name; }) || outRecs.some(function (r) { return r.model === m.name; });
    LH.confirm('确定删除型号「' + m.name + '」？' + (used ? '该型号存在历史出入库记录，删除后记录仍保留（不再出现在下拉与库存概览）。' : ''), '确定删除')
      .then(function (ok) {
        if (!ok) return;
        models = models.filter(function (x) { return x.id !== id; });
        saveModels(); renderAll(); LH.toast('型号已删除');
      });
  }
  function renderModels() {
    LH.byId('modelBody').innerHTML = models.map(function (m) {
      var st = stockOf(m.name), isLow = st < m.threshold;
      return '<tr><td class="td-strong">' + LH.esc(m.name) + '</td>' +
        '<td class="td-num">' + m.threshold + '</td>' +
        '<td class="td-num" style="color:' + (isLow ? 'var(--red)' : 'var(--ink)') + '">' + st + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(m.note) + '">' + LH.esc(m.note || '—') + '</td>' +
        '<td class="td-act"><button class="row-btn" data-em="' + m.id + '">✏️</button>' +
        '<button class="row-btn del" data-dm="' + m.id + '">🗑</button></td></tr>';
    }).join('');
    var tb = LH.byId('modelBody');
    tb.querySelectorAll('[data-em]').forEach(function (b) {
      b.addEventListener('click', function () { editModel(b.getAttribute('data-em')); });
    });
    tb.querySelectorAll('[data-dm]').forEach(function (b) {
      b.addEventListener('click', function () { delModel(b.getAttribute('data-dm')); });
    });
    LH.showEmpty('modelEmpty', null, models, { icon: '🏷️', title: '暂无型号', sub: '在上方添加喷头型号' });
    LH.byId('modelCount').textContent = '共 ' + models.length + ' 个';
  }

  /* ================= 视图5：记录查询 ================= */
  function renderQuery() {
    var m = LH.byId('q_q_model').value, f = LH.byId('q_q_from').value, t = LH.byId('q_q_to').value;
    var rows = [].concat(
      inRecs.map(function (r) {
        return { kind: '入库', cls: 'st-proc', date: r.date, orderNo: r.orderNo || '', model: r.model, qty: Number(r.qty) || 0,
          detail: '批次 ' + (r.batch || '—') + ' ｜ 供应商 ' + (r.supplier || '—') + ' ｜ ' + LH.money(r.price, true), note: r.note || '' };
      }),
      outRecs.map(function (r) {
        return { kind: '出库', cls: 'st-wait', date: r.date, orderNo: r.orderNo || '', model: r.model, qty: Number(r.qty) || 0,
          detail: '领用 ' + (r.user || '—') + ' ｜ 用途 ' + (r.purpose || '—'), note: r.note || '' };
      })
    ).filter(function (r) {
      if (qType && r.kind !== qType) return false;
      if (m && r.model !== m) return false;
      if (f && r.date < f) return false;
      if (t && r.date > t) return false;
      return true;
    }).sort(function (a, b) {
      if (a.date === b.date) return a.kind === b.kind ? 0 : (a.kind === '入库' ? -1 : 1);
      return String(b.date).localeCompare(String(a.date));
    });

    var pg = LH.paginate(rows, page.query, PER);
    LH.byId('qBody').innerHTML = pg.rows.map(function (r) {
      return '<tr><td><span class="pill ' + r.cls + '">' + r.kind + '</span></td>' +
        '<td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td class="td-num" style="color:' + (r.kind === '入库' ? 'var(--primary-strong)' : 'var(--amber)') + '">' +
        (r.kind === '入库' ? '+' : '-') + r.qty + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(r.detail) + '">' + LH.esc(r.detail) + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(r.note) + '">' + LH.esc(r.note || '—') + '</td></tr>';
    }).join('');
    LH.showEmpty('qEmpty', null, pg.rows, { icon: '🔍', title: '无符合条件的记录', sub: '调整筛选条件试试' });
    pager('qPager', pg, function (p) { page.query = p; renderQuery(); });
    LH.byId('qCount').textContent = '共 ' + rows.length + ' 条';
    LH.byId('qInfo').textContent = '共 ' + pg.total + ' 条，第 ' + pg.page + '/' + pg.pages + ' 页';
  }

  /* ================= 分页器 ================= */
  function pager(id, pg, cb) {
    var el = LH.byId(id);
    if (!el) return;
    if (pg.pages <= 1) { el.innerHTML = ''; return; }
    var html = '<button class="pg-btn" data-p="' + (pg.page - 1) + '"' + (pg.page <= 1 ? ' disabled' : '') + '>‹</button>';
    for (var i = 1; i <= pg.pages; i++) {
      if (pg.pages > 7 && i > 2 && i < pg.pages - 1 && Math.abs(i - pg.page) > 1) {
        if (i === 3) html += '<span class="pg-dots">…</span>';
        continue;
      }
      html += '<button class="pg-btn' + (i === pg.page ? ' active' : '') + '" data-p="' + i + '">' + i + '</button>';
    }
    html += '<button class="pg-btn" data-p="' + (pg.page + 1) + '"' + (pg.page >= pg.pages ? ' disabled' : '') + '>›</button>';
    el.innerHTML = html;
    el.querySelectorAll('.pg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = parseInt(b.getAttribute('data-p'), 10);
        if (!p || p < 1 || p > pg.pages) return;
        cb(p);
      });
    });
  }

  /* ================= 导出 ================= */
  function exportIn() {
    if (!inRecs.length) return LH.toast('暂无入库记录');
    LH.exportCSV('喷头入库记录_' + LH.today() + '.csv',
      ['入库日期', '订单号', '型号', '数量', '批次号', '供应商', '单价', '备注'],
      inRecs.map(function (r) {
        return [r.date, r.orderNo || '', r.model, r.qty, r.batch || '', r.supplier || '', r.price || 0, r.note || ''];
      }));
  }
  function exportOut() {
    if (!outRecs.length) return LH.toast('暂无出库记录');
    LH.exportCSV('喷头出库记录_' + LH.today() + '.csv',
      ['出库日期', '订单号', '型号', '数量', '领用人/部门', '用途', '备注'],
      outRecs.map(function (r) {
        return [r.date, r.orderNo || '', r.model, r.qty, r.user || '', r.purpose || '', r.note || ''];
      }));
  }

  /* ================= 示例数据 ================= */
  function seed() {
    var has = inRecs.length || outRecs.length;
    LH.confirm(has ? '载入示例会追加到现有数据，继续？' : '将生成一批示例数据，确定载入？', '载入示例')
      .then(function (ok) {
        if (!ok) return;
        var s = LH.seed.printhead();
        s.models.forEach(function (m) {
          if (!models.some(function (x) { return x.name === m.name; })) models.push(m);
        });
        inRecs = s.inRecs.concat(inRecs);
        outRecs = s.outRecs.concat(outRecs);
        saveModels(); saveIn(); saveOut();
        renderAll();
        LH.toast('示例数据已载入');
      });
  }

  /* ================= 统一渲染 ================= */
  function renderAll() {
    fillModelSelects();
    renderStock();
    renderIn();
    renderOut();
    renderModels();
    renderQuery();
  }

  /* ================= 初始化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    LH.shell.init({
      brand: '喷头库存管理', brandSub: 'PRINTHEAD INVENTORY', brandIcon: '🖨️',
      title: '库存概览', sub: '各型号实时库存与低库存预警',
      current: 'vStock',
      nav: [
        { label: '库存' },
        { id: 'vStock', name: '库存概览', short: '库存', ico: '📦' },
        { id: 'vIn', name: '入库管理', short: '入库', ico: '⬇️' },
        { id: 'vOut', name: '出库管理', short: '出库', ico: '⬆️' },
        { id: 'vModel', name: '型号管理', short: '型号', ico: '🏷️' },
        { id: 'vQuery', name: '记录查询', short: '查询', ico: '🔍' }
      ],
      onChange: function (id) {
        var meta = {
          vStock: ['库存概览', '各型号实时库存与低库存预警'],
          vIn: ['入库管理', '登记喷头入库，记录订单号/批次/供应商/单价'],
          vOut: ['出库管理', '登记喷头出库，记录订单号/领用人/用途'],
          vModel: ['型号管理', '维护喷头型号与库存预警阈值'],
          vQuery: ['记录查询', '按类型/型号/时间范围筛选出入库明细']
        }[id];
        if (meta) { LH.byId('pageTitle').textContent = meta[0]; LH.byId('pageSub').textContent = meta[1]; }
      }
    });

    // 表单
    LH.byId('inForm').addEventListener('submit', function (e) { e.preventDefault(); saveInRecord(); });
    LH.byId('outForm').addEventListener('submit', function (e) { e.preventDefault(); saveOutRecord(); });
    LH.byId('modelForm').addEventListener('submit', function (e) { e.preventDefault(); saveModel(); });
    LH.byId('inReset').addEventListener('click', resetInForm);
    LH.byId('outReset').addEventListener('click', resetOutForm);
    LH.byId('modelReset').addEventListener('click', resetModelForm);

    // 快捷入口
    LH.byId('btnQuickIn').addEventListener('click', function () { LH.shell.switchView('vIn'); });
    LH.byId('btnQuickOut').addEventListener('click', function () { LH.shell.switchView('vOut'); });

    // 查询
    ['q_in', 'q_in_model'].forEach(function (id) {
      LH.byId(id).addEventListener('input', function () { page.in = 1; renderIn(); });
      LH.byId(id).addEventListener('change', function () { page.in = 1; renderIn(); });
    });
    ['q_out', 'q_out_model'].forEach(function (id) {
      LH.byId(id).addEventListener('input', function () { page.out = 1; renderOut(); });
      LH.byId(id).addEventListener('change', function () { page.out = 1; renderOut(); });
    });
    ['q_q_model', 'q_q_from', 'q_q_to'].forEach(function (id) {
      LH.byId(id).addEventListener('change', function () { page.query = 1; renderQuery(); });
    });
    LH.byId('btnResetQuery').addEventListener('click', function () {
      LH.byId('q_q_model').value = ''; LH.byId('q_q_from').value = ''; LH.byId('q_q_to').value = '';
      qType = '';
      LH.byId('qTypeSeg').querySelectorAll('.seg-btn').forEach(function (b, i) {
        b.classList.toggle('active', i === 0);
      });
      page.query = 1; renderQuery();
    });
    LH.byId('qTypeSeg').querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        LH.byId('qTypeSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        qType = b.getAttribute('data-v');
        page.query = 1; renderQuery();
      });
    });

    // 导出 / 示例
    LH.byId('btnExportIn').addEventListener('click', exportIn);
    LH.byId('btnExportOut').addEventListener('click', exportOut);
    LH.byId('btnSeed').addEventListener('click', seed);
    LH.bindMaskClose('confirmMask');

    resetInForm(); resetOutForm(); resetModelForm();
    renderAll();

    // 云端同步 + 冷启动继承线上数据
    LH.cloudUI.init({
      path: CLOUD_PATH,
      isEmpty: cloudIsEmpty,
      getPayload: cloudPayload,
      applyData: cloudApply,
      onChanged: function () { renderAll(); }
    });
  });
})();
