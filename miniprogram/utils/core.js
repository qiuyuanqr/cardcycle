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
   * @param card     {statementDay, buffer?, id}
   * @param txns     全部交易 [{cardId, date:'YYYY-MM-DD', amount, repaid}]
   * @param settings {buffer}
   * @param ref      参考日（默认今天）
   * @returns {anchor,prevA,winStart,due,cur,curN,over,overN,toDue,toAnchor,st,label,hint,pct}
   *   st: bad | hot | warn | ok | idle
   */
  function calc(card, txns, settings, ref) {
    ref = ref || today();
    const anchor   = nextStmt(card.statementDay, ref);   // 本周期结算的账单日
    const prevA    = prevStmt(card.statementDay, ref);   // 上一个账单日
    const winStart = addD(prevA, 1);                     // 安全刷卡窗口起点
    const due      = addD(anchor, -bufOf(card, settings));
    const aKey     = fd(anchor);

    let cur = 0, curN = 0, over = 0, overN = 0;
    for (const t of txns) {
      if (t.cardId !== card.id || t.repaid) continue;
      const k = fd(nextStmt(card.statementDay, pd(t.date)));
      if (k === aKey) { cur += t.amount; curN++; }
      else if (k < aKey) { over += t.amount; overN++; }
    }

    const toDue    = diffD(ref, due);
    const toAnchor = diffD(ref, anchor);
    const total    = diffD(winStart, anchor);
    const gone     = Math.max(0, Math.min(total, diffD(winStart, ref)));

    let st, label, hint;
    if (over > 0) {
      st = 'bad'; label = '已出账单';
      hint = '有 ' + overN + ' 笔（¥' + money(over) + '）跨过账单日仍未还，这部分已经上了账单。';
    } else if (cur === 0) {
      st = 'idle'; label = '本期未刷';
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
    return { anchor, prevA, winStart, due, cur, curN, over, overN, toDue, toAnchor, st, label, hint,
             pct: total > 0 ? Math.round(gone / total * 100) : 0 };
  }

  /* ---------- 还款核销 ---------- */
  /**
   * 按金额登记还款：把 amount 沿时间先后核销该卡未还的消费。
   * 金额不足以覆盖某笔时，把那笔拆成「已还部分 + 未还剩余」两条记录
   * （日期等字段不变，周期归属不受影响）。分为单位计算，避免浮点误差。
   * 纯函数：不修改传入数组。
   * @param txns    全部交易
   * @param cardId  还哪张卡
   * @param amount  这次还的金额
   * @param dateStr 还款日期 'YYYY-MM-DD'
   * @param newId   生成拆分新记录 id 的函数
   * @returns {txns, applied, closed, split, leftover}
   *   applied  实际核销金额（未还总额不足时只到总额为止）
   *   closed   标记为已还的笔数（含拆分出的已还部分）
   *   split    是否发生了拆分（0/1）
   *   leftover amount 中没用掉的部分
   */
  function applyRepayment(txns, cardId, amount, dateStr, newId) {
    newId = newId || (() => Math.random().toString(36).slice(2, 10));
    let left = amount > 0 ? Math.round(amount * 100) : 0;
    const total = left;
    const out = txns.map(t => Object.assign({}, t));
    const open = out.filter(t => t.cardId === cardId && !t.repaid)
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1
                    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let closed = 0, split = 0;
    for (const t of open) {
      if (left <= 0) break;
      const amt = Math.round(t.amount * 100);
      if (left >= amt) {
        t.repaid = true; t.repaidDate = dateStr; left -= amt; closed++;
      } else {
        const rest = (amt - left) / 100;
        t.amount = left / 100; t.repaid = true; t.repaidDate = dateStr;
        out.splice(out.indexOf(t) + 1, 0,
          Object.assign({}, t, { id: newId(), amount: rest, repaid: false, repaidDate: null }));
        left = 0; closed++; split = 1;
      }
    }
    return { txns: out, applied: (total - left) / 100, closed, split, leftover: left / 100 };
  }

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
           money, bufOf, calc, applyRepayment, buildReminders, buildICS, icsFold, utf8Len };
}));
