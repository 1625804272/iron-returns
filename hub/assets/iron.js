/* ==========================================================================
   iron.js · 熨斗退货台账业务逻辑
   --------------------------------------------------------------------------
   模块： 退货登记（型号-颜色联动 / 不合格原因多选 / 备注 / 扫码）
          补发跟踪（合格=无需补发，不计入未补统计）
          统计查询（时间/型号/颜色/供应商筛选 + 图表 + 明细）
   数据： localStorage（LH.KEYS.iron），全程离线
   依赖： core.js · app-shell.js · seed.js · echarts · zxing（扫码，可选）
   ========================================================================== */
(function () {
  'use strict';

  var K = LH.KEYS.iron;

  /* ---------- 基础配置 ---------- */
  var MODEL_COLORS = { 'M2': ['红', '绿', '灰'], 'L': ['绿', '红'], 'L2': ['紫'], 'L3': ['绿'] };
  var REASONS = ['不通电', '不加热', '屏幕不显示', '壳料破损脏污', '发热板脏污或划痕'];
  var PLUGS = ['国标', '美规', '欧规', '英规', '澳规', '其他'];

  /* ---------- 状态 ---------- */
  var returns = LH.store.get(K.returns, []);
  var reps = LH.store.get(K.reps, []);
  var editId = null;          // 正在编辑的退货记录 id
  var reasonSel = [];         // 当前表单已选不合格原因
  var repTarget = null;       // 补发弹窗指向的退货记录
  var page = { reg: 1, trk: 1, sta: 1 };
  var trkFilter = '';         // 补发状态筛选
  var PER = 12;

  function save() {
    LH.store.set(K.returns, returns);
    LH.store.set(K.reps, reps);
    if (window.LH.cloudUI) LH.cloudUI.changed();   // 触发云端防抖推送
  }

  /* ================= 云端同步：数据适配 ================= */
  var CLOUD_PATH = 'data/returns.json';
  function cloudIsEmpty() { return returns.length === 0 && reps.length === 0; }
  function cloudPayload() {
    return { app: 'iron-returns', version: 1, savedAt: new Date().toISOString(), returns: returns, reps: reps };
  }
  /** 合并云端数据（按 id 去重，本机优先），返回导入描述 */
  function cloudApply(data) {
    var n0 = returns.length;
    var m1 = {};
    (data.reps || []).concat(reps).forEach(function (r) { m1[r.id] = r; });
    reps = Object.keys(m1).map(function (k) { return m1[k]; });
    var m2 = {};
    (data.returns || []).concat(returns).forEach(function (r) { m2[r.id] = r; });
    returns = Object.keys(m2).map(function (k) { return m2[k]; });
    save();
    return '退货 ' + returns.length + ' 笔（新增 ' + (returns.length - n0) + '）';
  }

  /* ================= 计算：补发状态 ================= */
  function repQty(retId) {
    return LH.sum(reps.filter(function (r) { return r.returnId === retId; }), function (r) { return r.qty; });
  }
  /** 检验合格 → 无需补发（不计入未补统计） */
  function status(r) {
    var qty = Number(r.qty) || 0;
    if (r.insp === '合格') return { name: '无需补发', cls: 'st-done', done: qty, left: 0 };
    var done = repQty(r.id);
    var left = Math.max(0, qty - done);
    if (done <= 0) return { name: '待补发', cls: 'st-wait', done: 0, left: qty };
    if (done < qty) return { name: '部分补发', cls: 'st-proc', done: done, left: left };
    return { name: '已补完', cls: 'st-done', done: done, left: 0 };
  }
  function inspPill(insp) {
    if (insp === '合格') return '<span class="pill st-done">合格</span>';
    if (insp === '不合格') return '<span class="pill st-reject">不合格</span>';
    return '<span class="pill st-wait">缺料</span>';
  }
  /** 不合格原因 + 补充说明 合并文本 */
  function reasonText(r) {
    var parts = [];
    if ((r.reasons || []).length) parts.push(r.reasons.join('、'));
    if (r.issue) parts.push(r.issue);
    return parts.join('；') || '—';
  }

  /* ================= 视图1：退货登记 ================= */
  function initForm() {
    // 型号 / 颜色联动
    var ms = LH.byId('f_model');
    ms.innerHTML = Object.keys(MODEL_COLORS).map(function (m) { return '<option>' + m + '</option>'; }).join('');
    ms.addEventListener('change', function () { fillColors('f_'); });
    fillColors('f_');
    LH.byId('f_plug').innerHTML = PLUGS.map(function (p) { return '<option>' + p + '</option>'; }).join('');

    // 分段选择（电压 / 检验）
    bindSegPick('f_volt');
    bindSegPick('f_insp', function (v) {
      var show = (v === '不合格');
      LH.byId('issueWrap').style.display = show ? '' : 'none';
      if (show && !reasonSel.length) openReason();   // 选不合格 → 自动弹原因面板
      // 选「合格」且备注为空时，自动填默认备注「无理由」（用户已填过则保留）
      if (v === '合格') {
        var noteEl = LH.byId('f_note');
        if (noteEl && !noteEl.value.trim()) noteEl.value = '无理由';
      }
    });

    LH.byId('retForm').addEventListener('submit', function (e) {
      e.preventDefault();
      saveRecord();
    });
    LH.byId('btnReset').addEventListener('click', resetForm);
    LH.byId('btnEditReason').addEventListener('click', openReason);
  }
  /** 分段按钮组通用绑定 */
  function bindSegPick(id, onChange) {
    var wrap = LH.byId(id);
    if (!wrap) return;
    wrap.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        wrap.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (onChange) onChange(b.getAttribute('data-v'));
      });
    });
  }
  function segVal(id) {
    var b = LH.byId(id).querySelector('button.on');
    return b ? b.getAttribute('data-v') : '';
  }
  function setSeg(id, v) {
    LH.byId(id).querySelectorAll('button').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-v') === v);
    });
  }
  function fillColors(prefix, sel) {
    var m = LH.byId(prefix + 'model').value;
    var colors = MODEL_COLORS[m] || [];
    LH.byId(prefix + 'color').innerHTML = colors.map(function (c) {
      return '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>';
    }).join('');
  }

  /* ---------- 保存 / 重置 ---------- */
  function saveRecord() {
    var insp = segVal('f_insp');
    var rec = {
      id: editId || LH.uid(),
      date: LH.byId('f_date').value,
      orderNo: LH.byId('f_order').value.trim(),
      express: LH.byId('f_express').value.trim(),
      model: LH.byId('f_model').value,
      color: LH.byId('f_color').value,
      volt: segVal('f_volt'),
      plug: LH.byId('f_plug').value,
      qty: parseInt(LH.byId('f_qty').value, 10) || 0,
      supplier: LH.byId('f_supplier').value.trim(),
      insp: insp,
      reasons: insp === '不合格' ? reasonSel.slice() : [],
      issue: insp === '不合格' ? LH.byId('f_reason_extra').value.trim() : '',
      note: LH.byId('f_note').value.trim()
    };
    // 校验
    if (!rec.date) return bad('f_date', '请选择退货日期');
    if (!rec.orderNo) return bad('f_order', '请填写订单号');
    if (rec.qty < 1) return bad('f_qty', '退货数量必须 ≥ 1');
    if (!rec.supplier) return bad('f_supplier', '请填写供应商');
    if (insp === '不合格' && !rec.reasons.length) { LH.toast('请选择不合格原因'); openReason(); return; }

    if (editId) {
      var i = indexOf(returns, editId);
      returns[i] = rec;
      LH.toast('退货记录已更新');
    } else {
      returns.unshift(rec);
      LH.toast('退货登记成功');
    }
    save();
    resetForm();
    renderAll();
  }
  function indexOf(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }
  /** 校验失败：标红 + 聚焦 + 提示 */
  function bad(id, msg) {
    var el = LH.byId(id);
    if (el) {
      el.classList.add('invalid');
      setTimeout(function () { el.classList.remove('invalid'); }, 600);
      el.focus();
    }
    LH.toast(msg);
  }
  function resetForm() {
    editId = null;
    reasonSel = [];
    LH.byId('retForm').reset();
    LH.byId('f_date').value = LH.today();
    LH.byId('f_qty').value = 1;
    LH.byId('f_supplier').value = '东莞';
    LH.byId('f_model').value = Object.keys(MODEL_COLORS)[0];
    fillColors('f_');
    setSeg('f_volt', '220V');
    setSeg('f_insp', '缺料');
    LH.byId('issueWrap').style.display = 'none';
    renderReasonSum();
  }
  function editRecord(id) {
    var r = returns[indexOf(returns, id)];
    if (!r) return;
    editId = id;
    // 打开独立编辑弹窗（不再在登记表内联编辑）
    LH.byId('editFormTitle').textContent = '编辑退货记录（' + (r.orderNo || id.slice(0, 6)) + '）';
    LH.byId('e_date').value = r.date || '';
    LH.byId('e_order').value = r.orderNo || '';
    LH.byId('e_express').value = r.express || '';
    LH.byId('e_model').innerHTML = Object.keys(MODEL_COLORS).map(function (m) { return '<option>' + m + '</option>'; }).join('');
    // 先设型号再填颜色（否则颜色按第一个型号取，回填错误）
    LH.byId('e_model').value = r.model;
    fillColors('e_', r.color);
    setSeg('e_volt', r.volt || '220V');
    LH.byId('e_plug').value = r.plug || '国标';
    LH.byId('e_qty').value = r.qty;
    LH.byId('e_supplier').value = r.supplier || '';
    setSeg('e_insp', r.insp || '缺料');
    reasonSel = (r.insp === '不合格') ? (r.reasons || []).slice() : [];
    LH.byId('e_reason_extra').value = (r.insp === '不合格') ? (r.issue || '') : '';
    LH.byId('e_issueWrap').style.display = (r.insp === '不合格') ? '' : 'none';
    LH.byId('e_note').value = r.note || '';
    renderReasonSum();
    LH.openModal('editMask');
  }
  function saveEdit() {
    if (!editId) return;
    var insp = segVal('e_insp');
    var rec = {
      id: editId,
      date: LH.byId('e_date').value,
      orderNo: LH.byId('e_order').value.trim(),
      express: LH.byId('e_express').value.trim(),
      model: LH.byId('e_model').value,
      color: LH.byId('e_color').value,
      volt: segVal('e_volt'),
      plug: LH.byId('e_plug').value,
      qty: parseInt(LH.byId('e_qty').value, 10) || 0,
      supplier: LH.byId('e_supplier').value.trim(),
      insp: insp,
      reasons: insp === '不合格' ? reasonSel.slice() : [],
      issue: insp === '不合格' ? LH.byId('e_reason_extra').value.trim() : '',
      note: LH.byId('e_note').value.trim()
    };
    if (!rec.date) return bad('e_date', '请选择退货日期');
    if (!rec.orderNo) return bad('e_order', '请填写订单号');
    if (rec.qty < 1) return bad('e_qty', '退货数量必须 ≥ 1');
    if (!rec.supplier) return bad('e_supplier', '请填写供应商');
    if (insp === '不合格' && !rec.reasons.length) { LH.toast('请选择不合格原因'); openReason(); return; }
    var i = indexOf(returns, editId);
    if (i < 0) return;
    returns[i] = rec;
    save();
    editId = null;
    LH.closeModal('editMask');
    renderAll();
    LH.toast('已保存修改');
  }
  function closeEdit() { editId = null; LH.closeModal('editMask'); }
  function delRecord(id) {
    var r = returns[indexOf(returns, id)];
    if (!r) return;
    LH.confirm('确定删除该笔退货记录？\n' + (r.date || '') + ' ' + (r.model || '') + ' ' + (r.color || '') + ' ×' + r.qty + '\n关联的补发记录也会一并删除。', '确定删除')
      .then(function (ok) {
        if (!ok) return;
        returns = returns.filter(function (x) { return x.id !== id; });
        reps = reps.filter(function (x) { return x.returnId !== id; });
        save(); renderAll(); LH.toast('已删除');
      });
  }

  /* ---------- 不合格原因面板 ---------- */
  function renderReasonOpts() {
    LH.byId('reasonOpts').innerHTML = REASONS.map(function (x) {
      return '<label class="reason-item"><input type="checkbox" class="rck" value="' + LH.esc(x) + '"' +
        (reasonSel.indexOf(x) >= 0 ? ' checked' : '') + '> ' + LH.esc(x) + '</label>';
    }).join('');
  }
  function openReason() {
    renderReasonOpts();
    LH.byId('reasonMsg').style.display = 'none';
    LH.openModal('reasonMask');
  }
  function confirmReason() {
    var sel = LH.$$('#reasonOpts .rck:checked').map(function (c) { return c.value; });
    if (!sel.length) { LH.byId('reasonMsg').style.display = ''; return; }
    reasonSel = sel;
    renderReasonSum();
    LH.closeModal('reasonMask');
  }
  function renderReasonSum() {
    var el = LH.byId('reasonSum');
    if (!el) return;
    el.innerHTML = reasonSel.length
      ? reasonSel.map(function (x) { return '<span class="chip">' + LH.esc(x) + '</span>'; }).join('')
      : '<span style="color:var(--red);font-size:12.5px">尚未选择原因</span>';
  }

  /* ---------- 列表渲染 ---------- */
  function filteredReg() {
    var kw = LH.byId('q_kw').value.trim().toLowerCase();
    var insp = LH.byId('q_insp').value;
    var model = LH.byId('q_model').value;
    return returns.filter(function (r) {
      if (insp && r.insp !== insp) return false;
      if (model && r.model !== model) return false;
      if (kw) {
        var hay = [r.orderNo, r.model, r.color, r.supplier, r.express, r.note, reasonText(r), (r.reasons || []).join(' ')]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }
  function renderReg() {
    var list = filteredReg();
    var pg = LH.paginate(list, page.reg, PER);
    LH.byId('retBody').innerHTML = pg.rows.map(function (r) {
      var st = status(r);
      var pct = Math.min(100, Math.round(st.done / (Number(r.qty) || 1) * 100));
      // data-row + row-clickable 用于整行点击编辑
      return '<tr data-row="' + r.id + '" class="row-clickable">' +
        '<td data-label="退货日期" class="mono">' + LH.esc(r.date) + '</td>' +
        '<td data-label="订单号" class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td data-label="快递单号" class="td-muted">' + LH.esc(r.express || '—') + '</td>' +
        '<td data-label="型号" class="td-strong">' + LH.esc(r.model) + ' ' + LH.esc(r.color) + ' ' + LH.esc(r.volt) + ' ' + LH.esc(r.plug) + '</td>' +
        '<td data-label="数量" class="td-num">' + r.qty + '</td>' +
        '<td data-label="供应商" class="td-muted">' + LH.esc(r.supplier) + '</td>' +
        '<td data-label="检验">' + inspPill(r.insp) + '</td>' +
        '<td data-label="不合格原因" class="td-muted td-ellipsis" title="' + LH.esc(reasonText(r)) + '">' + LH.esc(reasonText(r)) + '</td>' +
        '<td data-label="补发进度" class="td-num">' + st.done + '/' + r.qty + ' <span class="td-muted" style="font-weight:500">(' + pct + '%)</span></td>' +
        '<td data-label="操作" class="td-act">' +
        '<button class="row-btn" data-edit="' + r.id + '" title="编辑">✏️</button>' +
        '<button class="row-btn del" data-del="' + r.id + '" title="删除">🗑</button>' +
        '</td></tr>';
    }).join('');
    bindRowButtons(LH.byId('retBody'));
    LH.showEmpty('retEmpty', null, pg.rows, { icon: '📦', title: '暂无退货记录', sub: '在上方登记一笔退货，或点击「载入示例」' });
    renderPager('retPager', pg, function (p) { page.reg = p; renderReg(); });
    var total = LH.sum(list, function (r) { return r.qty; });
    LH.byId('retCount').textContent = '共 ' + list.length + ' 笔 / ' + total + ' 台';
    LH.byId('retInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';
  }
  function bindRowButtons(tbody) {
    // 整行点击 = 进入编辑（更顺手的交互，✏️ 按钮仅作视觉提示）
    tbody.querySelectorAll('tr[data-row]').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        // 忽略行内按钮自身的 click（按钮自带 handler，避免重复触发）
        if (e.target.closest('.row-btn')) return;
        editRecord(tr.getAttribute('data-row'));
      });
      tr.style.cursor = 'pointer';
    });
    tbody.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); editRecord(b.getAttribute('data-edit')); });
    });
    tbody.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); delRecord(b.getAttribute('data-del')); });
    });
  }
  /** 通用分页器渲染 */
  function renderPager(id, pg, cb) {
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

  /* ================= 视图2：补发跟踪 ================= */
  function renderTrk() {
    var kw = LH.byId('q_trk').value.trim().toLowerCase();
    var sup = LH.byId('q_sup').value;
    var list = returns.filter(function (r) {
      var st = status(r);
      if (trkFilter && st.name !== trkFilter) return false;
      if (sup && r.supplier !== sup) return false;
      if (kw && (r.model + r.color + (r.orderNo || '')).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    var pg = LH.paginate(list, page.trk, PER);
    LH.byId('trkBody').innerHTML = pg.rows.map(function (r) {
      var st = status(r);
      var pct = Math.min(100, Math.round(st.done / (Number(r.qty) || 1) * 100));
      return '<tr>' +
        '<td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td>' + LH.esc(r.color) + '</td>' +
        '<td class="td-muted">' + LH.esc(r.supplier) + '</td>' +
        '<td class="td-num">' + r.qty + '</td>' +
        '<td class="td-num" style="color:var(--green)">' + st.done + '</td>' +
        '<td class="td-num" style="color:' + (st.left > 0 ? 'var(--red)' : 'var(--faint)') + '">' + st.left + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:60px;height:6px;border-radius:4px;background:var(--surface-2);overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--primary);border-radius:4px"></div></div><span class="mono" style="font-size:11.5px;color:var(--faint)">' + pct + '%</span></div></td>' +
        '<td><span class="pill ' + st.cls + '">' + st.name + '</span></td>' +
        '<td class="td-act">' +
        (st.left > 0 ? '<button class="btn green sm" data-rep="' + r.id + '">＋补发</button> ' : '') +
        '<button class="btn ghost sm" data-rep="' + r.id + '">明细</button>' +
        '</td></tr>';
    }).join('');
    LH.byId('trkBody').querySelectorAll('[data-rep]').forEach(function (b) {
      b.addEventListener('click', function () { openRep(b.getAttribute('data-rep')); });
    });
    LH.showEmpty('trkEmpty', null, pg.rows, { icon: '🚚', title: '暂无需要跟踪的记录', sub: '调整筛选条件，或先在退货登记中新增' });
    renderPager('trkPager', pg, function (p) { page.trk = p; renderTrk(); });
    LH.byId('trkCount').textContent = '共 ' + list.length + ' 笔';
    LH.byId('trkInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';
    renderTrkStats();
  }
  function renderTrkStats() {
    var due = 0, done = 0, noneed = 0;
    returns.forEach(function (r) {
      var st = status(r);
      due += st.left;
      if (st.name === '已补完') done++;
      if (st.name === '无需补发') noneed++;
    });
    var total = LH.sum(returns, function (r) { return r.qty; });
    var repped = LH.sum(reps, function (r) { return r.qty; });
    LH.byId('trkStats').innerHTML = [
      card('退货总数量', total, '台', 'ic-blue', '📦', '共 ' + returns.length + ' 笔记录'),
      card('供应商已补发', repped, '台', 'ic-green', '✅', '补发完成率 ' + (total ? Math.round(Math.min(repped, total) / total * 100) : 0) + '%'),
      card('待补发未结清', due, '台', 'ic-amber', '⏳', '需跟进处理的缺口'),
      card('无需补发', noneed, '笔', 'ic-teal', '✔️', '检验合格，默认不需补发')
    ].join('');
  }
  function card(label, val, unit, ic, ico, meta) {
    return '<div class="stat-card"><div class="stat-icon ' + ic + '">' + ico + '</div>' +
      '<div class="stat-main"><div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + LH.num(val) + '<span class="stat-unit">' + unit + '</span></div>' +
      '<div class="stat-meta">' + LH.esc(meta) + '</div></div></div>';
  }

  /* ---------- 补发弹窗 ---------- */
  function openRep(id) {
    repTarget = returns[indexOf(returns, id)];
    if (!repTarget) return;
    var st = status(repTarget);
    LH.byId('repTitle').textContent = st.left > 0 ? '补发登记' : '补发明细';
    LH.byId('repInfo').innerHTML = repTarget.insp === '合格'
      ? '<b>' + LH.esc(repTarget.model) + ' ' + LH.esc(repTarget.color) + '</b> ｜ 订单号 <b>' + LH.esc(repTarget.orderNo || '—') + '</b><br>检验<b style="color:var(--green)">合格</b>，无需补发（历史补发记录仅供查阅）'
      : '<b>' + LH.esc(repTarget.model) + ' ' + LH.esc(repTarget.color) + ' ' + LH.esc(repTarget.volt) + '</b> ｜ 订单号 <b>' + LH.esc(repTarget.orderNo || '—') + '</b><br>应补 <b>' + repTarget.qty + '</b> 台，已补 <b style="color:var(--green)">' + st.done + '</b> 台，未补 <b style="color:var(--red)">' + st.left + '</b> 台';
    LH.byId('r_date').value = LH.today();
    LH.byId('r_qty').value = Math.max(1, st.left);
    LH.byId('r_model').value = '';
    LH.byId('r_model').placeholder = '默认：' + repTarget.model;
    LH.byId('r_note').value = '';
    renderRepHist();
    LH.openModal('repMask');
  }
  function renderRepHist() {
    var list = reps.filter(function (r) { return r.returnId === repTarget.id; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    LH.byId('repHist').innerHTML = list.length
      ? '<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px">补发历史（' + list.length + ' 次）</div>' +
        '<div class="table-wrap" style="max-height:180px"><table class="rt"><thead><tr><th>补发日期</th><th>型号</th><th class="th-num">数量</th><th>备注</th><th class="th-act">操作</th></tr></thead><tbody>' +
        list.map(function (r) {
          return '<tr><td class="mono">' + LH.esc(r.date) + '</td><td>' + LH.esc(r.model) + '</td>' +
            '<td class="td-num">' + r.qty + '</td><td class="td-muted">' + LH.esc(r.note || '—') + '</td>' +
            '<td class="td-act"><button class="row-btn del" data-delrep="' + r.id + '">🗑</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div style="font-size:12.5px;color:var(--faint);margin-top:14px">暂无补发记录</div>';
    LH.byId('repHist').querySelectorAll('[data-delrep]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-delrep');
        reps = reps.filter(function (x) { return x.id !== id; });
        save(); renderRepHist(); renderAll();
        LH.toast('补发记录已删除');
      });
    });
  }
  function saveRep() {
    if (!repTarget) return;
    var qty = parseInt(LH.byId('r_qty').value, 10) || 0;
    if (!LH.byId('r_date').value) return LH.toast('请选择补发日期');
    if (qty < 1) return LH.toast('补发数量必须 ≥ 1');
    var st = status(repTarget);
    if (qty > st.left && !window.confirm('本次补发 ' + qty + ' 台，超出未补数量 ' + st.left + ' 台，确定继续？')) return;
    reps.push({
      id: LH.uid(), returnId: repTarget.id, date: LH.byId('r_date').value, qty: qty,
      model: LH.byId('r_model').value.trim() || repTarget.model, note: LH.byId('r_note').value.trim()
    });
    save();
    renderRepHist();
    renderAll();
    LH.toast('补发登记成功');
    var now = status(repTarget);
    if (now.left <= 0) LH.closeModal('repMask');
    else LH.byId('r_qty').value = now.left;
  }

  /* ================= 视图3：统计查询 ================= */
  function statList() {
    var f = LH.byId('s_from').value, t = LH.byId('s_to').value;
    var m = LH.byId('s_model').value, c = LH.byId('s_color').value, s = LH.byId('s_sup').value;
    return returns.filter(function (r) {
      if (f && r.date < f) return false;
      if (t && r.date > t) return false;
      if (m && r.model !== m) return false;
      if (c && r.color !== c) return false;
      if (s && r.supplier !== s) return false;
      return true;
    });
  }
  function renderSta() {
    var list = statList();
    var total = LH.sum(list, function (r) { return r.qty; });
    var bad = LH.sum(list.filter(function (r) { return r.insp === '不合格'; }), function (r) { return r.qty; });
    var repped = LH.sum(reps, function (r) { return r.qty; });
    var due = 0;
    list.forEach(function (r) { due += status(r).left; });

    LH.byId('staStats').innerHTML = [
      card('退货总数量', total, '台', 'ic-blue', '📦', list.length + ' 笔记录'),
      card('检验不合格', bad, '台', 'ic-red', '⚠️', '占比 ' + (total ? Math.round(bad / total * 100) : 0) + '%'),
      card('供应商已补发', repped, '台', 'ic-green', '✅', '补发完成率 ' + (total ? Math.round(Math.min(repped, total) / total * 100) : 0) + '%'),
      card('待补发未结清', due, '台', 'ic-amber', '⏳', '合格记录不计入')
    ].join('');

    // 明细
    var pg = LH.paginate(list, page.sta, PER);
    LH.byId('staBody').innerHTML = pg.rows.map(function (r) {
      var st = status(r);
      return '<tr><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td><td>' + LH.esc(r.color) + '</td>' +
        '<td class="td-muted">' + LH.esc(r.volt) + '</td><td class="td-num">' + r.qty + '</td>' +
        '<td class="td-muted">' + LH.esc(r.supplier) + '</td><td>' + inspPill(r.insp) + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(reasonText(r)) + '">' + LH.esc(reasonText(r)) + '</td>' +
        '<td><span class="pill ' + st.cls + '">' + st.name + '</span></td></tr>';
    }).join('');
    LH.showEmpty('staEmpty', null, pg.rows, { icon: '🔍', title: '无符合条件的记录', sub: '调整上方筛选条件试试' });
    renderPager('staPager', pg, function (p) { page.sta = p; renderSta(); });
    LH.byId('staCount').textContent = '共 ' + list.length + ' 笔';
    LH.byId('staInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';

    renderStaCharts(list);
  }
  /* 图表：型号汇总（柱+线）/ 原因分布（饼） */
  function renderStaCharts(list) {
    if (typeof echarts === 'undefined') return;
    // 型号维度
    var byModel = {};
    list.forEach(function (r) {
      byModel[r.model] = byModel[r.model] || { qty: 0, rep: 0, left: 0 };
      byModel[r.model].qty += Number(r.qty) || 0;
      byModel[r.model].rep += repQty(r.id);
      byModel[r.model].left += status(r).left;
    });
    var mKeys = Object.keys(byModel);
    var c1 = echarts.init(LH.byId('chartModel'));
    c1.setOption({
      grid: { left: 44, right: 16, top: 34, bottom: 26 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['退货数量', '已补发', '未结清'], right: 0, top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#67718A' } },
      xAxis: { type: 'category', data: mKeys, axisLine: { lineStyle: { color: '#E7EAF1' } }, axisLabel: { color: '#98A1B6', fontSize: 11 }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F1F3F8' } }, axisLabel: { color: '#98A1B6', fontSize: 11 } },
      series: [
        { name: '退货数量', type: 'bar', data: mKeys.map(function (k) { return byModel[k].qty; }), barMaxWidth: 20, itemStyle: { color: '#2447C9', borderRadius: [4, 4, 0, 0] } },
        { name: '已补发', type: 'bar', data: mKeys.map(function (k) { return byModel[k].rep; }), barMaxWidth: 20, itemStyle: { color: '#128A62', borderRadius: [4, 4, 0, 0] } },
        { name: '未结清', type: 'bar', data: mKeys.map(function (k) { return byModel[k].left; }), barMaxWidth: 20, itemStyle: { color: '#D5384C', borderRadius: [4, 4, 0, 0] } }
      ]
    });
    // 原因分布
    var rc = [];
    list.forEach(function (r) {
      if (r.insp !== '不合格') return;
      (r.reasons || []).forEach(function (x) { rc.push(x); });
    });
    var groups = LH.groupCount(rc, function (x) { return x; });
    var c2 = echarts.init(LH.byId('chartReason'));
    c2.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 笔 ({d}%)' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#67718A' } },
      series: [{
        type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
        data: groups.map(function (g, i) {
          return { name: g.key, value: g.count, itemStyle: { color: ['#2447C9', '#D5384C', '#B9770E', '#0E9888', '#6D4BD8'][i % 5] } };
        }),
        label: { fontSize: 11, color: '#67718A', formatter: '{b}\n{c}笔' },
        itemStyle: { borderColor: '#fff', borderWidth: 2 }
      }]
    });
    window.addEventListener('resize', function () { c1.resize(); c2.resize(); });
  }

  /* ================= 导入 / 导出 ================= */
  function exportCSV() {
    if (!returns.length) return LH.toast('没有数据可导出');
    var head = ['退货日期', '订单号', '快递单号', '型号', '颜色', '电压', '插头规格', '退货数量', '供应商',
      '检验情况', '不合格原因', '补充说明', '备注', '已补数量', '未补数量', '补发状态'];
    var rows = returns.map(function (r) {
      var st = status(r);
      return [r.date, r.orderNo || '', r.express || '', r.model, r.color, r.volt, r.plug, r.qty, r.supplier,
        r.insp, (r.reasons || []).join('、'), r.issue || '', r.note || '', st.done, st.left, st.name];
    });
    LH.exportCSV('熨斗退货台账_' + LH.today() + '.csv', head, rows);
  }
  function exportStaCSV() {
    var list = statList();
    if (!list.length) return LH.toast('当前筛选无数据');
    var head = ['退货日期', '订单号', '型号', '颜色', '电压', '数量', '供应商', '检验', '不合格原因', '补发状态'];
    LH.exportCSV('熨斗统计明细_' + LH.today() + '.csv', head, list.map(function (r) {
      var st = status(r);
      return [r.date, r.orderNo || '', r.model, r.color, r.volt, r.qty, r.supplier, r.insp, reasonText(r), st.name];
    }));
  }
  function backup() {
    var data = { app: 'ledger-hub-iron', version: 1, exportedAt: new Date().toISOString(), returns: returns, reps: reps };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = '熨斗台账备份_' + LH.today() + '.json';
    a.click();
    LH.toast('备份文件已下载');
  }

  /* ================= 示例数据 ================= */
  function seed() {
    var has = returns.length;
    LH.confirm(has ? '载入示例会追加到现有数据，继续？' : '将生成一批示例数据，确定载入？', '载入示例')
      .then(function (ok) {
        if (!ok) return;
        var s = LH.seed.iron();
        returns = s.returns.concat(returns);
        reps = s.reps.concat(reps);
        save(); renderAll();
        LH.toast('示例数据已载入');
      });
  }

  /* ================= 扫码（可选能力，依赖 zxing.min.js） ================= */
  var scanReader = null, scanControls = null, scanTimer = null;
  function openScan() {
    if (typeof ZXing === 'undefined' || !ZXing.BrowserMultiFormatReader) {
      // 懒加载解码库
      var s = document.createElement('script');
      s.src = '_shared/js/zxing.min.js';
      s.onload = function () { startScan(); };
      s.onerror = function () {
        LH.toast('扫码组件加载失败，请手动输入单号');
        LH.byId('f_express').focus();
      };
      document.head.appendChild(s);
    } else {
      startScan();
    }
    LH.openModal('scanMask');
  }

  /** 扫码：目标快递单号输入框 id 可变（编辑弹窗） */
  function openScan_e(targetId) {
    if (typeof ZXing === 'undefined' || !ZXing.BrowserMultiFormatReader) {
      var ss = document.createElement('script');
      ss.src = '_shared/js/zxing.min.js';
      ss.onload = function () { startScan_e(targetId); };
      ss.onerror = function () { LH.toast('扫码组件加载失败，请手动输入'); LH.byId(targetId).focus(); };
      document.head.appendChild(ss);
    } else {
      startScan_e(targetId);
    }
    LH.openModal('scanMask');
  }
  function startScan_e(targetId) {
    var tip = LH.byId('scanTip');
    tip.textContent = '正在打开摄像头……请将面单条形码对准取景框';
    tip.style.color = '';
    try {
      scanReader = new ZXing.BrowserMultiFormatReader();
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_93,
        ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      scanReader.hints = hints;
      scanReader.timeBetweenDecodingAttempts = 150;
      scanReader.decodeFromConstraints({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      }, 'scanVideo', function (result) {
        if (!result) return;
        var txt = (result.getText() || '').trim();
        if (!txt) return;
        LH.byId(targetId).value = txt;
        stopScan();
        LH.toast('已识别单号：' + txt);
        setTimeout(function () { LH.closeModal('scanMask'); }, 280);
      }).then(function (c) { scanControls = c; })
        .catch(function () {
          tip.textContent = '无法访问摄像头（可点「手动输入」）';
          tip.style.color = 'var(--red)';
        });
      clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        if (LH.byId('scanMask').classList.contains('open')) {
          LH.toast('长时间未识别，已自动关闭摄像头');
          LH.closeModal('scanMask');
        }
      }, 90000);
    } catch (e) {
      tip.textContent = '当前环境不支持扫码，请手动输入';
      tip.style.color = 'var(--red)';
    }
  }

  /** 扫码：目标快递单号输入框 id 可变（编辑弹窗） */
  function openScan_e(targetId) {
    if (typeof ZXing === 'undefined' || !ZXing.BrowserMultiFormatReader) {
      var ss = document.createElement('script');
      ss.src = '_shared/js/zxing.min.js';
      ss.onload = function () { startScan_e(targetId); };
      ss.onerror = function () { LH.toast('扫码组件加载失败，请手动输入'); LH.byId(targetId).focus(); };
      document.head.appendChild(ss);
    } else {
      startScan_e(targetId);
    }
    LH.openModal('scanMask');
  }
  function startScan_e(targetId) {
    var tip = LH.byId('scanTip');
    tip.textContent = '正在打开摄像头……请将面单条形码对准取景框';
    tip.style.color = '';
    try {
      scanReader = new ZXing.BrowserMultiFormatReader();
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_93,
        ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      scanReader.hints = hints;
      scanReader.timeBetweenDecodingAttempts = 150;
      scanReader.decodeFromConstraints({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      }, 'scanVideo', function (result) {
        if (!result) return;
        var txt = (result.getText() || '').trim();
        if (!txt) return;
        LH.byId(targetId).value = txt;
        stopScan();
        LH.toast('已识别单号：' + txt);
        setTimeout(function () { LH.closeModal('scanMask'); }, 280);
      }).then(function (c) { scanControls = c; })
        .catch(function (e) {
          tip.textContent = '无法访问摄像头（可点「手动输入」）';
          tip.style.color = 'var(--red)';
        });
      clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        if (LH.byId('scanMask').classList.contains('open')) {
          LH.toast('长时间未识别，已自动关闭摄像头');
          LH.closeModal('scanMask');
        }
      }, 90000);
    } catch (e) {
      tip.textContent = '当前环境不支持扫码，请手动输入';
      tip.style.color = 'var(--red)';
    }
  }
  function startScan() {
    var tip = LH.byId('scanTip');
    tip.textContent = '正在打开摄像头……请将面单条形码对准取景框';
    tip.style.color = '';
    if (location.protocol === 'file:') {
      tip.textContent = '提示：以 file:// 打开时部分浏览器会禁用摄像头，可手动输入或改用本地服务打开';
      tip.style.color = 'var(--amber)';
    }
    try {
      scanReader = new ZXing.BrowserMultiFormatReader();
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_93,
        ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.DATA_MATRIX
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      scanReader.hints = hints;
      scanReader.timeBetweenDecodingAttempts = 150;       // 降频解码，降低发热
      scanReader.decodeFromConstraints({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      }, 'scanVideo', function (result) {
        if (!result) return;
        var txt = (result.getText() || '').trim();
        if (!txt) return;
        LH.byId('f_express').value = txt;
        stopScan();
        LH.toast('已识别单号：' + txt);
        setTimeout(function () { LH.closeModal('scanMask'); }, 280);
      }).then(function (c) { scanControls = c; })
        .catch(function (e) {
          tip.textContent = '无法访问摄像头：' + (e && e.message ? e.message : e) + '（可点「手动输入」）';
          tip.style.color = 'var(--red)';
        });
      // 90 秒未识别自动关闭，避免发热
      clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        if (LH.byId('scanMask').classList.contains('open')) {
          LH.toast('长时间未识别，已自动关闭摄像头');
          LH.closeModal('scanMask');
        }
      }, 90000);
    } catch (e) {
      tip.textContent = '当前环境不支持扫码，请手动输入';
      tip.style.color = 'var(--red)';
    }
  }
  function stopScan() {
    try { if (scanControls) scanControls.stop(); } catch (e) { }
    try {
      var v = LH.byId('scanVideo');
      if (v && v.srcObject) { v.srcObject.getTracks().forEach(function (t) { t.stop(); }); v.srcObject = null; }
    } catch (e) { }
    scanControls = null;
    clearTimeout(scanTimer);
  }
  /** 拍照识别（静态帧兜底） */
  function scanShot() {
    var v = LH.byId('scanVideo');
    if (!scanReader || !v.videoWidth) return LH.toast('摄像头还未就绪');
    var c = LH.byId('scanCanvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    scanReader.decodeFromImage(c).then(function (res) {
      var txt = (res.getText() || '').trim();
      if (txt) {
        LH.byId('f_express').value = txt;
        stopScan();
        LH.toast('已识别单号：' + txt);
        setTimeout(function () { LH.closeModal('scanMask'); }, 280);
      } else {
        LH.toast('未识别，请调整角度或光线后重试');
      }
    }).catch(function () { LH.toast('未识别，请调整角度或光线后重试'); });
  }

  /* ================= 下拉选项刷新 ================= */
  function refreshOptions() {
    var models = unique(returns.map(function (r) { return r.model; })).sort();
    var colors = unique(returns.map(function (r) { return r.color; })).sort();
    var sups = unique(returns.map(function (r) { return r.supplier; })).sort();
    fillSelect('q_model', models, '全部型号');
    fillSelect('s_model', models, '全部');
    fillSelect('s_color', colors, '全部');
    fillSelect('s_sup', sups, '全部');
    fillSelect('q_sup', sups, '全部供应商');
    LH.byId('supList').innerHTML = sups.map(function (s) { return '<option value="' + LH.esc(s) + '">'; }).join('');
  }
  function unique(arr) {
    var s = {};
    arr.forEach(function (x) { if (x) s[x] = 1; });
    return Object.keys(s);
  }
  function fillSelect(id, arr, allText) {
    var el = LH.byId(id);
    if (!el) return;
    var cur = el.value;
    el.innerHTML = '<option value="">' + allText + '</option>' + arr.map(function (x) {
      return '<option value="' + LH.esc(x) + '">' + LH.esc(x) + '</option>';
    }).join('');
    el.value = cur;
  }

  /* ================= 统一渲染 ================= */
  function renderAll() {
    refreshOptions();
    renderReg();
    renderTrk();
    renderSta();
    var n = LH.byId('sfN'), due = LH.byId('sfDue');
    if (n) n.textContent = returns.length;
    var d = 0;
    returns.forEach(function (r) { d += status(r).left; });
    if (due) due.textContent = d;
  }

  /* ================= 初始化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    LH.shell.init({
      brand: '熨斗退货台账', brandSub: 'IRON RETURN LEDGER', brandIcon: '🔥',
      title: '退货登记', sub: '录入每笔退货熨斗的型号、颜色、电压与检验情况',
      current: 'vReg',
      nav: [
        { label: '工作台' },
        { id: 'vReg', name: '退货登记', short: '登记', ico: '📝' },
        { id: 'vTrk', name: '补发跟踪', short: '补发', ico: '🚚' },
        { id: 'vSta', name: '统计查询', short: '统计', ico: '📊' }
      ],
      onChange: function (id) {
        var meta = {
          vReg: ['退货登记', '录入每笔退货熨斗的型号、颜色、电压与检验情况'],
          vTrk: ['补发跟踪', '关联每笔退货，跟踪供应商补发进度与状态'],
          vSta: ['统计查询', '按型号 / 颜色 / 供应商 / 时间段汇总对账']
        }[id];
        if (meta) {
          LH.byId('pageTitle').textContent = meta[0];
          LH.byId('pageSub').textContent = meta[1];
        }
      }
    });

    initForm();
    resetForm();

    // 原因弹窗
    LH.byId('reasonOk').addEventListener('click', confirmReason);
    LH.byId('reasonCancel').addEventListener('click', function () { LH.closeModal('reasonMask'); });
    LH.byId('reasonClose').addEventListener('click', function () { LH.closeModal('reasonMask'); });
    LH.bindMaskClose('reasonMask');

    // 补发弹窗
    LH.byId('repSave').addEventListener('click', saveRep);
    LH.byId('repCancel').addEventListener('click', function () { LH.closeModal('repMask'); });
    LH.byId('repClose').addEventListener('click', function () { LH.closeModal('repMask'); });
    LH.bindMaskClose('repMask');

    // 扫码弹窗
    LH.byId('btnScan').addEventListener('click', openScan);
    LH.byId('scanShot').addEventListener('click', scanShot);
    LH.byId('scanManual').addEventListener('click', function () {
      LH.closeModal('scanMask');
      setTimeout(function () { LH.byId('f_express').focus(); }, 100);
    });
    LH.byId('scanCancel').addEventListener('click', function () { LH.closeModal('scanMask'); });
    LH.byId('scanClose').addEventListener('click', function () { LH.closeModal('scanMask'); });
    LH.bindMaskClose('scanMask');
    // 切后台自动关闭摄像头（防发热）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && LH.byId('scanMask').classList.contains('open')) {
        stopScan();
        LH.closeModal('scanMask');
        LH.toast('已切换到后台，摄像头已关闭');
      }
    });
    // 关闭弹窗时确保停止摄像头
    LH.byId('scanMask').addEventListener('transitionend', function () {
      if (!LH.byId('scanMask').classList.contains('open')) stopScan();
    });

    // 查询交互
    ['q_kw', 'q_insp', 'q_model'].forEach(function (id) {
      LH.byId(id).addEventListener('input', function () { page.reg = 1; renderReg(); });
      LH.byId(id).addEventListener('change', function () { page.reg = 1; renderReg(); });
    });
    LH.byId('q_trk').addEventListener('input', function () { page.trk = 1; renderTrk(); });
    LH.byId('q_sup').addEventListener('change', function () { page.trk = 1; renderTrk(); });
    LH.byId('trkSeg').querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        LH.byId('trkSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        trkFilter = b.getAttribute('data-v');
        page.trk = 1;
        renderTrk();
      });
    });
    ['s_from', 's_to', 's_model', 's_color', 's_sup'].forEach(function (id) {
      LH.byId(id).addEventListener('change', function () { page.sta = 1; renderSta(); });
    });
    LH.byId('btnResetSta').addEventListener('click', function () {
      ['s_from', 's_to'].forEach(function (i) { LH.byId(i).value = ''; });
      ['s_model', 's_color', 's_sup'].forEach(function (i) { LH.byId(i).value = ''; });
      page.sta = 1; renderSta();
    });

    // 导出 / 示例
    LH.byId('btnExport').addEventListener('click', exportCSV);
    LH.byId('btnExportSta').addEventListener('click', exportStaCSV);
    LH.byId('btnExportStaReg').addEventListener('click', exportStaCSV);
    LH.byId('btnWipeIron').addEventListener('click', function () {
      LH.confirm('将清空本机的熨斗退货与补发记录（不可恢复）。建议先导出 CSV 或备份 JSON，确定继续？', '确定清空')
        .then(function (ok) {
          if (!ok) return;
          LH.store.set(LH.KEYS.iron.returns, []);
          LH.store.set(LH.KEYS.iron.reps, []);
          LH.toast('已清空熨斗台账');
          renderAll();
        });
    });

    // 编辑弹窗绑定（在弹窗内修改记录）
    LH.byId('e_btnScan').addEventListener('click', function () { openScan_e('e_express'); });
    LH.byId('e_btnEditReason').addEventListener('click', openReason);
    bindSegPick('e_insp', function (v) {
      var show = (v === '不合格');
      LH.byId('e_issueWrap').style.display = show ? '' : 'none';
      if (show && !reasonSel.length) openReason();
      if (v === '合格') {
        var noteEl = LH.byId('e_note');
        if (noteEl && !noteEl.value.trim()) noteEl.value = '无理由';
      }
    });
    bindSegPick('e_volt');
    var em = LH.byId('e_model');
    if (em) em.addEventListener('change', function () { fillColors('e_'); });
    LH.byId('editSave').addEventListener('click', saveEdit);
    LH.byId('editCancel').addEventListener('click', closeEdit);
    LH.byId('editClose').addEventListener('click', closeEdit);
    LH.bindMaskClose('editMask');

    // 编辑弹窗绑定（在弹窗内修改记录）
    LH.byId('e_btnScan').addEventListener('click', function () { openScan_e('e_express'); });
    LH.byId('e_btnEditReason').addEventListener('click', openReason);
    bindSegPick('e_insp', function (v) {
      var show = (v === '不合格');
      LH.byId('e_issueWrap').style.display = show ? '' : 'none';
      if (show && !reasonSel.length) openReason();
      if (v === '合格') {
        var noteEl = LH.byId('e_note');
        if (noteEl && !noteEl.value.trim()) noteEl.value = '无理由';
      }
    });
    bindSegPick('e_volt');
    var em = LH.byId('e_model');
    if (em) em.addEventListener('change', function () { fillColors('e_'); });
    LH.byId('editSave').addEventListener('click', saveEdit);
    LH.byId('editCancel').addEventListener('click', closeEdit);
    LH.byId('editClose').addEventListener('click', closeEdit);
    LH.bindMaskClose('editMask');
    LH.byId('btnSeed').addEventListener('click', seed);
    LH.bindMaskClose('confirmMask');

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
