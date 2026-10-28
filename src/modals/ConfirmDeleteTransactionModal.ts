import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Transaction } from '../types';
import { formatCny } from '../utils/currency';

export class ConfirmDeleteTransactionModal extends Modal {
  private deleting = false;

  constructor(
    app: App,
    private readonly store: FinanceStore,
    private readonly transaction: Transaction
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('删除流水');
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: `确定删除 ${this.transaction.date} 的“${this.store.getTransactionCategoryLabel(this.transaction)}”${formatCny(this.transaction.amount)}吗？此操作无法撤销。`
    });
    new Setting(this.contentEl)
      .setClass('finance-modal-actions')
      .addButton(button => button
        .setButtonText('取消')
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText('删除')
        .setWarning()
        .onClick(() => { void this.delete(); }));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async delete(): Promise<void> {
    if (this.deleting) return;
    this.deleting = true;
    try {
      const restoredShoppingItem = await this.store.deleteTransaction(this.transaction.id);
      this.close();
      if (restoredShoppingItem) new Notice('关联购买流水已删除，商品已恢复为准备购买。');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '删除流水失败。');
    } finally {
      this.deleting = false;
    }
  }
}
