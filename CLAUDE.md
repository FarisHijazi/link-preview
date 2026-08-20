# link-preview (Better Previews fork)

Fork of [justiceo/link-preview](https://github.com/justiceo/link-preview) — a Chrome/Firefox
extension that previews links in a floating window instead of opening new tabs.

## Build

```bash
npm install     # also installs build-tools/ deps via postinstall
npm run build   # outputs unpacked extension to build/chrome-dev/
```

Load `build/chrome-dev/` via chrome://extensions → "Load unpacked" (Developer mode on).

## Repo notes

- `build-tools/` and `src/utils/` were originally git submodules pointing to
  `justiceo/xtensions-tools` and `justiceo/extension-components`, which no longer exist on
  GitHub. Both are now vendored in-tree, restored from this repo's own history (commits
  `0a84ad9^` and `4be0f59`), with `build-tools/esbuild.js` patched for modern Node
  (no JSON import assertions; jasmine/puppeteer lazily imported).
- Entry points and copied assets are listed in `build-tools/config.json`.
- `src/manifest.json` keys prefixed `__` are stripped from the generated manifest
  (`__chrome__`/`__firefox__` prefixes select per-browser values).
- **Link previews are wired by event delegation, deliberately.** `floatie.ts` installs one
  delegated listener per event on `document` and decides whether a link is previewable when
  the pointer arrives (`anchorFromEvent` + `isPreviewableLink`). Do not go back to attaching
  listeners per anchor or scanning with a `MutationObserver`: judging eligibility at insertion
  time silently and permanently skips anchors that SPAs render empty and fill in later, or
  give a real `href` after hydration. Resolving the anchor via the event's composed path is
  also what makes links inside shadow DOM work.
- User-facing settings are declared in `src/options-page/options.ts` and read at runtime
  with `Storage.get(<id>)` (chrome.storage-backed, defaults live at the call sites).
