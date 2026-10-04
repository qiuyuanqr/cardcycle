const store = require('../../utils/store.js');

Page({
  data: {
    v: null, rows: [], stat: null,
    repayShow: false, repayLabel: '', repayOwed: ''
  },

  onLoad(q) { this.id = q.id; },
  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    this.S = S;
    const d = store.cardTxData(S, this.id);
    if (!d) { wx.navigateBack(); return; }
    wx.setNavigationBarTitle({ title: d.v.label });
    this.setData(d);
  },

  repay() {
    const info = store.repayInfo(this.S, this.id);
    if (!info) return;
    this.setData({ repayShow: true, repayLabel: info.label, repayOwed: info.owedText });
  },
  repayCancel() { this.setData({ repayShow: false }); },
  repayConfirm(e) {
    if (!store.applyRepay(this.S, this.id, e.detail.amount)) return;
    this.setData({ repayShow: false });
    this.refresh();
  },
  goSwipe() { wx.navigateTo({ url: '/pages/swipe/swipe?cardId=' + this.id }); },
  // 银行名/后四位/账单日录错了，在这张卡自己的页面上就能改，不用绕回设置页找
  goEdit() { wx.navigateTo({ url: '/pages/card/card?id=' + this.id }); },

  // 刷完选错商户、记错金额或日期：进记消费页改这一笔，不必删了重记
  edit(e) { wx.navigateTo({ url: '/pages/swipe/swipe?txId=' + e.currentTarget.dataset.id }); },

  del(e) {
    const { id, kind } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除',
      content: kind === 'pay'
        ? '删除这条还款记录？待还金额会相应增加。'
        : '删除这条消费记录？已登记的还款不受影响，待还金额会自动重算。',
      success: r => {
        if (!r.confirm) return;
        store.deleteRecord(this.S, kind, id);   // 失败已回滚并提示；refresh 重读盘
        this.refresh();
      }
    });
  }
});
