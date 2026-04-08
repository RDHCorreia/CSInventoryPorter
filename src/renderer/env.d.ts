// Type declarations for the preload API exposed on window.csinventoryporter
import type { CSInventoryPorterAPI } from '../preload/index';

declare global {
  interface Window {
    csinventoryporter: CSInventoryPorterAPI;
  }
}
