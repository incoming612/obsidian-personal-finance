export type AccountKind = 'asset' | 'liability' | 'allowance';
export type BalanceAccountKind = Exclude<AccountKind, 'allowance'>;
export type AccountRole = 'cash' | 'investment';
export type LiabilityRole = 'loan' | 'credit';
export type CategoryScope = 'income' | 'expense' | 'assetCash' | 'assetInvestment' | 'investment' | 'liability';

export interface CategoryDefinition {
  id: string;
  name: string;
  scope: CategoryScope;
  parentId: string | null;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type DashboardModule = 'financialStatus' | 'monthlyOverview' | 'monthlyAnalysis' | 'spending' | 'budget' | 'goals' | 'shopping' | 'assets' | 'liabilities' | 'allowances' | 'tax';
export type DashboardVisibleModule = Exclude<DashboardModule, 'monthlyAnalysis'> | 'calendar';
export type PeriodMode = 'day' | 'week' | 'month' | 'year' | 'custom';
export type ExpenseChartMode = 'bar' | 'pie';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export type TransactionColumn = 'date' | 'type' | 'category' | 'account' | 'amount' | 'note';

export interface TableConfig {
  transactionColumnWidths: Record<TransactionColumn, number>;
}

export interface UIConfig {
  tableConfig: TableConfig;
  currency: 'CNY';
}

export const DEFAULT_TRANSACTION_COLUMN_WIDTHS: Record<TransactionColumn, number> = {
  date: 92, type: 62, category: 90, account: 126, amount: 104, note: 104
};

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  transactionColumnWidths: { ...DEFAULT_TRANSACTION_COLUMN_WIDTHS }
};

export const DEFAULT_UI_CONFIG: UIConfig = {
  tableConfig: { transactionColumnWidths: { ...DEFAULT_TRANSACTION_COLUMN_WIDTHS } },
  currency: 'CNY'
};

export interface DashboardConfig {
  visibleModules: DashboardVisibleModule[];
  moduleOrder: DashboardModule[];
  expenseChartMode: ExpenseChartMode;
  periodMode: PeriodMode;
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  visibleModules: ['financialStatus', 'monthlyOverview', 'calendar', 'spending', 'budget', 'goals', 'shopping', 'assets', 'liabilities', 'allowances'],
  moduleOrder: ['financialStatus', 'monthlyOverview', 'monthlyAnalysis', 'spending', 'budget', 'goals', 'shopping', 'assets', 'liabilities', 'allowances', 'tax'],
  expenseChartMode: 'bar',
  periodMode: 'month'
};

interface AccountBase {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  openingBalance: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  lastReconciledAt?: string;
}

export type Account =
  | (AccountBase & { kind: 'asset'; accountRole: AccountRole; investmentCategoryId: string | null })
  | (AccountBase & { kind: 'liability'; liabilityRole: LiabilityRole; defaultRepaymentAccountId?: string; accountRole?: never })
  | (AccountBase & { kind: 'allowance'; accountRole?: never; allowancePeriod: 'monthly'; allowanceLimit: number; resetDay: number; rollover: false });

type AccountFields = Pick<AccountBase, 'name' | 'category' | 'openingBalance' | 'note'>;
export type AccountInput =
  | (AccountFields & { kind: 'asset'; accountRole?: AccountRole; categoryId?: string; investmentCategoryId?: string | null })
  | (AccountFields & { kind: 'liability'; liabilityRole?: LiabilityRole; defaultRepaymentAccountId?: string; accountRole?: never; categoryId?: string })
  | (Pick<AccountBase, 'name' | 'note'> & { kind: 'allowance'; allowanceLimit: number; allowancePeriod?: 'monthly'; resetDay?: number; rollover?: false });

export type OrdinaryTransactionType = 'income' | 'expense';
export type InvestmentIncomeKind = 'dividend' | 'interest' | 'cash-dividend' | 'other';
export type TransactionType = OrdinaryTransactionType | 'refund' | 'transfer' | 'debt' | 'adjustment' | 'investment-income';
export type DebtAction = 'borrow' | 'repay';
export type AdjustmentDirection = 'increase' | 'decrease';
export type AdjustmentTarget = 'asset' | 'liability';

interface TransactionBase {
  id: string;
  date: string;
  amount: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type OrdinaryTransaction = {
  [Type in OrdinaryTransactionType]: TransactionBase & {
    type: Type;
    category: string;
    categoryId: string;
    accountId: string;
  } & (Type extends 'expense' ? { receivableWriteOffId?: string }
    : { grossAmount?: number; taxAmount?: number; netAmount?: number; taxTreatment?: TaxTreatment; taxYear?: number })
}[OrdinaryTransactionType];

export type TaxTreatment = 'none' | 'withholding' | 'final';
export type TaxRecordType = 'withholding' | 'final_tax' | 'refund' | 'additional_payment';
export type TaxRecordStatus = 'recorded';

export interface TaxRecord {
  id: string;
  type: TaxRecordType;
  amount: number;
  date: string;
  taxYear: number;
  incomeTransactionId: string | null;
  accountId: string;
  status: TaxRecordStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type TaxRecordInput = Pick<TaxRecord, 'type' | 'amount' | 'date' | 'taxYear' | 'accountId' | 'note'>
  & { incomeTransactionId?: string | null };

export type TransferTransaction = TransactionBase & {
  type: 'transfer';
  fromAccountId: string;
  toAccountId: string;
};

export type DebtTransaction = TransactionBase & {
  type: 'debt';
  debtAction: DebtAction;
  assetAccountId: string;
  liabilityAccountId: string;
};

export type AdjustmentTransaction = TransactionBase & {
  type: 'adjustment';
  accountId: string;
  adjustmentTarget: AdjustmentTarget;
  direction: AdjustmentDirection;
};

export type RefundTransaction = TransactionBase & {
  type: 'refund';
  originalTransactionId: string;
  refundDestinationAccountId: string;
};

export type InvestmentIncomeTransaction = TransactionBase & {
  type: 'investment-income';
  investmentAccountId: string;
  accountId: string;
  incomeKind: InvestmentIncomeKind;
};

export type Transaction = OrdinaryTransaction | RefundTransaction | TransferTransaction | DebtTransaction
  | AdjustmentTransaction | InvestmentIncomeTransaction;
type WithoutTransactionMeta<T> = T extends Transaction
  ? Omit<T, 'id' | 'createdAt' | 'updatedAt'> : never;
export type TransactionInput = WithoutTransactionMeta<Transaction> extends infer Input
  ? Input extends { type: 'income' | 'expense'; category: string; categoryId: string }
    ? Omit<Input, 'categoryId'> & { categoryId?: string }
    : Input
  : never;

export type TransferKind = 'account-transfer' | 'investment-inflow'
  | 'investment-outflow' | 'investment-rebalance';

export interface FinanceData {
  schemaVersion: number;
  accounts: Account[];
  transactions: Transaction[];
  categories: CategoryDefinition[];
  dashboardConfig: DashboardConfig;
  uiConfig: UIConfig;
  budgets: BudgetPlan[];
  goals: SavingsGoal[];
  goalAllocations: GoalAllocation[];
  shoppingItems: ShoppingItem[];
  receivables: Receivable[];
  receivableCollections: ReceivableCollection[];
  investmentValuations: InvestmentValuation[];
  taxRecords: TaxRecord[];
}

export interface InvestmentValuation {
  id: string;
  accountId: string;
  date: string;
  marketValue: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentValuationSnapshot extends InvestmentValuation {
  intervalReturn: number | null;
}

export type ReceivableStatus = 'open' | 'settled' | 'closed' | 'cancelled';
export interface Receivable {
  id: string;
  title: string;
  date: string;
  paymentAccountId: string;
  categoryId: string;
  totalPaid: number;
  personalShare: number;
  receivableAmount: number;
  writtenOffAmount: number;
  closedAt: string | null;
  counterparty: string;
  status: ReceivableStatus;
  note: string;
  personalExpenseTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ReceivableCollection {
  id: string;
  receivableId: string;
  amount: number;
  accountId: string;
  date: string;
  note: string;
  createdAt: string;
}
export interface ReceivableInput {
  title: string; date: string; paymentAccountId: string; categoryId: string;
  totalPaid: number; personalShare: number; counterparty: string; note: string;
}
export interface ReceivableCollectionInput {
  receivableId: string; amount: number; accountId: string; date: string; note: string;
}
export interface ReceivableWriteOffInput {
  receivableId: string; categoryId: string; date: string; note: string;
}

export interface CategoryBudgetLimit { categoryId: string; limit: number; }
export interface BudgetPlan {
  id: string; year: number; month: number; totalLimit: number | null;
  categoryLimits: CategoryBudgetLimit[]; createdAt: string; updatedAt: string;
}
export type GoalPriority = 'low' | 'medium' | 'high';
export type GoalStatus = 'active' | 'completed' | 'cancelled';
export interface SavingsGoal {
  id: string; name: string; targetAmount: number; targetDate: string | null;
  priority: GoalPriority; status: GoalStatus; note: string; createdAt: string;
  updatedAt: string; completedAt: string | null; actualAmount: number | null;
  completionTransactionId: string | null;
}
export type ShoppingPriority = 'low' | 'medium' | 'high';
export type ShoppingStatus = 'considering' | 'ready' | 'purchased' | 'abandoned';
export interface ShoppingItem {
  id: string;
  name: string;
  estimatedPrice: number;
  categoryId: string | null;
  priority: ShoppingPriority;
  status: ShoppingStatus;
  addedAt: string;
  coolingOffDays: number;
  reason: string;
  alternative: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  abandonedAt: string | null;
  purchasedAt: string | null;
  actualPrice: number | null;
  purchaseTransactionId: string | null;
  convertedGoalId: string | null;
}
export type ShoppingItemInput = Pick<ShoppingItem,
  'name' | 'estimatedPrice' | 'categoryId' | 'priority' | 'coolingOffDays' | 'reason' | 'alternative' | 'note'>;
export interface ShoppingPurchaseInput {
  actualPrice: number;
  accountId: string;
  categoryId: string;
  date: string;
  note: string;
}
export interface ShoppingAffordability {
  availableAssets: number;
  percentage: number | null;
}
export interface ShoppingCoolingOff {
  endDate: string;
  daysRemaining: number;
  ended: boolean;
}
export type GoalAllocationDirection = 'allocate' | 'release';
export interface GoalAllocation {
  id: string; goalId: string; accountId: string; date: string; amount: number;
  direction: GoalAllocationDirection; note: string; createdAt: string; updatedAt: string;
}
export interface BudgetPlanInput {
  year: number; month: number; totalLimit: number | null; categoryLimits: CategoryBudgetLimit[];
}
export interface SavingsGoalInput {
  name: string; targetAmount: number; targetDate: string | null;
  priority: GoalPriority; note: string;
}
export interface GoalAllocationInput {
  goalId: string; accountId: string; date: string; amount: number;
  direction: GoalAllocationDirection; note: string;
}
export interface BudgetUsage {
  totalLimit: number | null; used: number; remaining: number | null;
  percentage: number | null; overBudget: number;
}
export interface CategoryBudgetUsage extends CategoryBudgetLimit {
  categoryName: string; parentCategoryId: string | null; parentCategoryName: string | null;
  used: number; remaining: number; percentage: number; overBudget: number;
}

export interface ExpenseBreakdownItem {
  categoryId: string | null;
  category: string;
  amount: number;
  percentage: number;
}

export interface AllowanceCycle { startDate: string; endDate: string; }
export interface AllowanceStatus extends AllowanceCycle {
  used: number; remaining: number; allowanceLimit: number; percentage: number;
}
export interface ExpenseFundingBreakdown { ownAssetsExpense: number; allowanceExpense: number; }
export interface PaymentSourceExpense { accountId: string; accountName: string; accountKind: AccountKind; amount: number; }

export const CATEGORY_SCOPES: readonly CategoryScope[] = [
  'income', 'expense', 'assetCash', 'assetInvestment', 'investment', 'liability'
];

export const CATEGORY_SCOPE_LABELS: Record<CategoryScope, string> = {
  income: '收入分类', expense: '支出分类', assetCash: '普通资产分类',
  assetInvestment: '投资资产分类', investment: '投资分类', liability: '负债分类'
};

const DEFAULT_CATEGORY_NAMES: Record<CategoryScope, readonly string[]> = {
  income: ['奖学金', '助学贷款', '助学金', '实习 / 兼职', '生活费'],
  expense: ['餐饮', '交通', '购物', '学习', '娱乐', '生活', '健康', '其他'],
  assetCash: ['银行存款', '现金', '第三方支付', '其他资产'],
  assetInvestment: ['货币基金'],
  investment: ['现金管理', '存款', '基金', '股票', '债券', '银行 / 券商理财', '贵金属', '其他投资'],
  liability: ['助学贷款', '消费负债', '其他负债']
};

export const DEFAULT_INVESTMENT_CATEGORY_IDS = {
  other: 'investment-other',
  cashManagement: 'investment-cash-management'
} as const;

const DEFAULT_INVESTMENT_CHILDREN: Record<string, readonly string[]> = {
  'investment-cash-management': ['余额宝 / 零钱通', '货币基金'],
  'investment-deposit': ['定期存款', '大额存单'],
  'investment-fund': ['指数基金', 'ETF', '债券基金', '混合基金', '股票基金', 'QDII', 'REITs'],
  'investment-stock': ['A股', '港股', '美股', '其他股票'],
  'investment-bond': ['国债', '企业债', '可转债', '其他债券'],
  'investment-bank-brokerage': ['银行理财', '券商理财'],
  'investment-precious-metal': ['黄金', '白银', '其他贵金属']
};
const DEFAULT_INVESTMENT_ROOT_IDS: Record<string, string> = {
  现金管理: 'investment-cash-management', 存款: 'investment-deposit', 基金: 'investment-fund',
  股票: 'investment-stock', 债券: 'investment-bond', '银行 / 券商理财': 'investment-bank-brokerage',
  贵金属: 'investment-precious-metal', 其他投资: DEFAULT_INVESTMENT_CATEGORY_IDS.other
};

export function createDefaultCategories(): CategoryDefinition[] {
  const now = new Date().toISOString();
  const roots = CATEGORY_SCOPES.flatMap(scope => DEFAULT_CATEGORY_NAMES[scope].map((name, order) => ({
    id: scope === 'investment' ? DEFAULT_INVESTMENT_ROOT_IDS[name] : `${scope}-${order + 1}`,
    name, scope, parentId: null, enabled: true, order,
    createdAt: now, updatedAt: now
  } satisfies CategoryDefinition)));
  const food = roots.find(item => item.scope === 'expense' && item.name === '餐饮');
  const children = food ? ['买菜做饭', '外卖', '堂食', '咖啡 / 饮料 / 零食'].map((name, order) => ({
    id: `${food.id}-sub-${order + 1}`, name, scope: 'expense' as const, parentId: food.id,
    enabled: true, order, createdAt: now, updatedAt: now
  })) : [];
  const investmentRoots = roots.filter(item => item.scope === 'investment');
  const investmentChildren = investmentRoots.flatMap(root =>
    (DEFAULT_INVESTMENT_CHILDREN[root.id] ?? []).map((name, order) => ({
      id: `${root.id}-sub-${order + 1}`, name, scope: 'investment' as const, parentId: root.id,
      enabled: true, order, createdAt: now, updatedAt: now
    })));
  return [...roots, ...children, ...investmentChildren];
}
