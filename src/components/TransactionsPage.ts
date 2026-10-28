import { Menu, setIcon, type App } from 'obsidian';
import { ConfirmDeleteTransactionModal } from '../modals/ConfirmDeleteTransactionModal';
import { TransactionModal } from '../modals/TransactionModal';
import { AdjustmentModal } from '../modals/AdjustmentModal';
import { RefundModal } from '../modals/RefundModal';
import { ReceivableDetailModal } from '../modals/ReceivableModals';
import { showTaxRecordMenu } from '../modals/TaxRecordModal';
import type { FinanceStore } from '../store';
import type { Transaction, TransactionType } from '../types';
import { formatCny, formatTransactionAmount } from '../utils/currency';

export type TransactionFilter = 'all' | TransactionType | 'tax';

export function renderTransactionsPage(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  filter: TransactionFilter,
  onFilterChange: (filter: TransactionFilter) => void
): void {
  const page = parent.createDiv({ cls: 'finance-transactions-page' });
  const filters = page.createDiv({ cls: 'finance-transaction-filters' });
  for (const [value, label] of [
    ['all', '全部'], ['income', '收入'], ['expense', '支出'],
    ['refund', '退款'], ['transfer', '转账'], ['debt', '负债'], ['adjustment', '调整'], ['tax', '退税 / 补税']
    , ['investment-income', '投资收益']
  ] as const) {
    const button = filters.createEl('button', {
      text: label,
      cls: `finance-filter-button${filter === value ? ' is-active' : ''}`,
      attr: { type: 'button', 'aria-pressed': String(filter === value) }
    });
    button.addEventListener('click', () => onFilterChange(value));
  }

  const transactions = (filter === 'tax' ? [] : store.getTransactions(filter === 'all' ? undefined : filter))
    .filter(transaction => filter !== 'all' || transaction.type !== 'expense' || !store.isReceivablePersonalExpense(transaction.id));
  const showReceivableEntries = filter === 'all' && store.getReceivables().length > 0;
  const taxEntries = filter === 'all' || filter === 'tax'
    ? store.getTaxRecords().filter(item => item.type === 'refund' || item.type === 'additional_payment') : [];
  if (transactions.length === 0 && !showReceivableEntries && !taxEntries.length) {
    const empty = page.createDiv({ cls: 'finance-empty-state finance-transaction-empty' });
    setIcon(empty.createSpan({ cls: 'finance-empty-icon' }), 'receipt-text');
    empty.createEl('h2', { text: filter === 'all' ? '还没有流水' : '没有符合条件的流水' });
    empty.createEl('p', {
      text: filter === 'all' ? '点击“+ 记一笔”记录第一笔流水。' : '当前筛选下没有流水。'
    });
    return;
  }

  const groups = page.createDiv({ cls: 'finance-transaction-days' });
  const transactionsByDate = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const day = transactionsByDate.get(transaction.date) ?? [];
    day.push(transaction);
    transactionsByDate.set(transaction.date, day);
  }
  for (const [date, dayTransactions] of transactionsByDate) {
    const group = groups.createDiv({ cls: 'finance-transaction-day' });
    const heading = group.createDiv({ cls: 'finance-transaction-day-heading' });
    heading.createEl('h2', { text: formatTransactionDay(date), cls: 'finance-transaction-day-title' });
    heading.createSpan({ text: `${dayTransactions.length} 笔`, cls: 'finance-transaction-day-count' });
    const list = group.createDiv({ cls: 'finance-transaction-list' });
    for (const transaction of dayTransactions) renderTransactionItem(list, app, store, transaction);
  }
  if (showReceivableEntries) renderReceivableEntries(page, app, store);
  if (taxEntries.length) renderTaxEntries(page, app, store, taxEntries);
}

function renderTaxEntries(parent: HTMLElement, app: App, store: FinanceStore,
  records: ReturnType<FinanceStore['getTaxRecords']>): void {
  const section = parent.createEl('section', { cls: 'finance-transaction-day finance-tax-transactions' });
  section.createEl('h2', { text: '退税与补税', cls: 'finance-transaction-day-title' });
  const list = section.createDiv({ cls: 'finance-transaction-list' });
  for (const record of records) {
    const isRefund = record.type === 'refund';
    const row = list.createDiv({ cls: `finance-transaction-item finance-tax-transaction is-${record.type}` });
    const icon = row.createDiv({ cls: 'finance-transaction-icon' }); setIcon(icon, isRefund ? 'undo-2' : 'landmark');
    const details = row.createDiv({ cls: 'finance-transaction-details' });
    details.createDiv({ text: isRefund ? '退税' : '补税', cls: 'finance-transaction-title' });
    details.createDiv({ text: `${record.date} · ${record.taxYear}年度 · ${store.getAccount(record.accountId)?.name ?? '账户已删除'}${record.note ? ` · ${record.note}` : ''}`, cls: 'finance-transaction-account' });
    row.createDiv({ text: `${isRefund ? '+' : '−'}${formatCny(record.amount)}`,
      cls: `finance-transaction-amount ${isRefund ? 'finance-income' : 'finance-expense'}` });
    const more = row.createEl('button', { cls: 'finance-transaction-more clickable-icon', attr: { type: 'button', 'aria-label': `${isRefund ? '退税' : '补税'}操作` } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', event => { event.stopPropagation(); showTaxRecordMenu(app, store, record, event); });
  }
}

function renderReceivableEntries(parent: HTMLElement, app: App, store: FinanceStore): void {
  const section = parent.createEl('section', { cls: 'finance-transaction-day finance-receivable-transactions' });
  section.createEl('h2', { text: '代垫与收回', cls: 'finance-transaction-day-title' });
  const list = section.createDiv({ cls: 'finance-transaction-list' });
  const entries = store.getReceivables().map(item => ({ date: item.date, title: item.title,
    subtitle: `${({ open: '未完成', settled: '已完成', closed: '已结束', cancelled: '已取消' })[item.status]} · ${item.counterparty || '待收对象未填写'} · 总支付 ${formatCny(item.totalPaid)} · 我的部分 ${formatCny(item.personalShare)} · 已收回 ${formatCny(store.getReceivableCollected(item.id))} · 待收 ${formatCny(store.getReceivableOutstanding(item.id))}`,
    amount: item.receivableAmount, id: item.id }));
  for (const entry of entries) {
    const row = list.createEl('button', { cls: 'finance-transaction-item finance-receivable-transaction', attr: { type: 'button' } });
    const details = row.createDiv({ cls: 'finance-transaction-details' });
    details.createDiv({ text: entry.title, cls: 'finance-transaction-title' });
    details.createDiv({ text: `${entry.date} · ${entry.subtitle}`, cls: 'finance-transaction-account' });
    row.createDiv({ text: `代垫 ${formatCny(entry.amount)}`, cls: 'finance-transaction-amount' });
    row.addEventListener('click', () => new ReceivableDetailModal(app, store, entry.id).open());
  }
}

function renderTransactionItem(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  transaction: Transaction
): void {
  const row = parent.createDiv({ cls: `finance-transaction-item is-${transaction.type}`,
    attr: transaction.type === 'refund' ? { role: 'listitem' } : { role: 'button', tabindex: '0' } });
  const categoryLabel = store.getTransactionCategoryLabel(transaction);
  const accountLabel = store.getTransactionAccountLabel(transaction);
  row.setAttribute('aria-label', `编辑${transaction.date}的${categoryLabel}流水`);
  const typeLabels: Record<TransactionType, string> = {
    income: '收入', expense: '支出', refund: '退款', transfer: '转账', debt: '负债', adjustment: '调整', 'investment-income': '投资收益'
  };
  const debtAccount = transaction.type === 'debt' ? store.getAccount(transaction.liabilityAccountId) : undefined;
  const typeLabel = transaction.type === 'debt' && transaction.debtAction === 'repay'
    && debtAccount?.kind === 'liability' && debtAccount.liabilityRole === 'credit'
    ? '信用还款' : typeLabels[transaction.type];

  const icon = row.createDiv({ cls: `finance-transaction-icon is-${transaction.type}` });
  const icons: Record<TransactionType, string> = {
    income: 'arrow-down-left', expense: 'arrow-up-right', refund: 'undo-2', transfer: 'arrow-left-right', debt: 'landmark', adjustment: 'scale', 'investment-income': 'coins'
  };
  setIcon(icon, icons[transaction.type]);
  const details = row.createDiv({ cls: 'finance-transaction-details' });
  const title = details.createDiv({ cls: 'finance-transaction-title-row' });
  title.createDiv({ text: categoryLabel, cls: 'finance-transaction-title' });
  title.createSpan({ text: typeLabel, cls: `finance-transaction-type-badge is-${transaction.type}` });
  details.createDiv({ text: accountLabel, cls: 'finance-transaction-account' });
  if (transaction.type === 'income' && (transaction.taxAmount ?? 0) > 0) {
    details.createDiv({ text: `税前 ${formatCny(transaction.grossAmount ?? transaction.amount)} · 扣税 ${formatCny(transaction.taxAmount ?? 0)} · 到账 ${formatCny(transaction.netAmount ?? transaction.amount)}`,
      cls: 'finance-transaction-note finance-income-tax-detail' });
  }
  if (transaction.note) details.createDiv({ text: transaction.note, cls: 'finance-transaction-note' });

  const amount = row.createDiv({
    text: transaction.type === 'income' || transaction.type === 'expense'
      ? formatTransactionAmount(transaction.amount, transaction.type)
      : transaction.type === 'refund' ? `+${formatCny(transaction.amount)}`
        : transaction.type === 'investment-income' ? `+${formatCny(transaction.amount)}`
        : transaction.type === 'adjustment'
        ? `${transaction.direction === 'increase' ? '+' : '−'}${formatCny(transaction.amount)}`
        : formatCny(transaction.amount),
    cls: 'finance-transaction-amount'
  });
  if (transaction.type === 'income') amount.addClass('finance-income');
  if (transaction.type === 'expense') amount.addClass('finance-expense');
  if (transaction.type === 'adjustment') amount.addClass('finance-adjustment');
  if (transaction.type === 'refund') amount.addClass('finance-refund');
  if (transaction.type === 'investment-income') amount.addClass('finance-income');
  const more = row.createEl('button', {
    cls: 'finance-transaction-more clickable-icon',
    attr: { type: 'button', 'aria-label': `${categoryLabel}的更多操作` }
  });
  setIcon(more, 'more-horizontal');
  more.addEventListener('click', event => {
    event.stopPropagation();
    const menu = new Menu();
    if (transaction.type !== 'refund') menu.addItem(item => item
      .setTitle('编辑')
      .setIcon('pencil')
      .onClick(() => openTransactionEditor(app, store, transaction)));
    if (transaction.type === 'expense' && store.getRemainingRefundable(transaction.id) > 0) menu.addItem(item => item
      .setTitle('退款')
      .setIcon('undo-2')
      .onClick(() => new RefundModal(app, store, transaction.id).open()));
    menu.addItem(item => item
      .setTitle('删除')
      .setIcon('trash')
      .onClick(() => new ConfirmDeleteTransactionModal(app, store, transaction).open()));
    menu.showAtMouseEvent(event);
  });
  row.addEventListener('click', () => { if (transaction.type !== 'refund') openTransactionEditor(app, store, transaction); });
  row.addEventListener('keydown', event => {
    if (event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (transaction.type !== 'refund') openTransactionEditor(app, store, transaction);
    }
  });
}

function formatTransactionDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${month}月${day}日 ${weekday}`;
}

function openTransactionEditor(app: App, store: FinanceStore, transaction: Transaction): void {
  if (transaction.type === 'adjustment') new AdjustmentModal(app, store, transaction).open();
  else if (transaction.type !== 'refund') new TransactionModal(app, store, transaction).open();
}
