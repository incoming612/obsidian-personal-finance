import type { FinanceStore } from '../store';
import type { Transaction } from '../types';

const TRANSACTION_HEADERS = [
  'date', 'type', 'category', 'parentCategory', 'subcategory', 'amount', 'account', 'fromAccount', 'toAccount',
  'assetAccount', 'liabilityAccount', 'debtAction', 'adjustmentDirection', 'adjustmentTarget', 'relatedTransactionId', 'note',
  'grossAmount', 'taxAmount', 'netAmount', 'taxTreatment', 'taxYear'
];
const ACCOUNT_HEADERS = [
  'name', 'kind', 'accountRole', 'liabilityRole', 'category', 'investmentCategory', 'openingBalance', 'currentBalance', 'note',
  'allowancePeriod', 'allowanceLimit', 'resetDay', 'rollover'
];

export function buildTransactionsCsv(store: FinanceStore): string {
  const rows: (string | number)[][] = [TRANSACTION_HEADERS];
  for (const transaction of store.getTransactions()) rows.push(transactionCsvRow(store, transaction));
  for (const item of store.getReceivables()) {
    const row: (string | number)[] = new Array(21).fill('');
    row[0] = item.date; row[1] = 'receivable'; row[2] = store.getCategory(item.categoryId)?.name ?? '';
    row[5] = item.totalPaid; row[6] = store.getAccount(item.paymentAccountId)?.name ?? '';
    row[14] = item.id;
    row[15] = `${item.title} | 我的部分 ${item.personalShare} | 待收 ${store.getReceivableOutstanding(item.id)} | ${item.counterparty} | ${item.note}`;
    rows.push(row);
  }
  for (const item of store.getAllReceivableCollections()) {
    const receivable = store.getReceivable(item.receivableId);
    const row: (string | number)[] = new Array(21).fill('');
    row[0] = item.date; row[1] = 'receivableCollection'; row[5] = item.amount;
    row[6] = store.getAccount(item.accountId)?.name ?? ''; row[14] = item.receivableId;
    row[15] = `${receivable?.title ?? ''} | ${item.note}`; rows.push(row);
  }
  for (const record of store.getTaxRecords()) {
    if (record.type !== 'refund' && record.type !== 'additional_payment') continue;
    const row: (string | number)[] = new Array(21).fill('');
    row[0] = record.date; row[1] = record.type === 'refund' ? 'tax-refund' : 'tax-additional-payment';
    row[5] = record.amount; row[6] = store.getAccount(record.accountId)?.name ?? '';
    row[15] = `${record.taxYear}年度 | ${record.note}`;
    rows.push(row);
  }
  return serializeCsv(rows);
}

export function buildAccountsCsv(store: FinanceStore): string {
  const rows: (string | number)[][] = [ACCOUNT_HEADERS];
  for (const kind of ['asset', 'liability', 'allowance'] as const) {
    for (const account of store.getAccounts(kind)) rows.push([
      account.name, account.kind, account.kind === 'asset' ? account.accountRole : '',
      account.kind === 'liability' ? account.liabilityRole : '', store.getAccountCategoryLabel(account),
      account.kind === 'asset' && account.accountRole === 'investment'
        ? store.getInvestmentCategoryLabel(account.investmentCategoryId) ?? '' : '',
      account.kind === 'allowance' ? '' : account.openingBalance,
      account.kind === 'allowance' ? '' : store.getAccountBalance(account.id), account.note,
      account.kind === 'allowance' ? account.allowancePeriod : '',
      account.kind === 'allowance' ? account.allowanceLimit : '',
      account.kind === 'allowance' ? account.resetDay : '',
      account.kind === 'allowance' ? String(account.rollover) : ''
    ]);
  }
  return serializeCsv(rows);
}

function transactionCsvRow(store: FinanceStore, transaction: Transaction): (string | number)[] {
  const actualCategory = transaction.type === 'income' || transaction.type === 'expense'
    ? store.getCategory(transaction.categoryId) : undefined;
  const parent = actualCategory?.parentId ? store.getCategory(actualCategory.parentId) : undefined;
  const row: (string | number)[] = new Array(21).fill('');
  row[0] = transaction.date; row[1] = transaction.type;
  row[2] = actualCategory?.name ?? store.getTransactionCategoryLabel(transaction);
  row[3] = parent?.name ?? actualCategory?.name ?? ''; row[4] = parent ? actualCategory?.name ?? '' : '';
  row[5] = transaction.amount; row[15] = transaction.note;
  if (transaction.type === 'income' || transaction.type === 'expense') {
    row[6] = store.getAccount(transaction.accountId)?.name ?? '';
    if (transaction.type === 'income') {
      row[16] = transaction.grossAmount ?? transaction.amount;
      row[17] = transaction.taxAmount ?? 0;
      row[18] = transaction.netAmount ?? transaction.amount;
      row[19] = transaction.taxTreatment ?? 'none';
      row[20] = transaction.taxYear ?? Number(transaction.date.slice(0, 4));
    }
  } else if (transaction.type === 'transfer') {
    row[7] = store.getAccount(transaction.fromAccountId)?.name ?? '';
    row[8] = store.getAccount(transaction.toAccountId)?.name ?? '';
  } else if (transaction.type === 'debt') {
    row[9] = store.getAccount(transaction.assetAccountId)?.name ?? '';
    row[10] = store.getAccount(transaction.liabilityAccountId)?.name ?? '';
    row[11] = transaction.debtAction;
  } else if (transaction.type === 'adjustment') {
    row[6] = store.getAccount(transaction.accountId)?.name ?? '';
    row[12] = transaction.direction;
    row[13] = transaction.adjustmentTarget;
  } else if (transaction.type === 'investment-income') {
    row[6] = store.getAccount(transaction.accountId)?.name ?? '';
    row[7] = store.getAccount(transaction.investmentAccountId)?.name ?? '';
    row[8] = store.getAccount(transaction.accountId)?.name ?? '';
  } else {
    row[6] = store.getAccount(transaction.refundDestinationAccountId)?.name ?? '';
    row[14] = transaction.originalTransactionId;
  }
  return row;
}

function serializeCsv(rows: (string | number)[][]): string {
  const body = rows.map(row => row.map(csvField).join(',')).join('\r\n');
  return `\uFEFF${body}`;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
