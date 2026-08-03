const store = require('../../utils/store.js');
const Core = store.Core;

const SORT_KEYS = ['smart', 'recent', 'custom'];
const STYLE_KEYS = ['chips', 'list'];

Page({
  data: {
    cards: [], terms: [], buffer: 3, minGap: 7, lastBackup: null, newTerm: '',
    sortNames: ['按紧急程度（默认）', '按最近变动', '自定义顺序'], sortIdx: 0, custom: false,
    styleNames: ['平铺按钮（默认）', '下拉列表'], styleIdx: 0,
    env: null
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
      buffer: S.settings.buffer == null ? 3 : S.settings.buffer,   // 0 是合法值，别被 || 吞掉
      minGap: S.settings.minGap == null ? 7 : S.settings.minGap,
      lastBackup: S.settings.lastBackup,
      env: store.storageEnv(S),
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
  // 这两个输入没有「保存」按钮，失焦即存——必须把最终存了什么反馈出来：
  // 清空/乱填 → 恢复原值不写盘（以前会静默存成 0）；超范围 → 按上限存并说明；
  // 写盘失败 → 回滚，不让界面显示一个没存进去的值
  onBuffer(e) { this.saveParam(e, 'buffer', 15, 3, '提前天数'); },
  onGap(e) { this.saveParam(e, 'minGap', 60, 7, '间隔'); },
  saveParam(e, key, max, dft, label) {
    const S = this.S;
    const old = S.settings[key] == null ? dft : S.settings[key];
    const raw = String(e.detail.value == null ? '' : e.detail.value).trim();
    const n = raw === '' ? NaN : Math.floor(Number(raw));
    if (!(n >= 0)) {
      this.setData({ [key]: old });
      wx.showToast({ title: '没改，' + label + '仍为 ' + old + ' 天', icon: 'none' });
      return;
    }
    const v = Math.min(max, n);
    if (v === old) { this.setData({ [key]: v }); return; }   // 值没变就别打扰
    S.settings[key] = v;
    if (!store.save(S)) {
      S.settings[key] = old;
      this.setData({ [key]: old });
      wx.showToast({ title: '没能保存，请重进小程序再试', icon: 'none' });
      return;
    }
    this.setData({ [key]: v });
    if (v < n) wx.showToast({ title: label + '最多 ' + max + ' 天，已按 ' + max + ' 保存', icon: 'none' });
    else wx.showToast({ title: '已保存 ' + v + ' 天', icon: 'success' });
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
    if (S.readFailed) {   // 读不到数据时导出的是空壳，会把好备份覆盖掉
      wx.showModal({ title: '现在不能备份', showCancel: false,
        content: '这次没能读出本机数据，导出的会是空的。请退出小程序重新进入后再备份。' });
      return;
    }
    const text = JSON.stringify(S);
    const kb = (text.length / 1024).toFixed(1);
    wx.setClipboardData({
      data: text,
      success: () => {
        S.settings.lastBackup = Core.fd(Core.today());
        store.save(S); this.refresh();
        wx.showModal({
          title: '已复制到剪贴板',
          content: '这份备份约 ' + kb + ' KB（' + S.txns.length + ' 笔消费、'
                 + S.payments.length + ' 笔还款都在里面）。\n'
                 + '请立刻粘贴到备忘录、微信收藏或文件传输助手保存——'
                 + '粘完请确认结尾是「}」，中间被截断的备份是恢复不了的。',
          showCancel: false
        });
      },
      // 剪贴板放不下或被系统拒绝时必须说话，否则用户以为备份好了，其实什么都没存
      fail: err => wx.showModal({
        title: '没能复制', showCancel: false,
        content: '备份没有放进剪贴板（' + ((err && err.errMsg) || '未知原因') + '）。'
               + '这份数据约 ' + kb + ' KB，可能太大了。请改用「导出备份文件」。'
      })
    });
  },
  /* 备份成文件转发到聊天：数据攒多了剪贴板未必装得下，文件这条路更稳，
     也方便存进「文件传输助手」长期留底。 */
  exportFile() {
    const S = this.S;
    if (S.readFailed) {
      wx.showModal({ title: '现在不能备份', showCancel: false,
        content: '这次没能读出本机数据，导出的会是空的。请退出小程序重新进入后再备份。' });
      return;
    }
    const name = '卡周期备份-' + Core.fd(Core.today()) + '.txt';
    const path = wx.env.USER_DATA_PATH + '/' + name;
    // 同步写文件：shareFileMessage 必须留在点击事件的调用链里，
    // 放进异步回调会因“非用户触发”而静默失败（表现为一直「未发送」）。
    try { wx.getFileSystemManager().writeFileSync(path, JSON.stringify(S), 'utf8'); }
    catch (e) { wx.showToast({ title: '生成失败', icon: 'error' }); return; }
    wx.shareFileMessage({
      filePath: path, fileName: name,
      success: () => {
        S.settings.lastBackup = Core.fd(Core.today());
        store.save(S); this.refresh();
        wx.showToast({ title: '备份文件已发出', icon: 'success' });
      },
      fail: err => {
        if (err && /cancel/.test(err.errMsg || '')) return;   // 用户自己取消不算错
        wx.showModal({ title: '没有发出去', showCancel: false,
          content: '文件已生成但没能转发（' + ((err && err.errMsg) || '未知原因')
                 + '）。请再试一次，或改用「复制备份」。' });
      }
    });
  },

  importJSON() {
    wx.getClipboardData({ success: res => this.applyBackupText(res.data || '', '剪贴板') });
  },

  /* 从聊天记录里选回之前发出去的备份文件 */
  importFile() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['txt', 'json'],
      success: res => {
        const f = (res.tempFiles || [])[0];
        if (!f) return;
        let text = '';
        try { text = wx.getFileSystemManager().readFileSync(f.path, 'utf8'); }
        catch (e) { wx.showToast({ title: '读不出这个文件', icon: 'none' }); return; }
        this.applyBackupText(text, '这个文件');
      }
    });
  },

  /* 剪贴板与文件两条导入路径共用：解析 → 确认 → normalize 落盘 */
  applyBackupText(text, where) {
    let d;
    try { d = JSON.parse((text || '').trim()); }
    catch (e) { wx.showToast({ title: where + '不是备份数据', icon: 'none' }); return; }
    if (!d || !Array.isArray(d.cards)) {
      wx.showToast({ title: '数据格式不对', icon: 'none' }); return;
    }
    wx.showModal({
      title: '导入备份',
      content: '将导入 ' + d.cards.length + ' 张卡、' + (d.txns || []).length + ' 笔消费、'
             + (d.payments || []).length + ' 笔还款，覆盖当前全部数据。确定？',
      success: r => {
        if (!r.confirm) return;
        // 必须走 normalize：2.2 以前的备份没有 payments、只有逐笔 repaid 标记，
        // 不迁移就等于把已还的钱全变回待还，而且存盘后再也没有补救机会。
        const S = store.normalize(d);
        store.save(S);
        this.refresh();
        wx.showToast({ title: '导入成功', icon: 'success' });
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
