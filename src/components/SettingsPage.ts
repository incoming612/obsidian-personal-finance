import { Modal, Notice, Setting, TFolder, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import {
  CATEGORY_SCOPE_LABELS, CATEGORY_SCOPES, type CategoryDefinition,
  type CategoryScope, type DashboardModule, type DashboardVisibleModule
} from '../types';
import { formatLocalDate } from '../utils/date';
import { buildAccountsCsv, buildTransactionsCsv } from '../utils/export';

const MODULE_LABELS: Record<DashboardModule, string> = {
  financialStatus: '当前财务状态', monthlyOverview: '收支概览',
  monthlyAnalysis: '时间分析（日历 / 年度视图）', spending: '钱花在哪里',
  budget: '本月预算', goals: '我的储蓄目标', shopping: '想买清单',
  assets: '资产分布', liabilities: '负债', allowances: '消费额度', tax: '税务'
};
const VISIBLE_LABELS: Record<DashboardVisibleModule, string> = {
  financialStatus: '当前财务状态', monthlyOverview: '收支概览',
  calendar: '时间分析（日历 / 年度视图）', spending: '钱花在哪里', budget: '本月预算', goals: '我的储蓄目标', shopping: '想买清单', assets: '资产分布', liabilities: '负债', allowances: '消费额度', tax: '税务'
};

export function renderSettingsPage(parent: HTMLElement, app: App, store: FinanceStore): void {
  const page = parent.createDiv({ cls: 'finance-settings-page' });
  renderCategoryManagement(page, app, store);
  renderDashboardSettings(page, store);
  renderShortcuts(page);
  renderDataManagement(page, app, store);
  renderOtherSettings(page, store);
}

function settingsSection(parent: HTMLElement, title: string, description?: string): HTMLElement {
  const section = parent.createEl('section', { cls: 'finance-settings-section' });
  section.createEl('h2', { text: title, cls: 'finance-settings-title' });
  if (description) section.createEl('p', { text: description, cls: 'finance-settings-description' });
  return section;
}

function renderCategoryManagement(parent: HTMLElement, app: App, store: FinanceStore): void {
  const section = settingsSection(parent, '分类管理', '已使用的分类可停用，历史记录会继续保留并显示分类的新名称。');
  for (const scope of CATEGORY_SCOPES) {
    const group = section.createDiv({ cls: 'finance-category-settings-group' });
    const heading = group.createDiv({ cls: 'finance-category-settings-heading' });
    heading.createEl('h3', { text: CATEGORY_SCOPE_LABELS[scope] });
    heading.createEl('button', {
      text: '+ 添加分类', cls: 'finance-section-add', attr: { type: 'button' }
    }).addEventListener('click', () => new CategoryEditorModal(app, store, scope).open());
    const categories = store.getCategories(scope);
    if (categories.length === 0) {
      group.createDiv({ text: '暂无分类', cls: 'finance-section-empty' });
      continue;
    }
    const list = group.createDiv({ cls: 'finance-category-settings-list' });
    if (scope === 'expense' || scope === 'income' || scope === 'investment') {
      const roots = categories.filter(category => category.parentId === null);
      roots.forEach((category, index) => {
        renderCategoryRow(list, app, store, category, index > 0, index < roots.length - 1,
          () => new CategoryEditorModal(app, store, scope, undefined, category.id).open());
        const children = store.getCategoryChildren(category.id);
        const childList = list.createDiv({ cls: 'finance-category-children' });
        children.forEach((child, childIndex) => renderCategoryRow(childList, app, store, child,
          childIndex > 0, childIndex < children.length - 1));
      });
    } else {
      categories.forEach((category, index) => renderCategoryRow(list, app, store, category,
        index > 0, index < categories.length - 1));
    }
  }
}

function renderCategoryRow(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  category: CategoryDefinition,
  canMoveUp: boolean,
  canMoveDown: boolean,
  addChild?: () => void
): void {
  const row = parent.createDiv({ cls: `finance-category-settings-row${category.enabled ? '' : ' is-disabled'}${category.parentId ? ' is-subcategory' : ''}` });
  const label = row.createDiv({ cls: 'finance-category-settings-label' });
  label.createDiv({ text: category.name, cls: 'finance-category-settings-name' });
  label.createDiv({ text: category.enabled ? '启用' : '已停用', cls: 'finance-category-settings-state' });
  const controls = row.createDiv({ cls: 'finance-category-settings-controls' });
  const enable = controls.createEl('input', { attr: { type: 'checkbox', 'aria-label': `启用${category.name}` } });
  enable.checked = category.enabled;
  enable.addEventListener('change', () => void store.setCategoryEnabled(category.id, enable.checked));
  addSmallButton(controls, '↑', `上移${category.name}`, canMoveUp, () => void store.moveCategory(category.id, -1));
  addSmallButton(controls, '↓', `下移${category.name}`, canMoveDown, () => void store.moveCategory(category.id, 1));
  addSmallButton(controls, '编辑', `编辑${category.name}`, true,
    () => new CategoryEditorModal(app, store, category.scope, category).open());
  if (addChild) addSmallButton(controls, '+ 子分类', `为${category.name}添加子分类`, category.enabled, addChild);
  addSmallButton(controls, '删除', `删除${category.name}`, true,
    () => new ConfirmDeleteCategoryModal(app, store, category).open(), true);
}

function addSmallButton(
  parent: HTMLElement,
  text: string,
  label: string,
  enabled: boolean,
  callback: () => void,
  danger = false
): void {
  const button = parent.createEl('button', {
    text, cls: `finance-settings-small-button${danger ? ' is-danger' : ''}`,
      attr: { type: 'button', 'aria-label': label }
  });
  button.disabled = !enabled;
  button.addEventListener('click', callback);
}

function renderDashboardSettings(parent: HTMLElement, store: FinanceStore): void {
  const section = settingsSection(parent, 'Dashboard 设置', '控制总览模块的显示与大区块顺序。');
  const config = store.getDashboardConfig();
  const visible = section.createDiv({ cls: 'finance-dashboard-visibility-settings' });
  for (const module of ['financialStatus', 'monthlyOverview', 'calendar', 'spending', 'budget', 'goals', 'assets', 'liabilities', 'allowances', 'tax'] as const) {
    new Setting(visible)
      .setName(VISIBLE_LABELS[module])
      .addToggle(toggle => toggle
        .setValue(config.visibleModules.includes(module))
        .onChange(value => { void store.setDashboardModuleVisible(module, value); }));
  }

  const orderHeading = section.createEl('h3', { text: '模块顺序', cls: 'finance-settings-subtitle' });
  orderHeading.setAttribute('aria-label', 'Dashboard 模块顺序');
  const orderList = section.createDiv({ cls: 'finance-dashboard-order-list' });
  config.moduleOrder.forEach((module, index) => {
    const row = orderList.createDiv({ cls: 'finance-dashboard-order-row' });
    row.createDiv({ text: `${index + 1}. ${MODULE_LABELS[module]}` });
    const controls = row.createDiv({ cls: 'finance-category-settings-controls' });
    addSmallButton(controls, '↑', `上移${MODULE_LABELS[module]}`, index > 0,
      () => void store.moveDashboardModule(module, -1));
    addSmallButton(controls, '↓', `下移${MODULE_LABELS[module]}`, index < config.moduleOrder.length - 1,
      () => void store.moveDashboardModule(module, 1));
  });
}

function renderShortcuts(parent: HTMLElement): void {
  const section = settingsSection(parent, '快捷操作', '快捷键可在 Obsidian → 设置 → 快捷键中为 Finance 命令绑定。');
  const commands = section.createDiv({ cls: 'finance-shortcut-list' });
  for (const command of ['Finance: 记一笔', 'Finance: 打开总览', 'Finance: 打开流水', 'Finance: 打开账户', 'Finance: 打开计划', 'Finance: 新建储蓄目标', 'Finance: 添加想买', 'Finance: 打开想买清单', 'Finance: 打开设置']) {
    commands.createDiv({ text: command, cls: 'finance-shortcut-row' });
  }
}

function renderOtherSettings(parent: HTMLElement, store: FinanceStore): void {
  const section = settingsSection(parent, '其他', '货币换算暂未启用。');
  new Setting(section)
    .setName('货币')
    .setDesc('当前支持人民币 CNY。')
    .addDropdown(dropdown => dropdown.addOption('CNY', '人民币 CNY / ¥')
      .setValue(store.getUIConfig().currency)
      .setDisabled(true));
}

function renderDataManagement(parent: HTMLElement, app: App, store: FinanceStore): void {
  const section = settingsSection(parent, '数据管理', '完整备份和导出文件保存在当前 Vault 的 Finance 文件夹中。');
  const actions = section.createDiv({ cls: 'finance-data-actions' });
  button(actions, '导出完整备份', () => void exportBackup(app, store));
  const picker = actions.createEl('input', {
    attr: { type: 'file', accept: '.json,application/json', 'aria-label': '选择 Finance JSON 备份' }
  });
  picker.addClass('finance-backup-file-input');
  button(actions, '从备份恢复', () => picker.click());
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) void prepareRestore(app, store, file);
  });
  button(actions, '导出流水 CSV', () => void exportTransactionsCsv(app, store));
  button(actions, '导出账户 CSV', () => void exportAccountsCsv(app, store));
}

async function prepareRestore(app: App, store: FinanceStore, file: File): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(await file.text());
    store.validateBackupPayload(payload);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : '无法读取备份文件；当前数据未更改。');
    return;
  }
  new ConfirmRestoreModal(app, store, payload).open();
}

async function exportBackup(app: App, store: FinanceStore, prefix = 'finance-backup'): Promise<string> {
  const folder = 'Finance/Backups';
  await ensureFolder(app, 'Finance');
  await ensureFolder(app, folder);
  const path = uniquePath(app, `${folder}/${prefix}-${timestampLocal()}.json`);
  await app.vault.create(path, JSON.stringify(store.getBackupPayload(), null, 2));
  return path;
}

async function exportTransactionsCsv(app: App, store: FinanceStore): Promise<void> {
  try {
    const path = await writeCsv(app, 'transactions', buildTransactionsCsv(store));
    new Notice(`流水 CSV 已导出：${path}`);
  } catch (error) { new Notice(error instanceof Error ? error.message : '流水 CSV 导出失败。'); }
}

async function exportAccountsCsv(app: App, store: FinanceStore): Promise<void> {
  try {
    const path = await writeCsv(app, 'accounts', buildAccountsCsv(store));
    new Notice(`账户 CSV 已导出：${path}`);
  } catch (error) { new Notice(error instanceof Error ? error.message : '账户 CSV 导出失败。'); }
}

async function writeCsv(app: App, name: string, csv: string): Promise<string> {
  const folder = 'Finance/Exports';
  await ensureFolder(app, 'Finance');
  await ensureFolder(app, folder);
  const path = uniquePath(app, `${folder}/${name}-${timestampLocal()}.csv`);
  await app.vault.create(path, csv);
  return path;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;
  if (existing) throw new Error(`Vault 路径“${path}”已被文件占用。`);
  await app.vault.createFolder(path);
}

function uniquePath(app: App, desired: string): string {
  if (!app.vault.getAbstractFileByPath(desired)) return desired;
  const dot = desired.lastIndexOf('.');
  const stem = dot > desired.lastIndexOf('/') ? desired.slice(0, dot) : desired;
  const extension = dot > desired.lastIndexOf('/') ? desired.slice(dot) : '';
  for (let index = 1; index < 1000; index++) {
    const path = `${stem}-${index}${extension}`;
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
  throw new Error('无法生成唯一导出文件名。');
}

function timestampLocal(): string {
  const now = new Date();
  return `${formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate())}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

function button(parent: HTMLElement, text: string, onClick: () => void): void {
  parent.createEl('button', { text, attr: { type: 'button' } }).addEventListener('click', onClick);
}

class CategoryEditorModal extends Modal {
  private name = '';
  private categoryScopeValue: CategoryScope;

  constructor(
    app: App,
    private readonly store: FinanceStore,
    initialScope: CategoryScope,
    private readonly category?: CategoryDefinition,
    private readonly parentId: string | null = null
  ) {
    super(app);
    this.categoryScopeValue = category?.scope ?? initialScope;
    this.name = category?.name ?? '';
  }

  onOpen(): void {
    this.titleEl.setText(this.category ? '编辑分类' : this.parentId ? '添加二级分类' : '添加分类');
    const body = this.contentEl;
    body.empty();
    if (!this.category && !this.parentId) new Setting(body).setName('分类范围').addDropdown(dropdown => {
      for (const scope of CATEGORY_SCOPES) dropdown.addOption(scope, CATEGORY_SCOPE_LABELS[scope]);
      dropdown.setValue(this.categoryScopeValue);
      dropdown.onChange(value => { this.categoryScopeValue = value as CategoryScope; });
    });
    new Setting(body).setName('名称').addText(text => text
      .setPlaceholder('输入分类名称').setValue(this.name)
      .onChange(value => { this.name = value; }));
    new Setting(body).addButton(btn => btn.setButtonText('取消').onClick(() => this.close()))
      .addButton(btn => btn.setButtonText('保存').setCta().onClick(() => void this.save()));
  }

  private async save(): Promise<void> {
    try {
      if (this.category) await this.store.renameCategory(this.category.id, this.name);
      else await this.store.addCategory(this.categoryScopeValue, this.name, this.parentId);
      this.close();
    } catch (error) { new Notice(error instanceof Error ? error.message : '保存分类失败。'); }
  }
}

class ConfirmDeleteCategoryModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly category: CategoryDefinition) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText('删除分类');
    this.contentEl.createEl('p', { text: `确定删除“${this.category.name}”吗？` });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('删除').setWarning().onClick(() => void this.remove()));
  }
  private async remove(): Promise<void> {
    try { await this.store.deleteCategory(this.category.id); this.close(); }
    catch (error) { new Notice(error instanceof Error ? error.message : '删除分类失败。'); }
  }
}

class ConfirmRestoreModal extends Modal {
  constructor(app: App, private readonly store: FinanceStore, private readonly payload: unknown) { super(app); }
  onOpen(): void {
    this.titleEl.setText('恢复 Finance 备份');
    this.contentEl.createEl('p', { text: '恢复备份将替换当前 Finance 数据，是否继续？' });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('取消').onClick(() => this.close()))
      .addButton(button => button.setButtonText('先备份并恢复').setWarning().onClick(() => void this.restore()));
  }
  private async restore(): Promise<void> {
    try {
      await exportBackup(this.app, this.store, 'pre-restore');
      await this.store.restoreBackup(this.payload);
      this.close();
      new Notice('Finance 备份已恢复。');
    } catch (error) { new Notice(error instanceof Error ? error.message : '恢复失败；当前数据未更改。'); }
  }
}
