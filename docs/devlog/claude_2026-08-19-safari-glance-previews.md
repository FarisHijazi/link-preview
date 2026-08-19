# 2026-08-19 — Safari-Glance-style previews (fork setup + 6 feature PRs)

Repo: fork of justiceo/link-preview, pushed to https://github.com/FarisHijazi/link-preview
(`origin`; the original repo is `upstream`). Build/run docs: @../../CLAUDE.md.

## What was done

1. **Made the repo buildable** (main): the `build-tools` and `src/utils` submodules pointed
   to deleted GitHub repos. Restored both in-tree from this repo's own history and patched
   `build-tools/esbuild.js` for Node 22+ (details in CLAUDE.md).
2. **Feature PRs** (each is an option in the extension's options page):
   - [#1 hover preview](https://github.com/FarisHijazi/link-preview/pull/1) — hover a link →
     preview opens directly, no tooltip click. `preview-on-hover` (default on),
     `preview-on-hover-delay` (0–5s, default 1).
   - [#2 glance animation](https://github.com/FarisHijazi/link-preview/pull/2) — Safari-style
     scale/fade in/out. `glance-animation` (default on).
   - [#3 click outside closes](https://github.com/FarisHijazi/link-preview/pull/3) —
     `close-on-click-outside` (default on).
   - [#4 click preview to open](https://github.com/FarisHijazi/link-preview/pull/4) — click
     anywhere on the preview → opens page in new tab (Safari Glance behavior).
     `click-preview-to-open` (default off). Transparent overlay over the iframe.
   - [#5 deep click](https://github.com/FarisHijazi/link-preview/pull/5) — press-and-hold
     ~450ms previews instantly without navigating. `deep-click-preview` (default on).
     True Force Touch is impossible in Chromium (webkitmouseforce* is Safari-only); the real
     event is wired opportunistically. Stacked on #1.
   - [#6 same-site + dynamic + image links](https://github.com/FarisHijazi/link-preview/pull/6)
     — makes Basecamp (Turbo SPA, same-origin links, avatar-image pings) work:
     `preview-same-site-links` (default on), MutationObserver for late-rendered anchors,
     image-only links allowed. Stacked on #5.
3. **Review feedback**: qodo-code-review bot commented on all PRs; the valid race-condition
   findings were fixed (async-handler timer races, close-animation vs new-preview race,
   overlay staleness) and each comment answered inline.
4. **Testing**: e2e smoke test (scratchpad, puppeteer + Chrome for Testing 131 — branded
   Chrome ≥137 ignores `--load-extension`) covering all six features incl. a Basecamp-style
   dynamically-injected same-site avatar link: 12/12 pass.

## Branch layout

`main` (buildable base) ← feature branches ← `integration` (all merged, what
`build/chrome-dev/` is built from). Load `build/chrome-dev/` as an unpacked extension.
