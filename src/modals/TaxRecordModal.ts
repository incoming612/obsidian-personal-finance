import { Menu, Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { TaxRecord, TaxRecordInput, TaxRecordType } from '../types';
import { todayLocalDate } from '../utils/date';

export class TaxRecordModal extends Modal {
  private type: 'refund' | 'additional_payment';
  private amount: string;
  private date: string;
  private taxYear: string;
  private accountId: string;
  private note: string;
  private saving = false;

  constructor(app: App, private readonly store: FinanceStore, type: 'refund' | 'additional_payment',
    private readonly record?: TaxRecord) {
    super(app);
    this.type = record?.type === 'refund' || record?.type === 'additional_payment' ? record.type : type;
    const cash = store.getAccounts('asset').filter(account => account.kind === 'asset' && account.accountRole === 'cash');
    this.amount = record ? String(record.amount) : '';
    this.date = record?.date ?? todayLocalDate();
    this.taxYear = String(record?.taxYear ?? Number(this.date.slice(0, 4)));
    this.accountId = record?.accountId ?? cash[0]?.id ?? '';
    this.note = record?.note ?? '';
  }

  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private render(): void {
    this.titleEl.setText(this.record ? '编辑税务记录' : this.type === 'refund' ? '记录退税' : '记录补税');
    const body = this.contentEl; body.empty(); body.addClass('finance-tax-modal');
    if (!this.record) new Setting(body).setName('类型').addDropdown(dropdown => dropdown
      .addOption('refund', '退税').addOption('additional_payment', '补税').setValue(this.type)
      .onChange(value => { this.type = value as 'refund' | 'additional_payment'; this.render(); }));
    new Setting(body).setName(this.type === 'refund' ? '退税金额 *' : '补税金额 *')
      .addText(text => { text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
        text.setPlaceholder('0.00').setValue(this.amount).onChange(value => { this.amount = value; }); });
    const assets = this.store.getAccounts('asset').filter(account => account.kind === 'asset' && account.accountRole === 'cash');
    new Setting(body).setName(this.type === 'refund' ? '到账账户 *' : '支付账户 *')
      .addDropdown(dropdown => { assets.forEach(account => dropdown.addOption(account.id, account.name));
        if (this.accountId) dropdown.setValue(this.accountId);
        dropdown.onChange(value => { this.accountId = value; }); });
    new Setting(body).setName(this.type === 'refund' ? '退税日期 *' : '补税日期 *')
      .addText(text => { text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; }); });
    new Setting(body).setName('所属税务年度 *').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '1900'; text.inputEl.max = '9999'; text.inputEl.step = '1';
      text.setValue(this.taxYear).onChange(value => { this.taxYear = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text.setPlaceholder('可选').setValue(this.note).onChange(value => { this.note = value; }));
    body.createEl('p', { text: this.type === 'refund'
      ? '退税会增加资产并冲减对应税务年度税负，不计入普通收入。'
      : '补税会减少资产并计入税务年度税负，不计入普通支出或消费预算。', cls: 'finance-form-hint' });
    new Setting(body).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('保存').setCta().setDisabled(!assets.length)
        .onClick(() => { void this.save(); }));
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const amount = Number(this.amount); const taxYear = Number(this.taxYear);
    if (!this.amount.trim() || !Number.isFinite(amount) || amount <= 0) { new Notice('请输入有效的税款金额。'); return; }
    if (!Number.isInteger(taxYear) || taxYear < 1900 || taxYear > 9999) { new Notice('请输入有效的税务年度。'); return; }
    if (!this.accountId) { new Notice('请选择资产账户。'); return; }
    const input: TaxRecordInput = { type: this.type, amount, date: this.date, taxYear,
      accountId: this.accountId, note: this.note };
    this.saving = true;
    try {
      if (this.record) await this.store.updateTaxRecord(this.record.id, input);
      else await this.store.addTaxRecord(input);
      this.close();
    } catch (error) { new Notice(error instanceof Error ? error.message : '保存税务记录失败。'); }
    finally { this.saving = false; }
  }
}

export class ConfirmDeleteTaxRecordModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly record: TaxRecord) { super(app); }
  onOpen(): void {
    this.titleEl.setText('删除税务记录');
    this.contentEl.createEl('p', { text: `确定删除${this.record.type === 'refund' ? '退税' : '补税'} ${this.record.amount.toFixed(2)} 元？账户余额和税务统计将重新计算。` });
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('删除').setWarning().onClick(() => {
        void this.store.deleteTaxRecord(this.record.id).then(() => this.close()).catch(error =>
          new Notice(error instanceof Error ? error.message : '删除税务记录失败。'));
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export function showTaxRecordMenu(app: App, store: FinanceStore, record: TaxRecord, event: MouseEvent): void {
  const menu = new Menu();
  menu.addItem(item => item.setTitle('编辑').setIcon('pencil').onClick(() => new TaxRecordModal(app, store, record.type as 'refund' | 'additional_payment', record).open()));
  menu.addItem(item => item.setTitle('删除').setIcon('trash').onClick(() => new ConfirmDeleteTaxRecordModal(app, store, record).open()));
  menu.showAtMouseEvent(event);
}
