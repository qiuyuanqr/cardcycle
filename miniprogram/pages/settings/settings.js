const store = require('../../utils/store.js');
const Core = store.Core;

const SORT_KEYS = ['smart', 'recent', 'custom'];
const STYLE_KEYS = ['chips', 'list'];

Page({
  data: {
    cards: [], terms: [], buffer: 3, minGap: 7, lastBackup: null, newTerm: '',
    sortNames: ['按紧急程度（默认）', '按最近变动', '自定义顺序'], sortIdx: 0, custom: false,
    styleNames: ['平铺按钮（默认）', '下拉列表'], styleIdx: 0
  },

  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    this.S = S;
    const mode = S.settings.cardSort || 'smart';
    // 自定义排序时按数组顺序显示（↑↓ 直接调数组），其余按账单日排
    const cardsSrc = mode === 'custom'
      ? S.cards.slice()
      : S.cards.slice().sort((a, b) => a.statementDay - b.statementDay);
    this.setData({
      cards: cardsSrc.map(c => {
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
      lastBackup: S.settings.lastBackup,
      sortIdx: Math.max(0, SORT_KEYS.indexOf(mode)),
      custom: mode === 'custom',
      styleIdx: Math.max(0, STYLE_KEYS.indexOf(S.settings.swipeStyle || 'chips'))
    });
  },

  /* ---- 卡 ---- */
  addCard() { wx.navigateTo({ url: '/pages/card/card' }); },
  goPos() { wx.navigateTo({ url: '/pages/pos/pos' }); },
  editCard(e) { wx.navigateTo({ url: '/pages/card/card?id=' + e.currentTarget.dataset.id }); },

  /* ---- 商户 ---- */
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
      title: '删除商户', content: '相关消费记录会保留，但不再显示商户名。',
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
  onSort(e) {
    const S = this.S;
    S.settings.cardSort = SORT_KEYS[+e.detail.value] || 'smart';
    store.save(S);
    this.refresh();
  },
  onStyle(e) {
    const S = this.S;
    S.settings.swipeStyle = STYLE_KEYS[+e.detail.value] || 'chips';
    store.save(S);
    this.refresh();
  },
  moveCard(e) {
    const { id, dir } = e.currentTarget.dataset;
    const S = this.S;
    const i = S.cards.findIndex(c => c.id === id);
    const j = i + (dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= S.cards.length) return;
    const t = S.cards[i]; S.cards[i] = S.cards[j]; S.cards[j] = t;
    store.save(S);
    this.refresh();
  },

  /* ---- 提醒：导出 .ics 文件 ---- */
  exportICS() {
    const S = this.S;
    if (!S.cards.length) { wx.showToast({ title: '还没有信用卡', icon: 'none' }); return; }
    const r = Core.buildICS(S.cards, S.people, S.settings, { months: 12 });
    const path = wx.env.USER_DATA_PATH + '/cardcycle.ics';
    // 同步写文件：shareFileMessage 必须留在点击事件的调用链里，
    // 放进异步回调会因“非用户触发”而失败（表现为一直「未发送」）。
    try { wx.getFileSystemManager().writeFileSync(path, r.text, 'utf8'); }
    catch (e) { wx.showToast({ title: '生成失败', icon: 'error' }); return; }
    wx.shareFileMessage({
      filePath: path, fileName: '卡周期提醒.ics',
      success: () => wx.showToast({ title: '已发送 ' + r.count + ' 条提醒', icon: 'success' }),
      fail: err => {
        if (err && /cancel/.test(err.errMsg || '')) return;   // 用户自己取消不算错
        wx.showModal({ title: '没有发出去', showCancel: false,
          content: '文件已生成但没能转发（' + ((err && err.errMsg) || '未知原因')
                 + '）。请再试一次。' });
      }
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
    const S = this.S;
    wx.showModal({
      title: '清空全部数据',
      content: '将删除本机的 ' + S.cards.length + ' 张信用卡、'
             + S.terminals.length + ' 个商户、' + S.txns.length
             + ' 条消费记录，无法恢复。建议先「复制备份」。确定清空？',
      confirmText: '清空', confirmColor: '#e0384a',
      success: r => {
        if (!r.confirm) return;
        wx.showModal({
          title: '再确认一次', content: '数据清空后无法找回，真的要清空？',
          confirmText: '清空', confirmColor: '#e0384a',
          success: r2 => {
            if (!r2.confirm) return;
            store.save(JSON.parse(JSON.stringify(store.DEF)));
            this.refresh();
            wx.showToast({ title: '已清空', icon: 'success' });
          }
        });
      }
    });
  }
});
