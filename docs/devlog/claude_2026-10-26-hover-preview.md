# 2026-10-26: hover-preview fix + triple-click trigger

TODO item: "fix the hover preview chrome app, try triple click, try other things".

## Bug fixed: hover previews got stuck open

`Floatie.onLinkHover` dropped any mouseover whose anchor matched the last one,
including `null === null` (meaning "still off every link"). Only the first non-link
mouseover after leaving a link scheduled the hover-close. If the pointer crossed plain
page on its way into the preview, that one close found the pointer over the panel and
backed off. Leaving the preview afterwards produced only more non-link mouseovers,
which were all dropped, so a hover-opened preview never closed. It stayed open until a
click outside or Esc.

Fix: deduplicate only real anchors (`a && a === this.hoverAnchor`). Every non-link
mouseover now re-arms the 600ms close.

## Triple-click to preview (`triple-click-preview`, default off)

The first click of a triple-click navigates before the third one arrives (verified:
without interception the test page navigated). So when this option is on, a plain
left click on a previewable link is held for 300ms. A third click on the same link
previews it. Otherwise the held click is re-dispatched on the anchor. The browser still
treats it as user-activated, so `target=_blank` links still open their tab. Modified
clicks pass straight through. It is off by default because it delays every link click,
which goes against the "feel is a feature" rule in `CLAUDE.md`.

## Tried and rejected

- `:hover` on the panel to detect a pointer inside the cross-origin preview iframe:
  headless Chromium does **not** set `:hover` on the iframe's parent-document ancestors
  for an out-of-process iframe. The last-known-pointer rect test stays.

## Testing

`spec/previews-e2e.mjs`: headless (`--headless=new`) puppeteer-core plus Chrome for
Testing. It loads `build/chrome-dev` and serves a local page on two hosts. It has 14
checks: hover open, close, enter and leave the preview (direct and via a detour), a
brief pass that must not preview, same-site and late-inserted links, alt-click,
press-and-hold, triple-click, a held single click that still navigates, and a held
`target=_blank` click. All 14 pass. "leaving preview after detour closes it" fails on
the pre-fix build.

Not verifiable headlessly: real trackpad gestures (Force Touch, three-finger tap).
