import { Plugin } from 'obsidian';
import { FinanceStore } from './store';
import { FINANCE_VIEW_TYPE, FinanceView, type FinancePage } from './views/FinanceView';
import { TransactionModal } from './modals/TransactionModal';
import { GoalModal } from './components/PlansPage';
import { ShoppingItemModal } from './components/ShoppingWishlist';
import { ReceivableCollectionPickerModal, ReceivableModal } from './modals/ReceivableModals';

export default class FinancePlugin extends Plugin {
  private store!: FinanceStore;

  async onload(): Promise<void> {
    this.store = new FinanceStore(this);
    await this.store.load();

    this.registerView(FINANCE_VIEW_TYPE, leaf => new FinanceView(leaf, this.store));
    this.addRibbonIcon('wallet', '打开 Finance', () => { void this.activateView(); });
    this.addCommand({
      id: 'finance-add-transaction',
      name: '记一笔',
      callback: () => new TransactionModal(this.app, this.store).open()
    });
    this.addCommand({
      id: 'finance-add-receivable', name: '记录代垫',
      callback: () => new ReceivableModal(this.app, this.store).open()
    });
    this.addCommand({
      id: 'finance-collect-receivable', name: '收回垫款',
      callback: () => new ReceivableCollectionPickerModal(this.app, this.store).open()
    });
    this.addCommand({
      id: 'finance-open-overview', name: '打开总览', callback: () => { void this.activateView('overview'); }
    });
    this.addCommand({
      id: 'finance-open-transactions', name: '打开流水', callback: () => { void this.activateView('transactions'); }
    });
    this.addCommand({
      id: 'finance-open-accounts', name: '打开账户', callback: () => { void this.activateView('accounts'); }
    });
    this.addCommand({
      id: 'finance-open-settings', name: '打开设置', callback: () => { void this.activateView('settings'); }
    });
    this.addCommand({
      id: 'finance-open-plans', name: '打开计划', callback: () => { void this.activateView('plans'); }
    });
    this.addCommand({
      id: 'finance-create-goal', name: '新建储蓄目标', callback: () => new GoalModal(this.app, this.store).open()
    });
    this.addCommand({
      id: 'finance-add-shopping-item', name: '添加想买', callback: () => new ShoppingItemModal(this.app, this.store).open()
    });
    this.addCommand({
      id: 'finance-open-shopping-list', name: '打开想买清单', callback: () => { void this.activateView('plans', 'shopping'); }
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(FINANCE_VIEW_TYPE);
  }

  private async activateView(page: FinancePage = 'overview', plansTab?: 'budget' | 'goals' | 'shopping'): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(FINANCE_VIEW_TYPE)[0];
    if (existing) {
      if (existing.view instanceof FinanceView) {
        if (plansTab) existing.view.setPlansTab(plansTab);
        else existing.view.setPage(page);
      }
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: FINANCE_VIEW_TYPE, active: true });
    if (leaf.view instanceof FinanceView) {
      if (plansTab) leaf.view.setPlansTab(plansTab);
      else leaf.view.setPage(page);
    }
    await this.app.workspace.revealLeaf(leaf);
  }
}
