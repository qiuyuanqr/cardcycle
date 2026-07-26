const store = require('../../utils/store.js');
const Core = store.Core;

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
  goHist() { wx.switchTab({ url: '/pages/hist/hist' }); },

  repay(e) {
    const id = e.currentTarget.dataset.id;
    const S = this.S;
    const c = store.cardById(S, id);
    const k = Core.calc(c, S.txns, S.settings);
    const n = S.txns.filter(t => t.cardId === id && !t.repaid).length;
    wx.showModal({
      title: '登记还款',
      content: store.cardLabel(c) + ' 待还 ¥' + Core.money(k.cur + k.over)
             + '（' + n + ' 笔）。全部标记为已还？逐笔操作请到「流水」。',
      confirmText: '全部已还',
      success: r => {
        if (!r.confirm) return;
        const d = Core.fd(Core.today());
        S.txns.filter(t => t.cardId === id && !t.repaid)
              .forEach(t => { t.repaid = true; t.repaidDate = d; });
        store.save(S);
        this.refresh();
        wx.showToast({ title: '已登记', icon: 'success' });
      }
    });
  }
});
