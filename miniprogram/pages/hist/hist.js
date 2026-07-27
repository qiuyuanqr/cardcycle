const store = require('../../utils/store.js');
const Core = store.Core;

Page({
  data: {
    filterIdx: 0, filterNames: ['全部信用卡'], rows: [],
    stat: null
  },

  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    this.S = S;
    this.filterIds = [''].concat(S.cards.map(c => c.id));
    const names = ['全部信用卡'].concat(S.cards.map(c => store.cardLabel(c)));
    let idx = this.data.filterIdx;
    if (idx >= this.filterIds.length) idx = 0;
    this.setData({ filterNames: names, filterIdx: idx });
    this.build(idx);
  },

  build(idx) {
    const S = this.S;
    const fid = this.filterIds[idx] || '';
    const rows = S.txns
      .filter(t => !fid || t.cardId === fid)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map(t => {
        const c = store.cardById(S, t.cardId);
        const tm = store.termById(S, t.terminalId);
        return {
          id: t.id, date: t.date, amt: Core.money(t.amount), repaid: t.repaid,
          sub: [c ? store.cardLabel(c) : '已删除的卡',
                tm ? tm.name : '未记商户', t.note].filter(Boolean).join(' · ')
        };
      });
    const all = S.txns.filter(t => !fid || t.cardId === fid);
    const tot = all.reduce((s, t) => s + t.amount, 0);
    const un = all.filter(t => !t.repaid).reduce((s, t) => s + t.amount, 0);
    this.setData({
      rows,
      stat: rows.length
        ? { n: rows.length, tot: Core.money(tot), paid: Core.money(tot - un), un: Core.money(un) }
        : null
    });
  },

  onFilter(e) {
    const idx = +e.detail.value;
    this.setData({ filterIdx: idx });
    this.build(idx);
  },

  toggle(e) {
    const S = this.S;
    const t = S.txns.find(x => x.id === e.currentTarget.dataset.id);
    if (!t) return;
    t.repaid = !t.repaid;
    t.repaidDate = t.repaid ? Core.fd(Core.today()) : null;
    store.save(S);
    this.build(this.data.filterIdx);
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
        this.build(this.data.filterIdx);
      }
    });
  }
});
