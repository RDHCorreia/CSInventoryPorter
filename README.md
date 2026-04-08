# CSInventoryPorter

CSInventoryPorter is a desktop application built with Electron, React, and TypeScript designed to seamlessly manage your Counter-Strike 2 inventory. 
It securely connects to your Steam account and the CS2 Game Coordinator, giving you powerful tools to oversee your items, prices, storage units, and trades.
It is inspired by various projects such as Skinledger (https://skinledger.com/), casemove (https://github.com/nombersDev/casemove), and an honorable mention to ByMyKel (https://bymykel.com/) which provides various useful repositories.
Another mention this project was relied heavily on AI assistance, which was used to generate code snippets, optimize algorithms, and provide guidance on best practices throughout the development process.
Feel free to fork the project, contribute, or report any issues you encounter. Your feedback is invaluable in making CSInventoryPorter the best tool for CS2 inventory management. 
Email: rafaeldhcorreia@gmail.com

## Features

- **Steam Integration:** Login and secure session handling with support for saved accounts.
- **Inventory Management:** Connects to the CS2 Game Coordinator to comprehensively load your inventory.
- **Storage Units:** Read the contents of your storage units, mass-move items in and out, and rename units easily.
- **Economy & Value:** Automated price fetching and portfolio valuation tracking.
- **Market & Trading:** Manage Steam Market listings, send trade offers, and handle friend/inventory trading flows.
- **Investing & Trade-ups:** Helpful workflows for tracking investments and calculating trade-up contracts.

## Requirements

- **Node.js**: Recommended to use v18 or newer.
- **npm** (comes with Node.js)
- A valid Steam account with Counter-Strike 2.

## Build and Run

To compile and launch CSInventoryPorter locally, follow these steps:

1. **Clone the repository** and navigate to the project root directory.

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start development mode**: 
   Launches the Vite dev server and opens the Electron app natively.
   ```bash
   npm run dev
   ```

4. **Build for production**: 
   Compiles all frontend and backend assets.
   ```bash
   npm run build
   ```

5. **Create a Windows Installer**:
   To package the compiled app into an installer (`.exe`) via `electron-builder`:
   ```bash
   npm run package
   ```
   *The installer and unpacked artifacts will be generated in the `release/` or `dist/` directory.*

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details. You are free to use, modify, and distribute this software, but you must include the original copyright and permission notice in any copies or substantial portions of the software, thereby citing the original author.
