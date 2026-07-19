(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MoneyCheck = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CATEGORY_RULES = [
    ["餐饮", /餐|饭|早餐|午餐|晚餐|咖啡|茶|甜点|外卖|美团|饿了么|便利店|食品/i],
    ["交通", /车|出行|地铁|公交|滴滴|打车|加油|停车|铁路|机票/i],
    ["购物", /超市|商场|淘宝|天猫|京东|拼多多|日用品|服饰|数码/i],
    ["居住", /房租|物业|水费|电费|燃气|宽带|装修/i],
    ["娱乐", /会员|视频|游戏|电影|演出|旅游|酒店/i],
    ["健康", /医院|药|诊所|体检|医疗|健身/i],
    ["学习", /书|课程|培训|教育|学费/i],
    ["人情", /红包|礼物|转账|份子/i]
  ];

  const DEMO_CSV = `交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态
2026-07-01 08:15:00,商户消费,晨光便利店,早餐,支出,12.50,零钱,支付成功
2026-07-01 12:20:00,商户消费,好味餐厅,午餐,支出,36.00,银行卡,支付成功
2026-07-02 18:30:00,商户消费,好味餐厅,晚餐,支出,42.00,银行卡,支付成功
2026-07-03 09:00:00,转账,公司,工资,收入,8500.00,零钱,已收钱
2026-07-04 10:05:00,商户消费,城市出行,网约车,支出,28.00,零钱,支付成功
2026-07-04 22:10:00,商户消费,视频会员,自动续费,支出,25.00,零钱,支付成功
2026-07-05 15:20:00,商户消费,甜点工坊,下午茶,支出,19.90,零钱,支付成功
2026-07-06 15:22:00,商户消费,甜点工坊,下午茶,支出,19.90,零钱,支付成功
2026-07-07 20:00:00,商户消费,城市超市,日用品,支出,168.00,银行卡,支付成功
2026-07-08 11:00:00,转账,朋友,还款,收入,200.00,零钱,已收钱`;

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    const input = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(cell.trim()); cell = ""; }
      else if (char === '\n') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
      else if (char !== '\r') cell += char;
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function keyOf(value) {
    return String(value || "").replace(/[\s（）()]/g, "").toLowerCase();
  }

  function findHeaderIndex(rows) {
    return rows.findIndex(row => {
      const keys = row.map(keyOf);
      const hasAmount = keys.some(k => ["金额元", "金额", "交易金额"].includes(k));
      const hasParty = keys.some(k => ["交易对方", "商户名称", "对方"].includes(k));
      return hasAmount && hasParty;
    });
  }

  function pick(record, names) {
    for (const name of names) {
      const value = record[keyOf(name)];
      if (value !== undefined && value !== "") return value;
    }
    return "";
  }

  function parseAmount(value) {
    const number = Number(String(value || "").replace(/[¥￥,\s]/g, ""));
    return Number.isFinite(number) ? Math.abs(number) : 0;
  }

  function categoryFor(transaction) {
    const haystack = `${transaction.merchant} ${transaction.item} ${transaction.type}`;
    for (const [name, pattern] of CATEGORY_RULES) if (pattern.test(haystack)) return name;
    return "其他";
  }

  function normalizeBill(text, sourceName) {
    const rows = parseCsv(text);
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) throw new Error(`${sourceName || "账单"}：未识别到微信或支付宝账单表头`);
    const headers = rows[headerIndex].map(keyOf);
    return rows.slice(headerIndex + 1).map((row, index) => {
      const record = {};
      headers.forEach((header, i) => { record[header] = row[i] || ""; });
      const directionRaw = pick(record, ["收/支", "收支", "资金状态", "交易类型"]);
      const status = pick(record, ["当前状态", "交易状态", "状态"]);
      const amount = parseAmount(pick(record, ["金额(元)", "金额（元）", "金额", "交易金额"]));
      const merchant = pick(record, ["交易对方", "商户名称", "对方"]) || "未知对方";
      const item = pick(record, ["商品", "商品名称", "商品说明", "备注"]);
      const date = pick(record, ["交易时间", "交易创建时间", "付款时间", "时间"]);
      const isIncome = /收入|已收|收款/.test(directionRaw) && !/支出/.test(directionRaw);
      const transaction = {
        id: `${sourceName || "bill"}-${index}`,
        date, merchant, item, amount, status,
        type: isIncome ? "income" : "expense",
        source: sourceName || "账单"
      };
      transaction.category = categoryFor(transaction);
      return transaction;
    }).filter(tx => tx.amount > 0 && !/退款成功|交易关闭|已全额退款/.test(tx.status));
  }

  function groupSum(items, keyFn) {
    return items.reduce((map, item) => {
      const key = keyFn(item);
      map[key] = (map[key] || 0) + item.amount;
      return map;
    }, {});
  }

  function analyze(transactions) {
    const expenses = transactions.filter(t => t.type === "expense");
    const incomes = transactions.filter(t => t.type === "income");
    const expense = expenses.reduce((sum, t) => sum + t.amount, 0);
    const income = incomes.reduce((sum, t) => sum + t.amount, 0);
    const categories = groupSum(expenses, t => t.category);
    const merchants = groupSum(expenses, t => t.merchant);
    const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    const sortedMerchants = Object.entries(merchants).sort((a, b) => b[1] - a[1]);
    const dates = transactions.map(t => t.date).filter(Boolean).sort();
    const threshold = expense ? Math.max(100, expense * 0.12) : 100;
    const duplicateKeys = expenses.reduce((map, t) => {
      const key = `${t.merchant}|${t.amount.toFixed(2)}`;
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});
    const notable = expenses.filter(t => t.amount >= threshold || duplicateKeys[`${t.merchant}|${t.amount.toFixed(2)}`] > 1)
      .sort((a, b) => b.amount - a.amount).slice(0, 12);
    return {
      count: transactions.length, expense, income, balance: income - expense,
      categories: sortedCategories, merchants: sortedMerchants,
      notable, period: dates.length ? `${dates[0].slice(0, 10)} — ${dates[dates.length - 1].slice(0, 10)}` : "未知周期",
      advice: buildAdvice({expense, income, expenses, sortedCategories, sortedMerchants, duplicateKeys})
    };
  }

  function buildAdvice(data) {
    if (!data.expenses.length) return ["当前没有可分析的支出记录。请检查账单是否包含“收/支”和金额列。"];
    const advice = [];
    const [topCategory, topCategoryAmount] = data.sortedCategories[0] || ["其他", 0];
    const share = data.expense ? topCategoryAmount / data.expense : 0;
    advice.push(`最大支出是<b>${topCategory}</b>，占总支出的 ${(share * 100).toFixed(0)}%。先给这一类设一个比本期低 10% 的上限，目标约减少 ¥${(topCategoryAmount * .1).toFixed(0)}。`);
    const repeats = Object.entries(data.duplicateKeys).filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
    if (repeats.length) {
      const [key, count] = repeats[0];
      const [merchant, amount] = key.split("|");
      advice.push(`<b>${merchant}</b> 出现 ${count} 笔相同金额 ¥${Number(amount).toFixed(2)}。检查是否为自动续费或容易忽略的固定习惯。`);
    } else {
      const [merchant, amount] = data.sortedMerchants[0] || ["暂无", 0];
      advice.push(`本期在 <b>${merchant}</b> 支出最多，共 ¥${amount.toFixed(2)}。下次消费前先查看本期累计值，减少无感重复购买。`);
    }
    const small = data.expenses.filter(t => t.amount <= 30);
    const smallTotal = small.reduce((sum, t) => sum + t.amount, 0);
    advice.push(`30 元以内的小额支出共有 <b>${small.length} 笔</b>，合计 ¥${smallTotal.toFixed(2)}。可设置每周小额消费总额，而不是逐笔自责。`);
    return advice.slice(0, 3);
  }

  function decodeBuffer(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    if ((utf8.match(/�/g) || []).length < 2) return utf8;
    try { return new TextDecoder("gb18030").decode(buffer); } catch (_) { return utf8; }
  }

  return { parseCsv, normalizeBill, analyze, categoryFor, decodeBuffer, DEMO_CSV };
});

if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  let allTransactions = [];
  const money = value => `¥${value.toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function render() {
    const result = MoneyCheck.analyze(allTransactions);
    $("dashboard").classList.toggle("hidden", !allTransactions.length);
    if (!allTransactions.length) return;
    $("period-title").textContent = result.period;
    $("expense-value").textContent = money(result.expense);
    $("income-value").textContent = money(result.income);
    $("balance-value").textContent = money(result.balance);
    $("count-value").textContent = result.count;
    const maxCategory = result.categories[0]?.[1] || 1;
    $("category-list").innerHTML = result.categories.map(([name, amount]) => `<div class="bar-row"><span>${escapeHtml(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${amount / maxCategory * 100}%"></div></div><strong>${money(amount)}</strong></div>`).join("") || "暂无支出";
    $("merchant-list").innerHTML = result.merchants.slice(0, 6).map(([name, amount]) => `<li>${escapeHtml(name)}<strong>${money(amount)}</strong></li>`).join("");
    $("advice-list").innerHTML = result.advice.map(text => `<div class="advice">${text}</div>`).join("");
    $("notable-table").innerHTML = result.notable.map(t => `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.merchant)}</td><td>${escapeHtml(t.item)}</td><td>${escapeHtml(t.category)}</td><td>${money(t.amount)}</td></tr>`).join("") || '<tr><td colspan="5">暂无明显的高额或重复支出</td></tr>';
  }

  async function loadFiles(files) {
    const loaded = [], errors = [];
    for (const file of files) {
      try {
        const text = MoneyCheck.decodeBuffer(await file.arrayBuffer());
        loaded.push(...MoneyCheck.normalizeBill(text, file.name));
      } catch (error) { errors.push(error.message); }
    }
    allTransactions = loaded;
    $("status").textContent = errors.length ? `读取 ${loaded.length} 笔；${errors.join("；")}` : `已读取 ${loaded.length} 笔交易，数据仅在当前页面处理。`;
    render();
  }

  $("bill-files").addEventListener("change", event => loadFiles(event.target.files));
  $("clear-button").addEventListener("click", () => { allTransactions = []; $("bill-files").value = ""; $("status").textContent = "已清空，本页不再保留账单数据。"; render(); });
  $("print-button").addEventListener("click", () => window.print());
  $("demo-button").addEventListener("click", () => {
    allTransactions = MoneyCheck.normalizeBill(MoneyCheck.DEMO_CSV, "演示账单");
    $("status").textContent = `已加载 ${allTransactions.length} 笔演示交易。`;
    render();
  });
  const zone = $("drop-zone");
  ["dragenter", "dragover"].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove("dragging"); }));
  zone.addEventListener("drop", event => loadFiles(event.dataTransfer.files));
}
