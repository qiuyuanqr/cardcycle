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
    const cardSub = c => c ? store.cardLabel(c) : '已删除的卡';
    const txs = S.txns.filter(t => !fid || t.cardId === fid);
    const pays = S.payments.filter(p => !fid || p.cardId === fid);
    const rows = txs.map(t => {
        const tm = store.termById(S, t.terminalId);
        return { kind: 'tx', id: t.id, date: t.date, amt: Core.money(t.amount),
                 sub: [cardSub(store.cardById(S, t.cardId)),
                       tm ? tm.name : '未记商户', t.note].filter(Boolean).join(' · ') };
      })
      .concat(pays.map(p => ({ kind: 'pay', id: p.id, date: p.date,
                               amt: Core.money(p.amount),
                               sub: cardSub(store.cardById(S, p.cardId)) })))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const tot = txs.reduce((s, t) => s + t.amount, 0);
    const paid = pays.reduce((s, p) => s + p.amount, 0);
    const owe = Math.max(0, Math.round((tot - paid) * 100) / 100);
    const extra = Math.max(0, Math.round((paid - tot) * 100) / 100);
    this.setData({
      rows,
      stat: rows.length
        ? { n: txs.length, tot: Core.money(tot), paid: Core.money(paid),
            un: Core.money(owe), extra: extra > 0 ? Core.money(extra) : '' }
        : null
    });
  },

  onFilter(e) {
    const idx = +e.detail.value;
    this.setData({ filterIdx: idx });
    this.build(idx);
  },

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
        this.build(this.data.filterIdx);
      }
    });
  }
});
