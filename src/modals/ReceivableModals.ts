import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Receivable, ReceivableInput } from '../types';
import { todayLocalDate } from '../utils/date';
import { formatCny } from '../utils/currency';

export class ReceivableModal extends Modal {
  private draft: ReceivableInput;
  private saving = false;
  constructor(app: App, private readonly store: FinanceStore, private readonly current?: Receivable) {
    super(app);
    const accounts = eligibleAccounts(store);
    const categories = store.getCategories('expense');
    this.draft = { title: current?.title ?? '', totalPaid: current?.totalPaid ?? 0,
      personalShare: current?.personalShare ?? 0, counterparty: current?.counterparty ?? '',
      paymentAccountId: current?.paymentAccountId ?? accounts[0]?.id ?? '',
      categoryId: current?.categoryId ?? categories[0]?.id ?? '', date: current?.date ?? todayLocalDate(), note: current?.note ?? '' };
  }
  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }
  private render(): void {
    this.titleEl.setText(this.current ? '编辑代垫' : '记录代垫');
    const body = this.contentEl; body.empty(); body.addClass('finance-transaction-modal');
    new Setting(body).setName('事项名称').addText(text => text.setPlaceholder('例如：旅行聚餐')
      .setValue(this.draft.title).onChange(value => { this.draft.title = value; }));
    moneyField(body, '总支付金额', this.draft.totalPaid, value => { this.draft.totalPaid = value; });
    moneyField(body, '我的部分', this.draft.personalShare, value => { this.draft.personalShare = value; });
    new Setting(body).setName('待收对象').addText(text => text.setPlaceholder('例如：小王 / 小李')
      .setValue(this.draft.counterparty).onChange(value => { this.draft.counterparty = value; }));
    select(body, '支付账户', eligibleAccounts(this.store), this.draft.paymentAccountId, value => { this.draft.paymentAccountId = value; });
    const roots = this.store.getCategories('expense').filter(item => item.parentId === null);
    const selected = this.store.getCategory(this.draft.categoryId);
    const currentRoot = selected?.parentId ? this.store.getCategory(selected.parentId) : selected;
    select(body, '支出分类', roots, currentRoot?.id ?? roots[0]?.id ?? '', value => {
      this.draft.categoryId = value; this.render();
    });
    const children = this.store.getCategoryChildren(currentRoot?.id ?? '');
    if (children.length) select(body, '二级分类（可选）', [{ id: currentRoot!.id, name: `不细分 · ${currentRoot!.name}` }, ...children],
      selected?.parentId ? selected.id : currentRoot!.id, value => { this.draft.categoryId = value; });
    new Setting(body).setName('日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.draft.date).onChange(value => { this.draft.date = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text.setPlaceholder('可选').setValue(this.draft.note)
      .onChange(value => { this.draft.note = value; }));
    const accounts = eligibleAccounts(this.store);
    const validCategories = this.store.getCategories('expense', true).length > 0;
    new Setting(body).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('保存').setCta().setDisabled(!accounts.length || !validCategories)
        .onClick(() => { void this.save(); }));
  }
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      if (this.current) await this.store.updateReceivable(this.current.id, this.draft);
      else await this.store.addReceivable(this.draft);
      this.close(); new Notice('代垫已保存。');
    } catch (error) { new Notice(error instanceof Error ? error.message : '保存代垫失败。'); }
    finally { this.saving = false; }
  }
}

export class ReceivableCollectionModal extends Modal {
  private amount = '';
  private date = todayLocalDate();
  private accountId: string;
  private note = '';
  private saving = false;
  constructor(app: App, private readonly store: FinanceStore, private readonly item: Receivable) {
    super(app); this.accountId = store.getAccounts('asset')[0]?.id ?? '';
  }
  onOpen(): void {
    this.titleEl.setText('收回代垫'); this.contentEl.empty(); this.contentEl.addClass('finance-transaction-modal');
    this.contentEl.createDiv({ text: `${this.item.title} · 当前待收 ${formatCny(this.store.getReceivableOutstanding(this.item.id))}`, cls: 'finance-form-hint' });
    new Setting(this.contentEl).setName('本次收回金额').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.max = String(this.store.getReceivableOutstanding(this.item.id)); text.inputEl.step = '0.01';
      text.setPlaceholder('0.00').onChange(value => { this.amount = value; });
    });
    select(this.contentEl, '到账资产账户', this.store.getAccounts('asset'), this.accountId, value => { this.accountId = value; });
    new Setting(this.contentEl).setName('日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(this.contentEl).setName('备注').addTextArea(text => text.setPlaceholder('可选').onChange(value => { this.note = value; }));
    const accounts = this.store.getAccounts('asset');
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('确认收回').setCta().setDisabled(!accounts.length)
        .onClick(() => { void this.save(); }));
  }
  onClose(): void { this.contentEl.empty(); }
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try { await this.store.addReceivableCollection({ receivableId: this.item.id, amount: Number(this.amount), accountId: this.accountId, date: this.date, note: this.note });
      this.close(); new Notice('收回记录已保存。');
    } catch (error) { new Notice(error instanceof Error ? error.message : '保存收回记录失败。'); }
    finally { this.saving = false; }
  }
}

export class ReceivableCollectionPickerModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore) { super(app); }
  onOpen(): void {
    this.titleEl.setText('选择待收项目'); this.contentEl.empty();
    const items = this.store.getReceivables('open').filter(item => this.store.getReceivableOutstanding(item.id) > 0);
    if (!items.length) {
      this.contentEl.createDiv({ text: '当前没有可收回的代垫。', cls: 'finance-section-empty' });
      return;
    }
    const list = this.contentEl.createDiv({ cls: 'finance-receivable-project-list' });
    for (const item of items) {
      const row = list.createEl('button', { cls: 'finance-receivable-picker-row', attr: { type: 'button' } });
      row.createSpan({ text: item.title, cls: 'finance-receivable-title' });
      row.createSpan({ text: `待收 ${formatCny(this.store.getReceivableOutstanding(item.id))}`,
        cls: 'finance-receivable-amount' });
      row.addEventListener('click', () => {
        this.close(); new ReceivableCollectionModal(this.app, this.store, item).open();
      });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ReceivableCloseModal extends Modal {
  private categoryId: string;
  private date = todayLocalDate();
  private note = '';
  private saving = false;
  constructor(app: App, private readonly store: FinanceStore, private readonly item: Receivable) {
    super(app); this.categoryId = item.categoryId;
  }
  onOpen(): void {
    const outstanding = this.store.getReceivableOutstanding(this.item.id);
    this.titleEl.setText('结束代垫'); this.contentEl.empty(); this.contentEl.addClass('finance-transaction-modal');
    new Setting(this.contentEl).setName('当前待收金额').setDesc(formatCny(outstanding));
    this.contentEl.createEl('p', { text: '结束后，这部分金额将不再作为待收款，并计入你的实际支出。原支付账户不会再次扣款。',
      cls: 'finance-form-hint' });
    const categories = this.store.getCategories('expense', true);
    const original = this.store.getCategory(this.item.categoryId);
    if (original && !original.enabled && !categories.some(item => item.id === original.id)) categories.push(original);
    select(this.contentEl, '支出分类', categories, this.categoryId, value => { this.categoryId = value; });
    new Setting(this.contentEl).setName('日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(this.contentEl).setName('备注').addTextArea(text => text.setPlaceholder('可选')
      .onChange(value => { this.note = value; }));
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('确认结束').setWarning().setDisabled(outstanding <= 0)
        .onClick(() => { void this.save(); }));
  }
  onClose(): void { this.contentEl.empty(); }
  private async save(): Promise<void> {
    if (this.saving) return; this.saving = true;
    try {
      await this.store.closeReceivable({ receivableId: this.item.id, categoryId: this.categoryId,
        date: this.date, note: this.note });
      this.close(); new Notice('代垫已结束，未收回金额已计入支出。');
    } catch (error) { new Notice(error instanceof Error ? error.message : '结束代垫失败。'); }
    finally { this.saving = false; }
  }
}

export class ReceivableDetailModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly id: string) { super(app); }
  onOpen(): void {
    const item = this.store.getReceivable(this.id);
    this.titleEl.setText(item?.title ?? '待收款'); this.contentEl.empty();
    if (!item) { this.contentEl.setText('待收款记录不存在。'); return; }
    this.contentEl.addClass('finance-shopping-detail');
    detail(this.contentEl, '状态', ({ open: '未完成', settled: '已完成', closed: '已结束', cancelled: '已取消' })[item.status]);
    detail(this.contentEl, '待收对象', item.counterparty || '未填写'); detail(this.contentEl, '日期', item.date);
    detail(this.contentEl, '总支付', formatCny(item.totalPaid)); detail(this.contentEl, '我的部分', formatCny(item.personalShare));
    detail(this.contentEl, '代垫金额', formatCny(item.receivableAmount)); detail(this.contentEl, '已收回', formatCny(this.store.getReceivableCollected(item.id)));
    detail(this.contentEl, '待收回', formatCny(this.store.getReceivableOutstanding(item.id)));
    detail(this.contentEl, '已核销', formatCny(item.writtenOffAmount));
    detail(this.contentEl, '支付账户', this.store.getAccount(item.paymentAccountId)?.name ?? '已删除账户');
    detail(this.contentEl, '支出分类', this.store.getCategory(item.categoryId)?.name ?? '已删除分类');
    if (item.note) detail(this.contentEl, '备注', item.note);
    const collections = this.store.getReceivableCollections(item.id);
    if (collections.length) {
      this.contentEl.createEl('h3', { text: '收回记录' });
      for (const collection of collections) {
        const row = this.contentEl.createDiv({ cls: 'finance-receivable-collection-row' });
        row.createSpan({ text: `${collection.date} · ${this.store.getAccount(collection.accountId)?.name ?? '账户'} · ${formatCny(collection.amount)}` });
        if (item.status !== 'closed') {
          const remove = row.createEl('button', { text: '撤销', attr: { type: 'button' } });
          remove.addEventListener('click', () => new ConfirmReceivableActionModal(this.app, `撤销 ${formatCny(collection.amount)} 收回记录？`,
            async () => { await this.store.deleteReceivableCollection(collection.id); this.render(); new Notice('收回记录已撤销。'); }).open());
        }
      }
    }
    if (item.status === 'closed' && item.closedAt) {
      const row = this.contentEl.createDiv({ cls: 'finance-receivable-collection-row' });
      row.createSpan({ text: `${item.closedAt} · 未收回核销 ${formatCny(item.writtenOffAmount)}` });
    }
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('关闭').onClick(() => this.close()))
      .addButton(button => button.setButtonText('编辑').setDisabled(item.status !== 'open')
        .onClick(() => { this.close(); new ReceivableModal(this.app, this.store, item).open(); }))
      .addButton(button => button.setButtonText('删除').setWarning().setDisabled(item.status === 'closed')
        .onClick(() => new ConfirmReceivableActionModal(this.app,
          `确定删除“${item.title}”代垫吗？`, async () => { await this.store.deleteReceivable(item.id); this.close(); new Notice('代垫已删除。'); }).open()))
      .addButton(button => button.setButtonText('收回').setCta()
        .setDisabled(item.status !== 'open' || this.store.getReceivableOutstanding(item.id) <= 0)
        .onClick(() => { this.close(); new ReceivableCollectionModal(this.app, this.store, item).open(); }))
      .addButton(button => button.setButtonText('结束').setWarning().setDisabled(item.status !== 'open')
        .onClick(() => { this.close(); new ReceivableCloseModal(this.app, this.store, item).open(); }));
  }
  onClose(): void { this.contentEl.empty(); }
  private render(): void { this.onOpen(); }
}

class ConfirmReceivableActionModal extends Modal {
  private busy = false;
  constructor(app: App, private readonly prompt: string, private readonly action: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText('确认操作'); this.contentEl.empty(); this.contentEl.createEl('p', { text: this.prompt });
    new Setting(this.contentEl).setClass('finance-modal-actions')
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('确认').setWarning().onClick(() => { void this.run(); }));
  }
  onClose(): void { this.contentEl.empty(); }
  private async run(): Promise<void> { if (this.busy) return; this.busy = true;
    try { await this.action(); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : '操作失败。'); }
    finally { this.busy = false; }
  }
}

function eligibleAccounts(store: FinanceStore) {
  return [...store.getAccounts('asset'), ...store.getAccounts('liability')
    .filter(account => account.kind === 'liability' && account.liabilityRole === 'credit')];
}
function moneyField(parent: HTMLElement, name: string, value: number, onChange: (value: number) => void): void {
  new Setting(parent).setName(name).addText(text => { text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01';
    text.setValue(value ? String(value) : '').onChange(raw => { onChange(raw.trim() ? Number(raw) : 0); }); });
}
function select<T extends { id: string; name: string }>(parent: HTMLElement, name: string, values: T[], value: string, onChange: (id: string) => void): void {
  new Setting(parent).setName(name).addDropdown(dropdown => { values.forEach(item => dropdown.addOption(item.id, item.name));
    if (values.some(item => item.id === value)) dropdown.setValue(value); else if (values[0]) dropdown.setValue(values[0].id);
    dropdown.onChange(onChange); });
}
function detail(parent: HTMLElement, label: string, value: string): void {
  const row = parent.createDiv({ cls: 'finance-shopping-detail-row' }); row.createDiv({ text: label, cls: 'finance-shopping-detail-label' });
  row.createDiv({ text: value, cls: 'finance-shopping-detail-value' });
}
