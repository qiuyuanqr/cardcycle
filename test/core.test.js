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

  k = C.calc(card, txns, pay(9999), SETTINGS, ref);      // 多还：全部冲清，剩余是存款
  assert.strictEqual(k.cur + k.over, 0); assert.strictEqual(k.st, 'idle');
  assert.strictEqual(k.deposit, 9999 - 300, '超出全部消费的部分记为存款');
  assert.strictEqual(k.label, '已还清', '本期刷过又还清 ≠ 本期未刷');

  k = C.calc(card, txns, pay(250), SETTINGS, ref);       // 没还够时没有存款
  assert.strictEqual(k.deposit, 0);

  // 只有上期消费、已还清：本期确实没刷过
  k = C.calc(card, [{ id: 'a', cardId: 'c1', date: '2026-07-01', amount: 100 }],
             pay(100), SETTINGS, ref);
  assert.strictEqual(k.label, '本期未刷');
  assert.strictEqual(k.deposit, 0);

  // 他卡的还款不影响本卡
  k = C.calc(card, txns, [{ id: 'p2', cardId: 'c2', date: '2026-07-26', amount: 300 }], SETTINGS, ref);
  assert.strictEqual(k.over, 100); assert.strictEqual(k.cur, 200);

  // 浮点：0.1+0.2 的消费，还 0.3 应清零
  const f = [{ id: 'x1', cardId: 'c1', date: '2026-07-10', amount: 0.1 },
             { id: 'x2', cardId: 'c1', date: '2026-07-11', amount: 0.2 }];
  k = C.calc(card, f, pay(0.3), SETTINGS, ref);
  assert.strictEqual(k.cur + k.over, 0); assert.strictEqual(k.st, 'idle');
});

test('calc：未来周期的消费单独计数，不进 cur/over，但仍占用还款额度', () => {
  const card = { id: 'c1', statementDay: 5, buffer: 3 };
  const ref = C.pd('2026-07-27');            // 周期 7/6–8/5
  const txns = [
    { id: 'a', cardId: 'c1', date: '2026-07-10', amount: 50 },
    { id: 'typo', cardId: 'c1', date: '2027-01-01', amount: 100 },  // 日期手滑录到未来
  ];
  const pay = [{ id: 'p1', cardId: 'c1', date: '2026-07-27', amount: 100 }];

  let k = C.calc(card, txns, [], SETTINGS, ref);
  assert.strictEqual(k.futN, 1, '未来消费笔数');
  assert.strictEqual(k.fut, 100, '未来消费金额（原额）');
  assert.strictEqual(k.cur, 50, '不进本期');
  assert.strictEqual(k.over, 0, '不进逾期');

  // 现状固化：还款按日期顺序冲抵，未来那笔也占额度——
  // 本应显示存款 50，被它无声吃掉。界面靠 futN>0 提示用户去流水核对。
  k = C.calc(card, txns, pay, SETTINGS, ref);
  assert.strictEqual(k.cur + k.over, 0);
  assert.strictEqual(k.deposit, 0, '存款被未来消费占用');
  assert.strictEqual(k.futN, 1);

  // 对照：删掉未来那笔，存款回来
  k = C.calc(card, [txns[0]], pay, SETTINGS, ref);
  assert.strictEqual(k.futN, 0);
  assert.strictEqual(k.fut, 0);
  assert.strictEqual(k.deposit, 50);

  // 日期在今天之后、但仍在本周期内（8/1 ≤ 账单日 8/5）的不算未来周期
  k = C.calc(card, [{ id: 'b', cardId: 'c1', date: '2026-08-01', amount: 30 }], [], SETTINGS, ref);
  assert.strictEqual(k.futN, 0, '本周期内的未来日期不算');
  assert.strictEqual(k.cur, 30);
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
    if (C.fd(C.addD(a, -bf)) < C.fd(now)) a = C.nextStmt(sd, C.addD(a, 1));  // 过期还款提醒顺延到下周期
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

/* ---- 「最近变动」排序 ---------------------------------------- */

test('lastActTs：优先记账时刻 ts，老记录退回日期 0 点，无流水返回 0', () => {
  const txns = [
    { cardId: 'a', date: '2026-07-27' },                                          // 老记录无 ts
    { cardId: 'b', date: '2026-07-27', ts: C.pd('2026-07-27').getTime() + 3600e3 },
  ];
  const pays = [{ cardId: 'c', date: '2026-07-25', ts: C.pd('2026-07-25').getTime() + 100 }];
  assert.strictEqual(C.lastActTs(txns, pays, 'a'), C.pd('2026-07-27').getTime());
  assert.ok(C.lastActTs(txns, pays, 'b') > C.lastActTs(txns, pays, 'a'), '同一天，刚记的更新');
  assert.strictEqual(C.lastActTs(txns, pays, 'c'), C.pd('2026-07-25').getTime() + 100, '还款也算变动');
  assert.strictEqual(C.lastActTs(txns, pays, 'x'), 0, '从未有流水返回 0');
});

test('recent 排序：欠款卡在前 → 无欠款但有流水 → 从未操作沉底；档内按记账时刻倒序', () => {
  const T = d => C.pd(d).getTime();
  const mk = (id, st, actTs) => ({ id, band: C.recentBand(st, actTs), actTs });
  const views = [
    mk('广州', 'ok',   T('2026-07-27')),         // 欠款，同日老记录（0 点）
    mk('光大', 'idle', T('2026-07-27') + 2000),  // 刚还清，无欠款
    mk('中信', 'ok',   T('2026-07-27') + 5000),  // 欠款，最新一笔操作
    mk('广发', 'idle', 0),                       // 从未操作
    mk('浦发', 'idle', 0),                       // 从未操作（相对顺序不变）
  ];
  views.sort(C.recentCmp);
  assert.deepStrictEqual(views.map(v => v.id), ['中信', '广州', '光大', '广发', '浦发']);
});

/* ---- 流水排序（与概览「最近变动」同口径） -------------------- */

test('txnCmp：日期倒序优先，同一天按记账时刻倒序，老记录沉在同日之后', () => {
  const T = d => C.pd(d).getTime();
  const rows = [
    { id: 'r1', date: '2026-07-20', ts: T('2026-07-20') + 9e6 },  // 更早的日期，哪怕记账时刻很晚
    { id: 'r2', date: '2026-07-27' },                             // 老记录，无 ts
    { id: 'r3', date: '2026-07-27', ts: T('2026-07-27') + 1000 },
    { id: 'r4', date: '2026-07-27', ts: T('2026-07-27') + 5000 },
  ];
  rows.sort(C.txnCmp);
  assert.deepStrictEqual(rows.map(r => r.id), ['r4', 'r3', 'r2', 'r1']);
  // 同日、同为老记录：顺序必须稳定可复现（不能随 id 随机跳动）
  const old = [{ id: 'b', date: '2026-07-27' }, { id: 'a', date: '2026-07-27' }];
  assert.deepStrictEqual(old.slice().sort(C.txnCmp).map(r => r.id),
                         old.slice().reverse().sort(C.txnCmp).map(r => r.id));
});

/* ---- 删卡/删人的级联清理 ------------------------------------- */

test('removeCard：删卡连消费与还款一起删，别的卡分毫不动', () => {
  const cards = [{ id: 'cA' }, { id: 'cB' }];
  const txns = [{ id: 't1', cardId: 'cA' }, { id: 't2', cardId: 'cB' }];
  const pays = [{ id: 'p1', cardId: 'cA' }, { id: 'p2', cardId: 'cB' }];
  const r = C.removeCard(cards, txns, pays, 'cA');
  assert.deepStrictEqual(r.cards.map(c => c.id), ['cB']);
  assert.deepStrictEqual(r.txns.map(t => t.id), ['t2']);
  assert.deepStrictEqual(r.payments.map(p => p.id), ['p2'], '还款不能留成孤儿');
  assert.strictEqual(txns.length, 2, '纯函数：不改传入数组');
  assert.strictEqual(pays.length, 2);
});

test('removePerson：名下所有卡连同两本流水一起删', () => {
  const people = [{ id: 'me' }, { id: 'lz' }];
  const cards = [{ id: 'cA', personId: 'me' }, { id: 'cB', personId: 'lz' }, { id: 'cC', personId: 'me' }];
  const txns = [{ id: 't1', cardId: 'cA' }, { id: 't2', cardId: 'cB' }, { id: 't3', cardId: 'cC' }];
  const pays = [{ id: 'p1', cardId: 'cC' }, { id: 'p2', cardId: 'cB' }];
  const r = C.removePerson(people, cards, txns, pays, 'me');
  assert.deepStrictEqual(r.people.map(p => p.id), ['lz']);
  assert.deepStrictEqual(r.cards.map(c => c.id), ['cB']);
  assert.deepStrictEqual(r.txns.map(t => t.id), ['t2']);
  assert.deepStrictEqual(r.payments.map(p => p.id), ['p2']);
});

test('pruneOrphans：清掉指向已删卡的流水；一张卡都没有时绝不动手', () => {
  const cards = [{ id: 'cB' }];
  const txns = [{ id: 't1', cardId: 'cA' }, { id: 't2', cardId: 'cB' }];
  const pays = [{ id: 'p1', cardId: 'cA' }, { id: 'p2', cardId: 'cB' }];
  const r = C.pruneOrphans(cards, txns, pays);
  assert.deepStrictEqual(r.txns.map(t => t.id), ['t2']);
  assert.deepStrictEqual(r.payments.map(p => p.id), ['p2']);
  assert.strictEqual(r.removed, 2);
  // ★ 安全阀：cards 为空可能是读取异常而非「真的一张卡都没有」，
  //   此时若按孤儿清理会把全部流水删光——必须原样返回。
  const safe = C.pruneOrphans([], txns, pays);
  assert.strictEqual(safe.txns.length, 2, '没有卡时不许删流水');
  assert.strictEqual(safe.payments.length, 2);
  assert.strictEqual(safe.removed, 0);
});

/* ---- 提前天数：0 是合法值，不能被当成「没填」 ---------------- */

test('bufOf：0 天必须生效，不能回落成默认 3', () => {
  assert.strictEqual(C.bufOf({ buffer: 0 }, { buffer: 5 }), 0, '卡上设 0 天');
  assert.strictEqual(C.bufOf({}, { buffer: 0 }), 0, '全局默认设 0 天');
  assert.strictEqual(C.bufOf({}, { buffer: 4 }), 4);
  assert.strictEqual(C.bufOf({}, {}), 3, '真没设才用 3');
  assert.strictEqual(C.bufOf({}, null), 3);
});

test('pruneSeedTerminals：清理旧版占位商户，真实商户绝不动', () => {
  const mk = (id, name, note) => ({ id, name, note: note || '' });
  // 全是没用过的旧占位 → 清空并补默认「老张便利店」
  const a = C.pruneSeedTerminals(
    [mk('1', '商户 A'), mk('2', '商户 B'), mk('3', '商户 C'), mk('4', '商户 D')], [], () => 'n1');
  assert.deepStrictEqual(a.map(t => t.name), ['老张便利店']);
  // 记过账的占位保留，没用过的清掉；自定义名字的不动
  const b = C.pruneSeedTerminals(
    [mk('1', 'A 机器'), mk('2', 'B 机器'), mk('5', '真商户')],
    [{ terminalId: '1' }], () => 'n2');
  assert.deepStrictEqual(b.map(t => t.name), ['A 机器', '真商户']);
  // 带备注的占位名视为用户自己的，不动
  const c = C.pruneSeedTerminals([mk('1', '商户 A', '有备注')], [], () => 'n3');
  assert.deepStrictEqual(c.map(t => t.name), ['商户 A']);
  // 已是新种子的不重复补；用户主动清空列表的不强塞默认
  assert.deepStrictEqual(C.pruneSeedTerminals([mk('9', '老张便利店')], [], () => 'n4')
    .map(t => t.name), ['老张便利店']);
  assert.deepStrictEqual(C.pruneSeedTerminals([], [], () => 'n5'), []);
});

/* ---- 金额输入解析（记消费/登记还款入口共用） ------------------ */

test('parseAmount：只认有限、正、最多两位小数、不超一亿的金额', () => {
  assert.strictEqual(C.parseAmount('100'), 100);
  assert.strictEqual(C.parseAmount('99.5'), 99.5);
  assert.strictEqual(C.parseAmount('0.01'), 0.01, '最小合法金额一分');
  assert.strictEqual(C.parseAmount(' 250.00 '), 250, '首尾空白容忍');
  // 以下全部拒绝
  assert.strictEqual(C.parseAmount('0.001'), null, '超两位小数：舍入成 0 也不许「已登记 ¥0.00」');
  assert.strictEqual(C.parseAmount('1.005'), null, '超两位小数');
  assert.strictEqual(C.parseAmount('1e999'), null, 'Infinity：JSON 往返会变 null、金额归零');
  assert.strictEqual(C.parseAmount('Infinity'), null);
  assert.strictEqual(C.parseAmount('NaN'), null);
  assert.strictEqual(C.parseAmount('abc'), null);
  assert.strictEqual(C.parseAmount(''), null);
  assert.strictEqual(C.parseAmount(null), null);
  assert.strictEqual(C.parseAmount('0'), null);
  assert.strictEqual(C.parseAmount('-5'), null);
  assert.strictEqual(C.parseAmount('100000001'), null, '超过一亿拒绝');
});

/* ---- 导入数据的字段清洗（防恶意备份自 XSS） ------------------- */

test('sanitizeState：不合法 id 重发且引用跟着映射走，拼进 onclick 不再有注入面', () => {
  const evil = "x'); alert(document.cookie); ('";
  const s = C.sanitizeState({
    cards: [{ id: evil, bank: '广发', statementDay: 10 }],
    txns: [{ id: 't1', cardId: evil, date: '2026-08-01', amount: 100 }],
    payments: [{ id: 'p1', cardId: evil, date: '2026-08-02', amount: 50 }]
  }, (() => { let i = 0; return () => 'new' + (++i); })());
  assert.match(s.cards[0].id, /^[\w-]{1,32}$/, 'id 重发成安全字符');
  assert.strictEqual(s.txns[0].cardId, s.cards[0].id, '消费引用跟着新 id');
  assert.strictEqual(s.payments[0].cardId, s.cards[0].id, '还款引用跟着新 id');
});

test('sanitizeState：坏日期/坏金额整条丢弃并计数，好记录一条不丢', () => {
  const s = C.sanitizeState({
    txns: [
      { id: 'a', cardId: 'c', date: '2026-08-01', amount: 100, ts: 5 },
      { id: 'b', cardId: 'c', date: "08-01');evil(", amount: 100 },   // 坏日期
      { id: 'c', cardId: 'c', date: '2026-02-30', amount: 100 },      // 不存在的日期
      { id: 'd', cardId: 'c', date: '2026-08-01', amount: null }      // Infinity 经 JSON 往返后的样子
    ],
    payments: [{ id: 'e', cardId: 'c', date: '2026-08-02', amount: 'NaN' }]
  });
  assert.strictEqual(s.txns.length, 1);
  assert.strictEqual(s.txns[0].ts, 5, '合法 ts 保留');
  assert.strictEqual(s.payments.length, 0);
  assert.strictEqual(s.dropped, 4, '丢了几条要如实报数');
});

test('sanitizeState：正常数据原样通过（金额不拦小数位——入口从严、存量宽容）', () => {
  const good = {
    people: [{ id: 'p1', name: '我' }],
    cards: [{ id: 'c1', personId: 'p1', bank: '建设', last4: '1234', statementDay: 28, buffer: 0, limit: 50000 }],
    terminals: [{ id: 't1', name: '老张便利店', note: '' }],
    txns: [{ id: 'x1', cardId: 'c1', terminalId: 't1', date: '2026-07-30', amount: 0.001, note: '老记录', ts: 9 }],
    payments: [{ id: 'y1', cardId: 'c1', date: '2026-07-31', amount: 200, ts: 10 }],
    settings: { buffer: 0, minGap: 0, lastBackup: '2026-07-01', multiUser: true, cardSort: 'custom', swipeStyle: 'list' }
  };
  const s = C.sanitizeState(good);
  assert.deepStrictEqual(s.cards, good.cards, '卡片逐字段不变（含 buffer 0）');
  assert.strictEqual(s.txns[0].amount, 0.001, '存量小金额不丢');
  assert.strictEqual(s.settings.minGap, 0, '间隔 0 是合法值');
  assert.strictEqual(s.settings.cardSort, 'custom');
  assert.strictEqual(s.dropped, 0);
});

test('sanitizeState：settings 白名单——乱值回默认，statementDay 夹到 1–31', () => {
  const s = C.sanitizeState({
    cards: [{ id: 'c1', bank: 'B', statementDay: '<img onerror=x>' }],
    settings: { buffer: 'evil', minGap: -3, cardSort: 'hax', swipeStyle: 42, multiUser: 'yes', lastBackup: 'junk' }
  });
  assert.strictEqual(s.cards[0].statementDay, 1);
  assert.strictEqual(s.settings.buffer, 3, '乱值回默认');
  assert.strictEqual(s.settings.minGap, 0, '负数夹到 0');
  assert.strictEqual(s.settings.cardSort, 'smart');
  assert.strictEqual(s.settings.swipeStyle, 'chips');
  assert.strictEqual(s.settings.multiUser, false, '只认 === true');
  assert.strictEqual(s.settings.lastBackup, null);
});
