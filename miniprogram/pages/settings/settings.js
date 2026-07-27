const store = require('../../utils/store.js');
const Core = store.Core;

Page({
  data: { cards: [], terms: [], buffer: 3, minGap: 7, lastBackup: null, newTerm: '' },

  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    this.S = S;
    this.setData({
      cards: S.cards.slice().sort((a, b) => a.statementDay - b.statementDay).map(c => {
        const buf = Core.bufOf(c, S.settings);
        const d = Core.addD(Core.nextStmt(c.statementDay, Core.today()), -buf);
        return {
          id: c.id, label: store.cardLabel(c),
          sub: '账单日 ' + c.statementDay + ' 号 → 提醒 ' + d.getDate() + ' 号（提前 ' + buf + ' 天）'
        };
      }),
      terms: S.terminals.map(t => ({
        id: t.id, name: t.name,
        sub: S.txns.filter(x => x.terminalId === t.id).length + ' 笔记录'
      })),
      buffer: S.settings.buffer || 3,
      minGap: S.settings.minGap || 7,
      lastBackup: S.settings.lastBackup
    });
  },

  /* ---- 卡 ---- */
  addCard() { wx.navigateTo({ url: '/pages/card/card' }); },
  goPos() { wx.navigateTo({ url: '/pages/pos/pos' }); },
  editCard(e) { wx.navigateTo({ url: '/pages/card/card?id=' + e.currentTarget.dataset.id }); },

  /* ---- 机器 ---- */
  onNewTerm(e) { this.setData({ newTerm: e.detail.value }); },
  addTerm() {
    const v = (this.data.newTerm || '').trim();
    if (!v) return;
    const S = this.S;
    S.terminals.push({ id: store.uid(), name: v, note: '' });
    store.save(S);
    this.setData({ newTerm: '' });
    this.refresh();
  },
  delTerm(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除机器', content: '相关刷卡记录会保留，但不再显示机器名。',
      success: r => {
        if (!r.confirm) return;
        const S = this.S;
        S.terminals = S.terminals.filter(t => t.id !== id);
        store.save(S); this.refresh();
      }
    });
  },

  /* ---- 参数 ---- */
  onBuffer(e) {
    const S = this.S;
    S.settings.buffer = Math.max(0, Math.min(10, +e.detail.value || 0));
    store.save(S);
  },
  onGap(e) {
    const S = this.S;
    S.settings.minGap = Math.max(0, Math.min(60, +e.detail.value || 0));
    store.save(S);
  },

  /* ---- 日历导出 ---- */
  exportICS() {
    const S = this.S;
    if (!S.cards.length) { wx.showToast({ title: '还没有信用卡', icon: 'none' }); return; }
    const r = Core.buildICS(S.cards, S.people, S.settings, { months: 12 });
    const path = wx.env.USER_DATA_PATH + '/cardcycle.ics';
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath: path, data: r.text, encoding: 'utf8',
      success: () => {
        wx.shareFileMessage({
          filePath: path, fileName: '卡周期提醒.ics',
          success: () => wx.showToast({ title: '已生成 ' + r.count + ' 条', icon: 'success' }),
          fail: () => wx.showToast({ title: '未发送', icon: 'none' })
        });
      },
      fail: () => wx.showToast({ title: '生成失败', icon: 'error' })
    });
  },

  /* ---- 备份 ---- */
  exportJSON() {
    const S = this.S;
    wx.setClipboardData({
      data: JSON.stringify(S),
      success: () => {
        S.settings.lastBackup = Core.fd(Core.today());
        store.save(S); this.refresh();
        wx.showModal({
          title: '已复制到剪贴板',
          content: '请立刻粘贴到备忘录、微信收藏或文件传输助手保存。',
          showCancel: false
        });
      }
    });
  },
  importJSON() {
    wx.getClipboardData({
      success: res => {
        let d;
        try { d = JSON.parse((res.data || '').trim()); }
        catch (e) { wx.showToast({ title: '剪贴板不是备份数据', icon: 'none' }); return; }
        if (!d || !Array.isArray(d.cards)) {
          wx.showToast({ title: '数据格式不对', icon: 'none' }); return;
        }
        wx.showModal({
          title: '导入备份',
          content: '将导入 ' + d.cards.length + ' 张卡、' + (d.txns || []).length
                 + ' 条记录，覆盖当前全部数据。确定？',
          success: r => {
            if (!r.confirm) return;
            const S = Object.assign(JSON.parse(JSON.stringify(store.DEF)), d);
            S.settings = Object.assign(JSON.parse(JSON.stringify(store.DEF.settings)), d.settings || {});
            store.save(S);
            this.refresh();
            wx.showToast({ title: '导入成功', icon: 'success' });
          }
        });
      }
    });
  },

  wipe() {
    wx.showModal({
      title: '清空全部数据', content: '无法恢复。确定？',
      confirmColor: '#e0384a',
      success: r => {
        if (!r.confirm) return;
        wx.showModal({
          title: '再确认一次', content: '真的要清空全部数据？',
          confirmColor: '#e0384a',
          success: r2 => {
            if (!r2.confirm) return;
            store.save(JSON.parse(JSON.stringify(store.DEF)));
            this.refresh();
          }
        });
      }
    });
  }
});
