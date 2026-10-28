import { Modal, Notice, Setting, setIcon, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { BudgetPlan, CategoryBudgetLimit, GoalAllocation, GoalAllocationInput, GoalStatus, SavingsGoal } from '../types';
import { formatCny } from '../utils/currency';
import { todayLocalDate } from '../utils/date';
import { renderShoppingWishlist, type ShoppingListFilter } from './ShoppingWishlist';

export type PlansTab = 'budget' | 'goals' | 'shopping';
export interface PlanMonth { year: number; month: number; }

export function renderPlansPage(
  parent: HTMLElement, app: App, store: FinanceStore, tab: PlansTab,
  onTab: (tab: PlansTab) => void, month: PlanMonth, onMonth: (month: PlanMonth) => void,
  selectedGoalId: string | null, onSelectGoal: (id: string | null) => void,
  shoppingFilter: ShoppingListFilter, onShoppingFilter: (filter: ShoppingListFilter) => void
): void {
  const tabs = parent.createDiv({ cls: 'finance-plan-tabs', attr: { role: 'tablist', 'aria-label': '计划类型' } });
  for (const [key, label] of [['budget', '预算'], ['goals', '储蓄目标'], ['shopping', '想买清单']] as const) {
    const button = tabs.createEl('button', { text: label,
      cls: `finance-plan-tab${tab === key ? ' is-active' : ''}`, attr: { type: 'button', role: 'tab', 'aria-selected': String(tab === key) } });
    button.addEventListener('click', () => onTab(key));
  }
  if (tab === 'budget') renderBudgetPage(parent, app, store, month, onMonth);
  else if (tab === 'goals') renderGoalsPage(parent, app, store, selectedGoalId, onSelectGoal);
  else renderShoppingWishlist(parent, app, store, shoppingFilter, onShoppingFilter);
}

function renderBudgetPage(parent: HTMLElement, app: App, store: FinanceStore, month: PlanMonth,
  onMonth: (month: PlanMonth) => void): void {
  const page = parent.createDiv({ cls: 'finance-plans-page' });
  const heading = page.createDiv({ cls: 'finance-budget-heading' });
  const previous = heading.createEl('button', { text: '‹', cls: 'finance-period-arrow', attr: { type: 'button', 'aria-label': '上个月' } });
  previous.addEventListener('click', () => onMonth(shiftMonth(month, -1)));
  heading.createEl('h2', { text: `${month.year}年${month.month}月`, cls: 'finance-plan-month-title' });
  const next = heading.createEl('button', { text: '›', cls: 'finance-period-arrow', attr: { type: 'button', 'aria-label': '下个月' } });
  next.addEventListener('click', () => onMonth(shiftMonth(month, 1)));
  const actions = heading.createDiv({ cls: 'finance-budget-actions' });
  const budget = store.getBudget(month.year, month.month);
  button(actions, budget ? '编辑预算' : '设置预算', 'mod-cta', () => new BudgetModal(app, store, month, budget).open());
  button(actions, '复制上月预算', '', () => {
    if (!store.getBudget(month.year, month.month)) {
      void store.copyPreviousBudget(month.year, month.month).then(result => result
        ? new Notice('已复制上月预算。') : new Notice('上月没有可复制的预算。')).catch(showError);
    } else new ConfirmActionModal(app, '覆盖本月预算？', '将用上月预算覆盖当前月预算。', async () => {
      await store.copyPreviousBudget(month.year, month.month, true);
    }).open();
  });

  const usage = store.getBudgetUsage(month.year, month.month);
  const summary = page.createEl('section', { cls: 'finance-panel finance-budget-summary' });
  summary.createEl('h3', { text: '总预算', cls: 'finance-panel-title' });
  if (usage.totalLimit === null) {
    summary.createDiv({ text: '尚未设置本月总预算', cls: 'finance-panel-empty' });
    summary.createDiv({ text: `本月已支出 ${formatCny(usage.used)}`, cls: 'finance-budget-used-only' });
  } else {
    const stats = summary.createDiv({ cls: 'finance-budget-stats' });
    stat(stats, '总预算', formatCny(usage.totalLimit)); stat(stats, '已支出', formatCny(usage.used));
    stat(stats, usage.overBudget ? '已超支' : '剩余', formatCny(usage.overBudget || usage.remaining || 0), usage.overBudget > 0);
    stat(stats, '预算使用率', `${(usage.percentage ?? 0).toFixed(1)}%`, usage.overBudget > 0);
    const track = summary.createDiv({ cls: 'finance-progress-track finance-budget-progress' });
    track.createDiv({ cls: `finance-progress-fill${usage.overBudget ? ' is-over' : ''}` })
      .style.width = `${Math.min(100, Math.max(0, usage.percentage ?? 0))}%`;
    if (usage.overBudget > 0) summary.createDiv({ text: `已超支 ${formatCny(usage.overBudget)}`, cls: 'finance-over-budget' });
  }

  const categorySection = page.createEl('section', { cls: 'finance-panel finance-category-budgets' });
  const categoryHeading = categorySection.createDiv({ cls: 'finance-plan-summary-heading' });
  categoryHeading.createEl('h3', { text: '分类预算', cls: 'finance-panel-title' });
  categoryHeading.createEl('button', { text: budget ? '管理分类预算' : '添加分类预算', cls: 'finance-link-button', attr: { type: 'button' } })
    .addEventListener('click', () => new BudgetModal(app, store, month, budget).open());
  const rows = store.getCategoryBudgetUsage(month.year, month.month);
  if (!rows.length) categorySection.createDiv({ text: '还没有分类预算。', cls: 'finance-panel-empty' });
  for (const item of rows) {
    const row = categorySection.createDiv({ cls: `finance-category-budget-row${item.parentCategoryId ? ' is-subcategory' : ''}` });
    const top = row.createDiv({ cls: 'finance-category-budget-heading' });
    top.createDiv({ text: item.categoryName, cls: 'finance-category-budget-name' });
    top.createDiv({ text: `${formatCny(item.used)} / ${formatCny(item.limit)}`, cls: 'finance-category-budget-amount' });
    top.createDiv({ text: item.overBudget ? `超支 ${formatCny(item.overBudget)}` : `剩余 ${formatCny(item.remaining)}`,
      cls: item.overBudget ? 'finance-over-budget' : 'finance-category-budget-remaining' });
    const track = row.createDiv({ cls: 'finance-progress-track' });
    track.createDiv({ cls: `finance-progress-fill${item.overBudget ? ' is-over' : ''}` })
      .style.width = `${Math.min(100, Math.max(0, item.percentage))}%`;
    row.createDiv({ text: `${item.percentage.toFixed(1)}%`, cls: 'finance-category-budget-percent' });
  }
}

function renderGoalsPage(parent: HTMLElement, app: App, store: FinanceStore,
  selectedGoalId: string | null, onSelectGoal: (id: string | null) => void): void {
  const page = parent.createDiv({ cls: 'finance-plans-page finance-goals-page' });
  if (selectedGoalId) {
    const goal = store.getGoal(selectedGoalId);
    if (goal) { renderGoalDetail(page, app, store, goal, onSelectGoal); return; }
    onSelectGoal(null);
  }
  const heading = page.createDiv({ cls: 'finance-goals-heading' });
  heading.createEl('h2', { text: '储蓄目标', cls: 'finance-panel-title' });
  button(heading, '+ 新建储蓄目标', 'mod-cta', () => new GoalModal(app, store).open());
  const filters = page.createDiv({ cls: 'finance-goal-filters', attr: { role: 'group', 'aria-label': '储蓄目标状态' } });
  const activeStatus: GoalStatus = 'active';
  for (const [status, label] of [['active', '进行中'], ['completed', '已完成'], ['cancelled', '已取消']] as const) {
    const control = filters.createEl('button', { text: `${label} (${store.getGoals(status).length})`,
      cls: `finance-goal-filter${status === activeStatus ? ' is-active' : ''}`, attr: { type: 'button' } });
    control.addEventListener('click', () => {
      filters.querySelectorAll('button').forEach(item => item.removeClass('is-active'));
      control.addClass('is-active'); renderGoalCards(list, app, store, status, onSelectGoal);
    });
  }
  const list = page.createDiv({ cls: 'finance-goal-list' });
  renderGoalCards(list, app, store, activeStatus, onSelectGoal);
}

function renderGoalCards(parent: HTMLElement, app: App, store: FinanceStore, status: GoalStatus,
  onSelectGoal: (id: string | null) => void): void {
  parent.empty();
  const goals = status === 'active' ? store.getActiveGoalsSorted() : store.getGoals(status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!goals.length) {
    const empty = parent.createDiv({ cls: 'finance-empty-state' });
    setIcon(empty.createSpan({ cls: 'finance-empty-icon' }), status === 'active' ? 'target' : 'archive');
    empty.createEl('h2', { text: status === 'active' ? '还没有储蓄目标' : '暂无记录' });
    empty.createEl('p', { text: status === 'active' ? '为想实现的事情设定目标，慢慢积累。' : '这里暂时没有储蓄目标记录。' });
    return;
  }
  for (const goal of goals) {
    const card = parent.createDiv({ cls: 'finance-panel finance-goal-card', attr: { role: 'button', tabindex: '0' } });
    card.addEventListener('click', () => onSelectGoal(goal.id));
    card.addEventListener('keydown', event => { if (event.key === 'Enter') onSelectGoal(goal.id); });
    const top = card.createDiv({ cls: 'finance-goal-card-heading' });
    top.createEl('h3', { text: goal.name, cls: 'finance-goal-name' });
    if (status !== 'active') top.createDiv({ text: status === 'completed' ? '✓ 已实现' : '已取消', cls: 'finance-goal-status' });
    const saved = store.getGoalSavedAmount(goal.id); const pct = Math.max(0, saved / goal.targetAmount * 100);
    card.createDiv({ text: `${formatCny(saved)} / ${formatCny(goal.targetAmount)} · ${pct.toFixed(1)}%`, cls: 'finance-goal-amount' });
    const track = card.createDiv({ cls: 'finance-progress-track' });
    track.createDiv({ cls: 'finance-progress-fill' }).style.width = `${Math.min(100, pct)}%`;
    if (status === 'active') {
      const detail = card.createDiv({ cls: 'finance-goal-meta' });
      detail.createSpan({ text: `还差 ${formatCny(store.getGoalRemainingAmount(goal.id))}` });
      if (goal.targetDate) detail.createSpan({ text: `目标日期 ${goal.targetDate}` });
      const suggested = store.getGoalSuggestedMonthly(goal.id);
      detail.createSpan({ text: goal.targetDate && goal.targetDate < todayLocalDate() ? '目标日期已到'
        : suggested === null ? '未设置目标日期' : `建议每月储蓄 ${formatCny(suggested)}` });
      const actions = card.createDiv({ cls: 'finance-goal-actions' });
      actionButton(actions, '+ 存一笔', () => new GoalAllocationModal(app, store, goal).show('allocate'));
      actionButton(actions, '取回', () => new GoalAllocationModal(app, store, goal).show('release'));
      actionButton(actions, '完成目标', () => new CompleteGoalModal(app, store, goal).open());
      actionButton(actions, '更多', () => new GoalActionsModal(app, store, goal).open());
    } else if (status === 'completed') {
      card.createDiv({ text: `实际花费 ${goal.actualAmount === null ? '—' : formatCny(goal.actualAmount)} · ${goal.completedAt ?? ''}`, cls: 'finance-goal-meta' });
    }
  }
}

function renderGoalDetail(parent: HTMLElement, app: App, store: FinanceStore, goal: SavingsGoal,
  onBack: (id: string | null) => void): void {
  const back = parent.createEl('button', { text: '‹ 返回储蓄目标', cls: 'finance-link-button', attr: { type: 'button' } });
  back.addEventListener('click', () => onBack(null));
  const saved = store.getGoalSavedAmount(goal.id); const remaining = store.getGoalRemainingAmount(goal.id);
  const section = parent.createEl('section', { cls: 'finance-panel finance-goal-detail' });
  section.createEl('h2', { text: goal.name, cls: 'finance-panel-title' });
  const stats = section.createDiv({ cls: 'finance-budget-stats' });
  stat(stats, '目标金额', formatCny(goal.targetAmount)); stat(stats, '已攒', formatCny(saved));
  stat(stats, '剩余', formatCny(remaining)); stat(stats, '完成率', `${Math.min(100, saved / goal.targetAmount * 100).toFixed(1)}%`);
  section.createDiv({ text: `目标日期：${goal.targetDate ?? '未设置'} · 建议每月储蓄：${store.getGoalSuggestedMonthly(goal.id) === null ? '—' : formatCny(store.getGoalSuggestedMonthly(goal.id) ?? 0)}`, cls: 'finance-goal-meta' });
  section.createEl('h3', { text: '储蓄记录', cls: 'finance-panel-title' });
  const records = store.getGoalAllocations(goal.id);
  if (!records.length) section.createDiv({ text: '还没有储蓄记录', cls: 'finance-panel-empty' });
  for (const record of records) {
    const row = section.createDiv({ cls: 'finance-goal-allocation-row' });
    row.createSpan({ text: record.date }); row.createSpan({ text: store.getAccount(record.accountId)?.name ?? '已删除账户' });
    row.createSpan({ text: record.direction === 'allocate' ? '存入' : '取回' });
    row.createSpan({ text: formatCny(record.amount), cls: record.direction === 'allocate' ? 'finance-income' : 'finance-expense' });
    row.createSpan({ text: record.note || '—', cls: 'finance-goal-allocation-note' });
    actionButton(row, '编辑', () => new GoalAllocationModal(app, store, goal, record).show(record.direction));
    actionButton(row, '删除', () => new ConfirmActionModal(app, '删除这条储蓄记录？', '储蓄目标金额与账户预留会重新计算。',
      () => store.deleteGoalAllocation(record.id)).open());
  }
}

function shiftMonth(month: PlanMonth, delta: number): PlanMonth {
  const value = new Date(month.year, month.month - 1 + delta, 1);
  return { year: value.getFullYear(), month: value.getMonth() + 1 };
}
function button(parent: HTMLElement, label: string, cls: string, run: () => void): HTMLButtonElement {
  const control = parent.createEl('button', { text: label, cls, attr: { type: 'button' } });
  control.addEventListener('click', event => { event.stopPropagation(); run(); }); return control;
}
function actionButton(parent: HTMLElement, label: string, run: () => void): void { button(parent, label, 'finance-small-action', run); }
function stat(parent: HTMLElement, label: string, value: string, warning = false): void {
  const item = parent.createDiv({ cls: 'finance-budget-stat' }); item.createDiv({ text: label, cls: 'finance-summary-label' });
  item.createDiv({ text: value, cls: `finance-summary-value${warning ? ' finance-over-budget' : ''}` });
}
function showError(error: unknown): void { new Notice(error instanceof Error ? error.message : '操作失败。'); }

class BudgetModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly month: PlanMonth, private readonly existing?: BudgetPlan) { super(app); }
  onOpen(): void { this.titleEl.setText('月度预算'); this.render(); }
  private render(): void {
    const body = this.contentEl; body.empty(); body.addClass('finance-plan-modal');
    const total = body.createEl('input', { attr: { type: 'number', min: '0', step: '0.01', placeholder: '留空表示不设置总预算' } });
    total.value = this.existing?.totalLimit === null || this.existing?.totalLimit === undefined ? '' : String(this.existing.totalLimit);
    new Setting(body).setName('月总预算').setDesc('只统计普通支出流水。').settingEl.append(total);
    body.createEl('h3', { text: '分类预算', cls: 'finance-panel-title' });
    const list = body.createDiv({ cls: 'finance-budget-edit-list' });
    const categories = this.store.getCategories('expense');
    const entries: { categoryId: string; input: HTMLInputElement; row: HTMLElement }[] = [];
    const addRow = (categoryId: string, amount: number) => {
      const category = categories.find(item => item.id === categoryId); if (!category) return;
      const row = list.createDiv({ cls: `finance-budget-edit-row${category.parentId ? ' is-subcategory' : ''}` });
      const parentName = category.parentId ? this.store.getCategory(category.parentId)?.name : undefined;
      row.createDiv({ text: parentName ? `${parentName} › ${category.name}` : category.name });
      const input = row.createEl('input', { attr: { type: 'number', min: '0', step: '0.01', 'aria-label': `${category.name}预算` } }); input.value = String(amount);
      button(row, '移除', 'finance-small-action', () => { entries.splice(entries.findIndex(item => item.row === row), 1); row.remove(); });
      entries.push({ categoryId, input, row });
    };
    (this.existing?.categoryLimits ?? []).forEach(item => addRow(item.categoryId, item.limit));
    const enabled = this.store.getCategories('expense', true);
    const selector = body.createEl('select', { cls: 'dropdown' });
    selector.createEl('option', { text: '选择支出分类…', attr: { value: '' } });
    enabled.forEach(category => {
      const parentName = category.parentId ? this.store.getCategory(category.parentId)?.name : undefined;
      selector.createEl('option', { text: parentName ? `${parentName} › ${category.name}` : category.name, attr: { value: category.id } });
    });
    button(body, '添加分类预算', 'finance-small-action', () => {
      const id = selector.value;
      if (!id || entries.some(item => item.categoryId === id)) { new Notice('请选择尚未设置预算的分类。'); return; }
      addRow(id, 0);
    });
    const actions = body.createDiv({ cls: 'finance-modal-actions' });
    button(actions, '取消', '', () => this.close());
    button(actions, '保存', 'mod-cta', () => {
      const totalLimit = total.value.trim() ? Number(total.value) : null;
      const categoryLimits: CategoryBudgetLimit[] = entries.map(item => ({ categoryId: item.categoryId, limit: Number(item.input.value) }));
      void this.store.saveBudget({ ...this.month, totalLimit, categoryLimits }).then(() => { this.close(); new Notice('预算已保存。'); }).catch(showError);
    });
  }
}

export class GoalModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly goal?: SavingsGoal) { super(app); }
  onOpen(): void { this.titleEl.setText(this.goal ? '编辑储蓄目标' : '新建储蓄目标'); this.render(); }
  private render(): void {
    const body = this.contentEl; body.empty();
    const name = textField(body, '储蓄目标名称', this.goal?.name ?? '');
    const target = textField(body, '目标金额', this.goal ? String(this.goal.targetAmount) : '', 'number'); target.step = '0.01'; target.min = '0.01';
    const date = textField(body, '目标日期（可选）', this.goal?.targetDate ?? '', 'date');
    const note = textField(body, '备注（可选）', this.goal?.note ?? '');
    let priority: 'low' | 'medium' | 'high' = this.goal?.priority ?? 'medium';
    new Setting(body).setName('优先级').addDropdown(dropdown => dropdown.addOption('high', '高').addOption('medium', '中').addOption('low', '低')
      .setValue(priority).onChange(value => { priority = value as typeof priority; }));
    modalActions(body, () => {
      void (this.goal ? this.store.updateGoal(this.goal.id, { name: name.value, targetAmount: Number(target.value),
        targetDate: date.value || null, priority, note: note.value }) : this.store.addGoal({ name: name.value,
        targetAmount: Number(target.value), targetDate: date.value || null, priority, note: note.value }))
        .then(() => { this.close(); new Notice('储蓄目标已保存。'); }).catch(showError);
    }, () => this.close());
  }
}

class GoalAllocationModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly goal: SavingsGoal,
    private readonly allocation?: GoalAllocation) { super(app); }
  show(direction: 'allocate' | 'release'): void { this.direction = direction; super.open(); }
  private direction: 'allocate' | 'release' = 'allocate';
  onOpen(): void { this.titleEl.setText(this.allocation ? '编辑储蓄记录' : this.direction === 'allocate' ? '存一笔' : '取回'); this.render(); }
  private render(): void {
    const body = this.contentEl; body.empty();
    body.createDiv({ text: `储蓄目标：${this.goal.name}`, cls: 'finance-modal-context' });
    const assets = this.store.getAccounts('asset');
    const accounts = assets.filter(account => this.direction === 'allocate'
      || account.id === this.allocation?.accountId || this.store.getGoalAccountReservedBalance(this.goal.id, account.id) > 0);
    let accountId = this.allocation?.accountId ?? accounts[0]?.id ?? '';
    const accountRow = new Setting(body).setName('来源账户').addDropdown(dropdown => {
      accounts.forEach(account => dropdown.addOption(account.id, account.name));
      dropdown.setValue(accountId).onChange(value => { accountId = value; });
    });
    const amount = textField(body, '金额', this.allocation ? String(this.allocation.amount) : '', 'number'); amount.min = '0.01'; amount.step = '0.01';
    const date = textField(body, '日期', this.allocation?.date ?? todayLocalDate(), 'date');
    const note = textField(body, '备注（可选）', this.allocation?.note ?? '');
    if (this.direction === 'allocate' && accountId) accountRow.setDesc(`当前可自由使用 ${formatCny(this.store.getAccountAvailableBalance(accountId))}。`);
    modalActions(body, () => {
      const input: GoalAllocationInput = { goalId: this.goal.id, accountId, amount: Number(amount.value), date: date.value,
        direction: this.direction, note: note.value };
      const work = this.allocation ? this.store.updateGoalAllocation(this.allocation.id, input)
        : this.direction === 'allocate' ? this.store.allocateToGoal(input) : this.store.releaseFromGoal(input);
      void work.then(() => { this.close(); new Notice('储蓄记录已保存。'); }).catch(showError);
    }, () => this.close());
  }
}

class CompleteGoalModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly goal: SavingsGoal) { super(app); }
  onOpen(): void { this.titleEl.setText('完成储蓄目标'); this.render(); }
  private render(): void {
    const body = this.contentEl; body.empty(); body.createDiv({ text: `实现「${this.goal.name}」后会新增一笔普通支出。`, cls: 'finance-modal-context' });
    const amount = textField(body, '实际花费', '', 'number'); amount.min = '0.01'; amount.step = '0.01';
    const accounts = this.store.getAccounts('asset'); let accountId = accounts[0]?.id ?? '';
    new Setting(body).setName('支付账户').addDropdown(dropdown => { accounts.forEach(account => dropdown.addOption(account.id, account.name));
      dropdown.setValue(accountId).onChange(value => { accountId = value; }); });
    const categories = this.store.getCategories('expense', true); let categoryId = categories[0]?.id ?? '';
    new Setting(body).setName('支出分类').addDropdown(dropdown => { categories.forEach(category => dropdown.addOption(category.id, category.name));
      dropdown.setValue(categoryId).onChange(value => { categoryId = value; }); });
    const date = textField(body, '日期', todayLocalDate(), 'date'); const note = textField(body, '备注（可选）', '');
    modalActions(body, () => void this.store.completeGoal(this.goal.id, Number(amount.value), accountId, categoryId, date.value, note.value)
      .then(() => { this.close(); new Notice('储蓄目标已完成，并已记入支出流水。'); }).catch(showError), () => this.close());
  }
}

class GoalActionsModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly goal: SavingsGoal) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.goal.name); const body = this.contentEl; body.empty();
    button(body, '编辑储蓄目标', '', () => { this.close(); new GoalModal(this.app, this.store, this.goal).open(); });
    button(body, '取消目标', '', () => new ConfirmActionModal(this.app, '取消这个储蓄目标？', '历史储蓄记录会保留，目标预留金额将释放。',
      () => this.store.cancelGoal(this.goal.id)).open());
    button(body, '删除储蓄目标', '', () => new ConfirmActionModal(this.app, '删除这个储蓄目标？', '仅没有储蓄记录的目标可以删除。',
      () => this.store.deleteGoal(this.goal.id)).open());
  }
}

class ConfirmActionModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly description: string, private readonly action: () => Promise<unknown>) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.heading); const body = this.contentEl; body.empty(); body.createDiv({ text: this.description });
    modalActions(body, () => void this.action().then(() => { this.close(); new Notice('操作完成。'); }).catch(showError), () => this.close(), '确认');
  }
}

function textField(parent: HTMLElement, name: string, value: string, type = 'text'): HTMLInputElement {
  const setting = new Setting(parent).setName(name);
  let input!: HTMLInputElement;
  setting.addText(text => { input = text.inputEl; input.type = type; input.value = value; });
  return input;
}
function modalActions(parent: HTMLElement, save: () => void, cancel: () => void, saveLabel = '保存'): void {
  const actions = parent.createDiv({ cls: 'finance-modal-actions' }); button(actions, '取消', '', cancel); button(actions, saveLabel, 'mod-cta', save);
}
