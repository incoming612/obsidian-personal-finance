import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { SavingsGoalInput, ShoppingItem, ShoppingItemInput, ShoppingPriority, ShoppingStatus } from '../types';
import { formatCny } from '../utils/currency';
import { todayLocalDate } from '../utils/date';

export type ShoppingListFilter = 'active' | 'all' | ShoppingStatus;

const statusLabels: Record<ShoppingStatus, string> = {
  considering: '考虑中', ready: '准备购买', purchased: '已购买', abandoned: '已放弃'
};
const priorityLabels: Record<ShoppingPriority, string> = { low: '低', medium: '中', high: '高' };

export function renderShoppingWishlist(
  parent: HTMLElement, app: App, store: FinanceStore,
  filter: ShoppingListFilter, onFilter: (filter: ShoppingListFilter) => void
): void {
  const page = parent.createDiv({ cls: 'finance-shopping-page' });
  const heading = page.createDiv({ cls: 'finance-shopping-heading' });
  heading.createDiv({ text: '想买清单', cls: 'finance-panel-title' });
  actionButton(heading, '+ 添加想买', 'mod-cta', () => new ShoppingItemModal(app, store).open());

  const filters = page.createDiv({ cls: 'finance-shopping-filters' });
  const options: [ShoppingListFilter, string][] = [
    ['active', '考虑中 + 准备购买'], ['considering', '考虑中'], ['ready', '准备购买'],
    ['purchased', '已购买'], ['abandoned', '已放弃'], ['all', '全部']
  ];
  for (const [value, label] of options) {
    const control = filters.createEl('button', {
      text: label, cls: `finance-shopping-filter${filter === value ? ' is-active' : ''}`,
      attr: { type: 'button', 'aria-pressed': String(filter === value) }
    });
    control.addEventListener('click', () => onFilter(value));
  }

  let items = store.getShoppingItems();
  if (filter === 'active') items = items.filter(item => item.status === 'considering' || item.status === 'ready');
  else if (filter !== 'all') items = items.filter(item => item.status === filter);
  if (!items.length) {
    const empty = page.createDiv({ cls: 'finance-empty-state finance-shopping-empty' });
    empty.createEl('h2', { text: '还没有想买的东西' });
    empty.createEl('p', { text: '先放进清单，冷静几天再决定是否购买。' });
    actionButton(empty, '+ 添加想买', 'mod-cta', () => new ShoppingItemModal(app, store).open());
    return;
  }
  const list = page.createDiv({ cls: 'finance-shopping-list' });
  for (const item of items) renderShoppingCard(list, app, store, item);
}

export function renderShoppingDashboard(parent: HTMLElement, app: App, store: FinanceStore, openAll: () => void): void {
  const items = store.getShoppingItems().filter(item => item.status === 'ready' || item.status === 'considering').slice(0, 3);
  const summary = store.getShoppingSummary();
  const section = parent.createEl('section', { cls: 'finance-panel finance-shopping-dashboard' });
  const heading = section.createDiv({ cls: 'finance-plan-summary-heading' });
  heading.createEl('h2', { text: '想买清单', cls: 'finance-panel-title' });
  heading.createSpan({ text: `${summary.count} 件 · ${formatCny(summary.estimatedTotal)}`, cls: 'finance-shopping-summary' });
  if (!items.length) {
    section.createDiv({ text: '还没有想买的东西。', cls: 'finance-panel-empty' });
  } else {
    const list = section.createDiv({ cls: 'finance-shopping-preview-list' });
    for (const item of items) {
      const row = list.createEl('button', { cls: 'finance-shopping-preview', attr: { type: 'button' } });
      const details = row.createSpan({ cls: 'finance-shopping-preview-details' });
      details.createSpan({ text: item.name, cls: 'finance-shopping-preview-name' });
      details.createSpan({ text: coolingLabel(store, item), cls: 'finance-shopping-preview-cooling' });
      row.createSpan({ text: formatCny(item.estimatedPrice), cls: 'finance-shopping-preview-price' });
      row.addEventListener('click', () => new ShoppingItemDetailModal(app, store, item).open());
    }
  }
  const footer = section.createDiv({ cls: 'finance-shopping-dashboard-footer' });
  actionButton(footer, '查看全部', '', openAll);
}

function renderShoppingCard(parent: HTMLElement, app: App, store: FinanceStore, item: ShoppingItem): void {
  const card = parent.createDiv({ cls: 'finance-shopping-card' });
  const top = card.createDiv({ cls: 'finance-shopping-card-top' });
  const title = top.createEl('button', { text: item.name, cls: 'finance-shopping-name', attr: { type: 'button' } });
  title.addEventListener('click', () => new ShoppingItemDetailModal(app, store, item).open());
  const price = top.createDiv({ text: formatCny(item.estimatedPrice), cls: 'finance-shopping-price' });
  const chips = card.createDiv({ cls: 'finance-shopping-chips' });
  chips.createSpan({ text: statusLabels[item.status], cls: `finance-shopping-chip is-${item.status}` });
  chips.createSpan({ text: `优先级 ${priorityLabels[item.priority]}`, cls: `finance-shopping-chip is-priority-${item.priority}` });
  const category = item.categoryId ? store.getCategory(item.categoryId) : undefined;
  chips.createSpan({ text: category ? categoryPath(store, category.id) : '未分类', cls: 'finance-shopping-category' });
  const meta = card.createDiv({ cls: 'finance-shopping-meta' });
  meta.createSpan({ text: `加入于 ${item.addedAt}` });
  meta.createSpan({ text: `冷静期至 ${coolingEnd(store, item)}` });
  meta.createSpan({ text: coolingLabel(store, item), cls: 'finance-shopping-cooling' });
  if (item.reason) card.createDiv({ text: `想买原因：${item.reason}`, cls: 'finance-shopping-copy' });
  const affordability = store.getShoppingAffordability(item.id);
  const affordabilityText = affordability.percentage === null
    ? `可自由使用资产 ${formatCny(affordability.availableAssets)} · 暂无可计算比例`
    : `可自由使用资产 ${formatCny(affordability.availableAssets)} · 预计占 ${affordability.percentage.toFixed(1)}%`;
  card.createDiv({ text: affordabilityText, cls: 'finance-shopping-affordability' });
  if (item.categoryId) {
    const remaining = store.getShoppingBudgetRemaining(item.categoryId);
    if (remaining !== null) card.createDiv({ text: `本月${categoryPath(store, item.categoryId)}预算剩余 ${formatCny(remaining)}`,
      cls: 'finance-shopping-budget-hint' });
  }
  const actions = card.createDiv({ cls: 'finance-shopping-actions' });
  if (item.status === 'considering') {
    actionButton(actions, '准备购买', 'mod-cta', () => updateStatus(store, item, 'ready'));
    actionButton(actions, '购买', '', () => new ShoppingPurchaseModal(app, store, item).open());
    actionButton(actions, '编辑', '', () => new ShoppingItemModal(app, store, item).open());
    actionButton(actions, '转为储蓄目标', '', () => new ConvertShoppingToGoalModal(app, store, item).open());
    actionButton(actions, '放弃', '', () => updateStatus(store, item, 'abandoned'));
    deleteButton(actions, app, store, item);
  } else if (item.status === 'ready') {
    actionButton(actions, '购买', 'mod-cta', () => new ShoppingPurchaseModal(app, store, item).open());
    actionButton(actions, '继续考虑', '', () => updateStatus(store, item, 'considering'));
    actionButton(actions, '编辑', '', () => new ShoppingItemModal(app, store, item).open());
    actionButton(actions, '转为储蓄目标', '', () => new ConvertShoppingToGoalModal(app, store, item).open());
    actionButton(actions, '放弃', '', () => updateStatus(store, item, 'abandoned'));
    deleteButton(actions, app, store, item);
  } else if (item.status === 'abandoned') {
    if (item.convertedGoalId) {
      const goal = store.getGoal(item.convertedGoalId);
      actions.createSpan({ text: `已转为储蓄目标${goal ? `：${goal.name}` : ''}`, cls: 'finance-shopping-converted' });
    } else {
      actionButton(actions, '恢复考虑', '', () => updateStatus(store, item, 'considering'));
      deleteButton(actions, app, store, item);
    }
  } else {
    actionButton(actions, '查看购买信息', '', () => new ShoppingItemDetailModal(app, store, item).open());
  }
}

function deleteButton(parent: HTMLElement, app: App, store: FinanceStore, item: ShoppingItem): void {
  actionButton(parent, '删除', '', () => new ConfirmShoppingDeleteModal(app, store, item).open());
}

function updateStatus(store: FinanceStore, item: ShoppingItem, status: 'considering' | 'ready' | 'abandoned'): void {
  void store.setShoppingItemStatus(item.id, status)
    .then(() => new Notice(status === 'ready' ? '已标记为准备购买。' : status === 'abandoned' ? '已放弃此商品。' : '已恢复考虑。'))
    .catch(showError);
}

export class ShoppingItemModal extends Modal {
  private draft: { name: string; estimatedPrice: string; categoryId: string; priority: ShoppingPriority;
    coolingOffDays: number; reason: string; alternative: string; note: string; customCooling: boolean };

  constructor(app: App, private readonly store: FinanceStore, private readonly item?: ShoppingItem) {
    super(app);
    const categories = store.getCategories('expense', true);
    this.draft = {
      name: item?.name ?? '', estimatedPrice: item ? String(item.estimatedPrice) : '',
      categoryId: item?.categoryId ?? categories[0]?.id ?? '', priority: item?.priority ?? 'medium',
      coolingOffDays: item?.coolingOffDays ?? 7, reason: item?.reason ?? '', alternative: item?.alternative ?? '',
      note: item?.note ?? '', customCooling: ![0, 3, 7, 14, 30].includes(item?.coolingOffDays ?? 7)
    };
  }

  onOpen(): void { this.render(); }
  onClose(): void { this.contentEl.empty(); }

  private render(): void {
    this.titleEl.setText(this.item ? '编辑想买商品' : '添加想买');
    const body = this.contentEl; body.empty(); body.addClass('finance-shopping-modal');
    new Setting(body).setName('名称 *').addText(text => text.setPlaceholder('例如：Sony 耳机')
      .setValue(this.draft.name).onChange(value => { this.draft.name = value; }));
    new Setting(body).setName('预计价格 *').setDesc('人民币，可填写 0 或小数。').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
      text.setPlaceholder('0.00').setValue(this.draft.estimatedPrice).onChange(value => { this.draft.estimatedPrice = value; });
    });
    const categories = this.store.getCategories('expense', true);
    new Setting(body).setName('支出分类').addDropdown(dropdown => {
      dropdown.addOption('', '未分类');
      for (const category of categories) dropdown.addOption(category.id, categoryPath(this.store, category.id));
      dropdown.setValue(this.draft.categoryId).onChange(value => { this.draft.categoryId = value; });
    });
    new Setting(body).setName('优先级').addDropdown(dropdown => dropdown
      .addOption('low', '低').addOption('medium', '中').addOption('high', '高')
      .setValue(this.draft.priority).onChange(value => { this.draft.priority = value as ShoppingPriority; }));
    new Setting(body).setName('冷静期').addDropdown(dropdown => {
      for (const day of [0, 3, 7, 14, 30]) dropdown.addOption(String(day), `${day}天`);
      dropdown.addOption('custom', '自定义');
      const preset = [0, 3, 7, 14, 30].includes(this.draft.coolingOffDays) ? String(this.draft.coolingOffDays) : 'custom';
      dropdown.setValue(preset).onChange(value => {
        this.draft.customCooling = value === 'custom';
        if (value !== 'custom') this.draft.coolingOffDays = Number(value);
        this.render();
      });
    });
    if (this.draft.customCooling) new Setting(body).setName('自定义天数').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.max = '365'; text.inputEl.step = '1';
      text.setValue(String(this.draft.coolingOffDays)).onChange(value => {
        this.draft.coolingOffDays = value.trim() === '' ? Number.NaN : Number(value);
      });
    });
    new Setting(body).setName('为什么想买').addTextArea(text => text.setPlaceholder('可选')
      .setValue(this.draft.reason).onChange(value => { this.draft.reason = value; }));
    new Setting(body).setName('替代方案').addTextArea(text => text.setPlaceholder('可选')
      .setValue(this.draft.alternative).onChange(value => { this.draft.alternative = value; }));
    new Setting(body).setName('备注').addTextArea(text => text.setPlaceholder('可选')
      .setValue(this.draft.note).onChange(value => { this.draft.note = value; }));
    modalActions(body, '保存', () => this.save(), () => this.close());
  }

  private async save(): Promise<void> {
    const name = this.draft.name.trim();
    if (!name) { new Notice('请输入商品名称。'); return; }
    const rawPrice = this.draft.estimatedPrice.trim();
    const estimatedPrice = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(estimatedPrice) || estimatedPrice < 0) {
      new Notice('请输入有效的预计价格。'); return;
    }
    const input: ShoppingItemInput = { name, estimatedPrice, categoryId: this.draft.categoryId || null,
      priority: this.draft.priority, coolingOffDays: this.draft.coolingOffDays,
      reason: this.draft.reason, alternative: this.draft.alternative, note: this.draft.note };
    try {
      if (this.item) await this.store.updateShoppingItem(this.item.id, input);
      else await this.store.addShoppingItem(input);
      this.close(); new Notice(this.item ? '想买商品已更新。' : '已加入想买清单。');
    } catch (error) { showError(error); }
  }
}

class ShoppingPurchaseModal extends Modal {
  private actualPrice: string;
  private accountId: string;
  private categoryId: string;
  private date = todayLocalDate();
  private note: string;

  constructor(app: App, private readonly store: FinanceStore, private readonly item: ShoppingItem) {
    super(app);
    this.actualPrice = String(item.estimatedPrice);
    this.accountId = [...store.getAccounts('asset'), ...store.getAccounts('allowance')][0]?.id ?? '';
    this.categoryId = item.categoryId ?? store.getCategories('expense', true)[0]?.id ?? '';
    this.note = `购买：${item.name}`;
  }

  onOpen(): void {
    this.titleEl.setText('确认购买'); const body = this.contentEl; body.empty();
    body.createDiv({ text: this.item.name, cls: 'finance-modal-context' });
    new Setting(body).setName('实际价格').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
      text.setValue(this.actualPrice).onChange(value => { this.actualPrice = value; });
    });
    const accounts = [...this.store.getAccounts('asset'), ...this.store.getAccounts('allowance')];
    new Setting(body).setName('支付账户').addDropdown(dropdown => {
      dropdown.addOption('', accounts.length ? '请选择账户' : '请先创建资产或消费额度账户');
      for (const account of accounts) dropdown.addOption(account.id,
        `${account.name}${account.kind === 'allowance' ? '（消费额度）' : ''}`);
      dropdown.setValue(this.accountId).onChange(value => { this.accountId = value; });
    });
    const categories = this.store.getCategories('expense', true);
    new Setting(body).setName('支出分类').addDropdown(dropdown => {
      dropdown.addOption('', '请选择分类');
      for (const category of categories) dropdown.addOption(category.id, categoryPath(this.store, category.id));
      dropdown.setValue(this.categoryId).onChange(value => { this.categoryId = value; });
    });
    new Setting(body).setName('日期').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.date).onChange(value => { this.date = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text.setValue(this.note).onChange(value => { this.note = value; }));
    modalActions(body, '确认购买', () => void this.buy(), () => this.close());
  }

  onClose(): void { this.contentEl.empty(); }

  private async buy(): Promise<void> {
    const rawPrice = this.actualPrice.trim(); const actualPrice = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(actualPrice) || actualPrice <= 0) { new Notice('请输入有效的实际价格。'); return; }
    try {
      await this.store.purchaseShoppingItem(this.item.id, { actualPrice, accountId: this.accountId,
        categoryId: this.categoryId, date: this.date, note: this.note });
      this.close(); new Notice('购买已记录为支出流水。');
    } catch (error) { showError(error); }
  }
}

class ConvertShoppingToGoalModal extends Modal {
  private name: string;
  private amount: string;
  private targetDate = '';
  private note: string;
  constructor(app: App, private readonly store: FinanceStore, private readonly item: ShoppingItem) {
    super(app); this.name = item.name; this.amount = String(item.estimatedPrice); this.note = item.note;
  }
  onOpen(): void {
    this.titleEl.setText('转为储蓄目标'); const body = this.contentEl; body.empty();
    new Setting(body).setName('目标名称').addText(text => text.setValue(this.name).onChange(value => { this.name = value; }));
    new Setting(body).setName('目标金额').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.step = '0.01';
      text.setValue(this.amount).onChange(value => { this.amount = value; });
    });
    new Setting(body).setName('目标日期（可选）').addText(text => {
      text.inputEl.type = 'date'; text.setValue(this.targetDate).onChange(value => { this.targetDate = value; });
    });
    new Setting(body).setName('备注').addTextArea(text => text.setValue(this.note).onChange(value => { this.note = value; }));
    modalActions(body, '创建目标', () => void this.convert(), () => this.close());
  }
  onClose(): void { this.contentEl.empty(); }
  private async convert(): Promise<void> {
    const input: SavingsGoalInput = { name: this.name, targetAmount: Number(this.amount),
      targetDate: this.targetDate || null, priority: 'medium', note: this.note };
    try { await this.store.convertShoppingItemToGoal(this.item.id, input); this.close(); new Notice('已创建储蓄目标，未自动分配资金。'); }
    catch (error) { showError(error); }
  }
}

class ShoppingItemDetailModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly initialItem: ShoppingItem) { super(app); }
  onOpen(): void {
    const item = this.store.getShoppingItem(this.initialItem.id) ?? this.initialItem;
    this.titleEl.setText('想买商品详情'); const body = this.contentEl; body.empty();
    detail(body, '名称', item.name); detail(body, '预计价格', formatCny(item.estimatedPrice));
    detail(body, '分类', item.categoryId ? categoryPath(this.store, item.categoryId) : '未分类');
    detail(body, '状态', statusLabels[item.status]); detail(body, '优先级', priorityLabels[item.priority]);
    detail(body, '加入日期', item.addedAt); detail(body, '冷静期', `${item.coolingOffDays} 天 · 至 ${coolingEnd(this.store, item)} · ${coolingLabel(this.store, item)}`);
    if (item.reason) detail(body, '为什么想买', item.reason);
    if (item.alternative) detail(body, '替代方案', item.alternative);
    if (item.note) detail(body, '备注', item.note);
    if (item.status === 'abandoned') detail(body, '放弃日期', item.abandonedAt ?? '未记录');
    if (item.convertedGoalId) {
      const goal = this.store.getGoal(item.convertedGoalId); detail(body, '转换结果', `已转为储蓄目标${goal ? `：${goal.name}` : ''}`);
    }
    if (item.status === 'purchased' && item.purchaseTransactionId) {
      const transaction = this.store.getTransaction(item.purchaseTransactionId);
      if (transaction?.type === 'expense') {
        detail(body, '实际购买金额', formatCny(transaction.amount)); detail(body, '购买日期', transaction.date);
        detail(body, '支付账户', this.store.getTransactionAccountLabel(transaction));
        detail(body, '关联流水', this.store.getTransactionCategoryLabel(transaction));
        if (transaction.note) detail(body, '流水备注', transaction.note);
      } else detail(body, '购买信息', '关联流水已不存在');
    }
    const actions = body.createDiv({ cls: 'finance-modal-actions' });
    actionButton(actions, '关闭', 'mod-cta', () => this.close());
  }
  onClose(): void { this.contentEl.empty(); }
}

class ConfirmShoppingDeleteModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly item: ShoppingItem) { super(app); }
  onOpen(): void {
    this.titleEl.setText('删除想买商品'); this.contentEl.empty();
    this.contentEl.createEl('p', { text: `确定永久删除“${this.item.name}”吗？此操作无法撤销。` });
    modalActions(this.contentEl, '永久删除', () => void this.remove(), () => this.close());
  }
  onClose(): void { this.contentEl.empty(); }
  private async remove(): Promise<void> {
    try { await this.store.deleteShoppingItem(this.item.id); this.close(); new Notice('商品已删除。'); }
    catch (error) { showError(error); }
  }
}

function coolingEnd(store: FinanceStore, item: ShoppingItem): string {
  return store.getShoppingCoolingOff(item.id).endDate;
}
function coolingLabel(store: FinanceStore, item: ShoppingItem): string {
  const status = store.getShoppingCoolingOff(item.id);
  return status.ended ? '冷静期已结束' : `还有 ${status.daysRemaining} 天冷静期`;
}
function categoryPath(store: FinanceStore, categoryId: string): string {
  const category = store.getCategory(categoryId);
  if (!category) return '已删除分类';
  if (!category.parentId) return category.name;
  const parent = store.getCategory(category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
function detail(parent: HTMLElement, label: string, value: string): void {
  const row = parent.createDiv({ cls: 'finance-shopping-detail-row' });
  row.createDiv({ text: label, cls: 'finance-shopping-detail-label' });
  row.createDiv({ text: value, cls: 'finance-shopping-detail-value' });
}
function actionButton(parent: HTMLElement, label: string, cls: string, action: () => void): HTMLButtonElement {
  const button = parent.createEl('button', { text: label, attr: { type: 'button' } });
  if (cls) button.addClass(cls);
  button.addEventListener('click', event => { event.stopPropagation(); action(); });
  return button;
}
function modalActions(parent: HTMLElement, saveLabel: string, save: () => void, cancel: () => void): void {
  const actions = parent.createDiv({ cls: 'finance-modal-actions' });
  actionButton(actions, '取消', '', cancel); actionButton(actions, saveLabel, 'mod-cta', save);
}
function showError(error: unknown): void {
  new Notice(error instanceof Error ? error.message : '操作失败。');
}
