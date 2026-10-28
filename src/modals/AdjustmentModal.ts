import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { AdjustmentDirection, AdjustmentTarget, Transaction } from '../types';

type Adjustment = Extract<Transaction, { type: 'adjustment' }>;

export class AdjustmentModal extends Modal {
  private target: AdjustmentTarget;
  private accountId: string;
  private amount: string;
  private direction: AdjustmentDirection;
  private date: string;
  private note: string;
  private saving = false;

  constructor(app: App, private readonly store: FinanceStore, private readonly transaction: Adjustment) {
    super(app);
    this.target = transaction.adjustmentTarget;
    this.accountId = transaction.accountId;
    this.amount = String(transaction.amount);
    this.direction = transaction.direction;
    this.date = transaction.date;
    this.note = transaction.note;
  }

  onOpen(): void {
    this.titleEl.setText('编辑余额校准');
    const body = this.contentEl;
    body.empty();
    const accounts = this.store.getAccounts(this.target);
    new Setting(body).setName('校准对象').addText(text => text
      .setValue(this.target === 'asset' ? '资产余额' : '负债余额').setDisabled(true));
    new Setting(body).setName('账户').addDropdown(dropdown => {
      for (const account of accounts) dropdown.addOption(account.id, account.name);
      dropdown.setValue(this.accountId).onChange(value => { this.accountId = value; });
    });
    new Setting(body).setName('方向').addDropdown(dropdown => dropdown
      .addOption('increase', this.target === 'asset' ? '增加账户余额' : '增加负债')
      .addOption('decrease', this.target === 'asset' ? '减少账户余额' : '减少负债')
      .setValue(this.direction).onChange(value => { this.direction = value as AdjustmentDirection; }));
    new Setting(body).setName('调整金额').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.step = '0.01';
      text.inputEl.inputMode = 'decimal';
      text.setValue(this.amount).onChange(value => { this.amount = value; });
    });
    new Setting(body).setName('日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text
      .setValue(this.note).setPlaceholder('可选').onChange(value => { this.note = value; }));
    new Setting(body).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('保存').setCta().onClick(() => void this.save()));
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    if (this.saving) return;
    const amount = Number(this.amount);
    if (!this.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      new Notice('调整金额必须大于零。');
      return;
    }
    const account = this.store.getAccount(this.accountId);
    if (!account || account.kind !== this.target) {
      new Notice('请选择与校准类型一致的账户。');
      return;
    }
    this.saving = true;
    try {
      await this.store.updateTransaction(this.transaction.id, {
        type: 'adjustment', date: this.date, amount, note: this.note,
        accountId: this.accountId, adjustmentTarget: this.target, direction: this.direction
      });
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '保存余额校准失败。');
    } finally { this.saving = false; }
  }
}
