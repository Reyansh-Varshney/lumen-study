/**
 * Lumen Focus — content script
 *
 * Strategy: this script never removes YouTube's DOM. It only toggles classes on
 * <html> and lets content.css do the hiding. That survives YouTube's aggressive
 * re-rendering and is trivially reversible when the user flips a toggle.
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

/** Where "Open Lumen" sends the user. Change if you deploy elsewhere. */
const APP_URL = 'http://localhost:5173';

let settings = { ...DEFAULTS };

/* ------------------------------------------------------------------ helpers */

const isWatchPage = () => location.pathname === '/watch';
const isShortsPage = () => location.pathname.startsWith('/shorts');
const isHomePage = () => location.pathname === '/' || location.pathname === '/index';

/* -------------------------------------------------------------- class sync */

function applyClasses() {
  const root = document.documentElement;
  const on = settings.enabled;

  const flags = {
    'ps-on': on,
    'ps-hide-recs': on && settings.hideRecommendations,
    'ps-hide-comments': on && settings.hideComments,
    'ps-hide-shorts': on && settings.hideShorts,
    'ps-hide-masthead': on && settings.hideMasthead,
    'ps-block-home': on && settings.blockHomeFeed && isHomePage(),
    'ps-on-shorts-page': on && isShortsPage(),
    'ps-dim': on && settings.dimMode,
  };

  for (const [cls, active] of Object.entries(flags)) {
    root.classList.toggle(cls, Boolean(active));
  }
}

/* ------------------------------------------------------------- focus screen */

function removeFocusScreen() {
  document.getElementById('ps-focus-screen')?.remove();
}

function buildFocusScreen() {
  const shell = document.createElement('div');
  shell.id = 'ps-focus-screen';

  const logo = document.createElement('div');
  logo.className = 'ps-logo';
  logo.textContent = 'Lumen Focus';

  const title = document.createElement('h1');
  title.textContent = 'The feed stops here.';

  const copy = document.createElement('p');
  copy.textContent =
    'This is where the algorithm usually decides what you study next. Search for the lecture you actually need, or head back to your dashboard.';

  const actions = document.createElement('div');
  actions.className = 'ps-actions';

  const goBtn = document.createElement('button');
  goBtn.textContent = 'Open Lumen';
  goBtn.addEventListener('click', () => {
    window.location.href = APP_URL;
  });

  const searchBtn = document.createElement('button');
  searchBtn.className = 'ps-ghost';
  searchBtn.textContent = 'Search YouTube';
  searchBtn.addEventListener('click', () => {
    // Masthead is hidden by default; reveal it and focus the search field.
    settings = { ...settings, hideMasthead: false, blockHomeFeed: false };
    chrome.storage.sync.set({ hideMasthead: false, blockHomeFeed: false });
    applyClasses();
  });

  actions.append(goBtn, searchBtn);

  const hint = document.createElement('div');
  hint.className = 'ps-hint';
  hint.append('Press ');
  const kbd = document.createElement('kbd');
  kbd.textContent = 'Alt+P';
  hint.append(kbd, ' to turn focus mode off.');

  shell.append(logo, title, copy, actions, hint);
  return shell;
}

function syncFocusScreen() {
  const shouldShow = settings.enabled && settings.blockHomeFeed && isHomePage();

  if (!shouldShow) {
    removeFocusScreen();
    return;
  }
  if (document.body && !document.getElementById('ps-focus-screen')) {
    document.body.appendChild(buildFocusScreen());
  }
}

/* ------------------------------------------------------------------ cinema */

/**
 * YouTube drives theater mode with a `theater` attribute on <ytd-watch-flexy>.
 * We set it ourselves and remember whether the user had it on, so we can hand
 * control back cleanly when the toggle is switched off.
 */
function applyCinema() {
  const want = settings.enabled && settings.cinemaMode && isWatchPage();
  const flexy = document.querySelector('ytd-watch-flexy');

  if (want && flexy) {
    if (!flexy.hasAttribute('ps-cinema-forced')) {
      flexy.setAttribute('ps-cinema-forced', '');
      flexy.dataset.psHadTheater = flexy.hasAttribute('theater') ? '1' : '';
    }
    if (!flexy.hasAttribute('theater')) flexy.setAttribute('theater', '');
    return;
  }

  document.querySelectorAll('ytd-watch-flexy[ps-cinema-forced]').forEach((el) => {
    if (el.dataset.psHadTheater !== '1') el.removeAttribute('theater');
    el.removeAttribute('ps-cinema-forced');
    delete el.dataset.psHadTheater;
  });
}

/* --------------------------------------------------------------- lifecycle */

function applyAll() {
  applyClasses();
  applyCinema();
  syncFocusScreen();
}

/** YouTube is a SPA; every in-app route change re-applies our state. */
function onRouteChange() {
  // Let YouTube finish swapping the DOM before we look for new nodes.
  setTimeout(applyAll, 0);
  setTimeout(applyAll, 350);
}

window.addEventListener('yt-navigate-finish', onRouteChange);
window.addEventListener('yt-page-data-updated', onRouteChange);
window.addEventListener('popstate', onRouteChange);

document.addEventListener('DOMContentLoaded', applyAll);

// Safety net: some route changes only update the URL (pushState) without firing
// a yt-* event. Watch the history API and the body for late-loaded nodes.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    onRouteChange();
  }
}, 500);

// YouTube mutates the DOM constantly; coalesce reactions into one frame so we
// never burn CPU on a content script that runs on every page.
let pending = false;
function scheduleApply() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    applyCinema();
    syncFocusScreen();
  });
}

new MutationObserver(scheduleApply).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

/* ---------------------------------------------------------------- settings */

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  applyAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }
  applyAll();
});

/* Keep React-style apps happy: expose a tiny hook for manual debugging. */
window.__lumenFocus = { applyAll, get settings() { return { ...settings }; } };
