/* ==========================================================================
   badge.js · 胸章退货台账业务逻辑
   --------------------------------------------------------------------------
   模块： 退货登记（客户/型号/工艺/检验/不合格原因/处理方式/备注）
          换新跟踪（换新登记，合格或无需处理视为无需换新）
          统计查询（时间/型号/客户/处理方式筛选 + 图表 + 明细）
          型号管理（胸章型号增删改）
   数据： localStorage（LH.KEYS.badge），全程离线
   ========================================================================== */
(function () {
  'use strict';

  var K = LH.KEYS.badge;
  var REASONS = ['印刷模糊', '边缘毛刺', '别针松动', '颜色偏差', '尺寸不符', '划痕脏污'];
  var HANDLES = ['换新', '返修', '退货退款', '无需处理', '待定'];
  var MATERIALS = ['塑料', '铁'];
  var PRESET_MODELS = ['D58 圆形', 'D75 圆形', 'R60×90 方形', 'MAG 磁吸款', 'PIN 别针款', 'CUSTOM 异形'];

  /* ---------- 状态 ---------- */
  var models = LH.store.get(K.models, null);
  if (!models) {
    models = PRESET_MODELS.map(function (n) {
      return { id: 'bgm_' + LH.uid(), name: n, note: '' };
    });
    LH.store.set(K.models, models);
  }
  var returns = LH.store.get(K.returns, []);
  var reps = LH.store.get(K.reps, []);

  var editId = null;
  var reasonSel = [];
  var repTarget = null;
  var trkFilter = '';
  var page = { reg: 1, trk: 1, sta: 1 };
  var PER = 12;

  function save() {
    LH.store.set(K.returns, returns);
    LH.store.set(K.reps, reps);
    if (window.LH.cloudUI) LH.cloudUI.changed();   // 触发云端防抖推送
  }

  /* ================= 云端同步：数据适配 ================= */
  var CLOUD_PATH = 'data/badge.json';
  function cloudIsEmpty() { return returns.length === 0 && reps.length === 0; }
  function cloudPayload() {
    return {
      app: 'ledger-hub-badge', version: 1, savedAt: new Date().toISOString(),
      models: models, returns: returns, reps: reps
    };
  }
  /** 合并云端数据（记录按 id 去重、型号按名称，本机优先），返回导入描述 */
  function cloudApply(data) {
    var n0 = returns.length;
    if ((data.models || []).length) {
      var byName = {};
      (data.models || []).concat(models).forEach(function (m) { byName[m.name] = m; });
      models = Object.keys(byName).map(function (k) { return byName[k]; });
      LH.store.set(K.models, models);
    }
    var m1 = {};
    (data.reps || []).concat(reps).forEach(function (r) { m1[r.id] = r; });
    reps = Object.keys(m1).map(function (k) { return m1[k]; });
    var m2 = {};
    (data.returns || []).concat(returns).forEach(function (r) { m2[r.id] = r; });
    returns = Object.keys(m2).map(function (k) { return m2[k]; });
    save();
    return '退货 ' + returns.length + ' 笔（新增 ' + (returns.length - n0) + '）';
  }

  /* ================= 计算：换新状态 ================= */
  function repQty(retId) {
    return LH.sum(reps.filter(function (r) { return r.returnId === retId; }), function (r) { return r.qty; });
  }
  /** 合格 或 无需处理 → 无需换新 */
  function status(r) {
    var qty = Number(r.qty) || 0;
    if (r.insp === '合格' || r.handle === '无需处理') {
      return { name: '无需换新', cls: 'st-done', done: qty, left: 0 };
    }
    var done = repQty(r.id);
    var left = Math.max(0, qty - done);
    if (done <= 0) return { name: '待换新', cls: 'st-wait', done: 0, left: qty };
    if (done < qty) return { name: '部分换新', cls: 'st-proc', done: done, left: left };
    return { name: '已换新', cls: 'st-done', done: done, left: 0 };
  }
  function inspPill(insp) {
    if (insp === '合格') return '<span class="pill st-done">合格</span>';
    if (insp === '不合格') return '<span class="pill st-reject">不合格</span>';
    return '<span class="pill st-wait">缺料</span>';
  }
  function handlePill(h) {
    var map = {
      '换新': 'st-proc', '返修': 'st-wait', '退货退款': 'st-teal',
      '无需处理': 'st-neutral', '待定': 'st-violet'
    };
    return '<span class="pill ' + (map[h] || 'st-neutral') + '">' + LH.esc(h || '—') + '</span>';
  }
  function reasonText(r) {
    var parts = [];
    if ((r.reasons || []).length) parts.push(r.reasons.join('、'));
    if (r.issue) parts.push(r.issue);
    return parts.join('；') || '—';
  }
  function idxOf(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }

  /* ================= 下拉选项 ================= */
  function refreshOptions() {
    var names = unique(returns.map(function (r) { return r.model; })
      .concat(models.map(function (m) { return m.name; }))).sort();
    var custs = unique(returns.map(function (r) { return r.customer; })).sort();
    var sups = unique(returns.map(function (r) { return r.supplier; })).sort();

    fillSel('f_model', names.map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join(''));
    fillSel('q_model', names.map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join(''), '全部型号');
    fillSel('s_model', names.map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join(''), '全部');
    fillSel('s_customer', custs.map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join(''), '全部');
    fillSel('s_handle', HANDLES.map(function (n) { return '<option>' + LH.esc(n) + '</option>'; }).join(''), '全部');
    LH.byId('custList').innerHTML = custs.map(function (s) { return '<option value="' + LH.esc(s) + '">'; }).join('');
    LH.byId('supList').innerHTML = sups.map(function (s) { return '<option value="' + LH.esc(s) + '">'; }).join('');
  }
  function fillSel(id, opts, allText) {
    var el = LH.byId(id);
    if (!el) return;
    var cur = el.value;
    el.innerHTML = (allText ? '<option value="">' + allText + '</option>' : '') + opts;
    if (cur) el.value = cur;
  }
  function unique(arr) {
    var s = {};
    arr.forEach(function (x) { if (x) s[x] = 1; });
    return Object.keys(s);
  }

  /* ================= 表单 ================= */
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
  function bad(id, msg) {
    var el = LH.byId(id);
    if (el) { el.classList.add('invalid'); setTimeout(function () { el.classList.remove('invalid'); }, 600); el.focus(); }
    LH.toast(msg);
  }

  /* ================= 扫码（识别快递单号） ================= */
  var scanReader = null, scanControls = null, scanTimer = null;
  function openScan() {
    if (typeof ZXing === 'undefined' || !ZXing.BrowserMultiFormatReader) {
      var s = document.createElement('script');
      s.src = 'shared/js/zxing.min.js';
      s.onload = function () { startScan(); };
      s.onerror = function () { LH.toast('扫码组件加载失败，请手动输入'); LH.byId('f_express').focus(); };
      document.head.appendChild(s);
    } else {
      startScan();
    }
    LH.openModal('scanMask');
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
      scanReader.timeBetweenDecodingAttempts = 150;
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
      } else { LH.toast('未识别，请调整角度或光线后重试'); }
    }).catch(function () { LH.toast('未识别，请调整角度或光线后重试'); });
  }

  function resetForm() {
    editId = null;
    reasonSel = [];
    LH.byId('formTitle').textContent = '新增退货登记';
    LH.byId('btnSave').textContent = '保存登记';
    var br = LH.byId('btnReset');
    if (br) { br.textContent = '清空'; br.classList.remove('danger-soft'); }
    LH.byId('retForm').reset();
    LH.byId('f_date').value = LH.today();
    LH.byId('f_qty').value = 1;
    LH.byId('f_supplier').value = '东莞徽章厂';
    LH.byId('f_craft').value = MATERIALS[0];
    LH.byId('f_handle').value = HANDLES[0];
    setSeg('f_insp', '缺料');
    LH.byId('issueWrap').style.display = 'none';
    renderReasonSum();
  }
  function saveRecord() {
    var insp = segVal('f_insp');
    var rec = {
      id: editId || LH.uid(),
      date: LH.byId('f_date').value,
      orderNo: LH.byId('f_order').value.trim(),
      express: LH.byId('f_express').value.trim(),
      customer: LH.byId('f_customer').value.trim(),
      model: LH.byId('f_model').value,
      craft: LH.byId('f_craft').value,
      qty: parseInt(LH.byId('f_qty').value, 10) || 0,
      supplier: LH.byId('f_supplier').value.trim(),
      insp: insp,
      reasons: insp === '不合格' ? reasonSel.slice() : [],
      issue: insp === '不合格' ? LH.byId('f_reason_extra').value.trim() : '',
      handle: LH.byId('f_handle').value,
      note: LH.byId('f_note').value.trim()
    };
    if (!rec.date) return bad('f_date', '请选择退货日期');
    if (!rec.orderNo) return bad('f_order', '请填写订单号');
    if (!rec.customer) return bad('f_customer', '请填写客户 / 来源');
    if (!rec.model) return bad('f_model', '请选择型号');
    if (rec.qty < 1) return bad('f_qty', '数量必须 ≥ 1');
    if (!rec.supplier) return bad('f_supplier', '请填写供应商 / 生产方');
    if (insp === '不合格' && !rec.reasons.length) { LH.toast('请选择不合格原因'); openReason(); return; }

    if (editId) { returns[idxOf(returns, editId)] = rec; LH.toast('退货记录已更新'); }
    else { returns.unshift(rec); LH.toast('退货登记成功'); }
    save(); resetForm(); renderAll();
  }
  function editRecord(id) {
    var r = returns[idxOf(returns, id)];
    if (!r) return;
    editId = id;
    LH.byId('formTitle').textContent = '编辑退货记录（' + (r.orderNo || id.slice(0, 6)) + '）';
    LH.byId('btnSave').textContent = '保存修改';
    var br = LH.byId('btnReset');
    if (br) { br.textContent = '取消编辑'; br.classList.add('danger-soft'); }
    LH.byId('f_date').value = r.date || '';
    LH.byId('f_order').value = r.orderNo || '';
    LH.byId('f_express').value = r.express || '';
    LH.byId('f_customer').value = r.customer || '';
    LH.byId('f_model').value = r.model || '';
    LH.byId('f_craft').value = r.craft || MATERIALS[0];
    LH.byId('f_qty').value = r.qty;
    LH.byId('f_supplier').value = r.supplier || '';
    setSeg('f_insp', r.insp || '缺料');
    reasonSel = (r.insp === '不合格') ? (r.reasons || []).slice() : [];
    LH.byId('f_reason_extra').value = (r.insp === '不合格') ? (r.issue || '') : '';
    LH.byId('issueWrap').style.display = (r.insp === '不合格') ? '' : 'none';
    LH.byId('f_handle').value = r.handle || HANDLES[0];
    LH.byId('f_note').value = r.note || '';
    renderReasonSum();
    LH.shell.switchView('vReg');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function delRecord(id) {
    var r = returns[idxOf(returns, id)];
    if (!r) return;
    LH.confirm('确定删除该笔退货记录？\n' + (r.date || '') + ' ' + (r.customer || '') + ' ' + (r.model || '') + ' ×' + r.qty + '\n关联的换新记录也会一并删除。', '确定删除')
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

  /* ================= 列表 ================= */
  function filteredReg() {
    var kw = LH.byId('q_kw').value.trim().toLowerCase();
    var insp = LH.byId('q_insp').value;
    var model = LH.byId('q_model').value;
    return returns.filter(function (r) {
      if (insp && r.insp !== insp) return false;
      if (model && r.model !== model) return false;
      if (kw) {
        var hay = [r.orderNo, r.customer, r.model, r.craft, r.supplier, r.note, reasonText(r)].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }
  function renderReg() {
    var list = filteredReg();
    var pg = LH.paginate(list, page.reg, PER);
    LH.byId('retBody').innerHTML = pg.rows.map(function (r) {
      return '<tr data-row="' + r.id + '"><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-strong td-ellipsis" title="' + LH.esc(r.customer) + '">' + LH.esc(r.customer || '—') + '</td>' +
        '<td>' + LH.esc(r.model) + '</td>' +
        '<td class="td-muted">' + LH.esc(r.craft || '—') + '</td>' +
        '<td class="td-num">' + r.qty + '</td>' +
        '<td class="td-muted">' + LH.esc(r.supplier) + '</td>' +
        '<td>' + inspPill(r.insp) + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(reasonText(r)) + '">' + LH.esc(reasonText(r)) + '</td>' +
        '<td>' + handlePill(r.handle) + '</td>' +
        '<td class="td-act"><button class="row-btn" data-edit="' + r.id + '">✏️</button>' +
        '<button class="row-btn del" data-del="' + r.id + '">🗑</button></td></tr>';
    }).join('');
    var tb = LH.byId('retBody');
    // 行点击直接进入编辑（电脑/手机更便捷）
    tb.querySelectorAll('tr[data-row]').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('.row-btn')) return;
        editRecord(tr.getAttribute('data-row'));
      });
    });
    tb.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); editRecord(b.getAttribute('data-edit')); });
    });
    tb.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); delRecord(b.getAttribute('data-del')); });
    });
    LH.showEmpty('retEmpty', null, pg.rows, { icon: '🎖️', title: '暂无退货记录', sub: '在上方登记一笔退货，或点击「载入示例」' });
    pager('retPager', pg, function (p) { page.reg = p; renderReg(); });
    LH.byId('retCount').textContent = '共 ' + list.length + ' 笔 / ' + LH.sum(list, function (r) { return r.qty; }) + ' 件';
    LH.byId('retInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';
  }

  /* ================= 换新跟踪 ================= */
  function renderTrk() {
    var kw = LH.byId('q_trk').value.trim().toLowerCase();
    var list = returns.filter(function (r) {
      var st = status(r);
      if (trkFilter && st.name !== trkFilter) return false;
      if (kw && (r.model + (r.customer || '') + (r.orderNo || '')).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    var pg = LH.paginate(list, page.trk, PER);
    LH.byId('trkBody').innerHTML = pg.rows.map(function (r) {
      var st = status(r);
      var pct = Math.min(100, Math.round(st.done / (Number(r.qty) || 1) * 100));
      return '<tr><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-ellipsis" title="' + LH.esc(r.customer) + '">' + LH.esc(r.customer || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td class="td-num">' + r.qty + '</td>' +
        '<td class="td-num" style="color:var(--green)">' + st.done + '</td>' +
        '<td class="td-num" style="color:' + (st.left > 0 ? 'var(--red)' : 'var(--faint)') + '">' + st.left + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:56px;height:6px;border-radius:4px;background:var(--surface-2);overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--violet);border-radius:4px"></div></div><span class="mono" style="font-size:11.5px;color:var(--faint)">' + pct + '%</span></div></td>' +
        '<td><span class="pill ' + st.cls + '">' + st.name + '</span></td>' +
        '<td class="td-act">' +
        (st.left > 0 ? '<button class="btn green sm" data-rep="' + r.id + '">＋换新</button> ' : '') +
        '<button class="btn ghost sm" data-rep="' + r.id + '">明细</button></td></tr>';
    }).join('');
    LH.byId('trkBody').querySelectorAll('[data-rep]').forEach(function (b) {
      b.addEventListener('click', function () { openRep(b.getAttribute('data-rep')); });
    });
    LH.showEmpty('trkEmpty', null, pg.rows, { icon: '🔁', title: '暂无需要跟踪的记录', sub: '调整筛选条件，或先在退货登记中新增' });
    pager('trkPager', pg, function (p) { page.trk = p; renderTrk(); });
    LH.byId('trkCount').textContent = '共 ' + list.length + ' 笔';
    LH.byId('trkInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';
    renderTrkStats();
  }
  function renderTrkStats() {
    var due = 0, done = 0, noneed = 0;
    returns.forEach(function (r) {
      var st = status(r);
      due += st.left;
      if (st.name === '已换新') done++;
      if (st.name === '无需换新') noneed++;
    });
    var total = LH.sum(returns, function (r) { return r.qty; });
    var repped = LH.sum(reps, function (r) { return r.qty; });
    LH.byId('trkStats').innerHTML = [
      card('退货总数量', total, '件', 'ic-violet', '🎖️', returns.length + ' 笔记录'),
      card('已换新', repped, '件', 'ic-green', '✅', '换新完成率 ' + (total ? Math.round(Math.min(repped, total) / total * 100) : 0) + '%'),
      card('待换新未结清', due, '件', 'ic-amber', '⏳', '需跟进处理的缺口'),
      card('无需换新', noneed, '笔', 'ic-teal', '✔️', '合格 / 无需处理')
    ].join('');
  }
  function card(label, val, unit, ic, ico, meta) {
    return '<div class="stat-card"><div class="stat-icon ' + ic + '">' + ico + '</div>' +
      '<div class="stat-main"><div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + LH.num(val) + '<span class="stat-unit">' + unit + '</span></div>' +
      '<div class="stat-meta">' + LH.esc(meta) + '</div></div></div>';
  }

  /* ---------- 换新弹窗 ---------- */
  function openRep(id) {
    repTarget = returns[idxOf(returns, id)];
    if (!repTarget) return;
    var st = status(repTarget);
    var noneed = (repTarget.insp === '合格' || repTarget.handle === '无需处理');
    LH.byId('repTitle').textContent = st.left > 0 ? '换新登记' : '换新明细';
    LH.byId('repInfo').innerHTML = noneed
      ? '<b>' + LH.esc(repTarget.model) + '</b> ｜ 客户 <b>' + LH.esc(repTarget.customer || '—') + '</b><br>' +
        '检验<b style="color:var(--green)">合格</b> / 处理方式「' + LH.esc(repTarget.handle) + '」，无需换新（历史记录仅供查阅）'
      : '<b>' + LH.esc(repTarget.model) + '</b> ｜ 客户 <b>' + LH.esc(repTarget.customer || '—') + '</b> ｜ 处理 <b>' + LH.esc(repTarget.handle || '—') + '</b><br>' +
        '应换 <b>' + repTarget.qty + '</b> 件，已换 <b style="color:var(--green)">' + st.done + '</b> 件，未换 <b style="color:var(--red)">' + st.left + '</b> 件';
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
      ? '<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px">换新历史（' + list.length + ' 次）</div>' +
        '<div class="table-wrap" style="max-height:180px"><table class="rt"><thead><tr><th>换新日期</th><th>型号</th><th class="th-num">数量</th><th>备注</th><th class="th-act">操作</th></tr></thead><tbody>' +
        list.map(function (r) {
          return '<tr><td class="mono">' + LH.esc(r.date) + '</td><td>' + LH.esc(r.model) + '</td>' +
            '<td class="td-num">' + r.qty + '</td><td class="td-muted">' + LH.esc(r.note || '—') + '</td>' +
            '<td class="td-act"><button class="row-btn del" data-delrep="' + r.id + '">🗑</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div style="font-size:12.5px;color:var(--faint);margin-top:14px">暂无换新记录</div>';
    LH.byId('repHist').querySelectorAll('[data-delrep]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-delrep');
        reps = reps.filter(function (x) { return x.id !== id; });
        save(); renderRepHist(); renderAll(); LH.toast('换新记录已删除');
      });
    });
  }
  function saveRep() {
    if (!repTarget) return;
    var qty = parseInt(LH.byId('r_qty').value, 10) || 0;
    if (!LH.byId('r_date').value) return LH.toast('请选择换新日期');
    if (qty < 1) return LH.toast('换新数量必须 ≥ 1');
    var st = status(repTarget);
    if (qty > st.left && !window.confirm('本次换新 ' + qty + ' 件，超出未换数量 ' + st.left + ' 件，确定继续？')) return;
    reps.push({
      id: LH.uid(), returnId: repTarget.id, date: LH.byId('r_date').value, qty: qty,
      model: LH.byId('r_model').value.trim() || repTarget.model, note: LH.byId('r_note').value.trim()
    });
    save(); renderRepHist(); renderAll(); LH.toast('换新登记成功');
    var now = status(repTarget);
    if (now.left <= 0) LH.closeModal('repMask');
    else LH.byId('r_qty').value = now.left;
  }

  /* ================= 统计查询 ================= */
  function statList() {
    var f = LH.byId('s_from').value, t = LH.byId('s_to').value;
    var m = LH.byId('s_model').value, c = LH.byId('s_customer').value, h = LH.byId('s_handle').value;
    return returns.filter(function (r) {
      if (f && r.date < f) return false;
      if (t && r.date > t) return false;
      if (m && r.model !== m) return false;
      if (c && r.customer !== c) return false;
      if (h && r.handle !== h) return false;
      return true;
    });
  }
  function renderSta() {
    var list = statList();
    var total = LH.sum(list, function (r) { return r.qty; });
    var badQty = LH.sum(list.filter(function (r) { return r.insp === '不合格'; }), function (r) { return r.qty; });
    var repped = LH.sum(reps, function (r) { return r.qty; });
    var due = 0;
    list.forEach(function (r) { due += status(r).left; });

    LH.byId('staStats').innerHTML = [
      card('退货总数量', total, '件', 'ic-violet', '🎖️', list.length + ' 笔记录'),
      card('检验不合格', badQty, '件', 'ic-red', '⚠️', '占比 ' + (total ? Math.round(badQty / total * 100) : 0) + '%'),
      card('已换新', repped, '件', 'ic-green', '✅', '换新完成率 ' + (total ? Math.round(Math.min(repped, total) / total * 100) : 0) + '%'),
      card('待换新未结清', due, '件', 'ic-amber', '⏳', '合格 / 无需处理不计入')
    ].join('');

    var pg = LH.paginate(list, page.sta, PER);
    LH.byId('staBody').innerHTML = pg.rows.map(function (r) {
      var st = status(r);
      return '<tr><td class="mono">' + LH.esc(r.date) + '</td>' +
        '<td class="td-no">' + LH.esc(r.orderNo || '—') + '</td>' +
        '<td class="td-ellipsis" title="' + LH.esc(r.customer) + '">' + LH.esc(r.customer || '—') + '</td>' +
        '<td class="td-strong">' + LH.esc(r.model) + '</td>' +
        '<td class="td-muted">' + LH.esc(r.craft || '—') + '</td>' +
        '<td class="td-num">' + r.qty + '</td>' +
        '<td>' + inspPill(r.insp) + '</td>' +
        '<td class="td-muted td-ellipsis" title="' + LH.esc(reasonText(r)) + '">' + LH.esc(reasonText(r)) + '</td>' +
        '<td>' + handlePill(r.handle) + '</td>' +
        '<td><span class="pill ' + st.cls + '">' + st.name + '</span></td></tr>';
    }).join('');
    LH.showEmpty('staEmpty', null, pg.rows, { icon: '🔍', title: '无符合条件的记录', sub: '调整上方筛选条件试试' });
    pager('staPager', pg, function (p) { page.sta = p; renderSta(); });
    LH.byId('staCount').textContent = '共 ' + list.length + ' 笔';
    LH.byId('staInfo').textContent = '共 ' + pg.total + ' 笔，第 ' + pg.page + '/' + pg.pages + ' 页';

    renderCharts(list);
  }
  function renderCharts(list) {
    if (typeof echarts === 'undefined') return;
    // 型号分布（横向柱）
    var g1 = LH.groupCount(list, function (r) { return r.model; });
    var c1 = echarts.init(LH.byId('chartModel'));
    c1.setOption({
      grid: { left: 8, right: 20, top: 14, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#F1F3F8' } }, axisLabel: { color: '#98A1B6', fontSize: 11 } },
      yAxis: { type: 'category', data: g1.map(function (g) { return g.key; }), axisLine: { lineStyle: { color: '#E7EAF1' } }, axisLabel: { color: '#67718A', fontSize: 11.5 }, axisTick: { show: false } },
      series: [{
        type: 'bar', data: g1.map(function (g) { return g.count; }), barMaxWidth: 16,
        itemStyle: { color: '#6D4BD8', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 11, color: '#67718A' }
      }]
    });
    // 原因分布（环形）
    var rc = [];
    list.forEach(function (r) {
      if (r.insp !== '不合格') return;
      (r.reasons || []).forEach(function (x) { rc.push(x); });
    });
    var g2 = LH.groupCount(rc, function (x) { return x; });
    var c2 = echarts.init(LH.byId('chartReason'));
    c2.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 笔 ({d}%)' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#67718A' } },
      series: [{
        type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
        data: g2.map(function (g, i) {
          return {
            name: g.key, value: g.count,
            itemStyle: { color: ['#6D4BD8', '#2447C9', '#0E9888', '#B9770E', '#D5384C', '#98A1B6'][i % 6] }
          };
        }),
        label: { fontSize: 11, color: '#67718A', formatter: '{b}\n{c}笔' },
        itemStyle: { borderColor: '#fff', borderWidth: 2 }
      }]
    });
    window.addEventListener('resize', function () { c1.resize(); c2.resize(); });
  }

  /* ================= 型号管理 ================= */
  function resetModelForm() {
    editId = null;
    LH.byId('modelFormTitle').textContent = '新增胸章型号';
    LH.byId('modelSave').textContent = '新增型号';
    LH.byId('modelForm').reset();
  }
  var modelEditId = null;
  function saveModel() {
    var name = LH.byId('m_name').value.trim();
    if (!name) return bad('m_name', '请填写型号名称');
    if (modelEditId) {
      var m = models[idxOf(models, modelEditId)];
      if (m) { m.name = name; m.note = LH.byId('m_note').value.trim(); }
      LH.toast('型号已更新');
    } else {
      if (models.some(function (x) { return x.name === name; })) return bad('m_name', '该型号已存在');
      models.push({ id: LH.uid(), name: name, note: LH.byId('m_note').value.trim() });
      LH.toast('型号已新增');
    }
    LH.store.set(K.models, models);
    resetModelForm(); renderAll();
  }
  function editModel(id) {
    var m = models[idxOf(models, id)];
    if (!m) return;
    modelEditId = id;
    LH.byId('modelFormTitle').textContent = '编辑型号';
    LH.byId('modelSave').textContent = '保存修改';
    LH.byId('m_name').value = m.name;
    LH.byId('m_note').value = m.note || '';
    LH.shell.switchView('vModel');
  }
  function delModel(id) {
    var m = models[idxOf(models, id)];
    if (!m) return;
    var used = returns.some(function (r) { return r.model === m.name; });
    LH.confirm('确定删除型号「' + m.name + '」？' + (used ? '该型号存在退货记录，删除后记录仍保留（不再出现在下拉选项）。' : ''), '确定删除')
      .then(function (ok) {
        if (!ok) return;
        models = models.filter(function (x) { return x.id !== id; });
        LH.store.set(K.models, models);
        renderAll(); LH.toast('型号已删除');
      });
  }
  function renderModels() {
    LH.byId('modelBody').innerHTML = models.map(function (m) {
      var rs = returns.filter(function (r) { return r.model === m.name; });
      return '<tr><td class="td-strong">' + LH.esc(m.name) + '</td>' +
        '<td class="td-num">' + rs.length + '</td>' +
        '<td class="td-num">' + LH.sum(rs, function (r) { return r.qty; }) + '</td>' +
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
    LH.showEmpty('modelEmpty', null, models, { icon: '🏷️', title: '暂无型号', sub: '在上方添加胸章型号' });
    LH.byId('modelCount').textContent = '共 ' + models.length + ' 个';
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

  /* ================= 导入导出 ================= */
  function exportCSV() {
    if (!returns.length) return LH.toast('没有数据可导出');
    LH.exportCSV('胸章退货台账_' + LH.today() + '.csv',
      ['退货日期', '订单号', '快递单号', '客户/来源', '型号', '工艺', '数量', '供应商',
        '检验情况', '不合格原因', '补充说明', '处理方式', '备注', '已换数量', '未换数量', '换新状态'],
      returns.map(function (r) {
        var st = status(r);
        return [r.date, r.orderNo || '', r.express || '', r.customer || '', r.model, r.craft || '', r.qty, r.supplier,
          r.insp, (r.reasons || []).join('、'), r.issue || '', r.handle || '', r.note || '', st.done, st.left, st.name];
      }));
  }
  function exportStaCSV() {
    var list = statList();
    if (!list.length) return LH.toast('当前筛选无数据');
    LH.exportCSV('胸章统计明细_' + LH.today() + '.csv',
      ['退货日期', '订单号', '客户', '型号', '工艺', '数量', '检验', '不合格原因', '处理方式', '换新状态'],
      list.map(function (r) {
        var st = status(r);
        return [r.date, r.orderNo || '', r.customer || '', r.model, r.craft || '', r.qty, r.insp, reasonText(r), r.handle || '', st.name];
      }));
  }
  function backup() {
    var data = { app: 'ledger-hub-badge', version: 1, exportedAt: new Date().toISOString(), models: models, returns: returns, reps: reps };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = '胸章台账备份_' + LH.today() + '.json';
    a.click();
    LH.toast('备份文件已下载');
  }

  /* ================= 示例数据 ================= */
  function seed() {
    var has = returns.length;
    LH.confirm(has ? '载入示例会追加到现有数据，继续？' : '将生成一批示例数据，确定载入？', '载入示例')
      .then(function (ok) {
        if (!ok) return;
        var s = LH.seed.badge();
        s.models.forEach(function (m) {
          if (!models.some(function (x) { return x.name === m.name; })) models.push(m);
        });
        returns = s.returns.concat(returns);
        reps = s.reps.concat(reps);
        LH.store.set(K.models, models);
        save(); renderAll();
        LH.toast('示例数据已载入');
      });
  }

  /* ================= 统一渲染 ================= */
  function renderAll() {
    refreshOptions();
    renderReg();
    renderTrk();
    renderSta();
    renderModels();
    var n = LH.byId('sfN'), due = LH.byId('sfDue');
    if (n) n.textContent = returns.length;
    var d = 0;
    returns.forEach(function (r) { d += status(r).left; });
    if (due) due.textContent = d;
  }

  /* ================= 初始化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    LH.shell.init({
      brand: '胸章退货台账', brandSub: 'BADGE RETURN LEDGER', brandIcon: '🎖️',
      title: '退货登记', sub: '录入每笔胸章退货的客户、型号、工艺与检验情况',
      current: 'vReg',
      nav: [
        { label: '工作台' },
        { id: 'vReg', name: '退货登记', short: '登记', ico: '📝' },
        { id: 'vTrk', name: '换新跟踪', short: '换新', ico: '🔁' },
        { id: 'vSta', name: '统计查询', short: '统计', ico: '📊' },
        { id: 'vModel', name: '型号管理', short: '型号', ico: '🏷️' }
      ],
      onChange: function (id) {
        var meta = {
          vReg: ['退货登记', '录入每笔胸章退货的客户、型号、工艺与检验情况'],
          vTrk: ['换新跟踪', '关联每笔退货，跟踪换新与返修进度'],
          vSta: ['统计查询', '按型号 / 客户 / 处理方式 / 时间段汇总分析'],
          vModel: ['型号管理', '维护胸章型号']
        }[id];
        if (meta) { LH.byId('pageTitle').textContent = meta[0]; LH.byId('pageSub').textContent = meta[1]; }
      }
    });

    // 表单
    LH.byId('retForm').addEventListener('submit', function (e) { e.preventDefault(); saveRecord(); });
    LH.byId('btnReset').addEventListener('click', resetForm);
    bindSegPick('f_insp', function (v) {
      var show = (v === '不合格');
      LH.byId('issueWrap').style.display = show ? '' : 'none';
      if (show && !reasonSel.length) openReason();
      // 选「合格」且备注为空时自动填默认备注「无理由」（与熨斗一致）
      if (v === '合格') {
        var noteEl = LH.byId('f_note');
        if (noteEl && !noteEl.value.trim()) noteEl.value = '无理由';
      }
    });
    LH.byId('f_craft').innerHTML = MATERIALS.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    LH.byId('f_handle').innerHTML = HANDLES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    LH.byId('btnEditReason').addEventListener('click', openReason);

    // 原因弹窗
    LH.byId('reasonOk').addEventListener('click', confirmReason);
    LH.byId('reasonCancel').addEventListener('click', function () { LH.closeModal('reasonMask'); });
    LH.byId('reasonClose').addEventListener('click', function () { LH.closeModal('reasonMask'); });
    LH.bindMaskClose('reasonMask');

    // 换新弹窗
    LH.byId('repSave').addEventListener('click', saveRep);
    LH.byId('repCancel').addEventListener('click', function () { LH.closeModal('repMask'); });
    LH.byId('repClose').addEventListener('click', function () { LH.closeModal('repMask'); });
    LH.bindMaskClose('repMask');

    // 扫码弹窗（识别快递单号）
    LH.byId('btnScan').addEventListener('click', openScan);
    LH.byId('scanShot').addEventListener('click', scanShot);
    LH.byId('scanManual').addEventListener('click', function () {
      LH.closeModal('scanMask');
      setTimeout(function () { LH.byId('f_express').focus(); }, 100);
    });
    LH.byId('scanCancel').addEventListener('click', function () { LH.closeModal('scanMask'); });
    LH.byId('scanClose').addEventListener('click', function () { LH.closeModal('scanMask'); });
    LH.bindMaskClose('scanMask');
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && LH.byId('scanMask').classList.contains('open')) {
        stopScan(); LH.closeModal('scanMask');
      }
    });
    LH.byId('scanMask').addEventListener('transitionend', function () {
      if (!LH.byId('scanMask').classList.contains('open')) stopScan();
    });

    // 筛选
    ['q_kw', 'q_insp', 'q_model'].forEach(function (id) {
      LH.byId(id).addEventListener('input', function () { page.reg = 1; renderReg(); });
      LH.byId(id).addEventListener('change', function () { page.reg = 1; renderReg(); });
    });
    LH.byId('q_trk').addEventListener('input', function () { page.trk = 1; renderTrk(); });
    LH.byId('trkSeg').querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        LH.byId('trkSeg').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        trkFilter = b.getAttribute('data-v');
        page.trk = 1; renderTrk();
      });
    });
    ['s_from', 's_to', 's_model', 's_customer', 's_handle'].forEach(function (id) {
      LH.byId(id).addEventListener('change', function () { page.sta = 1; renderSta(); });
    });
    LH.byId('btnResetSta').addEventListener('click', function () {
      ['s_from', 's_to'].forEach(function (i) { LH.byId(i).value = ''; });
      ['s_model', 's_customer', 's_handle'].forEach(function (i) { LH.byId(i).value = ''; });
      page.sta = 1; renderSta();
    });

    // 型号表单
    LH.byId('modelForm').addEventListener('submit', function (e) { e.preventDefault(); saveModel(); });
    LH.byId('modelReset').addEventListener('click', resetModelForm);

    // 导出 / 示例
    LH.byId('btnExport').addEventListener('click', exportCSV);
    LH.byId('btnExportSta').addEventListener('click', exportStaCSV);
    LH.byId('btnBackup').addEventListener('click', backup);
    LH.byId('btnSeed').addEventListener('click', seed);
    LH.bindMaskClose('confirmMask');

    resetForm();
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
