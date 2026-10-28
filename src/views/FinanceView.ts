import { ItemView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { renderAccountSections } from '../components/AccountSections';
import { renderDashboard } from '../components/Dashboard';
import { renderSettingsPage } from '../components/SettingsPage';
import { renderPlansPage, type PlanMonth, type PlansTab } from '../components/PlansPage';
import type { ShoppingListFilter } from '../components/ShoppingWishlist';
import { renderTransactionsPage, type TransactionFilter } from '../components/TransactionsPage';
import { renderReceivablesPage, type ReceivableFilter } from '../components/ReceivablesPage';
import { renderInvestmentsPage } from '../components/InvestmentsPage';
import { renderTaxPage } from '../components/TaxPage';
import { AccountModal } from '../modals/AccountModal';
import { TransactionModal } from '../modals/TransactionModal';
import { ReceivableModal } from '../modals/ReceivableModals';
import type { FinanceStore } from '../store';
import type { DateRange, PeriodMode } from '../types';
import { getDateRange, isValidDateRange, todayLocalDate } from '../utils/date';

export const FINANCE_VIEW_TYPE = 'personal-finance-dashboard';
export type FinancePage = 'overview' | 'transactions' | 'accounts' | 'receivables' | 'investments' | 'tax' | 'plans' | 'settings';

export class FinanceView extends ItemView {
  private unsubscribe?: () => void;
  private page: FinancePage = 'overview';
  private transactionFilter: TransactionFilter = 'all';
  private periodMode: PeriodMode = 'month';
  private anchorDate = todayLocalDate();
  private customRange: DateRange = getDateRange('month', todayLocalDate());
  private plansTab: PlansTab = 'budget';
  private planMonth: PlanMonth = (() => { const [year, month] = todayLocalDate().split('-').map(Number); return { year, month }; })();
  private selectedGoalId: string | null = null;
  private shoppingFilter: ShoppingListFilter = 'active';
  private selectedExpenseParentId: string | null = null;
  private receivableFilter: ReceivableFilter = 'open';
  private receivableReturnPage: 'overview' | 'accounts' = 'overview';
  private investmentReturnPage: 'overview' | 'accounts' = 'overview';
  private taxYear = Number(todayLocalDate().slice(0, 4));

  constructor(leaf: WorkspaceLeaf, private readonly store: FinanceStore) {
    super(leaf);
    this.periodMode = store.getDashboardConfig().periodMode;
  }

  getViewType(): string {
    return FINANCE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Finance';
  }

  getIcon(): string {
    return 'wallet';
  }

  setPage(page: FinancePage): void {
    this.page = page;
    this.render();
  }

  setPlansTab(tab: PlansTab): void {
    this.page = 'plans';
    this.plansTab = tab;
    this.selectedGoalId = null;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('finance-view');
    const navigation = root.createEl('nav', { cls: 'finance-navigation' });
    navigation.setAttribute('aria-label', 'Finance 页面');
    const navigationSegment = navigation.createDiv({ cls: 'finance-navigation-segment' });
    for (const [page, label, icon] of [
      ['overview', '总览', 'layout-dashboard'], ['transactions', '流水', 'receipt-text'],
      ['accounts', '账户', 'wallet'], ['plans', '计划', 'target'], ['settings', '设置', 'settings']
    ] as const) {
      const activePage = this.page === 'receivables' ? this.receivableReturnPage
        : this.page === 'investments' ? this.investmentReturnPage : this.page === 'tax' ? 'overview' : this.page;
      const button = navigationSegment.createEl('button', {
        cls: `finance-nav-button${activePage === page ? ' is-active' : ''}`,
        attr: { type: 'button', 'aria-current': activePage === page ? 'page' : 'false' }
      });
      setIcon(button.createSpan({ cls: 'finance-nav-icon' }), icon);
      button.createSpan({ text: label, cls: 'finance-nav-label' });
      button.addEventListener('click', () => {
        this.page = page;
        this.render();
      });
    }

    const dashboard = root.createDiv({ cls: 'finance-dashboard' });

    const header = dashboard.createDiv({ cls: 'finance-header' });
    if (this.page === 'receivables' || this.page === 'investments' || this.page === 'tax') {
      header.createEl('button', { text: '‹ 返回', cls: 'finance-receivables-back', attr: { type: 'button' } })
        .addEventListener('click', () => { this.page = this.page === 'receivables' ? this.receivableReturnPage
          : this.page === 'investments' ? this.investmentReturnPage : 'overview'; this.render(); });
    }
    header.createEl('h1', {
      text: this.page === 'overview' ? 'Finance' : this.page === 'transactions' ? '流水'
        : this.page === 'accounts' ? '账户' : this.page === 'receivables' ? '待收款'
          : this.page === 'investments' ? '投资详情'
          : this.page === 'tax' ? '税务详情'
          : this.page === 'plans' ? '计划' : '设置'
    });
    if (this.page !== 'settings' && this.page !== 'plans' && this.page !== 'receivables' && this.page !== 'investments' && this.page !== 'tax') {
      const actionText = this.page === 'accounts' ? '+ 添加账户' : '+ 记一笔';
      const action = header.createEl('button', {
        text: actionText,
        cls: 'mod-cta finance-primary-action',
        attr: { type: 'button' }
      });
      action.addEventListener('click', () => {
        if (this.page === 'accounts') new AccountModal(this.app, this.store).open();
        else new TransactionModal(this.app, this.store).open();
      });
    }

    if (this.page === 'transactions') {
      const actions = dashboard.createDiv({ cls: 'finance-transaction-page-actions' });
      actions.createEl('button', { text: '+ 代垫', cls: 'finance-small-action', attr: { type: 'button' } })
        .addEventListener('click', () => new ReceivableModal(this.app, this.store).open());
      renderTransactionsPage(dashboard, this.app, this.store, this.transactionFilter, filter => {
        this.transactionFilter = filter;
        this.render();
      });
      return;
    }

    if (this.page === 'overview') {
      renderDashboard(dashboard, this.app, this.store, this.periodMode, this.anchorDate,
        this.customRange, (mode, anchorDate, customRange) => {
          if (mode === 'custom' && !isValidDateRange(customRange)) {
            new Notice('请选择有效的开始日期和结束日期。');
            return;
          }
          this.periodMode = mode;
          this.anchorDate = anchorDate;
          this.customRange = customRange;
          void this.store.setPeriodMode(mode);
          this.render();
        }, (tab, year, month) => {
          this.page = 'plans'; this.plansTab = tab; this.selectedGoalId = null;
          if (year && month) this.planMonth = { year, month };
          this.render();
        }, () => {
          this.openReceivables('overview');
        }, () => this.openInvestments('overview'), this.selectedExpenseParentId, categoryId => {
          this.selectedExpenseParentId = categoryId;
          this.render();
        }, () => { this.taxYear = Number(todayLocalDate().slice(0, 4)); this.page = 'tax'; this.render(); });
      return;
    }

    if (this.page === 'settings') {
      renderSettingsPage(dashboard, this.app, this.store);
      return;
    }

    if (this.page === 'plans') {
      renderPlansPage(dashboard, this.app, this.store, this.plansTab,
        tab => { this.plansTab = tab; this.selectedGoalId = null; this.render(); }, this.planMonth,
        month => { this.planMonth = month; this.render(); }, this.selectedGoalId,
        id => { this.selectedGoalId = id; this.render(); }, this.shoppingFilter,
        filter => { this.shoppingFilter = filter; this.render(); });
      return;
    }

    if (this.page === 'receivables') {
      renderReceivablesPage(dashboard, this.app, this.store, this.receivableFilter, filter => {
        this.receivableFilter = filter; this.render();
      });
      return;
    }

    if (this.page === 'investments') {
      renderInvestmentsPage(dashboard, this.app, this.store);
      return;
    }

    if (this.page === 'tax') {
      renderTaxPage(dashboard, this.app, this.store, this.taxYear, year => { this.taxYear = year; this.render(); });
      return;
    }

    renderAccountSections(dashboard, this.app, this.store, () => this.openReceivables('accounts'),
      () => this.openInvestments('accounts'));
  }

  private openReceivables(from: 'overview' | 'accounts'): void {
    this.receivableReturnPage = from;
    this.receivableFilter = 'open';
    this.page = 'receivables';
    this.render();
  }

  private openInvestments(from: 'overview' | 'accounts'): void {
    this.investmentReturnPage = from;
    this.page = 'investments';
    this.render();
  }
}
