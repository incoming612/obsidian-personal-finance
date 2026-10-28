import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { TransactionInput } from '../types';
import { todayLocalDate } from '../utils/date';
import { formatCny } from '../utils/currency';

export class RefundModal extends Modal {
  private amount = '';
  private date = todayLocalDate();
  private accountId = '';
  private note = '';
  private saving = false;

  constructor(app: App, private readonly store: FinanceStore, private readonly expenseId: string) {
    super(app);
    const expense = store.getTransaction(expenseId);
    if (expense?.type === 'expense') this.accountId = expense.accountId;
  }

  onOpen(): void {
    this.titleEl.setText('记录退款');
    const expense = this.store.getTransaction(this.expenseId);
    if (!expense || expense.type !== 'expense') {
      this.contentEl.setText('原支出不存在。'); return;
    }
    const remaining = this.store.getRemainingRefundable(expense.id);
    this.contentEl.empty(); this.contentEl.addClass('finance-transaction-modal');
    this.contentEl.createDiv({ text: `${this.store.getTransactionCategoryLabel(expense)} · ${expense.date}`, cls: 'finance-form-hint' });
    this.contentEl.createDiv({ text: `原金额 ${formatCny(expense.amount)} · 已退 ${formatCny(this.store.getRefundedAmount(expense.id))} · 剩余可退 ${formatCny(remaining)}`, cls: 'finance-form-hint' });
    new Setting(this.contentEl).setName('退款金额').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.max = String(remaining); text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
      text.setPlaceholder('0.00').onChange(value => { this.amount = value; });
    });
    new Setting(this.contentEl).setName('退款日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    const targets = [...this.store.getAccounts('asset'), ...this.store.getAccounts('allowance'),
      ...this.store.getAccounts('liability').filter(account => account.kind === 'liability' && account.liabilityRole === 'credit')];
    if (targets.length) new Setting(this.contentEl).setName('退款到账账户').addDropdown(dropdown => {
      targets.forEach(account => dropdown.addOption(account.id, account.name));
      if (!targets.some(account => account.id === this.accountId)) this.accountId = targets[0].id;
      dropdown.setValue(this.accountId).onChange(value => { this.accountId = value; });
    });
    else this.contentEl.createDiv({ text: '请先添加资产、消费额度或信用支付账户。', cls: 'finance-form-hint' });
    new Setting(this.contentEl).setName('备注').addTextArea(text => text.setPlaceholder('可选').onChange(value => { this.note = value; }));
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('保存退款').setCta().setDisabled(!targets.length || remaining <= 0)
        .onClick(() => { void this.save(); }));
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    if (this.saving) return;
    const amount = Number(this.amount);
    if (!this.amount.trim() || !Number.isFinite(amount) || amount <= 0) { new Notice('请输入有效的退款金额。'); return; }
    const input: TransactionInput = { type: 'refund', amount, date: this.date, note: this.note,
      originalTransactionId: this.expenseId, refundDestinationAccountId: this.accountId };
    this.saving = true;
    try { await this.store.addTransaction(input); this.close(); new Notice('退款已记录。'); }
    catch (error) { new Notice(error instanceof Error ? error.message : '记录退款失败。'); }
    finally { this.saving = false; }
  }
}
