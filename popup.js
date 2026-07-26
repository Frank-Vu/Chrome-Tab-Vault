'use strict';

const {
  FORMAT,
  VERSION,
  archiveToTxt,
  normalizeArchive,
  normalizeUrl,
  parseTxt
} = globalThis.TabVaultCore;

const TAB_GROUP_ID_NONE = -1;

const elements = {
  contextBadge: document.getElementById('contextBadge'),
  exportScope: document.getElementById('exportScope'),
  exportJson: document.getElementById('exportJson'),
  exportTxt: document.getElementById('exportTxt'),
  importTarget: document.getElementById('importTarget'),
  chooseFile: document.getElementById('chooseFile'),
  fileInput: document.getElementById('fileInput'),
  status: document.getElementById('status')
};

let contextIsIncognito = false;

void initialize();

async function initialize() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    contextIsIncognito = Boolean(currentWindow.incognito);
    elements.contextBadge.textContent = contextIsIncognito ? '😎Incognito' : '😊Normal';
    elements.contextBadge.classList.toggle('incognito', contextIsIncognito);
  } catch (error) {
    showStatus(`Could not detect browser mode: ${error.message}`, 'error');
  }

  elements.exportJson.addEventListener('click', () => void exportBackup('json'));
  elements.exportTxt.addEventListener('click', () => void exportBackup('txt'));
  elements.chooseFile.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => void importSelectedFile());
}

function setBusy(isBusy) {
  for (const button of [elements.exportJson, elements.exportTxt, elements.chooseFile]) {
    button.disabled = isBusy;
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
    const archive = await collectArchive(scope);
    const totalTabs = archive.windows.reduce((sum, windowData) => sum + windowData.tabs.length, 0);
    const timestamp = safeFilePart(new Date().toISOString());
    const mode = contextIsIncognito ? 'incognito' : 'normal';
    const extension = format === 'json' ? 'json' : 'txt';
    const filename = `chrome-tabs-${mode}-${timestamp}.${extension}`;

    if (format === 'json') {
      triggerDownload(`${JSON.stringify(archive, null, 2)}\n`, filename, 'application/json');
    } else {
      triggerDownload(archiveToTxt(archive), filename, 'text/plain');
    }

    showStatus(`Exported ${totalTabs} tab${totalTabs === 1 ? '' : 's'} from ${archive.windows.length} window${archive.windows.length === 1 ? '' : 's'}.`, 'success');
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
    const archive = parseBackup(file.name, text);

    if (archive.source.incognito === true && !contextIsIncognito) {
      const continueInNormal = window.confirm(
        'This backup was exported from Incognito. Restoring it here will open those URLs in a normal window and may add them to normal browser history. Continue?'
      );
      if (!continueInNormal) {
        showStatus('Import cancelled. Open an Incognito window and run the extension there to restore privately.');
        return;
      }
    }

    const target = elements.importTarget.value;
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

function parseBackup(filename, text) {
  const looksLikeJson = filename.toLowerCase().endsWith('.json') || /^[\s\r\n]*[\[{]/.test(text);
  if (looksLikeJson) {
    try {
      return normalizeArchive(JSON.parse(text));
    } catch (error) {
      if (filename.toLowerCase().endsWith('.json')) {
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
}