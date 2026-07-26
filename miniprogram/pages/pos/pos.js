const store = require('../../utils/store.js');
const Core = store.Core;

Page({
  data: { list: [], matrix: null, minGap: 7 },

  onShow() { this.refresh(); },

  refresh() {
    const S = store.load();
    const t0 = Core.today();
    const mg = S.settings.minGap || 7;
    const mk = Core.fd(t0).slice(0, 7);

    const list = S.terminals.map(tm => {
      const l = store.termLast(S, tm.id);
      const g = l ? Core.diffD(Core.pd(l), t0) : 9999;
      return {
        id: tm.id, name: tm.name,
        gapText: g === 9999 ? '—' : String(g),
        cls: g >= mg ? 'ok' : (g >= Math.ceil(mg / 2) ? 'warn' : 'bad'),
        sub: (l ? '上次 ' + l : '未使用过') + ' · 本月 '
           + S.txns.filter(t => t.terminalId === tm.id && t.date.slice(0, 7) === mk).length + ' 笔'
           + (tm.note ? ' · ' + tm.note : '')
      };
    }).sort((a, b) => (b.gapText === '—' ? 1e4 : +b.gapText) - (a.gapText === '—' ? 1e4 : +a.gapText));

    let matrix = null;
    if (S.cards.length && S.terminals.length) {
      matrix = {
        heads: S.terminals.map(t => t.name),
        rows: S.cards.map(c => ({
          label: store.cardLabel(c),
          cells: S.terminals.map(tm => {
            const l = store.termLastFor(S, tm.id, c.id);
            const g = l ? Core.diffD(Core.pd(l), t0) : null;
            return {
              text: g === null ? '—' : g + '天',
              cls: g === null ? 'dim' : (g >= mg ? 'ok' : 'hot')
            };
          })
        }))
      };
    }
    this.setData({ list, matrix, minGap: mg });
  }
});
