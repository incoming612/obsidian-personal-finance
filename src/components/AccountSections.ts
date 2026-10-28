import { Menu, setIcon, type App } from 'obsidian';
import { AccountModal } from '../modals/AccountModal';
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal';
import { ReconcileAccountModal } from '../modals/ReconcileAccountModal';
import { InvestmentValuationModal } from '../modals/InvestmentValuationModal';
import type { FinanceStore } from '../store';
import type { Account, AccountKind } from '../types';
import { formatCny } from '../utils/currency';

export function renderAccountSections(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  onOpenReceivables: () => void = () => undefined,
  onOpenInvestments: () => void = () => undefined
): void {
  const overview = parent.createDiv({ cls: 'finance-wallet-overview' });
  const hero = overview.createDiv({ cls: 'finance-wallet-hero' });
  hero.createDiv({ text: '净资产', cls: 'finance-wallet-label' });
  hero.createDiv({ text: formatCny(store.getNetWorth()), cls: 'finance-wallet-net-worth' });
  const metrics = hero.createDiv({ cls: 'finance-wallet-metrics' });
  walletMetric(metrics, '总资产', formatCny(store.getTotalAssets()));
  walletMetric(metrics, '总负债', formatCny(store.getTotalLiabilities()));
  walletMetric(metrics, '可自由使用', formatCny(store.getTotalAvailableAssets()));

  renderInvestmentSummary(parent, store, onOpenInvestments);

  renderSection(parent, app, store, '资产', 'asset');
  renderAllowanceSection(parent, app, store);
  renderSection(parent, app, store, '负债', 'liability');
  renderReceivableSummary(parent, store, onOpenReceivables);
}

function renderInvestmentSummary(parent: HTMLElement, store: FinanceStore, onOpen: () => void): void {
  const summary = store.getInvestmentSummary();
  const section = parent.createEl('section', { cls: 'finance-section finance-investment-summary' });
  const heading = section.createDiv({ cls: 'finance-section-heading' });
  heading.createEl('h2', { text: '投资' });
  const metrics = section.createDiv({ cls: 'finance-investment-summary-metrics' });
  investmentMetric(metrics, '当前市值', formatCny(summary.marketValue));
  investmentMetric(metrics, '累计收益', `${summary.returnAmount >= 0 ? '+' : ''}${formatCny(summary.returnAmount)}`);
  investmentMetric(metrics, '累计收益率', summary.returnRate === null ? '--'
    : `${summary.returnRate >= 0 ? '+' : ''}${(summary.returnRate * 100).toFixed(2)}%`);
  const categories = store.getInvestmentCategorySummaries();
  if (categories.length) {
    const list = section.createDiv({ cls: 'finance-investment-summary-categories' });
    for (const category of categories) {
      list.createDiv({ text: `${category.name} · ${formatCny(category.marketValue)} · ${category.percentage.toFixed(1)}%` });
    }
  }
  section.createEl('button', { text: '查看投资详情', cls: 'finance-link-button', attr: { type: 'button' } })
    .addEventListener('click', onOpen);
}

function investmentMetric(parent: HTMLElement, label: string, value: string): void {
  const item = parent.createDiv({ cls: 'finance-investment-summary-metric' });
  item.createDiv({ text: label, cls: 'finance-investment-summary-label' });
  item.createDiv({ text: value, cls: 'finance-investment-summary-value' });
}

function renderReceivableSummary(parent: HTMLElement, store: FinanceStore, onOpen: () => void): void {
  const section = parent.createEl('section', { cls: 'finance-section finance-account-receivable-summary' });
  const button = section.createEl('button', { cls: 'finance-account-receivable-summary-button', attr: { type: 'button' } });
  const copy = button.createDiv({ cls: 'finance-account-receivable-summary-copy' });
  copy.createDiv({ text: '待收款', cls: 'finance-account-receivable-summary-title' });
  copy.createDiv({ text: `${store.getOpenReceivableCount()} 笔未完成`, cls: 'finance-account-receivable-summary-count' });
  button.createDiv({ text: formatCny(store.getTotalReceivableOutstanding()), cls: 'finance-account-receivable-summary-amount' });
  button.createDiv({ text: '查看详情 ›', cls: 'finance-account-receivable-summary-action' });
  button.addEventListener('click', onOpen);
}

function walletMetric(parent: HTMLElement, label: string, amount: string): void {
  const metric = parent.createDiv({ cls: 'finance-wallet-metric' });
  metric.createDiv({ text: label, cls: 'finance-wallet-metric-label' });
  metric.createDiv({ text: amount, cls: 'finance-wallet-metric-value' });
}

function renderAllowanceSection(parent: HTMLElement, app: App, store: FinanceStore): void {
  const accounts = store.getAccounts('allowance');
  const section = parent.createEl('section', { cls: 'finance-section finance-allowance-section' });
  const sectionHeading = section.createDiv({ cls: 'finance-section-heading' });
  sectionHeading.createEl('h2', { text: '消费额度' });
  if (!accounts.length) {
    section.createDiv({ text: '还没有消费额度账户', cls: 'finance-section-empty' });
    return;
  }
  const list = section.createDiv({ cls: 'finance-allowance-list' });
  for (const account of accounts) {
    const status = store.getAllowanceStatus(account.id);
    const card = list.createDiv({ cls: 'finance-allowance-card' });
    const heading = card.createDiv({ cls: 'finance-allowance-card-heading' });
    const accountTitle = heading.createDiv({ cls: 'finance-allowance-account-title' });
    const accountIcon = accountTitle.createSpan({ cls: 'finance-account-icon is-allowance' });
    setIcon(accountIcon, 'credit-card');
    accountTitle.createEl('button', { text: account.name, cls: 'finance-link-button', attr: { type: 'button' } })
      .addEventListener('click', () => new AccountModal(app, store, 'allowance', account).open());
    const menuButton = heading.createEl('button', { cls: 'finance-account-more clickable-icon', attr: { type: 'button', 'aria-label': `${account.name}的更多操作` } });
    setIcon(menuButton, 'more-horizontal');
    menuButton.addEventListener('click', event => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle('编辑').setIcon('pencil')
        .onClick(() => new AccountModal(app, store, 'allowance', account).open()));
      menu.addItem(item => item.setTitle('删除').setIcon('trash')
        .onClick(() => new ConfirmDeleteModal(app, store, account).open()));
      menu.showAtMouseEvent(event);
    });
    const stats = card.createDiv({ cls: 'finance-allowance-stats' });
    allowanceStat(stats, '每月额度', formatCny(status.allowanceLimit));
    allowanceStat(stats, '本期已使用', formatCny(status.used));
    allowanceStat(stats, '剩余', formatCny(status.remaining), status.remaining < 0);
    const nextReset = new Date(`${status.endDate}T00:00:00Z`);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    card.createDiv({ text: `周期 ${status.startDate} 至 ${status.endDate} · 下次重置 ${nextReset.toISOString().slice(0, 10)}`,
      cls: 'finance-allowance-cycle' });
    const track = card.createDiv({ cls: 'finance-progress-track' });
    track.createDiv({ cls: `finance-progress-fill${status.percentage > 100 ? ' is-over' : ''}` })
      .style.width = `${Math.min(100, Math.max(0, status.percentage))}%`;
    card.createDiv({ text: `使用率 ${status.percentage.toFixed(0)}%`, cls: 'finance-allowance-cycle' });
    const history = store.getAllowanceHistory(account.id, 6).slice(1);
    if (history.length) {
      const historyList = card.createDiv({ cls: 'finance-allowance-history' });
      historyList.createEl('h3', { text: '历史额度使用' });
      history.forEach(item => historyList.createDiv({
        text: `${item.startDate.slice(0, 7)}  ${formatCny(item.used)} / ${formatCny(item.allowanceLimit)}`
      }));
    }
    if (account.note) card.createDiv({ text: account.note, cls: 'finance-allowance-note' });
  }
}

function allowanceStat(parent: HTMLElement, label: string, value: string, warning = false): void {
  const stat = parent.createDiv({ cls: 'finance-allowance-stat' });
  stat.createDiv({ text: label, cls: 'finance-allowance-stat-label' });
  stat.createDiv({ text: value, cls: `finance-allowance-stat-value${warning ? ' is-warning' : ''}` });
}

function renderSection(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  title: string,
  kind: AccountKind
): void {
  const accounts = store.getAccounts(kind);
  const section = parent.createEl('section', { cls: `finance-section finance-section-${kind}` });
  const heading = section.createDiv({ cls: 'finance-section-heading' });
  heading.createEl('h2', { text: title });

  if (accounts.length === 0) {
    section.createDiv({
      text: kind === 'asset' ? '暂无资产账户' : '暂无负债账户',
      cls: 'finance-section-empty'
    });
    return;
  }

  const list = section.createDiv({ cls: 'finance-account-list' });
  if (kind === 'asset') {
    const cashAccounts = accounts.filter(account => account.kind === 'asset' && account.accountRole === 'cash');
    if (cashAccounts.length) renderAccountGroup(list, '日常资金', cashAccounts, app, store, kind);
    const investmentAccounts = accounts.filter(account => account.kind === 'asset' && account.accountRole === 'investment');
    const investmentRoots = store.getCategories('investment').filter(category => category.parentId === null);
    for (const root of investmentRoots) {
      const members = investmentAccounts.filter(account => {
        if (account.kind !== 'asset' || !account.investmentCategoryId) return false;
        const classification = store.getCategory(account.investmentCategoryId);
        return classification?.id === root.id || classification?.parentId === root.id;
      });
      if (members.length) renderAccountGroup(list, root.name, members, app, store, kind);
    }
    return;
  }
  renderAccountGroup(list, '', accounts, app, store, kind);
}

function renderAccountGroup(
  parent: HTMLElement, title: string, accounts: ReturnType<FinanceStore['getAccounts']>,
  app: App, store: FinanceStore, kind: AccountKind
): void {
  const group = title ? parent.createDiv({ cls: 'finance-account-group' }) : parent;
  if (title) group.createEl('h3', { text: title, cls: 'finance-account-group-title' });
  for (const account of accounts) {
    const row = group.createDiv({ cls: 'finance-account-row' });
    const open = row.createEl('button', {
      cls: 'finance-account-open',
      attr: { type: 'button', 'aria-label': `编辑${account.name}` }
    });
    const accountIcon = open.createSpan({ cls: `finance-account-icon is-${kind}` });
    setIcon(accountIcon, kind === 'asset' ? 'wallet' : 'landmark');
    const details = open.createSpan({ cls: 'finance-account-details' });
    details.createSpan({ text: account.name, cls: 'finance-account-name' });
    details.createSpan({ text: store.getAccountCategoryLabel(account), cls: 'finance-account-category' });
    if (account.kind === 'liability' && account.liabilityRole === 'credit') {
      details.createSpan({ text: '信用支付 / 待扣款', cls: 'finance-account-role-badge' });
    }
    const currentBalance = store.getCurrentBalance(account.id);
    const balanceBlock = open.createSpan({ cls: 'finance-account-balance-block' });
    const amount = balanceBlock.createSpan({
      text: formatCny(currentBalance),
      cls: 'finance-account-balance'
    });
    if (kind === 'asset' && currentBalance < 0) {
      amount.addClass('finance-account-balance-warning');
      balanceBlock.createSpan({ text: '余额不足', cls: 'finance-account-warning' });
    }
    if (kind === 'asset') {
      const reserved = store.getAccountReservedBalance(account.id);
      if (reserved > 0) {
        balanceBlock.createSpan({ text: `目标预留 ${formatCny(reserved)}`, cls: 'finance-account-reserved' });
        balanceBlock.createSpan({ text: `可自由使用 ${formatCny(store.getAccountAvailableBalance(account.id))}`, cls: 'finance-account-available' });
      }
      if (store.getAccountAvailableBalance(account.id) < 0) {
        balanceBlock.createSpan({ text: '预留资金超过当前账户余额', cls: 'finance-account-warning' });
      }
    }
    const isInvestment = account.kind === 'asset' && account.accountRole === 'investment';
    const lastUpdate = isInvestment ? store.getLatestInvestmentValuationDate(account.id) : account.lastReconciledAt;
    if (isInvestment) balanceBlock.createSpan({
      text: `最近更新：${lastUpdate ?? '暂无'}`, cls: 'finance-account-reconciliation-date'
    });
    else balanceBlock.createSpan({
      text: account.lastReconciledAt ? `最后对账：${account.lastReconciledAt}` : '尚未对账',
      cls: 'finance-account-reconciliation-date'
    });
    open.addEventListener('click', () => new AccountModal(app, store, kind, account).open());

    const more = row.createEl('button', {
      cls: 'finance-account-more clickable-icon',
      attr: { type: 'button', 'aria-label': `${account.name}的更多操作` }
    });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', event => {
      const menu = new Menu();
      menu.addItem(item => item
        .setTitle(isInvestment ? '更新市值' : '对账 / 校准余额')
        .setIcon(isInvestment ? 'trending-up' : 'scale')
        .onClick(() => isInvestment
          ? new InvestmentValuationModal(app, store, account as Extract<Account, { kind: 'asset' }>).open()
          : new ReconcileAccountModal(app, store, account).open()));
      menu.addItem(item => item
        .setTitle('编辑')
        .setIcon('pencil')
        .onClick(() => new AccountModal(app, store, kind, account).open()));
      menu.addItem(item => item
        .setTitle('删除')
        .setIcon('trash')
        .onClick(() => new ConfirmDeleteModal(app, store, account).open()));
      menu.showAtMouseEvent(event);
    });
  }
}
