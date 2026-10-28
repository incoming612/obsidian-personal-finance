import type { App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { ReceivableStatus } from '../types';
import { formatCny } from '../utils/currency';
import { ReceivableCloseModal, ReceivableCollectionModal, ReceivableCollectionPickerModal,
  ReceivableDetailModal, ReceivableModal } from '../modals/ReceivableModals';

export type ReceivableFilter = ReceivableStatus | 'all' | 'history';

export function renderReceivablesPage(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  filter: ReceivableFilter,
  onFilterChange: (filter: ReceivableFilter) => void
): void {
  const section = parent.createEl('section', { cls: 'finance-section finance-receivables-section' });
  const heading = section.createDiv({ cls: 'finance-section-heading' });
  const title = heading.createDiv();
  title.createEl('h2', { text: '代垫与收回' });
  title.createSpan({ text: `待收 ${formatCny(store.getTotalReceivableOutstanding())}`, cls: 'finance-receivable-total' });
  const actions = heading.createDiv({ cls: 'finance-receivable-page-actions' });
  actions.createEl('button', { text: '收回垫款', cls: 'finance-small-action', attr: { type: 'button' } })
    .addEventListener('click', () => new ReceivableCollectionPickerModal(app, store).open());
  actions.createEl('button', { text: '+ 代垫', cls: 'finance-small-action', attr: { type: 'button' } })
    .addEventListener('click', () => new ReceivableModal(app, store).open());

  const filters = section.createDiv({ cls: 'finance-receivable-filters', attr: { role: 'tablist', 'aria-label': '代垫状态' } });
  for (const [value, label] of [['open', '未完成'], ['history', '查看历史'], ['all', '全部']] as const) {
    const button = filters.createEl('button', { text: label,
      cls: `finance-receivable-filter${filter === value ? ' is-active' : ''}`,
      attr: { type: 'button', role: 'tab', 'aria-selected': String(filter === value) } });
    button.addEventListener('click', () => onFilterChange(value));
  }

  const items = filter === 'history'
    ? [...store.getReceivables('settled'), ...store.getReceivables('closed')]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    : filter === 'all' ? store.getReceivables() : store.getReceivables(filter);
  if (!items.length) {
    section.createDiv({ text: filter === 'open' ? '当前没有未完成的代垫。' : '此状态下还没有代垫项目。', cls: 'finance-section-empty' });
    return;
  }

  const list = section.createDiv({ cls: 'finance-receivable-project-list' });
  for (const item of items) {
    const card = list.createDiv({ cls: `finance-receivable-project is-${item.status}` });
    const top = card.createDiv({ cls: 'finance-receivable-project-top' });
    top.createDiv({ text: item.title, cls: 'finance-receivable-title' });
    top.createSpan({ text: statusLabel(item.status), cls: `finance-receivable-status is-${item.status}` });
    const figures = card.createDiv({ cls: 'finance-receivable-project-figures' });
    projectFigure(figures, '总支付', formatCny(item.totalPaid));
    projectFigure(figures, '我的部分', formatCny(item.personalShare));
    projectFigure(figures, '代垫金额', formatCny(item.receivableAmount));
    projectFigure(figures, '已收回', formatCny(store.getReceivableCollected(item.id)));
    projectFigure(figures, '待收回', formatCny(store.getReceivableOutstanding(item.id)), 'is-emphasis');
    if (item.writtenOffAmount > 0) projectFigure(figures, '未收回核销', formatCny(item.writtenOffAmount));
    card.createDiv({ text: `${item.date} · ${store.getAccount(item.paymentAccountId)?.name ?? '支付账户已删除'}`,
      cls: 'finance-receivable-project-meta' });
    const cardActions = card.createDiv({ cls: 'finance-receivable-project-actions' });
    if (item.status === 'open') {
      cardActions.createEl('button', { text: '收回', cls: 'mod-cta', attr: { type: 'button' } })
        .addEventListener('click', () => new ReceivableCollectionModal(app, store, item).open());
      cardActions.createEl('button', { text: '结束', attr: { type: 'button' } })
        .addEventListener('click', () => new ReceivableCloseModal(app, store, item).open());
    }
    cardActions.createEl('button', { text: '详情', attr: { type: 'button' } })
      .addEventListener('click', () => new ReceivableDetailModal(app, store, item.id).open());
  }
}

function projectFigure(parent: HTMLElement, label: string, value: string, extraClass = ''): void {
  const figure = parent.createDiv({ cls: `finance-receivable-project-figure ${extraClass}`.trim() });
  figure.createDiv({ text: label, cls: 'finance-receivable-project-figure-label' });
  figure.createDiv({ text: value, cls: 'finance-receivable-project-figure-value' });
}

function statusLabel(status: ReceivableStatus): string {
  return ({ open: '未完成', settled: '已完成', closed: '已结束', cancelled: '已取消' })[status];
}
