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

  del(e) {
    const { id, kind } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除',
      content: kind === 'pay'
        ? '删除这条还款记录？待还金额会相应增加。'
        : '删除这条消费记录？已登记的还款不受影响，待还金额会自动重算。',
      success: r => {
        if (!r.confirm) return;
        const S = this.S;
        if (kind === 'pay') S.payments = S.payments.filter(x => x.id !== id);
        else S.txns = S.txns.filter(x => x.id !== id);
        store.save(S);
        this.refresh();
      }
    });
  }
});
