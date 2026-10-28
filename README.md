# Finance

**Finance v1.1.0** is a lightweight, local-first personal finance plugin for Obsidian. It helps one person track accounts, everyday money movement, investments, and financial plans inside a vault. It does not require Dataview, Tracker, Bases, a remote service, or a bank connection.

## Features

- **Dashboard and calendar:** Review net worth, assets, liabilities, pending credit payments, receivables, and investment summaries. Explore daily, weekly, monthly, yearly, or custom date ranges; month and year views include transaction calendars. Expense breakdowns are available as bar and pie charts.
- **Accounts:** Manage asset and liability accounts, credit-payment accounts, monthly allowance accounts, and investment accounts. Current balances are derived from opening balances and related records. Reconciliation is available for supported accounts.
- **Income and expenses:** Record, edit, and delete ordinary income and expenses. Categories support a configurable hierarchy up to two levels.
- **Transfers and debt:** Move funds between eligible accounts and record supported borrowing and principal repayment operations without misclassifying them as ordinary income or expenses.
- **Credit payments:** Record a credit-funded purchase as an expense and a credit liability without reducing a cash account. Record a later repayment to reduce cash and liability without creating a second expense. A dashboard summary shows pending credit balances.
- **Investments:** Use investment accounts with extensible, user-managed investment categories. Record investment contributions, redemptions, and rebalances; enter cash investment income separately; and create market-value snapshots on dates chosen by the user. The plugin summarizes current value and simple cumulative return without treating internal rebalances as new contributions.
- **Refunds:** Link refunds to eligible expenses and account for them without treating the refund as ordinary income.
- **Advances and receivables:** Record advances, track outstanding receivables, and record collections or write-offs. Receivables are managed separately from ordinary accounts.
- **Consumption allowances:** Create monthly allowance accounts with a limit and reset day, then track usage and remaining allowance.
- **Planning:** Set monthly and category budgets, create savings goals, and maintain a shopping wishlist with affordability estimates.
- **Income tax records:** Record gross income and withholding, then record tax refunds or additional tax payments. These tax events are kept separate from ordinary expenses and income where applicable.
- **Backup and export:** Create and restore a JSON backup, and export supported account and transaction data as CSV. CSV import is not available.

## Install in an Obsidian vault

1. Copy the plugin project into `<Vault>/.obsidian/plugins/personal-finance/` (or install the packaged plugin files there).
2. For a source checkout, open a terminal in the plugin folder and run `npm install`, then `npm run build`.
3. Confirm that the folder contains `manifest.json`, `main.js`, and `styles.css`.
4. In Obsidian, enable **Community plugins**, then enable **Finance** in the installed plugins list. If Finance does not appear, use **Reload app without saving** or restart Obsidian after installing the files.

For development, run `npm run dev` to start the esbuild watch process. Run `npm test` for the store tests and `npm run build` for the TypeScript check and production bundle.

## Limitations

- Currency display and calculations use CNY; there is no exchange-rate conversion.
- Tax tools record user-entered amounts; they do not calculate statutory income tax, estimate refunds, connect to tax services, or determine final tax liability.
- Investment performance uses account balances, user-entered valuation snapshots, and recorded cash flows. There are no live prices, securities positions, holding quantities, cost-basis accounting, XIRR, or annualized returns.
- Finance does not import CSV files, import bank data, or synchronize with financial institutions.
- There are no scheduled reminders or automatically generated daily valuation records.

## Data and privacy

Finance stores plugin data locally in the vault using Obsidian's plugin data API. It does not send financial records to a Finance server. The plugin's runtime data file is `data.json`; backup files may also contain sensitive information. Keep both out of source control and store backups securely. The project `.gitignore` excludes common data, backup, environment, build-cache, and log files. Review the files included in any release archive before sharing it.
