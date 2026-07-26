# Chrome Tab Vault

A small, local-only Manifest V3 extension for exporting & importing tabs in Chrome and other Chromium-based desktop browsers.

## Features

- Export the current window or all windows available in the current browser mode.
- Export as JSON or TXT format.
- Import either format later.
- Preserve tab order, tab groups, group title/color/collapsed state, pinned tabs, muted state, the active tab, and discarded-tab state where Chromium permits it.
- Import an ordinary TXT file containing one URL per line; those URLs will be restored without groups.
- Keep normal and Incognito contexts separate through Chromium's split-incognito mode.
- No server, analytics, account, or network requests.

## Install in Chrome

1. Extract the ZIP file.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `Chrome-tab-vault` folder.
6. Pin **Chrome Tab Vault** to the toolbar if desired.

## Enable Incognito support

1. Open `chrome://extensions`.
2. Open **Details** for Chrome Tab Vault.
3. Enable **Allow in Incognito**.
4. Open the extension from an Incognito window to export or restore Incognito tabs.

The extension uses split Incognito mode. When opened in a normal window, it works only with normal windows. When opened in an Incognito window, it works only with Incognito windows.

## Usage

### Export

1. Open the extension.
2. Select **Current window** or **All windows in this mode**.
3. Choose **Export JSON** or **Export TXT**.

JSON is the most straightforward full-fidelity backup. The extension's own TXT format also retains groups and tab metadata while remaining readable in a text editor.

### Import

1. Open the extension in the mode where the tabs should be restored: normal or Incognito.
2. Select **New window(s)** or **Append to current window**.
3. Click **Choose backup and restore**.
4. Select the JSON or TXT backup.

Importing into the current window does not close existing tabs. If a backup contains multiple windows, their tabs are appended sequentially when using the current-window option.

## Privacy and limitations

- The extension never uploads anything, but an exported backup is an ordinary file that contains tab URLs and titles. Store Incognito exports carefully.
- Browser-internal pages, pages belonging to another extension, or URLs blocked by Chromium may not reopen. The extension reports how many tabs failed.
- Chromium does not expose complete back/forward history, page form state, cookies, login sessions, split-view layout, or every browser-specific tab feature through these APIs, so those are not backed up.
- A page may require you to sign in again when restored.
