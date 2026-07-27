/* 卡周期核心逻辑测试
   运行：node --test test/
   凡改动 core.js 必须先过这套测试再发布。 */
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

const SETTINGS = { buffer: 3 };

/* ---------- 跨端兼容实现 ---------- */
test('utf8Len 与 TextEncoder 一致（小程序端无 TextEncoder，用手写实现）', () => {
  const enc = new TextEncoder();
  const samples = ['abc', '中文测试', '【还款】广发银行 ·1234', 'a中1文,;\\n', '😀emoji𝄞混排', ''];
  for (const s of samples)
    assert.strictEqual(C.utf8Len(s), enc.encode(s).length, JSON.stringify(s));
});

test('money 手写千分位', () => {
  assert.strictEqual(C.money(0), '0.00');
  assert.strictEqual(C.money(999), '999.00');
  assert.strictEqual(C.money(1000), '1,000.00');
  assert.strictEqual(C.money(1234567.891), '1,234,567.89');
  assert.strictEqual(C.money(-38500), '-38,500.00');
});

/* ---------- 月份天数 ---------- */
test('月份天数 2025–2030（含三种闰年规则）', () => {
  const LEN = { 1:31, 2:28, 3:31, 4:30, 5:31, 6:30, 7:31, 8:31, 9:30, 10:31, 11:30, 12:31 };
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  for (let y = 2025; y <= 2030; y++)
    for (let m = 1; m <= 12; m++) {
      const want = (m === 2 && isLeap(y)) ? 29 : LEN[m];
      assert.strictEqual(C.clampDay(y, m - 1, 31).getDate(), want, `${y}-${m}`);
    }
  assert.strictEqual(C.clampDay(2028, 1, 31).getDate(), 29, '2028 闰年');
  assert.strictEqual(C.clampDay(2100, 1, 31).getDate(), 28, '2100 整百不闰');
  assert.strictEqual(C.clampDay(2000, 1, 31).getDate(), 29, '2000 四百整除闰');
});

/* ---------- 账单日落点 ---------- */
test('账单日 1–31 号 × 连续 800 天：唯一归属、间隔 28–31、短月取月末', () => {
  for (let day = 1; day <= 31; day++) {
    for (let i = 0; i < 800; i++) {
      const d  = C.addD(C.pd('2025-06-01'), i);
      const nx = C.nextStmt(day, d), pv = C.prevStmt(day, d);
      assert.ok(d > pv && d <= nx, `唯一归属 day=${day} ${C.fd(d)}`);
      const gap = C.diffD(pv, nx);
      assert.ok(gap >= 28 && gap <= 31, `间隔 day=${day} ${C.fd(d)}: ${gap}`);
      const dom = Math.min(day, new Date(nx.getFullYear(), nx.getMonth() + 1, 0).getDate());
      assert.strictEqual(nx.getDate(), dom, `落点号数 day=${day} ${C.fd(d)}`);
      assert.strictEqual(C.fd(C.nextStmt(day, C.addD(pv, 1))), C.fd(nx), `窗口起点归属 day=${day}`);
    }
  }
});

test('账单日边界：当天计入当期、跨年、月末序列', () => {
  assert.strictEqual(C.fd(C.nextStmt(5,  C.pd('2026-07-05'))), '2026-07-05', '账单日当天');
  assert.strictEqual(C.fd(C.nextStmt(5,  C.pd('2026-07-06'))), '2026-08-05', '次日进下期');
  assert.strictEqual(C.fd(C.nextStmt(5,  C.pd('2026-12-10'))), '2027-01-05', '跨年');
  assert.strictEqual(C.fd(C.prevStmt(5,  C.pd('2027-01-03'))), '2026-12-05', '跨年回看');
  assert.strictEqual(C.fd(C.nextStmt(31, C.pd('2026-02-10'))), '2026-02-28', '31号平年2月');
  assert.strictEqual(C.fd(C.nextStmt(31, C.pd('2028-02-10'))), '2028-02-29', '31号闰年2月');
  assert.strictEqual(C.fd(C.nextStmt(30, C.pd('2026-03-01'))), '2026-03-30', '2月末后回到30号');
});

/* ---------- calc 不变量 ---------- */
test('calc：账单日 × 缓冲 × 430 天全扫描的不变量', () => {
  for (const day of [1, 2, 5, 10, 11, 13, 15, 21, 28, 29, 30, 31]) {
    for (const buffer of [0, 3, 4, 7]) {
      const card = { id: 'c', statementDay: day, buffer };
      for (let i = 0; i < 430; i++) {
        const ref = C.addD(C.pd('2026-01-01'), i);
        const k = C.calc(card, [], [], SETTINGS, ref);
        assert.strictEqual(C.diffD(k.due, k.anchor), buffer, 'due=anchor-buffer');
        assert.strictEqual(C.fd(k.winStart), C.fd(C.addD(k.prevA, 1)), '窗口起点');
        assert.ok(ref > k.prevA && ref <= k.anchor, 'ref 在周期内');
        assert.ok(k.pct >= 0 && k.pct <= 100, 'pct 范围');
        // 关键回归：显示刷卡窗口时，窗口终点绝不能已过期（危险时段必须给等待警告）
        if (k.st === 'idle' && k.hint.includes('可刷卡窗口'))
          assert.ok(C.diffD(ref, C.addD(k.due, -1)) >= 0,
            `过期窗口 day=${day} buf=${buffer} ${C.fd(ref)}`);
        if (k.st === 'idle' && k.toDue <= 0)
          assert.ok(k.hint.includes('等'), `危险时段缺等待警告 ${C.fd(ref)}`);
      }
    }
  }
});

test('calc：交易归属与状态分级', () => {
  const card = { id: 'c1', statementDay: 5, buffer: 3 };
  const ref = C.pd('2026-07-27');            // 周期 7/6–8/5，due 8/2
  const t = date => ({ id: date, cardId: 'c1', date, amount: 100 });
  const pay = a => [{ id: 'p1', cardId: 'c1', date: '2026-07-27', amount: a }];

  let k = C.calc(card, [t('2026-07-10')], [], SETTINGS, ref);
  assert.strictEqual(k.cur, 100); assert.strictEqual(k.over, 0);
  assert.strictEqual(k.st, 'ok');

  k = C.calc(card, [t('2026-07-01')], [], SETTINGS, ref);   // 跨过 7/5 账单日未还
  assert.strictEqual(k.over, 100); assert.strictEqual(k.st, 'bad');

  k = C.calc(card, [t('2026-07-01')], pay(100), SETTINGS, ref);  // 已还清不计
  assert.strictEqual(k.cur + k.over, 0); assert.strictEqual(k.st, 'idle');

  k = C.calc(card, [t('2026-07-10')], [], SETTINGS, C.pd('2026-08-01'));  // toDue=1
  assert.strictEqual(k.st, 'hot');
  k = C.calc(card, [t('2026-07-10')], [], SETTINGS, C.pd('2026-08-03'));  // 过 due 未过账单日
  assert.strictEqual(k.st, 'bad');
});

/* ---------- 还款冲抵 ---------- */
test('calc：还款按时间先后冲抵，不对应具体消费', () => {
  const card = { id: 'c1', statementDay: 5, buffer: 3 };
  const ref = C.pd('2026-07-27');            // 周期 7/6–8/5
  const txns = [
    { id: 'a', cardId: 'c1', date: '2026-07-01', amount: 100 },   // 已跨账单日
    { id: 'b', cardId: 'c1', date: '2026-07-10', amount: 200 },   // 本期
    { id: 'x', cardId: 'c2', date: '2026-07-02', amount: 999 }    // 他卡
  ];
  const pay = a => [{ id: 'p1', cardId: 'c1', date: '2026-07-26', amount: a }];

  let k = C.calc(card, txns, pay(100), SETTINGS, ref);   // 正好冲掉最早那笔
  assert.strictEqual(k.over, 0); assert.strictEqual(k.cur, 200);
  assert.strictEqual(k.st, 'ok');

  k = C.calc(card, txns, pay(50), SETTINGS, ref);        // 只冲掉一半
  assert.strictEqual(k.over, 50); assert.strictEqual(k.cur, 200);
  assert.strictEqual(k.st, 'bad');

  k = C.calc(card, txns, pay(250), SETTINGS, ref);       // 冲完最早的，再冲本期一部分
  assert.strictEqual(k.over, 0); assert.strictEqual(k.cur, 50);

  k = C.calc(card, txns, pay(9999), SETTINGS, ref);      // 多还：全部冲清
  assert.strictEqual(k.cur + k.over, 0); assert.strictEqual(k.st, 'idle');

  // 他卡的还款不影响本卡
  k = C.calc(card, txns, [{ id: 'p2', cardId: 'c2', date: '2026-07-26', amount: 300 }], SETTINGS, ref);
  assert.strictEqual(k.over, 100); assert.strictEqual(k.cur, 200);

  // 浮点：0.1+0.2 的消费，还 0.3 应清零
  const f = [{ id: 'x1', cardId: 'c1', date: '2026-07-10', amount: 0.1 },
             { id: 'x2', cardId: 'c1', date: '2026-07-11', amount: 0.2 }];
  k = C.calc(card, f, pay(0.3), SETTINGS, ref);
  assert.strictEqual(k.cur + k.over, 0); assert.strictEqual(k.st, 'idle');
});

test('migrateRepaid：已还标记折算成还款记录、金额守恒、清掉标记', () => {
  const txns = [
    { id: 'a', cardId: 'c1', date: '2026-07-01', amount: 100, repaid: true,  repaidDate: '2026-07-20', terminalId: 't1' },
    { id: 'b', cardId: 'c1', date: '2026-07-03', amount: 200, repaid: false, repaidDate: null },
    { id: 'c', cardId: 'c2', date: '2026-07-05', amount: 50,  repaid: true,  repaidDate: null }
  ];
  let n = 0;
  const r = C.migrateRepaid(txns, () => 'p' + (++n));
  assert.strictEqual(r.txns.length, 3, '消费记录一条不少');
  assert.ok(r.txns.every(t => !('repaid' in t) && !('repaidDate' in t)), '标记清掉');
  assert.strictEqual(r.txns.find(t => t.id === 'a').terminalId, 't1', '其余字段保留');
  assert.strictEqual(r.payments.length, 2);
  const pa = r.payments.find(p => p.cardId === 'c1');
  assert.strictEqual(pa.amount, 100);
  assert.strictEqual(pa.date, '2026-07-20', '日期取 repaidDate');
  assert.strictEqual(r.payments.find(p => p.cardId === 'c2').date, '2026-07-05', '缺 repaidDate 用消费日');
  // 迁移前后各卡待还一致
  const card = { id: 'c1', statementDay: 5, buffer: 3 };
  const ref = C.pd('2026-07-27');
  const before = C.calc(card, txns.filter(t => !t.repaid), [], SETTINGS, ref);
  const after  = C.calc(card, r.txns, r.payments, SETTINGS, ref);
  assert.strictEqual(before.cur + before.over, after.cur + after.over);
  assert.strictEqual(txns[0].repaid, true, '不改传入数组');
});

/* ---------- ICS ---------- */
test('buildReminders：数量、日期与 buildICS 同源', () => {
  const cards = [{ id: 'k0', bank: '广发银行', last4: '****', statementDay: 10, buffer: 3 }];
  const now = C.pd('2026-07-27');
  const rem = C.buildReminders(cards, [], SETTINGS, { now, months: 6 });
  assert.strictEqual(rem.length, 12, '每月 还款+可刷卡 两条');
  assert.strictEqual(rem[0].kind, 'due');
  assert.strictEqual(rem[0].date, '2026-08-07');   // 账单日 8/10 − 3
  assert.strictEqual(rem[1].kind, 'open');
  assert.strictEqual(rem[1].date, '2026-08-11');   // 账单日次日
  assert.ok(rem[0].title.includes('还款') && rem[0].title.includes('广发银行'));
  const { text, count } = C.buildICS(cards, [], SETTINGS, { now, months: 6, stamp: '20260727T000000Z' });
  assert.strictEqual(count, rem.length);
  const t = text.replace(/\r\n[ \t]/g, '');
  for (const r of rem) assert.ok(t.includes('UID:' + r.uid + '@cardcycle'), r.uid);
});

test('buildICS：7 张卡逐月核对日期、提醒规则、RFC 行长', () => {
  const banks = [['广州银行',5,3,2],['广发银行',10,3,7],['民生银行',11,4,7],['光大银行',13,4,9],
                 ['交通银行',15,4,11],['中信银行',21,3,18],['建设银行',28,4,24]];
  const cards = banks.map(([b, sd, bf], i) =>
    ({ id: 'k' + i, bank: b, last4: '****', statementDay: sd, buffer: bf }));
  const now = C.pd('2026-07-27');
  const { text: raw, count } = C.buildICS(cards, [], SETTINGS, { now, stamp: '20260727T000000Z' });

  assert.strictEqual(count, 7 * 12 * 2, '事件数');

  const enc = new TextEncoder();
  for (const l of raw.split('\r\n'))
    assert.ok(enc.encode(l).length <= 75, 'RFC 行长: ' + l.slice(0, 30));

  const text = raw.replace(/\r\n[ \t]/g, '');           // 展开折叠
  const lines = text.split('\r\n');
  assert.strictEqual(lines[0], 'BEGIN:VCALENDAR');
  assert.strictEqual(lines[lines.length - 1], 'END:VCALENDAR');

  const events = []; let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = { alarms: [] };
    else if (l === 'END:VEVENT') { events.push(cur); cur = null; }
    else if (cur) {
      if (l.startsWith('UID:')) cur.uid = l.slice(4);
      else if (l.startsWith('DTSTART;VALUE=DATE:')) cur.start = l.slice(19);
      else if (l.startsWith('DTEND;VALUE=DATE:')) cur.end = l.slice(17);
      else if (l.startsWith('SUMMARY:')) cur.sum = l.slice(8);
      else if (l.startsWith('TRIGGER:')) cur.alarms.push(l.slice(8));
    }
  }
  assert.strictEqual(events.length, 168);
  assert.strictEqual(new Set(events.map(e => e.uid)).size, 168, 'UID 唯一');

  const p8 = s => C.pd(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  for (const e of events) {
    assert.strictEqual(C.diffD(p8(e.start), p8(e.end)), 1, 'DTEND 次日');
    if (e.sum.startsWith('【还款】'))
      assert.strictEqual(e.alarms.join(), '-P2DT15H,-PT15H,PT9H', '还款三响');
    else
      assert.strictEqual(e.alarms.join(), 'PT9H', '可刷一响');
  }

  for (const [bank, sd, bf, remindDom] of banks) {
    const dues = events.filter(e => e.sum === '【还款】' + bank)
                       .map(e => p8(e.start)).sort((a, b) => a - b);
    assert.strictEqual(dues.length, 12, bank);
    let a = C.nextStmt(sd, now);
    for (let m = 0; m < 12; m++) {
      assert.strictEqual(C.fd(dues[m]), C.fd(C.addD(a, -bf)), `${bank} 第${m + 1}月`);
      assert.strictEqual(dues[m].getDate(), remindDom, `${bank} 提醒固定${remindDom}号`);
      a = C.nextStmt(sd, C.addD(a, 1));
    }
  }
});

test('buildICS：账单日31号的月末路径 与 多人模式描述', () => {
  const card = { id: 'e31', bank: '月末卡', last4: '****', statementDay: 31, buffer: 3, personId: 'p1' };
  const now = C.pd('2026-07-27');
  const { text } = C.buildICS([card], [{ id: 'p1', name: '老张' }], SETTINGS,
                              { now, stamp: '20260727T000000Z', multiUser: true });
  const t = text.replace(/\r\n[ \t]/g, '');
  assert.ok(t.includes('持卡人：老张'), '多人模式注明持卡人');
  const starts = [...t.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map(m => m[1]);
  for (const s of starts) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    assert.ok(d <= new Date(y, mo, 0).getDate(), '日期不越界 ' + s);
  }
  // 单人模式不出现持卡人字样
  const single = C.buildICS([card], [{ id: 'p1', name: '老张' }], SETTINGS,
                            { now, stamp: '20260727T000000Z' }).text.replace(/\r\n[ \t]/g, '');
  assert.ok(!single.includes('持卡人'), '单人模式不出现持卡人');
});
