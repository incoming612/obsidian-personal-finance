# Finance

A personal finance management plugin for Obsidian.

Finance is a lightweight, local-first dashboard for managing personal finances in an Obsidian workspace.

## Features

- Income and expense transactions.
- Asset and liability accounts, plus transfers between accounts.
- Investment accounts and investment transfers.
- Allowance accounts for tracking spending limits.
- Monthly and yearly time-based financial analysis.
- Categories and two-level categories.
- Budgets and wish-list savings goals.
- Account reconciliation.
- Local data backup and restore.

## Install the development version

1. Clone this repository into `<Vault>/.obsidian/plugins/personal-finance/`.
2. Open a terminal in the plugin folder and run `npm install`.
3. Run `npm run build` to generate `main.js`.
4. Confirm the plugin folder is `.obsidian/plugins/personal-finance/` and contains `main.js`, `manifest.json`, and `styles.css`.
5. In Obsidian, enable **Community plugins**, then enable **Finance** in the installed plugins list.

## Development

Install dependencies and start the esbuild watch process:

```sh
npm install
npm run dev
```

Build the production plugin bundle:

```sh
npm run build
```

Run the store tests:

```sh
npm test
```

## Privacy

Finance data is stored locally in the user's Obsidian Vault. Personal finance data and `data.json` must not be committed to this repository. Local data files and backup files are excluded by `.gitignore`; review staged files before committing or publishing.
