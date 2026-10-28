import { Modal, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Transaction } from '../types';
import { formatCny, formatTransactionAmount } from '../utils/currency';
import { TransactionModal } from './TransactionModal';

export class DailyTransactionsModal extends Modal {
  constructor(
    app: App,
    private readonly store: FinanceStore,
    private readonly date: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(formatChineseDate(this.date));
    const body = this.contentEl;
    body.empty();
    body.addClass('finance-daily-modal');
    const summary = this.store.getDailySummary(this.date);
    const cards = body.createDiv({ cls: 'finance-daily-summary' });
    dailyMetric(cards, '今日收入', summary.income, 'finance-income');
    dailyMetric(cards, '今日支出', summary.expense, 'finance-expense');
    dailyMetric(cards, '退款到账', summary.refund, 'finance-refund');
    dailyMetric(cards, '今日投资', summary.investmentInflow, 'finance-calendar-investment');

    const transactions = this.store.getTransactionsForDate(this.date);
    if (transactions.length === 0) {
      body.createDiv({ text: '当天还没有流水', cls: 'finance-panel-empty' });
    } else {
      const list = body.createDiv({ cls: 'finance-daily-transaction-list' });
      for (const transaction of transactions) renderDailyTransaction(list, this.store, transaction);
    }

    body.createEl('button', {
      text: '+ 记一笔', cls: 'mod-cta finance-daily-add', attr: { type: 'button' }
    }).addEventListener('click', () => {
      this.close();
      new TransactionModal(this.app, this.store, undefined, this.date).open();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function dailyMetric(parent: HTMLElement, label: string, amount: number, cls: string): void {
  const metric = parent.createDiv({ cls: 'finance-daily-metric' });
  metric.createDiv({ text: label, cls: 'finance-summary-label' });
  metric.createDiv({ text: formatCny(amount), cls: `finance-daily-metric-value ${cls}` });
}

function renderDailyTransaction(parent: HTMLElement, store: FinanceStore, transaction: Transaction): void {
  const row = parent.createDiv({ cls: 'finance-daily-transaction' });
  const description = row.createDiv({ cls: 'finance-daily-transaction-description' });
  const label = transaction.type === 'income' ? '收入' : transaction.type === 'expense' ? '支出'
    : transaction.type === 'refund' ? '退款' : transaction.type === 'transfer' ? '转账' : transaction.type === 'adjustment' ? '调整'
      : transaction.type === 'investment-income' ? '投资收益'
        : transaction.debtAction === 'borrow' ? '借入' : '偿还本金';
  description.createDiv({ text: store.getTransactionCategoryLabel(transaction), cls: 'finance-daily-transaction-title' });
  description.createDiv({ text: `${label} · ${store.getTransactionAccountLabel(transaction)}`, cls: 'finance-daily-transaction-subtitle' });
  if (transaction.note) description.createDiv({ text: transaction.note, cls: 'finance-daily-transaction-note' });
  const text = transaction.type === 'income' || transaction.type === 'expense'
    ? formatTransactionAmount(transaction.amount, transaction.type)
    : transaction.type === 'adjustment'
      ? `${transaction.direction === 'increase' ? '+' : '−'}${formatCny(transaction.amount)}`
      : formatCny(transaction.amount);
  const amount = row.createDiv({ text, cls: 'finance-daily-transaction-amount' });
  if (transaction.type === 'income') amount.addClass('finance-income');
  if (transaction.type === 'expense') amount.addClass('finance-expense');
  if (transaction.type === 'adjustment') amount.addClass('finance-adjustment');
}

function formatChineseDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
