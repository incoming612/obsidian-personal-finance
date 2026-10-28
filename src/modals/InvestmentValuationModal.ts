import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Account } from '../types';
import { formatCny } from '../utils/currency';
import { todayLocalDate } from '../utils/date';

export class InvestmentValuationModal extends Modal {
  private date = todayLocalDate();
  private marketValue: string;
  private note = '';
  private saving = false;

  constructor(app: App, private readonly store: FinanceStore, private readonly account: Extract<Account, { kind: 'asset' }>) {
    super(app);
    this.marketValue = String(Math.max(0, store.getCurrentBalance(account.id)));
  }

  onOpen(): void {
    this.titleEl.setText('更新市值');
    const body = this.contentEl;
    body.empty();
    new Setting(body).setName('投资账户').addText(text => text.setValue(this.account.name).setDisabled(true));
    new Setting(body).setName('当前市值').setDesc('按账户实际市值记录一个快照，不会生成其他日期的估值。').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
      text.setPlaceholder('0.00').setValue(this.marketValue).onChange(value => { this.marketValue = value; });
    });
    new Setting(body).setName('估值日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text.setPlaceholder('可选').onChange(value => { this.note = value; }));
    new Setting(body).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('保存快照').setCta().onClick(() => void this.save()));
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    if (this.saving) return;
    const parsed = Number(this.marketValue.trim());
    if (!this.marketValue.trim() || !Number.isFinite(parsed) || parsed < 0) {
      new Notice('请输入有效的非负市值。');
      return;
    }
    this.saving = true;
    try {
      await this.store.updateInvestmentValuation({ accountId: this.account.id, date: this.date,
        marketValue: parsed, note: this.note });
      this.close();
      new Notice(`已保存 ${this.date} 的市值快照：${formatCny(parsed)}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '保存市值快照失败。');
    } finally { this.saving = false; }
  }
}
