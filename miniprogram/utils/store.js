/* 存储适配 + 展示数据组装
   规矩：周期/日期逻辑全在 core.js（勿在此重写）；
        本文件负责 wx.storage 读写，以及把 core 的计算结果
        转成 WXML 能直接绑定的纯数据（WXML 里不能调函数）。
   数据格式与网页版完全一致：网页备份可粘贴导入小程序，反之亦然。 */
const Core = require('./core.js');

const KEY = 'cardcycle.v1';
const DEF = {
  people: [], cards: [], terminals: [], txns: [], payments: [],
  settings: { buffer: 3, minGap: 7, lastBackup: null,
              cardSort: 'smart',      // 概览排序：smart 紧急程度 | recent 最近变动 | custom 自定义
              swipeStyle: 'chips' }   // 记消费选卡方式：chips 平铺 | list 下拉列表
};

const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);

/* 存储/备份数据 → 内部状态（含 2.2 以前逐笔 repaid 标记的旧数据迁移） */
function normalize(d) {
  const S = Object.assign(clone(DEF), d);
  S.settings = Object.assign(clone(DEF.settings), d.settings || {});
  if (!Array.isArray(d.payments)) {
    const m = Core.migrateRepaid(S.txns, uid);
    S.txns = m.txns; S.payments = m.payments;
  }
  return S;
}

function load() {
  let d = null;
  try { d = wx.getStorageSync(KEY) || null; } catch (e) {}
  if (!d) {
    const S = clone(DEF);
    S.people = [{ id: uid(), name: '我' }];
    S.terminals = [{ id: uid(), name: '老张便利店', note: '' }];
    save(S);
    return S;
  }
  return normalize(d);
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
  const k = Core.calc(c, S.txns, S.payments, S.settings);
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
    const dep = k.deposit;   // 存款（还款超出消费的部分）：下次消费自动抵扣
    v.idleLine = (dep > 0 ? '存款 ¥' + Core.money(dep) + ' 自动抵扣 · ' : '')
      + (k.toDue <= 0
          ? '窗口已过 · ' + Core.md(Core.addD(k.anchor, 1)) + ' 起再刷'
          : '可刷至 ' + Core.md(Core.addD(k.due, -1)) + ' · ' + Core.md(k.due) + ' 前还清');
    v.idleSoon = k.toDue <= 0;
  } else {
    v.cdText = k.toDue >= 0 ? '距还款截止' : '距账单日';
    v.cdNum = k.toDue >= 0 ? k.toDue : k.toAnchor;
  }
  return v;
}

/* 概览页整页数据 */
function dashData(S) {
  const mode = S.settings.cardSort || 'smart';
  const views = S.cards.map(c => {
    const v = cardView(S, c);
    v.actTs = Core.lastActTs(S.txns, S.payments, c.id);
    v.band = Core.recentBand(v.st, v.actTs);
    return v;
  });
  if (mode === 'smart')
    views.sort((a, b) => a.rank - b.rank || a.toDue - b.toDue);
  else if (mode === 'recent')
    views.sort(Core.recentCmp);   // 欠款卡在前 → 操作过的 → 从未操作沉底；档内按记账时刻倒序
  // custom：保持 S.cards 数组顺序（设置页 ↑↓ 直接调整数组）
  const urgent = views.filter(v => ['bad', 'hot', 'warn'].includes(v.st));
  let urgentSum = 0;
  for (const v of urgent) {
    const c = cardById(S, v.id);
    const k = Core.calc(c, S.txns, S.payments, S.settings);
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
    const k = Core.calc(c, S.txns, S.payments, S.settings);
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
  const k = Core.calc(c, S.txns, S.payments, S.settings);
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

/* 单卡明细页：卡片状态 + 汇总 + 该卡的消费与还款两本流水（混排） */
function cardTxData(S, cardId) {
  const c = cardById(S, cardId);
  if (!c) return null;
  const txs = S.txns.filter(t => t.cardId === cardId);
  const pays = S.payments.filter(p => p.cardId === cardId);
  const rows = txs.map(t => {
      const tm = termById(S, t.terminalId);
      return { kind: 'tx', id: t.id, date: t.date, amt: Core.money(t.amount),
               sub: [tm ? tm.name : '未记商户', t.note].filter(Boolean).join(' · ') };
    })
    .concat(pays.map(p => ({ kind: 'pay', id: p.id, date: p.date,
                             amt: Core.money(p.amount), sub: '' })))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const tot = txs.reduce((s, t) => s + t.amount, 0);
  const paid = pays.reduce((s, p) => s + p.amount, 0);
  const owe = Math.max(0, Math.round((tot - paid) * 100) / 100);
  const extra = Math.max(0, Math.round((paid - tot) * 100) / 100);
  return {
    v: cardView(S, c),
    rows,
    stat: rows.length
      ? { n: txs.length, tot: Core.money(tot), paid: Core.money(paid),
          un: Core.money(owe), extra: extra > 0 ? Core.money(extra) : '' }
      : null
  };
}

/* 登记还款：打开弹窗前取卡片信息；没有待还时提示并返回 null */
function repayInfo(S, cardId) {
  const c = cardById(S, cardId);
  if (!c) return null;
  const k = Core.calc(c, S.txns, S.payments, S.settings);
  const owed = k.cur + k.over;
  if (owed <= 0) { wx.showToast({ title: '这张卡没有待还', icon: 'none' }); return null; }
  return { label: cardLabel(c), owed, owedText: Core.money(owed) };
}

/* 登记还款：记一条独立的还款流水，还多少记多少；
   超出待还的部分自然成为存款，下次消费自动抵扣。
   raw 为用户输入，空串按全额算。成功返回 true，供页面关弹窗并刷新。 */
function applyRepay(S, cardId, raw) {
  const info = repayInfo(S, cardId);
  if (!info) return false;
  const amt = (raw || '').trim() ? parseFloat(raw) : info.owed;
  if (!(amt > 0)) { wx.showToast({ title: '金额不对', icon: 'none' }); return false; }
  const rec = Math.round(amt * 100) / 100;
  S.payments.push({ id: uid(), cardId, date: Core.fd(Core.today()), amount: rec, ts: Date.now() });
  save(S);
  if (rec > info.owed) {
    const dep = Math.round((rec - info.owed) * 100) / 100;
    wx.showModal({ title: '已登记还款 ¥' + Core.money(rec), showCancel: false,
      content: '其中 ¥' + Core.money(dep) + ' 超出待还，记为存款，下次消费自动抵扣。' });
  } else {
    wx.showToast({ title: '已登记还款', icon: 'success' });
  }
  return true;
}

module.exports = {
  Core, KEY, DEF, load, save, uid, ensureMe,
  cardById, termById, cardLabel, termLast, termLastFor,
  cardView, dashData, swipeOptions, swipeWarning,
  cardTxData, repayInfo, applyRepay
};
