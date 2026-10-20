# Lumen Focus — Chrome Extension

A Manifest V3 extension that turns `youtube.com` into a lecture hall instead of a
slot machine. It strips the recommendation rail, end-screen traps, Shorts,
comments and the algorithmic home feed — leaving you with the video you came for.

It pairs with the Lumen platform, but works standalone.

---

## What it does

| Toggle | Effect |
| --- | --- |
| **Master switch** (`Alt+P`) | Turns the whole extension on/off instantly. When off, the extension is completely inert. |
| **Hide recommendations** | Removes the "up next" sidebar, related videos, merch shelf, end-screen cards and the autoplay pause overlay. Gives the player the full width. |
| **Hide comments** | Removes the comment section and its teaser carousel. |
| **Hide Shorts** | Removes Shorts shelves, the Shorts nav entry, and blanks the Shorts player itself. |
| **Hide masthead** | Removes the top bar (search + account chrome) and reclaims the vertical offset YouTube reserves for it. |
| **Block home feed** | Replaces `youtube.com/` with a focus screen: *"The feed stops here."* Includes a **Search YouTube** escape hatch. |
| **Cinema mode** | Forces theatre layout on `/watch` pages by setting YouTube's own `theater` attribute, and restores your original layout when disabled. |
| **Dim the page** | Fades everything except the video to 12% opacity; hover restores full opacity. |

## Install (load unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder

The icon appears in the toolbar. Pin it for one-click access.

Works in any Chromium browser (Chrome, Edge, Brave, Arc). For Firefox, swap
`background.service_worker` for `background.scripts` — everything else works.

## Usage

- Click the toolbar icon to configure.
- Press **Alt+P** anywhere on YouTube to toggle focus mode.
- On a blocked home page, click **Search YouTube** to get the search bar back —
  that permanently flips *Block home feed* off, so you can re-enable it later.
- On a blocked home page, **Open Lumen** jumps straight to your dashboard.

## How it works

The content script **never deletes YouTube's DOM**. It only toggles classes on
`<html>` (`ps-on`, `ps-hide-recs`, …) and `content/content.css` does the hiding.
That matters because YouTube re-renders aggressively — a script that removed
nodes would constantly fight it, and would break on updates.

Settings live in `chrome.storage.sync`, so they follow your Chrome profile.
The content script, popup and service worker all subscribe to storage changes,
so no message passing is needed.

```
extension/
├── manifest.json          MV3 manifest
├── background.js          service worker: defaults, Alt+P command, badge
├── content/
│   ├── content.js         toggles classes, injects the focus screen, cinema mode
│   └── content.css        all hiding rules, scoped under html.ps-on
├── popup/
│   ├── popup.html         settings UI
│   ├── popup.css
│   └── popup.js           reads/writes chrome.storage.sync
└── icons/                 16 / 32 / 48 / 128 px
```

## Configuration

- `APP_URL` in `content/content.js` and `popup/popup.js` — where
  **Open Lumen** points. Defaults to `http://localhost:5173`.

## Known limitations

- **YouTube ads can't be skipped.** Nothing here touches video delivery; it only
  hides page furniture.
- **Shorts blocking hides the player, it doesn't redirect you.** If you land on a
  Shorts URL directly you'll see an empty page with the nav intact — click any
  other link.
- **Cinema mode sets the `theater` attribute directly.** If YouTube changes how
  theatre mode is represented in a future redesign, this toggle is the first
  thing that will need updating. All other rules are pure CSS and more durable.
- Selectors target 2026-era YouTube (`ytd-watch-flexy`, `ytd-reel-shelf-renderer`,
  …). YouTube renames elements occasionally; if something slips through, the fix
  is a one-line selector addition in `content/content.css`.
