import { setIcon, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import { showTaxRecordMenu } from '../modals/TaxRecordModal';
import { TransactionModal } from '../modals/TransactionModal';
import { formatCny } from '../utils/currency';

export function renderTaxPage(parent: HTMLElement, app: App, store: FinanceStore, taxYear: number,
  onYearChange: (year: number) => void): void {
  const page = parent.createDiv({ cls: 'finance-tax-page' });
  const yearBar = page.createDiv({ cls: 'finance-tax-year-bar' });
  const previous = yearBar.createEl('button', { text: '‹', cls: 'finance-icon-button', attr: { type: 'button', 'aria-label': '上一税务年度' } });
  previous.addEventListener('click', () => onYearChange(taxYear - 1));
  yearBar.createEl('h2', { text: `${taxYear} 年`, cls: 'finance-tax-year-title' });
  const next = yearBar.createEl('button', { text: '›', cls: 'finance-icon-button', attr: { type: 'button', 'aria-label': '下一税务年度' } });
  next.addEventListener('click', () => onYearChange(taxYear + 1));

  const summary = store.getTaxYearSummary(taxYear);
  const metrics = page.createDiv({ cls: 'finance-tax-summary-grid' });
  taxMetric(metrics, '税前收入', summary.grossIncome);
  taxMetric(metrics, '实际到账', summary.netIncome);
  taxMetric(metrics, '预扣税', summary.withholding);
  taxMetric(metrics, '最终税费', summary.finalTax);
  taxMetric(metrics, '已退税', summary.refund);
  taxMetric(metrics, '补税', summary.additionalPayment);
  taxMetric(metrics, '当前净已缴税款', summary.netTaxBurden, true);
  page.createEl('p', { text: '税务统计只记录实际发生金额，不计算应纳税额或预测退税。未完成年度汇算时，净额为当前已记录税款的汇总。', cls: 'finance-tax-caption' });

  const section = page.createEl('section', { cls: 'finance-panel finance-tax-records' });
  section.createEl('h2', { text: '税务记录', cls: 'finance-panel-title' });
  const records = store.getTaxRecords(taxYear);
  if (!records.length) {
    section.createDiv({ text: '这个税务年度还没有税务记录。', cls: 'finance-panel-empty' });
    return;
  }
  const list = section.createDiv({ cls: 'finance-tax-record-list' });
  for (const record of records) {
    const row = list.createDiv({ cls: 'finance-tax-record-row' });
    const details = row.createDiv({ cls: 'finance-tax-record-details' });
    details.createDiv({ text: taxRecordLabel(record.type), cls: 'finance-tax-record-title' });
    const income = record.incomeTransactionId ? store.getTransaction(record.incomeTransactionId) : undefined;
    const incomeDescription = income?.type === 'income'
      ? ` · ${income.category} · 税前 ${formatCny(income.grossAmount ?? income.amount)} · 到账 ${formatCny(income.netAmount ?? income.amount)}` : '';
    details.createDiv({ text: `${record.date} · ${store.getAccount(record.accountId)?.name ?? '账户已删除'}${incomeDescription}${record.note ? ` · ${record.note}` : ''}`, cls: 'finance-tax-record-meta' });
    if (income?.type === 'income') details.createEl('button', { text: '查看收入', cls: 'finance-link-button', attr: { type: 'button' } })
      .addEventListener('click', event => { event.stopPropagation(); new TransactionModal(app, store, income).open(); });
    const amount = row.createDiv({ text: `${record.type === 'refund' ? '+' : record.type === 'additional_payment' ? '−' : ''}${formatCny(record.amount)}`, cls: 'finance-tax-record-amount' });
    if (record.type === 'refund') amount.addClass('finance-income');
    if (record.type === 'additional_payment') amount.addClass('finance-expense');
    if (record.type === 'refund' || record.type === 'additional_payment') {
      const more = row.createEl('button', { cls: 'finance-transaction-more clickable-icon', attr: { type: 'button', 'aria-label': '税务记录操作' } });
      setIcon(more, 'more-horizontal');
      more.addEventListener('click', event => { event.stopPropagation(); showTaxRecordMenu(app, store, record, event); });
    }
  }
}

function taxMetric(parent: HTMLElement, label: string, amount: number, primary = false): void {
  const card = parent.createDiv({ cls: `finance-tax-metric${primary ? ' is-primary' : ''}` });
  card.createDiv({ text: label, cls: 'finance-tax-metric-label' });
  card.createDiv({ text: formatCny(amount), cls: 'finance-tax-metric-value' });
}

export function taxRecordLabel(type: string): string {
  switch (type) {
    case 'withholding': return '预扣税';
    case 'final_tax': return '最终税费';
    case 'refund': return '退税';
    case 'additional_payment': return '补税';
    default: return '税务记录';
  }
}
