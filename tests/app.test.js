const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalizeBill, analyze, categoryFor, DEMO_CSV } = require('../app.js');

test('CSV parser supports quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y","z""q"'), [['a', 'b'], ['x,y', 'z"q']]);
});

test('normalizes WeChat bill rows and filters refunds', () => {
  const csv = [
    '微信支付账单',
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态',
    '2026-07-01 10:00:00,商户消费,咖啡店,拿铁,支出,18.00,支付成功',
    '2026-07-02 10:00:00,转账,朋友,还款,收入,100.00,已收钱',
    '2026-07-03 10:00:00,商户消费,商店,退款,支出,20.00,退款成功'
  ].join('\n');
  const rows = normalizeBill(csv, 'wechat.csv');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].category, '餐饮');
  assert.equal(rows[1].type, 'income');
});

test('normalizes common Alipay full-width amount header', () => {
  const csv = [
    '交易号,商家订单号,交易创建时间,交易对方,商品名称,金额（元）,收/支,交易状态',
    'a,b,2026-07-01 10:00:00,城市出行,网约车,25.50,支出,交易成功'
  ].join('\n');
  const rows = normalizeBill(csv, 'alipay.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 25.5);
  assert.equal(rows[0].category, '交通');
});

test('analysis computes totals and duplicate advice', () => {
  const rows = [
    {date:'2026-07-01', merchant:'视频会员', item:'续费', amount:25, type:'expense', category:'娱乐'},
    {date:'2026-07-02', merchant:'视频会员', item:'续费', amount:25, type:'expense', category:'娱乐'},
    {date:'2026-07-03', merchant:'公司', item:'工资', amount:1000, type:'income', category:'其他'}
  ];
  const result = analyze(rows);
  assert.equal(result.expense, 50);
  assert.equal(result.income, 1000);
  assert.equal(result.balance, 950);
  assert.match(result.advice[1], /出现 2 笔/);
});

test('category rules default safely', () => {
  assert.equal(categoryFor({merchant:'未知', item:'未知', type:'expense'}), '其他');
});

test('built-in demo works without a web server', () => {
  const rows = normalizeBill(DEMO_CSV, 'demo');
  const result = analyze(rows);
  assert.equal(rows.length, 10);
  assert.equal(result.expense, 351.3);
  assert.equal(result.income, 8700);
  assert.equal(result.advice.length, 3);
});
