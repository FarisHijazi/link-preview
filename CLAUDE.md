# link-preview (Better Previews fork)

Fork of [justiceo/link-preview](https://github.com/justiceo/link-preview) — a Chrome/Firefox
extension that previews links in a floating window instead of opening new tabs.

## Design goal: emulate Safari's link preview

**Everything in this fork exists to reproduce Safari's link preview (Glance) in Chrome.**
That is the north star for every change: when a design question comes up, the answer is
whatever Safari does, not whatever is easiest or most configurable. Ship the Safari
behavior as the *default*; expose an option only so it can be turned off.

What that means concretely — each row is a Safari behavior this fork implements, with the
setting id in `src/options-page/options.ts`:

| Safari behavior | Setting id | Default |
|---|---|---|
| Hover a link and it peeks — no click, no intermediate button | `preview-on-hover` (+ `-delay`) | on, 1s |
| The panel springs in and animates out, never popping | `glance-animation` | on |
| Press-and-hold (stands in for Force Touch) peeks without navigating | `deep-click-preview` | on |
| Clicking outside dismisses the peek | `close-on-click-outside` | on |
| Clicking the peek itself commits to the page | `click-preview-to-open` | off |
| Any link peeks, including same-site app links (Basecamp, GitHub) | `preview-same-site-links` | on |

Consequences worth keeping in mind:

- **Feel is a feature.** Timing, easing and the absence of intermediate UI are the point.
  A change that works but feels clunky has not met the goal.
- **Prefer matching Safari over adding knobs.** New options are a last resort, not the
  default way to resolve a disagreement about behavior.
- **Keep diffs minimal.** This is a fork tracking upstream; small, targeted changes.
- True Force Touch is unavailable — Chromium implements none of the `webkitmouseforce*`
  events and quantizes `PointerEvent.pressure` for mouse input, so press-and-hold is the
  closest possible approximation. Verified, not assumed.

Background on how each piece was built and tested: @docs/devlog/claude_2026-08-19-safari-glance-previews.md

## Build

```bash
npm install     # also installs build-tools/ deps via postinstall
npm run build   # outputs unpacked extension to build/chrome-dev/
```

Load `build/chrome-dev/` via chrome://extensions → "Load unpacked" (Developer mode on).

Chrome does **not** pick up a rebuild on its own: after `npm run build`, click ↻ on the
extension in chrome://extensions *and* reload the page under test, since content scripts
only inject at page load. Stale-bundle confusion looks exactly like a broken feature.

## Repo notes

- `build-tools/` and `src/utils/` were originally git submodules pointing to
  `justiceo/xtensions-tools` and `justiceo/extension-components`, which no longer exist on
  GitHub. Both are now vendored in-tree, restored from this repo's own history (commits
  `0a84ad9^` and `4be0f59`), with `build-tools/esbuild.js` patched for modern Node
  (no JSON import assertions; jasmine/puppeteer lazily imported).
- Entry points and copied assets are listed in `build-tools/config.json`.
- `src/manifest.json` keys prefixed `__` are stripped from the generated manifest
  (`__chrome__`/`__firefox__` prefixes select per-browser values).
- User-facing settings are declared in `src/options-page/options.ts` and read at runtime
  with `Storage.get(<id>)` (chrome.storage-backed, defaults live at the call sites).
