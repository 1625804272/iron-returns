/* ==========================================================================
   seed.js · 共享示例数据生成器
   --------------------------------------------------------------------------
   主页的「载入示例数据」与各模块的「载入示例」共用同一套生成器，
   保证三模块演示数据风格一致、可复现，便于演示与功能验证。
   用法：LH.seed.iron() → { returns:[...], reps:[...] }
   ========================================================================== */
(function () {
  'use strict';

  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  /** n 天前的日期 */
  function ago(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ================= 熨斗退货台账 ================= */
  function iron() {
    var demo = [
      { date: ago(26), orderNo: 'DD202607001', express: 'SF7712001', model: 'M2', color: '红', volt: '220V', plug: '国标', qty: 5, supplier: '东莞', insp: '不合格', reasons: ['发热板脏污或划痕'], issue: '底板刮花', note: '客户要求换新' },
      { date: ago(22), orderNo: 'DD202607002', express: 'SF7712002', model: 'L2', color: '紫', volt: '110V', plug: '美规', qty: 3, supplier: '东莞', insp: '合格', reasons: [], issue: '', note: '仅退款，无需补发' },
      { date: ago(18), orderNo: 'DD202607003', express: '', model: 'L3', color: '绿', volt: '220V', plug: '欧规', qty: 2, supplier: '东莞', insp: '不合格', reasons: ['不通电'], issue: '通电无反应', note: '' },
      { date: ago(14), orderNo: 'DD202607004', express: 'SF7712004', model: 'L', color: '红', volt: '220V', plug: '国标', qty: 4, supplier: '东莞', insp: '缺料', reasons: [], issue: '', note: '待供应商补齐物料' },
      { date: ago(9),  orderNo: 'DD202608005', express: 'SF7712005', model: 'M2', color: '灰', volt: '110V', plug: '美规', qty: 6, supplier: '东莞', insp: '不合格', reasons: ['不加热', '屏幕不显示'], issue: '加热异常', note: '加急' },
      { date: ago(5),  orderNo: 'DD202608006', express: '', model: 'L', color: '绿', volt: '220V', plug: '英规', qty: 2, supplier: '东莞', insp: '合格', reasons: [], issue: '', note: '' },
      { date: ago(2),  orderNo: 'DD202608007', express: 'SF7712007', model: 'L2', color: '紫', volt: '220V', plug: '国标', qty: 3, supplier: '东莞', insp: '不合格', reasons: ['壳料破损脏污'], issue: '外壳压伤', note: '运输导致' }
    ].map(function (r) { r.id = uid(); return r; });

    // 补发记录：给两条不合格记录各补一部分
    var reps = [
      { id: uid(), returnId: demo[0].id, date: ago(20), qty: 2, model: 'M2', note: '顺丰 SF123456' },
      { id: uid(), returnId: demo[4].id, date: ago(6), qty: 6, model: 'M2', note: '已补完' }
    ];
    return { returns: demo, reps: reps };
  }

  /* ================= 喷头库存管理 ================= */
  function printhead() {
    var models = ['XP600', '3200', '1600', '3200U1', '3200八柱', 'DX7'].map(function (n, i) {
      return { id: 'phm' + i, name: n, threshold: 5, note: '' };
    });
    var inRecs = [
      { date: ago(30), orderNo: 'RK26072001', model: 'XP600', qty: 10, batch: 'B260720-01', supplier: '东莞', price: 1280, note: '主用型号备货' },
      { date: ago(26), orderNo: 'RK26072402', model: '3200', qty: 6, batch: 'B260724-02', supplier: '东莞', price: 980, note: '' },
      { date: ago(20), orderNo: 'RK26073003', model: '3200U1', qty: 4, batch: 'B260730-03', supplier: '深圳', price: 1100, note: '新批次' },
      { date: ago(15), orderNo: 'RK26080404', model: 'DX7', qty: 5, batch: 'B260804-04', supplier: '东莞', price: 860, note: '' },
      { date: ago(8),  orderNo: 'RK26081105', model: 'XP600', qty: 8, batch: 'B260811-05', supplier: '东莞', price: 1280, note: '紧急补货' },
      { date: ago(3),  orderNo: 'RK26081606', model: '1600', qty: 3, batch: 'B260816-06', supplier: '东莞', price: 720, note: '' }
    ].map(function (r) { r.id = uid(); return r; });

    var outRecs = [
      { date: ago(24), orderNo: 'CK26072601', model: 'XP600', qty: 3, user: '张三 / 生产部', purpose: '更换维修', note: '' },
      { date: ago(19), orderNo: 'CK26073102', model: '3200', qty: 2, user: '李四 / 售后部', purpose: '客户返修', note: '旧头回收' },
      { date: ago(12), orderNo: 'CK26080703', model: 'XP600', qty: 5, user: '王五 / 生产部', purpose: '装机', note: '' },
      { date: ago(6),  orderNo: 'CK26081304', model: 'DX7', qty: 2, user: '生产部', purpose: '更换维修', note: '' },
      { date: ago(1),  orderNo: 'CK26081805', model: '1600', qty: 1, user: '赵六 / 生产部', purpose: '试验', note: '测试用' }
    ].map(function (r) { r.id = uid(); return r; });

    return { models: models, inRecs: inRecs, outRecs: outRecs };
  }

  /* ================= 胸章退货台账 ================= */
  function badge() {
    var models = ['D58 圆形', 'D75 圆形', 'R60×90 方形', 'MAG 磁吸款', 'PIN 别针款', 'CUSTOM 异形'].map(function (n, i) {
      return { id: 'bgm' + i, name: n, note: '' };
    });
    var returns = [
      { date: ago(25), orderNo: 'XA26072501', express: 'YT8821001', customer: '广州印花纺织科技', model: 'D58 圆形', craft: '塑料', qty: 20, supplier: '东莞徽章厂', insp: '不合格', reasons: ['印刷模糊'], handle: '换新', issue: '图案偏色', note: '客户急单' },
      { date: ago(21), orderNo: 'XA26072902', express: '', customer: '义乌锦纶服饰制造', model: 'MAG 磁吸款', craft: '铁', qty: 12, supplier: '东莞徽章厂', insp: '合格', reasons: [], handle: '无需处理', issue: '', note: '仅退货退款' },
      { date: ago(17), orderNo: 'XA26080203', express: 'YT8821003', customer: '杭州数码印花厂', model: 'R60×90 方形', craft: '塑料', qty: 8, supplier: '温州工艺厂', insp: '不合格', reasons: ['边缘毛刺', '划痕脏污'], handle: '返修', issue: '边缘割手', note: '' },
      { date: ago(12), orderNo: 'XA26080704', express: '', customer: '苏州纺织印染集团', model: 'PIN 别针款', craft: '铁', qty: 15, supplier: '东莞徽章厂', insp: '不合格', reasons: ['别针松动'], handle: '换新', issue: '别针脱落', note: '批次问题' },
      { date: ago(7),  orderNo: 'XA26081205', express: 'YT8821005', customer: '中山大涌纺织制衣', model: 'D75 圆形', craft: '塑料', qty: 6, supplier: '东莞徽章厂', insp: '缺料', reasons: [], handle: '待定', issue: '', note: '等待物料' },
      { date: ago(3),  orderNo: 'XA26081606', express: 'YT8821006', customer: '福建长乐经编纺织', model: 'CUSTOM 异形', craft: '铁', qty: 10, supplier: '温州工艺厂', insp: '不合格', reasons: ['颜色偏差'], handle: '换新', issue: '与色卡偏差大', note: '' }
    ].map(function (r) { r.id = uid(); return r; });

    // 换新记录
    var reps = [
      { id: uid(), returnId: returns[0].id, date: ago(18), qty: 20, model: 'D58 圆形', note: '已换新寄出' },
      { id: uid(), returnId: returns[3].id, date: ago(8), qty: 6, model: 'PIN 别针款', note: '分批换新' }
    ];
    return { models: models, returns: returns, reps: reps };
  }

  window.LH = window.LH || {};
  window.LH.seed = { iron: iron, printhead: printhead, badge: badge, ago: ago };
})();
