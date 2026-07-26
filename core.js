(function attachTabVaultCore(globalObject) {
  'use strict';

  const FORMAT = 'chrome-tab-vault';
  const VERSION = '1.6.1';
  const VALID_COLORS = new Set([
    'grey', 'blue', 'red', 'yellow', 'green',
    'pink', 'purple', 'cyan', 'orange'
  ]);

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function asBoolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function asText(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function normalizeUrl(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }

  function normalizeGroup(group, fallbackKey) {
    if (!isObject(group)) {
      return null;
    }

    const key = asText(group.key, fallbackKey);
    if (!key) {
      return null;
    }

    const color = VALID_COLORS.has(group.color) ? group.color : 'grey';
    return {
      key,
      title: asText(group.title),
      color,
      collapsed: asBoolean(group.collapsed)
    };
  }

  function normalizeTab(tab) {
    if (typeof tab === 'string') {
      const url = normalizeUrl(tab);
      return url ? {
        url,
        title: '',
        pinned: false,
        active: false,
        muted: false,
        discarded: false,
        autoDiscardable: true,
        groupKey: null
      } : null;
    }

    if (!isObject(tab)) {
      return null;
    }

    const url = normalizeUrl(tab.url || tab.pendingUrl);
    if (!url) {
      return null;
    }

    return {
      url,
      title: asText(tab.title),
      pinned: asBoolean(tab.pinned),
      active: asBoolean(tab.active),
      muted: asBoolean(tab.muted),
      discarded: asBoolean(tab.discarded),
      autoDiscardable: asBoolean(tab.autoDiscardable, true),
      groupKey: typeof tab.groupKey === 'string' && tab.groupKey ? tab.groupKey : null
    };
  }

  function normalizeWindow(windowData, index = 0) {
    const source = isObject(windowData) ? windowData : {};
    const rawTabs = Array.isArray(source.tabs) ? source.tabs : [];
    const tabs = rawTabs.map(normalizeTab).filter(Boolean);

    const groups = {};
    if (isObject(source.groups)) {
      for (const [key, value] of Object.entries(source.groups)) {
        const group = normalizeGroup(value, key);
        if (group) {
          groups[group.key] = {
            title: group.title,
            color: group.color,
            collapsed: group.collapsed
          };
        }
      }
    } else if (Array.isArray(source.groups)) {
      for (const value of source.groups) {
        const group = normalizeGroup(value, `g${Object.keys(groups).length + 1}`);
        if (group) {
          groups[group.key] = {
            title: group.title,
            color: group.color,
            collapsed: group.collapsed
          };
        }
      }
    }

    for (const tab of tabs) {
      if (tab.groupKey && !groups[tab.groupKey]) {
        groups[tab.groupKey] = {
          title: '',
          color: 'grey',
          collapsed: false
        };
      }
    }

    const allowedStates = new Set(['normal', 'minimized', 'maximized', 'fullscreen']);
    return {
      state: allowedStates.has(source.state) ? source.state : 'normal',
      focused: asBoolean(source.focused, index === 0),
      tabs,
      groups
    };
  }

  function normalizeArchive(input) {
    let source = input;

    if (Array.isArray(source)) {
      source = {
        windows: [{ tabs: source }]
      };
    }

    if (!isObject(source)) {
      throw new Error('The backup is not a valid JSON object or URL list.');
    }

    if (!Array.isArray(source.windows)) {
      if (Array.isArray(source.tabs)) {
        source = { ...source, windows: [{ tabs: source.tabs, groups: source.groups }] };
      } else {
        throw new Error('The backup does not contain a windows or tabs array.');
      }
    }

    const windows = source.windows.map(normalizeWindow).filter((windowData) => windowData.tabs.length > 0);
    if (windows.length === 0) {
      throw new Error('No restorable tab URLs were found in the backup.');
    }

    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: asText(source.exportedAt, new Date().toISOString()),
      source: {
        incognito: isObject(source.source) && typeof source.source.incognito === 'boolean'
          ? source.source.incognito
          : null,
        scope: isObject(source.source) ? asText(source.source.scope, 'unknown') : 'unknown'
      },
      windows
    };
  }

  function archiveToTxt(archiveInput) {
    const archive = normalizeArchive(archiveInput);
    const lines = [
      '# Chrome Tab Vault TXT v1',
      `# @archive ${JSON.stringify({
        exportedAt: archive.exportedAt,
        incognito: archive.source.incognito,
        scope: archive.source.scope
      })}`,
      '# Lines beginning with # are metadata. Other non-empty lines are tab URLs.',
      ''
    ];

    archive.windows.forEach((windowData, windowIndex) => {
      lines.push(`# @window ${JSON.stringify({
        number: windowIndex + 1,
        state: windowData.state,
        focused: windowData.focused
      })}`);

      let lastGroupKey = Symbol('initial');
      for (const tab of windowData.tabs) {
        if (tab.groupKey !== lastGroupKey) {
          if (tab.groupKey && windowData.groups[tab.groupKey]) {
            const group = windowData.groups[tab.groupKey];
            lines.push(`# @group ${JSON.stringify({
              key: tab.groupKey,
              title: group.title,
              color: group.color,
              collapsed: group.collapsed
            })}`);
          } else {
            lines.push('# @ungrouped');
          }
          lastGroupKey = tab.groupKey;
        }

        lines.push(`# @tab ${JSON.stringify({
          title: tab.title,
          pinned: tab.pinned,
          active: tab.active,
          muted: tab.muted,
          discarded: tab.discarded,
          autoDiscardable: tab.autoDiscardable
        })}`);
        lines.push(tab.url);
      }

      lines.push('# @endwindow', '');
    });

    return `${lines.join('\n')}\n`;
  }

  function parseJsonSafely(value, context) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid ${context} metadata in TXT backup.`);
    }
  }

  function parseTxt(text) {
    if (typeof text !== 'string') {
      throw new Error('TXT backup content must be text.');
    }

    const archive = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      source: {
        incognito: null,
        scope: 'txt'
      },
      windows: []
    };

    let currentWindow = null;
    let currentGroupKey = null;
    let pendingTabMeta = {};

    const ensureWindow = () => {
      if (!currentWindow) {
        currentWindow = {
          state: 'normal',
          focused: archive.windows.length === 0,
          tabs: [],
          groups: {}
        };
        archive.windows.push(currentWindow);
      }
      return currentWindow;
    };

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith('# @archive ')) {
        const metadata = parseJsonSafely(line.slice('# @archive '.length), 'archive');
        if (typeof metadata.exportedAt === 'string') {
          archive.exportedAt = metadata.exportedAt;
        }
        if (typeof metadata.incognito === 'boolean') {
          archive.source.incognito = metadata.incognito;
        }
        if (typeof metadata.scope === 'string') {
          archive.source.scope = metadata.scope;
        }
        continue;
      }

      if (line.startsWith('# @window ')) {
        const metadata = parseJsonSafely(line.slice('# @window '.length), 'window');
        currentWindow = {
          state: metadata.state,
          focused: metadata.focused,
          tabs: [],
          groups: {}
        };
        archive.windows.push(currentWindow);
        currentGroupKey = null;
        pendingTabMeta = {};
        continue;
      }

      if (line === '# @endwindow') {
        currentWindow = null;
        currentGroupKey = null;
        pendingTabMeta = {};
        continue;
      }

      if (line.startsWith('# @group ')) {
        const metadata = parseJsonSafely(line.slice('# @group '.length), 'group');
        const windowData = ensureWindow();
        const group = normalizeGroup(metadata, `g${Object.keys(windowData.groups).length + 1}`);
        if (group) {
          currentGroupKey = group.key;
          windowData.groups[group.key] = {
            title: group.title,
            color: group.color,
            collapsed: group.collapsed
          };
        }
        continue;
      }

      if (line === '# @ungrouped') {
        ensureWindow();
        currentGroupKey = null;
        continue;
      }

      if (line.startsWith('# @tab ')) {
        pendingTabMeta = parseJsonSafely(line.slice('# @tab '.length), 'tab');
        continue;
      }

      if (line.startsWith('#')) {
        continue;
      }

      const windowData = ensureWindow();
      const tab = normalizeTab({
        ...pendingTabMeta,
        url: line,
        groupKey: currentGroupKey
      });
      if (tab) {
        windowData.tabs.push(tab);
      }
      pendingTabMeta = {};
    }

    return normalizeArchive(archive);
  }

  const api = {
    FORMAT,
    VERSION,
    VALID_COLORS,
    archiveToTxt,
    normalizeArchive,
    normalizeUrl,
    parseTxt
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    globalObject.TabVaultCore = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
