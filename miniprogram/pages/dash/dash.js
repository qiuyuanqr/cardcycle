const store = require('../../utils/store.js');

Page({
  data: { views: [], hasCards: false, urgentCount: 0, urgentSum: '0.00' },

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
    store.promptRepay(this.S, e.currentTarget.dataset.id, () => this.refresh());
  }
});
