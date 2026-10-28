import { Modal, Notice, Setting, type App } from 'obsidian';
import type { FinanceStore } from '../store';
import type { Account, AccountInput, AccountKind, AccountRole, BalanceAccountKind, CategoryScope, LiabilityRole } from '../types';
import { formatCny } from '../utils/currency';
import { TransactionModal } from './TransactionModal';

export class AccountModal extends Modal {
  private draft: {
    kind: AccountKind;
    accountRole: AccountRole;
    liabilityRole: LiabilityRole;
    defaultRepaymentAccountId: string;
    name: string;
    category: string;
    categoryId: string;
    investmentCategoryId: string | null;
    openingBalance: string;
    allowanceLimit: string;
    resetDay: string;
    note: string;
  };
  private saving = false;

  constructor(
    app: App,
    private readonly store: FinanceStore,
    initialKind: AccountKind = 'asset',
    private readonly account?: Account
  ) {
    super(app);
    const kind = account?.kind ?? initialKind;
    const accountRole = account?.kind === 'asset' ? account.accountRole : 'cash';
    const categories = kind === 'allowance' ? [] : store.getCategories(categoryScope(kind, accountRole), true);
    const categoryId = account?.categoryId ?? categories[0]?.id ?? '';
    const category = account ? store.getAccountCategoryLabel(account) : categories[0]?.name ?? '';
    this.draft = {
      kind,
      accountRole,
      liabilityRole: account?.kind === 'liability' ? account.liabilityRole : 'loan',
      defaultRepaymentAccountId: account?.kind === 'liability' ? account.defaultRepaymentAccountId ?? '' : '',
      name: account?.name ?? '',
      category,
      categoryId,
      investmentCategoryId: account?.kind === 'asset' && account.accountRole === 'investment'
        ? account.investmentCategoryId : store.getCategories('investment', true)[0]?.id ?? null,
      openingBalance: account ? String(account.openingBalance) : '',
      allowanceLimit: account?.kind === 'allowance' ? String(account.allowanceLimit) : '',
      resetDay: account?.kind === 'allowance' ? String(account.resetDay) : '1',
      note: account?.note ?? ''
    };
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText(this.account ? '编辑账户' : '添加账户');
    const body = this.contentEl;
    body.empty();
    body.addClass('finance-account-modal');

    new Setting(body)
      .setName('类型')
      .addDropdown(dropdown => dropdown
        .addOption('asset', '资产')
        .addOption('liability', '负债')
        .addOption('allowance', '消费额度')
        .setValue(this.draft.kind)
        .onChange(value => {
          this.draft.kind = value as AccountKind;
          if (value === 'asset') this.draft.accountRole = 'cash';
          this.selectDefaultCategory();
          this.render();
        }));

    new Setting(body)
      .setName('账户名称')
      .addText(text => text
        .setPlaceholder('例如：招商银行卡')
        .setValue(this.draft.name)
        .onChange(value => { this.draft.name = value; }));

    if (this.draft.kind === 'asset') {
      new Setting(body)
        .setName('账户用途')
        .addDropdown(dropdown => dropdown
          .addOption('cash', '日常资金')
          .addOption('investment', '投资账户')
          .setValue(this.draft.accountRole)
          .onChange(value => {
            this.draft.accountRole = value as AccountRole;
            this.selectDefaultCategory();
            this.render();
          }));
    }

    if (this.draft.kind === 'liability') {
      new Setting(body).setName('负债类型').setDesc(this.draft.liabilityRole === 'loan'
        ? '普通负债用于助学贷款、普通借款等。'
        : '信用支付可直接用于消费，如信用卡、花呗、白条或先用后付。')
        .addDropdown(dropdown => dropdown.addOption('loan', '普通负债').addOption('credit', '信用支付')
          .setValue(this.draft.liabilityRole).onChange(value => {
            this.draft.liabilityRole = value as LiabilityRole;
            this.render();
          }));
      if (this.draft.liabilityRole === 'credit') {
        const assets = this.store.getAccounts('asset');
        new Setting(body).setName('默认扣款账户').setDesc('确认扣款时默认使用此资产账户，可在还款时修改。')
          .addDropdown(dropdown => {
            dropdown.addOption('', '不设置');
            assets.forEach(asset => dropdown.addOption(asset.id, asset.name));
            dropdown.setValue(this.draft.defaultRepaymentAccountId);
            dropdown.onChange(value => { this.draft.defaultRepaymentAccountId = value; });
          });
      }
    }

    if (this.draft.kind === 'allowance') {
      new Setting(body).setName('月额度').setDesc('每个额度周期自动重置；未使用额度不结转。').addText(text => {
        text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
        text.setPlaceholder('2000.00').setValue(this.draft.allowanceLimit)
          .onChange(value => { this.draft.allowanceLimit = value; });
      });
      new Setting(body).setName('每月重置日').setDesc('例如 15 表示每月 15 日开始新额度周期。').addText(text => {
        text.inputEl.type = 'number'; text.inputEl.min = '1'; text.inputEl.max = '31'; text.inputEl.step = '1';
        text.setValue(this.draft.resetDay).onChange(value => { this.draft.resetDay = value; });
      });
    } else {
      const categoryScopeValue = categoryScope(this.draft.kind, this.draft.accountRole);
      const categories = this.store.getCategories(categoryScopeValue, true);
      const archived = this.account?.categoryId ? this.store.getCategory(this.account.categoryId) : undefined;
      if (archived && !archived.enabled && archived.scope === categoryScopeValue) categories.push(archived);
      if (this.draft.kind === 'asset' && this.draft.accountRole === 'investment') {
        const investmentCategories = this.store.getCategories('investment');
        const current = investmentCategories.find(item => item.id === this.draft.investmentCategoryId);
        if (current && !current.enabled) investmentCategories.push(current);
        new Setting(body).setName('投资分类').setDesc('最多两级；可在设置 → 分类管理中维护。').addDropdown(dropdown => {
          investmentCategories.forEach(category => dropdown.addOption(category.id,
            `${this.store.getInvestmentCategoryLabel(category.id) ?? category.name}${category.enabled ? '' : '（已停用）'}`));
          dropdown.setValue(this.draft.investmentCategoryId ?? '');
          dropdown.onChange(value => { this.draft.investmentCategoryId = value || null; });
        });
      } else {
        new Setting(body).setName('分类').addDropdown(dropdown => {
          for (const category of categories) dropdown.addOption(category.id,
            category.enabled ? category.name : `${category.name}（已停用）`);
          dropdown.setValue(this.draft.categoryId);
          dropdown.onChange(value => {
            this.draft.categoryId = value;
            this.draft.category = categories.find(category => category.id === value)?.name ?? '';
          });
        });
      }
      if (this.draft.accountRole === 'cash' && categories.length === 0) body.createEl('p', {
        text: '当前没有可用分类，请先在 Finance → 设置中启用或创建分类。', cls: 'finance-form-hint'
      });
      new Setting(body).setName('期初余额')
        .setDesc(this.draft.accountRole === 'investment'
          ? '期初余额用于首次市值快照之前的计算。实际市值变化请使用“更新市值”记录快照。人民币，非负数，最多两位小数。'
          : '期初余额用于计算账户当前余额。正式使用后如需调整，请使用“对账”。人民币，非负数，最多两位小数。')
        .addText(text => {
          text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = '0.01'; text.inputEl.inputMode = 'decimal';
          text.setPlaceholder('0.00').setValue(this.draft.openingBalance)
            .onChange(value => { this.draft.openingBalance = value; });
        });
    }

    if (this.account && this.account.kind !== 'allowance') {
      new Setting(body)
        .setName(this.account.kind === 'liability' && this.account.liabilityRole === 'credit' ? '当前待扣金额'
          : this.account.kind === 'asset' && this.account.accountRole === 'investment' ? '当前市值' : '当前余额')
        .setDesc(this.account.kind === 'liability' && this.account.liabilityRole === 'credit'
          ? '信用消费与还款记录自动计算'
          : this.account.kind === 'asset' && this.account.accountRole === 'investment'
            ? '根据最近市值快照和其后的真实资金流自动计算' : '根据期初余额和流水自动计算')
        .addText(text => {
          text.setValue(formatCny(this.store.getCurrentBalance(this.account!.id)));
          text.setDisabled(true);
        });
    }

    if (this.account?.kind === 'liability' && this.account.liabilityRole === 'credit') {
      const repaymentAccount = this.account.defaultRepaymentAccountId
        ? this.store.getAccount(this.account.defaultRepaymentAccountId) : undefined;
      new Setting(body).setName('默认扣款账户').setDesc(repaymentAccount?.kind === 'asset'
        ? repaymentAccount.name : '未设置');
    }

    if (this.account?.kind === 'liability' && this.account.liabilityRole === 'credit') {
      new Setting(body).setName('信用支付 / 待扣款')
        .setDesc('确认后记录为信用还款，不会新增支出或影响预算。')
        .addButton(button => button.setButtonText('确认扣款').setCta().onClick(() => {
          const accountId = this.account!.id;
          this.close();
          new TransactionModal(this.app, this.store, undefined, undefined, accountId).open();
        }));
    }

    new Setting(body)
      .setName('备注')
      .addTextArea(text => text
        .setPlaceholder('可选')
        .setValue(this.draft.note)
        .onChange(value => { this.draft.note = value; }));

    new Setting(body)
      .setClass('finance-modal-actions')
      .addButton(button => button
        .setButtonText('取消')
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText('保存')
        .setCta()
        // Allowance starts with an empty amount, so don't snapshot-disable its save button.
        // Validation below can then provide a Notice for missing or invalid values.
        .setDisabled(this.draft.kind !== 'allowance' && !this.draft.categoryId)
        .onClick(() => { void this.save(); }));
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    let input: AccountInput;
    if (this.draft.kind === 'allowance') {
      const name = this.draft.name.trim();
      if (!name) { new Notice('请输入账户名称。'); return; }
      const rawAllowanceLimit = this.draft.allowanceLimit.trim();
      const allowanceLimit = Number(rawAllowanceLimit);
      if (!rawAllowanceLimit || !Number.isFinite(allowanceLimit) || allowanceLimit < 0) {
        new Notice('请输入有效的月额度。');
        return;
      }
      const rawResetDay = this.draft.resetDay.trim();
      const resetDay = Number(rawResetDay);
      if (!rawResetDay || !Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
        new Notice('重置日必须为 1–31。');
        return;
      }
      input = { kind: 'allowance', name, allowanceLimit,
        resetDay, allowancePeriod: 'monthly', rollover: false, note: this.draft.note };
    } else {
      const rawBalance = this.draft.openingBalance.trim();
      if (!rawBalance) { new Notice('请输入期初余额。'); return; }
      const common = { name: this.draft.name, category: this.draft.category, categoryId: this.draft.categoryId,
        openingBalance: Number(rawBalance), note: this.draft.note };
      input = this.draft.kind === 'asset'
        ? { ...common, kind: 'asset', accountRole: this.draft.accountRole,
          investmentCategoryId: this.draft.accountRole === 'investment' ? this.draft.investmentCategoryId : null }
        : { ...common, kind: 'liability', liabilityRole: this.draft.liabilityRole };
      if (input.kind === 'liability' && input.liabilityRole === 'credit') {
        input.defaultRepaymentAccountId = this.draft.defaultRepaymentAccountId || undefined;
      }
    }

    this.saving = true;
    try {
      if (this.account) {
        await this.store.updateAccount(this.account.id, input);
      } else {
        await this.store.addAccount(input);
      }
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : '保存账户失败。');
    } finally {
      this.saving = false;
    }
  }

  private selectDefaultCategory(): void {
    if (this.draft.kind === 'allowance') { this.draft.categoryId = ''; this.draft.category = ''; return; }
    const category = this.store.getCategories(categoryScope(this.draft.kind, this.draft.accountRole), true)[0];
    this.draft.categoryId = category?.id ?? '';
    this.draft.category = category?.name ?? '';
    if (this.draft.kind === 'asset' && this.draft.accountRole === 'investment') {
      this.draft.investmentCategoryId = this.store.getCategories('investment', true)[0]?.id ?? null;
    } else this.draft.investmentCategoryId = null;
  }
}

function categoryScope(kind: BalanceAccountKind, role: AccountRole): CategoryScope {
  return kind === 'liability' ? 'liability' : role === 'investment' ? 'assetInvestment' : 'assetCash';
}
