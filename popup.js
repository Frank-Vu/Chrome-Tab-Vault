'use strict';

const {
  FORMAT,
  VERSION,
  archiveToTxt,
  normalizeArchive,
  normalizeUrl,
  parseTxt
} = globalThis.TabVaultCore;

const {
  MIN_PASSWORD_LENGTH,
  decryptBackupContent,
  encryptBackupContent,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope
} = globalThis.TabVaultCrypto;

const TAB_GROUP_ID_NONE = -1;

const elements = {
  contextBadge: document.getElementById('contextBadge'),
  exportScope: document.getElementById('exportScope'),
  encryptExport: document.getElementById('encryptExport'),
  exportJson: document.getElementById('exportJson'),
  exportTxt: document.getElementById('exportTxt'),
  importTarget: document.getElementById('importTarget'),
  chooseFile: document.getElementById('chooseFile'),
  fileInput: document.getElementById('fileInput'),
  status: document.getElementById('status'),
  passwordDialog: document.getElementById('passwordDialog'),
  passwordForm: document.getElementById('passwordForm'),
  passwordTitle: document.getElementById('passwordTitle'),
  passwordDescription: document.getElementById('passwordDescription'),
  passwordInput: document.getElementById('passwordInput'),
  passwordConfirmGroup: document.getElementById('passwordConfirmGroup'),
  passwordConfirm: document.getElementById('passwordConfirm'),
  passwordError: document.getElementById('passwordError'),
  passwordCancel: document.getElementById('passwordCancel'),
  passwordSubmit: document.getElementById('passwordSubmit'),
  reviewDialog: document.getElementById('reviewDialog'),
  reviewForm: document.getElementById('reviewForm'),
  reviewTitle: document.getElementById('reviewTitle'),
  reviewDescription: document.getElementById('reviewDescription'),
  reviewWarning: document.getElementById('reviewWarning'),
  reviewSelectAllOption: document.getElementById('reviewSelectAllOption'),
  reviewSelectAll: document.getElementById('reviewSelectAll'),
  reviewSelectionSummary: document.getElementById('reviewSelectionSummary'),
  reviewList: document.getElementById('reviewList'),
  reviewCancel: document.getElementById('reviewCancel'),
  reviewSubmit: document.getElementById('reviewSubmit')
};

let contextIsIncognito = false;
let passwordRequest = null;
let reviewRequest = null;

void initialize();

async function initialize() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    contextIsIncognito = Boolean(currentWindow.incognito);
    elements.encryptExport.checked = contextIsIncognito;
    elements.contextBadge.textContent = contextIsIncognito ? `😎 Incognito · v${VERSION}` : `😊 Normal · v${VERSION}`;
    elements.contextBadge.classList.toggle('incognito', contextIsIncognito);
  } catch (error) {
    showStatus(`Could not detect browser mode: ${error.message}`, 'error');
  }

  elements.exportJson.addEventListener('click', () => void exportBackup('json'));
  elements.exportTxt.addEventListener('click', () => void exportBackup('txt'));
  elements.chooseFile.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => void importSelectedFile());
  elements.passwordForm.addEventListener('submit', handlePasswordSubmit);
  elements.passwordCancel.addEventListener('click', () => finishPasswordRequest(null));
  elements.passwordDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishPasswordRequest(null);
  });
  elements.reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    finishArchiveReview(true);
  });
  elements.reviewSelectAll.addEventListener('change', toggleAllReviewTabs);
  elements.reviewList.addEventListener('change', (event) => {
    if (event.target.classList.contains('review-tab-checkbox')) {
      updateReviewSelection();
    }
  });
  elements.reviewCancel.addEventListener('click', () => finishArchiveReview(false));
  elements.reviewDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishArchiveReview(false);
  });
}

function setBusy(isBusy) {
  for (const control of [
    elements.exportScope,
    elements.encryptExport,
    elements.exportJson,
    elements.exportTxt,
    elements.importTarget,
    elements.chooseFile
  ]) {
    control.disabled = isBusy;
  }
}

function showStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.className = `status visible ${kind}`.trim();
}

function clearStatus() {
  elements.status.textContent = '';
  elements.status.className = 'status';
}

function requestPassword(options) {
  elements.passwordTitle.textContent = options.title;
  elements.passwordDescription.textContent = options.description;
  elements.passwordSubmit.textContent = options.submitLabel;
  elements.passwordConfirmGroup.hidden = !options.confirmPassword;
  elements.passwordConfirm.required = options.confirmPassword;
  elements.passwordInput.autocomplete = options.confirmPassword ? 'new-password' : 'current-password';
  elements.passwordConfirm.autocomplete = 'new-password';
  elements.passwordInput.value = '';
  elements.passwordConfirm.value = '';
  elements.passwordError.textContent = '';

  return new Promise((resolve) => {
    passwordRequest = { resolve, options };
    elements.passwordDialog.showModal();
    window.setTimeout(() => elements.passwordInput.focus(), 0);
  });
}

function handlePasswordSubmit(event) {
  event.preventDefault();
  if (!passwordRequest) {
    return;
  }

  const password = elements.passwordInput.value;
  const minimumLength = passwordRequest.options.minimumLength || 1;
  if (Array.from(password).length < minimumLength) {
    elements.passwordError.textContent = minimumLength === 1
      ? 'Enter the backup password.'
      : `Use at least ${minimumLength} characters.`;
    elements.passwordInput.focus();
    return;
  }

  if (
    passwordRequest.options.confirmPassword &&
    password !== elements.passwordConfirm.value
  ) {
    elements.passwordError.textContent = 'The passwords do not match.';
    elements.passwordConfirm.focus();
    return;
  }

  finishPasswordRequest(password);
}

function finishPasswordRequest(result) {
  if (!passwordRequest) {
    return;
  }

  const { resolve } = passwordRequest;
  passwordRequest = null;
  elements.passwordInput.value = '';
  elements.passwordConfirm.value = '';
  elements.passwordError.textContent = '';
  if (elements.passwordDialog.open) {
    elements.passwordDialog.close();
  }
  resolve(result);
}

function archiveTabCount(archive) {
  return archive.windows.reduce((sum, windowData) => sum + windowData.tabs.length, 0);
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function createReviewTag(label) {
  const tag = document.createElement('span');
  tag.className = 'review-tab-tag';
  tag.textContent = label;
  return tag;
}

function renderArchiveReview(archive, selectable) {
  const windowSections = archive.windows.map((windowData, windowIndex) => {
    const section = document.createElement('section');
    section.className = 'review-window';

    const heading = document.createElement('h3');
    heading.className = 'review-window-title';
    const windowLabel = `Window ${windowIndex + 1} · ${countLabel(windowData.tabs.length, 'tab')}`;
    if (selectable && windowIndex === 0) {
      heading.classList.add('has-select-all');
      heading.appendChild(elements.reviewSelectAllOption);
    } else {
      heading.textContent = windowLabel;
    }
    section.appendChild(heading);

    const list = document.createElement('ol');
    list.className = 'review-tabs';

    for (const [tabIndex, tab] of windowData.tabs.entries()) {
      const item = document.createElement('li');
      item.className = 'review-tab';
      item.title = tab.url;

      const content = document.createElement(selectable ? 'label' : 'span');
      content.className = 'review-tab-content';

      if (selectable) {
        const checkbox = document.createElement('input');
        checkbox.id = `review-tab-${windowIndex}-${tabIndex}`;
        checkbox.className = 'review-tab-checkbox';
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.windowIndex = String(windowIndex);
        checkbox.dataset.tabIndex = String(tabIndex);
        checkbox.setAttribute('aria-label', `Include ${tab.title || tab.url}`);
        content.htmlFor = checkbox.id;
        item.classList.add('selectable');
        item.appendChild(checkbox);
      }

      const title = document.createElement('span');
      title.className = 'review-tab-title';
      title.textContent = tab.title || 'Untitled tab';
      content.appendChild(title);

      const url = document.createElement('span');
      url.className = 'review-tab-url';
      url.textContent = tab.url;
      content.appendChild(url);

      const group = tab.groupKey && windowData.groups[tab.groupKey];
      if (tab.pinned || group) {
        const metadata = document.createElement('span');
        metadata.className = 'review-tab-meta';
        if (tab.pinned) {
          metadata.appendChild(createReviewTag('Pinned'));
        }
        if (group) {
          metadata.appendChild(createReviewTag(group.title || 'Unnamed group'));
        }
        content.appendChild(metadata);
      }

      item.appendChild(content);
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  });

  elements.reviewList.replaceChildren(...windowSections);
  elements.reviewList.scrollTop = 0;
}

function reviewTabCheckboxes() {
  return [...elements.reviewList.querySelectorAll('.review-tab-checkbox')];
}

function updateReviewSelection() {
  const checkboxes = reviewTabCheckboxes();
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  elements.reviewSelectAll.checked = selectedCount === checkboxes.length;
  elements.reviewSelectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  elements.reviewSelectionSummary.textContent = `${selectedCount} of ${checkboxes.length} selected`;
  elements.reviewSubmit.disabled = selectedCount === 0;
}

function toggleAllReviewTabs() {
  for (const checkbox of reviewTabCheckboxes()) {
    checkbox.checked = elements.reviewSelectAll.checked;
  }
  updateReviewSelection();
}

function selectedArchive(archive) {
  const selectedTabsByWindow = new Map();
  for (const checkbox of reviewTabCheckboxes()) {
    if (!checkbox.checked) {
      continue;
    }

    const windowIndex = Number(checkbox.dataset.windowIndex);
    if (!selectedTabsByWindow.has(windowIndex)) {
      selectedTabsByWindow.set(windowIndex, new Set());
    }
    selectedTabsByWindow.get(windowIndex).add(Number(checkbox.dataset.tabIndex));
  }

  const windows = archive.windows.flatMap((windowData, windowIndex) => {
    const selectedIndexes = selectedTabsByWindow.get(windowIndex);
    if (!selectedIndexes) {
      return [];
    }

    const tabs = windowData.tabs.filter((tab, tabIndex) => selectedIndexes.has(tabIndex));
    const usedGroupKeys = new Set(tabs.map((tab) => tab.groupKey).filter(Boolean));
    const groups = Object.fromEntries(
      Object.entries(windowData.groups).filter(([groupKey]) => usedGroupKeys.has(groupKey))
    );
    return [{ ...windowData, tabs, groups }];
  });

  return { ...archive, windows };
}

function requestArchiveReview(options) {
  elements.reviewTitle.textContent = options.title;
  elements.reviewDescription.textContent = options.description;
  elements.reviewSubmit.textContent = options.submitLabel;
  elements.reviewWarning.textContent = options.warning || '';
  elements.reviewWarning.hidden = !options.warning;
  elements.reviewSelectAllOption.hidden = !options.selectable;
  elements.reviewSelectAll.checked = true;
  elements.reviewSelectAll.indeterminate = false;
  elements.reviewSubmit.disabled = false;
  renderArchiveReview(options.archive, Boolean(options.selectable));
  if (options.selectable) {
    updateReviewSelection();
  }

  return new Promise((resolve) => {
    reviewRequest = {
      resolve,
      archive: options.archive,
      selectable: Boolean(options.selectable)
    };
    elements.reviewDialog.showModal();
    window.setTimeout(() => {
      const initialControl = options.selectable
        ? elements.reviewSelectAll
        : elements.reviewSubmit;
      initialControl.focus();
    }, 0);
  });
}

function finishArchiveReview(confirmed) {
  if (!reviewRequest) {
    return;
  }

  const { resolve, archive, selectable } = reviewRequest;
  const result = confirmed
    ? (selectable ? selectedArchive(archive) : archive)
    : null;
  if (confirmed && selectable && result.windows.length === 0) {
    updateReviewSelection();
    return;
  }

  reviewRequest = null;
  if (elements.reviewDialog.open) {
    elements.reviewDialog.close();
  }
  resolve(result);
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportBackup(format) {
  clearStatus();
  setBusy(true);

  try {
    const scope = elements.exportScope.value;
    showStatus('Collecting tabs for review…');
    const collectedArchive = await collectArchive(scope);
    const availableTabs = archiveTabCount(collectedArchive);
    clearStatus();

    const archive = await requestArchiveReview({
      archive: collectedArchive,
      title: `Review ${format.toUpperCase()} export`,
      description: `${countLabel(availableTabs, 'tab')} from ${countLabel(collectedArchive.windows.length, 'window')} are available.`,
      submitLabel: `Export ${format.toUpperCase()}`,
      selectable: true
    });
    if (!archive) {
      showStatus('Export cancelled.');
      return;
    }
    const totalTabs = archiveTabCount(archive);

    const shouldEncrypt = elements.encryptExport.checked;
    let password = null;
    if (shouldEncrypt) {
      password = await requestPassword({
        title: 'Encrypt backup',
        description: 'Create a password for this backup. You will need it whenever you restore the file.',
        submitLabel: 'Encrypt and export',
        confirmPassword: true,
        minimumLength: MIN_PASSWORD_LENGTH
      });
      if (password === null) {
        showStatus('Export cancelled.');
        return;
      }
    }

    const timestamp = safeFilePart(new Date().toISOString());
    const mode = contextIsIncognito ? 'incognito' : 'normal';
    const encryptedSuffix = shouldEncrypt ? '-encrypted' : '';
    const filename = `chrome-tabs-${mode}${encryptedSuffix}-${timestamp}.${format}`;
    const mimeType = format === 'json' ? 'application/json' : 'text/plain';
    const plaintext = format === 'json'
      ? `${JSON.stringify(archive, null, 2)}\n`
      : archiveToTxt(archive);
    let content = plaintext;

    if (shouldEncrypt) {
      showStatus('Encrypting backup locally…');
      const envelope = await encryptBackupContent(plaintext, password, format);
      content = serializeEncryptedEnvelope(envelope, format);
    }

    triggerDownload(content, filename, mimeType);
    const action = shouldEncrypt ? 'Exported and encrypted' : 'Exported';
    showStatus(`${action} ${totalTabs} tab${totalTabs === 1 ? '' : 's'} from ${archive.windows.length} window${archive.windows.length === 1 ? '' : 's'}.`, 'success');
  } catch (error) {
    showStatus(`Export failed: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function collectArchive(scope) {
  let browserWindows;
  if (scope === 'all') {
    browserWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  } else {
    browserWindows = [await chrome.windows.getCurrent({ populate: true })];
  }

  browserWindows = browserWindows
    .filter((browserWindow) => browserWindow.type === 'normal')
    .sort((left, right) => Number(right.focused) - Number(left.focused));

  if (browserWindows.length === 0) {
    throw new Error('No normal browser windows are available in this mode.');
  }

  const windows = [];
  for (let windowIndex = 0; windowIndex < browserWindows.length; windowIndex += 1) {
    const browserWindow = browserWindows[windowIndex];
    const tabs = [...(browserWindow.tabs || [])].sort((left, right) => left.index - right.index);
    const browserGroups = await chrome.tabGroups.query({ windowId: browserWindow.id });
    const browserGroupMap = new Map(browserGroups.map((group) => [group.id, group]));
    const groupIdToKey = new Map();
    const groups = {};

    for (const tab of tabs) {
      if (tab.groupId === TAB_GROUP_ID_NONE || groupIdToKey.has(tab.groupId)) {
        continue;
      }

      const group = browserGroupMap.get(tab.groupId);
      if (!group) {
        continue;
      }

      const groupKey = `g${groupIdToKey.size + 1}`;
      groupIdToKey.set(tab.groupId, groupKey);
      groups[groupKey] = {
        title: group.title || '',
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed)
      };
    }

    windows.push({
      state: browserWindow.state || 'normal',
      focused: Boolean(browserWindow.focused),
      left: browserWindow.left,
      top: browserWindow.top,
      width: browserWindow.width,
      height: browserWindow.height,
      tabs: tabs.map((tab) => ({
        url: tab.pendingUrl || tab.url || 'about:blank',
        title: tab.title || '',
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        muted: Boolean(tab.mutedInfo && tab.mutedInfo.muted),
        discarded: Boolean(tab.discarded),
        autoDiscardable: tab.autoDiscardable !== false,
        groupKey: groupIdToKey.get(tab.groupId) || null
      })),
      groups
    });
  }

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      browser: navigator.userAgent,
      incognito: contextIsIncognito,
      scope: scope === 'all' ? 'all-windows' : 'current-window'
    },
    windows
  };
}

async function importSelectedFile() {
  const file = elements.fileInput.files && elements.fileInput.files[0];
  if (!file) {
    return;
  }

  clearStatus();
  setBusy(true);

  try {
    const text = await file.text();
    const encryptedEnvelope = parseEncryptedEnvelope(text);
    let backupText = text;
    let formatHint = null;

    if (encryptedEnvelope) {
      const password = await requestPassword({
        title: 'Unlock encrypted backup',
        description: `Enter the password used to encrypt ${file.name}.`,
        submitLabel: 'Decrypt and review',
        confirmPassword: false,
        minimumLength: 1
      });
      if (password === null) {
        showStatus('Import cancelled.');
        return;
      }

      showStatus('Decrypting backup locally…');
      const decrypted = await decryptBackupContent(encryptedEnvelope, password);
      backupText = decrypted.plaintext;
      formatHint = decrypted.payloadFormat;
    }

    const archive = parseBackup(file.name, backupText, formatHint);
    const target = elements.importTarget.value;
    const totalTabs = archiveTabCount(archive);
    const targetIsCurrent = target === 'current';
    const shouldContinue = await requestArchiveReview({
      archive,
      title: 'Review tabs to import',
      description: `${file.name} contains ${countLabel(totalTabs, 'tab')} across ${countLabel(archive.windows.length, 'window')}.`,
      submitLabel: targetIsCurrent
        ? `Append ${countLabel(totalTabs, 'tab')}`
        : `Open ${countLabel(archive.windows.length, 'new window')}`,
      warning: archive.source.incognito === true && !contextIsIncognito
        ? 'This backup came from Incognito. Continuing here will open its URLs in normal windows and may add them to normal browser history.'
        : ''
    });
    if (!shouldContinue) {
      const incognitoSuggestion = archive.source.incognito === true && !contextIsIncognito
        ? ' Open an Incognito window and run the extension there to restore privately.'
        : '';
      showStatus(`Import cancelled.${incognitoSuggestion}`);
      return;
    }

    const result = target === 'current'
      ? await restoreIntoCurrentWindow(archive)
      : await restoreIntoNewWindows(archive);

    const details = [
      `Restored ${result.created} tab${result.created === 1 ? '' : 's'}`,
      `${result.groups} group${result.groups === 1 ? '' : 's'}`
    ];

    if (result.failed > 0) {
      details.push(`${result.failed} tab${result.failed === 1 ? '' : 's'} could not be opened`);
    }

    showStatus(`${details.join(', ')}.`, result.created > 0 ? 'success' : 'error');
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, 'error');
  } finally {
    elements.fileInput.value = '';
    setBusy(false);
  }
}

function parseBackup(filename, text, formatHint = null) {
  const looksLikeJson = formatHint === 'json' || (
    formatHint === null &&
    (filename.toLowerCase().endsWith('.json') || /^[\s\r\n]*[\[{]/.test(text))
  );
  if (looksLikeJson) {
    try {
      return normalizeArchive(JSON.parse(text));
    } catch (error) {
      if (formatHint === 'json' || filename.toLowerCase().endsWith('.json')) {
        throw new Error(`Invalid JSON backup: ${error.message}`);
      }
    }
  }

  return parseTxt(text);
}

async function restoreIntoNewWindows(archive) {
  const totals = { created: 0, failed: 0, groups: 0 };
  const restoredWindows = [];

  for (const windowData of archive.windows) {
    const targetWindow = await chrome.windows.create({
      url: 'about:blank',
      incognito: contextIsIncognito,
      focused: false
    });

    const placeholderTabs = await chrome.tabs.query({ windowId: targetWindow.id });
    const placeholderTabId = placeholderTabs[0] && placeholderTabs[0].id;
    const result = await restoreWindowData(windowData, targetWindow.id, {
      append: false,
      placeholderTabId,
      activateExportedTab: true
    });

    totals.created += result.created;
    totals.failed += result.failed;
    totals.groups += result.groups;
    restoredWindows.push({ id: targetWindow.id, data: windowData });
  }

  const preferredWindow =
    restoredWindows.find((entry) => entry.data.focused) ||
    restoredWindows[0];

  // Restore states without changing focus.
  for (const entry of restoredWindows) {
    let state = entry.data.state || 'normal';

    // A minimized window cannot subsequently be focused.
    if (entry.id === preferredWindow.id && state === 'minimized') {
      state = 'normal';
    }

    try {
      await chrome.windows.update(entry.id, { state });
    } catch (error) {
      console.warn('Could not restore window state:', error);
    }
  }

  // Focus only the preferred window, as a separate operation.
  if (preferredWindow) {
    try {
      await chrome.windows.update(preferredWindow.id, {
        focused: true
      });
    } catch (error) {
      console.warn('Could not focus preferred window:', error);
    }
  }

  return totals;
}

async function restoreIntoCurrentWindow(archive) {
  const targetWindow = await chrome.windows.getCurrent();
  const totals = { created: 0, failed: 0, groups: 0 };

  for (let index = 0; index < archive.windows.length; index += 1) {
    const result = await restoreWindowData(archive.windows[index], targetWindow.id, {
      append: true,
      placeholderTabId: null,
      activateExportedTab: index === archive.windows.length - 1
    });
    totals.created += result.created;
    totals.failed += result.failed;
    totals.groups += result.groups;
  }

  return totals;
}

async function restoreWindowData(windowData, windowId, options) {
  const existingTabs = await chrome.tabs.query({ windowId });
  const insertionStart = options.append ? existingTabs.length : 0;
  const createdTabs = [];
  let failed = 0;

  for (let index = 0; index < windowData.tabs.length; index += 1) {
    const tabData = windowData.tabs[index];
    const url = normalizeUrl(tabData.url);
    if (!url) {
      failed += 1;
      continue;
    }

    try {
      const createdTab = await chrome.tabs.create({
        windowId,
        url,
        active: false,
        pinned: false,
        index: insertionStart + createdTabs.length
      });
      createdTabs.push({
        id: createdTab.id,
        data: tabData,
        originalIndex: index
      });
    } catch (error) {
      console.warn(`Could not restore ${url}:`, error);
      failed += 1;
    }
  }

  if (options.placeholderTabId && createdTabs.length > 0) {
    try {
      await chrome.tabs.remove(options.placeholderTabId);
    } catch (error) {
      console.warn('Could not remove placeholder tab:', error);
    }
  }

  for (const entry of createdTabs) {
    const updateProperties = {
      autoDiscardable: entry.data.autoDiscardable !== false
    };
    if (entry.data.muted) {
      updateProperties.muted = true;
    }

    try {
      await chrome.tabs.update(entry.id, updateProperties);
    } catch (error) {
      console.warn('Could not restore tab properties:', error);
    }
  }

  for (const entry of createdTabs.filter((item) => item.data.pinned)) {
    try {
      await chrome.tabs.update(entry.id, { pinned: true });
    } catch (error) {
      console.warn('Could not pin restored tab:', error);
    }
  }

  const groupedEntries = new Map();
  for (const entry of createdTabs) {
    if (!entry.data.groupKey || entry.data.pinned) {
      continue;
    }
    if (!groupedEntries.has(entry.data.groupKey)) {
      groupedEntries.set(entry.data.groupKey, []);
    }
    groupedEntries.get(entry.data.groupKey).push(entry);
  }

  const groupsInOrder = [...groupedEntries.entries()].sort((left, right) => {
    const leftIndex = Math.min(...left[1].map((entry) => entry.originalIndex));
    const rightIndex = Math.min(...right[1].map((entry) => entry.originalIndex));
    return leftIndex - rightIndex;
  });

  const groupsToCollapse = [];
  let restoredGroups = 0;
  for (const [groupKey, entries] of groupsInOrder) {
    const groupData = windowData.groups[groupKey] || {
      title: '',
      color: 'grey',
      collapsed: false
    };

    try {
      const groupId = await chrome.tabs.group({
        tabIds: entries.map((entry) => entry.id),
        createProperties: { windowId }
      });
      await chrome.tabGroups.update(groupId, {
        title: groupData.title || '',
        color: groupData.color || 'grey',
        collapsed: false
      });
      groupsToCollapse.push({ groupId, collapsed: Boolean(groupData.collapsed) });
      restoredGroups += 1;
    } catch (error) {
      console.warn(`Could not restore group ${groupKey}:`, error);
    }
  }

  let activeEntry = createdTabs.find((entry) => entry.data.active);
  if (!activeEntry && createdTabs.length > 0) {
    activeEntry = createdTabs[0];
  }

  if (options.activateExportedTab && activeEntry) {
    try {
      await chrome.tabs.update(activeEntry.id, { active: true });
    } catch (error) {
      console.warn('Could not activate restored tab:', error);
    }
  }

  for (const group of groupsToCollapse) {
    if (!group.collapsed) {
      continue;
    }
    try {
      await chrome.tabGroups.update(group.groupId, { collapsed: true });
    } catch (error) {
      console.warn('Could not collapse restored group:', error);
    }
  }

  for (const entry of createdTabs) {
    if (!entry.data.discarded || (activeEntry && entry.id === activeEntry.id)) {
      continue;
    }
    try {
      await chrome.tabs.discard(entry.id);
    } catch (error) {
      console.warn('Could not discard restored tab:', error);
    }
  }

  return {
    created: createdTabs.length,
    failed,
    groups: restoredGroups
  };
}