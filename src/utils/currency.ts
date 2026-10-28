const cnyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatCny(amount: number): string {
  return cnyFormatter.format(amount);
}

export function formatTransactionAmount(amount: number, type: 'income' | 'expense'): string {
  return `${type === 'income' ? '+' : '−'}${formatCny(amount)}`;
}
