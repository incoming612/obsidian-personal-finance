import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import { ReceivableCollectionPickerModal, ReceivableModal } from './ReceivableModals';
import { TaxRecordModal } from './TaxRecordModal';
import {
  type Account, type DebtAction, type InvestmentIncomeKind, type OrdinaryTransactionType,
  type Transaction, type TransactionInput
} from '../types';
import { todayLocalDate } from '../utils/date';

export class TransactionModal extends Modal {
  private draft: {
    type: 'income' | 'expense' | 'transfer' | 'investment' | 'debt';
    date: string;
    amount: string;
    note: string;
    category: string;
    categoryId: string;
    parentCategoryId: string;
    accountId: string;
    fromAccountId: string;
    toAccountId: string;
    debtAction: DebtAction;
    assetAccountId: string;
    liabilityAccountId: string;
    investmentAction: 'inflow' | 'outflow' | 'rebalance' | 'income';
    investmentAccountId: string;
    incomeKind: InvestmentIncomeKind;
    taxInvolved: boolean;
    taxAmount: string;
    taxTreatment: 'withholding' | 'final';
    taxYear: string;
  };
  private saving = false;

  constructor(
    app: App,
    private readonly store: FinanceStore,
    private readonly transaction?: Exclude<Transaction, { type: 'adjustment' | 'refund' }>,
    initialDate?: string,
    private readonly initialRepaymentLiabilityId?: string
  ) {
    super(app);
    const assets = store.getAccounts('asset');
    const firstCash = assets.find(account => account.kind === 'asset' && account.accountRole === 'cash');
    const firstInvestment = assets.find(account => account.kind === 'asset' && account.accountRole === 'investment');
    const liabilities = store.getAccounts('liability');
    const expenseAccounts = [...assets, ...store.getAccounts('allowance'),
      ...store.getAccounts('liability').filter(account => account.kind === 'liability' && account.liabilityRole === 'credit')];
    const ordinary = transaction?.type === 'income' || transaction?.type === 'expense'
      ? transaction : undefined;
    const existingCategory = ordinary ? store.getCategory(ordinary.categoryId) : undefined;
    const firstExpenseRoot = store.getCategories('expense', true).find(item => item.parentId === null);
    const transfer = transaction?.type === 'transfer' ? transaction : undefined;
    const investmentIncome = transaction?.type === 'investment-income' ? transaction : undefined;
    const debt = transaction?.type === 'debt' ? transaction : undefined;
    const repaymentLiability = initialRepaymentLiabilityId
      ? store.getAccount(initialRepaymentLiabilityId) : undefined;
    const creditRepayment = repaymentLiability?.kind === 'liability' && repaymentLiability.liabilityRole === 'credit'
      ? repaymentLiability : undefined;
    const preferredRepaymentAccount = creditRepayment?.defaultRepaymentAccountId
      ? assets.find(account => account.id === creditRepayment.defaultRepaymentAccountId) : undefined;
    this.draft = {
      type: creditRepayment ? 'debt' : investmentIncome ? 'investment'
        : transfer && store.getTransferKind(transfer) !== 'account-transfer' ? 'investment'
          : transaction?.type === 'income' || transaction?.type === 'expense' || transaction?.type === 'debt'
            || transaction?.type === 'transfer' ? transaction.type : 'expense',
      date: transaction?.date ?? initialDate ?? todayLocalDate(),
      amount: transaction ? String(transaction.amount)
        : creditRepayment ? String(store.getLiabilityBalance(creditRepayment.id)) : '',
      note: transaction?.note ?? '',
      category: ordinary ? store.getTransactionCategoryName(ordinary) : firstExpenseRoot?.name ?? '',
      categoryId: ordinary?.categoryId ?? firstExpenseRoot?.id ?? '',
      parentCategoryId: existingCategory?.parentId ?? existingCategory?.id ?? firstExpenseRoot?.id ?? '',
      accountId: ordinary?.accountId ?? investmentIncome?.accountId ?? firstCash?.id ?? expenseAccounts[0]?.id ?? '',
      fromAccountId: transfer?.fromAccountId ?? firstCash?.id ?? assets[0]?.id ?? '',
      toAccountId: transfer?.toAccountId ?? firstInvestment?.id ?? assets[1]?.id ?? '',
      debtAction: creditRepayment ? 'repay' : debt?.debtAction ?? 'borrow',
      assetAccountId: debt?.assetAccountId ?? preferredRepaymentAccount?.id ?? assets[0]?.id ?? '',
      liabilityAccountId: creditRepayment?.id ?? debt?.liabilityAccountId ?? liabilities[0]?.id ?? '',
      investmentAction: investmentIncome ? 'income' : transfer
        ? ({ 'investment-inflow': 'inflow', 'investment-outflow': 'outflow', 'investment-rebalance': 'rebalance', 'account-transfer': 'inflow' } as const)[store.getTransferKind(transfer)]
        : 'inflow',
      investmentAccountId: investmentIncome?.investmentAccountId
        ?? (transfer && store.getTransferKind(transfer) === 'investment-outflow' ? transfer.fromAccountId
          : transfer && store.getTransferKind(transfer) === 'investment-rebalance' ? transfer.fromAccountId
            : firstInvestment?.id ?? ''),
      incomeKind: investmentIncome?.incomeKind ?? 'dividend',
      taxInvolved: ordinary?.type === 'income' && (ordinary.taxAmount ?? 0) > 0,
      taxAmount: ordinary?.type === 'income' ? String(ordinary.taxAmount ?? 0) : '',
      taxTreatment: ordinary?.type === 'income' && ordinary.taxTreatment === 'final' ? 'final' : 'withholding',
      taxYear: String(ordinary?.type === 'income' ? ordinary.taxYear ?? Number(ordinary.date.slice(0, 4)) : new Date().getFullYear())
    };
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText(this.initialRepaymentLiabilityId ? '确认扣款' : this.transaction ? '编辑流水' : '记一笔');
    const body = this.contentEl;
    body.empty();
    body.addClass('finance-transaction-modal');

    const typeSetting = this.initialRepaymentLiabilityId
      ? new Setting(body).setName('类型').setDesc('信用还款')
      : new Setting(body)
        .setName('类型')
        .addDropdown(dropdown => dropdown
          .addOption('expense', '支出')
          .addOption('income', '收入')
          .addOption('transfer', '转账')
          .addOption('investment', '投资')
          .addOption('debt', '负债')
          .setValue(this.draft.type)
          .onChange(value => {
            this.draft.type = value as typeof this.draft.type;
            if (value === 'income' && !this.store.getAccounts('asset').some(account => account.id === this.draft.accountId)) {
              this.draft.accountId = this.store.getAccounts('asset')[0]?.id ?? '';
            }
            if (value === 'income' || value === 'expense') {
              this.selectDefaultCategory(value);
            }
            this.render();
          }));
    if (!this.transaction && !this.initialRepaymentLiabilityId) typeSetting.addButton(button => button.setButtonText('代垫')
      .setTooltip('记录替别人支付、之后待收回的款项')
      .onClick(() => { this.close(); new ReceivableModal(this.app, this.store).open(); }));
    if (!this.transaction && !this.initialRepaymentLiabilityId) typeSetting.addButton(button => button.setButtonText('收回垫款')
      .setTooltip('选择未完成的代垫并登记收回')
      .onClick(() => { this.close(); new ReceivableCollectionPickerModal(this.app, this.store).open(); }));
    if (!this.transaction && !this.initialRepaymentLiabilityId) typeSetting.addButton(button => button.setButtonText('退税')
      .setTooltip('记录实际到账的退税，不计入普通收入')
      .onClick(() => { this.close(); new TaxRecordModal(this.app, this.store, 'refund').open(); }));
    if (!this.transaction && !this.initialRepaymentLiabilityId) typeSetting.addButton(button => button.setButtonText('补税')
      .setTooltip('记录实际支付的补税，不计入普通支出')
      .onClick(() => { this.close(); new TaxRecordModal(this.app, this.store, 'additional_payment').open(); }));

    if (this.draft.type !== 'income' || !this.draft.taxInvolved) new Setting(body)
      .setName('金额')
      .setDesc('人民币正数，最多两位小数')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0.01';
        text.inputEl.step = '0.01';
        text.inputEl.inputMode = 'decimal';
        text.setPlaceholder('0.00')
          .setValue(this.draft.amount)
          .onChange(value => { this.draft.amount = value; });
      });

    const assets = this.store.getAccounts('asset');
    const liabilities = this.store.getAccounts('liability');
    const expenseAccounts = [...assets, ...this.store.getAccounts('allowance'),
      ...this.store.getAccounts('liability').filter(account => account.kind === 'liability' && account.liabilityRole === 'credit')];
    if (this.draft.type === 'income' || this.draft.type === 'expense') {
      if (this.draft.type === 'income') this.renderIncomeTaxFields(body);
      this.renderOrdinaryFields(body, this.draft.type === 'expense' ? expenseAccounts : assets, this.draft.type);
    } else if (this.draft.type === 'transfer') {
      this.renderAccountSelect(body, '转出账户', assets, this.draft.fromAccountId,
        value => { this.draft.fromAccountId = value; });
      this.renderAccountSelect(body, '转入账户', assets, this.draft.toAccountId,
        value => { this.draft.toAccountId = value; });
      if (assets.length < 2) {
        body.createEl('p', { text: '转账需要至少两个资产账户。', cls: 'finance-form-hint' });
      }
    } else if (this.draft.type === 'investment') {
      this.renderInvestmentFields(body, assets);
    } else {
      if (this.initialRepaymentLiabilityId) {
        new Setting(body).setName('负债操作').setDesc('确认扣款 / 信用还款');
      } else {
        new Setting(body)
          .setName('负债操作')
          .addDropdown(dropdown => dropdown
            .addOption('borrow', '借入')
            .addOption('repay', '偿还本金')
            .setValue(this.draft.debtAction)
            .onChange(value => {
              this.draft.debtAction = value as DebtAction;
              this.render();
            }));
      }
      this.renderAccountSelect(body,
        this.draft.debtAction === 'borrow' ? '资金进入账户' : '付款账户',
        assets, this.draft.assetAccountId,
        value => { this.draft.assetAccountId = value; });
      if (this.initialRepaymentLiabilityId) {
        const account = this.store.getAccount(this.initialRepaymentLiabilityId);
        new Setting(body).setName('信用支付账户').setDesc(account?.name ?? '账户不存在');
      } else {
        this.renderAccountSelect(body, '负债账户', liabilities, this.draft.liabilityAccountId,
          value => { this.draft.liabilityAccountId = value; });
      }
      if (assets.length === 0 || liabilities.length === 0) {
        body.createEl('p', {
          text: '负债操作需要一个资产账户和一个负债账户。', cls: 'finance-form-hint'
        });
      }
    }

    new Setting(body)
      .setName('日期')
      .addText(text => {
        text.inputEl.type = 'date';
        text.setValue(this.draft.date)
          .onChange(value => { this.draft.date = value; });
      });
    new Setting(body)
      .setName('备注')
      .addTextArea(text => text
        .setPlaceholder('可选')
        .setValue(this.draft.note)
        .onChange(value => { this.draft.note = value; }));

    const keepsDisabledCategory = !!this.transaction
      && (this.transaction.type === 'income' || this.transaction.type === 'expense')
      && this.transaction.type === this.draft.type
      && this.transaction.categoryId === this.draft.categoryId;
    const hasOrdinaryCategory = this.draft.type === 'income' || this.draft.type === 'expense'
      ? this.store.getCategories(this.draft.type, true).length > 0 || keepsDisabledCategory
      : true;
    const investmentAccounts = assets.filter(account => account.kind === 'asset' && account.accountRole === 'investment');
    const cashAccounts = assets.filter(account => account.kind === 'asset' && account.accountRole === 'cash');
    const unavailable = !hasOrdinaryCategory || (this.draft.type === 'transfer' ? assets.length < 2
      : this.draft.type === 'investment' ? this.draft.investmentAction === 'rebalance' ? investmentAccounts.length < 2
        : !cashAccounts.length || !investmentAccounts.length
      : this.draft.type === 'debt' ? assets.length === 0 || liabilities.length === 0
        : this.draft.type === 'expense' ? expenseAccounts.length === 0 : assets.length === 0);
    const repaymentUnavailable = !!this.initialRepaymentLiabilityId
      && this.store.getLiabilityBalance(this.initialRepaymentLiabilityId) <= 0;
    new Setting(body)
      .setClass('finance-modal-actions')
      .addButton(button => button
        .setButtonText('取消')
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText('保存')
        .setCta()
        .setDisabled(unavailable || repaymentUnavailable)
        .onClick(() => { void this.save(); }));
  }

  private renderIncomeTaxFields(body: HTMLElement): void {
    new Setting(body).setName('涉及扣税').addToggle(toggle => toggle
      .setValue(this.draft.taxInvolved)
      .onChange(value => { this.draft.taxInvolved = value; this.render(); }));
    if (!this.draft.taxInvolved) return;
    let netPreview: HTMLElement;
    const refreshNet = () => {
      const gross = Number(this.draft.amount); const tax = Number(this.draft.taxAmount || 0);
      netPreview?.setText(Number.isFinite(gross) && Number.isFinite(tax) && gross >= tax
        ? `实际到账 ¥${(gross - tax).toFixed(2)}` : '实际到账：扣税不能高于税前收入');
    };
    new Setting(body).setName('税前收入 *').setDesc('按税前金额统计收入')
      .addText(text => {
        text.inputEl.type = 'number'; text.inputEl.min = '0.01'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
        text.setPlaceholder('0.00').setValue(this.draft.amount).onChange(value => { this.draft.amount = value; refreshNet(); });
      });
    new Setting(body).setName('扣税金额 *').setDesc('不会记作普通支出')
      .addText(text => {
        text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
        text.setPlaceholder('0.00').setValue(this.draft.taxAmount).onChange(value => { this.draft.taxAmount = value; refreshNet(); });
      });
    netPreview = body.createDiv({ cls: 'finance-tax-net-preview' });
    refreshNet();
    new Setting(body).setName('税款性质 *').addDropdown(dropdown => dropdown
      .addOption('withholding', '预扣税（可能退税）').addOption('final', '最终税费（确定承担）')
      .setValue(this.draft.taxTreatment).onChange(value => { this.draft.taxTreatment = value as 'withholding' | 'final'; }));
    new Setting(body).setName('所属税务年度 *').addText(text => {
      text.inputEl.type = 'number'; text.inputEl.min = '1900'; text.inputEl.max = '9999'; text.inputEl.step = '1';
      text.setValue(this.draft.taxYear).onChange(value => { this.draft.taxYear = value; });
    });
  }

  private renderOrdinaryFields(
    body: HTMLElement,
    assets: Account[],
    type: OrdinaryTransactionType
  ): void {
    this.renderOrdinaryCategorySelect(body, type);
    if (this.store.getCategories(type, true).length === 0) {
      body.createEl('p', {
        text: `当前没有可用的${type === 'income' ? '收入' : '支出'}分类，请先在 Finance → 设置中启用或创建分类。`,
        cls: 'finance-form-hint'
      });
    }
    this.renderAccountSelect(body, type === 'income' ? '收入账户' : '支付账户',
      assets, this.draft.accountId, value => { this.draft.accountId = value; });
  }

  private renderInvestmentFields(body: HTMLElement, assets: Account[]): void {
    const investmentAccounts = assets.filter(account => account.kind === 'asset' && account.accountRole === 'investment');
    const cashAccounts = assets.filter(account => account.kind === 'asset' && account.accountRole === 'cash');
    const action = this.draft.investmentAction;
    if (this.draft.type === 'investment') {
      new Setting(body).setName('投资操作').addDropdown(dropdown => dropdown
        .addOption('inflow', '投资转入').addOption('outflow', '投资赎回')
        .addOption('rebalance', '投资调仓').addOption('income', '投资收益入账')
        .setValue(action).onChange(value => {
          this.draft.investmentAction = value as typeof this.draft.investmentAction;
          const firstInvestment = investmentAccounts[0]?.id ?? '';
          const firstCash = cashAccounts[0]?.id ?? '';
          const secondInvestment = investmentAccounts.find(account => account.id !== firstInvestment)?.id ?? '';
          if (value === 'inflow') { this.draft.fromAccountId = firstCash; this.draft.toAccountId = firstInvestment; }
          if (value === 'outflow') { this.draft.investmentAccountId = firstInvestment; this.draft.toAccountId = firstCash; }
          if (value === 'rebalance') { this.draft.investmentAccountId = firstInvestment; this.draft.toAccountId = secondInvestment; }
          if (value === 'income') { this.draft.investmentAccountId = firstInvestment; this.draft.accountId = firstCash; }
          this.draft.type = 'investment';
          this.render();
        }));
    }
    if (action === 'income') {
      this.renderAccountSelect(body, '收益来源投资账户', investmentAccounts, this.draft.investmentAccountId,
        value => { this.draft.investmentAccountId = value; });
      this.renderAccountSelect(body, '到账资产账户', cashAccounts, this.draft.accountId, value => { this.draft.accountId = value; });
      new Setting(body).setName('收益类型').addDropdown(dropdown => dropdown
        .addOption('dividend', '分红').addOption('interest', '利息')
        .addOption('cash-dividend', '现金派息').addOption('other', '其他')
        .setValue(this.draft.incomeKind).onChange(value => { this.draft.incomeKind = value as InvestmentIncomeKind; }));
      return;
    }
    if (action === 'inflow') {
      this.renderAccountSelect(body, '转出现金账户', cashAccounts, this.draft.fromAccountId, value => { this.draft.fromAccountId = value; });
      this.renderAccountSelect(body, '投资账户', investmentAccounts, this.draft.toAccountId, value => { this.draft.toAccountId = value; });
    } else if (action === 'outflow') {
      this.renderAccountSelect(body, '赎回投资账户', investmentAccounts, this.draft.investmentAccountId, value => { this.draft.investmentAccountId = value; });
      this.renderAccountSelect(body, '到账现金账户', cashAccounts, this.draft.toAccountId, value => { this.draft.toAccountId = value; });
    } else {
      this.renderAccountSelect(body, '转出投资账户', investmentAccounts, this.draft.investmentAccountId, value => { this.draft.investmentAccountId = value; });
      this.renderAccountSelect(body, '转入投资账户', investmentAccounts, this.draft.toAccountId, value => { this.draft.toAccountId = value; });
    }
    body.createEl('p', { text: '投资转入、赎回和调仓沿用现有账户转账记录，不计入普通收入或支出。', cls: 'finance-form-hint' });
  }

  private renderOrdinaryCategorySelect(body: HTMLElement, type: OrdinaryTransactionType): void {
    const roots = this.store.getCategories(type, true).filter(item => item.parentId === null);
    const selectedCategory = this.store.getCategory(this.draft.categoryId);
    const selectedParent = this.store.getCategory(this.draft.parentCategoryId);
    if (selectedParent && selectedParent.scope === type && selectedParent.parentId === null
      && !roots.some(item => item.id === selectedParent.id)) roots.push(selectedParent);
    new Setting(body).setName('一级分类').addDropdown(dropdown => {
      roots.forEach(category => dropdown.addOption(category.id, category.enabled ? category.name : `${category.name}（已停用）`));
      dropdown.setValue(this.draft.parentCategoryId);
      dropdown.onChange(value => {
        this.draft.parentCategoryId = value; this.draft.categoryId = value;
        this.draft.category = roots.find(item => item.id === value)?.name ?? '';
        this.render();
      });
    });
    let children = this.store.getCategoryChildren(this.draft.parentCategoryId, true);
    if (selectedCategory?.parentId === this.draft.parentCategoryId && !children.some(item => item.id === selectedCategory.id)) {
      children = [...children, selectedCategory];
    }
    if (children.length) {
      new Setting(body).setName('二级分类（可选）').addDropdown(dropdown => {
        dropdown.addOption('', '不细分');
        children.forEach(category => dropdown.addOption(category.id, this.store.isCategorySelectable(category.id)
          ? category.name : `${category.name}（已停用）`));
        const current = selectedCategory?.parentId === this.draft.parentCategoryId ? selectedCategory.id : '';
        dropdown.setValue(current);
        dropdown.onChange(value => {
          this.draft.categoryId = value || this.draft.parentCategoryId;
          this.draft.category = value ? children.find(item => item.id === value)?.name ?? ''
            : roots.find(item => item.id === this.draft.parentCategoryId)?.name ?? '';
        });
      });
    }
  }

  private renderAccountSelect(
    body: HTMLElement,
    label: string,
    accounts: Account[],
    selected: string,
    onChange: (value: string) => void
  ): void {
    if (accounts.length === 0) {
      new Setting(body).setName(label).setDesc('请先添加对应类型的账户。');
      return;
    }
    new Setting(body)
      .setName(label)
      .addDropdown(dropdown => {
        for (const account of accounts) dropdown.addOption(account.id, account.name);
        dropdown.setValue(selected);
        dropdown.onChange(onChange);
      });
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const rawAmount = this.draft.amount.trim();
    if (!rawAmount) {
      new Notice('请输入金额。');
      return;
    }
    const common = {
      date: this.draft.date, amount: Number(rawAmount), note: this.draft.note
    };
    let input: TransactionInput | undefined;
    switch (this.draft.type) {
      case 'income':
      case 'expense':
        if (this.draft.type === 'income') {
          const taxAmount = this.draft.taxInvolved ? Number(this.draft.taxAmount) : 0;
          const grossAmount = Number(rawAmount);
          const taxYear = this.draft.taxInvolved ? Number(this.draft.taxYear) : Number(this.draft.date.slice(0, 4));
          if (this.draft.taxInvolved && !this.draft.taxAmount.trim()) {
            new Notice('请输入扣税金额。'); return;
          }
          if (!Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > grossAmount) {
            new Notice('扣税金额不能超过税前收入。'); return;
          }
          if (this.draft.taxInvolved && (!Number.isInteger(taxYear) || taxYear < 1900 || taxYear > 9999)) {
            new Notice('请输入有效的税务年度。'); return;
          }
          input = { ...common, type: 'income', grossAmount, taxAmount,
            netAmount: Math.round((grossAmount - taxAmount) * 100) / 100,
            taxTreatment: taxAmount === 0 && !this.draft.taxInvolved ? 'none' : this.draft.taxTreatment,
            taxYear, category: this.draft.category, categoryId: this.draft.categoryId,
            accountId: this.draft.accountId };
        } else {
          input = { ...common, type: 'expense', category: this.draft.category,
            categoryId: this.draft.categoryId, accountId: this.draft.accountId };
        }
        break;
      case 'transfer':
        input = { ...common, type: 'transfer',
          fromAccountId: this.draft.fromAccountId, toAccountId: this.draft.toAccountId };
        break;
      case 'investment': {
        const investmentAccount = this.store.getAccount(this.draft.investmentAccountId);
        const fromAccountId = this.draft.investmentAction === 'inflow' ? this.draft.fromAccountId : this.draft.investmentAccountId;
        const toAccountId = this.draft.toAccountId;
        if (this.draft.investmentAction === 'income') {
          input = { ...common, type: 'investment-income', investmentAccountId: this.draft.investmentAccountId,
            accountId: this.draft.accountId, incomeKind: this.draft.incomeKind };
        } else if (investmentAccount?.kind === 'asset') {
          input = { ...common, type: 'transfer', fromAccountId, toAccountId };
        }
        break;
      }
      case 'debt':
        input = { ...common, type: 'debt', debtAction: this.draft.debtAction,
          assetAccountId: this.draft.assetAccountId,
          liabilityAccountId: this.draft.liabilityAccountId };
        break;
    }

    if (!input) return;

    this.saving = true;
    try {
      if (this.transaction) await this.store.updateTransaction(this.transaction.id, input);
      else await this.store.addTransaction(input);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '保存流水失败。');
    } finally {
      this.saving = false;
    }
  }

  private selectDefaultCategory(type: 'income' | 'expense'): void {
    const category = type === 'expense'
      ? this.store.getCategories(type, true).find(item => item.parentId === null)
      : this.store.getCategories(type, true)[0];
    this.draft.categoryId = category?.id ?? '';
    this.draft.category = category?.name ?? '';
    this.draft.parentCategoryId = category?.id ?? '';
  }
}
