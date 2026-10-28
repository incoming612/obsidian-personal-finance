import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/store.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2021',
  write: false
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`;
const { FinanceStore } = await import(moduleUrl);
const dateBuild = await build({ entryPoints: ['src/utils/date.ts'], bundle: true, platform: 'node', format: 'esm', target: 'es2021', write: false });
const dateUrl = `data:text/javascript;base64,${Buffer.from(dateBuild.outputFiles[0].contents).toString('base64')}`;
const { getDateRange, isValidDateRange, shiftPeriodDate, shiftDateRange, getMonthAnchorDate, getYearMonthDrilldown, todayLocalDate } = await import(dateUrl);
const exportBuild = await build({
  entryPoints: ['src/utils/export.ts'], bundle: true, platform: 'node', format: 'esm',
  target: 'es2021', write: false
});
const exportUrl = `data:text/javascript;base64,${Buffer.from(exportBuild.outputFiles[0].contents).toString('base64')}`;
const { buildTransactionsCsv, buildAccountsCsv } = await import(exportUrl);

function memoryPlugin(initial = null) {
  let saved = structuredClone(initial);
  return {
    async loadData() { return structuredClone(saved); },
    async saveData(next) { saved = structuredClone(next); },
    snapshot() { return structuredClone(saved); }
  };
}

test('migrates the existing phase-one accounts without losing balances or metadata', async () => {
  const oldData = JSON.parse(await readFile('data.v1.backup.json', 'utf8'));
  const plugin = memoryPlugin(oldData);
  const store = new FinanceStore(plugin);
  await store.load();

  const migrated = plugin.snapshot();
  assert.equal(migrated.schemaVersion, 15);
  assert.deepEqual(migrated.transactions, []);
  assert.equal(migrated.accounts.length, oldData.accounts.length);
  for (const oldAccount of oldData.accounts) {
    const account = migrated.accounts.find(item => item.id === oldAccount.id);
    assert.ok(account);
    assert.equal(account.openingBalance, oldAccount.balance);
    assert.equal(account.createdAt, oldAccount.createdAt);
    assert.equal(account.updatedAt, oldAccount.updatedAt);
    assert.equal(account.name, oldAccount.name);
    assert.equal(account.category, oldAccount.category);
    assert.equal('balance' in account, false);
    if (oldAccount.kind === 'asset') assert.equal(account.accountRole, 'cash');
    else assert.equal('accountRole' in account, false);
  }
  const reloaded = new FinanceStore(plugin);
  await reloaded.load();
  assert.equal(reloaded.getTotalAssets(), 600);
  assert.equal(reloaded.getTotalLiabilities(), 1200);
  assert.equal(reloaded.getNetWorth(), -600);
});

test('income, expense, editing, deletion, and reload recalculate current balance', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const account = await store.addAccount({
    name: '测试资产', kind: 'asset', category: '银行存款', openingBalance: 1000, note: ''
  });
  assert.equal(store.getCurrentBalance(account.id), 1000);

  await store.addTransaction({
    date: '2026-10-01', type: 'income', category: '奖学金', amount: 500,
    accountId: account.id, note: ''
  });
  assert.equal(store.getCurrentBalance(account.id), 1500);

  const expense = await store.addTransaction({
    date: '2026-10-01', type: 'expense', category: '餐饮', amount: 200,
    accountId: account.id, note: ''
  });
  assert.equal(store.getCurrentBalance(account.id), 1300);
  assert.equal(store.getTotalAssets(), 1300);

  await store.updateTransaction(expense.id, {
    date: expense.date, type: expense.type, category: expense.category,
    amount: 300, accountId: account.id, note: ''
  });
  assert.equal(store.getCurrentBalance(account.id), 1200);

  await store.deleteTransaction(expense.id);
  assert.equal(store.getCurrentBalance(account.id), 1500);

  const reloaded = new FinanceStore(plugin);
  await reloaded.load();
  assert.equal(reloaded.getCurrentBalance(account.id), 1500);
  assert.equal(reloaded.getAccounts('asset')[0].openingBalance, 1000);
  assert.equal(reloaded.getTransactions().length, 1);
});

test('moving an edited expense changes only the affected accounts and protects references', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const first = await store.addAccount({
    name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 100, note: ''
  });
  const second = await store.addAccount({
    name: '支付宝', kind: 'asset', category: '第三方支付', openingBalance: 100, note: ''
  });
  const liability = await store.addAccount({
    name: '贷款', kind: 'liability', category: '助学贷款', openingBalance: 80, note: ''
  });
  const expense = await store.addTransaction({
    date: '2026-09-30', type: 'expense', category: '餐饮', amount: 25,
    accountId: first.id, note: ''
  });
  assert.equal(store.getCurrentBalance(first.id), 75);
  await store.updateTransaction(expense.id, {
    date: '2026-10-01', type: 'expense', category: '餐饮', amount: 40,
    accountId: second.id, note: ''
  });
  assert.equal(store.getCurrentBalance(first.id), 100);
  assert.equal(store.getCurrentBalance(second.id), 60);
  assert.equal(store.getTotalAssets(), 160);
  assert.equal(store.getTotalLiabilities(), 80);
  assert.equal(store.getNetWorth(), 80);
  assert.equal(store.getTransactions('expense')[0].id, expense.id);
  assert.deepEqual(store.getTransactions('income'), []);
  await assert.rejects(store.deleteAccount(second.id), /已有流水/);
  await assert.rejects(store.updateAccount(second.id, {
    name: '支付宝', kind: 'liability', category: '其他负债', openingBalance: 100, note: ''
  }), /不能更改账户类型/);
  await assert.rejects(store.addTransaction({
    date: '2026-10-01', type: 'income', category: '助学贷款', amount: 10,
    accountId: liability.id, note: ''
  }), /资产账户/);
  await assert.rejects(store.addTransaction({
    date: '2026-10-01', type: 'expense', category: '餐饮', amount: -10,
    accountId: first.id, note: ''
  }), /金额/);
  await store.updateAccount(first.id, {
    name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 120, note: ''
  });
  assert.equal(store.getCurrentBalance(first.id), 120);
  await store.addTransaction({
    date: '2026-09-29', type: 'income', category: '生活费', amount: 10,
    accountId: first.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-02', type: 'income', category: '奖学金', amount: 20,
    accountId: first.id, note: ''
  });
  assert.deepEqual(store.getTransactions().map(item => item.date),
    ['2026-10-02', '2026-10-01', '2026-09-29']);
  assert.equal(store.getTransactions('income').length, 2);
});

test('saved JSON survives a new store instance reading from disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-store-test-'));
  const path = join(directory, 'data.json');
  const plugin = {
    async loadData() {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
    async saveData(next) { await writeFile(path, JSON.stringify(next), 'utf8'); }
  };
  try {
    const before = new FinanceStore(plugin);
    await before.load();
    const account = await before.addAccount({
      name: '持久化测试', kind: 'asset', category: '现金', openingBalance: 1000, note: ''
    });
    await before.addTransaction({
      date: '2026-10-01', type: 'income', category: '生活费', amount: 500,
      accountId: account.id, note: ''
    });
    const wallet = await before.addAccount({
      name: '持久化钱包', kind: 'asset', accountRole: 'cash',
      category: '第三方支付', openingBalance: 100, note: ''
    });
    const loan = await before.addAccount({
      name: '持久化贷款', kind: 'liability', category: '助学贷款', openingBalance: 0, note: ''
    });
    await before.addTransaction({
      date: '2026-10-01', type: 'transfer', amount: 200,
      fromAccountId: account.id, toAccountId: wallet.id, note: ''
    });
    await before.addTransaction({
      date: '2026-10-01', type: 'debt', debtAction: 'borrow', amount: 500,
      assetAccountId: account.id, liabilityAccountId: loan.id, note: ''
    });
    await before.addTransaction({
      date: '2026-10-02', type: 'debt', debtAction: 'repay', amount: 100,
      assetAccountId: wallet.id, liabilityAccountId: loan.id, note: ''
    });
    const after = new FinanceStore(plugin);
    await after.load();
    assert.equal(after.getCurrentBalance(account.id), 1800);
    assert.equal(after.getCurrentBalance(wallet.id), 200);
    assert.equal(after.getLiabilityBalance(loan.id), 400);
    assert.equal(after.getNetWorth(), 1600);
    assert.equal(after.getTransactions().length, 4);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});

test('migrates the current phase-two data and preserves ordinary transactions', async () => {
  const oldData = JSON.parse(await readFile('data.v2.backup.json', 'utf8'));
  const plugin = memoryPlugin(oldData);
  const store = new FinanceStore(plugin);
  await store.load();
  const migrated = plugin.snapshot();
  assert.equal(migrated.schemaVersion, 15);
  assert.equal(migrated.accounts.length, oldData.accounts.length);
  assert.deepEqual(migrated.transactions.map(({ categoryId, ...item }) => {
    if (item.type !== 'income') return item;
    const { grossAmount, taxAmount, netAmount, taxTreatment, taxYear, ...legacyIncome } = item;
    return legacyIncome;
  }), oldData.transactions);
  for (const oldAccount of oldData.accounts) {
    const account = migrated.accounts.find(item => item.id === oldAccount.id);
    assert.ok(account);
    assert.equal(account.openingBalance, oldAccount.openingBalance);
    assert.equal(account.accountRole, oldAccount.kind === 'asset' ? 'cash' : undefined);
    assert.equal(typeof account.categoryId, 'string');
  }
  assert.equal(store.getTotalAssets(), 1300);
  assert.equal(store.getTotalLiabilities(), 1200);
  assert.equal(store.getNetWorth(), 100);
  const reopened = new FinanceStore(plugin);
  await reopened.load();
  assert.equal(reopened.getTransactions().length, oldData.transactions.length);
});

test('legacy unknown category text migrates into an enabled compatibility category', async () => {
  const legacy = JSON.parse(await readFile('data.v2.backup.json', 'utf8'));
  legacy.version = 3;
  for (const account of legacy.accounts) if (account.kind === 'asset') account.accountRole = 'cash';
  legacy.accounts.find(item => item.kind === 'asset').category = '储值账户';
  legacy.transactions[0].category = '夜宵';
  const plugin = memoryPlugin(legacy);
  const store = new FinanceStore(plugin);
  await store.load();
  const migrated = plugin.snapshot();
  const customAssetCategory = migrated.categories.find(item => item.name === '储值账户');
  const customExpenseCategory = migrated.categories.find(item => item.name === '夜宵');
  assert.equal(customAssetCategory.scope, 'assetCash');
  assert.equal(customExpenseCategory.scope, 'expense');
  assert.equal(customAssetCategory.enabled, true);
  assert.equal(customExpenseCategory.enabled, true);
  assert.equal(store.getAccounts('asset')[0].category, '储值账户');
  const migratedExpense = store.getTransactions('expense')[0];
  assert.equal(store.getTransactionCategoryLabel(migratedExpense), '夜宵');
});

test('ordinary transfer preserves totals, and edit or delete fully recalculates', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 1000, note: ''
  });
  const wechat = await store.addAccount({
    name: '微信', kind: 'asset', accountRole: 'cash',
    category: '第三方支付', openingBalance: 500, note: ''
  });
  const input = {
    date: '2026-10-01', type: 'transfer', amount: 200,
    fromAccountId: wechat.id, toAccountId: bank.id, note: ''
  };
  const transfer = await store.addTransaction(input);
  assert.equal(store.getAccountBalance(bank.id), 1200);
  assert.equal(store.getAccountBalance(wechat.id), 300);
  assert.equal(store.getTotalAssets(), 1500);
  assert.equal(store.getTotalLiabilities(), 0);
  assert.equal(store.getNetWorth(), 1500);
  assert.equal(store.getTransactionCategoryLabel(transfer), '账户转账');
  assert.equal(store.getTransactionAccountLabel(transfer), '微信 → 银行卡');
  assert.equal(store.getTransactions('income').length, 0);
  assert.equal(store.getTransactions('expense').length, 0);
  await assert.rejects(store.addTransaction({ ...input, toAccountId: wechat.id }), /不能相同/);
  await store.updateTransaction(transfer.id, { ...input, amount: 300 });
  assert.equal(store.getAccountBalance(bank.id), 1300);
  assert.equal(store.getAccountBalance(wechat.id), 200);
  assert.equal(store.getTotalAssets(), 1500);
  await store.deleteTransaction(transfer.id);
  assert.equal(store.getAccountBalance(bank.id), 1000);
  assert.equal(store.getAccountBalance(wechat.id), 500);
  assert.equal(store.getTransactions('transfer').length, 0);
});

test('investment inflow and redemption use transfers without changing net assets', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 1200, note: ''
  });
  const fund = await store.addAccount({
    name: '货币基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: ''
  });
  const inflow = await store.addTransaction({
    date: '2026-10-01', type: 'transfer', amount: 500,
    fromAccountId: bank.id, toAccountId: fund.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 700);
  assert.equal(store.getAccountBalance(fund.id), 500);
  assert.equal(store.getTotalAssets(), 1200);
  assert.equal(store.getInvestmentInflow('2026-10-01', '2026-10-01'), 500);
  assert.equal(store.getTransactionCategoryLabel(inflow), '投资转入');
  const outflow = await store.addTransaction({
    date: '2026-10-02', type: 'transfer', amount: 200,
    fromAccountId: fund.id, toAccountId: bank.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 900);
  assert.equal(store.getAccountBalance(fund.id), 300);
  assert.equal(store.getTotalAssets(), 1200);
  assert.equal(store.getNetWorth(), 1200);
  assert.equal(store.getInvestmentOutflow('2026-10-01', '2026-10-02'), 200);
  assert.equal(store.getInvestmentOutflow('2026-10-01', '2026-10-01'), 0);
  assert.equal(store.getTransactionCategoryLabel(outflow), '投资赎回');
  const otherFund = await store.addAccount({
    name: '基金二号', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: ''
  });
  const rebalance = await store.addTransaction({
    date: '2026-10-03', type: 'transfer', amount: 50,
    fromAccountId: fund.id, toAccountId: otherFund.id, note: ''
  });
  assert.equal(store.getTransactionCategoryLabel(rebalance), '投资账户转账');
  assert.equal(store.getInvestmentInflow('2026-10-01', '2026-10-03'), 500);
  assert.equal(store.getInvestmentOutflow('2026-10-01', '2026-10-03'), 200);
  const reopened = new FinanceStore(plugin);
  await reopened.load();
  assert.equal(reopened.getTotalAssets(), 1200);
  assert.equal(reopened.getInvestmentInflow('2026-10-01', '2026-10-03'), 500);
});

test('investment performance aggregates market value, external flows, rebalances, and cash income', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 25000, note: '' });
  const etf = await store.addAccount({ name: 'ETF', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: '' });
  await store.addTransaction({ date: '2026-10-01', type: 'transfer', amount: 10000,
    fromAccountId: bank.id, toAccountId: etf.id, note: '' });
  assert.deepEqual(store.getInvestmentSummary(), {
    marketValue: 10000, openingBasis: 0, contributed: 10000, redeemed: 0, income: 0, returnAmount: 0, returnRate: 0
  });

  await store.reconcileAccount(etf.id, 11000, '市值更新', '2026-10-02');
  assert.equal(store.getInvestmentSummary().returnAmount, 1000);
  assert.equal(store.getInvestmentAccountSummary(etf.id).returnRate, 0.1);

  const fundB = await store.addAccount({ name: '基金B', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: '' });
  const returnBeforeRebalance = store.getInvestmentSummary().returnAmount;
  await store.addTransaction({ date: '2026-10-03', type: 'transfer', amount: 5000,
    fromAccountId: etf.id, toAccountId: fundB.id, note: '' });
  assert.equal(store.getInvestmentSummary().contributed, 10000);
  assert.equal(store.getInvestmentSummary().returnAmount, returnBeforeRebalance);
  assert.equal(store.getInvestmentAccountSummary(etf.id).transferredOut, 5000);

  await store.addTransaction({ date: '2026-10-04', type: 'transfer', amount: 2000,
    fromAccountId: etf.id, toAccountId: bank.id, note: '' });
  assert.equal(store.getInvestmentSummary().marketValue, 9000);
  assert.equal(store.getInvestmentSummary().redeemed, 2000);
  assert.equal(store.getInvestmentSummary().returnAmount, 1000);

  const dividend = await store.addTransaction({ date: '2026-10-05', type: 'investment-income', amount: 100,
    investmentAccountId: etf.id, accountId: bank.id, incomeKind: 'dividend', note: '现金分红' });
  assert.equal(store.getAccountBalance(bank.id), 17100);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getMonthlyExpense(2026, 10), 0);
  assert.equal(store.getInvestmentIncomeTotal('2026-10-01', '2026-10-31'), 100);
  assert.equal(store.getInvestmentSummary().returnAmount, 1100);
  assert.equal(store.getDailySummary('2026-10-05').investmentIncome, 100);
  const reopened = new FinanceStore(plugin);
  await reopened.load();
  assert.equal(reopened.getInvestmentSummary().income, 100);
  assert.equal(reopened.getAccountBalance(bank.id), 17100);
  await reopened.updateTransaction(dividend.id, { date: dividend.date, type: 'investment-income', amount: 150,
    investmentAccountId: etf.id, accountId: bank.id, incomeKind: 'interest', note: '利息调整' });
  assert.equal(reopened.getAccountBalance(bank.id), 17150);
  assert.equal(reopened.getInvestmentSummary().returnAmount, 1150);
  assert.equal(reopened.getMonthlyIncome(2026, 10), 0);
  await reopened.deleteTransaction(dividend.id);
  assert.equal(reopened.getAccountBalance(bank.id), 17000);
  assert.equal(reopened.getInvestmentSummary().returnAmount, 1000);
});

test('investment returns exclude opening balances from profit and include them in the return-rate basis', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 10000, note: '' });
  const legacyFund = await store.addAccount({ name: '原有基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 2017.70, note: '' });
  await store.addTransaction({ date: '2026-10-08', type: 'transfer', amount: 3000,
    fromAccountId: bank.id, toAccountId: legacyFund.id, note: '' });
  await store.updateInvestmentValuation({ accountId: legacyFund.id, date: '2026-10-15', marketValue: 5017.70, note: '' });

  let summary = store.getInvestmentSummary();
  assert.equal(summary.openingBasis, 2017.70);
  assert.equal(summary.contributed, 3000);
  assert.equal(summary.marketValue, 5017.70);
  assert.equal(summary.returnAmount, 0);
  assert.equal(summary.returnRate, 0);
  assert.equal(store.getInvestmentAccountSummary(legacyFund.id).returnAmount, 0);
  assert.equal(store.getInvestmentAccountSummary(legacyFund.id).returnRate, 0);
  assert.equal(store.getInvestmentValuations(legacyFund.id)[0].intervalReturn, 0);

  await store.updateInvestmentValuation({ accountId: legacyFund.id, date: '2026-10-15', marketValue: 5027.70, note: '' });
  summary = store.getInvestmentSummary();
  assert.equal(summary.returnAmount, 10);
  assert.ok(Math.abs(summary.returnRate - 10 / 5017.70) < 1e-12);
  assert.equal(store.getInvestmentAccountSummary(legacyFund.id).returnAmount, 10);

  const oldFund = await store.addAccount({ name: '未追加投资的基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 2017.70, note: '' });
  await store.updateInvestmentValuation({ accountId: oldFund.id, date: '2026-10-15', marketValue: 2027.70, note: '' });
  assert.equal(store.getInvestmentAccountSummary(oldFund.id).returnAmount, 10);

  const secondFund = await store.addAccount({ name: '另一只基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 800, note: '' });
  await store.updateInvestmentValuation({ accountId: secondFund.id, date: '2026-10-15', marketValue: 800, note: '' });
  summary = store.getInvestmentSummary();
  assert.equal(summary.openingBasis, 2017.70 + 2017.70 + 800);
  assert.equal(summary.returnAmount, 20);
  assert.equal(store.getAccountBalance(legacyFund.id), 5027.70);
  assert.ok(Math.abs(store.getTotalAssets() - (10000 - 3000 + 5027.70 + 2027.70 + 800)) < 0.001);
});

test('investment valuation snapshots are optional, preserve real dates, and remove cash-flow principal from interval return', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 10000, note: '' });
  const fund = await store.addAccount({ name: 'ETF', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: '' });
  await store.addTransaction({ date: '2026-10-07', type: 'transfer', amount: 1000,
    fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  await store.addTransaction({ date: '2026-10-08', type: 'transfer', amount: 2000,
    fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  await store.updateInvestmentValuation({ accountId: fund.id, date: '2026-10-15', marketValue: 3003.26, note: '' });
  assert.equal(store.getInvestmentSummary().returnAmount, 3.26);
  assert.equal(store.getAccountBalance(fund.id), 3003.26);
  await store.updateInvestmentValuation({ accountId: fund.id, date: '2026-10-15', marketValue: 3003.26, note: '更正备注' });
  assert.equal(store.getInvestmentValuations(fund.id).length, 1);

  await store.addTransaction({ date: '2026-10-20', type: 'transfer', amount: 2000,
    fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  await store.updateInvestmentValuation({ accountId: fund.id, date: '2026-10-31', marketValue: 5015.80, note: '' });
  const history = store.getInvestmentValuations(fund.id);
  assert.deepEqual(history.map(item => item.date), ['2026-10-31', '2026-10-15']);
  assert.equal(history[0].intervalReturn, 12.54);
  assert.equal(store.getInvestmentSummary().contributed, 5000);
  assert.equal(store.getInvestmentSummary().returnAmount, 15.8);

  await store.addTransaction({ date: '2026-11-01', type: 'transfer', amount: 100,
    fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  assert.equal(store.getAccountBalance(fund.id), 5115.8);
  assert.equal(store.getInvestmentSummary().returnAmount, 15.8);
  const fundB = await store.addAccount({ name: '基金B', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: '' });
  await store.addTransaction({ date: '2026-11-02', type: 'transfer', amount: 20,
    fromAccountId: fund.id, toAccountId: fundB.id, note: '' });
  await store.addTransaction({ date: '2026-11-03', type: 'transfer', amount: 50,
    fromAccountId: fund.id, toAccountId: bank.id, note: '' });
  assert.equal(store.getAccountBalance(fund.id), 5045.8);
  assert.equal(store.getAccountBalance(fundB.id), 20);
  assert.equal(store.getInvestmentSummary().marketValue, 5065.8);
  assert.equal(store.getInvestmentSummary().redeemed, 50);
  assert.equal(store.getInvestmentSummary().returnAmount, 15.8);
  assert.equal(store.getInvestmentValuations(fund.id).length, 2);
  assert.equal(store.getLatestInvestmentValuationDate(fund.id), '2026-10-31');

  const backup = store.getBackupPayload();
  assert.equal(backup.investmentValuations.length, 2);
  const restored = new FinanceStore(memoryPlugin());
  await restored.load();
  await restored.restoreBackup(backup);
  assert.equal(restored.getAccountBalance(fund.id), 5045.8);
  assert.equal(restored.getInvestmentValuations(fund.id).length, 2);
});

test('schema v13 data safely migrates to an empty optional valuation history', async () => {
  const source = memoryPlugin();
  const original = new FinanceStore(source);
  await original.load();
  const fund = await original.addAccount({ name: 'ETF', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 1000, note: '' });
  const legacy = source.snapshot();
  legacy.schemaVersion = 13;
  delete legacy.investmentValuations;
  const upgradedPlugin = memoryPlugin(legacy);
  const upgraded = new FinanceStore(upgradedPlugin);
  await upgraded.load();
  assert.equal(upgradedPlugin.snapshot().schemaVersion, 15);
  assert.deepEqual(upgradedPlugin.snapshot().investmentValuations, []);
  assert.equal(upgraded.getAccountBalance(fund.id), 1000);
});

test('a single monthly market-value snapshot still supports current value and cumulative return', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 1000, note: '' });
  const fund = await store.addAccount({ name: '货币基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: '' });
  await store.addTransaction({ date: '2026-09-01', type: 'transfer', amount: 500,
    fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  await store.updateInvestmentValuation({ accountId: fund.id, date: '2026-09-30', marketValue: 520, note: '' });
  assert.equal(store.getAccountBalance(fund.id), 520);
  assert.equal(store.getInvestmentSummary().contributed, 500);
  assert.equal(store.getInvestmentSummary().returnAmount, 20);
  assert.equal(store.getInvestmentValuations(fund.id).length, 1);
});

test('loan borrowing and principal repayment move assets and liabilities together', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 900, note: ''
  });
  const loan = await store.addAccount({
    name: '国家助学贷款', kind: 'liability',
    category: '助学贷款', openingBalance: 0, note: ''
  });
  const borrow = await store.addTransaction({
    date: '2026-10-01', type: 'debt', debtAction: 'borrow', amount: 12000,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 12900);
  assert.equal(store.getLiabilityBalance(loan.id), 12000);
  assert.equal(store.getTotalAssets(), 12900);
  assert.equal(store.getTotalLiabilities(), 12000);
  assert.equal(store.getNetWorth(), 900);
  assert.equal(store.getTransactionCategoryLabel(borrow), '助学贷款借入');
  assert.equal(store.getTransactionAccountLabel(borrow), '国家助学贷款 → 银行卡');
  assert.equal(store.getTransactions('income').length, 0);
  const repay = await store.addTransaction({
    date: '2026-10-02', type: 'debt', debtAction: 'repay', amount: 1000,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 11900);
  assert.equal(store.getLiabilityBalance(loan.id), 11000);
  assert.equal(store.getNetWorth(), 900);
  assert.equal(store.getTransactionCategoryLabel(repay), '偿还本金');
  assert.equal(store.getTransactionAccountLabel(repay), '银行卡 → 国家助学贷款');
  assert.equal(store.getTransactions('expense').length, 0);
  await assert.rejects(store.addTransaction({
    date: '2026-10-03', type: 'debt', debtAction: 'repay', amount: 11001,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  }), /还款金额不能超过当前负债余额/);
  assert.equal(store.getLiabilityBalance(loan.id), 11000);
  await assert.rejects(store.deleteTransaction(borrow.id), /还款金额不能超过当前负债余额/);
  await store.updateTransaction(repay.id, {
    date: '2026-10-02', type: 'debt', debtAction: 'repay', amount: 800,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 12100);
  assert.equal(store.getLiabilityBalance(loan.id), 11200);
  await store.updateTransaction(borrow.id, {
    date: '2026-10-01', type: 'debt', debtAction: 'borrow', amount: 12500,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  assert.equal(store.getAccountBalance(bank.id), 12600);
  assert.equal(store.getLiabilityBalance(loan.id), 11700);
  assert.equal(store.getNetWorth(), 900);
  await store.deleteTransaction(repay.id);
  assert.equal(store.getAccountBalance(bank.id), 13400);
  assert.equal(store.getLiabilityBalance(loan.id), 12500);
  await store.deleteTransaction(borrow.id);
  assert.equal(store.getAccountBalance(bank.id), 900);
  assert.equal(store.getLiabilityBalance(loan.id), 0);
  assert.equal(store.getNetWorth(), 900);
});

test('asset and liability reconciliation creates neutral adjustments and recalculates on edit or delete', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const wallet = await store.addAccount({
    name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 800, note: ''
  });
  const loan = await store.addAccount({
    name: '助学贷款', kind: 'liability', category: '助学贷款', openingBalance: 12000, note: ''
  });
  const assetsBefore = store.getTotalAssets();
  const assetAdjustment = await store.reconcileAccount(wallet.id, 850, '余额校准', '2026-10-02');
  assert.ok(assetAdjustment);
  assert.equal(assetAdjustment.type, 'adjustment');
  assert.equal(assetAdjustment.direction, 'increase');
  assert.equal(assetAdjustment.adjustmentTarget, 'asset');
  assert.equal(assetAdjustment.amount, 50);
  assert.equal(store.getAccountBalance(wallet.id), 850);
  assert.equal(store.getTotalAssets(), assetsBefore + 50);
  assert.equal(store.getIncomeTotal('2026-10-01', '2026-10-31'), 0);
  assert.equal(store.getExpenseTotal('2026-10-01', '2026-10-31'), 0);
  assert.deepEqual(store.getCategoryBreakdown({ startDate: '2026-10-01', endDate: '2026-10-31' }), []);
  assert.equal(store.getInvestmentInflow('2026-10-01', '2026-10-31'), 0);
  assert.equal(store.getAccount(wallet.id).lastReconciledAt, '2026-10-02');

  await store.updateTransaction(assetAdjustment.id, {
    type: 'adjustment', accountId: wallet.id, adjustmentTarget: 'asset', direction: 'increase',
    amount: 60, date: '2026-10-03', note: '更正调整'
  });
  assert.equal(store.getAccountBalance(wallet.id), 860);
  await store.deleteTransaction(assetAdjustment.id);
  assert.equal(store.getAccountBalance(wallet.id), 800);

  const debtAdjustment = await store.reconcileAccount(loan.id, 11800, '核对剩余本金', '2026-10-04');
  assert.ok(debtAdjustment);
  assert.equal(debtAdjustment.direction, 'decrease');
  assert.equal(debtAdjustment.adjustmentTarget, 'liability');
  assert.equal(debtAdjustment.amount, 200);
  assert.equal(store.getLiabilityBalance(loan.id), 11800);
  assert.equal(store.getExpenseTotal('2026-10-01', '2026-10-31'), 0);

  const reopened = new FinanceStore(plugin);
  await reopened.load();
  assert.equal(reopened.getAccountBalance(wallet.id), 800);
  assert.equal(reopened.getLiabilityBalance(loan.id), 11800);
  assert.equal(reopened.getAccount(loan.id).lastReconciledAt, '2026-10-04');
});

test('monthly dashboard stats, category breakdown, daily summary, and month switching stay separate', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 2000, note: ''
  });
  const wechat = await store.addAccount({
    name: '微信', kind: 'asset', accountRole: 'cash',
    category: '第三方支付', openingBalance: 500, note: ''
  });
  const fund = await store.addAccount({
    name: '货币基金', kind: 'asset', accountRole: 'investment',
    category: '货币基金', openingBalance: 0, note: ''
  });
  const loan = await store.addAccount({
    name: '国家助学贷款', kind: 'liability', category: '助学贷款', openingBalance: 0, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'income', category: '奖学金', amount: 500,
    accountId: bank.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'expense', category: '餐饮', amount: 300,
    accountId: bank.id, note: '午饭'
  });
  await store.addTransaction({
    date: '2026-10-10', type: 'expense', category: '交通', amount: 100,
    accountId: bank.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'transfer', amount: 500,
    fromAccountId: bank.id, toAccountId: fund.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'transfer', amount: 200,
    fromAccountId: wechat.id, toAccountId: bank.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'debt', debtAction: 'borrow', amount: 2000,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'debt', debtAction: 'repay', amount: 1000,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });

  assert.equal(store.getMonthlyIncome(2026, 10), 500);
  assert.equal(store.getMonthlyExpense(2026, 10), 400);
  assert.equal(store.getMonthlyInvestment(2026, 10), 500);
  assert.deepEqual(store.getMonthlyCategoryBreakdown(2026, 10), [
    { category: '餐饮', amount: 300, percentage: 75 },
    { category: '交通', amount: 100, percentage: 25 }
  ]);
  assert.deepEqual(store.getDailySummary('2026-10-05'), {
    income: 500, expense: 300, investmentIncome: 0, refund: 0, investmentInflow: 500, investmentOutflow: 0,
    transferCount: 2, debtBorrow: 2000, debtRepay: 1000
  });
  assert.equal(store.getTransactionsForDate('2026-10-05').length, 6);
  assert.equal(store.getTransactionsForMonth(2026, 10).length, 7);

  const currentTotals = [store.getTotalAssets(), store.getTotalLiabilities(), store.getNetWorth()];
  assert.equal(store.getMonthlyIncome(2026, 9), 0);
  assert.equal(store.getMonthlyExpense(2026, 9), 0);
  assert.equal(store.getMonthlyInvestment(2026, 9), 0);
  assert.deepEqual(store.getMonthlyCategoryBreakdown(2026, 9), []);
  assert.deepEqual([store.getTotalAssets(), store.getTotalLiabilities(), store.getNetWorth()], currentTotals);
});

test('dashboard periods use local inclusive date ranges and ISO weeks cross month boundaries correctly', () => {
  assert.deepEqual(getDateRange('day', '2026-10-02'), {
    startDate: '2026-10-02', endDate: '2026-10-02'
  });
  assert.deepEqual(getDateRange('week', '2026-03-01'), {
    startDate: '2026-02-23', endDate: '2026-03-01'
  });
  assert.deepEqual(getDateRange('month', '2026-02-28'), {
    startDate: '2026-02-01', endDate: '2026-02-28'
  });
  assert.deepEqual(getDateRange('year', '2024-06-01'), {
    startDate: '2024-01-01', endDate: '2024-12-31'
  });
  assert.deepEqual(getDateRange('custom', '2026-10-02', {
    startDate: '2026-01-15', endDate: '2026-02-20'
  }), { startDate: '2026-01-15', endDate: '2026-02-20' });
  assert.equal(isValidDateRange({ startDate: '2026-02-30', endDate: '2026-03-01' }), false);
  assert.equal(isValidDateRange({ startDate: '2026-03-02', endDate: '2026-03-01' }), false);
  assert.equal(shiftPeriodDate('week', '2026-03-01', -1), '2026-02-22');
  assert.equal(shiftPeriodDate('month', '2026-01-31', 1), '2026-02-28');
  assert.equal(shiftPeriodDate('year', '2024-02-29', 1), '2025-02-28');
  assert.deepEqual(shiftDateRange({ startDate: '2026-01-01', endDate: '2026-01-07' }, 1), {
    startDate: '2026-01-08', endDate: '2026-01-14'
  });
});

test('range filters and expense breakdown provide identical bar and pie percentages', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const account = await store.addAccount({ name: '测试卡', kind: 'asset', category: '银行存款', openingBalance: 0, note: '' });
  await store.addTransaction({ date: '2026-02-28', type: 'expense', category: '餐饮', amount: 300, accountId: account.id, note: '' });
  await store.addTransaction({ date: '2026-03-01', type: 'expense', category: '交通', amount: 100, accountId: account.id, note: '' });
  await store.addTransaction({ date: '2026-03-02', type: 'income', category: '奖学金', amount: 500, accountId: account.id, note: '' });
  const week = getDateRange('week', '2026-03-01');
  assert.deepEqual(store.getTransactionsInRange(week).map(item => item.date), ['2026-03-01', '2026-02-28']);
  const chartData = store.getCategoryBreakdown(week);
  assert.deepEqual(chartData, [
    { category: '餐饮', amount: 300, percentage: 75 },
    { category: '交通', amount: 100, percentage: 25 }
  ]);
  assert.equal(store.getExpenseTotal(week.startDate, week.endDate), 400);
  assert.equal(store.getIncomeTotal(week.startDate, week.endDate), 0);
  assert.deepEqual(store.getCategoryBreakdown({ startDate: '2026-03-02', endDate: '2026-03-03' }), []);
});

test('year-view month totals use strict income, expense, and cash-to-investment transfer definitions', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const cash = await store.addAccount({ name: '现金账户', kind: 'asset', accountRole: 'cash', category: '银行存款', openingBalance: 0, note: '' });
  const fund = await store.addAccount({ name: '投资账户', kind: 'asset', accountRole: 'investment', category: '货币基金', openingBalance: 0, note: '' });
  const otherCash = await store.addAccount({ name: '备用卡', kind: 'asset', accountRole: 'cash', category: '银行存款', openingBalance: 0, note: '' });
  const loan = await store.addAccount({ name: '贷款', kind: 'liability', category: '助学贷款', openingBalance: 0, note: '' });
  const addIncome = (date, amount) => store.addTransaction({ date, type: 'income', category: '奖学金', amount, accountId: cash.id, note: '' });
  const addExpense = (date, amount) => store.addTransaction({ date, type: 'expense', category: '餐饮', amount, accountId: cash.id, note: '' });
  await addIncome('2026-01-05', 1000);
  await addExpense('2026-01-06', 500);
  await addIncome('2026-02-05', 2000);
  await addExpense('2026-02-06', 800);
  await store.addTransaction({ date: '2026-02-10', type: 'transfer', amount: 500, fromAccountId: cash.id, toAccountId: fund.id, note: '' });
  await store.addTransaction({ date: '2026-02-11', type: 'transfer', amount: 90, fromAccountId: cash.id, toAccountId: otherCash.id, note: '' });
  await store.addTransaction({ date: '2026-02-12', type: 'debt', debtAction: 'borrow', amount: 3000, assetAccountId: cash.id, liabilityAccountId: loan.id, note: '' });
  await store.addTransaction({ date: '2026-02-13', type: 'debt', debtAction: 'repay', amount: 100, assetAccountId: cash.id, liabilityAccountId: loan.id, note: '' });
  await addIncome('2026-10-05', 500);
  await addExpense('2026-10-06', 300);
  await store.addTransaction({ date: '2026-10-10', type: 'transfer', amount: 500, fromAccountId: cash.id, toAccountId: fund.id, note: '' });
  await store.addTransaction({ date: '2026-10-11', type: 'transfer', amount: 200, fromAccountId: fund.id, toAccountId: cash.id, note: '' });

  const summary = month => store.getRangeSummary(getDateRange('month', `2026-${String(month).padStart(2, '0')}-01`));
  assert.deepEqual(summary(1), { income: 1000, expense: 500, investment: 0 });
  assert.deepEqual(summary(2), { income: 2000, expense: 800, investment: 500 });
  assert.deepEqual(summary(10), { income: 500, expense: 300, investment: 500 });
  for (const month of [3, 4, 5, 6, 7, 8, 9, 11, 12]) {
    assert.deepEqual(summary(month), { income: 0, expense: 0, investment: 0 });
  }
  assert.equal(getMonthAnchorDate(2026, 10), '2026-10-01');
  assert.deepEqual(getYearMonthDrilldown(2026, 10), { mode: 'month', anchorDate: '2026-10-01' });
});

test('categories support add, rename, disable, history, and investment role selection', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const bankCategory = store.getCategories('assetCash', true)[0];
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash', category: bankCategory.name,
    categoryId: bankCategory.id, openingBalance: 1000, note: ''
  });
  const mealCategory = store.getCategories('expense', true).find(item => item.name === '餐饮');
  const meal = await store.addTransaction({
    date: '2026-10-01', type: 'expense', category: mealCategory.name,
    categoryId: mealCategory.id, amount: 300, accountId: bank.id, note: ''
  });
  const renamed = await store.addCategory('expense', '咖啡');
  assert.ok(store.getCategories('expense', true).some(item => item.id === renamed.id && item.name === '咖啡'));
  await store.renameCategory(mealCategory.id, '吃饭');
  assert.equal(store.getTransactionCategoryLabel(meal), '吃饭');
  assert.equal(store.getMonthlyCategoryBreakdown(2026, 10)[0].category, '吃饭');
  await assert.rejects(store.deleteCategory(mealCategory.id), /已被历史记录使用/);
  await store.setCategoryEnabled(mealCategory.id, false);
  assert.equal(store.getCategories('expense', true).some(item => item.id === mealCategory.id), false);
  assert.equal(store.getTransactionCategoryLabel(meal), '吃饭');
  await assert.rejects(store.addTransaction({
    date: '2026-10-02', type: 'expense', category: '吃饭', categoryId: mealCategory.id,
    amount: 10, accountId: bank.id, note: ''
  }), /没有可用的支出分类/);

  const gold = store.getCategories('investment').find(item => item.name === '黄金');
  const investmentLegacyCategory = store.getCategories('assetInvestment', true)[0];
  const investment = await store.addAccount({
    name: '黄金账户', kind: 'asset', accountRole: 'investment', category: investmentLegacyCategory.name,
    categoryId: investmentLegacyCategory.id, investmentCategoryId: gold.id, openingBalance: 0, note: ''
  });
  await store.addTransaction({
    date: '2026-10-03', type: 'transfer', amount: 500,
    fromAccountId: bank.id, toAccountId: investment.id, note: ''
  });
  assert.equal(store.getMonthlyInvestment(2026, 10), 500);
  assert.equal(store.getAccountCategoryLabel(investment), '贵金属 › 黄金');
});

test('investment categories are extensible, balance-neutral, and survive backup and v11 migration', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 5000, note: '' });
  const investmentLegacyCategory = store.getCategories('assetInvestment', true)[0];
  const etfCategory = store.getCategories('investment').find(item => item.name === 'ETF');
  const goldCategory = store.getCategories('investment').find(item => item.name === '黄金');
  assert.ok(etfCategory && goldCategory);
  assert.deepEqual(store.getCategories('investment').filter(item => item.parentId === null).map(item => item.name),
    ['现金管理', '存款', '基金', '股票', '债券', '银行 / 券商理财', '贵金属', '其他投资']);
  const etf = await store.addAccount({ name: '沪深300ETF', kind: 'asset', accountRole: 'investment',
    category: investmentLegacyCategory.name, categoryId: investmentLegacyCategory.id,
    investmentCategoryId: etfCategory.id, openingBalance: 0, note: '' });
  const gold = await store.addAccount({ name: '黄金账户', kind: 'asset', accountRole: 'investment',
    category: investmentLegacyCategory.name, categoryId: investmentLegacyCategory.id,
    investmentCategoryId: goldCategory.id, openingBalance: 0, note: '' });
  assert.equal(store.getAccountCategoryLabel(etf), '基金 › ETF');
  assert.equal(store.getAccountCategoryLabel(gold), '贵金属 › 黄金');

  const customRoot = await store.addCategory('investment', '另类资产');
  const customChild = await store.addCategory('investment', '数字资产', customRoot.id);
  const customAccount = await store.addAccount({ name: '自定义投资', kind: 'asset', accountRole: 'investment',
    category: investmentLegacyCategory.name, categoryId: investmentLegacyCategory.id,
    investmentCategoryId: customChild.id, openingBalance: 0, note: '' });
  await assert.rejects(store.deleteCategory(customChild.id), /已被历史记录使用/);
  const assetsBefore = store.getTotalAssets();
  await store.addTransaction({ date: '2026-10-01', type: 'transfer', amount: 1000,
    fromAccountId: bank.id, toAccountId: etf.id, note: '' });
  await store.addTransaction({ date: '2026-10-02', type: 'transfer', amount: 250,
    fromAccountId: etf.id, toAccountId: gold.id, note: '' });
  await store.addTransaction({ date: '2026-10-03', type: 'transfer', amount: 100,
    fromAccountId: gold.id, toAccountId: bank.id, note: '' });
  assert.equal(store.getAccountBalance(bank.id), 4100);
  assert.equal(store.getAccountBalance(etf.id), 750);
  assert.equal(store.getAccountBalance(gold.id), 150);
  assert.equal(store.getAccountBalance(customAccount.id), 0);
  assert.equal(store.getTotalAssets(), assetsBefore);
  await store.renameCategory(customChild.id, '链上资产');
  assert.equal(store.getAccountCategoryLabel(store.getAccount(customAccount.id)), '另类资产 › 链上资产');
  assert.equal(store.getAccountBalance(customAccount.id), 0);
  await store.updateAccount(etf.id, { name: etf.name, kind: 'asset', accountRole: 'investment',
    category: investmentLegacyCategory.name, categoryId: investmentLegacyCategory.id,
    investmentCategoryId: goldCategory.id, openingBalance: 0, note: '' });
  assert.equal(store.getAccountCategoryLabel(store.getAccount(etf.id)), '贵金属 › 黄金');
  assert.equal(store.getAccountBalance(etf.id), 750);

  const backup = store.getBackupPayload();
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(backup);
  assert.equal(restored.getAccount(customAccount.id).investmentCategoryId, customChild.id);
  assert.equal(restored.getAccountCategoryLabel(restored.getAccount(customAccount.id)), '另类资产 › 链上资产');
  assert.equal(restored.getTotalAssets(), assetsBefore);

  const v11 = store.getBackupPayload();
  v11.schemaVersion = 11;
  v11.categories = v11.categories.filter(item => item.scope !== 'investment');
  for (const account of v11.accounts) if (account.kind === 'asset') delete account.investmentCategoryId;
  const legacyPlugin = memoryPlugin(v11); const migrated = new FinanceStore(legacyPlugin); await migrated.load();
  assert.equal(legacyPlugin.snapshot().schemaVersion, 15);
  assert.equal(migrated.getTotalAssets(), assetsBefore);
  assert.equal(migrated.getAccount(etf.id).investmentCategoryId, 'investment-other');
  assert.equal(migrated.getAccountBalance(etf.id), 750);
});

test('dashboard module visibility and order persist with the current schema version', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  await store.setDashboardModuleVisible('liabilities', false);
  await store.moveDashboardModule('assets', -1);
  await store.setExpenseChartMode('pie');
  await store.setPeriodMode('week');
  await store.setTransactionColumnWidth('account', 188);
  const coffee = await store.addCategory('expense', '咖啡');
  await store.moveCategory(coffee.id, -1);
  const reopened = new FinanceStore(plugin);
  await reopened.load();
  const config = reopened.getDashboardConfig();
  assert.equal(config.visibleModules.includes('liabilities'), false);
  assert.equal(config.expenseChartMode, 'pie');
  assert.equal(config.periodMode, 'week');
  assert.equal(reopened.getTableConfig().transactionColumnWidths.account, 188);
  assert.ok(config.moduleOrder.indexOf('assets') < config.moduleOrder.indexOf('liabilities'));
  const expenseCategories = reopened.getCategories('expense');
  assert.ok(expenseCategories.findIndex(item => item.id === coffee.id)
    < expenseCategories.findIndex(item => item.name === '其他'));
  assert.equal(plugin.snapshot().schemaVersion, 15);
});

test('older schemaVersion 4 data gets UI defaults without changing finance records', async () => {
  const initialPlugin = memoryPlugin();
  const initialStore = new FinanceStore(initialPlugin);
  await initialStore.load();
  const account = await initialStore.addAccount({ name: '保留账户', kind: 'asset', category: '银行存款', openingBalance: 1200, note: '' });
  await initialStore.addTransaction({ date: '2026-10-02', type: 'expense', category: '餐饮', amount: 40, accountId: account.id, note: '' });
  const old = initialPlugin.snapshot();
  old.schemaVersion = 4;
  old.tableConfig = old.uiConfig.tableConfig;
  delete old.uiConfig;
  old.dashboardConfig.moduleOrder = old.dashboardConfig.moduleOrder.filter(item => item !== 'spending');
  old.dashboardConfig.moduleOrder = old.dashboardConfig.moduleOrder.filter(item => item !== 'budget' && item !== 'goals');
  old.dashboardConfig.visibleModules = old.dashboardConfig.visibleModules.filter(item => item !== 'budget' && item !== 'goals');
  old.categories = old.categories.filter(category => category.parentId === null);
  for (const category of old.categories) delete category.parentId;
  delete old.dashboardConfig.expenseChartMode;
  delete old.dashboardConfig.periodMode;
  for (const category of old.categories) { delete category.createdAt; delete category.updatedAt; }
  for (const accountItem of old.accounts) delete accountItem.lastReconciledAt;
  const oldFinanceState = { accounts: structuredClone(old.accounts), transactions: structuredClone(old.transactions), categories: structuredClone(old.categories) };
  const plugin = memoryPlugin(old);
  const reopened = new FinanceStore(plugin);
  await reopened.load();
  assert.equal(reopened.getDashboardConfig().expenseChartMode, 'bar');
  assert.equal(reopened.getDashboardConfig().periodMode, 'month');
  assert.equal(reopened.getTableConfig().transactionColumnWidths.account, 126);
  const migrated = plugin.snapshot();
  assert.deepEqual(migrated.accounts.map(({ lastReconciledAt, ...item }) => item), oldFinanceState.accounts);
  assert.deepEqual(migrated.transactions, oldFinanceState.transactions);
  assert.deepEqual(migrated.categories.filter(category => category.parentId === null)
    .map(({ createdAt, updatedAt, parentId, ...item }) => item), oldFinanceState.categories);
  assert.deepEqual(migrated.categories.filter(category => category.parentId === 'expense-1').map(item => item.name),
    ['买菜做饭', '外卖', '堂食', '咖啡 / 饮料 / 零食']);
  assert.equal(migrated.schemaVersion, 15);
  assert.deepEqual(migrated.budgets, []);
  assert.deepEqual(migrated.goals, []);
  assert.deepEqual(migrated.goalAllocations, []);
});

test('JSON backup restore validates before replacement and restores all Finance settings', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const account = await store.addAccount({
    name: '备份测试账户', kind: 'asset', category: '银行存款', openingBalance: 1000, note: ''
  });
  const original = await store.addTransaction({
    date: '2026-10-01', type: 'income', category: '奖学金', amount: 500,
    accountId: account.id, note: ''
  });
  const custom = await store.addCategory('expense', '咖啡');
  await store.setDashboardModuleVisible('liabilities', false);
  await store.setExpenseChartMode('pie');
  await store.setPeriodMode('year');
  await store.setTransactionColumnWidth('note', 160);
  const backup = store.getBackupPayload();
  assert.equal(backup.schemaVersion, 15);
  assert.ok(backup.exportedAt);
  assert.ok(backup.categories.some(item => item.id === custom.id));
  assert.equal(backup.dashboardConfig.visibleModules.includes('liabilities'), false);
  assert.ok(backup.uiConfig);
  assert.equal(backup.uiConfig.currency, 'CNY');

  await store.addTransaction({
    date: '2026-10-02', type: 'expense', category: '购物', amount: 20,
    accountId: account.id, note: ''
  });
  await store.addCategory('income', '临时分类');
  await store.setDashboardModuleVisible('liabilities', true);
  await store.setExpenseChartMode('bar');
  const beforeInvalidRestore = plugin.snapshot();
  assert.throws(() => store.validateBackupPayload({ schemaVersion: 7, accounts: [] }), /备份文件格式无效/);
  assert.deepEqual(plugin.snapshot(), beforeInvalidRestore);

  await store.restoreBackup(backup);
  assert.deepEqual(store.getTransactions().map(item => item.id), [original.id]);
  assert.ok(store.getCategories('expense').some(item => item.id === custom.id));
  assert.equal(store.getDashboardConfig().visibleModules.includes('liabilities'), false);
  assert.equal(store.getDashboardConfig().expenseChartMode, 'pie');
  assert.equal(store.getDashboardConfig().periodMode, 'year');
  assert.equal(store.getTableConfig().transactionColumnWidths.note, 160);
  assert.equal(store.getAccountBalance(account.id), 1500);
});

test('v4 backups migrate on restore and future backups are rejected without touching current data', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  const account = await store.addAccount({ name: '旧格式账户', kind: 'asset', category: '银行存款', openingBalance: 500, note: '' });
  await store.addTransaction({ date: '2026-01-02', type: 'income', category: '奖学金', amount: 100, accountId: account.id, note: '' });
  const v4 = store.getBackupPayload();
  v4.schemaVersion = 4;
  v4.tableConfig = v4.uiConfig.tableConfig;
  delete v4.uiConfig;
  v4.dashboardConfig.moduleOrder = v4.dashboardConfig.moduleOrder.filter(item => item !== 'spending');
  v4.dashboardConfig.moduleOrder = v4.dashboardConfig.moduleOrder.filter(item => item !== 'budget' && item !== 'goals');
  v4.dashboardConfig.visibleModules = v4.dashboardConfig.visibleModules.filter(item => item !== 'budget' && item !== 'goals');
  v4.categories = v4.categories.filter(category => category.parentId === null);
  for (const category of v4.categories) delete category.parentId;
  for (const category of v4.categories) { delete category.createdAt; delete category.updatedAt; }
  for (const savedAccount of v4.accounts) delete savedAccount.lastReconciledAt;
  store.validateBackupPayload(v4);
  const before = plugin.snapshot();
  assert.throws(() => store.validateBackupPayload({ schemaVersion: 16 }), /由更新版本的 Finance 创建/);
  assert.deepEqual(plugin.snapshot(), before);
  await store.restoreBackup(v4);
  assert.equal(plugin.snapshot().schemaVersion, 15);
  assert.equal(store.getTransactions().length, 1);
  assert.ok(store.getCategories().every(category => category.createdAt && category.updatedAt));
  assert.equal(store.getDashboardConfig().moduleOrder.includes('spending'), true);
});

test('CSV exports include UTF-8 BOM, localized text, amounts, dates, and type-specific account fields', async () => {
  const store = new FinanceStore(memoryPlugin());
  await store.load();
  const bank = await store.addAccount({
    name: '银行卡', kind: 'asset', accountRole: 'cash', category: '银行存款', openingBalance: 1000, note: '主账户'
  });
  const fund = await store.addAccount({
    name: '黄金账户', kind: 'asset', accountRole: 'investment', category: '货币基金', openingBalance: 0, note: ''
  });
  const loan = await store.addAccount({
    name: '国家助学贷款', kind: 'liability', category: '助学贷款', openingBalance: 0, note: ''
  });
  await store.addTransaction({
    date: '2026-10-01', type: 'income', category: '奖学金', amount: 500,
    accountId: bank.id, note: '学校, 发放'
  });
  await store.addTransaction({
    date: '2026-10-02', type: 'transfer', amount: 200,
    fromAccountId: bank.id, toAccountId: fund.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-03', type: 'debt', debtAction: 'borrow', amount: 1000,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-04', type: 'expense', category: '餐饮', amount: 25,
    accountId: bank.id, note: ''
  });
  await store.addTransaction({
    date: '2026-10-05', type: 'debt', debtAction: 'repay', amount: 100,
    assetAccountId: bank.id, liabilityAccountId: loan.id, note: ''
  });
  await store.reconcileAccount(bank.id, 2200, '期末对账', '2026-10-06');
  const transactions = buildTransactionsCsv(store);
  assert.ok(transactions.startsWith('\uFEFFdate,type,category,parentCategory,subcategory,amount'));
  assert.ok(transactions.includes('2026-10-01,income,奖学金,奖学金,,500,银行卡'));
  assert.ok(transactions.includes('"学校, 发放"'));
  assert.ok(transactions.includes('2026-10-02,transfer,投资转入,,,200,,银行卡,黄金账户'));
  assert.ok(transactions.includes('2026-10-03,debt,助学贷款借入,,,1000,,,,银行卡,国家助学贷款,borrow'));
  assert.ok(transactions.includes('2026-10-04,expense,餐饮,餐饮,,25,银行卡'));
  assert.ok(transactions.includes('2026-10-05,debt,偿还本金,,,100,,,,银行卡,国家助学贷款,repay'));
  assert.ok(transactions.includes('2026-10-06,adjustment,余额校准,,,25,银行卡'));
  const accounts = buildAccountsCsv(store);
  assert.ok(accounts.startsWith('\uFEFFname,kind,accountRole,liabilityRole,category'));
  assert.ok(accounts.includes('银行卡,asset,cash,,银行存款,,1000,2200,主账户'));
  assert.ok(accounts.includes('国家助学贷款,liability,,loan,助学贷款,,0,900,'));
});

test('monthly budgets count only expense transactions and copy the previous month', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 10000, note: '' });
  const fund = await store.addAccount({ name: '基金', kind: 'asset', accountRole: 'investment', category: '货币基金', openingBalance: 0, note: '' });
  const loan = await store.addAccount({ name: '贷款', kind: 'liability', category: '助学贷款', openingBalance: 2000, note: '' });
  const meal = store.getCategories('expense').find(item => item.name === '餐饮');
  const transport = store.getCategories('expense').find(item => item.name === '交通');
  await store.saveBudget({ year: 2026, month: 10, totalLimit: 3000, categoryLimits: [
    { categoryId: meal.id, limit: 1000 }, { categoryId: transport.id, limit: 300 }
  ] });
  await store.addTransaction({ date: '2026-10-03', type: 'expense', categoryId: meal.id, category: meal.name, amount: 600, accountId: bank.id, note: '' });
  await store.addTransaction({ date: '2026-10-03', type: 'expense', categoryId: transport.id, category: transport.name, amount: 100, accountId: bank.id, note: '' });
  await store.addTransaction({ date: '2026-10-03', type: 'transfer', amount: 500, fromAccountId: bank.id, toAccountId: fund.id, note: '' });
  await store.addTransaction({ date: '2026-10-03', type: 'debt', debtAction: 'repay', amount: 1000, assetAccountId: bank.id, liabilityAccountId: loan.id, note: '' });
  assert.equal(store.getBudgetUsage(2026, 10).used, 700);
  assert.deepEqual(store.getCategoryBudgetUsage(2026, 10).map(item => [item.categoryName, item.used]), [['餐饮', 600], ['交通', 100]]);
  await store.copyPreviousBudget(2026, 11);
  assert.equal(store.getBudget(2026, 11).totalLimit, 3000);
  await assert.rejects(store.copyPreviousBudget(2026, 11), /确认覆盖/);
  await store.copyPreviousBudget(2026, 11, true);
  assert.equal(store.getBudget(2026, 11).categoryLimits.length, 2);
});

test('goal allocations reserve assets without changing finance totals, and releases/edit/delete recompute', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 10000, note: '' });
  const before = { assets: store.getTotalAssets(), net: store.getNetWorth(), income: store.getMonthlyIncome(2026, 10), expense: store.getMonthlyExpense(2026, 10) };
  const mac = await store.addGoal({ name: 'MacBook', targetAmount: 12000, targetDate: '2027-06-01', priority: 'high', note: '' });
  const travel = await store.addGoal({ name: '旅行', targetAmount: 8000, targetDate: null, priority: 'medium', note: '' });
  const alloc = await store.allocateToGoal({ goalId: mac.id, accountId: bank.id, date: '2026-10-03', amount: 2000, direction: 'allocate', note: '' });
  await store.allocateToGoal({ goalId: travel.id, accountId: bank.id, date: '2026-10-03', amount: 1000, direction: 'allocate', note: '' });
  assert.equal(store.getAccountBalance(bank.id), 10000);
  assert.equal(store.getAccountReservedBalance(bank.id), 3000);
  assert.equal(store.getAccountAvailableBalance(bank.id), 7000);
  assert.equal(store.getGoalSavedAmount(mac.id), 2000);
  assert.equal(store.getTotalReservedBalance(), 3000);
  assert.equal(store.getTotalAvailableAssets(), 7000);
  assert.deepEqual({ assets: store.getTotalAssets(), net: store.getNetWorth(), income: store.getMonthlyIncome(2026, 10), expense: store.getMonthlyExpense(2026, 10) }, before);
  const release = await store.releaseFromGoal({ goalId: mac.id, accountId: bank.id, date: '2026-10-03', amount: 500, direction: 'release', note: '' });
  assert.equal(store.getGoalSavedAmount(mac.id), 1500);
  assert.equal(store.getAccountReservedBalance(bank.id), 2500);
  assert.equal(store.getAccountAvailableBalance(bank.id), 7500);
  await store.updateGoalAllocation(alloc.id, { goalId: mac.id, accountId: bank.id, date: '2026-10-03', amount: 1800, direction: 'allocate', note: '' });
  assert.equal(store.getGoalSavedAmount(mac.id), 1300);
  await store.deleteGoalAllocation(release.id);
  await store.deleteGoalAllocation(alloc.id);
  assert.equal(store.getGoalSavedAmount(mac.id), 0);
  assert.equal(store.getAccountBalance(bank.id), 10000);
  assert.throws(() => store.getGoalSuggestedMonthly('missing'), /储蓄目标不存在/);
});

test('completing a goal creates a real expense, releases reservations, and persists with backup', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 20000, note: '' });
  const shopping = store.getCategories('expense').find(item => item.name === '购物');
  const goal = await store.addGoal({ name: 'MacBook', targetAmount: 12000, targetDate: '2027-06-01', priority: 'high', note: '' });
  await store.allocateToGoal({ goalId: goal.id, accountId: bank.id, date: '2026-10-03', amount: 12000, direction: 'allocate', note: '' });
  await store.saveBudget({ year: 2026, month: 10, totalLimit: 15000, categoryLimits: [] });
  const expense = await store.completeGoal(goal.id, 11799, bank.id, shopping.id, '2026-10-03', '电脑');
  assert.equal(expense.type, 'expense'); assert.equal(expense.amount, 11799);
  assert.equal(store.getGoal(goal.id).status, 'completed');
  assert.equal(store.getGoal(goal.id).actualAmount, 11799);
  assert.equal(store.getAccountBalance(bank.id), 8201);
  assert.equal(store.getAccountReservedBalance(bank.id), 0);
  assert.equal(store.getAccountAvailableBalance(bank.id), 8201);
  assert.equal(store.getBudgetUsage(2026, 10).used, 11799);
  assert.equal(store.getGoalAllocations(goal.id).length, 1);
  const backup = store.getBackupPayload(); assert.equal(backup.schemaVersion, 15);
  const reopened = new FinanceStore(plugin); await reopened.load();
  assert.equal(reopened.getGoal(goal.id).status, 'completed');
  assert.equal(reopened.getGoalAllocations(goal.id).length, 1);
  const restoredPlugin = memoryPlugin(); const restored = new FinanceStore(restoredPlugin); await restored.load();
  await restored.restoreBackup(backup);
  assert.equal(restored.getBudget(2026, 10).totalLimit, 15000);
  assert.equal(restored.getAccountReservedBalance(bank.id), 0);
});

test('v5 data and backups migrate to empty planning collections without losing finance data', async () => {
  const originalPlugin = memoryPlugin(); const original = new FinanceStore(originalPlugin); await original.load();
  const account = await original.addAccount({ name: '迁移账户', kind: 'asset', category: '银行存款', openingBalance: 88, note: '' });
  const v5 = originalPlugin.snapshot(); v5.schemaVersion = 5;
  v5.categories = v5.categories.filter(category => category.parentId === null);
  for (const category of v5.categories) delete category.parentId;
  delete v5.budgets; delete v5.goals; delete v5.goalAllocations;
  v5.dashboardConfig.moduleOrder = v5.dashboardConfig.moduleOrder.filter(item => item !== 'budget' && item !== 'goals');
  v5.dashboardConfig.visibleModules = v5.dashboardConfig.visibleModules.filter(item => item !== 'budget' && item !== 'goals');
  const plugin = memoryPlugin(v5); const migrated = new FinanceStore(plugin); await migrated.load();
  assert.equal(migrated.getAccountBalance(account.id), 88);
  assert.deepEqual(plugin.snapshot().budgets, []); assert.deepEqual(plugin.snapshot().goals, []); assert.deepEqual(plugin.snapshot().goalAllocations, []);
  await migrated.restoreBackup(v5);
  assert.equal(migrated.getAccountBalance(account.id), 88);
  assert.equal(plugin.snapshot().schemaVersion, 15);
});

test('goal allocations cannot exceed available assets and remain reserved after later overspending', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 100, note: '' });
  const goal = await store.addGoal({ name: '书桌', targetAmount: 500, targetDate: null, priority: 'low', note: '' });
  await assert.rejects(store.allocateToGoal({ goalId: goal.id, accountId: bank.id, date: '2026-10-03', amount: 101, direction: 'allocate', note: '' }), /可自由使用余额/);
  await store.allocateToGoal({ goalId: goal.id, accountId: bank.id, date: '2026-10-03', amount: 80, direction: 'allocate', note: '' });
  await store.addTransaction({ date: '2026-10-03', type: 'expense', category: '购物', amount: 200, accountId: bank.id, note: '' });
  assert.equal(store.getAccountBalance(bank.id), -100);
  assert.equal(store.getAccountReservedBalance(bank.id), 80);
  assert.equal(store.getAccountAvailableBalance(bank.id), -180);
});

test('one wish can reserve multiple asset accounts, suggested savings stays finite, and cancellation releases funds', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const fund = await store.addAccount({ name: '余额宝', kind: 'asset', accountRole: 'investment', category: '货币基金', openingBalance: 2000, note: '' });
  const goal = await store.addGoal({ name: '相机', targetAmount: 4000, targetDate: '2027-06-01', priority: 'medium', note: '' });
  await store.allocateToGoal({ goalId: goal.id, accountId: bank.id, date: '2026-10-03', amount: 500, direction: 'allocate', note: '' });
  await store.allocateToGoal({ goalId: goal.id, accountId: fund.id, date: '2026-10-03', amount: 700, direction: 'allocate', note: '' });
  assert.equal(store.getGoalSavedAmount(goal.id), 1200);
  assert.equal(store.getAccountReservedBalance(bank.id), 500);
  assert.equal(store.getAccountReservedBalance(fund.id), 700);
  assert.equal(store.getGoalSuggestedMonthly(goal.id, '2026-10-03'), 350);
  await store.cancelGoal(goal.id);
  assert.equal(store.getAccountReservedBalance(bank.id), 0);
  assert.equal(store.getAccountReservedBalance(fund.id), 0);
  assert.equal(store.getAccountAvailableBalance(bank.id), 1000);
  assert.equal(store.getGoalAllocations(goal.id).length, 2);
});

test('expense hierarchy analytics aggregate parent totals and include the virtual unspecified bucket', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const account = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 5000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const children = store.getCategoryChildren(food.id);
  const byName = name => children.find(item => item.name === name);
  for (const [categoryId, amount] of [[byName('买菜做饭').id, 400], [byName('外卖').id, 500],
    [byName('堂食').id, 200], [food.id, 100]]) {
    await store.addTransaction({ date: '2026-10-05', type: 'expense', categoryId,
      category: store.getCategory(categoryId).name, amount, accountId: account.id, note: '' });
  }
  await store.addTransaction({ date: '2026-09-30', type: 'expense', categoryId: byName('外卖').id,
    category: '外卖', amount: 900, accountId: account.id, note: '' });
  const top = store.getTopLevelExpenseBreakdown('2026-10-01', '2026-10-31');
  assert.deepEqual(top.map(item => [item.category, item.amount, item.percentage]), [['餐饮', 1200, 100]]);
  const drill = store.getExpenseBreakdownForParent(food.id, '2026-10-01', '2026-10-31');
  assert.deepEqual(drill.map(item => [item.category, item.amount, Math.round(item.percentage * 10) / 10]), [
    ['外卖', 500, 41.7], ['买菜做饭', 400, 33.3], ['堂食', 200, 16.7], ['未细分', 100, 8.3]
  ]);
  assert.equal(store.getCategoryTotalIncludingChildren(food.id, '2026-10-01', '2026-10-31'), 1200);
  assert.deepEqual(store.getTransactionsByCategory(food.id, '2026-10-01', '2026-10-31').map(item => item.amount).sort((a, b) => a - b), [100, 200, 400, 500]);
  assert.equal(store.getTransactionCategoryLabel(store.getTransactions('expense').find(item => item.categoryId === byName('外卖').id)), '餐饮 › 外卖');
  const csv = buildTransactionsCsv(store);
  assert.ok(csv.includes('2026-10-05,expense,外卖,餐饮,外卖,500,微信'));
  assert.ok(csv.includes('2026-10-05,expense,餐饮,餐饮,,100,微信'));
});

test('parent and child budgets overlap intentionally and aggregate only descendants for parent limits', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const account = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 5000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const takeout = store.getCategoryChildren(food.id).find(item => item.name === '外卖');
  await store.saveBudget({ year: 2026, month: 10, totalLimit: 2000, categoryLimits: [
    { categoryId: food.id, limit: 1000 }, { categoryId: takeout.id, limit: 400 }
  ] });
  await store.addTransaction({ date: '2026-10-02', type: 'expense', categoryId: takeout.id, category: takeout.name, amount: 500, accountId: account.id, note: '' });
  const usage = store.getCategoryBudgetUsage(2026, 10);
  assert.deepEqual(usage.map(item => [item.categoryName, item.used, item.overBudget, item.parentCategoryName]), [
    ['餐饮', 500, 0, null], ['外卖', 500, 100, '餐饮']
  ]);
});

test('expense child category CRUD enforces two levels, parent availability, and history protection', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const account = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 1000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const takeout = store.getCategoryChildren(food.id).find(item => item.name === '外卖');
  await assert.rejects(store.addSubcategory(takeout.id, '三级'), /两级分类/);
  const supper = await store.addSubcategory(food.id, '夜宵');
  assert.equal(supper.parentId, food.id); assert.equal(supper.scope, 'expense');
  await store.addTransaction({ date: '2026-10-02', type: 'expense', categoryId: takeout.id,
    category: takeout.name, amount: 20, accountId: account.id, note: '' });
  await store.renameCategory(takeout.id, '外送');
  const transaction = store.getTransactions('expense')[0];
  assert.equal(store.getTransactionCategoryLabel(transaction), '餐饮 › 外送');
  await assert.rejects(store.deleteCategory(takeout.id), /被历史记录使用/);
  await assert.rejects(store.deleteCategory(food.id), /处理该一级分类的子分类/);
  await store.setCategoryEnabled(food.id, false);
  assert.equal(store.getCategory(takeout.id).enabled, true);
  assert.equal(store.isCategorySelectable(food.id), false);
  assert.equal(store.isCategorySelectable(takeout.id), false);
  await assert.rejects(store.addTransaction({ date: '2026-10-03', type: 'expense', categoryId: takeout.id,
    category: '外送', amount: 10, accountId: account.id, note: '' }), /没有可用的支出分类/);
  await store.setCategoryEnabled(food.id, true);
  const supperIndexBeforeMove = store.getCategoryChildren(food.id).findIndex(item => item.id === supper.id);
  await store.moveCategory(supper.id, -1);
  assert.equal(store.getCategoryChildren(food.id).findIndex(item => item.id === supper.id), supperIndexBeforeMove - 1);
  await store.deleteCategory(supper.id);
  await assert.rejects(store.deleteCategory(food.id), /处理.*子分类/);
});

test('schema v6 categories migrate to two-level defaults without changing historical category IDs', async () => {
  const sourcePlugin = memoryPlugin(); const source = new FinanceStore(sourcePlugin); await source.load();
  const account = await source.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const food = source.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const history = await source.addTransaction({ date: '2026-10-02', type: 'expense', categoryId: food.id,
    category: food.name, amount: 100, accountId: account.id, note: '' });
  const oldV6 = sourcePlugin.snapshot(); oldV6.schemaVersion = 6;
  oldV6.categories = oldV6.categories.filter(item => item.parentId === null).map(({ parentId, ...item }) => item);
  const plugin = memoryPlugin(oldV6); const migrated = new FinanceStore(plugin); await migrated.load();
  assert.equal(plugin.snapshot().schemaVersion, 15);
  assert.equal(migrated.getTransactions('expense')[0].categoryId, food.id);
  assert.equal(migrated.getTransactionCategoryLabel(migrated.getTransactions('expense')[0]), '餐饮');
  assert.deepEqual(migrated.getCategoryChildren(food.id).map(item => item.name), ['买菜做饭', '外卖', '堂食', '咖啡 / 饮料 / 零食']);
  const backup = migrated.getBackupPayload(); assert.ok(backup.categories.every(item => 'parentId' in item));
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(backup);
  assert.equal(restored.getCategory(history.categoryId).parentId, null);
});

test('income classification supports two levels and aggregates direct parent income', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const account = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 0, note: '' });
  const root = store.getCategories('income').find(item => item.name === '实习 / 兼职');
  const salary = await store.addCategory('income', '实习工资', root.id);
  const assistant = await store.addCategory('income', '助教收入', root.id);
  for (const [date, categoryId, category, amount] of [
    ['2026-10-02', salary.id, salary.name, 2000], ['2026-10-03', assistant.id, assistant.name, 500],
    ['2026-10-04', root.id, root.name, 300]
  ]) await store.addTransaction({ date, type: 'income', categoryId, category, amount, accountId: account.id, note: '' });
  assert.equal(store.getTopLevelIncomeBreakdown('2026-10-01', '2026-10-31').find(item => item.categoryId === root.id).amount, 2800);
  assert.deepEqual(Object.fromEntries(store.getIncomeBreakdownForParent(root.id, '2026-10-01', '2026-10-31').map(item => [item.category, item.amount])),
    { '实习工资': 2000, '助教收入': 500, '未细分': 300 });
  await assert.rejects(store.addCategory('income', '三级', salary.id), /两级分类/);
});

test('allowance spending affects expense and budget totals but not asset balances', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const asset = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 5000, note: '' });
  const allowance = await store.addAccount({ name: '微信亲属卡', kind: 'allowance', allowanceLimit: 2000, resetDay: 1, note: '' });
  const food = store.getCategories('expense').find(item => item.parentId === null && item.name === '餐饮');
  const takeaway = store.getCategoryChildren(food.id).find(item => item.name === '外卖');
  const initialAssets = store.getTotalAssets(); const initialNetWorth = store.getNetWorth();
  await store.addTransaction({ date: '2026-10-02', type: 'expense', category: takeaway.name, categoryId: takeaway.id, amount: 100, accountId: allowance.id, note: '' });
  await store.addTransaction({ date: '2026-10-10', type: 'expense', category: '购物', amount: 200, accountId: allowance.id, note: '' });
  assert.equal(store.getAllowanceUsed(allowance.id, '2026-10-31'), 300);
  assert.equal(store.getAllowanceRemaining(allowance.id, '2026-10-31'), 1700);
  assert.equal(store.getTotalAssets(), initialAssets); assert.equal(store.getNetWorth(), initialNetWorth);
  assert.equal(store.getMonthlyExpense(2026, 10), 300);
  assert.equal(store.getExpenseFundingBreakdown('2026-10-01', '2026-10-31').allowanceExpense, 300);
  assert.equal(store.getExpenseByPaymentSource('2026-10-01', '2026-10-31').find(item => item.accountId === allowance.id).amount, 300);
  const budgetStore = new FinanceStore(memoryPlugin()); await budgetStore.load();
  const budgetAsset = await budgetStore.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 5000, note: '' });
  const budgetAllowance = await budgetStore.addAccount({ name: '亲属卡', kind: 'allowance', allowanceLimit: 2000, note: '' });
  const budgetFood = budgetStore.getCategories('expense').find(item => item.parentId === null && item.name === '餐饮');
  const budgetChild = budgetStore.getCategoryChildren(budgetFood.id).find(item => item.name === '外卖');
  await budgetStore.addTransaction({ date: '2026-10-05', type: 'expense', category: budgetFood.name, categoryId: budgetFood.id, amount: 400, accountId: budgetAsset.id, note: '' });
  await budgetStore.addTransaction({ date: '2026-10-06', type: 'expense', category: budgetChild.name, categoryId: budgetChild.id, amount: 300, accountId: budgetAllowance.id, note: '' });
  await budgetStore.saveBudget({ year: 2026, month: 10, totalLimit: null, categoryLimits: [{ categoryId: budgetFood.id, limit: 1000 }] });
  assert.equal(budgetStore.getCategoryBudgetUsage(2026, 10).find(item => item.categoryId === budgetFood.id).used, 700);
  const reloaded = new FinanceStore(plugin); await reloaded.load();
  assert.equal(reloaded.getAllowanceRemaining(allowance.id, '2026-10-31'), 1700);
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(reloaded.getBackupPayload());
  assert.equal(restored.getAllowanceUsed(allowance.id, '2026-10-31'), 300);
  assert.equal(restored.getAccount(allowance.id).allowancePeriod, 'monthly');
  assert.match(buildAccountsCsv(reloaded), /allowance,.*monthly,2000,1,false/);
  assert.match(buildTransactionsCsv(reloaded), /微信亲属卡/);
  await assert.rejects(store.deleteAccount(allowance.id), /已有流水/);
});

test('allowance account create, reload, spend, and limit edit preserve finance totals', async () => {
  const plugin = memoryPlugin();
  const store = new FinanceStore(plugin);
  await store.load();
  await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 1500, note: '' });
  await store.addAccount({ name: '助学贷款', kind: 'liability', category: '助学贷款', openingBalance: 700, note: '' });
  const totalsBeforeAllowance = {
    assets: store.getTotalAssets(), liabilities: store.getTotalLiabilities(), netWorth: store.getNetWorth()
  };

  const allowance = await store.addAccount({
    name: '微信亲属卡', kind: 'allowance', allowanceLimit: 2000, resetDay: 1, note: ''
  });
  assert.equal(allowance.kind, 'allowance');
  assert.equal(allowance.allowancePeriod, 'monthly');
  assert.equal(allowance.rollover, false);
  assert.deepEqual({
    assets: store.getTotalAssets(), liabilities: store.getTotalLiabilities(), netWorth: store.getNetWorth()
  }, totalsBeforeAllowance);

  const reloaded = new FinanceStore(plugin);
  await reloaded.load();
  const restoredAllowance = reloaded.getAccounts('allowance')[0];
  assert.equal(restoredAllowance.id, allowance.id);
  assert.equal(restoredAllowance.allowanceLimit, 2000);
  assert.equal(restoredAllowance.resetDay, 1);
  assert.equal(restoredAllowance.allowancePeriod, 'monthly');
  assert.equal(restoredAllowance.rollover, false);

  const food = reloaded.getCategories('expense').find(item => item.parentId === null && item.name === '餐饮');
  const takeaway = reloaded.getCategoryChildren(food.id).find(item => item.name === '外卖');
  await reloaded.addTransaction({
    date: '2026-10-04', type: 'expense', category: takeaway.name, categoryId: takeaway.id,
    amount: 100, accountId: restoredAllowance.id, note: ''
  });
  assert.equal(reloaded.getAllowanceUsed(restoredAllowance.id, '2026-10-04'), 100);
  assert.equal(reloaded.getAllowanceRemaining(restoredAllowance.id, '2026-10-04'), 1900);
  assert.equal(reloaded.getMonthlyExpense(2026, 10), 100);
  assert.equal(reloaded.getTotalAssets(), totalsBeforeAllowance.assets);
  assert.equal(reloaded.getTotalLiabilities(), totalsBeforeAllowance.liabilities);
  assert.equal(reloaded.getNetWorth(), totalsBeforeAllowance.netWorth);

  await reloaded.updateAccount(restoredAllowance.id, {
    kind: 'allowance', name: '微信亲属卡', allowanceLimit: 2500, resetDay: 1, note: ''
  });
  assert.equal(reloaded.getAllowanceUsed(restoredAllowance.id, '2026-10-04'), 100);
  assert.equal(reloaded.getAllowanceRemaining(restoredAllowance.id, '2026-10-04'), 2400);
  assert.equal(reloaded.getMonthlyExpense(2026, 10), 100);
  assert.deepEqual({
    assets: reloaded.getTotalAssets(), liabilities: reloaded.getTotalLiabilities(), netWorth: reloaded.getNetWorth()
  }, totalsBeforeAllowance);
});

test('allowance cycles honor non-first-day resets and start fresh each month', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const account = await store.addAccount({ name: '亲属卡15日', kind: 'allowance', allowanceLimit: 2000, resetDay: 15, note: '' });
  for (const [date, amount] of [['2026-10-14', 100], ['2026-10-15', 200], ['2026-11-01', 1500]]) {
    await store.addTransaction({ date, type: 'expense', category: '购物', amount, accountId: account.id, note: '' });
  }
  assert.deepEqual(store.getAllowanceCycle(account.id, '2026-10-14'), { startDate: '2026-09-15', endDate: '2026-10-14' });
  assert.equal(store.getAllowanceUsed(account.id, '2026-10-14'), 100);
  assert.deepEqual(store.getAllowanceCycle(account.id, '2026-10-15'), { startDate: '2026-10-15', endDate: '2026-11-14' });
  assert.equal(store.getAllowanceUsed(account.id, '2026-10-15'), 1700);
  assert.equal(store.getAllowanceUsed(account.id, '2026-11-15'), 0);
  assert.equal(store.getAllowanceRemaining(account.id, '2026-11-15'), 2000);
  const monthly = await store.addAccount({ name: '月初亲属卡', kind: 'allowance', allowanceLimit: 2000, resetDay: 1, note: '' });
  await store.addTransaction({ date: '2026-10-31', type: 'expense', category: '购物', amount: 1500, accountId: monthly.id, note: '' });
  assert.equal(store.getAllowanceUsed(monthly.id, '2026-10-31'), 1500);
  assert.equal(store.getAllowanceRemaining(monthly.id, '2026-11-01'), 2000);
});

test('allowance accounts are excluded from transfer, debt, reconciliation, and goal funding', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const asset = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const allowance = await store.addAccount({ name: '亲属卡', kind: 'allowance', allowanceLimit: 1000, note: '' });
  const liability = await store.addAccount({ name: '贷款', kind: 'liability', category: '助学贷款', openingBalance: 1000, note: '' });
  await assert.rejects(store.addTransaction({ date: '2026-10-01', type: 'transfer', amount: 10, fromAccountId: allowance.id, toAccountId: asset.id, note: '' }), /转账只能选择/);
  await assert.rejects(store.addTransaction({ date: '2026-10-01', type: 'transfer', amount: 10, fromAccountId: asset.id, toAccountId: allowance.id, note: '' }), /转账只能选择/);
  await assert.rejects(store.addTransaction({ date: '2026-10-01', type: 'debt', debtAction: 'borrow', amount: 10, assetAccountId: allowance.id, liabilityAccountId: liability.id, note: '' }), /有效的资产账户和负债账户/);
  await assert.rejects(store.reconcileAccount(allowance.id, 0), /不支持余额对账/);
  const goal = await store.addGoal({ name: '目标', targetAmount: 100, targetDate: null, priority: 'low', note: '' });
  await assert.rejects(store.allocateToGoal({ goalId: goal.id, accountId: allowance.id, date: '2026-10-01', amount: 10, direction: 'allocate', note: '' }), /有效的资产账户/);
});

test('schema v7 migrates income categories to explicit roots and adds allowance dashboard settings', async () => {
  const sourcePlugin = memoryPlugin(); const source = new FinanceStore(sourcePlugin); await source.load();
  const old = sourcePlugin.snapshot(); old.schemaVersion = 7;
  old.dashboardConfig.moduleOrder = old.dashboardConfig.moduleOrder.filter(module => module !== 'allowances');
  old.dashboardConfig.visibleModules = old.dashboardConfig.visibleModules.filter(module => module !== 'allowances');
  const plugin = memoryPlugin(old); const migrated = new FinanceStore(plugin); await migrated.load();
  assert.equal(plugin.snapshot().schemaVersion, 15);
  assert.ok(migrated.getCategories('income').every(category => category.parentId === null));
  assert.ok(migrated.getDashboardConfig().moduleOrder.includes('allowances'));
  assert.ok(migrated.getDashboardConfig().visibleModules.includes('allowances'));
});

test('schema v8 and backups migrate without losing finance data and add an empty wishlist', async () => {
  const sourcePlugin = memoryPlugin(); const source = new FinanceStore(sourcePlugin); await source.load();
  const account = await source.addAccount({ name: '旧账户', kind: 'asset', category: '银行存款', openingBalance: 800, note: '' });
  const old = sourcePlugin.snapshot(); old.schemaVersion = 8; delete old.shoppingItems;
  old.dashboardConfig.moduleOrder = old.dashboardConfig.moduleOrder.filter(module => module !== 'shopping');
  old.dashboardConfig.visibleModules = old.dashboardConfig.visibleModules.filter(module => module !== 'shopping');
  const plugin = memoryPlugin(old); const migrated = new FinanceStore(plugin); await migrated.load();
  assert.equal(plugin.snapshot().schemaVersion, 15);
  assert.deepEqual(plugin.snapshot().shoppingItems, []);
  assert.equal(migrated.getCurrentBalance(account.id), 800);
  assert.ok(migrated.getDashboardConfig().moduleOrder.includes('shopping'));
  assert.ok(migrated.getDashboardConfig().visibleModules.includes('shopping'));
  await migrated.setDashboardModuleVisible('shopping', false);
  const reloadedConfig = new FinanceStore(memoryPlugin(plugin.snapshot())); await reloadedConfig.load();
  assert.equal(reloadedConfig.getDashboardConfig().visibleModules.includes('shopping'), false);

  const oldBackup = { ...old, exportedAt: '2026-10-04T00:00:00.000Z' };
  const backupTarget = new FinanceStore(memoryPlugin()); await backupTarget.load();
  backupTarget.validateBackupPayload(oldBackup);
  await backupTarget.restoreBackup(oldBackup);
  assert.equal(backupTarget.getBackupPayload().schemaVersion, 15);
  assert.deepEqual(backupTarget.getShoppingItems(), []);
  assert.equal(backupTarget.getCurrentBalance(account.id), 800);
});

test('wishlist does not affect finance, provides affordability, then purchases through expense and budget', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 8200, note: '' });
  const shopping = store.getCategories('expense').find(item => item.parentId === null && item.name === '购物');
  const digital = await store.addCategory('expense', '数码', shopping.id);
  await store.saveBudget({ year: 2026, month: 10, totalLimit: null, categoryLimits: [{ categoryId: digital.id, limit: 1700 }] });
  const before = { assets: store.getTotalAssets(), liabilities: store.getTotalLiabilities(), netWorth: store.getNetWorth(),
    available: store.getTotalAvailableAssets(), expense: store.getMonthlyExpense(2026, 10), budget: store.getCategoryBudgetUsage(2026, 10)[0].used };
  const item = await store.addShoppingItem({ name: 'Sony 耳机', estimatedPrice: 1699, categoryId: digital.id,
    priority: 'medium', coolingOffDays: 7, reason: '旧耳机损坏', alternative: '继续使用旧耳机', note: '' });
  assert.equal(item.status, 'considering');
  assert.equal(item.addedAt, todayLocalDate());
  const expectedCoolingEnd = new Date(`${item.addedAt}T00:00:00Z`);
  expectedCoolingEnd.setUTCDate(expectedCoolingEnd.getUTCDate() + 7);
  assert.equal(store.getShoppingCoolingOff(item.id, item.addedAt).endDate, expectedCoolingEnd.toISOString().slice(0, 10));
  assert.equal(Math.round(store.getShoppingAffordability(item.id).percentage * 10) / 10, 20.7);
  assert.equal(store.getShoppingBudgetRemaining(digital.id, '2026-10-04'), 1700);
  assert.deepEqual({ assets: store.getTotalAssets(), liabilities: store.getTotalLiabilities(), netWorth: store.getNetWorth(),
    available: store.getTotalAvailableAssets(), expense: store.getMonthlyExpense(2026, 10), budget: store.getCategoryBudgetUsage(2026, 10)[0].used }, before);

  await store.setShoppingItemStatus(item.id, 'ready');
  assert.equal(store.getTransactions().length, 0);
  const transaction = await store.purchaseShoppingItem(item.id, { actualPrice: 1599, accountId: bank.id,
    categoryId: digital.id, date: '2026-10-04', note: '购买：Sony 耳机' });
  assert.equal(transaction.type, 'expense');
  assert.equal(transaction.amount, 1599);
  assert.equal(store.getCurrentBalance(bank.id), 6601);
  assert.equal(store.getMonthlyExpense(2026, 10), 1599);
  assert.equal(store.getCategoryBudgetUsage(2026, 10).find(item => item.categoryId === digital.id).used, 1599);
  const purchased = store.getShoppingItem(item.id);
  assert.equal(purchased.status, 'purchased');
  assert.equal(purchased.purchaseTransactionId, transaction.id);
  assert.equal(purchased.actualPrice, 1599);
  assert.equal(purchased.purchasedAt, '2026-10-04');

  await store.updateTransaction(transaction.id, { type: 'expense', amount: 1500, accountId: bank.id,
    category: digital.name, categoryId: digital.id, date: '2026-10-05', note: '已改价' });
  assert.equal(store.getShoppingItem(item.id).status, 'purchased');
  assert.equal(store.getShoppingItem(item.id).actualPrice, 1500);
  assert.equal(store.getShoppingItem(item.id).purchasedAt, '2026-10-05');
  assert.equal(await store.deleteTransaction(transaction.id), true);
  const restored = store.getShoppingItem(item.id);
  assert.equal(restored.status, 'ready');
  assert.equal(restored.purchaseTransactionId, null);
  assert.equal(restored.actualPrice, null);
  assert.equal(restored.purchasedAt, null);
  assert.equal(store.getCurrentBalance(bank.id), 8200);
});

test('allowance purchases and savings-goal conversion keep wishlist independent', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const asset = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 3000, note: '' });
  const allowance = await store.addAccount({ name: '亲属卡', kind: 'allowance', allowanceLimit: 200, resetDay: 1, note: '' });
  const expenseCategory = store.getCategories('expense').find(item => item.parentId === null && item.name === '餐饮');
  const allowanceItem = await store.addShoppingItem({ name: '外卖券', estimatedPrice: 100, categoryId: expenseCategory.id,
    priority: 'low', coolingOffDays: 0, reason: '', alternative: '', note: '' });
  const assetsBefore = store.getTotalAssets();
  const transaction = await store.purchaseShoppingItem(allowanceItem.id, { actualPrice: 100, accountId: allowance.id,
    categoryId: expenseCategory.id, date: '2026-10-04', note: '外卖券' });
  assert.equal(transaction.type, 'expense');
  assert.equal(store.getAllowanceUsed(allowance.id, '2026-10-04'), 100);
  assert.equal(store.getMonthlyExpense(2026, 10), 100);
  assert.equal(store.getTotalAssets(), assetsBefore);

  const macbook = await store.addShoppingItem({ name: 'MacBook', estimatedPrice: 12000, categoryId: null,
    priority: 'high', coolingOffDays: 14, reason: '', alternative: '', note: '工作用' });
  const goal = await store.convertShoppingItemToGoal(macbook.id, { name: 'MacBook', targetAmount: 12000,
    targetDate: null, priority: 'medium', note: '工作用' });
  assert.equal(goal.targetAmount, 12000);
  assert.equal(store.getShoppingItem(macbook.id).status, 'abandoned');
  assert.equal(store.getShoppingItem(macbook.id).convertedGoalId, goal.id);
  assert.equal(store.getTotalReservedBalance(), 0);
  assert.equal(store.getTotalAvailableAssets(), assetsBefore);

  const backup = store.getBackupPayload();
  assert.equal(backup.shoppingItems.length, 2);
  const restoredStore = new FinanceStore(memoryPlugin()); await restoredStore.load();
  await restoredStore.restoreBackup(backup);
  assert.deepEqual(restoredStore.getShoppingItems().map(item => item.status).sort(), ['abandoned', 'purchased']);
  assert.ok(restoredStore.getShoppingItem(macbook.id).convertedGoalId);
  assert.equal(restoredStore.getShoppingItem(allowanceItem.id).purchaseTransactionId, transaction.id);
  assert.equal(restoredStore.getTotalAssets(), assetsBefore);
});

test('credit liability spending adds debt and repayment moves balances without another expense', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const liabilityCategory = store.getCategories('liability')[0];
  const credit = await store.addAccount({ name: '微信先用后付', kind: 'liability', liabilityRole: 'credit', category: liabilityCategory.name, openingBalance: 0, note: '' });
  assert.equal(credit.liabilityRole, 'credit');
  const shop = store.getCategories('expense').find(item => item.name === '购物' && item.parentId === null);
  await store.addTransaction({ date: '2026-10-06', type: 'expense', amount: 300, category: shop.name, categoryId: shop.id, accountId: credit.id, note: '衣服' });
  assert.equal(store.getAccountBalance(bank.id), 1000);
  assert.equal(store.getLiabilityBalance(credit.id), 300);
  assert.equal(store.getTotalAssets(), 1000);
  assert.equal(store.getTotalLiabilities(), 300);
  assert.equal(store.getNetWorth(), 700);
  assert.equal(store.getMonthlyExpense(2026, 10), 300);
  const expenseBeforeRepay = store.getMonthlyExpense(2026, 10);
  await store.addTransaction({ date: '2026-10-07', type: 'debt', debtAction: 'repay', amount: 300,
    assetAccountId: bank.id, liabilityAccountId: credit.id, note: '' });
  assert.equal(store.getAccountBalance(bank.id), 700);
  assert.equal(store.getLiabilityBalance(credit.id), 0);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getMonthlyExpense(2026, 10), expenseBeforeRepay);
  assert.equal(store.getNetWorth(), 700);
  await assert.rejects(store.addTransaction({ date: '2026-10-07', type: 'expense', amount: 1,
    category: shop.name, categoryId: shop.id, accountId: credit.id, note: '' }).then(() => store.addTransaction({
      date: '2026-10-07', type: 'debt', debtAction: 'borrow', amount: 1, assetAccountId: bank.id, liabilityAccountId: credit.id, note: ''
    })), /信用支付账户不能记录为借入/);
});

test('credit accounts retain an optional default repayment asset without changing balances', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '招商银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const other = await store.addAccount({ name: '微信零钱', kind: 'asset', category: '第三方支付', openingBalance: 300, note: '' });
  const liabilityCategory = store.getCategories('liability')[0];
  const credit = await store.addAccount({ name: '淘宝先用后付', kind: 'liability', liabilityRole: 'credit',
    defaultRepaymentAccountId: bank.id, category: liabilityCategory.name, openingBalance: 250, note: '' });

  assert.equal(credit.defaultRepaymentAccountId, bank.id);
  assert.equal(store.getTotalAssets(), 1300);
  assert.equal(store.getTotalLiabilities(), 250);
  assert.equal(store.getNetWorth(), 1050);

  const reloaded = new FinanceStore(plugin); await reloaded.load();
  assert.equal(reloaded.getAccount(credit.id).defaultRepaymentAccountId, bank.id);
  const updated = await reloaded.updateAccount(credit.id, { kind: 'liability', liabilityRole: 'credit',
    defaultRepaymentAccountId: other.id, category: liabilityCategory.name, categoryId: liabilityCategory.id,
    openingBalance: 250, name: credit.name, note: '' });
  assert.equal(updated.defaultRepaymentAccountId, other.id);
  assert.equal(reloaded.getTotalAssets(), 1300);
  assert.equal(reloaded.getTotalLiabilities(), 250);

  await reloaded.deleteAccount(other.id);
  assert.equal(reloaded.getAccount(credit.id).defaultRepaymentAccountId, undefined);
  await assert.rejects(reloaded.updateAccount(credit.id, { kind: 'liability', liabilityRole: 'credit',
    defaultRepaymentAccountId: 'missing-account', category: liabilityCategory.name,
    categoryId: liabilityCategory.id, openingBalance: 250, name: credit.name, note: '' }), /默认扣款账户必须是有效的资产账户/);
});

test('credit purchase affects expense and liability, then repayment moves cash without repeating expense', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 5000, note: '' });
  const liabilityCategory = store.getCategories('liability')[0];
  const credit = await store.addAccount({ name: '淘宝先用后付', kind: 'liability', liabilityRole: 'credit',
    category: liabilityCategory.name, openingBalance: 0, note: '' });
  const shop = store.getCategories('expense').find(item => item.name === '购物' && item.parentId === null);
  await store.saveBudget({ year: 2026, month: 10, totalLimit: 1000, categoryLimits: [] });

  await store.addTransaction({ date: '2026-10-06', type: 'expense', amount: 300, category: shop.name,
    categoryId: shop.id, accountId: credit.id, note: '信用支付消费' });
  assert.equal(store.getAccountBalance(bank.id), 5000);
  assert.equal(store.getLiabilityBalance(credit.id), 300);
  assert.equal(store.getTotalPendingCreditPayments(), 300);
  assert.equal(store.getTotalLiabilities(), 300);
  assert.equal(store.getNetWorth(), 4700);
  assert.equal(store.getMonthlyExpense(2026, 10), 300);
  assert.equal(store.getBudgetUsage(2026, 10).used, 300);

  await store.addTransaction({ date: '2026-10-07', type: 'debt', debtAction: 'repay', amount: 300,
    assetAccountId: bank.id, liabilityAccountId: credit.id, note: '' });
  assert.equal(store.getAccountBalance(bank.id), 4700);
  assert.equal(store.getLiabilityBalance(credit.id), 0);
  assert.equal(store.getTotalPendingCreditPayments(), 0);
  assert.equal(store.getTotalLiabilities(), 0);
  assert.equal(store.getNetWorth(), 4700);
  assert.equal(store.getMonthlyExpense(2026, 10), 300);
  assert.equal(store.getBudgetUsage(2026, 10).used, 300);
});

test('pending credit total includes each positive credit balance once and projected availability is derived', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const bank = await store.addAccount({ name: '工资卡', kind: 'asset', category: '银行存款', openingBalance: 6000, note: '' });
  const liabilityCategory = store.getCategories('liability')[0];
  const alipay = await store.addAccount({ name: '淘宝先用后付', kind: 'liability', liabilityRole: 'credit', category: liabilityCategory.name, openingBalance: 0, note: '' });
  const jd = await store.addAccount({ name: '京东先用后付', kind: 'liability', liabilityRole: 'credit', category: liabilityCategory.name, openingBalance: 0, note: '' });
  const shop = store.getCategories('expense').find(item => item.name === '购物' && item.parentId === null);
  await store.addTransaction({ date: '2026-10-06', type: 'expense', amount: 300, category: shop.name,
    categoryId: shop.id, accountId: alipay.id, note: '' });
  await store.addTransaction({ date: '2026-10-06', type: 'expense', amount: 180, category: shop.name,
    categoryId: shop.id, accountId: jd.id, note: '' });

  assert.deepEqual(store.getPendingCreditAccounts().map(item => item.balance), [300, 180]);
  assert.equal(store.getTotalPendingCreditPayments(), 480);
  assert.equal(store.getTotalAssets(), 6000);
  assert.equal(store.getTotalLiabilities(), 480);
  assert.equal(store.getNetWorth(), 5520);
  assert.equal(store.getTotalAvailableAssets(), 6000);
  assert.equal(store.getProjectedAvailableAssetsAfterCreditRepayment(), 5520);
  assert.equal(store.getAccountBalance(bank.id), 6000);
});

test('refunds cap against the original expense, net expense in its original period, and reverse account effects', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const liabilityCategory = store.getCategories('liability')[0];
  const credit = await store.addAccount({ name: '花呗', kind: 'liability', liabilityRole: 'credit', category: liabilityCategory.name, openingBalance: 0, note: '' });
  const shop = store.getCategories('expense').find(item => item.name === '购物' && item.parentId === null);
  await store.saveBudget({ year: 2026, month: 9, totalLimit: null, categoryLimits: [{ categoryId: shop.id, limit: 1000 }] });
  const expense = await store.addTransaction({ date: '2026-09-29', type: 'expense', amount: 300, category: shop.name,
    categoryId: shop.id, accountId: bank.id, note: '衣服' });
  const refund = (amount, target) => store.addTransaction({ type: 'refund', originalTransactionId: expense.id,
    refundDestinationAccountId: target, amount, date: '2026-10-02', note: '' });
  await refund(100, bank.id); await refund(50, bank.id);
  assert.equal(store.getRefundedAmount(expense.id), 150);
  assert.equal(store.getRemainingRefundable(expense.id), 150);
  assert.equal(store.getMonthlyExpense(2026, 9), 150);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getCategoryBudgetUsage(2026, 9).find(item => item.categoryId === shop.id).used, 150);
  assert.equal(store.getAccountBalance(bank.id), 850);
  await assert.rejects(refund(151, bank.id), /累计退款金额超过原支出金额/);
  const deletedRefund = store.getTransactions('refund')[0];
  await store.deleteTransaction(deletedRefund.id);
  assert.equal(store.getRefundedAmount(expense.id), 150 - deletedRefund.amount);
  assert.equal(store.getMonthlyExpense(2026, 9), 150 + deletedRefund.amount);
  assert.equal(store.getAccountBalance(bank.id), 850 - deletedRefund.amount);
  await assert.rejects(store.deleteTransaction(expense.id), /已有退款记录/);
  await assert.rejects(store.updateTransaction(expense.id, { type: 'expense', date: expense.date,
    amount: store.getRefundedAmount(expense.id) - 0.01, category: expense.category, categoryId: expense.categoryId,
    accountId: expense.accountId, note: expense.note }), /金额不能低于累计退款/);

  const creditExpense = await store.addTransaction({ date: '2026-10-01', type: 'expense', amount: 300,
    category: shop.name, categoryId: shop.id, accountId: credit.id, note: '' });
  await store.addTransaction({ type: 'refund', originalTransactionId: creditExpense.id,
    refundDestinationAccountId: credit.id, amount: 100, date: '2026-10-03', note: '' });
  assert.equal(store.getLiabilityBalance(credit.id), 200);
  assert.equal(store.getMonthlyExpense(2026, 10), 200);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  await store.addTransaction({ date: '2026-10-04', type: 'debt', debtAction: 'repay', amount: 100,
    assetAccountId: bank.id, liabilityAccountId: credit.id, note: '' });
  await assert.rejects(store.addTransaction({ type: 'refund', originalTransactionId: creditExpense.id,
    refundDestinationAccountId: credit.id, amount: 101, date: '2026-10-05', note: '' }),
  /退款金额超过当前信用负债，请选择实际退款到账的资产账户/);
  assert.ok(buildTransactionsCsv(store).includes(',refund,'));
  const restored = new FinanceStore(memoryPlugin(plugin.snapshot())); await restored.load();
  assert.equal(restored.getRefundedAmount(creditExpense.id), 100);
  assert.equal(restored.getLiabilityBalance(credit.id), 100);
  assert.equal(restored.getMonthlyExpense(2026, 10), 200);
});

test('receivables count as assets while only personal share is expense; collections convert receivable to cash', async () => {
  const plugin = memoryPlugin(); const store = new FinanceStore(plugin); await store.load();
  const wallet = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 1000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const before = store.getNetWorth();
  const receipt = await store.addReceivable({ title: '旅行聚餐', date: '2026-10-06', paymentAccountId: wallet.id,
    categoryId: food.id, totalPaid: 600, personalShare: 200, counterparty: '小王', note: '' });
  assert.equal(store.getAccountBalance(wallet.id), 400);
  assert.equal(store.getReceivableOutstanding(receipt.id), 400);
  assert.equal(store.getTotalReceivableOutstanding(), 400);
  assert.equal(store.getTotalAssets(), 800);
  assert.equal(store.getTotalAvailableAssets(), 400);
  assert.equal(store.getMonthlyExpense(2026, 10), 200);
  assert.equal(store.getNetWorth(), before - 200);
  const collection = await store.addReceivableCollection({ receivableId: receipt.id, amount: 150, accountId: wallet.id,
    date: '2026-10-08', note: '小王转账' });
  assert.equal(store.getAccountBalance(wallet.id), 550);
  assert.equal(store.getReceivableOutstanding(receipt.id), 250);
  assert.equal(store.getReceivable(receipt.id).status, 'open');
  assert.equal(store.getTotalAssets(), 800);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getMonthlyExpense(2026, 10), 200);
  assert.equal(store.getNetWorth(), before - 200);
  await assert.rejects(store.deleteReceivable(receipt.id), /已有收回记录/);
  await store.deleteReceivableCollection(collection.id);
  assert.equal(store.getAccountBalance(wallet.id), 400);
  assert.equal(store.getReceivableOutstanding(receipt.id), 400);
  await store.addReceivableCollection({ receivableId: receipt.id, amount: 150, accountId: wallet.id, date: '2026-10-09', note: '' });
  await store.addReceivableCollection({ receivableId: receipt.id, amount: 250, accountId: wallet.id, date: '2026-10-10', note: '' });
  assert.equal(store.getReceivableOutstanding(receipt.id), 0);
  assert.equal(store.getReceivable(receipt.id).status, 'settled');
  const reloaded = new FinanceStore(memoryPlugin(plugin.snapshot())); await reloaded.load();
  assert.equal(reloaded.getTotalReceivableOutstanding(), 0);
  assert.equal(reloaded.getAccountBalance(wallet.id), 800);
  assert.equal(reloaded.getReceivable(receipt.id).status, 'settled');
  const backup = reloaded.getBackupPayload(); assert.equal(backup.receivables.length, 1); assert.equal(backup.receivableCollections.length, 2);
  const csv = buildTransactionsCsv(reloaded);
  assert.ok(csv.includes(',receivable,')); assert.ok(csv.includes(',receivableCollection,'));
});

test('credit-funded advances charge full credit but recognize only personal expense and preserve receivable through migration', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const liabilityCategory = store.getCategories('liability')[0];
  const credit = await store.addAccount({ name: '白条', kind: 'liability', liabilityRole: 'credit', category: liabilityCategory.name, openingBalance: 0, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const receipt = await store.addReceivable({ title: '聚餐', date: '2026-10-06', paymentAccountId: credit.id,
    categoryId: food.id, totalPaid: 600, personalShare: 200, counterparty: '朋友', note: '' });
  assert.equal(store.getLiabilityBalance(credit.id), 600);
  assert.equal(store.getTotalReceivableOutstanding(), 400);
  assert.equal(store.getTotalAssets(), 400);
  assert.equal(store.getNetWorth(), -200);
  assert.equal(store.getMonthlyExpense(2026, 10), 200);
  await assert.rejects(store.addReceivable({ title: '无代垫', date: '2026-10-06', paymentAccountId: credit.id,
    categoryId: food.id, totalPaid: 200, personalShare: 200, counterparty: '', note: '' }), /没有待收回金额/);
  const payload = store.getBackupPayload();
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(payload);
  assert.equal(restored.getReceivable(receipt.id).title, '聚餐');
  assert.equal(restored.getLiabilityBalance(credit.id), 600);
  assert.equal(restored.getMonthlyExpense(2026, 10), 200);
});

test('closing a receivable writes off only its outstanding amount as non-cash personal expense', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const wallet = await store.addAccount({ name: '银行卡', kind: 'asset', category: '银行存款', openingBalance: 1000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  await store.saveBudget({ year: 2026, month: 10, totalLimit: 1000, categoryLimits: [] });
  const receipt = await store.addReceivable({ title: '旅行聚餐', date: '2026-10-06', paymentAccountId: wallet.id,
    categoryId: food.id, totalPaid: 600, personalShare: 200, counterparty: '小王', note: '' });
  assert.equal(store.getAccountBalance(wallet.id), 400);
  assert.equal(store.getTotalAssets(), 800);
  assert.equal(store.getMonthlyExpense(2026, 10), 200);

  await store.addReceivableCollection({ receivableId: receipt.id, amount: 300, accountId: wallet.id,
    date: '2026-10-08', note: '' });
  assert.equal(store.getAccountBalance(wallet.id), 700);
  assert.equal(store.getReceivableOutstanding(receipt.id), 100);
  assert.equal(store.getTotalAssets(), 800);

  const netWorthBeforeClose = store.getNetWorth();
  const closed = await store.closeReceivable({ receivableId: receipt.id, categoryId: food.id,
    date: '2026-10-10', note: '不再追收' });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.writtenOffAmount, 100);
  assert.equal(closed.closedAt, '2026-10-10');
  assert.equal(store.getReceivableOutstanding(receipt.id), 0);
  assert.equal(store.getTotalReceivableOutstanding(), 0);
  assert.equal(store.getAccountBalance(wallet.id), 700);
  assert.equal(store.getTotalAssets(), 700);
  assert.equal(store.getNetWorth(), netWorthBeforeClose - 100);
  assert.equal(store.getMonthlyExpense(2026, 10), 300);
  assert.equal(store.getBudgetUsage(2026, 10).used, 300);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getTransactions('expense').filter(item => item.receivableWriteOffId === receipt.id).length, 1);
  assert.equal(store.getReceivableCollections(receipt.id).length, 1);
  await assert.rejects(store.addReceivableCollection({ receivableId: receipt.id, amount: 1, accountId: wallet.id,
    date: '2026-10-11', note: '' }), /只有未完成的代垫可以收回/);

  const backup = store.getBackupPayload(); assert.equal(backup.schemaVersion, 15);
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(backup);
  assert.equal(restored.getReceivable(receipt.id).writtenOffAmount, 100);
  assert.equal(restored.getReceivable(receipt.id).closedAt, '2026-10-10');
  assert.equal(restored.getAccountBalance(wallet.id), 700);
  assert.equal(restored.getMonthlyExpense(2026, 10), 300);
});

test('schema v10 receivables migrate partial collection state into open and preserve settled history', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const wallet = await store.addAccount({ name: '微信', kind: 'asset', category: '第三方支付', openingBalance: 1000, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const partial = await store.addReceivable({ title: '聚餐', date: '2026-10-06', paymentAccountId: wallet.id,
    categoryId: food.id, totalPaid: 500, personalShare: 100, counterparty: '', note: '' });
  const settled = await store.addReceivable({ title: '门票', date: '2026-10-07', paymentAccountId: wallet.id,
    categoryId: food.id, totalPaid: 300, personalShare: 100, counterparty: '', note: '' });
  await store.addReceivableCollection({ receivableId: partial.id, amount: 200, accountId: wallet.id, date: '2026-10-08', note: '' });
  await store.addReceivableCollection({ receivableId: settled.id, amount: 200, accountId: wallet.id, date: '2026-10-08', note: '' });
  const legacy = store.getBackupPayload(); legacy.schemaVersion = 10;
  for (const item of legacy.receivables) {
    delete item.writtenOffAmount; delete item.closedAt;
    if (item.id === partial.id) item.status = 'partial';
  }
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(legacy);
  assert.equal(restored.getReceivable(partial.id).status, 'open');
  assert.equal(restored.getReceivable(partial.id).writtenOffAmount, 0);
  assert.equal(restored.getReceivable(partial.id).closedAt, null);
  assert.equal(restored.getReceivableOutstanding(partial.id), 200);
  assert.equal(restored.getReceivable(settled.id).status, 'settled');
  assert.equal(restored.getReceivableOutstanding(settled.id), 0);
});

test('schema v9 migration assigns old liabilities as loans and initializes receivable collections', async () => {
  const source = new FinanceStore(memoryPlugin()); await source.load();
  await source.addAccount({ name: '助学贷款', kind: 'liability', category: '助学贷款', openingBalance: 100, note: '' });
  const old = source.getBackupPayload(); old.schemaVersion = 9;
  delete old.receivables; delete old.receivableCollections;
  for (const account of old.accounts) if (account.kind === 'liability') delete account.liabilityRole;
  const plugin = memoryPlugin(old); const migrated = new FinanceStore(plugin); await migrated.load();
  assert.equal(migrated.getAccounts('liability')[0].liabilityRole, 'loan');
  assert.deepEqual(plugin.snapshot().receivables, []);
  assert.deepEqual(plugin.snapshot().receivableCollections, []);
  assert.equal(plugin.snapshot().schemaVersion, 15);
});

test('refund to allowance restores allowance use without becoming income', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const allowance = await store.addAccount({ name: '亲属卡', kind: 'allowance', allowanceLimit: 500, resetDay: 1, note: '' });
  const food = store.getCategories('expense').find(item => item.name === '餐饮' && item.parentId === null);
  const expense = await store.addTransaction({ date: '2026-10-06', type: 'expense', amount: 100,
    category: food.name, categoryId: food.id, accountId: allowance.id, note: '' });
  await store.addTransaction({ type: 'refund', originalTransactionId: expense.id,
    refundDestinationAccountId: allowance.id, amount: 30, date: '2026-10-07', note: '' });
  assert.equal(store.getAllowanceUsed(allowance.id, '2026-10-07'), 70);
  assert.equal(store.getAllowanceRemaining(allowance.id, '2026-10-07'), 430);
  assert.equal(store.getMonthlyExpense(2026, 10), 70);
  assert.equal(store.getMonthlyIncome(2026, 10), 0);
  assert.equal(store.getDailySummary('2026-10-07').refund, 30);
});

test('taxed income separates gross statistics from net account balance; refunds and additional tax stay outside spending', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash',
    category: '银行存款', openingBalance: 1000, note: '' });
  const category = store.getCategories('income', true).find(item => item.parentId === null);
  const income = await store.addTransaction({ type: 'income', date: '2026-12-20', amount: 2000,
    grossAmount: 2000, taxAmount: 320, netAmount: 1680, taxTreatment: 'withholding', taxYear: 2026,
    accountId: bank.id, category: category.name, categoryId: category.id, note: '劳务酬金' });
  assert.equal(income.amount, 2000);
  assert.equal(store.getAccountBalance(bank.id), 2680);
  assert.equal(store.getTotalAssets(), 2680);
  assert.equal(store.getMonthlyIncome(2026, 12), 2000);
  assert.equal(store.getMonthlyExpense(2026, 12), 0);
  assert.equal(store.getBudgetUsage(2026, 12).used, 0);
  assert.deepEqual(store.getTaxYearSummary(2026), { taxYear: 2026, grossIncome: 2000, netIncome: 1680,
    withholding: 320, finalTax: 0, refund: 0, additionalPayment: 0, netTaxBurden: 320 });

  await store.addTaxRecord({ type: 'refund', amount: 250, date: '2027-03-15', taxYear: 2026,
    accountId: bank.id, note: '年度汇算退税' });
  assert.equal(store.getAccountBalance(bank.id), 2930);
  assert.equal(store.getMonthlyIncome(2027, 3), 0);
  assert.equal(store.getTaxYearSummary(2026).netTaxBurden, 70);
  assert.equal(store.getTaxYearSummary(2026).grossIncome, 2000);

  const final = await store.addTransaction({ type: 'income', date: '2026-12-22', amount: 2000,
    grossAmount: 2000, taxAmount: 200, netAmount: 1800, taxTreatment: 'final', taxYear: 2026,
    accountId: bank.id, category: category.name, categoryId: category.id, note: '确定为最终税费' });
  assert.equal(store.getAccountBalance(bank.id), 4730);
  assert.equal(store.getMonthlyIncome(2026, 12), 4000);
  assert.equal(store.getMonthlyExpense(2026, 12), 0);
  assert.equal(store.getTaxYearSummary(2026).finalTax, 200);

  await store.addTaxRecord({ type: 'additional_payment', amount: 100, date: '2027-03-16', taxYear: 2026,
    accountId: bank.id, note: '汇算补税' });
  assert.equal(store.getAccountBalance(bank.id), 4630);
  assert.equal(store.getMonthlyExpense(2027, 3), 0);
  assert.equal(store.getBudgetUsage(2027, 3).used, 0);
  assert.equal(store.getTaxYearSummary(2026).netTaxBurden, 370);

  const taxRecord = store.getTaxRecords(2026).find(item => item.incomeTransactionId === final.id);
  assert.equal(taxRecord.type, 'final_tax');
  await store.updateTransaction(final.id, { type: 'income', date: final.date, amount: 2000,
    grossAmount: 2000, taxAmount: 150, netAmount: 1850, taxTreatment: 'withholding', taxYear: 2026,
    accountId: bank.id, category: category.name, categoryId: category.id, note: final.note });
  assert.equal(store.getAccountBalance(bank.id), 4680);
  assert.equal(store.getTaxYearSummary(2026).withholding, 470);
  assert.equal(store.getTaxYearSummary(2026).finalTax, 0);
  await store.deleteTransaction(final.id);
  assert.equal(store.getAccountBalance(bank.id), 2830);
  assert.equal(store.getTaxRecords(2026).some(item => item.incomeTransactionId === final.id), false);
  assert.equal(store.getMonthlyIncome(2026, 12), 2000);
});

test('full tax refund offsets withholding without increasing income and tax data survives backup restore', async () => {
  const store = new FinanceStore(memoryPlugin()); await store.load();
  const bank = await store.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash', category: '银行存款', openingBalance: 0, note: '' });
  const category = store.getCategories('income', true).find(item => item.parentId === null);
  await store.addTransaction({ type: 'income', date: '2026-05-01', amount: 2000,
    grossAmount: 2000, taxAmount: 320, netAmount: 1680, taxTreatment: 'withholding', taxYear: 2026,
    accountId: bank.id, category: category.name, categoryId: category.id, note: '' });
  await store.addTaxRecord({ type: 'refund', amount: 320, date: '2027-03-01', taxYear: 2026,
    accountId: bank.id, note: '' });
  assert.equal(store.getAccountBalance(bank.id), 2000);
  assert.equal(store.getTaxYearSummary(2026).netTaxBurden, 0);
  assert.equal(store.getMonthlyIncome(2027, 3), 0);
  const backup = store.getBackupPayload();
  assert.equal(backup.taxRecords.length, 2);
  const restored = new FinanceStore(memoryPlugin()); await restored.load(); await restored.restoreBackup(backup);
  assert.equal(restored.getAccountBalance(bank.id), 2000);
  assert.equal(restored.getTaxYearSummary(2026).netTaxBurden, 0);
  assert.equal(restored.getTaxRecords(2026).length, 2);
  assert.match(buildTransactionsCsv(restored), /grossAmount,taxAmount,netAmount,taxTreatment,taxYear/);
  assert.match(buildTransactionsCsv(restored), /tax-refund/);
});

test('schema v14 income migrates as tax-free legacy income without changing balances', async () => {
  const source = memoryPlugin(); const original = new FinanceStore(source); await original.load();
  const bank = await original.addAccount({ name: '银行卡', kind: 'asset', accountRole: 'cash', category: '银行存款', openingBalance: 500, note: '' });
  const category = original.getCategories('income', true).find(item => item.parentId === null);
  const oldIncome = await original.addTransaction({ type: 'income', date: '2026-04-05', amount: 1000,
    accountId: bank.id, category: category.name, categoryId: category.id, note: '' });
  const legacy = source.snapshot(); legacy.schemaVersion = 14; delete legacy.taxRecords;
  for (const transaction of legacy.transactions) if (transaction.type === 'income') {
    delete transaction.grossAmount; delete transaction.taxAmount; delete transaction.netAmount;
    delete transaction.taxTreatment; delete transaction.taxYear;
  }
  const migratedPlugin = memoryPlugin(legacy); const migrated = new FinanceStore(migratedPlugin); await migrated.load();
  const result = migrated.getTransaction(oldIncome.id);
  assert.equal(result.grossAmount, 1000); assert.equal(result.taxAmount, 0);
  assert.equal(result.netAmount, 1000); assert.equal(result.taxTreatment, 'none');
  assert.equal(result.taxYear, 2026); assert.equal(migratedPlugin.snapshot().taxRecords.length, 0);
  assert.equal(migrated.getAccountBalance(bank.id), 1500);
  assert.equal(migrated.getMonthlyIncome(2026, 4), 1000);
});
