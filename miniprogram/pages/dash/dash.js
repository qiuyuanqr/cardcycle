const store = require('../../utils/store.js');

Page({
  data: {
    views: [], hasCards: false, urgentCount: 0, urgentSum: '0.00',
    repayShow: false, repayLabel: '', repayOwed: ''
  },

  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    this.S = S;
    this.setData(store.dashData(S));
  },

  goSwipe(e) {
    const id = e.currentTarget.dataset.id || '';
    wx.navigateTo({ url: '/pages/swipe/swipe' + (id ? '?cardId=' + id : '') });
  },
  goSettings() { wx.switchTab({ url: '/pages/settings/settings' }); },
  goDetail(e) {
    wx.navigateTo({ url: '/pages/cardtx/cardtx?id=' + e.currentTarget.dataset.id });
  },

  repay(e) {
    const id = e.currentTarget.dataset.id;
    const info = store.repayInfo(this.S, id);
    if (!info) return;
    this.repayCard = id;
    this.setData({ repayShow: true, repayLabel: info.label, repayOwed: info.owedText });
  },
  repayCancel() { this.setData({ repayShow: false }); },
  repayConfirm(e) {
    if (!store.applyRepay(this.S, this.repayCard, e.detail.amount)) return;
    this.setData({ repayShow: false });
    this.refresh();
  }
});
