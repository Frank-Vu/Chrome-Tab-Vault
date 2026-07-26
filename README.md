# Chrome Tab Vault

A small, local-only Manifest V3 extension for exporting & importing tabs, including tab groups, order, pinned state, and window layout in Chrome and other Chromium-based desktop browsers.

## Features

- Export the current window or all windows available in the current browser mode.
- Export as JSON or TXT format. By default, unencrypted in normal window and encrypted in incognito mode.
- Optionally encrypt either format locally with a password before download.
- Detect encrypted JSON and TXT backups automatically and decrypt them locally during import.
- Protect encrypted content with AES-256-GCM and a password-derived PBKDF2-SHA-256 key.
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
3. Optional: enable **Encrypt exported backup**. Encryption is disabled by default.
4. Choose **Export JSON** or **Export TXT**.
5. If encryption is enabled, create and confirm a password when prompted.

JSON is the most straightforward full-fidelity backup. The extension's own TXT format also retains groups and tab metadata while remaining readable in a text editor.

Encrypted JSON remains a JSON encryption envelope. Encrypted TXT starts with a recognizable Chrome Tab Vault header; its tab URLs, titles, groups, and other backup metadata are encrypted. The password is never stored, so an encrypted backup cannot be restored if its password is lost.

### Import

1. Open the extension in the mode where the tabs should be restored: normal or Incognito.
2. Select **New window(s)** or **Append to current window**.
3. Click **Choose backup and restore**.
4. Select the JSON or TXT backup.
5. If the backup is encrypted, enter its password when prompted.

Importing into the current window does not close existing tabs. If a backup contains multiple windows, their tabs are appended sequentially when using the current-window option.

## Privacy and limitations

- Encryption and decryption use Chromium's local Web Crypto API. Backup contents and passwords are never uploaded or saved by the extension.
- Unencrypted exports are ordinary files that contain tab URLs and titles. Store them carefully, especially when they came from Incognito.
- Encryption protects the downloaded backup file, not tabs while they are open in Chromium. Anyone with the password can decrypt the file.
- Browser-internal pages, pages belonging to another extension, or URLs blocked by Chromium may not reopen. The extension reports how many tabs failed.
- Chromium does not expose complete back/forward history, page form state, cookies, login sessions, split-view layout, or every browser-specific tab feature through these APIs, so those are not backed up.
- A page may require you to sign in again when restored.
