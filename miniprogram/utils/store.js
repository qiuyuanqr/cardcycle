/* 存储适配 + 展示数据组装
   规矩：周期/日期逻辑全在 core.js（勿在此重写）；
        本文件负责 wx.storage 读写，以及把 core 的计算结果
        转成 WXML 能直接绑定的纯数据（WXML 里不能调函数）。
   数据格式与网页版完全一致：网页备份可粘贴导入小程序，反之亦然。 */
const Core = require('./core.js');

const KEY = 'cardcycle.v1';
const DEF = {
  people: [], cards: [], terminals: [], txns: [],
  settings: { buffer: 3, minGap: 7, lastBackup: null }
};

const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);

function load() {
  let d = null;
  try { d = wx.getStorageSync(KEY) || null; } catch (e) {}
  if (!d) {
    const S = clone(DEF);
    S.people = [{ id: uid(), name: '我' }];
    S.terminals = ['商户 A', '商户 B', '商户 C', '商户 D']
      .map(n => ({ id: uid(), name: n, note: '' }));
    save(S);
    return S;
  }
  const S = Object.assign(clone(DEF), d);
  S.settings = Object.assign(clone(DEF.settings), d.settings || {});
  return S;
}
function save(S) {
  try { wx.setStorageSync(KEY, S); }
  catch (e) { wx.showToast({ title: '保存失败', icon: 'error' }); }
}
function ensureMe(S) {
  if (!S.people.length) S.people.push({ id: uid(), name: '我' });
  return S.people[0].id;
}

const cardById = (S, id) => S.cards.find(c => c.id === id);
const termById = (S, id) => S.terminals.find(t => t.id === id);
const cardLabel = c => c.bank + (c.last4 && c.last4 !== '****' ? ' ·' + c.last4 : '');

function termLast(S, tid) {
  const d = S.txns.filter(t => t.terminalId === tid).map(t => t.date).sort();
  return d.pop() || null;
}
function termLastFor(S, tid, cid) {
  const d = S.txns.filter(t => t.terminalId === tid && t.cardId === cid)
                  .map(t => t.date).sort();
  return d.pop() || null;
}

const RANK = { bad: 0, hot: 1, warn: 2, ok: 3, idle: 4 };

/* 一张卡 → 概览页展示对象 */
function cardView(S, c) {
  const k = Core.calc(c, S.txns, S.settings);
  const amt = k.cur + k.over;
  const buf = Core.bufOf(c, S.settings);
  const v = {
    id: c.id, label: cardLabel(c), st: k.st, pill: k.label,
    meta: '账单日 ' + c.statementDay + ' 号 · 提前 ' + buf + ' 天还'
        + (c.limit ? ' · 额度 ¥' + Core.money(c.limit) : ''),
    amt: Core.money(amt), hasAmt: amt > 0,
    pct: k.pct, hint: k.hint,
    tickL: Core.md(k.winStart) + ' 起可刷',
    tickR: Core.md(k.due) + ' 前还清',
    idle: k.st === 'idle',
    rank: RANK[k.st], toDue: k.toDue
  };
  if (k.st === 'idle') {
    v.idleLine = k.toDue <= 0
      ? '窗口已过 · ' + Core.md(Core.addD(k.anchor, 1)) + ' 起再刷'
      : '可刷至 ' + Core.md(Core.addD(k.due, -1)) + ' · ' + Core.md(k.due) + ' 前还清';
    v.idleSoon = k.toDue <= 0;
  } else {
    v.cdText = k.toDue >= 0 ? '距还款截止' : '距账单日';
    v.cdNum = k.toDue >= 0 ? k.toDue : k.toAnchor;
  }
  return v;
}

/* 概览页整页数据 */
function dashData(S) {
  const views = S.cards.map(c => cardView(S, c))
    .sort((a, b) => a.rank - b.rank || a.toDue - b.toDue);
  const urgent = views.filter(v => ['bad', 'hot', 'warn'].includes(v.st));
  let urgentSum = 0;
  for (const v of urgent) {
    const c = cardById(S, v.id);
    const k = Core.calc(c, S.txns, S.settings);
    urgentSum += k.cur + k.over;
  }
  return {
    views,
    urgentCount: urgent.length,
    urgentSum: Core.money(urgentSum),
    hasCards: S.cards.length > 0
  };
}

/* 记一笔页：卡与商户的选择列表 */
function swipeOptions(S, selCardId) {
  const t0 = Core.today();
  const cards = S.cards.map(c => {
    const k = Core.calc(c, S.txns, S.settings);
    return { id: c.id, label: cardLabel(c), sub: k.label };
  });
  const terms = S.terminals.map(tm => {
    const lAll = termLast(S, tm.id);
    const lMine = selCardId ? termLastFor(S, tm.id, selCardId) : null;
    return {
      id: tm.id, name: tm.name,
      gapAll: lAll ? Core.diffD(Core.pd(lAll), t0) : 9999,
      sub: lMine === null ? '本卡未用过'
         : '本卡 ' + Core.diffD(Core.pd(lMine), t0) + ' 天前'
    };
  }).sort((a, b) => b.gapAll - a.gapAll);
  return { cards, terms };
}

/* 选中某张卡时的时段警告（记一笔页顶部） */
function swipeWarning(S, cardId) {
  const c = cardById(S, cardId);
  if (!c) return null;
  const k = Core.calc(c, S.txns, S.settings);
  if (k.toDue <= 0) return {
    level: 'bad',
    text: '注意：本期安全窗口已过（' + (k.toAnchor === 0 ? '今天就是账单日'
        : '距账单日只剩 ' + k.toAnchor + ' 天') + '），现在刷会计入 '
        + Core.md(k.anchor) + ' 的账单。建议等 ' + Core.md(Core.addD(k.anchor, 1)) + ' 起再刷。'
  };
  if (k.toDue <= 1) return {
    level: 'hot',
    text: '注意：本期还款截止 ' + Core.md(k.due) + '，现在刷的钱也要在那之前还清。'
  };
  return null;
}

module.exports = {
  Core, KEY, DEF, load, save, uid, ensureMe,
  cardById, termById, cardLabel, termLast, termLastFor,
  cardView, dashData, swipeOptions, swipeWarning
};
