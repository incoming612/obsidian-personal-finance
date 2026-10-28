import type { App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { AccountKind, DashboardModule, DateRange, ExpenseBreakdownItem, ExpenseChartMode, PeriodMode } from '../types';
import { formatCny } from '../utils/currency';
import { formatLocalDate, getDateRange, getYearMonthDrilldown, getMonthDateRange, formatDateRangeLabel, shiftPeriodDate, todayLocalDate } from '../utils/date';
import { DailyTransactionsModal } from '../modals/DailyTransactionsModal';
import { PendingCreditModal } from '../modals/PendingCreditModal';
import { renderShoppingDashboard } from './ShoppingWishlist';

export function renderDashboard(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  periodMode: PeriodMode,
  anchorDate: string,
  customRange: DateRange,
  onPeriodChange: (mode: PeriodMode, anchorDate: string, customRange: DateRange) => void,
  openPlan: (tab: 'budget' | 'goals' | 'shopping', year?: number, month?: number) => void = () => undefined,
  onOpenReceivables: () => void = () => undefined,
  onOpenInvestments: () => void = () => undefined,
  selectedExpenseParentId: string | null = null,
  onExpenseParentChange: (categoryId: string | null) => void = () => undefined,
  onOpenTaxes: () => void = () => undefined
): void {
  const config = store.getDashboardConfig();
  const visible = new Set(config.visibleModules);
  const range = getDateRange(periodMode, anchorDate, customRange);
  const modules: Record<DashboardModule, () => void> = {
    financialStatus: () => {
      if (!visible.has('financialStatus')) return;
      const current = parent.createDiv({ cls: 'finance-dashboard-block' });
      current.createEl('h2', { text: '当前财务状态', cls: 'finance-block-title' });
      const overview = current.createDiv({ cls: 'finance-financial-overview' });
      const hero = overview.createDiv({ cls: 'finance-summary-hero' });
      summaryCard(hero, '净资产', store.getNetWorth(), true);
      const heroDetails = hero.createDiv({ cls: 'finance-hero-details' });
      heroMetric(heroDetails, '可立即使用资产', store.getTotalAvailableAssets());
      heroMetric(heroDetails, '待收款', store.getTotalReceivableOutstanding(),
        `${store.getOpenReceivableCount()} 笔未完成`, onOpenReceivables);
      heroMetric(heroDetails, '目标预留', store.getTotalReservedBalance());
      heroMetric(heroDetails, '扣款后预计可用', store.getProjectedAvailableAssetsAfterCreditRepayment());
      const supporting = overview.createDiv({ cls: 'finance-summary-metrics' });
      summaryCard(supporting, '总资产', store.getTotalAssets());
      summaryCard(supporting, '总负债', store.getTotalLiabilities());
      summaryCard(supporting, '待扣款', store.getTotalPendingCreditPayments(), false,
        () => new PendingCreditModal(app, store).open(), '信用支付待结清');
      const investments = store.getInvestmentSummary();
      const rate = investments.returnRate === null ? '--' : `${investments.returnRate >= 0 ? '+' : ''}${(investments.returnRate * 100).toFixed(2)}%`;
      summaryCard(supporting, '投资', investments.marketValue, false, onOpenInvestments,
        `累计收益 ${investments.returnAmount >= 0 ? '+' : ''}${formatCny(investments.returnAmount)} · 累计收益率 ${rate} · 最近更新：${store.getLatestInvestmentValuationDate() ?? '暂无'}`);
    },
    monthlyOverview: () => {
      if (!visible.has('monthlyOverview')) return;
      const monthly = parent.createDiv({ cls: 'finance-dashboard-block finance-monthly-block' });
      renderPeriodSelector(monthly, periodMode, anchorDate, customRange, range, onPeriodChange);
      const cards = monthly.createDiv({ cls: 'finance-summary finance-summary-monthly' });
      const summary = store.getRangeSummary(range);
      summaryCard(cards, '收入', summary.income);
      summaryCard(cards, '支出', summary.expense);
      summaryCard(cards, '投资', summary.investment);
    },
    monthlyAnalysis: () => {
      const showCalendar = (periodMode === 'month' || periodMode === 'year') && visible.has('calendar');
      if (!showCalendar) return;
      if (showCalendar && periodMode === 'month') {
        const [year, month] = range.startDate.split('-').map(Number);
        renderCalendar(parent, app, store, { year, month });
      }
      if (showCalendar && periodMode === 'year') {
        const year = Number(range.startDate.slice(0, 4));
        renderYearCalendar(parent, store, year, (month) => {
          const target = getYearMonthDrilldown(year, month);
          onPeriodChange(target.mode, target.anchorDate, customRange);
        });
      }
    },
    spending: () => {
      if (visible.has('spending')) renderCategoryBreakdown(parent, store, range, config.expenseChartMode,
        mode => { void store.setExpenseChartMode(mode); }, selectedExpenseParentId, onExpenseParentChange);
    },
    budget: () => {
      if (!visible.has('budget')) return;
      const now = new Date(); const year = now.getFullYear(); const month = now.getMonth() + 1;
      const usage = store.getBudgetUsage(year, month);
      const section = parent.createEl('section', { cls: 'finance-panel finance-plan-summary' });
      const heading = section.createDiv({ cls: 'finance-plan-summary-heading' });
      heading.createEl('h2', { text: '本月预算', cls: 'finance-panel-title' });
      heading.createEl('button', { text: '查看预算', cls: 'finance-link-button', attr: { type: 'button' } })
        .addEventListener('click', () => openPlan('budget', year, month));
      if (usage.totalLimit === null) {
        section.createDiv({ text: `已支出 ${formatCny(usage.used)} · 尚未设置本月总预算`, cls: 'finance-plan-summary-caption' });
      } else {
        section.createDiv({ text: `${formatCny(usage.used)} / ${formatCny(usage.totalLimit)}`, cls: 'finance-plan-summary-value' });
        const track = section.createDiv({ cls: 'finance-progress-track' });
        const fill = track.createDiv({ cls: `finance-progress-fill${usage.overBudget ? ' is-over' : ''}` });
        fill.style.width = `${Math.min(100, Math.max(0, usage.percentage ?? 0))}%`;
        section.createDiv({ text: usage.overBudget ? `已超支 ${formatCny(usage.overBudget)}`
          : `剩余 ${formatCny(usage.remaining ?? 0)}`, cls: usage.overBudget ? 'finance-over-budget' : 'finance-plan-summary-caption' });
      }
    },
    goals: () => {
      if (!visible.has('goals')) return;
      const section = parent.createEl('section', { cls: 'finance-panel finance-plan-summary' });
      const heading = section.createDiv({ cls: 'finance-plan-summary-heading' });
      heading.createEl('h2', { text: '我的储蓄目标', cls: 'finance-panel-title' });
      heading.createEl('button', { text: '查看全部', cls: 'finance-link-button', attr: { type: 'button' } })
        .addEventListener('click', () => openPlan('goals'));
      const goals = store.getActiveGoalsSorted().slice(0, 3);
      if (!goals.length) section.createDiv({ text: '还没有储蓄目标。为想实现的事情开始积累。', cls: 'finance-panel-empty' });
      for (const goal of goals) {
        const saved = store.getGoalSavedAmount(goal.id); const pct = saved / goal.targetAmount * 100;
        const row = section.createDiv({ cls: 'finance-goal-summary-row' });
        row.createDiv({ text: goal.name, cls: 'finance-goal-summary-name' });
        row.createDiv({ text: `${formatCny(saved)} / ${formatCny(goal.targetAmount)} · ${pct.toFixed(0)}%`, cls: 'finance-goal-summary-amount' });
        const track = row.createDiv({ cls: 'finance-progress-track' });
        track.createDiv({ cls: 'finance-progress-fill' }).style.width = `${Math.min(100, Math.max(0, pct))}%`;
      }
    },
    shopping: () => {
      if (visible.has('shopping')) renderShoppingDashboard(parent, app, store, () => openPlan('shopping'));
    },
    assets: () => {
      if (visible.has('assets')) renderReadOnlyAccounts(parent, store, '资产分布', 'asset');
    },
    liabilities: () => {
      if (visible.has('liabilities')) renderReadOnlyAccounts(parent, store, '负债', 'liability');
    },
    allowances: () => {
      if (!visible.has('allowances')) return;
      const accounts = store.getAccounts('allowance');
      const section = parent.createEl('section', { cls: 'finance-panel finance-dashboard-allowances' });
      section.createEl('h2', { text: '消费额度', cls: 'finance-panel-title' });
      if (!accounts.length) {
        section.createDiv({ text: '还没有消费额度账户', cls: 'finance-panel-empty' });
        return;
      }
      const cards = section.createDiv({ cls: 'finance-dashboard-allowance-list' });
      for (const account of accounts) {
        const status = store.getAllowanceStatus(account.id);
        const card = cards.createDiv({ cls: 'finance-dashboard-allowance-card' });
        const head = card.createDiv({ cls: 'finance-dashboard-allowance-heading' });
        head.createDiv({ text: account.name, cls: 'finance-dashboard-allowance-name' });
        head.createDiv({ text: `${formatCny(status.used)} / ${formatCny(status.allowanceLimit)}`, cls: 'finance-dashboard-allowance-usage' });
        const track = card.createDiv({ cls: 'finance-progress-track' });
        track.createDiv({ cls: `finance-progress-fill${status.percentage > 100 ? ' is-over' : ''}` })
          .style.width = `${Math.min(100, Math.max(0, status.percentage))}%`;
        card.createDiv({ text: `剩余 ${formatCny(status.remaining)} · 周期 ${status.startDate} 至 ${status.endDate}`,
          cls: 'finance-dashboard-allowance-caption' });
      }
      const funding = store.getExpenseFundingBreakdown(range);
      section.createDiv({ text: `所选时间内：额度账户支付 ${formatCny(funding.allowanceExpense)}`,
        cls: 'finance-dashboard-allowance-caption' });
    },
    tax: () => {
      if (!visible.has('tax')) return;
      const year = Number(todayLocalDate().slice(0, 4));
      const summary = store.getTaxYearSummary(year);
      const section = parent.createEl('section', { cls: 'finance-panel finance-tax-dashboard is-clickable',
        attr: { role: 'button', tabindex: '0', 'aria-label': `${year}年税务详情` } });
      section.createEl('h2', { text: '税务', cls: 'finance-panel-title' });
      const metrics = section.createDiv({ cls: 'finance-tax-dashboard-metrics' });
      for (const [label, amount] of [['本年税前收入', summary.grossIncome], ['已扣税款', summary.withholding + summary.finalTax],
        ['已退税', summary.refund]] as const) {
        const item = metrics.createDiv({ cls: 'finance-tax-dashboard-metric' });
        item.createDiv({ text: label, cls: 'finance-tax-metric-label' });
        item.createDiv({ text: formatCny(amount), cls: 'finance-tax-metric-value' });
      }
      section.createDiv({ text: '查看税务详情 ›', cls: 'finance-plan-summary-caption' });
      section.addEventListener('click', onOpenTaxes);
      section.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenTaxes(); } });
    }
  };
  config.moduleOrder.forEach(module => modules[module]());
}

function renderYearCalendar(
  parent: HTMLElement,
  store: FinanceStore,
  year: number,
  onMonthSelect: (month: number) => void
): void {
  const section = parent.createEl('section', { cls: 'finance-panel finance-year-calendar-panel' });
  section.createEl('h2', { text: `${year}年年度日历`, cls: 'finance-panel-title' });
  const months = section.createDiv({ cls: 'finance-year-calendar' });
  for (let month = 1; month <= 12; month++) {
    const card = months.createDiv({
      cls: 'finance-mini-month-card',
      attr: { role: 'button', tabindex: '0', 'aria-label': `进入${year}年${month}月` }
    });
    card.createEl('h3', { text: `${month}月`, cls: 'finance-mini-month-title' });
    const grid = card.createDiv({ cls: 'finance-mini-month-grid' });
    for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
      grid.createDiv({ text: weekday, cls: 'finance-mini-weekday' });
    }
    const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const days = new Date(year, month, 0).getDate();
    for (let blank = 0; blank < firstDay; blank++) grid.createDiv({ cls: 'finance-mini-day is-empty' });
    const today = todayLocalDate();
    const currentMonth = today.startsWith(`${year}-${String(month).padStart(2, '0')}`);
    if (currentMonth) card.addClass('is-current-month');
    for (let day = 1; day <= days; day++) {
      const isToday = currentMonth && Number(today.slice(-2)) === day;
      grid.createDiv({ text: String(day), cls: `finance-mini-day${isToday ? ' is-today' : ''}` });
    }
    for (let blank = firstDay + days; blank < 42; blank++) grid.createDiv({ cls: 'finance-mini-day is-empty' });

    const summary = store.getRangeSummary(getMonthDateRange(year, month));
    const totals = card.createDiv({ cls: 'finance-mini-month-stats' });
    for (const [label, amount, tone] of [
      ['收入', summary.income, 'finance-income'],
      ['支出', summary.expense, 'finance-expense'],
      ['投资', summary.investment, 'finance-investment']
    ] as const) {
      const metric = totals.createDiv({ cls: 'finance-mini-month-stat' });
      metric.createDiv({ text: label, cls: 'finance-mini-month-stat-label' });
      metric.createDiv({ text: formatCny(amount), cls: `finance-mini-month-stat-value ${tone}` });
    }
    card.addEventListener('click', () => onMonthSelect(month));
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onMonthSelect(month);
    });
  }
}

function summaryCard(
  parent: HTMLElement,
  label: string,
  amount: number,
  primary = false,
  onClick?: () => void,
  description?: string
): void {
  const card = parent.createDiv({
    cls: `finance-summary-card${primary ? ' finance-summary-card-primary' : ''}${onClick ? ' is-clickable' : ''}`,
    attr: onClick ? { role: 'button', tabindex: '0', 'aria-label': `${label}详情` } : {}
  });
  card.createDiv({ text: label, cls: 'finance-summary-label' });
  const value = card.createDiv({ text: formatCny(amount), cls: 'finance-summary-value' });
  if (amount < 0) value.addClass('finance-negative');
  if (description) card.createDiv({ text: description, cls: 'finance-summary-description' });
  if (onClick) {
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); onClick();
    });
  }
}

function heroMetric(parent: HTMLElement, label: string, amount: number, description?: string, onClick?: () => void): void {
  const metric = parent.createDiv({ cls: `finance-hero-metric${onClick ? ' is-clickable' : ''}`,
    attr: onClick ? { role: 'button', tabindex: '0', 'aria-label': `${label}详情` } : {} });
  metric.createDiv({ text: label, cls: 'finance-hero-metric-label' });
  metric.createDiv({ text: formatCny(amount), cls: 'finance-hero-metric-value' });
  if (description) metric.createDiv({ text: description, cls: 'finance-hero-metric-description' });
  if (onClick) {
    metric.addEventListener('click', onClick);
    metric.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); onClick();
    });
  }
}

function renderPeriodSelector(
  parent: HTMLElement,
  mode: PeriodMode,
  anchorDate: string,
  customRange: DateRange,
  range: DateRange,
  onChange: (mode: PeriodMode, anchor: string, custom: DateRange) => void
): void {
  const heading = parent.createDiv({ cls: 'finance-overview-heading' });
  heading.createEl('h2', { text: '收支概览', cls: 'finance-block-title' });
  const tabs = heading.createDiv({ cls: 'finance-period-modes', attr: { role: 'tablist', 'aria-label': '收支时间范围' } });
  for (const [period, label] of [['day', '今日'], ['week', '本周'], ['month', '本月'], ['year', '本年'], ['custom', '自定义']] as [PeriodMode, string][]) {
    const button = tabs.createEl('button', {
      text: label, cls: `finance-period-tab${mode === period ? ' is-active' : ''}`,
      attr: { type: 'button', role: 'tab', 'aria-selected': String(mode === period) }
    });
    button.addEventListener('click', () => onChange(period, anchorDate, customRange));
  }

  const selector = parent.createDiv({ cls: `finance-period-selector${mode === 'custom' ? ' is-custom' : ''}` });
  if (mode === 'custom') {
    const start = selector.createEl('input', { attr: { type: 'date', value: customRange.startDate, 'aria-label': '开始日期' } });
    selector.createSpan({ text: '至', cls: 'finance-range-divider' });
    const end = selector.createEl('input', { attr: { type: 'date', value: customRange.endDate, 'aria-label': '结束日期' } });
    const apply = selector.createEl('button', { text: '应用', attr: { type: 'button' } });
    apply.addEventListener('click', () => onChange('custom', anchorDate, { startDate: start.value, endDate: end.value }));
    return;
  }

  const previous = selector.createEl('button', {
    text: '‹', cls: 'finance-period-arrow', attr: { type: 'button', 'aria-label': '上一个时间段' }
  });
  previous.addEventListener('click', () => onChange(mode, shiftPeriodDate(mode, anchorDate, -1), customRange));
  selector.createDiv({ text: formatDateRangeLabel(mode, range), cls: 'finance-period-label' });
  const next = selector.createEl('button', {
    text: '›', cls: 'finance-period-arrow', attr: { type: 'button', 'aria-label': '下一个时间段' }
  });
  next.addEventListener('click', () => onChange(mode, shiftPeriodDate(mode, anchorDate, 1), customRange));
}

interface DashboardMonth { year: number; month: number; }

function renderCalendar(
  parent: HTMLElement,
  app: App,
  store: FinanceStore,
  selectedMonth: DashboardMonth
): void {
  const section = parent.createEl('section', { cls: 'finance-panel finance-calendar-panel' });
  section.createEl('h2', { text: '收支日历', cls: 'finance-panel-title' });
  const grid = section.createDiv({ cls: 'finance-calendar-grid' });
  for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
    grid.createDiv({ text: weekday, cls: 'finance-calendar-weekday' });
  }
  const { year, month } = selectedMonth;
  const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month, 0).getDate();
  for (let blank = 0; blank < firstDay; blank++) {
    grid.createDiv({ cls: 'finance-calendar-cell is-outside' });
  }
  for (let day = 1; day <= dayCount; day++) {
    const date = formatLocalDate(year, month, day);
    const summary = store.getDailySummary(date);
    const cell = grid.createEl('button', {
      cls: `finance-calendar-cell${summary.expense > 0 ? ' has-expense' : ''}${date === todayLocalDate() ? ' is-today' : ''}`,
      attr: { type: 'button', 'aria-label': `${date}，收入 ${formatCny(summary.income)}，支出 ${formatCny(summary.expense)}，投资 ${formatCny(summary.investmentInflow)}` }
    });
    cell.createSpan({ text: String(day), cls: 'finance-calendar-day' });
    const stats = cell.createSpan({ cls: 'finance-calendar-day-stats' });
    if (summary.expense > 0) stats.createSpan({ text: formatCny(summary.expense), cls: 'finance-calendar-expense' });
    else if (summary.income > 0) stats.createSpan({ text: `收 ${formatCompact(summary.income)}`, cls: 'finance-calendar-income' });
    if (summary.expense > 0 && summary.income > 0) {
      stats.createSpan({ text: `收 ${formatCompact(summary.income)}`, cls: 'finance-calendar-income' });
    }
    if (summary.investmentInflow > 0) {
      stats.createSpan({ text: `投 ${formatCompact(summary.investmentInflow)}`, cls: 'finance-calendar-investment' });
    }
    if (summary.refund > 0) stats.createSpan({ text: `退 ${formatCompact(summary.refund)}`, cls: 'finance-calendar-refund' });
    cell.addEventListener('click', () => new DailyTransactionsModal(app, store, date).open());
  }
  const trailing = (7 - ((firstDay + dayCount) % 7)) % 7;
  for (let blank = 0; blank < trailing; blank++) {
    grid.createDiv({ cls: 'finance-calendar-cell is-outside' });
  }
}

function renderCategoryBreakdown(
  parent: HTMLElement,
  store: FinanceStore,
  range: DateRange,
  chartMode: ExpenseChartMode,
  onModeChange: (mode: ExpenseChartMode) => void,
  selectedParentId: string | null,
  onParentChange: (categoryId: string | null) => void
): void {
  const section = parent.createEl('section', { cls: 'finance-panel finance-spending-panel' });
  const heading = section.createDiv({ cls: 'finance-spending-heading' });
  const selectedParent = selectedParentId ? store.getCategory(selectedParentId) : undefined;
  const title = heading.createDiv({ cls: 'finance-spending-title' });
  title.createEl('h2', { text: selectedParent?.name ?? '钱花在哪里', cls: 'finance-panel-title' });
  if (selectedParent) {
    const back = title.createEl('button', { text: '‹ 返回全部', cls: 'finance-link-button', attr: { type: 'button' } });
    back.addEventListener('click', () => onParentChange(null));
  }
  const toggle = heading.createDiv({ cls: 'finance-chart-toggle', attr: { role: 'group', 'aria-label': '图表类型' } });
  for (const [mode, label] of [['bar', '条形'], ['pie', '饼图']] as const) {
    const button = toggle.createEl('button', {
      text: label, cls: `finance-chart-toggle-button${chartMode === mode ? ' is-active' : ''}`,
      attr: { type: 'button', 'aria-pressed': String(chartMode === mode) }
    });
    button.addEventListener('click', () => onModeChange(mode));
  }
  const categories = selectedParentId
    ? store.getExpenseBreakdownForParent(selectedParentId, range)
    : store.getTopLevelExpenseBreakdown(range);
  if (categories.length === 0) {
    section.createDiv({ text: selectedParentId ? '当前时间范围内没有该分类支出记录。' : '当前时间范围内还没有支出记录', cls: 'finance-panel-empty' });
    return;
  }
  if (chartMode === 'pie') {
    renderPieBreakdown(section, categories, item => {
      if (item.categoryId && store.getCategoryChildren(item.categoryId).length) onParentChange(item.categoryId);
    });
    return;
  }
  const list = section.createDiv({ cls: 'finance-category-list' });
  for (const item of categories) {
    const canDrill = !selectedParentId && !!item.categoryId && store.getCategoryChildren(item.categoryId).length > 0;
    const row = list.createDiv({ cls: `finance-category-row${canDrill ? ' is-drillable' : ''}`,
      attr: canDrill ? { role: 'button', tabindex: '0' } : {} });
    const heading = row.createDiv({ cls: 'finance-category-heading' });
    heading.createSpan({ text: item.category, cls: 'finance-category-name' });
    heading.createSpan({ text: formatCny(item.amount), cls: 'finance-category-amount' });
    heading.createSpan({ text: `${item.percentage.toFixed(1)}%`, cls: 'finance-category-percent' });
    const track = row.createDiv({ cls: 'finance-category-track' });
    const bar = track.createDiv({ cls: 'finance-category-bar' });
    bar.style.width = `${Math.max(item.percentage, 1)}%`;
    if (canDrill) {
      row.addEventListener('click', () => onParentChange(item.categoryId));
      row.addEventListener('keydown', event => { if (event.key === 'Enter') onParentChange(item.categoryId); });
    }
  }
}

function renderPieBreakdown(
  parent: HTMLElement,
  categories: ExpenseBreakdownItem[],
  onCategoryClick: (item: ExpenseBreakdownItem) => void
): void {
  const layout = parent.createDiv({ cls: 'finance-pie-layout' });
  const svg = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('class', 'finance-pie-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '各支出分类占比');
  const base = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
  base.setAttribute('cx', '21'); base.setAttribute('cy', '21'); base.setAttribute('r', '15.9155');
  base.setAttribute('class', 'finance-pie-base');
  svg.append(base);
  let offset = 0;
  const total = categories.reduce((sum, item) => sum + item.amount, 0);
  categories.forEach((item, index) => {
    const slice = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
    slice.setAttribute('cx', '21'); slice.setAttribute('cy', '21'); slice.setAttribute('r', '15.9155');
    slice.setAttribute('class', `finance-pie-slice finance-pie-color-${index % 8}`);
    slice.setAttribute('stroke-dasharray', `${item.percentage} ${100 - item.percentage}`);
    slice.setAttribute('stroke-dashoffset', String(-offset));
    slice.setAttribute('transform', 'rotate(-90 21 21)');
    if (item.categoryId) {
      slice.classList.add('is-clickable');
      slice.addEventListener('click', () => onCategoryClick(item));
    }
    const title = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${item.category}：${formatCny(item.amount)} (${item.percentage.toFixed(1)}%)`;
    slice.append(title);
    svg.append(slice);
    offset += item.percentage;
  });
  const centerLabel = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerLabel.setAttribute('x', '21'); centerLabel.setAttribute('y', '19');
  centerLabel.setAttribute('text-anchor', 'middle'); centerLabel.setAttribute('class', 'finance-pie-center-label');
  centerLabel.textContent = '支出合计';
  svg.append(centerLabel);
  const centerValue = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerValue.setAttribute('x', '21'); centerValue.setAttribute('y', '24');
  centerValue.setAttribute('text-anchor', 'middle'); centerValue.setAttribute('class', 'finance-pie-center-value');
  centerValue.textContent = formatCny(total);
  svg.append(centerValue);
  layout.append(svg);
  const legend = layout.createDiv({ cls: 'finance-pie-legend' });
  categories.forEach((item, index) => {
    const row = legend.createDiv({ cls: `finance-pie-legend-row${item.categoryId ? ' is-clickable' : ''}`,
      attr: item.categoryId ? { role: 'button', tabindex: '0' } : {} });
    row.createSpan({ cls: `finance-pie-dot finance-pie-color-${index % 8}` });
    row.createSpan({ text: item.category, cls: 'finance-pie-category' });
    row.createSpan({ text: formatCny(item.amount), cls: 'finance-pie-amount' });
    row.createSpan({ text: `${item.percentage.toFixed(1)}%`, cls: 'finance-pie-percent' });
    if (item.categoryId) row.addEventListener('click', () => onCategoryClick(item));
  });
}

function renderReadOnlyAccounts(
  parent: HTMLElement,
  store: FinanceStore,
  title: string,
  kind: AccountKind
): void {
  const section = parent.createEl('section', { cls: 'finance-section finance-dashboard-accounts' });
  section.createEl('h2', { text: title, cls: 'finance-block-title' });
  const accounts = store.getAccounts(kind);
  if (accounts.length === 0) {
    section.createDiv({
      text: kind === 'asset' ? '还没有资产账户' : '当前没有负债',
      cls: 'finance-section-empty'
    });
    return;
  }
  const list = section.createDiv({ cls: 'finance-account-list' });
  for (const account of accounts) {
    const row = list.createDiv({ cls: 'finance-account-row finance-dashboard-account-row' });
    const details = row.createDiv({ cls: 'finance-account-details' });
    details.createDiv({ text: account.name, cls: 'finance-account-name' });
    details.createDiv({ text: store.getAccountCategoryLabel(account), cls: 'finance-account-category' });
    const balance = store.getAccountBalance(account.id);
    const balanceBlock = row.createDiv({ cls: 'finance-account-balance-block' });
    const amount = balanceBlock.createDiv({ text: formatCny(balance), cls: 'finance-account-balance' });
    if (kind === 'asset' && balance < 0) {
      amount.addClass('finance-account-balance-warning');
      balanceBlock.createDiv({ text: '余额不足', cls: 'finance-account-warning' });
    }
  }
}

function formatCompact(amount: number): string {
  return `¥${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(amount)}`;
}
