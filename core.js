/* =====================================================================
   卡周期 · 核心领域逻辑
   ---------------------------------------------------------------------
   零依赖、无界面、无存储：只有纯函数。
   同一份代码供三处使用——
     · 网页版：<script src="core.js"></script> 后使用全局 CardCycleCore
     · 小程序：const Core = require('./core.js')
     · 测试：  const Core = require('../core.js')

   所有涉及"周期归属/还款日"的计算只允许写在这里。
   改动本文件必须跑 test/ 下的测试（node --test test/）。
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardCycleCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 日期基础 ---------- */
  const DAY = 864e5;

  function today() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function pd(s) {                       // 'YYYY-MM-DD' → Date（本地时区）
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fd(d) {                       // Date → 'YYYY-MM-DD'
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
         + '-' + String(d.getDate()).padStart(2, '0');
  }
  function md(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function addD(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function diffD(a, b) { return Math.round((b - a) / DAY); }

  // 「每月第 day 号」在某年某月的实际落点：短月取当月最后一天
  function clampDay(y, m, day) {
    return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  }
  // >= from 的最近账单日（账单日当天消费计入当期，故含当天）
  function nextStmt(day, from) {
    let c = clampDay(from.getFullYear(), from.getMonth(), day);
    if (c < from) c = clampDay(from.getFullYear(), from.getMonth() + 1, day);
    return c;
  }
  // < from 的最近账单日
  function prevStmt(day, from) {
    let c = clampDay(from.getFullYear(), from.getMonth(), day);
    if (c >= from) c = clampDay(from.getFullYear(), from.getMonth() - 1, day);
    return c;
  }
  // 手写千分位：小程序 iOS 端的 toLocaleString 无 Intl 时不带分组，跨端表现不一
  function money(n) {
    const neg = n < 0 ? '-' : '';
    const s = Math.abs(n).toFixed(2);
    const [i, f] = s.split('.');
    return neg + i.replace(/\B(?=(\d{3})+$)/g, ',') + '.' + f;
  }

  /* ---------- 周期计算 ---------- */
  // 该卡的还款提前天数（卡未单独设置时用全局默认）
  function bufOf(card, settings) {
    return card.buffer == null ? ((settings && settings.buffer) || 3) : card.buffer;
  }

  /**
   * 一张卡在 ref 这天所处的周期状态。
   * 消费与还款是两本独立流水，还款不对应具体某笔消费：
   * 把该卡还款总额从最早一笔消费开始冲抵（银行也是先冲最早的账），
   * 没冲掉的余下部分再按消费日期归入各周期。
   * @param card     {statementDay, buffer?, id}
   * @param txns     全部消费 [{id, cardId, date:'YYYY-MM-DD', amount}]
   * @param payments 全部还款 [{id, cardId, date:'YYYY-MM-DD', amount}]
   * @param settings {buffer}
   * @param ref      参考日（默认今天）
   * @returns {anchor,prevA,winStart,due,cur,curN,over,overN,deposit,toDue,toAnchor,st,label,hint,pct}
   *   st: bad | hot | warn | ok | idle
   *   deposit: 存款（还款超出全部消费的部分），下次消费自动抵扣
   */
  function calc(card, txns, payments, settings, ref) {
    ref = ref || today();
    const anchor   = nextStmt(card.statementDay, ref);   // 本周期结算的账单日
    const prevA    = prevStmt(card.statementDay, ref);   // 上一个账单日
    const winStart = addD(prevA, 1);                     // 安全刷卡窗口起点
    const due      = addD(anchor, -bufOf(card, settings));
    const aKey     = fd(anchor);

    const charges = txns.filter(t => t.cardId === card.id)
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1
                    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let credit = 0;                                      // 分为单位，避免浮点
    for (const p of (payments || []))
      if (p.cardId === card.id) credit += Math.round(p.amount * 100);

    let cur = 0, curN = 0, over = 0, overN = 0, curAll = 0;  // curAll：本期消费总额（含已冲抵）
    for (const t of charges) {
      let amt = Math.round(t.amount * 100);
      const k = fd(nextStmt(card.statementDay, pd(t.date)));
      if (k === aKey) curAll += amt;
      if (credit >= amt) { credit -= amt; continue; }    // 这笔已被还款冲抵
      amt -= credit; credit = 0;
      if (k === aKey) { cur += amt; curN++; }
      else if (k < aKey) { over += amt; overN++; }
    }
    cur /= 100; over /= 100; curAll /= 100;
    const deposit = credit / 100;                        // 冲抵完全部消费后剩下的钱

    const toDue    = diffD(ref, due);
    const toAnchor = diffD(ref, anchor);
    const total    = diffD(winStart, anchor);
    const gone     = Math.max(0, Math.min(total, diffD(winStart, ref)));

    let st, label, hint;
    if (over > 0) {
      st = 'bad'; label = '已出账单';
      hint = '有 ' + overN + ' 笔（¥' + money(over) + '）跨过账单日仍未还，这部分已经上了账单。';
    } else if (cur === 0) {
      // 本期刷过但已全部还清 ≠ 本期没刷过，状态要区分开
      st = 'idle'; label = curAll > 0 ? '已还清' : '本期未刷';
      // 危险时段 = 还款截止日起到账单日：此时刷卡会计入即将出的账单，且已无还款缓冲
      hint = toDue <= 0
        ? '已过本期安全窗口，现在刷会计入 ' + md(anchor) + ' 的账单。等 ' + md(addD(anchor, 1)) + ' 起再刷。'
        : '可刷卡窗口 ' + md(winStart) + ' — ' + md(addD(due, -1)) + '。';
    } else if (toDue < 0) {
      st = 'bad'; label = '已超期限';
      hint = '已超还款日 ' + (-toDue) + ' 天，距账单日只剩 ' + toAnchor + ' 天，务必今天还清。';
    } else if (toDue <= 1) {
      st = 'hot'; label = toDue === 0 ? '今天还清' : '明天前还清';
      hint = '账单日 ' + md(anchor) + '，还款到账要时间，别再等了。';
    } else if (toDue <= 4) {
      st = 'warn'; label = '准备还款';
      hint = '请在 ' + md(due) + ' 前还清，账单日 ' + md(anchor) + '。';
    } else {
      st = 'ok'; label = '周期进行中';
      hint = '还款截止 ' + md(due) + '，账单日 ' + md(anchor) + '。';
    }
    return { anchor, prevA, winStart, due, cur, curN, over, overN, deposit, toDue, toAnchor, st, label, hint,
             pct: total > 0 ? Math.round(gone / total * 100) : 0 };
  }

  /* ---------- 旧数据迁移 ---------- */
  /**
   * 2.2 以前的数据是逐笔标记 repaid，迁移成「消费 + 还款」两本流水：
   * 每笔已还消费折算成一条等额还款记录（日期取 repaidDate，缺省用消费日），
   * 并清掉消费上的标记。金额守恒。纯函数：不修改传入数组。
   * @returns {txns, payments}
   */
  function migrateRepaid(txns, newId) {
    newId = newId || (() => Math.random().toString(36).slice(2, 10));
    const payments = [];
    const out = (txns || []).map(t => {
      const c = Object.assign({}, t);
      if (c.repaid) payments.push({ id: newId(), cardId: c.cardId,
        date: c.repaidDate || c.date, amount: c.amount });
      delete c.repaid; delete c.repaidDate;
      return c;
    });
    return { txns: out, payments };
  }

  /* ---------- 旧版种子商户清理 ---------- */
  /**
   * 小程序 2.1 首次启动预置过 4 个占位商户（A–D 机器，后改名商户 A–D），
   * 2.2 起默认只留一个「老张便利店」；但种子只在存储为空时写入，
   * 已种进老设备/老备份的占位商户不会自动变，需要在 normalize 时清理。
   * 只清「名字仍是旧占位名、备注为空、从未记过账」的商户——真实在用的绝不动；
   * 若清完一个不剩，补回默认「老张便利店」。纯函数：不修改传入数组。
   */
  function pruneSeedTerminals(terminals, txns, newId) {
    newId = newId || (() => Math.random().toString(36).slice(2, 10));
    const OLD = ['A 机器', 'B 机器', 'C 机器', 'D 机器',
                 '商户 A', '商户 B', '商户 C', '商户 D'];
    const used = new Set((txns || []).map(t => t.terminalId));
    const out = (terminals || []).filter(t =>
      !(OLD.includes(t.name) && !t.note && !used.has(t.id)));
    if (!out.length && (terminals || []).length)
      out.push({ id: newId(), name: '老张便利店', note: '' });
    return out;
  }

  /* ---------- 概览「最近变动」排序 ---------- */
  /**
   * 某张卡最后一次记账时刻（毫秒）。
   * 优先用记录上的 ts（记账动作发生的时间，精确到毫秒）；
   * 老记录没有 ts 的，退回按流水日期当天 0 点算——同一天里新记的永远比老记录靠前。
   * 从未有任何消费/还款流水返回 0。
   */
  function lastActTs(txns, payments, cardId) {
    let m = 0;
    for (const t of txns) if (t.cardId === cardId)
      m = Math.max(m, t.ts || pd(t.date).getTime());
    for (const p of payments) if (p.cardId === cardId)
      m = Math.max(m, p.ts || pd(p.date).getTime());
    return m;
  }

  /* 「最近变动」分档：0 有欠款 | 1 无欠款但有过流水 | 2 从未有任何流水（沉底） */
  function recentBand(st, actTs) { return st !== 'idle' ? 0 : actTs > 0 ? 1 : 2; }

  /* 「最近变动」比较器：档位升序，档内按记账时刻倒序（档 2 全为 0，稳定排序保持原顺序） */
  function recentCmp(a, b) { return a.band - b.band || b.actTs - a.actTs; }

  /* ---------- 日历（ICS）生成 ---------- */
  const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
                               .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const icsDate = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0')
                     + String(d.getDate()).padStart(2, '0');

  // UTF-8 字节长度（不用 TextEncoder：小程序 JS 环境没有它）
  function utf8Len(s) {
    let n = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
  }

  // RFC 5545 物理行 ≤75 字节；中文按 UTF-8 字节折行，续行以空格开头
  function icsFold(line) {
    if (utf8Len(line) <= 73) return line;
    const parts = []; let cur = '', curLen = 0;
    for (const ch of line) {
      const l = utf8Len(ch);
      if (curLen + l > 73) { parts.push(cur); cur = ch; curLen = l; }
      else { cur += ch; curLen += l; }
    }
    if (cur) parts.push(cur);
    return parts.join('\r\n ');
  }

  /**
   * 未来 months 个月的提醒事件列表（还款 + 新周期开始），纯数据。
   * 供 buildICS 生成 .ics，也供小程序逐条写入手机系统日历。
   * @param cards    信用卡数组
   * @param people   持卡人数组（多人模式下描述里注明持卡人；单人传 [] 即可）
   * @param settings {buffer}
   * @param opts     {months=12, now=today(), multiUser=false}
   * @returns [{uid, kind:'due'|'open', date:'YYYY-MM-DD', title, desc}]
   */
  function buildReminders(cards, people, settings, opts) {
    opts = opts || {};
    const months = opts.months || 12;
    const now0   = opts.now || today();
    const personName = id => {
      const p = (people || []).find(p => p.id === id);
      return p ? p.name : '';
    };
    const cardLabel = c => c.bank + (c.last4 && c.last4 !== '****' ? ' ·' + c.last4 : '');

    const out = [];
    for (const c of cards) {
      const nm = cardLabel(c), b = bufOf(c, settings);
      const whoLine = opts.multiUser && personName(c.personId)
        ? '\n持卡人：' + personName(c.personId) : '';
      let a = nextStmt(c.statementDay, now0);
      for (let i = 0; i < months; i++) {
        out.push({ uid: c.id + '-due-' + icsDate(a), kind: 'due',
          date: fd(addD(a, -b)), title: '【还款】' + nm,
          desc: '账单日 ' + md(a) + '。请在今天之前把本周期刷的金额全部还清，账单日结算时余额为 0 才不会出账单。'
              + '\n还款到账可能需要 1 天，别卡最后一刻。' + whoLine });
        const op = addD(a, 1);
        out.push({ uid: c.id + '-open-' + icsDate(op), kind: 'open',
          date: fd(op), title: '【可刷卡】' + nm,
          desc: '账单日 ' + md(a) + ' 已过，新周期开始。本期还款截止 '
              + md(addD(nextStmt(c.statementDay, op), -b)) + '。' });
        a = nextStmt(c.statementDay, addD(a, 1));
      }
    }
    return out;
  }

  /**
   * 生成未来 months 个月的提醒日历。
   * @param opts  {months=12, now=today(), multiUser=false, stamp}  stamp 供测试固定 DTSTAMP
   * @returns {text, count}
   */
  function buildICS(cards, people, settings, opts) {
    opts = opts || {};
    const nowU = new Date();
    const p2 = x => String(x).padStart(2, '0');
    const stamp = opts.stamp ||
      (nowU.getUTCFullYear() + p2(nowU.getUTCMonth() + 1) + p2(nowU.getUTCDate()) + 'T'
       + p2(nowU.getUTCHours()) + p2(nowU.getUTCMinutes()) + p2(nowU.getUTCSeconds()) + 'Z');

    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cardcycle//CN',
               'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:卡周期提醒'];
    const rems = buildReminders(cards, people, settings, opts);
    for (const r of rems) {
      const day = pd(r.date);
      L.push('BEGIN:VEVENT', 'UID:' + r.uid + '@cardcycle', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + icsDate(day), 'DTEND;VALUE=DATE:' + icsDate(addD(day, 1)),
        'SUMMARY:' + icsEsc(r.title), 'DESCRIPTION:' + icsEsc(r.desc), 'TRANSP:TRANSPARENT');
      // 还款：3天前/1天前/当天 上午9点各响一次；可刷卡：当天 9 点一次
      const alarms = r.kind === 'due' ? ['-P2DT15H', '-PT15H', 'PT9H'] : ['PT9H'];
      alarms.forEach(t => L.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + icsEsc(r.title), 'TRIGGER:' + t, 'END:VALARM'));
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return { text: L.map(icsFold).join('\r\n'), count: rems.length };
  }

  return { DAY, today, pd, fd, md, addD, diffD, clampDay, nextStmt, prevStmt,
           money, bufOf, calc, migrateRepaid, pruneSeedTerminals,
           lastActTs, recentBand, recentCmp,
           buildReminders, buildICS, icsFold, utf8Len };
}));
