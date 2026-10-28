import type { Plugin } from 'obsidian';
import type {
  Account, AccountInput, AccountKind, AccountRole, BalanceAccountKind, CategoryDefinition, CategoryScope, LiabilityRole,
  AllowanceCycle, AllowanceStatus, BudgetPlan, BudgetPlanInput, BudgetUsage, CategoryBudgetUsage, ExpenseBreakdownItem, ExpenseFundingBreakdown, PaymentSourceExpense, GoalAllocation,
  GoalAllocationInput, GoalStatus, SavingsGoal, SavingsGoalInput, ShoppingAffordability, ShoppingItem,
  ShoppingCoolingOff, ShoppingItemInput, ShoppingPriority, ShoppingPurchaseInput, ShoppingStatus,
  DashboardConfig, DashboardModule, DashboardVisibleModule, ExpenseChartMode, FinanceData,
  PeriodMode, TableConfig, UIConfig, TransactionColumn, DateRange, AdjustmentTarget,
  Transaction, TransactionInput, TransactionType, TransferKind, TransferTransaction, InvestmentIncomeKind, Receivable, ReceivableInput,
  ReceivableCollection, ReceivableCollectionInput, ReceivableStatus, ReceivableWriteOffInput, RefundTransaction,
  InvestmentValuation, InvestmentValuationSnapshot, TaxRecord, TaxRecordInput, TaxRecordType, TaxTreatment
} from './types';
import { createDefaultCategories, DEFAULT_DASHBOARD_CONFIG, DEFAULT_TABLE_CONFIG, DEFAULT_UI_CONFIG, DEFAULT_TRANSACTION_COLUMN_WIDTHS, CATEGORY_SCOPES, DEFAULT_INVESTMENT_CATEGORY_IDS } from './types';
import { getMonthDateRange, todayLocalDate } from './utils/date';

export interface DailySummary {
  income: number;
  expense: number;
  investmentIncome: number;
  refund: number;
  investmentInflow: number;
  investmentOutflow: number;
  transferCount: number;
  debtBorrow: number;
  debtRepay: number;
}

export interface CategoryBreakdownItem {
  category: string;
  amount: number;
  percentage: number;
}

export interface RangeSummary {
  income: number;
  expense: number;
  investment: number;
}

export interface InvestmentSummary {
  marketValue: number;
  openingBasis: number;
  contributed: number;
  redeemed: number;
  income: number;
  returnAmount: number;
  returnRate: number | null;
}

export interface InvestmentAccountSummary {
  accountId: string;
  marketValue: number;
  openingBasis: number;
  transferredIn: number;
  transferredOut: number;
  income: number;
  returnAmount: number;
  returnRate: number | null;
}

export interface InvestmentCategorySummary {
  categoryId: string;
  name: string;
  marketValue: number;
  percentage: number;
}

export interface InvestmentValuationInput {
  accountId: string;
  date: string;
  marketValue: number;
  note: string;
}

type AccountValues =
  | (Pick<Extract<Account, { kind: 'asset' }>, 'name' | 'category' | 'categoryId' | 'openingBalance' | 'note' | 'investmentCategoryId'>
    & { kind: 'asset'; accountRole: AccountRole })
  | (Pick<Account, 'name' | 'category' | 'categoryId' | 'openingBalance' | 'note'>
    & { kind: 'liability'; liabilityRole: LiabilityRole; defaultRepaymentAccountId?: string })
  | (Pick<Account, 'name' | 'category' | 'categoryId' | 'openingBalance' | 'note'>
    & { kind: 'allowance'; allowancePeriod: 'monthly'; allowanceLimit: number; resetDay: number; rollover: false });
type TransactionValues = Transaction extends infer Item
  ? Item extends Transaction ? Omit<Item, 'id' | 'createdAt' | 'updatedAt'> : never
  : never;

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

function formatStoreCny(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
}

function validMoney(value: unknown, allowZero: boolean): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const cents = moneyCents(value);
  return (allowZero ? value >= 0 : value > 0)
    && Number.isSafeInteger(cents)
    && Math.abs(value * 100 - cents) <= 1e-7;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function monthlyResetDate(year: number, month: number, resetDay: number): string {
  const day = Math.min(resetDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function commonAccount(value: unknown): boolean {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.name === 'string'
    && (item.kind === 'asset' || item.kind === 'liability')
    && typeof item.category === 'string' && typeof item.note === 'string'
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isAllowanceAccount(value: unknown): boolean {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.name === 'string' && item.kind === 'allowance'
    && typeof item.category === 'string' && typeof item.categoryId === 'string'
    && item.openingBalance === 0 && typeof item.note === 'string'
    && item.allowancePeriod === 'monthly' && validMoney(item.allowanceLimit, true)
    && Number.isInteger(item.resetDay) && (item.resetDay as number) >= 1 && (item.resetDay as number) <= 31
    && item.rollover === false && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isAccountV1(value: unknown): boolean {
  return commonAccount(value) && validMoney(record(value)?.balance, true);
}

function isAccountV2(value: unknown): boolean {
  return commonAccount(value) && validMoney(record(value)?.openingBalance, true);
}

function isAccountV3(value: unknown): value is Account {
  const item = record(value);
  return isAccountV2(value) && !!item
    && (item.kind === 'asset'
      ? item.accountRole === 'cash' || item.accountRole === 'investment'
      : item.accountRole === undefined);
}

function isAccountV4(value: unknown): value is Account {
  const item = record(value);
  return isAccountV3(value) && !!item && typeof item.categoryId === 'string';
}

function isAccountV5(value: unknown): value is Account {
  const item = record(value);
  return isAccountV4(value) && !!item
    && (item.lastReconciledAt === undefined || validDate(item.lastReconciledAt));
}

function isAccountCurrent(value: unknown): value is Account {
  const item = record(value);
  return isAllowanceAccount(value) || (isAccountV5(value) && !!item
    && (item.kind === 'asset'
      ? (item.accountRole === 'cash' && item.investmentCategoryId === null)
        || (item.accountRole === 'investment' && typeof item.investmentCategoryId === 'string')
      : item.liabilityRole === 'loan' || item.liabilityRole === 'credit'));
}

function isAccountV11(value: unknown): boolean {
  const item = record(value);
  return isAllowanceAccount(value) || (isAccountV5(value) && !!item
    && (item.kind === 'asset' || item.liabilityRole === 'loan' || item.liabilityRole === 'credit'));
}

function isAccountV9(value: unknown): boolean {
  return isAccountV5(value) || isAllowanceAccount(value);
}

function isAllowanceAccountType(account: Account): account is Extract<Account, { kind: 'allowance' }> {
  return account.kind === 'allowance';
}

function commonTransaction(value: unknown): boolean {
  const item = record(value);
  return !!item && typeof item.id === 'string' && validDate(item.date)
    && validMoney(item.amount, false) && typeof item.note === 'string'
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isOrdinaryV2(value: unknown): boolean {
  const item = record(value);
  return commonTransaction(value) && !!item
    && (item.type === 'income' || item.type === 'expense')
    && typeof item.category === 'string' && typeof item.accountId === 'string';
}

type PreAdjustmentTransaction = Exclude<Transaction, { type: 'adjustment' }>;

function isTransactionV3(value: unknown): value is PreAdjustmentTransaction {
  const item = record(value);
  if (!commonTransaction(value) || !item) return false;
  switch (item.type) {
    case 'income':
    case 'expense':
      return typeof item.category === 'string' && typeof item.accountId === 'string';
    case 'transfer':
      return typeof item.fromAccountId === 'string'
        && typeof item.toAccountId === 'string' && item.fromAccountId !== item.toAccountId;
    case 'debt':
      return (item.debtAction === 'borrow' || item.debtAction === 'repay')
        && typeof item.assetAccountId === 'string'
        && typeof item.liabilityAccountId === 'string';
    default:
      return false;
  }
}

function isTransactionV4(value: unknown): value is PreAdjustmentTransaction {
  const item = record(value);
  return isTransactionV3(value) && !!item
    && (item.type !== 'income' && item.type !== 'expense' || typeof item.categoryId === 'string');
}

function isAdjustmentV5(value: unknown): boolean {
  const item = record(value);
  return commonTransaction(value) && !!item && item.type === 'adjustment'
    && typeof item.accountId === 'string'
    && (item.adjustmentTarget === 'asset' || item.adjustmentTarget === 'liability')
    && (item.direction === 'increase' || item.direction === 'decrease');
}

function isTransactionV5(value: unknown): boolean {
  return isTransactionV4(value) || isAdjustmentV5(value);
}

function isTransactionV10(value: unknown): boolean {
  const item = record(value);
  return isTransactionV5(value) || (!!item && commonTransaction(value) && item.type === 'refund'
    && typeof item.originalTransactionId === 'string' && typeof item.refundDestinationAccountId === 'string');
}

function isTransactionV11(value: unknown): boolean {
  const item = record(value);
  if (!isTransactionV10(value) || !item) return false;
  if (!('receivableWriteOffId' in item)) return true;
  return item.type === 'expense' && typeof item.receivableWriteOffId === 'string' && !!item.receivableWriteOffId;
}

function isInvestmentIncomeTransaction(value: unknown): boolean {
  const item = record(value);
  return commonTransaction(value) && !!item && item.type === 'investment-income'
    && typeof item.investmentAccountId === 'string' && typeof item.accountId === 'string'
    && ['dividend', 'interest', 'cash-dividend', 'other'].includes(String(item.incomeKind));
}

function isInvestmentValuation(value: unknown): value is InvestmentValuation {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.accountId === 'string'
    && validDate(item.date) && validMoney(item.marketValue, true) && typeof item.note === 'string'
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isTransactionV13(value: unknown): boolean {
  return isTransactionV11(value) || isInvestmentIncomeTransaction(value);
}

function isTaxRecord(value: unknown): value is TaxRecord {
  const item = record(value);
  return !!item && typeof item.id === 'string' && ['withholding', 'final_tax', 'refund', 'additional_payment'].includes(String(item.type))
    && validMoney(item.amount, false) && validDate(item.date) && Number.isInteger(item.taxYear)
    && (item.taxYear as number) >= 1900 && (item.taxYear as number) <= 9999
    && (item.incomeTransactionId === null || typeof item.incomeTransactionId === 'string')
    && typeof item.accountId === 'string' && item.status === 'recorded' && typeof item.note === 'string'
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isTransactionV15(value: unknown): boolean {
  const item = record(value);
  if (!isTransactionV13(value) || !item) return false;
  if (item.type !== 'income') return true;
  const treatment = item.taxTreatment;
  const gross = item.grossAmount;
  const tax = item.taxAmount;
  const net = item.netAmount;
  const taxYear = item.taxYear;
  return validMoney(gross, false) && validMoney(tax, true) && validMoney(net, true)
    && Number.isInteger(taxYear) && (taxYear as number) >= 1900
    && ['none', 'withholding', 'final'].includes(String(treatment))
    && moneyCents(gross as number) - moneyCents(tax as number) === moneyCents(net as number)
    && (treatment !== 'none' || moneyCents(tax as number) === 0);
}

function accountCategoryScope(account: Pick<Exclude<Account, { kind: 'allowance' }>, 'kind' | 'accountRole'>): CategoryScope {
  if (account.kind === 'liability') return 'liability';
  return account.accountRole === 'investment' ? 'assetInvestment' : 'assetCash';
}

function cloneConfig(config: DashboardConfig): DashboardConfig {
  return { ...config, visibleModules: [...config.visibleModules], moduleOrder: [...config.moduleOrder] };
}

function normalizeDashboardConfig(value: unknown): DashboardConfig {
  if (!isDashboardConfig(value)) return { ...DEFAULT_DASHBOARD_CONFIG,
    visibleModules: [...DEFAULT_DASHBOARD_CONFIG.visibleModules],
    moduleOrder: [...DEFAULT_DASHBOARD_CONFIG.moduleOrder] };
  const config = value as DashboardConfig;
  const order = [...config.moduleOrder];
  if (!order.includes('spending')) order.splice(order.indexOf('monthlyAnalysis') + 1, 0, 'spending');
  if (!order.includes('budget')) order.splice(order.indexOf('spending') + 1, 0, 'budget');
  if (!order.includes('goals')) order.splice(order.indexOf('budget') + 1, 0, 'goals');
  const hadShoppingModule = order.includes('shopping');
  if (!hadShoppingModule) order.splice(order.indexOf('goals') + 1, 0, 'shopping');
  const visibleModules = [...config.visibleModules];
  for (const module of ['budget', 'goals'] as const) {
    if (!visibleModules.includes(module)) visibleModules.push(module);
  }
  if (!order.includes('allowances')) order.push('allowances');
  if (!order.includes('tax')) order.push('tax');
  if (!visibleModules.includes('allowances')) visibleModules.push('allowances');
  if (!hadShoppingModule && !visibleModules.includes('shopping')) visibleModules.push('shopping');
  return { ...config, visibleModules,
    moduleOrder: order,
    expenseChartMode: config.expenseChartMode === 'pie' ? 'pie' : 'bar',
    periodMode: ['day', 'week', 'month', 'year', 'custom'].includes(String(config.periodMode))
      ? config.periodMode : 'month' };
}

function normalizeTableConfig(value: unknown): TableConfig {
  const item = record(value);
  const widths = record(item?.transactionColumnWidths);
  const next = { ...DEFAULT_TRANSACTION_COLUMN_WIDTHS };
  for (const column of Object.keys(next) as TransactionColumn[]) {
    const width = widths?.[column];
    if (typeof width === 'number' && Number.isFinite(width)) next[column] = Math.max(minColumnWidth(column), Math.round(width));
  }
  return { transactionColumnWidths: next };
}

function normalizeUIConfig(value: unknown, legacyTableConfig?: unknown): UIConfig {
  const item = record(value);
  return {
    tableConfig: normalizeTableConfig(item?.tableConfig ?? legacyTableConfig),
    currency: item?.currency === 'CNY' ? 'CNY' : 'CNY'
  };
}

function minColumnWidth(column: TransactionColumn): number {
  return { date: 90, type: 60, category: 80, account: 120, amount: 100, note: 80 }[column];
}

function isUIConfig(value: unknown): value is UIConfig {
  const item = record(value);
  const table = record(item?.tableConfig);
  const widths = record(table?.transactionColumnWidths);
  const columns: TransactionColumn[] = ['date', 'type', 'category', 'account', 'amount', 'note'];
  return !!item && item.currency === 'CNY' && !!widths && columns.every(column =>
    typeof widths[column] === 'number' && Number.isFinite(widths[column])
      && (widths[column] as number) >= minColumnWidth(column));
}

function isDashboardConfig(value: unknown): value is DashboardConfig {
  const item = record(value);
  const order = item?.moduleOrder;
  const moduleIds: DashboardModule[] = [
    'financialStatus', 'monthlyOverview', 'monthlyAnalysis', 'spending', 'budget', 'goals', 'shopping', 'assets', 'liabilities', 'allowances', 'tax'
  ];
  const legacyModuleIds: DashboardModule[] = [
    'financialStatus', 'monthlyOverview', 'monthlyAnalysis', 'assets', 'liabilities'
  ];
  const visibleIds: DashboardVisibleModule[] = [
    'financialStatus', 'monthlyOverview', 'calendar', 'spending', 'budget', 'goals', 'shopping', 'assets', 'liabilities', 'allowances', 'tax'
  ];
  return !!item && Array.isArray(item.visibleModules) && Array.isArray(item.moduleOrder)
    && item.visibleModules.every(id => visibleIds.includes(id as DashboardVisibleModule))
    && new Set(item.visibleModules).size === item.visibleModules.length
    && Array.isArray(order)
    && order.length >= legacyModuleIds.length && order.length <= moduleIds.length
    && order.every(id => moduleIds.includes(id as DashboardModule))
    && new Set(order).size === order.length
    && (order.length === moduleIds.length || order.includes('spending')
      || legacyModuleIds.every(id => order.includes(id)))
    && (item.expenseChartMode === undefined || item.expenseChartMode === 'bar' || item.expenseChartMode === 'pie')
    && (item.periodMode === undefined || ['day', 'week', 'month', 'year', 'custom'].includes(String(item.periodMode)));
}

function isCategoryDefinitionV4(value: unknown): boolean {
  const item = record(value);
  return !!item && typeof item.id === 'string' && !!item.id.trim()
    && typeof item.name === 'string' && !!item.name.trim()
    && typeof item.scope === 'string' && CATEGORY_SCOPES.includes(item.scope as CategoryScope)
    && typeof item.enabled === 'boolean' && Number.isInteger(item.order) && (item.order as number) >= 0;
}

function isCategoryDefinition(value: unknown): value is CategoryDefinition {
  const item = record(value);
  return isCategoryDefinitionV4(value) && !!item
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'
    && (item.parentId === null || typeof item.parentId === 'string');
}

function isCategoryDefinitionV6(value: unknown): boolean {
  const item = record(value);
  return isCategoryDefinitionV4(value) && !!item
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function legacyCategory(
  categories: CategoryDefinition[], scope: CategoryScope, name: string
): CategoryDefinition {
  const trimmed = name.trim() || '未分类';
  const existing = categories.find(item => item.scope === scope && item.parentId === null && item.name === trimmed);
  if (existing) return existing;
  const order = categories.filter(item => item.scope === scope && item.parentId === null)
    .reduce((max, item) => Math.max(max, item.order), -1) + 1;
  const now = new Date().toISOString();
  const created = {
    id: `legacy-${scope}-${order + 1}`, name: trimmed, scope, parentId: null, enabled: true, order,
    createdAt: now, updatedAt: now
  } satisfies CategoryDefinition;
  categories.push(created);
  return created;
}

const CURRENT_SCHEMA_VERSION = 15;

interface LegacyAccountsAndTransactions {
  accounts: Account[];
  transactions: PreAdjustmentTransaction[];
}

function migrateV1ToV2(input: Record<string, unknown>): LegacyAccountsAndTransactions {
  const accounts = (input.accounts as Record<string, unknown>[]).map(value => {
    const { balance, ...rest } = value;
    return { ...rest, openingBalance: balance };
  }) as Account[];
  return { accounts, transactions: [] };
}

function migrateV2ToV3(input: LegacyAccountsAndTransactions): LegacyAccountsAndTransactions {
  return {
    accounts: input.accounts.map(account => account.kind === 'asset'
      ? { ...account, accountRole: account.accountRole ?? 'cash' } as Account : account),
    transactions: input.transactions
  };
}

function migrateV4ToV5(input: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  const categories = (input.categories as Record<string, unknown>[]).map(category => ({
    ...category,
    parentId: typeof category.parentId === 'string' ? category.parentId : null,
    createdAt: typeof category.createdAt === 'string' ? category.createdAt : now,
    updatedAt: typeof category.updatedAt === 'string' ? category.updatedAt : now
  })) as CategoryDefinition[];
  const accounts = (input.accounts as Account[]).map(account => ({
    ...account,
    ...(typeof account.lastReconciledAt === 'string' ? { lastReconciledAt: account.lastReconciledAt } : {})
  }));
  return {
    schemaVersion: 6,
    accounts,
    transactions: input.transactions as PreAdjustmentTransaction[],
    categories,
    dashboardConfig: normalizeDashboardConfig(input.dashboardConfig),
    uiConfig: normalizeUIConfig(input.uiConfig, input.tableConfig),
    budgets: [], goals: [], goalAllocations: [], shoppingItems: [], receivables: [], receivableCollections: []
  };
}

function defaultData(): FinanceData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION, accounts: [], transactions: [],
    categories: createDefaultCategories(), dashboardConfig: cloneConfig(DEFAULT_DASHBOARD_CONFIG),
    budgets: [], goals: [], goalAllocations: [], shoppingItems: [], receivables: [], receivableCollections: [],
    investmentValuations: [], taxRecords: [],
    uiConfig: {
      tableConfig: { transactionColumnWidths: { ...DEFAULT_UI_CONFIG.tableConfig.transactionColumnWidths } },
      currency: DEFAULT_UI_CONFIG.currency
    }
  };
}

function isBudgetPlan(value: unknown): value is BudgetPlan {
  const item = record(value);
  return !!item && typeof item.id === 'string' && Number.isInteger(item.year)
    && Number.isInteger(item.month) && (item.month as number) >= 1 && (item.month as number) <= 12
    && (item.totalLimit === null || validMoney(item.totalLimit, true))
    && Array.isArray(item.categoryLimits) && item.categoryLimits.every(value => {
      const limit = record(value);
      return !!limit && typeof limit.categoryId === 'string' && validMoney(limit.limit, true);
    }) && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isSavingsGoal(value: unknown): value is SavingsGoal {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.name === 'string' && !!item.name.trim()
    && validMoney(item.targetAmount, false)
    && (item.targetDate === null || validDate(item.targetDate))
    && ['low', 'medium', 'high'].includes(String(item.priority))
    && ['active', 'completed', 'cancelled'].includes(String(item.status))
    && typeof item.note === 'string' && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && (item.completedAt === null || validDate(item.completedAt))
    && (item.actualAmount === null || validMoney(item.actualAmount, false))
    && (item.completionTransactionId === null || typeof item.completionTransactionId === 'string');
}

function isGoalAllocation(value: unknown): value is GoalAllocation {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.goalId === 'string'
    && typeof item.accountId === 'string' && validDate(item.date) && validMoney(item.amount, false)
    && (item.direction === 'allocate' || item.direction === 'release')
    && typeof item.note === 'string' && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string';
}

function isShoppingItem(value: unknown): value is ShoppingItem {
  const item = record(value);
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()
    || !validMoney(item.estimatedPrice, true)
    || !(item.categoryId === null || typeof item.categoryId === 'string')
    || !['low', 'medium', 'high'].includes(String(item.priority))
    || !['considering', 'ready', 'purchased', 'abandoned'].includes(String(item.status))
    || !validDate(item.addedAt) || !Number.isInteger(item.coolingOffDays)
    || (item.coolingOffDays as number) < 0 || (item.coolingOffDays as number) > 365
    || typeof item.reason !== 'string' || typeof item.alternative !== 'string' || typeof item.note !== 'string'
    || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string'
    || !(item.abandonedAt === null || validDate(item.abandonedAt))
    || !(item.purchasedAt === null || validDate(item.purchasedAt))
    || !(item.actualPrice === null || validMoney(item.actualPrice, false))
    || !(item.purchaseTransactionId === null || typeof item.purchaseTransactionId === 'string')
    || !(item.convertedGoalId === null || typeof item.convertedGoalId === 'string')) return false;
  if (item.status === 'purchased') {
    return item.purchasedAt !== null && item.actualPrice !== null && item.purchaseTransactionId !== null
      && item.convertedGoalId === null;
  }
  return item.purchasedAt === null && item.actualPrice === null && item.purchaseTransactionId === null
    && (item.convertedGoalId === null || item.status === 'abandoned');
}

function isReceivableV10(value: unknown): boolean {
  const item = record(value);
  return !!item && typeof item.id === 'string' && !!item.id && typeof item.title === 'string' && !!item.title.trim()
    && validDate(item.date) && typeof item.paymentAccountId === 'string' && typeof item.categoryId === 'string'
    && validMoney(item.totalPaid, false) && validMoney(item.personalShare, true)
    && validMoney(item.receivableAmount, false)
    && moneyCents(item.totalPaid) === moneyCents(item.personalShare) + moneyCents(item.receivableAmount)
    && typeof item.counterparty === 'string' && ['open', 'partial', 'settled', 'closed', 'cancelled'].includes(String(item.status))
    && typeof item.note === 'string' && (item.personalExpenseTransactionId === null
      || typeof item.personalExpenseTransactionId === 'string')
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string';
}

function isReceivable(value: unknown): value is Receivable {
  const item = record(value);
  return isReceivableV10(value) && !!item
    && ['open', 'settled', 'closed', 'cancelled'].includes(String(item.status))
    && validMoney(item.writtenOffAmount, true)
    && (item.closedAt === null || validDate(item.closedAt));
}

function isReceivableCollection(value: unknown): value is ReceivableCollection {
  const item = record(value);
  return !!item && typeof item.id === 'string' && typeof item.receivableId === 'string'
    && validMoney(item.amount, false) && typeof item.accountId === 'string' && validDate(item.date)
    && typeof item.note === 'string' && typeof item.createdAt === 'string';
}

function migrateV5ToV6(input: Record<string, unknown>): Record<string, unknown> {
  const legacy = { ...input, budgets: Array.isArray(input.budgets) ? input.budgets : [],
    goals: Array.isArray(input.goals) ? input.goals : [],
    goalAllocations: Array.isArray(input.goalAllocations) ? input.goalAllocations : [],
    categories: (input.categories as CategoryDefinition[]).map(category => ({ ...category, parentId: null })) };
  const config = normalizeDashboardConfig(input.dashboardConfig);
  return { ...legacy, schemaVersion: 6, dashboardConfig: config,
    uiConfig: normalizeUIConfig(input.uiConfig), budgets: legacy.budgets as BudgetPlan[],
    goals: legacy.goals as SavingsGoal[], goalAllocations: legacy.goalAllocations as GoalAllocation[]
  };
}

function migrateV6ToV7(input: Record<string, unknown>): FinanceData {
  const now = new Date().toISOString();
  const categories = (input.categories as Record<string, unknown>[]).map(category => ({
    ...category, parentId: typeof category.parentId === 'string' ? category.parentId : null
  })) as CategoryDefinition[];
  const food = categories.find(item => item.scope === 'expense' && item.parentId === null && item.name === '餐饮');
  if (food && !categories.some(item => item.parentId === food.id)) {
    ['买菜做饭', '外卖', '堂食', '咖啡 / 饮料 / 零食'].forEach((name, index) => {
      let id = `${food.id}-sub-${index + 1}`;
      if (categories.some(item => item.id === id)) id = crypto.randomUUID();
      categories.push({ id, name, scope: 'expense', parentId: food.id, enabled: true,
        order: index, createdAt: now, updatedAt: now });
    });
  }
  return { ...input, schemaVersion: 7, categories } as unknown as FinanceData;
}

function migrateV7ToV8(input: Record<string, unknown>): FinanceData {
  const categories = (input.categories as Record<string, unknown>[]).map(category => ({
    ...category, parentId: typeof category.parentId === 'string' ? category.parentId : null
  }));
  return { ...input, schemaVersion: 8, categories,
    dashboardConfig: normalizeDashboardConfig(input.dashboardConfig) } as FinanceData;
}

function migrateV8ToV9(input: Record<string, unknown>): FinanceData {
  return { ...input, schemaVersion: 9,
    dashboardConfig: normalizeDashboardConfig(input.dashboardConfig),
    shoppingItems: input.shoppingItems === undefined ? [] : input.shoppingItems } as FinanceData;
}

function migrateV9ToV10(input: Record<string, unknown>): FinanceData {
  const accounts = (input.accounts as Record<string, unknown>[]).map(account => account.kind === 'liability'
    ? { ...account, liabilityRole: account.liabilityRole === 'credit' ? 'credit' : 'loan' } : account);
  return { ...input, schemaVersion: 10, accounts,
    receivables: Array.isArray(input.receivables) ? input.receivables : [],
    receivableCollections: Array.isArray(input.receivableCollections) ? input.receivableCollections : []
  } as unknown as FinanceData;
}

function migrateV10ToV11(input: Record<string, unknown>): FinanceData {
  const collections = Array.isArray(input.receivableCollections)
    ? input.receivableCollections as ReceivableCollection[] : [];
  const collectedByReceivable = new Map<string, number>();
  for (const collection of collections) {
    collectedByReceivable.set(collection.receivableId,
      (collectedByReceivable.get(collection.receivableId) ?? 0) + moneyCents(collection.amount));
  }
  const receivables = (Array.isArray(input.receivables) ? input.receivables : []).map(value => {
    const item = value as Receivable;
    const collected = collectedByReceivable.get(item.id) ?? 0;
    const status = item.status === 'cancelled' ? 'cancelled'
      : collected >= moneyCents(item.receivableAmount) ? 'settled' : 'open';
    return { ...item, status, writtenOffAmount: 0, closedAt: null };
  });
  return { ...input, schemaVersion: 11, receivables } as unknown as FinanceData;
}

function migrateV11ToV12(input: Record<string, unknown>): FinanceData {
  const categories = Array.isArray(input.categories) ? [...input.categories as CategoryDefinition[]] : [];
  const defaults = createDefaultCategories().filter(category => category.scope === 'investment');
  for (const category of defaults) {
    if (!categories.some(item => item.id === category.id || (item.scope === 'investment'
      && item.parentId === category.parentId && item.name.toLocaleLowerCase() === category.name.toLocaleLowerCase()))) {
      categories.push(category);
    }
  }
  const otherInvestmentId = categories.find(item => item.scope === 'investment' && item.parentId === null
    && item.name === '其他投资')?.id ?? DEFAULT_INVESTMENT_CATEGORY_IDS.other;
  const accounts = (input.accounts as Record<string, unknown>[]).map(account => account.kind === 'asset'
    ? { ...account, investmentCategoryId: account.accountRole === 'investment' ? otherInvestmentId : null }
    : account);
  return { ...input, schemaVersion: 12, accounts, categories } as unknown as FinanceData;
}

function migrateV12ToV13(input: Record<string, unknown>): FinanceData {
  return { ...input, schemaVersion: 13 } as unknown as FinanceData;
}

function migrateV13ToV14(input: Record<string, unknown>): FinanceData {
  return { ...input, schemaVersion: 14,
    investmentValuations: Array.isArray(input.investmentValuations) ? input.investmentValuations : [] } as unknown as FinanceData;
}

function migrateV14ToV15(input: Record<string, unknown>): FinanceData {
  const transactions = (input.transactions as Record<string, unknown>[]).map(item => item.type === 'income'
    ? { ...item, grossAmount: item.grossAmount ?? item.amount, taxAmount: item.taxAmount ?? 0,
      netAmount: item.netAmount ?? item.amount, taxTreatment: item.taxTreatment ?? 'none',
      taxYear: item.taxYear ?? Number(String(item.date).slice(0, 4)) }
    : item);
  return { ...input, schemaVersion: 15, transactions,
    taxRecords: Array.isArray(input.taxRecords) ? input.taxRecords : [] } as unknown as FinanceData;
}

function assertValidFinanceData(data: FinanceData): void {
  if (new Set(data.accounts.map(item => item.id)).size !== data.accounts.length
    || new Set(data.transactions.map(item => item.id)).size !== data.transactions.length
    || new Set(data.categories.map(item => item.id)).size !== data.categories.length
    || new Set(data.budgets.map(item => item.id)).size !== data.budgets.length
    || new Set(data.budgets.map(item => `${item.year}-${item.month}`)).size !== data.budgets.length
    || new Set(data.goals.map(item => item.id)).size !== data.goals.length
    || new Set(data.goalAllocations.map(item => item.id)).size !== data.goalAllocations.length
    || new Set(data.shoppingItems.map(item => item.id)).size !== data.shoppingItems.length
    || new Set(data.receivables.map(item => item.id)).size !== data.receivables.length
    || new Set(data.receivableCollections.map(item => item.id)).size !== data.receivableCollections.length
    || new Set(data.investmentValuations.map(item => item.id)).size !== data.investmentValuations.length
    || new Set(data.taxRecords.map(item => item.id)).size !== data.taxRecords.length
    || new Set(data.taxRecords.filter(item => item.incomeTransactionId).map(item => item.incomeTransactionId)).size
      !== data.taxRecords.filter(item => item.incomeTransactionId).length
    || new Set(data.investmentValuations.map(item => `${item.accountId}:${item.date}`)).size !== data.investmentValuations.length) {
    throw new Error('备份包含重复 ID。');
  }
  const scopedNames = new Set<string>();
  const scopedOrders = new Set<string>();
  for (const category of data.categories) {
    const normalizedName = `${category.scope}:${category.parentId ?? 'root'}:${category.name.toLocaleLowerCase()}`;
    const normalizedOrder = `${category.scope}:${category.parentId ?? 'root'}:${category.order}`;
    if (scopedNames.has(normalizedName) || scopedOrders.has(normalizedOrder)) {
      throw new Error('分类名称或排序重复。');
    }
    scopedNames.add(normalizedName);
    scopedOrders.add(normalizedOrder);
    if (category.parentId !== null) {
      const parent = data.categories.find(item => item.id === category.parentId);
      if ((category.scope !== 'expense' && category.scope !== 'income' && category.scope !== 'investment')
        || !parent || parent.scope !== category.scope || parent.parentId !== null) {
        throw new Error(`分类“${category.name}”的上级分类无效；Finance 当前仅支持收入、支出和投资分类两级结构。`);
      }
    }
  }
  for (const account of data.accounts) {
    if (account.kind === 'allowance') {
      if (!isAllowanceAccount(account)) throw new Error(`额度账户“${account.name}”配置无效。`);
      continue;
    }
    const definition = data.categories.find(item => item.id === account.categoryId);
    if (!definition || definition.scope !== accountCategoryScope(account)) {
      throw new Error(`账户“${account.name}”引用了无效分类。`);
    }
    if (account.kind === 'asset') {
      if (account.accountRole === 'investment') {
        if (!data.categories.some(item => item.id === account.investmentCategoryId && item.scope === 'investment')) {
          throw new Error(`投资账户“${account.name}”引用了无效投资分类。`);
        }
      } else if (account.investmentCategoryId !== null) {
        throw new Error(`普通资产账户“${account.name}”不能引用投资分类。`);
      }
    }
  }
  for (const transaction of data.transactions) {
    if ((transaction.type === 'income' || transaction.type === 'expense')
      && !data.categories.some(item => item.id === transaction.categoryId && item.scope === transaction.type)) {
      throw new Error(`流水“${transaction.id}”引用了无效分类。`);
    }
    if (transaction.type === 'adjustment') {
      const account = data.accounts.find(item => item.id === transaction.accountId);
      if (!account || account.kind !== transaction.adjustmentTarget) {
        throw new Error(`对账记录“${transaction.id}”引用了无效账户。`);
      }
    }
    if (transaction.type === 'refund') {
      const original = data.transactions.find(item => item.id === transaction.originalTransactionId);
      const destination = data.accounts.find(item => item.id === transaction.refundDestinationAccountId);
      if (!original || original.type !== 'expense' || !destination
        || !(destination.kind === 'asset' || destination.kind === 'allowance'
          || (destination.kind === 'liability' && destination.liabilityRole === 'credit'))) {
        throw new Error(`退款“${transaction.id}”引用了无效的原消费或退款账户。`);
      }
    }
    if (transaction.type === 'expense' && transaction.receivableWriteOffId
      && !data.receivables.some(item => item.id === transaction.receivableWriteOffId && item.status === 'closed')) {
      throw new Error(`核销支出“${transaction.id}”引用了无效的代垫项目。`);
    }
  }
  for (const valuation of data.investmentValuations) {
    const account = data.accounts.find(item => item.id === valuation.accountId);
    if (!account || account.kind !== 'asset' || account.accountRole !== 'investment') {
      throw new Error(`市值快照“${valuation.id}”引用了无效投资账户。`);
    }
  }
  for (const record of data.taxRecords) {
    if (!isTaxRecord(record)) throw new Error('税务记录无效。');
    const account = data.accounts.find(item => item.id === record.accountId);
    if (!account || account.kind !== 'asset') throw new Error(`税务记录“${record.id}”引用了无效资产账户。`);
    if (record.type === 'withholding' || record.type === 'final_tax') {
      const income = data.transactions.find(item => item.id === record.incomeTransactionId);
      const expectedType = record.type === 'withholding' ? 'withholding' : 'final';
      if (!income || income.type !== 'income' || income.accountId !== record.accountId
        || income.taxTreatment !== expectedType || moneyCents(income.taxAmount ?? 0) !== moneyCents(record.amount)
        || income.taxYear !== record.taxYear || moneyCents(record.amount) === 0) {
        throw new Error(`税务记录“${record.id}”关联的收入无效。`);
      }
    } else if (record.incomeTransactionId !== null) {
      throw new Error(`税款${record.type === 'refund' ? '退回' : '补缴'}不能关联单笔收入。`);
    }
  }
  for (const income of data.transactions) if (income.type === 'income' && moneyCents(income.taxAmount ?? 0) > 0
    && !data.taxRecords.some(item => item.incomeTransactionId === income.id)) {
    throw new Error(`收入“${income.id}”缺少对应税务记录。`);
  }
  const receivableExpenseIds = new Set<string>();
  for (const receivable of data.receivables) {
    if (!isReceivable(receivable)) throw new Error('待收款数据无效。');
    const payment = data.accounts.find(account => account.id === receivable.paymentAccountId);
    const category = data.categories.find(item => item.id === receivable.categoryId && item.scope === 'expense');
    if (!payment || !(payment.kind === 'asset' || payment.kind === 'liability' && payment.liabilityRole === 'credit') || !category) {
      throw new Error(`代垫“${receivable.title}”引用了无效的支付账户或支出分类。`);
    }
    const personalExpense = receivable.personalExpenseTransactionId
      ? data.transactions.find(item => item.id === receivable.personalExpenseTransactionId) : undefined;
    if (receivable.personalShare > 0 && (!personalExpense || personalExpense.type !== 'expense'
      || moneyCents(personalExpense.amount) !== moneyCents(receivable.personalShare)
      || personalExpense.categoryId !== receivable.categoryId || personalExpense.accountId !== receivable.paymentAccountId
      || personalExpense.date !== receivable.date || receivableExpenseIds.has(personalExpense.id))) {
      throw new Error(`代垫“${receivable.title}”的个人支出关联无效。`);
    }
    if (personalExpense) receivableExpenseIds.add(personalExpense.id);
    if (receivable.personalShare === 0 && receivable.personalExpenseTransactionId !== null) {
      throw new Error(`代垫“${receivable.title}”不应关联个人支出。`);
    }
    const collections = data.receivableCollections.filter(item => item.receivableId === receivable.id);
    const collected = collections.reduce((sum, item) => sum + moneyCents(item.amount), 0);
    const remainingBeforeWriteOff = moneyCents(receivable.receivableAmount) - collected;
    const writeOff = moneyCents(receivable.writtenOffAmount);
    const writeOffExpenses = data.transactions.filter((transaction): transaction is Extract<Transaction, { type: 'expense' }> =>
      transaction.type === 'expense' && transaction.receivableWriteOffId === receivable.id);
    const statusInvalid = receivable.status === 'open'
      ? remainingBeforeWriteOff <= 0 || writeOff !== 0 || receivable.closedAt !== null
      : receivable.status === 'settled'
        ? collected !== moneyCents(receivable.receivableAmount) || writeOff !== 0 || receivable.closedAt !== null
        : receivable.status === 'closed'
          ? remainingBeforeWriteOff <= 0 || writeOff !== remainingBeforeWriteOff || !receivable.closedAt
          : writeOff !== 0 || receivable.closedAt !== null;
    const writeOffExpense = writeOffExpenses[0];
    if (collected > moneyCents(receivable.receivableAmount) || writeOff > remainingBeforeWriteOff || statusInvalid
      || (receivable.status === 'closed' && (writeOffExpenses.length !== 1 || !writeOffExpense
        || moneyCents(writeOffExpense.amount) !== writeOff || writeOffExpense.date !== receivable.closedAt
        || writeOffExpense.accountId !== receivable.paymentAccountId))
      || (receivable.status !== 'closed' && writeOffExpenses.length > 0)) {
      throw new Error(`代垫“${receivable.title}”的收回金额与状态不一致。`);
    }
  }
  for (const collection of data.receivableCollections) {
    const receivable = data.receivables.find(item => item.id === collection.receivableId);
    if (!isReceivableCollection(collection) || !receivable
      || !data.accounts.some(account => account.id === collection.accountId && account.kind === 'asset')) {
      throw new Error(`收回记录“${collection.id}”引用无效。`);
    }
  }
  const refundTotals = new Map<string, number>();
  for (const refund of data.transactions) if (refund.type === 'refund') {
    refundTotals.set(refund.originalTransactionId, (refundTotals.get(refund.originalTransactionId) ?? 0) + moneyCents(refund.amount));
  }
  for (const [id, cents] of refundTotals) {
    const expense = data.transactions.find(item => item.id === id);
    if (!expense || expense.type !== 'expense' || cents > moneyCents(expense.amount)) throw new Error('累计退款金额超过原支出金额。');
  }
  const purchaseTransactions = new Set<string>();
  for (const item of data.shoppingItems) {
    if (!isShoppingItem(item)) throw new Error('想买清单数据无效。');
    if (item.categoryId && !data.categories.some(category => category.id === item.categoryId && category.scope === 'expense')) {
      throw new Error(`想买清单“${item.name}”引用了无效支出分类。`);
    }
    if (item.convertedGoalId && !data.goals.some(goal => goal.id === item.convertedGoalId)) {
      throw new Error(`想买清单“${item.name}”引用了不存在的储蓄目标。`);
    }
    if (item.purchaseTransactionId) {
      const transaction = data.transactions.find(value => value.id === item.purchaseTransactionId);
      if (!transaction || transaction.type !== 'expense' || purchaseTransactions.has(item.purchaseTransactionId)) {
        throw new Error(`想买清单“${item.name}”的购买流水关联无效。`);
      }
      purchaseTransactions.add(item.purchaseTransactionId);
    }
  }
  for (const budget of data.budgets) {
    if (budget.categoryLimits.some(limit => !data.categories.some(category =>
      category.id === limit.categoryId && category.scope === 'expense'))
      || new Set(budget.categoryLimits.map(item => item.categoryId)).size !== budget.categoryLimits.length) {
      throw new Error(`预算“${budget.year}-${budget.month}”引用了无效支出分类。`);
    }
  }
  for (const allocation of data.goalAllocations) {
    if (!data.goals.some(goal => goal.id === allocation.goalId)
      || !data.accounts.some(account => account.id === allocation.accountId && account.kind === 'asset')) {
      throw new Error(`储蓄目标记录“${allocation.id}”引用了无效目标或资产账户。`);
    }
  }
  const allocationTotals = new Map<string, number>();
  for (const allocation of data.goalAllocations) {
    const key = `${allocation.goalId}:${allocation.accountId}`;
    allocationTotals.set(key, (allocationTotals.get(key) ?? 0)
      + (allocation.direction === 'allocate' ? 1 : -1) * moneyCents(allocation.amount));
  }
  if ([...allocationTotals.values()].some(total => total < 0)) {
    throw new Error('储蓄目标取回金额不能超过该账户已预留金额。');
  }
  assertValidState(data.accounts, data.transactions, data.receivables, data.receivableCollections, data.investmentValuations, data.taxRecords);
}

function normalizedAccount(
  input: AccountInput,
  categories: CategoryDefinition[],
  existingCategoryId?: string,
  accounts: Account[] = [],
  existingInvestmentCategoryId?: string | null
): AccountValues {
  const name = input.name.trim();
  if (!name) throw new Error('请输入账户名称。');
  if (input.kind === 'allowance') {
    if (!validMoney(input.allowanceLimit, true)) throw new Error('月额度必须是非负金额，最多保留两位小数。');
    const resetDay = input.resetDay ?? 1;
    if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) throw new Error('重置日必须为 1 至 31。');
    return { name, kind: 'allowance', category: '消费额度', categoryId: 'allowance', openingBalance: 0,
      note: input.note.trim(), allowancePeriod: 'monthly', allowanceLimit: moneyCents(input.allowanceLimit) / 100,
      resetDay, rollover: false };
  }
    const scope = accountCategoryScope(input as Pick<Exclude<Account, { kind: 'allowance' }>, 'kind' | 'accountRole'>);
  const selected = categories.find(category => category.scope === scope
    && (input.categoryId ? category.id === input.categoryId : category.name === input.category.trim()));
  const category = selected?.name ?? input.category.trim();
  const categoryId = selected?.id ?? (input.categoryId === existingCategoryId ? input.categoryId : undefined);
  if (!name) throw new Error('请输入账户名称。');
  if (!category) throw new Error('请输入分类。');
  if (!categoryId || (!selected?.enabled && categoryId !== existingCategoryId)) {
    throw new Error(`当前没有可用的${scope === 'liability' ? '负债' : '资产'}分类，请先在 Finance → 设置中启用或创建分类。`);
  }
  if (!validMoney(input.openingBalance, true)) {
    throw new Error('期初余额必须是非负数，最多保留两位小数。');
  }
  const common = {
    name, category, categoryId, openingBalance: moneyCents(input.openingBalance) / 100,
    note: input.note.trim()
  };
  if (input.kind === 'asset') {
    const accountRole = input.accountRole ?? 'cash';
    if (accountRole !== 'cash' && accountRole !== 'investment') {
      throw new Error('请选择有效的资产账户用途。');
    }
    let investmentCategoryId: string | null = null;
    if (accountRole === 'investment') {
      const requestedInvestmentCategoryId = input.investmentCategoryId as string | null | undefined;
      const selectedInvestment = categories.find(item => item.scope === 'investment'
        && item.id === (requestedInvestmentCategoryId ?? existingInvestmentCategoryId ?? DEFAULT_INVESTMENT_CATEGORY_IDS.other));
      const parent = selectedInvestment?.parentId
        ? categories.find(item => item.id === selectedInvestment.parentId && item.scope === 'investment') : undefined;
      if (!selectedInvestment || (!selectedInvestment.enabled && selectedInvestment.id !== existingInvestmentCategoryId)
        || (selectedInvestment.parentId && !parent?.enabled && selectedInvestment.id !== existingInvestmentCategoryId)) {
        throw new Error('请选择有效的投资分类。');
      }
      investmentCategoryId = selectedInvestment.id;
    }
    return { ...common, kind: 'asset', accountRole, investmentCategoryId };
  }
  if (input.kind === 'liability') {
    const liabilityRole = input.liabilityRole ?? 'loan';
    if (liabilityRole !== 'loan' && liabilityRole !== 'credit') throw new Error('请选择有效的负债类型。');
    const defaultRepaymentAccountId = liabilityRole === 'credit' ? input.defaultRepaymentAccountId : undefined;
    if (defaultRepaymentAccountId
      && !accounts.some(account => account.id === defaultRepaymentAccountId && account.kind === 'asset')) {
      throw new Error('默认扣款账户必须是有效的资产账户。');
    }
    return { ...common, kind: 'liability', liabilityRole,
      ...(defaultRepaymentAccountId ? { defaultRepaymentAccountId } : {}) };
  }
  throw new Error('请选择有效的账户类型。');
}

function findAccount(accounts: Account[], id: string, kind: AccountKind): Account | undefined {
  return accounts.find(account => account.id === id && account.kind === kind);
}

function normalizedTransaction(
  input: TransactionInput,
  accounts: Account[],
  categories: CategoryDefinition[],
  existingCategoryId?: string
): TransactionValues {
  if (!validDate(input.date)) throw new Error('请选择有效日期。');
  if (!validMoney(input.amount, false)) {
    throw new Error('金额必须大于零，最多保留两位小数。');
  }
  const common = {
    date: input.date, amount: moneyCents(input.amount) / 100, note: input.note.trim()
  };
  switch (input.type) {
    case 'income':
    case 'expense': {
      const categoryDefinition = categories.find(item => item.scope === input.type
        && (input.categoryId ? item.id === input.categoryId : item.name === input.category.trim()));
      const category = categoryDefinition?.name ?? input.category.trim();
      const categoryId = categoryDefinition?.id
        ?? (input.categoryId === existingCategoryId ? input.categoryId : undefined);
      if (!category) throw new Error('请输入分类。');
      const parentEnabled = !categoryDefinition?.parentId || categories.some(item =>
        item.id === categoryDefinition.parentId && item.enabled && item.parentId === null);
      if (!categoryId || ((!categoryDefinition?.enabled || !parentEnabled) && categoryId !== existingCategoryId)) {
        throw new Error(`当前没有可用的${input.type === 'income' ? '收入' : '支出'}分类，请先在 Finance → 设置中启用或创建分类。`);
      }
      const validOrdinaryAccount = input.type === 'income'
        ? !!findAccount(accounts, input.accountId, 'asset')
        : !!findAccount(accounts, input.accountId, 'asset') || !!findAccount(accounts, input.accountId, 'allowance')
          || accounts.some(account => account.id === input.accountId && account.kind === 'liability' && account.liabilityRole === 'credit');
      if (!validOrdinaryAccount) {
        throw new Error(input.type === 'expense' ? '请选择有效的资产、信用支付或消费额度账户。' : '请选择有效的资产账户。');
      }
      if (input.type === 'income') {
        const grossAmount = moneyCents(input.grossAmount ?? input.amount) / 100;
        const taxAmount = moneyCents(input.taxAmount ?? 0) / 100;
        const netAmount = moneyCents(input.netAmount ?? grossAmount - taxAmount) / 100;
        const taxTreatment: TaxTreatment = input.taxTreatment ?? (taxAmount > 0 ? 'withholding' : 'none');
        const taxYear = input.taxYear ?? Number(input.date.slice(0, 4));
        if (!validMoney(grossAmount, false) || !validMoney(taxAmount, true) || taxAmount > grossAmount
          || !validMoney(netAmount, true) || moneyCents(grossAmount) - moneyCents(taxAmount) !== moneyCents(netAmount)) {
          throw new Error('税前收入、扣税和实际到账金额不匹配，请检查金额。');
        }
        if (!['none', 'withholding', 'final'].includes(taxTreatment)
          || (taxTreatment === 'none' && taxAmount > 0) || !Number.isInteger(taxYear) || taxYear < 1900) {
          throw new Error('请选择有效的税款性质和税务年度。');
        }
        return { ...common, amount: grossAmount, type: 'income', category, categoryId: categoryId as string, accountId: input.accountId,
          grossAmount, taxAmount, netAmount, taxTreatment, taxYear };
      }
      return { ...common, type: 'expense', category, categoryId: categoryId as string, accountId: input.accountId };
    }
    case 'refund': {
      if (!input.originalTransactionId) throw new Error('请选择要退款的原支出。');
      const destination = accounts.find(account => account.id === input.refundDestinationAccountId);
      if (!destination || !(destination.kind === 'asset' || destination.kind === 'allowance'
        || destination.kind === 'liability' && destination.liabilityRole === 'credit')) {
        throw new Error('退款只能退回资产、消费额度或信用支付账户。');
      }
      return { ...common, type: 'refund', originalTransactionId: input.originalTransactionId,
        refundDestinationAccountId: input.refundDestinationAccountId };
    }
    case 'transfer':
      if (input.fromAccountId === input.toAccountId) {
        throw new Error('转出账户和转入账户不能相同。');
      }
      if (!findAccount(accounts, input.fromAccountId, 'asset')
        || !findAccount(accounts, input.toAccountId, 'asset')) {
        throw new Error('转账只能选择两个有效的资产账户。');
      }
      return { ...common, type: 'transfer',
        fromAccountId: input.fromAccountId, toAccountId: input.toAccountId };
    case 'debt':
      if (input.debtAction !== 'borrow' && input.debtAction !== 'repay') {
        throw new Error('请选择有效的负债操作。');
      }
      if (!findAccount(accounts, input.assetAccountId, 'asset')
        || !findAccount(accounts, input.liabilityAccountId, 'liability')) {
        throw new Error('请选择有效的资产账户和负债账户。');
      }
      if (input.debtAction === 'borrow' && accounts.some(account => account.id === input.liabilityAccountId
        && account.kind === 'liability' && account.liabilityRole === 'credit')) {
        throw new Error('信用支付账户不能记录为借入；请通过支出流水使用信用支付。');
      }
      return { ...common, type: 'debt', debtAction: input.debtAction,
        assetAccountId: input.assetAccountId, liabilityAccountId: input.liabilityAccountId };
    case 'adjustment': {
      if (input.direction !== 'increase' && input.direction !== 'decrease') {
        throw new Error('请选择有效的余额调整方向。');
      }
      const account = accounts.find(item => item.id === input.accountId);
      if (!account || account.kind !== input.adjustmentTarget) {
        throw new Error('请选择与校准类型一致的账户。');
      }
      return { ...common, type: 'adjustment', accountId: input.accountId,
        adjustmentTarget: input.adjustmentTarget, direction: input.direction };
    }
    case 'investment-income':
      if (input.incomeKind !== 'dividend' && input.incomeKind !== 'interest'
        && input.incomeKind !== 'cash-dividend' && input.incomeKind !== 'other') {
        throw new Error('请选择有效的投资收益类型。');
      }
      if (!findAccount(accounts, input.investmentAccountId, 'asset')
        || !findAccount(accounts, input.accountId, 'asset')
        || accounts.some(account => account.id === input.investmentAccountId
          && account.kind === 'asset' && account.accountRole !== 'investment')
        || accounts.some(account => account.id === input.accountId
          && account.kind === 'asset' && account.accountRole !== 'cash')) {
        throw new Error('请选择有效的投资来源账户和现金到账账户。');
      }
      return { ...common, type: 'investment-income', investmentAccountId: input.investmentAccountId,
        accountId: input.accountId, incomeKind: input.incomeKind };
  }
}

function referencesValid(accounts: Account[], transaction: Transaction): boolean {
  switch (transaction.type) {
    case 'income':
    case 'expense':
      return !!findAccount(accounts, transaction.accountId, 'asset')
        || (transaction.type === 'expense' && (!!findAccount(accounts, transaction.accountId, 'allowance')
          || accounts.some(account => account.id === transaction.accountId && account.kind === 'liability' && account.liabilityRole === 'credit')));
    case 'refund':
      return !!accounts.find(account => account.id === transaction.refundDestinationAccountId
        && (account.kind === 'asset' || account.kind === 'allowance'
          || account.kind === 'liability' && account.liabilityRole === 'credit'));
    case 'transfer':
      return transaction.fromAccountId !== transaction.toAccountId
        && !!findAccount(accounts, transaction.fromAccountId, 'asset')
        && !!findAccount(accounts, transaction.toAccountId, 'asset');
    case 'debt':
      return !!findAccount(accounts, transaction.assetAccountId, 'asset')
        && !!findAccount(accounts, transaction.liabilityAccountId, 'liability');
    case 'adjustment': {
      const account = accounts.find(item => item.id === transaction.accountId);
      return !!account && account.kind === transaction.adjustmentTarget;
    }
    case 'investment-income':
      return accounts.some(account => account.id === transaction.investmentAccountId
        && account.kind === 'asset' && account.accountRole === 'investment')
        && accounts.some(account => account.id === transaction.accountId
          && account.kind === 'asset' && account.accountRole === 'cash');
  }
}

function touchesAccount(transaction: Transaction, accountId: string): boolean {
  switch (transaction.type) {
    case 'income':
    case 'expense': return transaction.accountId === accountId;
    case 'refund': return transaction.refundDestinationAccountId === accountId;
    case 'transfer': return transaction.fromAccountId === accountId
      || transaction.toAccountId === accountId;
    case 'debt': return transaction.assetAccountId === accountId
      || transaction.liabilityAccountId === accountId;
    case 'adjustment': return transaction.accountId === accountId;
    case 'investment-income': return transaction.investmentAccountId === accountId || transaction.accountId === accountId;
  }
}

function balanceCents(
  account: Account, transactions: Transaction[], receivables: Receivable[] = [], collections: ReceivableCollection[] = [],
  valuations: InvestmentValuation[] = [], taxRecords: TaxRecord[] = []
): number {
  if (account.kind === 'allowance') return 0;
  const latestValuation = account.kind === 'asset' && account.accountRole === 'investment'
    ? valuations.filter(item => item.accountId === account.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;
  let cents = latestValuation ? moneyCents(latestValuation.marketValue) : moneyCents(account.openingBalance);
  const personalExpenseIds = new Set(receivables.map(item => item.personalExpenseTransactionId).filter((id): id is string => !!id));
  const writeOffExpenseIds = new Set(transactions.filter((transaction): transaction is Extract<Transaction, { type: 'expense' }> =>
    transaction.type === 'expense' && !!transaction.receivableWriteOffId).map(transaction => transaction.id));
  for (const transaction of transactions) {
    if (latestValuation && (transaction.date < latestValuation.date
      || transaction.date === latestValuation.date && transaction.createdAt <= latestValuation.updatedAt)) continue;
    const amount = moneyCents(transaction.amount);
    switch (transaction.type) {
      case 'income':
        if (account.id === transaction.accountId) cents += moneyCents(transaction.netAmount ?? transaction.amount);
        break;
      case 'expense':
        if (account.id === transaction.accountId) {
          if (personalExpenseIds.has(transaction.id) || writeOffExpenseIds.has(transaction.id)) break;
          if (account.kind === 'liability' && account.liabilityRole === 'credit') cents += amount;
          else cents -= amount;
        }
        break;
      case 'refund':
        if (account.id === transaction.refundDestinationAccountId) {
          if (account.kind === 'liability' && account.liabilityRole === 'credit') cents -= amount;
          else cents += amount;
        }
        break;
      case 'transfer':
        if (account.id === transaction.fromAccountId) cents -= amount;
        if (account.id === transaction.toAccountId) cents += amount;
        break;
      case 'debt':
        if (account.id === transaction.assetAccountId
          || account.id === transaction.liabilityAccountId) {
          cents += transaction.debtAction === 'borrow' ? amount : -amount;
        }
        break;
      case 'adjustment':
        if (account.id === transaction.accountId && account.kind === transaction.adjustmentTarget) {
          cents += transaction.direction === 'increase' ? amount : -amount;
        }
        break;
      case 'investment-income':
        if (account.id === transaction.accountId) cents += amount;
        break;
    }
  }
  for (const receivable of receivables) {
    if (receivable.status === 'cancelled') continue;
    if (account.id === receivable.paymentAccountId) {
      if (account.kind === 'liability') cents += moneyCents(receivable.totalPaid);
      else cents -= moneyCents(receivable.totalPaid);
    }
  }
  for (const collection of collections) if (account.kind === 'asset' && collection.accountId === account.id) {
    cents += moneyCents(collection.amount);
  }
  for (const record of taxRecords) if (account.kind === 'asset' && record.accountId === account.id) {
    if (record.type === 'refund') cents += moneyCents(record.amount);
    if (record.type === 'additional_payment') cents -= moneyCents(record.amount);
  }
  return cents;
}

function assertValidState(accounts: Account[], transactions: Transaction[], receivables: Receivable[] = [], collections: ReceivableCollection[] = [], valuations: InvestmentValuation[] = [], taxRecords: TaxRecord[] = []): void {
  if (!transactions.every(transaction => referencesValid(accounts, transaction))) {
    throw new Error('流水引用了不存在或类型不符的账户。');
  }
  for (const account of accounts) if (account.kind === 'liability'
    && balanceCents(account, transactions, receivables, collections, valuations, taxRecords) < 0) {
    if (transactions.some(item => item.type === 'refund' && item.refundDestinationAccountId === account.id)) {
      throw new Error('退款金额超过当前信用负债，请选择实际退款到账的资产账户。');
    }
    throw new Error('还款金额不能超过当前负债余额。');
  }
}

export class FinanceStore {
  private data: FinanceData = defaultData();
  private readonly listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<void> {
    const loaded: unknown = await this.plugin.loadData();
    if (loaded === null || loaded === undefined) {
      this.data = defaultData();
      await this.plugin.saveData(this.data);
      return;
    }
    const candidate = record(loaded);
    if (!candidate || !Array.isArray(candidate.accounts)) {
      throw new Error('Finance 数据格式无效；原始数据未被覆盖。');
    }

    const schemaVersion = candidate.schemaVersion;
    if (typeof schemaVersion === 'number' && schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error('当前 Finance 数据由更新版本创建，请升级插件后再打开；原始数据未覆盖。');
    }

    let next: FinanceData;
    if (candidate.version === 1 && candidate.accounts.every(isAccountV1)) {
      const v2 = migrateV1ToV2(candidate);
      const v3 = migrateV2ToV3(v2);
      next = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(v3.accounts, v3.transactions)));
    } else if (candidate.version === 2 && candidate.accounts.every(isAccountV2)
      && Array.isArray(candidate.transactions) && candidate.transactions.every(isOrdinaryV2)) {
      const v2 = { accounts: candidate.accounts as Account[], transactions: candidate.transactions as PreAdjustmentTransaction[] };
      const v3 = migrateV2ToV3(v2);
      next = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(v3.accounts, v3.transactions)));
    } else if (candidate.version === 3 && candidate.accounts.every(isAccountV3)
      && Array.isArray(candidate.transactions) && candidate.transactions.every(isTransactionV3)) {
      next = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(candidate.accounts, candidate.transactions)));
    } else if (schemaVersion === 4 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV4) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV4) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinitionV4) && isDashboardConfig(candidate.dashboardConfig)) {
      next = migrateV6ToV7(migrateV4ToV5(candidate));
    } else if (schemaVersion === 5 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV5) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV5) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinitionV6) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig)) {
      next = migrateV6ToV7(migrateV5ToV6(candidate));
    } else if (schemaVersion === 6 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV5) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV5) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinitionV6) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)) {
      next = migrateV6ToV7(candidate);
    } else if (schemaVersion === 7 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV5) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV5) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)) {
      next = migrateV7ToV8(candidate);
    } else if (schemaVersion === 8 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV11) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV5) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)) {
      next = migrateV8ToV9({ ...candidate, uiConfig: normalizeUIConfig(candidate.uiConfig) });
    } else if (schemaVersion === 9 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV9) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV5) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)) {
      next = migrateV9ToV10(candidate);
    } else if (schemaVersion === 10 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV11) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV10) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivableV10)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)) {
      next = migrateV10ToV11(candidate);
    } else if (schemaVersion === 11 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountV11) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV11) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivable)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)) {
      next = migrateV11ToV12(candidate);
    } else if (schemaVersion === 12 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountCurrent) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV11) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivable)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)) {
      next = migrateV12ToV13(candidate);
    } else if (schemaVersion === 13 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountCurrent) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV13) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivable)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)) {
      next = migrateV13ToV14(candidate);
    } else if (schemaVersion === 14 && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountCurrent) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV13) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivable)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)
      && Array.isArray(candidate.investmentValuations) && candidate.investmentValuations.every(isInvestmentValuation)) {
      next = migrateV14ToV15(candidate);
    } else if (schemaVersion === CURRENT_SCHEMA_VERSION && Array.isArray(candidate.accounts)
      && candidate.accounts.every(isAccountCurrent) && Array.isArray(candidate.transactions)
      && candidate.transactions.every(isTransactionV15) && Array.isArray(candidate.categories)
      && candidate.categories.every(isCategoryDefinition) && isDashboardConfig(candidate.dashboardConfig)
      && isUIConfig(candidate.uiConfig) && Array.isArray(candidate.budgets) && candidate.budgets.every(isBudgetPlan)
      && Array.isArray(candidate.goals) && candidate.goals.every(isSavingsGoal)
      && Array.isArray(candidate.goalAllocations) && candidate.goalAllocations.every(isGoalAllocation)
      && Array.isArray(candidate.shoppingItems) && candidate.shoppingItems.every(isShoppingItem)
      && Array.isArray(candidate.receivables) && candidate.receivables.every(isReceivable)
      && Array.isArray(candidate.receivableCollections) && candidate.receivableCollections.every(isReceivableCollection)
      && Array.isArray(candidate.investmentValuations) && candidate.investmentValuations.every(isInvestmentValuation)
      && Array.isArray(candidate.taxRecords) && candidate.taxRecords.every(isTaxRecord)) {
      next = { ...candidate, uiConfig: normalizeUIConfig(candidate.uiConfig),
        dashboardConfig: normalizeDashboardConfig(candidate.dashboardConfig) } as unknown as FinanceData;
    } else {
      throw new Error('Finance 数据格式无效；原始数据未被覆盖。');
    }

    if (next.schemaVersion !== 8 && next.schemaVersion !== 10 && next.schemaVersion !== 11 && next.schemaVersion !== 12 && next.schemaVersion !== 13 && next.schemaVersion !== 14
      && next.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      next = migrateV7ToV8(next as unknown as Record<string, unknown>);
    }
    if (next.schemaVersion === 8) next = migrateV8ToV9(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 9) next = migrateV9ToV10(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 10) next = migrateV10ToV11(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 11) next = migrateV11ToV12(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 12) next = migrateV12ToV13(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 13) next = migrateV13ToV14(next as unknown as Record<string, unknown>);
    if (next.schemaVersion === 14) next = migrateV14ToV15(next as unknown as Record<string, unknown>);
    assertValidFinanceData(next);
    if (schemaVersion !== CURRENT_SCHEMA_VERSION) await this.plugin.saveData(next);
    this.data = next;
  }

  private migrateV3ToV4(accounts: Account[], transactions: PreAdjustmentTransaction[]): Record<string, unknown> {
    const categories = createDefaultCategories();
    const migratedAccounts = accounts.map(account => {
      const definition = legacyCategory(categories,
        accountCategoryScope(account as Exclude<Account, { kind: 'allowance' }>), account.category);
      return { ...account, categoryId: definition.id } as Account;
    });
    const migratedTransactions = transactions.map(transaction => {
      if (transaction.type !== 'income' && transaction.type !== 'expense') return transaction;
      const definition = legacyCategory(categories, transaction.type, transaction.category);
      return { ...transaction, categoryId: definition.id };
    }) as Transaction[];
    return {
      schemaVersion: 4, accounts: migratedAccounts, transactions: migratedTransactions,
      categories, dashboardConfig: cloneConfig(DEFAULT_DASHBOARD_CONFIG),
      tableConfig: { transactionColumnWidths: { ...DEFAULT_TABLE_CONFIG.transactionColumnWidths } }
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCategories(scope?: CategoryScope, enabledOnly = false): CategoryDefinition[] {
    const roots = this.data.categories.filter(category => category.parentId === null
      && (!scope || category.scope === scope) && (!enabledOnly || category.enabled))
      .sort((left, right) => left.scope.localeCompare(right.scope) || left.order - right.order || left.name.localeCompare(right.name));
    return roots.flatMap(parent => [parent, ...this.getCategoryChildren(parent.id, enabledOnly)])
      .filter(category => !enabledOnly || category.enabled)
      .map(category => ({ ...category }));
  }

  getCategoryChildren(parentId: string, enabledOnly = false): CategoryDefinition[] {
    const parent = this.data.categories.find(item => item.id === parentId);
    if (!parent) return [];
    return this.data.categories.filter(item => item.parentId === parentId
      && (!enabledOnly || (item.enabled && parent.enabled)))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(item => ({ ...item }));
  }

  isCategorySelectable(categoryId: string): boolean {
    const category = this.data.categories.find(item => item.id === categoryId);
    if (!category?.enabled) return false;
    return category.parentId === null
      || this.data.categories.some(item => item.id === category.parentId && item.scope === category.scope
        && item.parentId === null && item.enabled);
  }

  getCategory(categoryId: string): CategoryDefinition | undefined {
    const category = this.data.categories.find(item => item.id === categoryId);
    return category ? { ...category } : undefined;
  }

  getAccountCategoryLabel(account: Account): string {
    if ('kind' in account && account.kind === 'asset' && account.accountRole === 'investment') {
      return this.getInvestmentCategoryLabel(account.investmentCategoryId) ?? account.category;
    }
    return this.data.categories.find(item => item.id === account.categoryId)?.name ?? account.category;
  }

  getInvestmentCategoryLabel(categoryId: string | null): string | undefined {
    if (!categoryId) return undefined;
    const category = this.data.categories.find(item => item.id === categoryId && item.scope === 'investment');
    if (!category) return undefined;
    const parent = category.parentId ? this.data.categories.find(item => item.id === category.parentId) : undefined;
    return parent ? `${parent.name} › ${category.name}` : category.name;
  }

  getTransactionCategoryName(transaction: Extract<Transaction, { type: 'income' | 'expense' }>): string {
    return this.data.categories.find(item => item.id === transaction.categoryId)?.name ?? transaction.category;
  }

  getTransactionCategoryLabel(transaction: Transaction): string {
    if (transaction.type === 'refund') {
      const original = this.data.transactions.find(item => item.id === transaction.originalTransactionId);
      return original?.type === 'expense' ? `退款 · ${this.getTransactionCategoryLabel(original)}` : '退款';
    }
    if (transaction.type !== 'income' && transaction.type !== 'expense') return this.getNonOrdinaryCategoryLabel(transaction);
    const category = this.data.categories.find(item => item.id === transaction.categoryId);
    if (!category) return transaction.category;
    if (!category.parentId) return category.name;
    const parent = this.data.categories.find(item => item.id === category.parentId);
    return parent ? `${parent.name} › ${category.name}` : category.name;
  }

  getTopLevelIncomeBreakdown(startDate: string | DateRange, endDate?: string): ExpenseBreakdownItem[] {
    const roots = this.data.categories.filter(item => item.scope === 'income' && item.parentId === null);
    const items = roots.map(category => ({ categoryId: category.id, category: category.name,
      amount: this.getIncomeCategoryTotalIncludingChildren(category.id, startDate, endDate), percentage: 0 }))
      .filter(item => item.amount > 0);
    const total = items.reduce((sum, item) => sum + moneyCents(item.amount), 0);
    return items.map(item => ({ ...item, percentage: total ? moneyCents(item.amount) / total * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  }

  getIncomeBreakdownForParent(
    parentCategoryId: string, startDate: string | DateRange, endDate?: string
  ): ExpenseBreakdownItem[] {
    const parent = this.data.categories.find(item => item.id === parentCategoryId && item.scope === 'income' && item.parentId === null);
    if (!parent) throw new Error('一级收入分类不存在。');
    const children = this.getCategoryChildren(parent.id, false);
    const incomes = this.getTransactionsInRange(startDate, endDate).filter((item): item is Extract<Transaction, { type: 'income' }> => item.type === 'income');
    const items: ExpenseBreakdownItem[] = children.map(category => ({ categoryId: category.id, category: category.name,
      amount: incomes.filter(item => item.categoryId === category.id).reduce((sum, item) => sum + moneyCents(item.amount), 0) / 100,
      percentage: 0 })).filter(item => item.amount > 0);
    const unspecified = incomes.filter(item => item.categoryId === parent.id)
      .reduce((sum, item) => sum + moneyCents(item.amount), 0) / 100;
    if (unspecified > 0) items.push({ categoryId: null, category: '未细分', amount: unspecified, percentage: 0 });
    const total = items.reduce((sum, item) => sum + moneyCents(item.amount), 0);
    return items.map(item => ({ ...item, percentage: total ? moneyCents(item.amount) / total * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  }

  getIncomeCategoryTotalIncludingChildren(categoryId: string, startDate: string | DateRange, endDate?: string): number {
    const category = this.data.categories.find(item => item.id === categoryId && item.scope === 'income');
    if (!category) return 0;
    const matching = new Set([category.id, ...this.data.categories.filter(item => item.parentId === categoryId).map(item => item.id)]);
    return this.getTransactionsInRange(startDate, endDate).reduce((sum, transaction) =>
      transaction.type === 'income' && matching.has(transaction.categoryId) ? sum + moneyCents(transaction.amount) : sum, 0) / 100;
  }

  getBudget(year: number, month: number): BudgetPlan | undefined {
    const item = this.data.budgets.find(value => value.year === year && value.month === month);
    return item ? { ...item, categoryLimits: item.categoryLimits.map(limit => ({ ...limit })) } : undefined;
  }

  getBudgets(): BudgetPlan[] {
    return this.data.budgets.map(item => ({ ...item, categoryLimits: item.categoryLimits.map(limit => ({ ...limit })) }))
      .sort((a, b) => b.year - a.year || b.month - a.month);
  }

  getBudgetUsage(year: number, month: number): BudgetUsage {
    const budget = this.getBudget(year, month);
    const used = this.getMonthlyExpense(year, month);
    const totalLimit = budget?.totalLimit ?? null;
    return { totalLimit, used, remaining: totalLimit === null ? null : totalLimit - used,
      percentage: totalLimit === null ? null : totalLimit > 0 ? used / totalLimit * 100 : used > 0 ? 100 : 0,
      overBudget: totalLimit === null ? 0 : Math.max(0, used - totalLimit) };
  }

  getCategoryBudgetUsage(year: number, month: number): CategoryBudgetUsage[] {
    const budget = this.getBudget(year, month);
    if (!budget) return [];
    const range = getMonthDateRange(year, month);
    return budget.categoryLimits.map(limit => {
      const category = this.data.categories.find(item => item.id === limit.categoryId);
      const parent = category?.parentId ? this.data.categories.find(item => item.id === category.parentId) : undefined;
      const categoryName = category?.name ?? '已删除分类';
      const used = this.getCategoryTotalIncludingChildren(limit.categoryId, range.startDate, range.endDate);
      return { ...limit, categoryName, used, remaining: limit.limit - used,
        percentage: limit.limit > 0 ? used / limit.limit * 100 : (used > 0 ? 100 : 0),
        overBudget: Math.max(0, used - limit.limit), parentCategoryId: parent?.id ?? null,
        parentCategoryName: parent?.name ?? null };
    }).sort((a, b) => {
      const ordered = this.getCategories('expense');
      return ordered.findIndex(item => item.id === a.categoryId) - ordered.findIndex(item => item.id === b.categoryId);
    });
  }

  getShoppingBudgetRemaining(categoryId: string | null, referenceDate = todayLocalDate()): number | null {
    if (!categoryId) return null;
    if (!validDate(referenceDate)) throw new Error('日期无效。');
    const [year, month] = referenceDate.split('-').map(Number);
    const budgets = this.getCategoryBudgetUsage(year, month);
    const exact = budgets.find(item => item.categoryId === categoryId);
    if (exact) return exact.remaining;
    const category = this.data.categories.find(item => item.id === categoryId);
    return category?.parentId
      ? budgets.find(item => item.categoryId === category.parentId)?.remaining ?? null
      : null;
  }

  async saveBudget(input: BudgetPlanInput): Promise<BudgetPlan> {
    return this.enqueue(async () => {
      if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 9999
        || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new Error('预算月份无效。');
      if (input.totalLimit !== null && !validMoney(input.totalLimit, true)) throw new Error('总预算必须是非负金额，最多保留两位小数。');
      const seen = new Set<string>();
      const categoryLimits = input.categoryLimits.map(item => {
        if (seen.has(item.categoryId)) throw new Error('同一分类只能设置一条分类预算。');
        seen.add(item.categoryId);
        if (!this.data.categories.some(category => category.id === item.categoryId && category.scope === 'expense')) {
          throw new Error('分类预算必须引用有效的支出分类。');
        }
        if (!validMoney(item.limit, true)) throw new Error('分类预算必须是非负金额，最多保留两位小数。');
        return { categoryId: item.categoryId, limit: moneyCents(item.limit) / 100 };
      });
      const existing = this.data.budgets.find(item => item.year === input.year && item.month === input.month);
      const now = new Date().toISOString();
      const budget: BudgetPlan = { id: existing?.id ?? crypto.randomUUID(), year: input.year,
        month: input.month, totalLimit: input.totalLimit === null ? null : moneyCents(input.totalLimit) / 100,
        categoryLimits, createdAt: existing?.createdAt ?? now, updatedAt: now };
      const budgets = existing ? this.data.budgets.map(item => item.id === existing.id ? budget : item)
        : [...this.data.budgets, budget];
      await this.commitState({ ...this.data, budgets });
      return this.getBudget(budget.year, budget.month)!;
    });
  }

  async copyPreviousBudget(year: number, month: number, overwrite = false): Promise<BudgetPlan | undefined> {
    const previousDate = new Date(year, month - 2, 1);
    const previous = this.getBudget(previousDate.getFullYear(), previousDate.getMonth() + 1);
    if (!previous) return undefined;
    if (this.getBudget(year, month) && !overwrite) throw new Error('当前月份已有预算，请确认覆盖。');
    return this.saveBudget({ year, month, totalLimit: previous.totalLimit,
      categoryLimits: previous.categoryLimits });
  }

  getGoals(status?: GoalStatus): SavingsGoal[] {
    return this.data.goals.filter(item => !status || item.status === status).map(item => ({ ...item }));
  }

  getGoal(id: string): SavingsGoal | undefined {
    const goal = this.data.goals.find(item => item.id === id);
    return goal ? { ...goal } : undefined;
  }

  getActiveGoalsSorted(): SavingsGoal[] {
    const priority = { high: 0, medium: 1, low: 2 };
    return this.getGoals('active').sort((a, b) => priority[a.priority] - priority[b.priority]
      || (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31'));
  }

  getShoppingItems(status?: ShoppingStatus): ShoppingItem[] {
    const statusOrder: Record<ShoppingStatus, number> = { ready: 0, considering: 1, purchased: 2, abandoned: 3 };
    const priorityOrder: Record<ShoppingPriority, number> = { high: 0, medium: 1, low: 2 };
    return this.data.shoppingItems.filter(item => !status || item.status === status)
      .map(item => ({ ...item }))
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
        || priorityOrder[a.priority] - priorityOrder[b.priority]
        || b.addedAt.localeCompare(a.addedAt) || b.createdAt.localeCompare(a.createdAt));
  }

  getShoppingSummary(): { count: number; estimatedTotal: number } {
    const active = this.data.shoppingItems.filter(item => item.status === 'considering' || item.status === 'ready');
    return { count: active.length, estimatedTotal: active.reduce((sum, item) => sum + moneyCents(item.estimatedPrice), 0) / 100 };
  }

  getShoppingItem(id: string): ShoppingItem | undefined {
    const item = this.data.shoppingItems.find(value => value.id === id);
    return item ? { ...item } : undefined;
  }

  getShoppingCoolingOff(id: string, referenceDate = todayLocalDate()): ShoppingCoolingOff {
    const item = this.data.shoppingItems.find(value => value.id === id);
    if (!item) throw new Error('想买商品不存在。');
    if (!validDate(referenceDate)) throw new Error('日期无效。');
    const endDate = shiftDate(item.addedAt, item.coolingOffDays);
    const daysRemaining = Math.max(0, Math.round((Date.parse(`${endDate}T00:00:00Z`)
      - Date.parse(`${referenceDate}T00:00:00Z`)) / 86_400_000));
    return { endDate, daysRemaining, ended: referenceDate >= endDate };
  }

  getShoppingAffordability(id: string): ShoppingAffordability {
    const item = this.data.shoppingItems.find(value => value.id === id);
    if (!item) throw new Error('想买商品不存在。');
    const availableAssets = this.getTotalAvailableAssets();
    return { availableAssets, percentage: availableAssets > 0 ? item.estimatedPrice / availableAssets * 100 : null };
  }

  async addShoppingItem(input: ShoppingItemInput): Promise<ShoppingItem> {
    return this.enqueue(async () => {
      const values = this.normalizedShoppingItem(input);
      const now = new Date().toISOString();
      const item: ShoppingItem = { ...values, id: crypto.randomUUID(), status: 'considering',
        addedAt: todayLocalDate(), createdAt: now, updatedAt: now, abandonedAt: null,
        purchasedAt: null, actualPrice: null, purchaseTransactionId: null, convertedGoalId: null };
      await this.commitState({ ...this.data, shoppingItems: [...this.data.shoppingItems, item] });
      return { ...item };
    });
  }

  async updateShoppingItem(id: string, input: ShoppingItemInput): Promise<ShoppingItem> {
    return this.enqueue(async () => {
      const previous = this.data.shoppingItems.find(item => item.id === id);
      if (!previous) throw new Error('想买商品不存在。');
      if (previous.status === 'purchased' || previous.purchaseTransactionId || previous.convertedGoalId) {
        throw new Error('已购买或已转为储蓄目标的记录不能编辑。');
      }
      const values = this.normalizedShoppingItem(input);
      const updated = { ...previous, ...values, updatedAt: new Date().toISOString() };
      await this.commitState({ ...this.data, shoppingItems: this.data.shoppingItems.map(item => item.id === id ? updated : item) });
      return { ...updated };
    });
  }

  async setShoppingItemStatus(id: string, status: 'considering' | 'ready' | 'abandoned'): Promise<ShoppingItem> {
    return this.enqueue(async () => {
      const previous = this.data.shoppingItems.find(item => item.id === id);
      if (!previous) throw new Error('想买商品不存在。');
      if (previous.status === 'purchased' || previous.purchaseTransactionId || previous.convertedGoalId) {
        throw new Error('已购买或已转为储蓄目标的记录不能更改状态。');
      }
      const updated: ShoppingItem = { ...previous, status,
        abandonedAt: status === 'abandoned' ? todayLocalDate() : null, updatedAt: new Date().toISOString() };
      await this.commitState({ ...this.data, shoppingItems: this.data.shoppingItems.map(item => item.id === id ? updated : item) });
      return { ...updated };
    });
  }

  async deleteShoppingItem(id: string): Promise<void> {
    return this.enqueue(async () => {
      const item = this.data.shoppingItems.find(value => value.id === id);
      if (!item) throw new Error('想买商品不存在。');
      if (item.purchaseTransactionId || item.convertedGoalId) throw new Error('存在购买或储蓄目标关联，不能永久删除。');
      await this.commitState({ ...this.data, shoppingItems: this.data.shoppingItems.filter(value => value.id !== id) });
    });
  }

  async convertShoppingItemToGoal(id: string, input: SavingsGoalInput): Promise<SavingsGoal> {
    return this.enqueue(async () => {
      const item = this.data.shoppingItems.find(value => value.id === id);
      if (!item) throw new Error('想买商品不存在。');
      if (item.status === 'purchased' || item.purchaseTransactionId || item.convertedGoalId) {
        throw new Error('已购买或已转换的商品不能再次转换。');
      }
      const values = this.normalizedGoal(input);
      const now = new Date().toISOString();
      const goal: SavingsGoal = { ...values, id: crypto.randomUUID(), status: 'active', createdAt: now,
        updatedAt: now, completedAt: null, actualAmount: null, completionTransactionId: null };
      const updatedItem: ShoppingItem = { ...item, status: 'abandoned', abandonedAt: todayLocalDate(),
        convertedGoalId: goal.id, updatedAt: now };
      await this.commitState({ ...this.data, goals: [...this.data.goals, goal],
        shoppingItems: this.data.shoppingItems.map(value => value.id === id ? updatedItem : value) });
      return { ...goal };
    });
  }

  async purchaseShoppingItem(id: string, input: ShoppingPurchaseInput): Promise<Transaction> {
    return this.enqueue(async () => {
      const item = this.data.shoppingItems.find(value => value.id === id);
      if (!item) throw new Error('想买商品不存在。');
      if (item.status !== 'considering' && item.status !== 'ready') throw new Error('只有考虑中或准备购买的商品可以购买。');
      const category = this.data.categories.find(value => value.id === input.categoryId && value.scope === 'expense' && value.enabled);
      if (!category) throw new Error('请选择有效的支出分类。');
      const values = normalizedTransaction({ type: 'expense', amount: input.actualPrice,
        accountId: input.accountId, category: category.name, categoryId: category.id,
        date: input.date, note: input.note } as TransactionInput, this.data.accounts, this.data.categories);
      const now = new Date().toISOString();
      const transaction: Transaction = { ...values, id: crypto.randomUUID(), createdAt: now, updatedAt: now } as Transaction;
      const updatedItem: ShoppingItem = { ...item, status: 'purchased', purchasedAt: transaction.date,
        actualPrice: transaction.amount, purchaseTransactionId: transaction.id, abandonedAt: null, updatedAt: now };
      await this.commitState({ ...this.data, transactions: [...this.data.transactions, transaction],
        shoppingItems: this.data.shoppingItems.map(value => value.id === id ? updatedItem : value) });
      return { ...transaction };
    });
  }

  async addGoal(input: SavingsGoalInput): Promise<SavingsGoal> {
    return this.enqueue(async () => {
      const goal = this.normalizedGoal(input);
      const now = new Date().toISOString();
      const created: SavingsGoal = { ...goal, id: crypto.randomUUID(), status: 'active',
        createdAt: now, updatedAt: now, completedAt: null, actualAmount: null, completionTransactionId: null };
      await this.commitState({ ...this.data, goals: [...this.data.goals, created] });
      return { ...created };
    });
  }

  async updateGoal(id: string, input: SavingsGoalInput): Promise<SavingsGoal> {
    return this.enqueue(async () => {
      const existing = this.getGoal(id);
      if (!existing) throw new Error('储蓄目标不存在。');
      if (existing.status !== 'active') throw new Error('已完成或已取消的储蓄目标不能编辑。');
      const values = this.normalizedGoal(input);
      const goal = { ...existing, ...values, updatedAt: new Date().toISOString() };
      await this.commitState({ ...this.data, goals: this.data.goals.map(item => item.id === id ? goal : item) });
      return { ...goal };
    });
  }

  async deleteGoal(id: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.data.goals.some(item => item.id === id)) throw new Error('储蓄目标不存在。');
      if (this.data.goalAllocations.some(item => item.goalId === id)) throw new Error('储蓄目标已有记录，请取消目标以保留历史。');
      await this.commitState({ ...this.data, goals: this.data.goals.filter(item => item.id !== id) });
    });
  }

  getGoalAllocations(goalId: string): GoalAllocation[] {
    return this.data.goalAllocations.filter(item => item.goalId === goalId).map(item => ({ ...item }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  getGoalSavedAmount(goalId: string): number {
    return this.data.goalAllocations.filter(item => item.goalId === goalId)
      .reduce((sum, item) => sum + (item.direction === 'allocate' ? 1 : -1) * moneyCents(item.amount), 0) / 100;
  }

  getGoalRemainingAmount(goalId: string): number {
    const goal = this.getGoal(goalId);
    if (!goal) throw new Error('储蓄目标不存在。');
    return Math.max(0, moneyCents(goal.targetAmount) - moneyCents(this.getGoalSavedAmount(goalId))) / 100;
  }

  getGoalAccountReservedBalance(goalId: string, accountId: string): number {
    return this.data.goalAllocations.filter(item => item.goalId === goalId && item.accountId === accountId)
      .reduce((sum, item) => sum + (item.direction === 'allocate' ? 1 : -1) * moneyCents(item.amount), 0) / 100;
  }

  getAccountReservedBalance(accountId: string): number {
    const activeIds = new Set(this.data.goals.filter(item => item.status === 'active').map(item => item.id));
    return this.data.goalAllocations.filter(item => item.accountId === accountId && activeIds.has(item.goalId))
      .reduce((sum, item) => sum + (item.direction === 'allocate' ? 1 : -1) * moneyCents(item.amount), 0) / 100;
  }

  getAccountAvailableBalance(accountId: string): number {
    return this.getAccountBalance(accountId) - this.getAccountReservedBalance(accountId);
  }

  getTotalReservedBalance(): number {
    return this.data.accounts.filter(item => item.kind === 'asset')
      .reduce((sum, account) => sum + moneyCents(this.getAccountReservedBalance(account.id)), 0) / 100;
  }

  getTotalAvailableAssets(): number {
    return this.data.accounts.filter(item => item.kind === 'asset')
      .reduce((sum, item) => sum + balanceCents(item, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords), 0) / 100
      - this.getTotalReservedBalance();
  }

  getPendingCreditAccounts(): Array<{ account: Extract<Account, { kind: 'liability' }>; balance: number }> {
    return this.data.accounts.flatMap(account => {
      if (account.kind !== 'liability' || account.liabilityRole !== 'credit') return [];
      const balance = this.getLiabilityBalance(account.id);
      return balance > 0 ? [{ account: { ...account }, balance }] : [];
    });
  }

  getTotalPendingCreditPayments(): number {
    return this.getPendingCreditAccounts().reduce((sum, item) => sum + moneyCents(item.balance), 0) / 100;
  }

  getProjectedAvailableAssetsAfterCreditRepayment(): number {
    return this.getTotalAvailableAssets() - this.getTotalPendingCreditPayments();
  }

  getGoalSuggestedMonthly(goalId: string, today = todayLocalDate()): number | null {
    const goal = this.getGoal(goalId);
    if (!goal) throw new Error('储蓄目标不存在。');
    if (this.getGoalRemainingAmount(goalId) === 0) return 0;
    if (!goal.targetDate) return null;
    if (goal.targetDate < today) return null;
    const [year, month] = goal.targetDate.split('-').map(Number);
    const [nowYear, nowMonth] = today.split('-').map(Number);
    const months = Math.max(1, (year - nowYear) * 12 + month - nowMonth);
    return Math.ceil(moneyCents(this.getGoalRemainingAmount(goalId)) / months) / 100;
  }

  async allocateToGoal(input: GoalAllocationInput): Promise<GoalAllocation> {
    if (input.direction !== 'allocate') throw new Error('存入记录方向无效。');
    return this.saveGoalAllocation(input);
  }

  async releaseFromGoal(input: GoalAllocationInput): Promise<GoalAllocation> {
    if (input.direction !== 'release') throw new Error('取回记录方向无效。');
    return this.saveGoalAllocation(input);
  }

  async updateGoalAllocation(id: string, input: GoalAllocationInput): Promise<GoalAllocation> {
    return this.saveGoalAllocation(input, id);
  }

  async deleteGoalAllocation(id: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.data.goalAllocations.some(item => item.id === id)) throw new Error('储蓄记录不存在。');
      await this.commitState({ ...this.data, goalAllocations: this.data.goalAllocations.filter(item => item.id !== id) });
    });
  }

  async cancelGoal(id: string): Promise<void> {
    return this.enqueue(async () => {
      const goal = this.data.goals.find(item => item.id === id);
      if (!goal) throw new Error('储蓄目标不存在。');
      if (goal.status !== 'active') throw new Error('只有进行中的储蓄目标可以取消。');
      await this.commitState({ ...this.data, goals: this.data.goals.map(item => item.id === id
        ? { ...item, status: 'cancelled', updatedAt: new Date().toISOString() } : item) });
    });
  }

  async completeGoal(id: string, actualAmount: number, accountId: string, categoryId: string,
    date: string, note = ''): Promise<Transaction> {
    return this.enqueue(async () => {
      const goal = this.data.goals.find(item => item.id === id);
      if (!goal || goal.status !== 'active') throw new Error('只有进行中的储蓄目标可以完成。');
      const category = this.data.categories.find(item => item.id === categoryId && item.scope === 'expense' && item.enabled);
      if (!category) throw new Error('请选择有效的支出分类。');
      const values = normalizedTransaction({ type: 'expense', amount: actualAmount, accountId,
        category: category.name, categoryId: category.id, date, note } as TransactionInput,
        this.data.accounts, this.data.categories);
      const now = new Date().toISOString();
      const transaction: Transaction = { ...values, id: crypto.randomUUID(), createdAt: now, updatedAt: now } as Transaction;
      const completed = { ...goal, status: 'completed' as const, completedAt: date,
        actualAmount: moneyCents(actualAmount) / 100, completionTransactionId: transaction.id, updatedAt: now };
      await this.commitState({ ...this.data, transactions: [...this.data.transactions, transaction],
        goals: this.data.goals.map(item => item.id === id ? completed : item) });
      return { ...transaction };
    });
  }

  private normalizedGoal(input: SavingsGoalInput): Omit<SavingsGoal, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt' | 'actualAmount' | 'completionTransactionId'> {
    const name = input.name.trim();
    if (!name) throw new Error('请输入储蓄目标名称。');
    if (!validMoney(input.targetAmount, false)) throw new Error('目标金额必须大于零，最多保留两位小数。');
    if (input.targetDate !== null && !validDate(input.targetDate)) throw new Error('目标日期无效。');
    if (!['low', 'medium', 'high'].includes(input.priority)) throw new Error('优先级无效。');
    return { name, targetAmount: moneyCents(input.targetAmount) / 100, targetDate: input.targetDate,
      priority: input.priority, note: input.note.trim() };
  }

  private normalizedShoppingItem(input: ShoppingItemInput): ShoppingItemInput {
    const name = input.name.trim();
    if (!name) throw new Error('请输入商品名称。');
    if (!validMoney(input.estimatedPrice, true)) throw new Error('预计价格必须是非负金额，最多保留两位小数。');
    const categoryId = input.categoryId || null;
    if (categoryId && !this.data.categories.some(item => item.id === categoryId && item.scope === 'expense')) {
      throw new Error('请选择有效的支出分类。');
    }
    if (!['low', 'medium', 'high'].includes(input.priority)) throw new Error('优先级无效。');
    if (!Number.isInteger(input.coolingOffDays) || input.coolingOffDays < 0 || input.coolingOffDays > 365) {
      throw new Error('冷静期必须为 0–365 天。');
    }
    return { name, estimatedPrice: moneyCents(input.estimatedPrice) / 100, categoryId,
      priority: input.priority, coolingOffDays: input.coolingOffDays,
      reason: input.reason.trim(), alternative: input.alternative.trim(), note: input.note.trim() };
  }

  private async saveGoalAllocation(input: GoalAllocationInput, existingId?: string): Promise<GoalAllocation> {
    return this.enqueue(async () => {
      const goal = this.data.goals.find(item => item.id === input.goalId);
      const account = findAccount(this.data.accounts, input.accountId, 'asset');
      if (!goal) throw new Error('储蓄目标不存在。');
      if (!account) throw new Error('只能选择有效的资产账户。');
      if (!validDate(input.date)) throw new Error('请选择有效日期。');
      if (!validMoney(input.amount, false)) throw new Error('金额必须大于零，最多保留两位小数。');
      if (input.direction !== 'allocate' && input.direction !== 'release') throw new Error('储蓄记录类型无效。');
      const previous = existingId ? this.data.goalAllocations.find(item => item.id === existingId) : undefined;
      if (existingId && !previous) throw new Error('储蓄记录不存在。');
      const amountCents = moneyCents(input.amount);
      const withoutPrevious = this.data.goalAllocations.filter(item => item.id !== existingId);
      const reservedForPair = withoutPrevious.filter(item => item.goalId === input.goalId && item.accountId === input.accountId)
        .reduce((sum, item) => sum + (item.direction === 'allocate' ? 1 : -1) * moneyCents(item.amount), 0);
      if (input.direction === 'release' && amountCents > reservedForPair) throw new Error('取回金额不能超过该储蓄目标在此账户的已预留金额。');
      if (input.direction === 'allocate' && goal.status === 'active') {
        const reservedOnAccount = this.getAccountReservedBalance(input.accountId)
          - (previous && this.getGoal(previous.goalId)?.status === 'active' && previous.accountId === input.accountId
            ? (previous.direction === 'allocate' ? previous.amount : -previous.amount) : 0);
        const availableCents = balanceCents(account, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords) - moneyCents(reservedOnAccount);
        if (amountCents > availableCents) throw new Error(`该账户当前可自由使用余额为 ${formatStoreCny(Math.max(0, availableCents) / 100)}。`);
      }
      const now = new Date().toISOString();
      const allocation: GoalAllocation = { id: previous?.id ?? crypto.randomUUID(), goalId: input.goalId,
        accountId: input.accountId, date: input.date, amount: amountCents / 100, direction: input.direction,
        note: input.note.trim(), createdAt: previous?.createdAt ?? now, updatedAt: now };
      const goalAllocations = previous ? this.data.goalAllocations.map(item => item.id === previous.id ? allocation : item)
        : [...this.data.goalAllocations, allocation];
      await this.commitState({ ...this.data, goalAllocations });
      return { ...allocation };
    });
  }

  getDashboardConfig(): DashboardConfig {
    return cloneConfig(this.data.dashboardConfig);
  }

  getTableConfig(): TableConfig {
    return { transactionColumnWidths: { ...this.data.uiConfig.tableConfig.transactionColumnWidths } };
  }

  getUIConfig(): UIConfig {
    return { tableConfig: this.getTableConfig(), currency: this.data.uiConfig.currency };
  }

  async setExpenseChartMode(mode: ExpenseChartMode): Promise<void> {
    if (mode !== 'bar' && mode !== 'pie') throw new Error('图表类型无效。');
    return this.enqueue(() => this.commitState({ ...this.data, dashboardConfig: {
      ...this.data.dashboardConfig, expenseChartMode: mode
    } }));
  }

  async setPeriodMode(mode: PeriodMode): Promise<void> {
    if (!['day', 'week', 'month', 'year', 'custom'].includes(mode)) throw new Error('日期范围无效。');
    return this.enqueue(() => this.commitState({ ...this.data, dashboardConfig: {
      ...this.data.dashboardConfig, periodMode: mode
    } }));
  }

  async setTransactionColumnWidth(column: TransactionColumn, width: number): Promise<void> {
    const nextWidth = Math.max(minColumnWidth(column), Math.round(width));
    if (!Number.isFinite(nextWidth)) return;
    return this.enqueue(() => this.commitState({ ...this.data, uiConfig: {
      ...this.data.uiConfig, tableConfig: {
        transactionColumnWidths: { ...this.data.uiConfig.tableConfig.transactionColumnWidths, [column]: nextWidth }
      }
    } }));
  }

  getBackupPayload(): FinanceData & { exportedAt: string } {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      accounts: this.data.accounts.map(item => ({ ...item })),
      transactions: this.data.transactions.map(item => ({ ...item })),
      categories: this.data.categories.map(item => ({ ...item })),
      dashboardConfig: cloneConfig(this.data.dashboardConfig),
      uiConfig: this.getUIConfig(),
      budgets: this.data.budgets.map(item => ({ ...item, categoryLimits: item.categoryLimits.map(limit => ({ ...limit })) })),
      goals: this.data.goals.map(item => ({ ...item })),
      goalAllocations: this.data.goalAllocations.map(item => ({ ...item })),
      shoppingItems: this.data.shoppingItems.map(item => ({ ...item })),
      receivables: this.data.receivables.map(item => ({ ...item })),
      receivableCollections: this.data.receivableCollections.map(item => ({ ...item })),
      investmentValuations: this.data.investmentValuations.map(item => ({ ...item })),
      taxRecords: this.data.taxRecords.map(item => ({ ...item }))
    };
  }

  validateBackupPayload(value: unknown): void {
    this.parseBackupPayload(value);
  }

  async restoreBackup(value: unknown): Promise<void> {
    const replacement = this.parseBackupPayload(value);
    return this.enqueue(async () => {
      await this.plugin.saveData(replacement);
      this.data = replacement;
      this.notifyListeners();
    });
  }

  private parseBackupPayload(value: unknown): FinanceData {
    const input = record(value);
    if (!input || typeof input.schemaVersion !== 'number') {
      throw new Error('备份文件格式无效；当前数据未更改。');
    }
    if (input.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error('此备份由更新版本的 Finance 创建，请升级插件后再恢复。');
    }
    let replacement: FinanceData;
    if (input.version === 1 && Array.isArray(input.accounts) && input.accounts.every(isAccountV1)) {
      const v3 = migrateV2ToV3(migrateV1ToV2(input));
      replacement = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(v3.accounts, v3.transactions)));
    } else if (input.version === 2 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV2) && Array.isArray(input.transactions)
      && input.transactions.every(isOrdinaryV2)) {
      const v3 = migrateV2ToV3({
        accounts: input.accounts as Account[],
        transactions: input.transactions as PreAdjustmentTransaction[]
      });
      replacement = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(v3.accounts, v3.transactions)));
    } else if (input.version === 3 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV3) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV3)) {
      replacement = migrateV6ToV7(migrateV4ToV5(this.migrateV3ToV4(input.accounts, input.transactions)));
    } else if (input.schemaVersion === 4 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV4) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV4) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinitionV4) && isDashboardConfig(input.dashboardConfig)) {
      replacement = migrateV6ToV7(migrateV4ToV5(input));
    } else if (input.schemaVersion === 5 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV5) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV5) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinitionV6) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig)) {
      replacement = migrateV6ToV7(migrateV5ToV6(input));
    } else if (input.schemaVersion === 6 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV5) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV5) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinitionV6) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)) {
      replacement = migrateV6ToV7(input);
    } else if (input.schemaVersion === 7 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV5) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV5) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)) {
      replacement = migrateV7ToV8(input);
    } else if (input.schemaVersion === 8 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV11) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV5) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)) {
      replacement = migrateV8ToV9({ ...input, uiConfig: normalizeUIConfig(input.uiConfig) });
    } else if (input.schemaVersion === 9 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV9) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV5) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)) {
      replacement = migrateV9ToV10(input);
    } else if (input.schemaVersion === 10 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV11) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV10) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivableV10)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)) {
      replacement = migrateV10ToV11(input);
    } else if (input.schemaVersion === 11 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountV11) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV11) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivable)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)) {
      replacement = migrateV11ToV12(input);
    } else if (input.schemaVersion === 12 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountCurrent) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV11) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivable)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)) {
      replacement = migrateV12ToV13(input);
    } else if (input.schemaVersion === 13 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountCurrent) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV13) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivable)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)) {
      replacement = migrateV13ToV14(input);
    } else if (input.schemaVersion === 14 && Array.isArray(input.accounts)
      && input.accounts.every(isAccountCurrent) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV13) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivable)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)
      && Array.isArray(input.investmentValuations) && input.investmentValuations.every(isInvestmentValuation)) {
      replacement = migrateV14ToV15(input);
    } else if (input.schemaVersion === CURRENT_SCHEMA_VERSION && Array.isArray(input.accounts)
      && input.accounts.every(isAccountCurrent) && Array.isArray(input.transactions)
      && input.transactions.every(isTransactionV15) && Array.isArray(input.categories)
      && input.categories.every(isCategoryDefinition) && isDashboardConfig(input.dashboardConfig)
      && isUIConfig(input.uiConfig) && Array.isArray(input.budgets) && input.budgets.every(isBudgetPlan)
      && Array.isArray(input.goals) && input.goals.every(isSavingsGoal)
      && Array.isArray(input.goalAllocations) && input.goalAllocations.every(isGoalAllocation)
      && Array.isArray(input.shoppingItems) && input.shoppingItems.every(isShoppingItem)
      && Array.isArray(input.receivables) && input.receivables.every(isReceivable)
      && Array.isArray(input.receivableCollections) && input.receivableCollections.every(isReceivableCollection)
      && Array.isArray(input.investmentValuations) && input.investmentValuations.every(isInvestmentValuation)
      && Array.isArray(input.taxRecords) && input.taxRecords.every(isTaxRecord)) {
      replacement = { ...input, uiConfig: normalizeUIConfig(input.uiConfig),
        dashboardConfig: normalizeDashboardConfig(input.dashboardConfig) } as unknown as FinanceData;
    } else {
      throw new Error('备份文件格式无效或版本不兼容；当前数据未更改。');
    }
    if (replacement.schemaVersion !== 8 && replacement.schemaVersion !== 10 && replacement.schemaVersion !== 11
      && replacement.schemaVersion !== 12 && replacement.schemaVersion !== 13 && replacement.schemaVersion !== 14
      && replacement.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      replacement = migrateV7ToV8(replacement as unknown as Record<string, unknown>);
    }
    if (replacement.schemaVersion === 8) replacement = migrateV8ToV9(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 9) replacement = migrateV9ToV10(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 10) replacement = migrateV10ToV11(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 11) replacement = migrateV11ToV12(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 12) replacement = migrateV12ToV13(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 13) replacement = migrateV13ToV14(replacement as unknown as Record<string, unknown>);
    if (replacement.schemaVersion === 14) replacement = migrateV14ToV15(replacement as unknown as Record<string, unknown>);
    assertValidFinanceData(replacement);
    return replacement;
  }

  async addCategory(scope: CategoryScope, name: string, parentId: string | null = null): Promise<CategoryDefinition> {
    return this.enqueue(async () => {
      const normalized = name.trim();
      if (!normalized) throw new Error('分类名称不能为空。');
      const parent = parentId ? this.data.categories.find(item => item.id === parentId) : undefined;
      if (parentId && (!parent || (scope !== 'expense' && scope !== 'income' && scope !== 'investment') || parent.scope !== scope)) {
        throw new Error('子分类必须属于收入、支出或投资分类的同范围一级分类。');
      }
      if (parent?.parentId) throw new Error('Finance 当前仅支持两级分类。');
      if (parent && !parent.enabled) throw new Error('请先启用一级分类后再添加子分类。');
      if (this.data.categories.some(item => item.scope === scope && item.parentId === parentId
        && item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
        throw new Error('此分类已存在。');
      }
      const order = this.data.categories.filter(item => item.scope === scope && item.parentId === parentId)
        .reduce((max, item) => Math.max(max, item.order), -1) + 1;
      const now = new Date().toISOString();
      const category: CategoryDefinition = { id: crypto.randomUUID(), name: normalized, scope, parentId, enabled: true, order,
        createdAt: now, updatedAt: now };
      await this.commitState({ ...this.data, categories: [...this.data.categories, category] });
      return { ...category };
    });
  }

  async addSubcategory(parentId: string, name: string): Promise<CategoryDefinition> {
    return this.addCategory('expense', name, parentId);
  }

  async renameCategory(id: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const category = this.data.categories.find(item => item.id === id);
      if (!category) throw new Error('分类不存在。');
      const normalized = name.trim();
      if (!normalized) throw new Error('分类名称不能为空。');
      if (this.data.categories.some(item => item.id !== id && item.scope === category.scope && item.parentId === category.parentId
        && item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
        throw new Error('此分类已存在。');
      }
      await this.commitState({ ...this.data, categories: this.data.categories.map(item =>
        item.id === id ? { ...item, name: normalized, updatedAt: new Date().toISOString() } : item) });
    });
  }

  async setCategoryEnabled(id: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.data.categories.some(item => item.id === id)) throw new Error('分类不存在。');
      await this.commitState({ ...this.data, categories: this.data.categories.map(item =>
        item.id === id ? { ...item, enabled, updatedAt: new Date().toISOString() } : item) });
    });
  }

  async deleteCategory(id: string): Promise<void> {
    return this.enqueue(async () => {
      const category = this.data.categories.find(item => item.id === id);
      if (!category) throw new Error('分类不存在。');
      const used = this.data.accounts.some(item => item.categoryId === id
        || item.kind === 'asset' && item.investmentCategoryId === id)
        || this.data.transactions.some(item => (item.type === 'income' || item.type === 'expense')
          && item.categoryId === id);
      if (used) throw new Error('该分类已被历史记录使用，可将其停用，但不能直接删除。');
      if (category.parentId === null && this.data.categories.some(item => item.parentId === id)) {
        throw new Error('请先处理该一级分类的子分类，再删除一级分类。');
      }
      await this.commitState({ ...this.data,
        categories: this.reorderCategories(this.data.categories.filter(item => item.id !== id), category.scope, category.parentId) });
    });
  }

  async moveCategory(id: string, direction: -1 | 1): Promise<void> {
    return this.enqueue(async () => {
      const category = this.data.categories.find(item => item.id === id);
      if (!category) throw new Error('分类不存在。');
      const siblings = this.data.categories.filter(item => item.scope === category.scope && item.parentId === category.parentId)
        .sort((a, b) => a.order - b.order);
      const from = siblings.findIndex(item => item.id === id);
      const to = from + direction;
      if (to < 0 || to >= siblings.length) return;
      [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
      const now = new Date().toISOString();
      await this.commitState({ ...this.data, categories: this.data.categories.map(item => {
        if (item.scope !== category.scope || item.parentId !== category.parentId) return item;
        return { ...item, order: siblings.findIndex(sibling => sibling.id === item.id), updatedAt: now };
      }) });
    });
  }

  async setDashboardModuleVisible(module: DashboardVisibleModule, visible: boolean): Promise<void> {
    return this.enqueue(async () => {
      const modules = this.data.dashboardConfig.visibleModules.filter(item => item !== module);
      if (visible) modules.push(module);
      const order = this.data.dashboardConfig.moduleOrder;
      modules.sort((a, b) => {
        const orderKey = (module: DashboardVisibleModule): DashboardModule =>
          module === 'calendar' ? 'monthlyAnalysis' : module;
        const aIndex = order.indexOf(orderKey(a));
        const bIndex = order.indexOf(orderKey(b));
        return (aIndex < 0 ? 2.5 : aIndex) - (bIndex < 0 ? 2.5 : bIndex);
      });
      await this.commitState({ ...this.data, dashboardConfig: {
        ...this.data.dashboardConfig, visibleModules: modules
      } });
    });
  }

  async moveDashboardModule(module: DashboardModule, direction: -1 | 1): Promise<void> {
    return this.enqueue(async () => {
      const order = [...this.data.dashboardConfig.moduleOrder];
      const from = order.indexOf(module);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to], order[from]];
      await this.commitState({ ...this.data, dashboardConfig: {
        ...this.data.dashboardConfig, moduleOrder: order
      } });
    });
  }

  private reorderCategories(categories: CategoryDefinition[], scope: CategoryScope, parentId: string | null): CategoryDefinition[] {
    const order = categories.filter(item => item.scope === scope && item.parentId === parentId).sort((a, b) => a.order - b.order);
    return categories.map(item => item.scope === scope && item.parentId === parentId
      ? { ...item, order: order.findIndex(category => category.id === item.id) } : item);
  }

  getAccounts(kind: AccountKind): Account[] {
    return this.data.accounts.filter(account => account.kind === kind).map(account => ({
      ...account, category: this.getAccountCategoryLabel(account)
    }));
  }

  getAllowanceCycle(accountId: string, referenceDate = todayLocalDate()): AllowanceCycle {
    const matchingAccount = this.data.accounts.filter(isAllowanceAccountType).find(item => item.id === accountId);
    if (!matchingAccount) throw new Error('消费额度账户不存在。');
    if (!validDate(referenceDate)) throw new Error('额度周期参考日期无效。');
    const [year, month] = referenceDate.split('-').map(Number);
    let startDate = monthlyResetDate(year, month, matchingAccount.resetDay);
    if (referenceDate < startDate) {
      const previousMonth = new Date(Date.UTC(year, month - 2, 1));
      startDate = monthlyResetDate(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, matchingAccount.resetDay);
    }
    const [startYear, startMonth] = startDate.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(startYear, startMonth, 1));
    const nextStart = monthlyResetDate(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, matchingAccount.resetDay);
    return { startDate, endDate: shiftDate(nextStart, -1) };
  }

  getAllowanceUsed(accountId: string, referenceDate = todayLocalDate()): number {
    const cycle = this.getAllowanceCycle(accountId, referenceDate);
    const expenses = this.data.transactions.filter((transaction): transaction is Extract<Transaction, { type: 'expense' }> =>
      transaction.type === 'expense' && transaction.accountId === accountId
        && transaction.date >= cycle.startDate && transaction.date <= cycle.endDate);
    const spent = expenses.reduce((sum, expense) => sum + Math.max(0, moneyCents(expense.amount)
      - this.data.transactions.filter((item): item is RefundTransaction => item.type === 'refund'
        && item.originalTransactionId === expense.id && item.refundDestinationAccountId === accountId)
        .reduce((total, item) => total + moneyCents(item.amount), 0)), 0);
    return spent / 100;
  }

  getAllowanceRemaining(accountId: string, referenceDate = todayLocalDate()): number {
    const account = this.data.accounts.filter(isAllowanceAccountType).find(item => item.id === accountId);
    if (!account) throw new Error('消费额度账户不存在。');
    return account.allowanceLimit - this.getAllowanceUsed(accountId, referenceDate);
  }

  getAllowanceStatus(accountId: string, referenceDate = todayLocalDate()): AllowanceStatus {
    const account = this.data.accounts.filter(isAllowanceAccountType).find(item => item.id === accountId);
    if (!account) throw new Error('消费额度账户不存在。');
    const cycle = this.getAllowanceCycle(accountId, referenceDate);
    const used = this.getAllowanceUsed(accountId, referenceDate);
    return { ...cycle, used, allowanceLimit: account.allowanceLimit,
      remaining: account.allowanceLimit - used,
      percentage: account.allowanceLimit > 0 ? used / account.allowanceLimit * 100 : (used > 0 ? 100 : 0) };
  }

  getAllowanceHistory(accountId: string, count = 6, referenceDate = todayLocalDate()): AllowanceStatus[] {
    if (!this.data.accounts.some(item => item.id === accountId && item.kind === 'allowance')) {
      throw new Error('消费额度账户不存在。');
    }
    const history: AllowanceStatus[] = [];
    let anchor = referenceDate;
    for (let index = 0; index < Math.max(1, Math.min(36, count)); index++) {
      const status = this.getAllowanceStatus(accountId, anchor);
      history.push(status);
      anchor = shiftDate(status.startDate, -1);
    }
    return history;
  }

  getExpenseByPaymentSource(startDate: string | DateRange, endDate?: string): PaymentSourceExpense[] {
    const totals = new Map<string, number>();
    for (const transaction of this.getTransactionsInRange(startDate, endDate)) {
      if (transaction.type === 'expense') totals.set(transaction.accountId,
        (totals.get(transaction.accountId) ?? 0) + moneyCents(transaction.amount));
    }
    return [...totals.entries()].map(([accountId, cents]) => {
      const account = this.getAccount(accountId);
      return { accountId, accountName: account?.name ?? '已删除账户',
        accountKind: account?.kind ?? 'asset', amount: cents / 100 };
    }).sort((a, b) => b.amount - a.amount || a.accountName.localeCompare(b.accountName));
  }

  getExpenseFundingBreakdown(startDate: string | DateRange, endDate?: string): ExpenseFundingBreakdown {
    const expenses = this.getTransactionsInRange(startDate, endDate)
      .filter((transaction): transaction is Extract<Transaction, { type: 'expense' }> => transaction.type === 'expense');
    let own = 0; let allowance = 0;
    for (const transaction of expenses) {
      const account = this.data.accounts.find(item => item.id === transaction.accountId);
      const net = this.effectiveExpenseCents(transaction);
      if (account?.kind === 'allowance') allowance += net;
      else own += net;
    }
    return { ownAssetsExpense: own / 100, allowanceExpense: allowance / 100 };
  }

  getAccount(id: string): Account | undefined {
    const account = this.data.accounts.find(item => item.id === id);
    return account ? { ...account, category: this.getAccountCategoryLabel(account) } : undefined;
  }

  getTransactions(type?: TransactionType): Transaction[] {
    return this.data.transactions
      .filter(transaction => !type || transaction.type === type)
      .map(transaction => ({ ...transaction }))
      .sort((left, right) => right.date.localeCompare(left.date)
        || right.createdAt.localeCompare(left.createdAt)
        || right.id.localeCompare(left.id));
  }

  getTransaction(id: string): Transaction | undefined {
    const transaction = this.data.transactions.find(item => item.id === id);
    return transaction ? { ...transaction } : undefined;
  }

  getTransactionsForDate(date: string): Transaction[] {
    return this.getTransactions().filter(transaction => transaction.date === date);
  }

  getTransactionsForMonth(year: number, month: number): Transaction[] {
    return this.getTransactionsInRange(getMonthDateRange(year, month));
  }

  getTransactionsInRange(startDate: string | DateRange, endDate?: string): Transaction[] {
    const range = typeof startDate === 'string' ? { startDate, endDate: endDate ?? '' } : startDate;
    if (!validDate(range.startDate) || !validDate(range.endDate) || range.startDate > range.endDate) {
      throw new Error('日期范围无效。');
    }
    return this.getTransactions().filter(transaction =>
      transaction.date >= range.startDate && transaction.date <= range.endDate);
  }

  getIncomeTotal(startDate: string, endDate: string): number {
    return this.transactionTotal(startDate, endDate, 'income');
  }

  getExpenseTotal(startDate: string, endDate: string): number {
    return this.transactionTotal(startDate, endDate, 'expense');
  }

  getRangeSummary(range: DateRange): RangeSummary {
    return {
      income: this.getIncomeTotal(range.startDate, range.endDate),
      expense: this.getExpenseTotal(range.startDate, range.endDate),
      investment: this.getInvestmentInflow(range.startDate, range.endDate)
    };
  }

  getMonthlyIncome(year: number, month: number): number {
    const { startDate, endDate } = getMonthDateRange(year, month);
    return this.getIncomeTotal(startDate, endDate);
  }

  getMonthlyExpense(year: number, month: number): number {
    const { startDate, endDate } = getMonthDateRange(year, month);
    return this.getExpenseTotal(startDate, endDate);
  }

  getMonthlyInvestment(year: number, month: number): number {
    const { startDate, endDate } = getMonthDateRange(year, month);
    return this.getInvestmentInflow(startDate, endDate);
  }

  getDailySummary(date: string): DailySummary {
    const result: DailySummary = {
      income: this.getIncomeTotal(date, date), expense: this.getExpenseTotal(date, date), investmentIncome: 0,
      refund: 0, investmentInflow: 0, investmentOutflow: 0,
      transferCount: 0, debtBorrow: 0, debtRepay: 0
    };
    for (const transaction of this.getTransactionsForDate(date)) {
      switch (transaction.type) {
        case 'income':
        case 'expense': break;
        case 'refund': result.refund += transaction.amount; break;
        case 'transfer': {
          result.transferCount += 1;
          const kind = this.getTransferKind(transaction);
          if (kind === 'investment-inflow') result.investmentInflow += transaction.amount;
          if (kind === 'investment-outflow') result.investmentOutflow += transaction.amount;
          break;
        }
        case 'debt':
          if (transaction.debtAction === 'borrow') result.debtBorrow += transaction.amount;
          else result.debtRepay += transaction.amount;
          break;
        case 'adjustment':
          break;
        case 'investment-income': result.investmentIncome += transaction.amount; break;
      }
    }
    return result;
  }

  getMonthlyCategoryBreakdown(year: number, month: number): CategoryBreakdownItem[] {
    const range = getMonthDateRange(year, month);
    return this.getCategoryBreakdown(range);
  }

  getCategoryBreakdown(startDate: string | DateRange, endDate?: string): CategoryBreakdownItem[] {
    return this.getTopLevelExpenseBreakdown(startDate, endDate)
      .map(({ category, amount, percentage }) => ({ category, amount, percentage }));
  }

  getTopLevelExpenseBreakdown(startDate: string | DateRange, endDate?: string): ExpenseBreakdownItem[] {
    const roots = this.data.categories.filter(item => item.scope === 'expense' && item.parentId === null);
    const items = roots.map(category => ({ categoryId: category.id, category: category.name,
      amount: this.getCategoryTotalIncludingChildren(category.id, startDate, endDate), percentage: 0 }))
      .filter(item => item.amount > 0);
    const totalCents = items.reduce((sum, item) => sum + moneyCents(item.amount), 0);
    return items.map(item => ({ ...item, percentage: totalCents ? moneyCents(item.amount) / totalCents * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  }

  getExpenseBreakdownForParent(
    parentCategoryId: string, startDate: string | DateRange, endDate?: string
  ): ExpenseBreakdownItem[] {
    const parent = this.data.categories.find(item => item.id === parentCategoryId && item.scope === 'expense' && item.parentId === null);
    if (!parent) throw new Error('一级支出分类不存在。');
    const children = this.getCategoryChildren(parent.id, false);
    if (!children.length) return [];
    const expenses = this.getTransactionsInRange(startDate, endDate).filter((item): item is Extract<Transaction, { type: 'expense' }> =>
      item.type === 'expense');
    const items: ExpenseBreakdownItem[] = children.map(category => ({ categoryId: category.id,
      category: category.name, amount: expenses.filter(item => item.categoryId === category.id)
        .reduce((sum, item) => sum + this.effectiveExpenseCents(item), 0) / 100, percentage: 0 }))
      .filter(item => item.amount > 0);
    const unspecified = expenses.filter(item => item.categoryId === parent.id)
      .reduce((sum, item) => sum + this.effectiveExpenseCents(item), 0) / 100;
    if (unspecified > 0) items.push({ categoryId: null, category: '未细分', amount: unspecified, percentage: 0 });
    const totalCents = items.reduce((sum, item) => sum + moneyCents(item.amount), 0);
    return items.map(item => ({ ...item, percentage: totalCents ? moneyCents(item.amount) / totalCents * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  }

  getCategoryTotalIncludingChildren(categoryId: string, startDate: string | DateRange, endDate?: string): number {
    const category = this.data.categories.find(item => item.id === categoryId && item.scope === 'expense');
    if (!category) return 0;
    const matching = new Set([category.id, ...this.data.categories.filter(item => item.parentId === categoryId).map(item => item.id)]);
    const cents = this.getTransactionsInRange(startDate, endDate).reduce((sum, transaction) =>
      transaction.type === 'expense' && matching.has(transaction.categoryId) ? sum + this.effectiveExpenseCents(transaction) : sum, 0);
    return cents / 100;
  }

  getTransactionsByCategory(categoryId: string, startDate?: string | DateRange, endDate?: string): Transaction[] {
    const category = this.data.categories.find(item => item.id === categoryId);
    if (!category) return [];
    const matches = new Set([category.id, ...(category.parentId === null
      ? this.data.categories.filter(item => item.parentId === category.id).map(item => item.id) : [])]);
    const transactions = startDate ? this.getTransactionsInRange(startDate, endDate) : this.getTransactions();
    return transactions.filter(item => (item.type === 'income' || item.type === 'expense') && matches.has(item.categoryId));
  }

  /* Compatibility wrapper: analytics now roll child expenses into their parent. */
  private getLegacyCategoryBreakdown(startDate: string | DateRange, endDate?: string): CategoryBreakdownItem[] {
    const expenses = this.getTransactionsInRange(startDate, endDate)
      .filter((transaction): transaction is Extract<Transaction, { type: 'expense' }> =>
        transaction.type === 'expense');
    const totals = new Map<string, number>();
    for (const expense of expenses) {
      const category = this.getTransactionCategoryName(expense);
      totals.set(category, (totals.get(category) ?? 0) + moneyCents(expense.amount));
    }
    const total = [...totals.values()].reduce((sum, cents) => sum + cents, 0);
    if (total === 0) return [];
    return [...totals.entries()]
      .map(([category, cents]) => ({
        category, amount: cents / 100, percentage: cents / total * 100
      }))
      .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category));
  }

  getAccountBalance(accountId: string): number {
    const account = this.data.accounts.find(item => item.id === accountId);
    if (!account) throw new Error('账户不存在。');
    return balanceCents(account, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords) / 100;
  }

  getCurrentBalance(accountId: string): number {
    return this.getAccountBalance(accountId);
  }

  getLiabilityBalance(accountId: string): number {
    const account = this.data.accounts.find(item => item.id === accountId);
    if (!account || account.kind !== 'liability') throw new Error('负债账户不存在。');
    return balanceCents(account, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords) / 100;
  }

  getTotalAssets(): number {
    return (this.totalCents('asset') + this.getTotalReceivableOutstandingCents()) / 100;
  }

  getTotalLiabilities(): number {
    return this.totalCents('liability') / 100;
  }

  getNetWorth(): number {
    return (this.totalCents('asset') + this.getTotalReceivableOutstandingCents() - this.totalCents('liability')) / 100;
  }

  getTransferKind(transaction: TransferTransaction): TransferKind {
    const from = this.data.accounts.find(account => account.id === transaction.fromAccountId);
    const to = this.data.accounts.find(account => account.id === transaction.toAccountId);
    if (!from || !to || from.kind !== 'asset' || to.kind !== 'asset') {
      throw new Error('转账账户不存在。');
    }
    if (from.accountRole === 'cash' && to.accountRole === 'investment') {
      return 'investment-inflow';
    }
    if (from.accountRole === 'investment' && to.accountRole === 'cash') {
      return 'investment-outflow';
    }
    if (from.accountRole === 'investment' && to.accountRole === 'investment') {
      return 'investment-rebalance';
    }
    return 'account-transfer';
  }

  getInvestmentInflow(startDate: string, endDate: string): number {
    return this.investmentTotal(startDate, endDate, 'investment-inflow');
  }

  getInvestmentOutflow(startDate: string, endDate: string): number {
    return this.investmentTotal(startDate, endDate, 'investment-outflow');
  }

  getInvestmentIncomeTotal(startDate?: string, endDate?: string): number {
    return this.data.transactions.filter((item): item is Extract<Transaction, { type: 'investment-income' }> =>
      item.type === 'investment-income' && (!startDate || item.date >= startDate)
        && (!endDate || item.date <= endDate))
      .reduce((sum, item) => sum + moneyCents(item.amount), 0) / 100;
  }

  getTaxRecords(taxYear?: number): TaxRecord[] {
    return this.data.taxRecords.filter(item => taxYear === undefined || item.taxYear === taxYear)
      .map(item => ({ ...item }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  getTaxYearSummary(taxYear: number): {
    taxYear: number; grossIncome: number; netIncome: number; withholding: number; finalTax: number;
    refund: number; additionalPayment: number; netTaxBurden: number;
  } {
    const incomes = this.data.transactions.filter((item): item is Extract<Transaction, { type: 'income' }> =>
      item.type === 'income' && (item.taxYear ?? Number(item.date.slice(0, 4))) === taxYear);
    const records = this.data.taxRecords.filter(item => item.taxYear === taxYear);
    const grossIncome = incomes.reduce((sum, item) => sum + moneyCents(item.grossAmount ?? item.amount), 0);
    const netIncome = incomes.reduce((sum, item) => sum + moneyCents(item.netAmount ?? item.amount), 0);
    const sumType = (type: TaxRecordType) => records.filter(item => item.type === type)
      .reduce((sum, item) => sum + moneyCents(item.amount), 0);
    const withholding = sumType('withholding'); const finalTax = sumType('final_tax');
    const refund = sumType('refund'); const additionalPayment = sumType('additional_payment');
    return { taxYear, grossIncome: grossIncome / 100, netIncome: netIncome / 100,
      withholding: withholding / 100, finalTax: finalTax / 100, refund: refund / 100,
      additionalPayment: additionalPayment / 100,
      netTaxBurden: (finalTax + withholding + additionalPayment - refund) / 100 };
  }

  async addTaxRecord(input: TaxRecordInput): Promise<TaxRecord> {
    return this.enqueue(async () => {
      if (input.type !== 'refund' && input.type !== 'additional_payment') {
        throw new Error('预扣税和最终税费需要在收入记录中填写。');
      }
      if (!validMoney(input.amount, false)) throw new Error('请输入有效的税款金额。');
      if (!validDate(input.date)) throw new Error('请选择有效日期。');
      if (!Number.isInteger(input.taxYear) || input.taxYear < 1900) throw new Error('请选择有效的税务年度。');
      const account = this.getAccount(input.accountId);
      if (!account || account.kind !== 'asset' || account.accountRole !== 'cash') {
        throw new Error('请选择有效的现金资产账户。');
      }
      const now = new Date().toISOString();
      const record: TaxRecord = { id: crypto.randomUUID(), type: input.type,
        amount: moneyCents(input.amount) / 100, date: input.date, taxYear: input.taxYear,
        incomeTransactionId: null, accountId: input.accountId, status: 'recorded',
        note: input.note.trim(), createdAt: now, updatedAt: now };
      await this.commitState({ ...this.data, taxRecords: [...this.data.taxRecords, record] });
      return { ...record };
    });
  }

  async updateTaxRecord(id: string, input: TaxRecordInput): Promise<TaxRecord> {
    return this.enqueue(async () => {
      const previous = this.data.taxRecords.find(item => item.id === id);
      if (!previous || (previous.type !== 'refund' && previous.type !== 'additional_payment')) {
        throw new Error('税务记录不存在，或需从关联收入中编辑。');
      }
      if (input.type !== 'refund' && input.type !== 'additional_payment') throw new Error('请选择退税或补税。');
      if (!validMoney(input.amount, false)) throw new Error('请输入有效的税款金额。');
      if (!validDate(input.date)) throw new Error('请选择有效日期。');
      if (!Number.isInteger(input.taxYear) || input.taxYear < 1900) throw new Error('请选择有效的税务年度。');
      const account = this.getAccount(input.accountId);
      if (!account || account.kind !== 'asset' || account.accountRole !== 'cash') throw new Error('请选择有效的现金资产账户。');
      const updated: TaxRecord = { ...previous, ...input, amount: moneyCents(input.amount) / 100,
        incomeTransactionId: null, status: 'recorded', note: input.note.trim(), updatedAt: new Date().toISOString() };
      await this.commitState({ ...this.data, taxRecords: this.data.taxRecords.map(item => item.id === id ? updated : item) });
      return { ...updated };
    });
  }

  async deleteTaxRecord(id: string): Promise<void> {
    return this.enqueue(async () => {
      const target = this.data.taxRecords.find(item => item.id === id);
      if (!target) throw new Error('税务记录不存在。');
      if (target.incomeTransactionId) throw new Error('请从关联收入流水中删除或修改税务记录。');
      await this.commitState({ ...this.data, taxRecords: this.data.taxRecords.filter(item => item.id !== id) });
    });
  }

  getInvestmentSummary(): InvestmentSummary {
    const investmentAccounts = this.data.accounts.filter((item): item is Extract<Account, { kind: 'asset' }> =>
      item.kind === 'asset' && item.accountRole === 'investment');
    const marketCents = investmentAccounts.reduce((sum, item) => sum + moneyCents(this.getCurrentBalance(item.id)), 0);
    const openingBasis = investmentAccounts.reduce((sum, item) => sum + moneyCents(item.openingBalance), 0);
    const contributed = moneyCents(this.getInvestmentInflow('0000-01-01', '9999-12-31'));
    const redeemed = moneyCents(this.getInvestmentOutflow('0000-01-01', '9999-12-31'));
    const income = moneyCents(this.getInvestmentIncomeTotal());
    const returnCents = marketCents + redeemed + income - openingBasis - contributed;
    const investedBasis = openingBasis + contributed;
    return { marketValue: marketCents / 100, openingBasis: openingBasis / 100,
      contributed: contributed / 100, redeemed: redeemed / 100,
      income: income / 100, returnAmount: returnCents / 100,
      returnRate: investedBasis > 0 ? returnCents / investedBasis : null };
  }

  getInvestmentAccountSummary(accountId: string): InvestmentAccountSummary | null {
    const account = this.getAccount(accountId);
    if (!account || account.kind !== 'asset' || account.accountRole !== 'investment') return null;
    let transferredIn = 0; let transferredOut = 0; let income = 0;
    for (const transaction of this.data.transactions) {
      if (transaction.type === 'transfer') {
        if (transaction.toAccountId === accountId) transferredIn += moneyCents(transaction.amount);
        if (transaction.fromAccountId === accountId) transferredOut += moneyCents(transaction.amount);
      } else if (transaction.type === 'investment-income' && transaction.investmentAccountId === accountId) {
        income += moneyCents(transaction.amount);
      }
    }
    const marketValue = moneyCents(this.getCurrentBalance(accountId));
    const openingBasis = moneyCents(account.openingBalance);
    const returnAmount = marketValue + transferredOut + income - openingBasis - transferredIn;
    const investedBasis = openingBasis + transferredIn;
    return { accountId, marketValue: marketValue / 100, openingBasis: openingBasis / 100,
      transferredIn: transferredIn / 100,
      transferredOut: transferredOut / 100, income: income / 100, returnAmount: returnAmount / 100,
      returnRate: investedBasis > 0 ? returnAmount / investedBasis : null };
  }

  getInvestmentCategorySummaries(): InvestmentCategorySummary[] {
    const summary = this.getInvestmentSummary();
    return this.data.categories.filter(item => item.scope === 'investment' && item.parentId === null)
      .map(category => {
        const marketCents = this.data.accounts.filter((account): account is Extract<Account, { kind: 'asset' }> => {
          if (account.kind !== 'asset' || account.accountRole !== 'investment' || !account.investmentCategoryId) return false;
          const selected = this.getCategory(account.investmentCategoryId);
          return selected?.id === category.id || selected?.parentId === category.id;
        }).reduce((sum, account) => sum + moneyCents(this.getCurrentBalance(account.id)), 0);
        return { categoryId: category.id, name: category.name, marketValue: marketCents / 100,
          percentage: summary.marketValue > 0 ? marketCents / moneyCents(summary.marketValue) * 100 : 0 };
      }).filter(item => item.marketValue !== 0 || this.data.accounts.some(account => {
        if (account.kind !== 'asset' || account.accountRole !== 'investment' || !account.investmentCategoryId) return false;
        const selected = this.getCategory(account.investmentCategoryId);
        return selected?.id === item.categoryId || selected?.parentId === item.categoryId;
      }));
  }

  getLatestInvestmentValuationDate(accountId?: string): string | null {
    const latest = this.data.investmentValuations.filter(item => !accountId || item.accountId === accountId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest?.date ?? null;
  }

  getInvestmentValuations(accountId: string): InvestmentValuationSnapshot[] {
    const history = this.data.investmentValuations.filter(item => item.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));
    return history.map((valuation, index) => {
      const previous = history[index - 1];
      const account = this.getAccount(accountId);
      if (!account || account.kind !== 'asset' || account.accountRole !== 'investment') {
        return { ...valuation, intervalReturn: null };
      }
      const baselineValue = previous ? moneyCents(previous.marketValue) : moneyCents(account.openingBalance);
      const baselineDate = previous?.date;
      const baselineUpdatedAt = previous?.updatedAt;
      let inflowCents = 0; let outflowCents = 0;
      for (const transaction of this.data.transactions) {
        const afterPrevious = !previous || transaction.date > baselineDate!
          || transaction.date === baselineDate && transaction.createdAt > baselineUpdatedAt!;
        const beforeCurrent = transaction.date < valuation.date
          || transaction.date === valuation.date && transaction.createdAt <= valuation.updatedAt;
        if (!afterPrevious || !beforeCurrent) continue;
        if (transaction.type !== 'transfer') continue;
        if (transaction.toAccountId === accountId) inflowCents += moneyCents(transaction.amount);
        if (transaction.fromAccountId === accountId) outflowCents += moneyCents(transaction.amount);
      }
      const intervalCents = moneyCents(valuation.marketValue) - baselineValue
        - inflowCents + outflowCents;
      return { ...valuation, intervalReturn: intervalCents / 100 };
    }).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateInvestmentValuation(input: InvestmentValuationInput): Promise<InvestmentValuation> {
    return this.enqueue(async () => {
      const account = this.getAccount(input.accountId);
      if (!account || account.kind !== 'asset' || account.accountRole !== 'investment') {
        throw new Error('请选择有效的投资账户。');
      }
      if (!validDate(input.date)) throw new Error('请选择有效的估值日期。');
      if (!validMoney(input.marketValue, true)) throw new Error('市值必须为非负金额，最多保留两位小数。');
      const existing = this.data.investmentValuations.find(item => item.accountId === input.accountId && item.date === input.date);
      const now = new Date().toISOString();
      const valuation: InvestmentValuation = {
        id: existing?.id ?? crypto.randomUUID(), accountId: input.accountId, date: input.date,
        marketValue: moneyCents(input.marketValue) / 100, note: input.note.trim(),
        createdAt: existing?.createdAt ?? now, updatedAt: now
      };
      const investmentValuations = existing
        ? this.data.investmentValuations.map(item => item.id === existing.id ? valuation : item)
        : [...this.data.investmentValuations, valuation];
      await this.commitState({ ...this.data, investmentValuations });
      return { ...valuation };
    });
  }

  private getNonOrdinaryCategoryLabel(transaction: Exclude<Transaction, { type: 'income' | 'expense' }>): string {
    switch (transaction.type) {
      case 'debt': {
        const liability = this.data.accounts.find(item => item.id === transaction.liabilityAccountId);
        return transaction.debtAction === 'repay'
          ? liability?.kind === 'liability' && liability.liabilityRole === 'credit' ? '信用还款' : '偿还本金'
          : `${liability?.category ?? '负债'}借入`;
      }
      case 'adjustment':
        return '余额校准';
      case 'refund': return '退款';
      case 'transfer':
        switch (this.getTransferKind(transaction)) {
          case 'investment-inflow': return '投资转入';
          case 'investment-outflow': return '投资赎回';
          case 'investment-rebalance': return '投资账户转账';
          case 'account-transfer': return '账户转账';
        }
      case 'investment-income':
        return `投资收益 · ${{ dividend: '分红', interest: '利息', 'cash-dividend': '现金派息', other: '其他' }[transaction.incomeKind]}`;
    }
  }

  getTransactionAccountLabel(transaction: Transaction): string {
    const name = (id: string) => this.getAccount(id)?.name ?? '已删除账户';
    switch (transaction.type) {
      case 'income':
      case 'expense':
        return name(transaction.accountId);
      case 'refund':
        return `退款至 ${name(transaction.refundDestinationAccountId)}`;
      case 'transfer':
        return `${name(transaction.fromAccountId)} → ${name(transaction.toAccountId)}`;
      case 'debt':
        return transaction.debtAction === 'borrow'
          ? `${name(transaction.liabilityAccountId)} → ${name(transaction.assetAccountId)}`
          : `${name(transaction.assetAccountId)} → ${name(transaction.liabilityAccountId)}`;
      case 'adjustment':
        return name(transaction.accountId);
      case 'investment-income':
        return `${name(transaction.investmentAccountId)} → ${name(transaction.accountId)}`;
    }
  }

  getRefundedAmount(expenseId: string): number {
    return this.data.transactions.filter((item): item is RefundTransaction =>
      item.type === 'refund' && item.originalTransactionId === expenseId)
      .reduce((sum, item) => sum + moneyCents(item.amount), 0) / 100;
  }

  getRemainingRefundable(expenseId: string): number {
    const expense = this.data.transactions.find(item => item.id === expenseId);
    if (!expense || expense.type !== 'expense') return 0;
    return Math.max(0, moneyCents(expense.amount) - moneyCents(this.getRefundedAmount(expenseId))) / 100;
  }

  getReceivableCollected(id: string): number {
    return this.data.receivableCollections.filter(item => item.receivableId === id)
      .reduce((sum, item) => sum + moneyCents(item.amount), 0) / 100;
  }

  getReceivableOutstanding(id: string): number {
    const item = this.data.receivables.find(value => value.id === id);
    return item && item.status === 'open'
      ? Math.max(0, moneyCents(item.receivableAmount) - moneyCents(this.getReceivableCollected(id))
        - moneyCents(item.writtenOffAmount)) / 100 : 0;
  }

  getTotalReceivableOutstanding(): number {
    return this.data.receivables.filter(item => item.status === 'open')
      .reduce((sum, item) => sum + moneyCents(this.getReceivableOutstanding(item.id)), 0) / 100;
  }

  getOpenReceivableCount(): number {
    return this.data.receivables.filter(item => item.status === 'open' && this.getReceivableOutstanding(item.id) > 0).length;
  }

  private getTotalReceivableOutstandingCents(): number {
    return moneyCents(this.getTotalReceivableOutstanding());
  }

  getReceivables(status?: ReceivableStatus): Receivable[] {
    return this.data.receivables.filter(item => (!status || item.status === status) && item.status !== 'cancelled')
      .map(item => ({ ...item })).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  getReceivable(id: string): Receivable | undefined {
    const item = this.data.receivables.find(value => value.id === id);
    return item ? { ...item } : undefined;
  }

  isReceivablePersonalExpense(transactionId: string): boolean {
    return this.data.receivables.some(item => item.personalExpenseTransactionId === transactionId);
  }

  getReceivableCollections(id: string): ReceivableCollection[] {
    return this.data.receivableCollections.filter(item => item.receivableId === id)
      .map(item => ({ ...item })).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  getAllReceivableCollections(): ReceivableCollection[] {
    return this.data.receivableCollections.map(item => ({ ...item }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  async addReceivable(input: ReceivableInput): Promise<Receivable> {
    return this.enqueue(async () => {
      const fields = this.normalizeReceivableInput(input);
      const now = new Date().toISOString();
      const expense = fields.personalShare > 0 ? this.createReceivableExpense(fields, now) : null;
      const receivable: Receivable = { ...fields, id: crypto.randomUUID(), receivableAmount:
        (moneyCents(fields.totalPaid) - moneyCents(fields.personalShare)) / 100,
        status: 'open', writtenOffAmount: 0, closedAt: null,
        personalExpenseTransactionId: expense?.id ?? null, createdAt: now, updatedAt: now };
      await this.commitState({ ...this.data, receivables: [...this.data.receivables, receivable],
        transactions: expense ? [...this.data.transactions, expense] : this.data.transactions });
      return { ...receivable };
    });
  }

  async updateReceivable(id: string, input: ReceivableInput): Promise<Receivable> {
    return this.enqueue(async () => {
      const previous = this.data.receivables.find(item => item.id === id);
      if (!previous) throw new Error('待收款记录不存在。');
      if (previous.status === 'closed') throw new Error('已结束的代垫不能编辑。');
      const fields = this.normalizeReceivableInput(input, previous.categoryId);
      const collectedCents = moneyCents(this.getReceivableCollected(id));
      const amount = moneyCents(fields.totalPaid) - moneyCents(fields.personalShare);
      if (amount <= 0) throw new Error('待收回金额必须大于零；没有待收金额时请使用普通支出。');
      if (amount < collectedCents) throw new Error('新的待收金额不能低于已收回金额。');
      const now = new Date().toISOString();
      let transactions = this.data.transactions;
      let expenseId = previous.personalExpenseTransactionId;
      if (previous.personalExpenseTransactionId) {
        const linked = transactions.find(item => item.id === previous.personalExpenseTransactionId);
        if (linked?.type !== 'expense') throw new Error('代垫的个人支出关联已损坏。');
        if (this.getRefundedAmount(linked.id) > fields.personalShare) throw new Error('个人部分不能低于该支出已退款金额。');
        if (fields.personalShare > 0) {
          const updated: Transaction = { ...linked, amount: fields.personalShare, date: fields.date,
            accountId: fields.paymentAccountId, categoryId: fields.categoryId,
            category: this.data.categories.find(item => item.id === fields.categoryId)?.name ?? linked.category,
            note: this.receivableExpenseNote(fields), updatedAt: now };
          transactions = transactions.map(item => item.id === linked.id ? updated : item);
        } else {
          if (this.getRefundedAmount(linked.id) > 0) throw new Error('已有退款的代垫不能将个人部分改为零。');
          transactions = transactions.filter(item => item.id !== linked.id); expenseId = null;
        }
      } else if (fields.personalShare > 0) {
        const expense = this.createReceivableExpense(fields, now); transactions = [...transactions, expense]; expenseId = expense.id;
      }
      const updated: Receivable = { ...fields, id, receivableAmount: amount / 100,
        status: collectedCents === amount ? 'settled' : 'open', writtenOffAmount: 0, closedAt: null,
        personalExpenseTransactionId: expenseId, createdAt: previous.createdAt, updatedAt: now };
      await this.commitState({ ...this.data, receivables: this.data.receivables.map(item => item.id === id ? updated : item), transactions });
      return { ...updated };
    });
  }

  async deleteReceivable(id: string): Promise<void> {
    return this.enqueue(async () => {
      const item = this.data.receivables.find(value => value.id === id);
      if (!item) throw new Error('待收款记录不存在。');
      if (item.status === 'closed') throw new Error('已结束的代垫作为历史记录保留，不能删除。');
      if (this.data.receivableCollections.some(value => value.receivableId === id)) {
        throw new Error('该代垫已有收回记录，请先处理关联收回记录。');
      }
      const transactionId = item.personalExpenseTransactionId;
      if (transactionId && this.getRefundedAmount(transactionId) > 0) throw new Error('该代垫个人支出已有退款，请先处理关联退款。');
      await this.commitState({ ...this.data, receivables: this.data.receivables.filter(value => value.id !== id),
        transactions: transactionId ? this.data.transactions.filter(value => value.id !== transactionId) : this.data.transactions });
    });
  }

  async closeReceivable(input: ReceivableWriteOffInput): Promise<Receivable> {
    return this.enqueue(async () => {
      const receivable = this.data.receivables.find(item => item.id === input.receivableId);
      if (!receivable || receivable.status !== 'open') throw new Error('只有未完成的代垫可以结束。');
      const amountCents = moneyCents(this.getReceivableOutstanding(receivable.id));
      if (amountCents <= 0) throw new Error('当前没有待收金额可以核销。');
      if (!validDate(input.date)) throw new Error('请选择有效日期。');
      const category = this.data.categories.find(item => item.id === input.categoryId && item.scope === 'expense');
      if (!category || (!this.isCategorySelectable(category.id) && category.id !== receivable.categoryId)) {
        throw new Error('请选择有效的支出分类。');
      }
      const now = new Date().toISOString();
      const writeOff: Extract<Transaction, { type: 'expense' }> = {
        id: crypto.randomUUID(), type: 'expense', receivableWriteOffId: receivable.id,
        date: input.date, amount: amountCents / 100, accountId: receivable.paymentAccountId,
        categoryId: category.id, category: category.name,
        note: [`未收回核销 · ${receivable.title}`, input.note.trim()].filter(Boolean).join(' · '),
        createdAt: now, updatedAt: now
      };
      const updated: Receivable = { ...receivable, status: 'closed', writtenOffAmount: amountCents / 100,
        closedAt: input.date, updatedAt: now };
      await this.commitState({ ...this.data,
        receivables: this.data.receivables.map(item => item.id === receivable.id ? updated : item),
        transactions: [...this.data.transactions, writeOff]
      });
      return { ...updated };
    });
  }

  async addReceivableCollection(input: ReceivableCollectionInput): Promise<ReceivableCollection> {
    return this.enqueue(async () => {
      const receivable = this.data.receivables.find(item => item.id === input.receivableId);
      if (!receivable || receivable.status !== 'open') throw new Error('只有未完成的代垫可以收回。');
      if (!validMoney(input.amount, false)) throw new Error('收回金额必须大于零，最多保留两位小数。');
      if (!validDate(input.date)) throw new Error('请选择有效日期。');
      if (!this.data.accounts.some(account => account.id === input.accountId && account.kind === 'asset')) throw new Error('收回款项只能进入资产账户。');
      const amountCents = moneyCents(input.amount);
      const outstandingCents = moneyCents(this.getReceivableOutstanding(receivable.id));
      if (amountCents > outstandingCents) throw new Error('收回金额不能超过当前待收金额。');
      const now = new Date().toISOString();
      const collection: ReceivableCollection = { id: crypto.randomUUID(), receivableId: receivable.id,
        amount: amountCents / 100, accountId: input.accountId, date: input.date, note: input.note.trim(), createdAt: now };
      const remaining = outstandingCents - amountCents;
      const status: ReceivableStatus = remaining === 0 ? 'settled' : 'open';
      await this.commitState({ ...this.data,
        receivables: this.data.receivables.map(item => item.id === receivable.id ? { ...item, status, updatedAt: now } : item),
        receivableCollections: [...this.data.receivableCollections, collection] });
      return { ...collection };
    });
  }

  async deleteReceivableCollection(id: string): Promise<void> {
    return this.enqueue(async () => {
      const collection = this.data.receivableCollections.find(item => item.id === id);
      if (!collection) throw new Error('收回记录不存在。');
      const existingReceivable = this.data.receivables.find(item => item.id === collection.receivableId);
      if (existingReceivable?.status === 'closed') throw new Error('已结束的代垫收回记录不能撤销。');
      const now = new Date().toISOString();
      const collections = this.data.receivableCollections.filter(item => item.id !== id);
      const receivable = this.data.receivables.find(item => item.id === collection.receivableId);
      const totalCollected = collections.filter(item => item.receivableId === collection.receivableId)
        .reduce((sum, item) => sum + moneyCents(item.amount), 0);
      const remaining = receivable ? moneyCents(receivable.receivableAmount) - totalCollected : 0;
      const status: ReceivableStatus = remaining === 0 ? 'settled' : 'open';
      await this.commitState({ ...this.data, receivableCollections: collections,
        receivables: this.data.receivables.map(item => item.id === collection.receivableId ? { ...item, status, updatedAt: now } : item) });
    });
  }

  private normalizeReceivableInput(input: ReceivableInput, existingCategoryId?: string): Omit<Receivable,
    'id' | 'receivableAmount' | 'status' | 'writtenOffAmount' | 'closedAt' | 'personalExpenseTransactionId' | 'createdAt' | 'updatedAt'> {
    const title = input.title.trim();
    if (!title) throw new Error('请输入事项名称。');
    if (!validMoney(input.totalPaid, false)) throw new Error('总支付金额必须大于零，最多保留两位小数。');
    if (!validMoney(input.personalShare, true) || moneyCents(input.personalShare) > moneyCents(input.totalPaid)) throw new Error('我的部分必须在 0 到总支付金额之间。');
    if (moneyCents(input.totalPaid) === moneyCents(input.personalShare)) throw new Error('这笔付款没有待收回金额，请使用普通支出。');
    if (!validDate(input.date)) throw new Error('请选择有效日期。');
    const payment = this.data.accounts.find(account => account.id === input.paymentAccountId);
    if (!payment || !(payment.kind === 'asset' || payment.kind === 'liability' && payment.liabilityRole === 'credit')) throw new Error('代垫只能使用资产或信用支付账户。');
    const category = this.data.categories.find(item => item.id === input.categoryId && item.scope === 'expense');
    const parentEnabled = !category?.parentId || this.data.categories.some(item => item.id === category.parentId && item.enabled && item.parentId === null);
    if (!category || ((!category.enabled || !parentEnabled) && category.id !== existingCategoryId)) throw new Error('请选择有效的支出分类。');
    return { title, date: input.date, paymentAccountId: payment.id, categoryId: input.categoryId,
      totalPaid: moneyCents(input.totalPaid) / 100, personalShare: moneyCents(input.personalShare) / 100,
      counterparty: input.counterparty.trim(), note: input.note.trim() };
  }

  private receivableExpenseNote(input: Pick<Receivable, 'title' | 'note'>): string {
    return [input.title, '代垫个人部分', input.note].filter(Boolean).join(' · ');
  }

  private createReceivableExpense(input: Pick<Receivable, 'title' | 'note' | 'personalShare' | 'paymentAccountId' | 'categoryId' | 'date'>, now: string): Extract<Transaction, { type: 'expense' }> {
    const category = this.data.categories.find(item => item.id === input.categoryId)!;
    return { id: crypto.randomUUID(), type: 'expense', date: input.date, amount: input.personalShare,
      accountId: input.paymentAccountId, categoryId: input.categoryId, category: category.name,
      note: this.receivableExpenseNote(input), createdAt: now, updatedAt: now };
  }

  async addAccount(input: AccountInput): Promise<Account> {
    return this.enqueue(async () => {
      const values = normalizedAccount(input, this.data.categories, undefined, this.data.accounts);
      const now = new Date().toISOString();
      const account: Account = { ...values, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      await this.commit([...this.data.accounts, account], this.data.transactions);
      return { ...account };
    });
  }

  async updateAccount(id: string, input: AccountInput): Promise<Account> {
    return this.enqueue(async () => {
      const previous = this.data.accounts.find(account => account.id === id);
      if (!previous) throw new Error('账户不存在，可能已被删除。');
      const values = normalizedAccount(input, this.data.categories, previous.categoryId, this.data.accounts,
        previous.kind === 'asset' ? previous.investmentCategoryId : undefined);
      if (values.kind !== previous.kind && this.hasTransactions(id)) {
        throw new Error('此账户已有流水，不能更改账户类型。');
      }
      if (previous.kind === 'asset' && values.kind === 'asset'
        && previous.accountRole !== values.accountRole && this.hasTransactions(id)) {
        throw new Error('此投资账户已有估值记录或流水，不能更改账户角色。');
      }
      if (previous.kind === 'liability' && values.kind === 'liability'
        && previous.liabilityRole !== values.liabilityRole && this.hasTransactions(id)) {
        throw new Error('此负债账户已有记录，不能更改普通负债 / 信用支付类型。');
      }
      const updated: Account = {
        ...values, id, createdAt: previous.createdAt, updatedAt: new Date().toISOString(),
        ...(previous.lastReconciledAt ? { lastReconciledAt: previous.lastReconciledAt } : {})
      };
      await this.commit(this.data.accounts.map(account => account.id === id ? updated : account),
        this.data.transactions);
      return { ...updated };
    });
  }

  async deleteAccount(id: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.data.accounts.some(account => account.id === id)) {
        throw new Error('账户不存在，可能已被删除。');
      }
      if (this.hasTransactions(id)) {
        throw new Error('此账户已有流水，请先删除或修改相关流水。');
      }
      const remainingAccounts = this.data.accounts.filter(account => account.id !== id).map(account =>
        account.kind === 'liability' && account.defaultRepaymentAccountId === id
          ? { ...account, defaultRepaymentAccountId: undefined, updatedAt: new Date().toISOString() } : account);
      await this.commit(remainingAccounts,
        this.data.transactions);
    });
  }

  async reconcileAccount(
    accountId: string,
    actualBalance: number,
    note = '',
    date = todayLocalDate()
  ): Promise<Extract<Transaction, { type: 'adjustment' }> | null> {
    return this.enqueue(async () => {
      const account = this.data.accounts.find(item => item.id === accountId);
      if (!account) throw new Error('账户不存在。');
      if (account.kind === 'allowance') throw new Error('消费额度账户不支持余额对账；请直接修改月额度。');
      if (!validMoney(actualBalance, true)) {
        throw new Error('实际余额必须是非负金额，最多保留两位小数。');
      }
      if (!validDate(date)) throw new Error('请选择有效的对账日期。');
      const actualCents = moneyCents(actualBalance);
      const systemCents = balanceCents(account, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords);
      const now = new Date().toISOString();
      const updatedAccount = { ...account, lastReconciledAt: date, updatedAt: now };
      if (actualCents === systemCents) {
        await this.commitState({ ...this.data, accounts: this.data.accounts.map(item =>
          item.id === accountId ? updatedAccount : item) });
        return null;
      }
      const difference = Math.abs(actualCents - systemCents);
      const adjustment: Extract<Transaction, { type: 'adjustment' }> = {
        id: crypto.randomUUID(), date, type: 'adjustment', accountId,
        adjustmentTarget: account.kind,
        direction: actualCents > systemCents ? 'increase' : 'decrease',
        amount: difference / 100, note: note.trim(), createdAt: now, updatedAt: now
      };
      await this.commitState({ ...this.data,
        accounts: this.data.accounts.map(item => item.id === accountId ? updatedAccount : item),
        transactions: [...this.data.transactions, adjustment]
      });
      return { ...adjustment };
    });
  }

  async addTransaction(input: TransactionInput): Promise<Transaction> {
    return this.enqueue(async () => {
      const values = normalizedTransaction(input, this.data.accounts, this.data.categories);
      const now = new Date().toISOString();
      const transaction: Transaction = {
        ...values, id: crypto.randomUUID(), createdAt: now, updatedAt: now
      };
      const generatedTax = this.createIncomeTaxRecord(transaction);
      await this.commitState({ ...this.data, transactions: [...this.data.transactions, transaction],
        taxRecords: generatedTax ? [...this.data.taxRecords, generatedTax] : this.data.taxRecords });
      return { ...transaction };
    });
  }

  async updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
    return this.enqueue(async () => {
      const previous = this.data.transactions.find(transaction => transaction.id === id);
      if (!previous) throw new Error('流水不存在，可能已被删除。');
      const linkedReceivable = this.data.receivables.find(item => item.personalExpenseTransactionId === id);
      if (linkedReceivable) throw new Error('这笔支出属于代垫记录，请从待收款详情中编辑。');
      if (previous.type === 'expense' && previous.receivableWriteOffId) {
        throw new Error('这笔支出属于代垫核销，请从代垫详情中查看。');
      }
      const previousCategoryId = previous.type === 'income' || previous.type === 'expense'
        ? previous.categoryId : undefined;
      const values = normalizedTransaction(input, this.data.accounts, this.data.categories, previousCategoryId);
      const updated: Transaction = {
        ...values, id, createdAt: previous.createdAt, updatedAt: new Date().toISOString()
      };
      if (previous.type === 'expense' && this.getRefundedAmount(id) > 0
        && (updated.type !== 'expense' || moneyCents(updated.amount) < moneyCents(this.getRefundedAmount(id)))) {
        throw new Error('该支出已有退款，金额不能低于累计退款，也不能改成其他类型。');
      }
      const linkedShoppingItem = this.data.shoppingItems.find(item => item.purchaseTransactionId === id);
      if (linkedShoppingItem && updated.type !== 'expense') {
        throw new Error('想买清单关联的购买流水必须保持为支出。');
      }
      const transactions = this.data.transactions.map(transaction => transaction.id === id ? updated : transaction);
      const existingTax = this.data.taxRecords.find(item => item.incomeTransactionId === id);
      const generatedTax = this.createIncomeTaxRecord(updated, existingTax);
      const taxRecords = this.data.taxRecords.filter(item => item.incomeTransactionId !== id);
      if (generatedTax) taxRecords.push(generatedTax);
      const accounts = updated.type === 'adjustment'
        ? this.data.accounts.map(account => account.id === updated.accountId
          ? { ...account, lastReconciledAt: updated.date, updatedAt: updated.updatedAt } : account)
        : this.data.accounts;
      const shoppingItems = linkedShoppingItem && updated.type === 'expense'
        ? this.data.shoppingItems.map(item => item.id === linkedShoppingItem.id
          ? { ...item, actualPrice: updated.amount, purchasedAt: updated.date, updatedAt: updated.updatedAt } : item)
        : this.data.shoppingItems;
      await this.commitState({ ...this.data, accounts, transactions, shoppingItems, taxRecords });
      return { ...updated };
    });
  }

  async deleteTransaction(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const target = this.data.transactions.find(transaction => transaction.id === id);
      if (!target) {
        throw new Error('流水不存在，可能已被删除。');
      }
      if (target.type === 'expense' && this.getRefundedAmount(id) > 0) throw new Error('该支出已有退款记录，请先处理关联退款。');
      if (this.data.receivables.some(item => item.personalExpenseTransactionId === id)) throw new Error('该支出属于代垫，请从待收款详情中删除代垫。');
      if (target.type === 'expense' && target.receivableWriteOffId) throw new Error('该支出属于代垫核销，请从代垫详情中处理。');
      const linkedShoppingItem = this.data.shoppingItems.find(item => item.purchaseTransactionId === id);
      const now = new Date().toISOString();
      const shoppingItems = linkedShoppingItem
        ? this.data.shoppingItems.map(item => item.id === linkedShoppingItem.id
          ? { ...item, status: 'ready' as const, purchasedAt: null, actualPrice: null,
            purchaseTransactionId: null, abandonedAt: null, updatedAt: now } : item)
        : this.data.shoppingItems;
      await this.commitState({ ...this.data, shoppingItems,
        transactions: this.data.transactions.filter(transaction => transaction.id !== id),
        taxRecords: this.data.taxRecords.filter(record => record.incomeTransactionId !== id) });
      return !!linkedShoppingItem;
    });
  }

  private hasTransactions(accountId: string): boolean {
    return this.data.transactions.some(transaction => touchesAccount(transaction, accountId))
      || this.data.receivables.some(item => item.paymentAccountId === accountId)
      || this.data.receivableCollections.some(item => item.accountId === accountId)
      || this.data.investmentValuations.some(item => item.accountId === accountId)
      || this.data.taxRecords.some(item => item.accountId === accountId);
  }

  private createIncomeTaxRecord(transaction: Transaction, previous?: TaxRecord): TaxRecord | null {
    if (transaction.type !== 'income' || (transaction.taxTreatment ?? 'none') === 'none'
      || moneyCents(transaction.taxAmount ?? 0) <= 0) return null;
    const now = new Date().toISOString();
    const type = transaction.taxTreatment === 'final' ? 'final_tax' : 'withholding';
    return { id: previous?.id ?? crypto.randomUUID(), type, amount: moneyCents(transaction.taxAmount ?? 0) / 100,
      date: transaction.date, taxYear: transaction.taxYear ?? Number(transaction.date.slice(0, 4)),
      incomeTransactionId: transaction.id, accountId: transaction.accountId, status: 'recorded', note: transaction.note,
      createdAt: previous?.createdAt ?? now, updatedAt: now };
  }

  private totalCents(kind: BalanceAccountKind): number {
    return this.data.accounts.filter(account => account.kind === kind)
      .reduce((sum, account) => sum + balanceCents(account, this.data.transactions, this.data.receivables, this.data.receivableCollections, this.data.investmentValuations, this.data.taxRecords), 0);
  }

  private investmentTotal(startDate: string, endDate: string, kind: TransferKind): number {
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new Error('日期范围无效。');
    }
    const cents = this.data.transactions.reduce((sum, transaction) => {
      return transaction.type === 'transfer'
        && transaction.date >= startDate && transaction.date <= endDate
        && this.getTransferKind(transaction) === kind
        ? sum + moneyCents(transaction.amount) : sum;
    }, 0);
    return cents / 100;
  }

  private transactionTotal(startDate: string, endDate: string, type: 'income' | 'expense'): number {
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new Error('日期范围无效。');
    }
    const cents = this.data.transactions.reduce((sum, transaction) => {
      if (type === 'income') return transaction.type === 'income' && transaction.date >= startDate && transaction.date <= endDate
        ? sum + moneyCents(transaction.grossAmount ?? transaction.amount) : sum;
      if (transaction.type !== 'expense' || transaction.date < startDate || transaction.date > endDate) return sum;
      return sum + this.effectiveExpenseCents(transaction);
    }, 0);
    return cents / 100;
  }

  private effectiveExpenseCents(expense: Extract<Transaction, { type: 'expense' }>): number {
    const refunded = this.data.transactions.filter((item): item is RefundTransaction =>
      item.type === 'refund' && item.originalTransactionId === expense.id)
      .reduce((sum, item) => sum + moneyCents(item.amount), 0);
    return Math.max(0, moneyCents(expense.amount) - refunded);
  }

  private async commit(accounts: Account[], transactions: Transaction[]): Promise<void> {
    await this.commitState({ ...this.data, accounts, transactions });
  }

  private async commitState(next: FinanceData): Promise<void> {
    assertValidFinanceData(next);
    await this.plugin.saveData(next);
    this.data = next;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(() => undefined, () => undefined);
    return result;
  }
}
