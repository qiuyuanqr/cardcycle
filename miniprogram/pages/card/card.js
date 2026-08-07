const store = require('../../utils/store.js');
const Core = store.Core;

Page({
  data: {
    isEdit: false, bank: '', last4: '', stmt: '', buf: '3', limit: '',
    preview: '填好账单日和提前天数后，这里会显示提醒日。'
  },

  onLoad(q) {
    const S = store.load();
    this.S = S;
    this.id = q.id || null;
    if (this.id) {
      const c = store.cardById(S, this.id);
      if (c) {
        this.setData({
          isEdit: true, bank: c.bank,
          last4: c.last4 === '****' ? '' : c.last4,
          stmt: String(c.statementDay),
          buf: String(Core.bufOf(c, S.settings)),
          limit: c.limit ? String(c.limit) : ''
        });
        wx.setNavigationBarTitle({ title: '编辑信用卡' });
      }
    } else {
      this.setData({ buf: String(S.settings.buffer == null ? 3 : S.settings.buffer) });   // 0 是合法值
      wx.setNavigationBarTitle({ title: '添加信用卡' });
    }
    this.preview();
  },

  onBank(e) { this.setData({ bank: e.detail.value }); },
  onLast4(e) { this.setData({ last4: e.detail.value }); },
  onLimit(e) { this.setData({ limit: e.detail.value }); },
  onStmt(e) { this.setData({ stmt: e.detail.value }); this.preview(); },
  onBuf(e) { this.setData({ buf: e.detail.value }); this.preview(); },

  preview() {
    const s = +this.data.stmt, b = +this.data.buf;
    if (s >= 1 && s <= 31 && b >= 0) {
      const a = Core.nextStmt(s, Core.today());
      const d = Core.addD(a, -b);
      this.setData({
        preview: '下次提醒还款：' + Core.md(d) + '（账单日 ' + Core.md(a) + ' 前 ' + b + ' 天）'
      });
    } else {
      this.setData({ preview: '填好账单日和提前天数后，这里会显示提醒日。' });
    }
  },

  saveCard() {
    const d = this.data;
    const bank = (d.bank || '').trim();
    const stmt = +d.stmt, buf = +d.buf;
    if (!bank) { wx.showToast({ title: '请填银行名称', icon: 'none' }); return; }
    if (!(stmt >= 1 && stmt <= 31)) { wx.showToast({ title: '账单日填 1–31', icon: 'none' }); return; }
    if (!(buf >= 0 && buf <= 15)) { wx.showToast({ title: '提前天数填 0–15', icon: 'none' }); return; }
    // 整个变更（含 ensureMe 补默认持卡人）由 saveCardData 做成快照事务：
    // save 失败全部回滚，重试不会积累重复卡
    if (!store.saveCardData(this.S, this.id, {
      bank, last4: (d.last4 || '').trim() || '****',
      statementDay: stmt, buffer: buf, limit: +d.limit || 0
    })) return;
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },

  delCard() {
    const S = this.S;
    const n = S.txns.filter(t => t.cardId === this.id).length;
    const m = S.payments.filter(p => p.cardId === this.id).length;
    const what = [n ? n + ' 条消费' : '', m ? m + ' 条还款' : ''].filter(Boolean).join('、');
    wx.showModal({
      title: '删除这张卡',
      content: what ? '将同时删除它的 ' + what + '记录。' : '确定删除？',
      confirmColor: '#e0384a',
      success: r => {
        if (!r.confirm) return;
        // 消费和还款必须一起删：只删消费会留下孤儿还款，流水汇总会凭空多出存款
        const out = Core.removeCard(S.cards, S.txns, S.payments, this.id);
        S.cards = out.cards; S.txns = out.txns; S.payments = out.payments;
        store.save(S);
        wx.navigateBack();
      }
    });
  }
});
