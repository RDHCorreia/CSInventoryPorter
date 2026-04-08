# CSInventoryPorter

Desktop CS2 inventory manager built with Electron + React + TypeScript.

## Current scope

Implemented in general:
- Steam login and account session handling (including saved accounts).
- CS2 Game Coordinator connection and inventory loading.
- Storage unit operations (load contents, move items in bulk, rename unit).
- Price fetching and portfolio views.
- Market listings management.
- Trading flow (friends, inventories, offers).
- Investments and trade-up workflows.
- App settings and currency handling.

Temporarily removed from active app flow while simplifying:
- Store service/page.
- Armory service/page.

## Tech stack

- Electron
- React
- TypeScript
- Vite (electron-vite)
- Tailwind CSS
- steam-user + globaloffensive

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start development mode:

```bash
npm run dev
```

## Build

Create production build output:

```bash
npm run build
```

## Create Windows installer

Build and package with electron-builder:

```bash
npm run package
```

Installer artifacts are generated under the `release/` folder.

## Notes

- Main source code is under `src/`.
- Packaged app output is under `release/win-unpacked/`.
