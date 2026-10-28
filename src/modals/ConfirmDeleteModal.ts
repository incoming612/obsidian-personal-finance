import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Account } from '../types';

export class ConfirmDeleteModal extends Modal {
  private deleting = false;

  constructor(
    app: App,
    private readonly store: FinanceStore,
    private readonly account: Account
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('删除账户');
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      text: `确定删除“${this.account.name}”吗？此操作无法撤销。`
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
      await this.store.deleteAccount(this.account.id);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '删除账户失败。');
    } finally {
      this.deleting = false;
    }
  }
}
