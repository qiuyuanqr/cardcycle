const store = require('../../utils/store.js');
const Core = store.Core;

Page({
  data: {
    cards: [], terms: [], selCard: '', selTerm: '',
    amount: '', date: '', todayStr: '', note: '', warn: null,
    styleList: false, cardNames: [], cardIdx: 0, termNames: [], termIdx: 0,
    editing: false      // 带 txId 进来 = 修改已有的一笔（选错商户/记错金额后不必删了重记）
  },

  onLoad(q) {
    const S = store.load();
    this.S = S;
    if (!S.cards.length) {
      wx.showModal({
        title: '还没有信用卡', content: '请先到「设置」添加信用卡。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    const t = Core.fd(Core.today());
    const tx = q.txId ? store.txnForEdit(S, q.txId) : null;
    if (q.txId && !tx) {
      wx.showToast({ title: '这笔记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const selCard = tx ? tx.cardId
      : q.cardId && store.cardById(S, q.cardId) ? q.cardId : S.cards[0].id;
    this.txId = tx ? tx.id : null;
    this.setData({ date: tx ? tx.date : t, todayStr: t, editing: !!tx,
                   amount: tx ? String(tx.amount) : '', note: tx ? tx.note : '',
                   styleList: S.settings.swipeStyle === 'list' });
    if (tx) wx.setNavigationBarTitle({ title: '修改消费' });
    this.select(selCard, tx ? tx.terminalId : null);
  },

  // keepTerm：编辑时预选这笔原来的商户（新记一笔仍默认最闲置的那个）
  select(cardId, keepTerm) {
    const S = this.S;
    const opt = store.swipeOptions(S, cardId);
    let termIdx = keepTerm ? opt.terms.findIndex(t => t.id === keepTerm) : -1;
    if (termIdx < 0) termIdx = 0;
    this.setData({
      cards: opt.cards, terms: opt.terms, selCard: cardId,
      selTerm: opt.terms.length ? opt.terms[termIdx].id : '',
      cardNames: opt.cards.map(c => c.label + '（' + c.sub + '）'),
      cardIdx: Math.max(0, opt.cards.findIndex(c => c.id === cardId)),
      termNames: opt.terms.map(t => t.name + '（' + t.sub + '）'),
      termIdx,
      // 时段警告说的是「现在刷」；改一笔旧账不涉及现在刷不刷，不显示
      warn: this.data.editing ? null : store.swipeWarning(S, cardId)
    });
  },

  // 编辑时换卡不丢已选商户（用户多半只想改其中一项）；新记一笔仍默认最闲置的商户
  tapCard(e) { this.select(e.currentTarget.dataset.id, this.data.editing ? this.data.selTerm : null); },
  tapTerm(e) { this.setData({ selTerm: e.currentTarget.dataset.id }); },
  pickCard(e) { this.select(this.data.cards[+e.detail.value].id, this.data.editing ? this.data.selTerm : null); },
  pickTerm(e) {
    const i = +e.detail.value;
    this.setData({ termIdx: i, selTerm: this.data.terms[i].id });
  },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onDate(e) { this.setData({ date: e.detail.value }); },

  saveTx() {
    const d = this.data;
    // parseAmount 拦掉 Infinity（JSON 存完变 null、金额归零）和超两位小数（0.001 显示成 0.00）
    const amt = Core.parseAmount(d.amount);
    if (amt == null) { wx.showToast({ title: '金额不对：大于 0，最多两位小数', icon: 'none' }); return; }
    const doSave = () => {
      const S = this.S;
      if (this.txId) {
        if (!store.updateTxn(S, this.txId, { cardId: d.selCard, terminalId: d.selTerm,
              date: d.date || d.todayStr, amount: amt, note: d.note })) return;
        wx.showToast({ title: '已修改', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
        return;
      }
      S.txns.push({
        id: store.uid(), cardId: d.selCard, terminalId: d.selTerm,
        date: d.date || d.todayStr, amount: amt,
        note: (d.note || '').trim(), ts: Date.now()
      });
      if (!store.save(S)) {       // 存储读失败/写失败时，不能报「已记录」骗用户
        S.txns.pop();
        wx.showModal({ title: '没能保存', showCancel: false,
          content: '这笔消费没有写入本机存储，请退出小程序重新进入后再记一次。' });
        return;
      }
      wx.showToast({ title: '已记录', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    };
    if (d.date > d.todayStr) {
      wx.showModal({
        title: '日期确认', content: d.date + ' 是未来的日期，确定这样记录吗？',
        success: r => { if (r.confirm) doSave(); }
      });
    } else doSave();
  }
});
