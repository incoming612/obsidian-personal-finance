import { setIcon, type App } from 'obsidian';
import { InvestmentValuationModal } from '../modals/InvestmentValuationModal';
import type { FinanceStore } from '../store';
import type { Account } from '../types';
import { formatCny } from '../utils/currency';

export function renderInvestmentsPage(parent: HTMLElement, app: App, store: FinanceStore): void {
  const summary = store.getInvestmentSummary();
  const page = parent.createDiv({ cls: 'finance-investments-page' });
  const overview = page.createDiv({ cls: 'finance-investments-overview' });
  metric(overview, '当前投资市值', formatCny(summary.marketValue), true);
  metric(overview, '期初投资资产', formatCny(summary.openingBasis));
  metric(overview, '后续累计投入', formatCny(summary.contributed));
  metric(overview, '累计赎回', formatCny(summary.redeemed));
  metric(overview, '累计收益', signedCny(summary.returnAmount));
  metric(overview, '累计收益率', rateText(summary.returnRate));
  page.createEl('p', { text: '累计收益率 = 累计收益 ÷（期初投资资产 + 后续累计投入），不是年化收益率、XIRR 或时间加权收益率。投资收益入账只统计已到账收益；留在投资账户中的变化通过市值体现。', cls: 'finance-investments-caption' });

  const distribution = page.createEl('section', { cls: 'finance-panel finance-investment-distribution' });
  distribution.createEl('h2', { text: '按投资分类', cls: 'finance-panel-title' });
  const categories = store.getInvestmentCategorySummaries();
  if (!categories.length) distribution.createDiv({ text: '还没有投资账户。', cls: 'finance-panel-empty' });
  else for (const category of categories) {
    const row = distribution.createDiv({ cls: 'finance-investment-category-row' });
    row.createDiv({ text: category.name, cls: 'finance-investment-category-name' });
    const track = row.createDiv({ cls: 'finance-progress-track' });
    track.createDiv({ cls: 'finance-progress-fill' }).style.width = `${Math.min(100, Math.max(0, category.percentage))}%`;
    row.createDiv({ text: `${formatCny(category.marketValue)} · ${category.percentage.toFixed(1)}%`, cls: 'finance-investment-category-value' });
  }

  const accounts = store.getAccounts('asset').filter((account): account is Extract<Account, { kind: 'asset' }> =>
    account.kind === 'asset' && account.accountRole === 'investment');
  const section = page.createEl('section', { cls: 'finance-panel finance-investment-accounts' });
  section.createEl('h2', { text: '投资账户', cls: 'finance-panel-title' });
  if (!accounts.length) section.createDiv({ text: '还没有投资账户。', cls: 'finance-panel-empty' });
  for (const account of accounts) {
    const stats = store.getInvestmentAccountSummary(account.id);
    if (!stats) continue;
    const row = section.createDiv({ cls: 'finance-investment-account-row' });
    const details = row.createDiv({ cls: 'finance-investment-account-details' });
    const heading = details.createDiv({ cls: 'finance-investment-account-heading' });
    const icon = heading.createSpan({ cls: 'finance-account-icon is-asset' });
    setIcon(icon, 'trending-up');
    heading.createSpan({ text: account.name, cls: 'finance-account-name' });
    details.createDiv({ text: store.getAccountCategoryLabel(account), cls: 'finance-account-category' });
    details.createDiv({ text: `最近更新：${store.getLatestInvestmentValuationDate(account.id) ?? '暂无'}`, cls: 'finance-investment-account-return' });
    const value = row.createDiv({ cls: 'finance-investment-account-value' });
    value.createDiv({ text: formatCny(stats.marketValue), cls: 'finance-investment-account-market' });
    value.createDiv({ text: `期初投资资产 ${formatCny(stats.openingBasis)} · 后续转入 ${formatCny(stats.transferredIn)} · 累计转出 ${formatCny(stats.transferredOut)}`, cls: 'finance-investment-account-return' });
    value.createDiv({ text: `累计收益 ${signedCny(stats.returnAmount)} · 累计收益率 ${rateText(stats.returnRate)}`, cls: 'finance-investment-account-return' });
    value.createEl('button', { text: '更新市值', cls: 'finance-small-action', attr: { type: 'button' } })
      .addEventListener('click', () => new InvestmentValuationModal(app, store, account).open());
    const history = store.getInvestmentValuations(account.id);
    if (history.length) {
      const snapshots = section.createDiv({ cls: 'finance-investment-history' });
      snapshots.createDiv({ text: `${account.name} · 估值记录`, cls: 'finance-investment-history-title' });
      for (const snapshot of history) {
        const item = snapshots.createDiv({ cls: 'finance-investment-snapshot' });
        item.createDiv({ text: snapshot.date, cls: 'finance-investment-snapshot-date' });
        item.createDiv({ text: `当前市值 ${formatCny(snapshot.marketValue)}`, cls: 'finance-investment-snapshot-value' });
        if (snapshot.intervalReturn !== null) item.createDiv({
          text: `本区间收益 ${signedCny(snapshot.intervalReturn)}`, cls: 'finance-investment-snapshot-return'
        });
      }
    }
  }
}

function metric(parent: HTMLElement, label: string, value: string, primary = false): void {
  const card = parent.createDiv({ cls: `finance-investments-metric${primary ? ' is-primary' : ''}` });
  card.createDiv({ text: label, cls: 'finance-investments-metric-label' });
  card.createDiv({ text: value, cls: 'finance-investments-metric-value' });
}

function signedCny(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatCny(value)}`;
}

function rateText(rate: number | null): string {
  return rate === null ? '--' : `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;
}
