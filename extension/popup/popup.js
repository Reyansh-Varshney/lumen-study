/**
 * Lumen Focus — popup controller
 *
 * Reads/writes chrome.storage.sync. The content script and service worker both
 * subscribe to storage changes, so no message passing is required.
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

const APP_URL = 'http://localhost:5173';

const masterEl = document.getElementById('enabled');
const optionsEl = document.getElementById('options');
const rows = [...document.querySelectorAll('[data-key]')];

/** Visual state: when the master switch is off, the options are inert. */
function reflectMasterState(enabled) {
  optionsEl.classList.toggle('is-disabled', !enabled);
}

function render(settings) {
  masterEl.checked = Boolean(settings.enabled);
  reflectMasterState(settings.enabled);
  for (const row of rows) {
    row.checked = Boolean(settings[row.dataset.key]);
  }
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  render({ ...DEFAULTS, ...stored });
}

masterEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: masterEl.checked });
  reflectMasterState(masterEl.checked);
});

for (const row of rows) {
  row.addEventListener('change', () => {
    chrome.storage.sync.set({ [row.dataset.key]: row.checked });
  });
}

document.getElementById('open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: APP_URL });
});

load();
