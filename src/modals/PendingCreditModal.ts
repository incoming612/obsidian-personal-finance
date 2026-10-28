import { Modal, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import { formatCny } from '../utils/currency';
import { AccountModal } from './AccountModal';

export class PendingCreditModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('待扣款');
    const body = this.contentEl;
    body.empty();
    body.addClass('finance-pending-credit-modal');
    body.createDiv({ text: `待扣款合计 ${formatCny(this.store.getTotalPendingCreditPayments())}`,
      cls: 'finance-pending-credit-total' });

    const accounts = this.store.getPendingCreditAccounts();
    if (!accounts.length) {
      body.createDiv({ text: '当前没有待扣款的信用支付账户。', cls: 'finance-section-empty' });
      return;
    }

    const list = body.createDiv({ cls: 'finance-pending-credit-list' });
    for (const { account, balance } of accounts) {
      const row = list.createDiv({ cls: 'finance-pending-credit-row' });
      const details = row.createDiv({ cls: 'finance-pending-credit-details' });
      details.createDiv({ text: account.name, cls: 'finance-account-name' });
      const repaymentAccount = account.defaultRepaymentAccountId
        ? this.store.getAccount(account.defaultRepaymentAccountId) : undefined;
      details.createDiv({
        text: `默认扣款账户：${repaymentAccount?.kind === 'asset' ? repaymentAccount.name : '未设置'}`,
        cls: 'finance-account-category'
      });
      row.createDiv({ text: `待扣 ${formatCny(balance)}`, cls: 'finance-pending-credit-amount' });
      const open = row.createEl('button', {
        text: '账户详情', cls: 'finance-small-action', attr: { type: 'button' }
      });
      open.addEventListener('click', () => {
        this.close();
        new AccountModal(this.app, this.store, 'liability', account).open();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
