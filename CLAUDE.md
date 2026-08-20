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

### ALWAYS rebuild before saying a change is done

`build/chrome-dev/` is the only thing that actually runs — editing `src/` changes nothing
anyone can see or test. **Run `npm run build` after every code change, before reporting it
as finished**, and never describe a change as working on the strength of the source alone.
A correct fix sitting in an unbuilt tree is indistinguishable from a broken one, and the
time lost goes into debugging code that was never running.

So, every time, in this order:

1. `npm run build` — must exit clean.
2. Exercise the change in a real browser (see the e2e/probe scripts described in the
   devlog) — source review is not evidence.
3. Only then report it as done, saying what was verified.

The same applies on the browser side, and it is *not* automatic: Chrome does not pick up a
rebuild on its own. After `npm run build`, click ↻ on the extension in chrome://extensions
**and** reload the page under test, since content scripts only inject at page load. A stale
loaded bundle looks exactly like a broken feature — it has already cost one full debugging
round here. When previews behave differently for cross-site vs same-site or static vs
dynamic links, suspect a stale loaded bundle before suspecting the code.

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
