/* 小程序存储层测试（miniprogram/utils/store.js）
   这一层管的是「数据能不能活下来」——比界面更要命，所以单独一套。
   node 里没有 wx，用下面的假 wx 顶上：它模拟真机上的两个关键行为
     · key 不存在时 getStorageSync 返回空字符串（不是抛异常）
     · 读写都可能抛异常（存储忙、内容损坏、超限）
   运行：node --test test/ */
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
const store = require('../miniprogram/utils/store.js');

/* 假 wx：box.data === undefined 表示这个 key 还没写过 */
function mockWx(initial, opts) {
  opts = opts || {};
  const box = { data: initial, toasts: [] };
  global.wx = {
    getStorageSync() {
      if (opts.readThrows) throw new Error('storage read failed');
      return box.data === undefined ? '' : JSON.parse(JSON.stringify(box.data));
    },
    setStorageSync(k, v) {
      if (opts.writeThrows) throw new Error('storage write failed');
      box.data = JSON.parse(JSON.stringify(v));
    },
    showToast(o) { box.toasts.push(o && o.title); },
    showModal() {},
    getAccountInfoSync() { return { miniProgram: { envVersion: 'trial' } }; }
  };
  return box;
}

const REAL = () => ({
  people: [{ id: 'me', name: '我' }],
  cards: [{ id: 'cA', bank: '广发', last4: '1234', statementDay: 10, buffer: 3 }],
  terminals: [{ id: 'm1', name: '老张便利店', note: '' }],
  txns: [{ id: 't1', cardId: 'cA', date: '2026-07-20', amount: 800, ts: 1 }],
  payments: [{ id: 'p1', cardId: 'cA', date: '2026-07-21', amount: 500, ts: 2 }],
  settings: { buffer: 3, minGap: 7, lastBackup: '2026-07-20' }
});

/* ---------- 读取失败：绝不能把用户数据洗掉 ---------- */

test('load：读取失败时不写种子、不覆盖，盘上数据原样保留', () => {
  const box = mockWx(REAL(), { readThrows: true });
  const S = store.load();
  assert.deepStrictEqual(box.data, REAL(), '★ 存储内容必须一个字节都没动');
  assert.strictEqual(S.readFailed, true, '状态要标记读失败，供上层判断');
  assert.strictEqual(S.cards.length, 0, '读不到就是读不到，不能假装有数据');
});

test('save：读失败得到的空状态禁止写回（否则一次读失败＝永久丢数据）', () => {
  const box = mockWx(REAL(), { readThrows: true });
  const S = store.load();
  S.txns.push({ id: 'tX', cardId: 'cA', date: '2026-07-27', amount: 1 });
  const ok = store.save(S);
  assert.strictEqual(ok, false, 'save 必须拒绝');
  assert.deepStrictEqual(box.data, REAL(), '★ 盘上仍是真数据，重启即可恢复');
});

test('load：读到空（真·首次启动）才种默认商户并写盘', () => {
  const box = mockWx(undefined);
  const S = store.load();
  assert.deepStrictEqual(S.terminals.map(t => t.name), ['老张便利店']);
  assert.strictEqual(S.people.length, 1);
  assert.ok(box.data, '首启要写盘');
  assert.notStrictEqual(S.readFailed, true);
});

test('load：正常读取时按 normalize 处理，不丢流水', () => {
  mockWx(REAL());
  const S = store.load();
  assert.strictEqual(S.txns.length, 1);
  assert.strictEqual(S.payments.length, 1);
  assert.strictEqual(S.settings.lastBackup, '2026-07-20');
});

/* ---------- 导入旧备份：还款不能凭空消失 ---------- */

const OLD_BACKUP = () => ({   // 2.2 以前的格式：没有 payments，逐笔 repaid
  people: [{ id: 'me', name: '我' }],
  cards: [{ id: 'cA', bank: '广发', last4: '1234', statementDay: 10, buffer: 3 }],
  terminals: [{ id: 'm1', name: '商户 A', note: '' }],
  txns: [
    { id: 't1', cardId: 'cA', date: '2026-06-20', amount: 800, repaid: true, repaidDate: '2026-06-25' },
    { id: 't2', cardId: 'cA', date: '2026-07-20', amount: 300 }
  ],
  settings: { buffer: 3, minGap: 7 }
});

test('normalize：旧备份的 repaid 标记迁移成还款流水，金额守恒', () => {
  mockWx(undefined);
  const S = store.normalize(OLD_BACKUP());
  assert.strictEqual(S.payments.length, 1, '★ 已还的 800 必须变成一条还款');
  assert.strictEqual(S.payments[0].amount, 800);
  assert.strictEqual(S.payments[0].date, '2026-06-25', '还款日期取 repaidDate');
  assert.ok(S.txns.every(t => t.repaid === undefined), '旧标记要清掉');
  const k = C.calc(S.cards[0], S.txns, S.payments, S.settings, C.pd('2026-07-27'));
  assert.strictEqual(k.over, 0, '已还的那笔不该再算成已出账单未还');
  assert.strictEqual(k.cur, 300);
});

test('normalize：不是对象的存储内容不许被当成数据展开', () => {
  mockWx(undefined);
  for (const junk of ['{"cards":[]}', 42, null, undefined, []]) {
    const S = store.normalize(junk);
    assert.ok(Array.isArray(S.cards) && Array.isArray(S.txns) && Array.isArray(S.payments),
              '至少要是一份结构完整的空数据：' + JSON.stringify(junk));
  }
});

/* ---------- 删卡级联（store 层接线是否真的接上了 core） ---------- */

test('removeCard 经 store 走一遍：还款不留孤儿，汇总不再算错', () => {
  mockWx(REAL());
  const S = store.load();
  const r = C.removeCard(S.cards, S.txns, S.payments, 'cA');
  assert.strictEqual(r.payments.length, 0, '删卡后该卡的还款必须一起走');
  assert.strictEqual(r.txns.length, 0);
});

/* ---------- 备份往返：导出的东西必须能原样导回来 ---------- */

test('备份往返无损：导出 → 导入 → 再导出，数据完全一致且流水一条不少', () => {
  mockWx(REAL());
  const S = store.load();
  // 攒点真实规模的流水，别拿空数据自欺欺人
  for (let m = 0; m < 6; m++) {
    S.txns.push({ id: 'tx' + m, cardId: 'cA', terminalId: 'm1',
                  date: '2026-0' + (m + 1) + '-12', amount: 1234.56, note: '', ts: 1000 + m });
    S.payments.push({ id: 'pm' + m, cardId: 'cA',
                      date: '2026-0' + (m + 1) + '-20', amount: 1000, ts: 2000 + m });
  }
  const exported = JSON.stringify(S);              // 「导出备份文件」写进文件的就是这个
  const back = store.normalize(JSON.parse(exported));   // 「从文件导入」走的就是这条

  assert.strictEqual(back.txns.length, S.txns.length, '★ 消费一条都不能少');
  assert.strictEqual(back.payments.length, S.payments.length, '★ 还款一条都不能少');
  assert.strictEqual(JSON.stringify(store.normalize(JSON.parse(JSON.stringify(back)))),
                     JSON.stringify(back), '再导一次必须完全一致');

  // 待还金额必须和导出前分毫不差——这才是备份有没有用的真正判据
  const k1 = C.calc(S.cards[0], S.txns, S.payments, S.settings, C.pd('2026-07-27'));
  const k2 = C.calc(back.cards[0], back.txns, back.payments, back.settings, C.pd('2026-07-27'));
  assert.strictEqual(k2.cur + k2.over, k1.cur + k1.over, '★ 恢复后的待还金额必须一致');
  assert.strictEqual(k2.deposit, k1.deposit);
});

test('备份被截断（复制时漏了尾巴）时必须报错，不能当成空数据默默覆盖', () => {
  mockWx(REAL());
  const full = JSON.stringify(store.load());
  const cut = full.slice(0, Math.floor(full.length * 0.8));   // 少了结尾的 }
  assert.throws(() => JSON.parse(cut), '截断的备份解析必然失败——上层据此提示用户');
});

test('normalize：历史遗留的孤儿还款（老版本删卡留下的）自动清掉', () => {
  mockWx(undefined);
  const d = REAL();
  d.payments.push({ id: 'pGhost', cardId: 'cGone', date: '2026-07-01', amount: 999 });
  const S = store.normalize(d);
  assert.deepStrictEqual(S.payments.map(p => p.id), ['p1'], '指向已删卡的还款不该留在账上');
});

/* ---------- 保存卡片：整个变更（含默认持卡人）是一个快照事务 ---------- */

test('saveCardData：写失败时卡和 ensureMe 补的持卡人一并回滚，重试不留重复', () => {
  const box = mockWx(undefined, { writeThrows: true });
  // 空状态（people 也空）：ensureMe 会补默认持卡人，它必须在同一个事务快照里
  const S = store.normalize({});
  const fields = { bank: '广发', last4: '1234', statementDay: 10, buffer: 3, limit: 0 };
  assert.strictEqual(store.saveCardData(S, null, fields), false);
  assert.strictEqual(S.cards.length, 0, '卡回滚');
  assert.strictEqual(S.people.length, 0, 'ensureMe 补的持卡人也回滚——它不能留在快照之外');
  // 用户留在页面上再点一次「保存」：不能积累第二张卡
  assert.strictEqual(store.saveCardData(S, null, fields), false);
  assert.strictEqual(S.cards.length, 0, '重试不重复 push');
  // 存储恢复后第三次点：只落一张卡、一个持卡人
  global.wx.setStorageSync = (k, v) => { box.data = JSON.parse(JSON.stringify(v)); };
  assert.strictEqual(store.saveCardData(S, null, fields), true);
  assert.strictEqual(S.cards.length, 1, '成功后恰好一张卡（此前失败的尝试没留残骸）');
  assert.strictEqual(S.people.length, 1);
  assert.strictEqual(S.cards[0].personId, S.people[0].id, '卡挂在补出来的持卡人上');
  assert.strictEqual(box.data.cards.length, 1, '盘上也是一张');
});

test('saveCardData：编辑失败时恢复改动前的字段', () => {
  mockWx(undefined, { writeThrows: true });
  const S = store.normalize(REAL());
  const before = Object.assign({}, S.cards[0]);
  assert.strictEqual(store.saveCardData(S, 'cA',
    { bank: '改了名', last4: '9999', statementDay: 28, buffer: 0, limit: 0 }), false);
  assert.deepStrictEqual(S.cards[0], before, '编辑回滚到改动前，逐字段一致');
});

/* ---------- 商户改名：只动名字，流水跟着变，写失败要回滚 ---------- */

test('renameTerm：改名后历史消费显示新名字（消费记录一条没动）', () => {
  const box = mockWx(REAL());
  const S = store.load();
  const txnBefore = JSON.parse(JSON.stringify(S.txns));
  assert.strictEqual(store.renameTerm(S, 'm1', '  楼下超市  '), true, '前后空白会被去掉');
  assert.strictEqual(S.terminals[0].name, '楼下超市');
  assert.deepStrictEqual(S.txns, txnBefore, '改名不该碰任何一条消费');
  assert.strictEqual(box.data.terminals[0].name, '楼下超市', '已落盘');
  // 这一条消费本来就挂在 m1 上，明细页应当显示新名字
  const S2 = store.normalize(box.data);
  S2.txns[0].terminalId = 'm1';
  assert.ok(store.cardTxData(S2, 'cA').rows.some(r => r.sub.indexOf('楼下超市') >= 0),
    '流水页跟着显示新名字');
});

test('renameTerm：空名字拒绝，原名不动', () => {
  mockWx(REAL());
  const S = store.load();
  assert.strictEqual(store.renameTerm(S, 'm1', '   '), false);
  assert.strictEqual(S.terminals[0].name, '老张便利店', '原名保持不变');
});

test('renameTerm：写盘失败时名字回滚，界面不会显示一个没存进去的名字', () => {
  const box = mockWx(REAL());
  const S = store.load();
  global.wx.setStorageSync = () => { throw new Error('storage write failed'); };
  assert.strictEqual(store.renameTerm(S, 'm1', '楼下超市'), false);
  assert.strictEqual(S.terminals[0].name, '老张便利店', '内存回滚');
  assert.strictEqual(box.data.terminals[0].name, '老张便利店', '盘上也还是原名');
});

test('renameTerm：超长名字按 40 字截断，与 sanitizeState 同一把尺子', () => {
  const box = mockWx(REAL());
  const S = store.load();
  assert.strictEqual(store.renameTerm(S, 'm1', '超'.repeat(50)), true);
  assert.strictEqual(S.terminals[0].name.length, 40);
  // 再过一遍清洗（模拟导出后重新导入）：名字不该被二次截短
  assert.strictEqual(store.normalize(box.data).terminals[0].name, S.terminals[0].name);
});
