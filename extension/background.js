/**
 * Lumen Focus — background service worker (Manifest V3)
 *
 * Responsibilities:
 *  - Seed default settings on install/update so the popup never reads undefined.
 *  - Handle the Alt+P keyboard command by toggling the master switch.
 *  - Keep the toolbar badge in sync with the enabled state.
 */

const DEFAULTS = {
  enabled: true,
  hideRecommendations: true,
  hideComments: true,
  hideShorts: true,
  hideMasthead: true,
  blockHomeFeed: true,
  cinemaMode: true,
  dimMode: false,
};

/** Read settings, falling back to defaults for any missing key. */
async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

/** Reflect the master switch on the toolbar badge. */
async function syncBadge() {
  const { enabled } = await getSettings();
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
  await chrome.action.setTitle({
    title: enabled ? 'Lumen Focus — ON (Alt+P)' : 'Lumen Focus — OFF (Alt+P)',
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...DEFAULTS, ...stored });
  await syncBadge();
});

chrome.runtime.onStartup.addListener(syncBadge);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-focus-mode') return;
  const { enabled } = await getSettings();
  await chrome.storage.sync.set({ enabled: !enabled });
  await syncBadge();
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') syncBadge();
});
