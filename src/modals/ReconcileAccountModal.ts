import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Account } from '../types';
import { formatCny } from '../utils/currency';
import { todayLocalDate } from '../utils/date';

export class ReconcileAccountModal extends Modal {
  private readonly systemBalance: number;
  private actualBalance: string;
  private note = '';
  private date = todayLocalDate();
  private differenceEl?: HTMLElement;
  private saving = false;

  constructor(app: App, private readonly store: FinanceStore, private readonly account: Account) {
    super(app);
    this.systemBalance = store.getAccountBalance(account.id);
    this.actualBalance = String(Math.max(this.systemBalance, 0));
  }

  onOpen(): void {
    this.titleEl.setText('对账 / 校准余额');
    const body = this.contentEl;
    body.empty();
    const balanceLabel = this.account.kind === 'liability' ? '系统当前负债' : '系统当前余额';
    new Setting(body).setName('账户').addText(text => text.setValue(this.account.name).setDisabled(true));
    new Setting(body).setName(balanceLabel).addText(text => text.setValue(formatCny(this.systemBalance)).setDisabled(true));
    new Setting(body).setName(this.account.kind === 'liability' ? '实际剩余本金' : '实际余额')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '0.01';
        text.inputEl.inputMode = 'decimal';
        text.setValue(this.actualBalance).onChange(value => {
          this.actualBalance = value;
          this.renderDifference();
        });
      });
    this.differenceEl = body.createDiv({ cls: 'finance-reconcile-difference finance-form-hint' });
    this.renderDifference();
    new Setting(body).setName('日期').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text
      .setPlaceholder('对账调整，可选').onChange(value => { this.note = value; }));
    new Setting(body).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('确认调整').setCta().onClick(() => void this.save()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderDifference(): void {
    const value = Number(this.actualBalance);
    if (!this.differenceEl) return;
    if (!this.actualBalance.trim() || !Number.isFinite(value)) {
      this.differenceEl.setText('差额：请输入实际余额。');
      return;
    }
    const difference = Math.round((value - this.systemBalance) * 100) / 100;
    const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
    this.differenceEl.setText(`差额：${sign}${formatCny(Math.abs(difference))}`);
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const actual = Number(this.actualBalance);
    if (!this.actualBalance.trim() || !Number.isFinite(actual) || actual < 0) {
      new Notice('请输入有效的非负实际余额。');
      return;
    }
    this.saving = true;
    try {
      await this.store.reconcileAccount(this.account.id, actual, this.note, this.date);
      this.close();
      new Notice('账户对账已完成。');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '账户对账失败。');
    } finally {
      this.saving = false;
    }
  }
}
