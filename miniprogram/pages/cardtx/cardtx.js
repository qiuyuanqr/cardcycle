const store = require('../../utils/store.js');

Page({
  data: { v: null, rows: [], stat: null },

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

  repay() { store.promptRepay(this.S, this.id, () => this.refresh()); },
  goSwipe() { wx.navigateTo({ url: '/pages/swipe/swipe?cardId=' + this.id }); },

  toggle(e) {
    const S = this.S;
    const t = S.txns.find(x => x.id === e.currentTarget.dataset.id);
    if (!t) return;
    t.repaid = !t.repaid;
    t.repaidDate = t.repaid ? store.Core.fd(store.Core.today()) : null;
    store.save(S);
    this.refresh();
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除', content: '删除这条刷卡记录？',
      success: r => {
        if (!r.confirm) return;
        const S = this.S;
        S.txns = S.txns.filter(x => x.id !== id);
        store.save(S);
        this.refresh();
      }
    });
  }
});
