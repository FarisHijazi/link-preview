import { arrow, computePosition, flip, offset, shift } from "@floating-ui/dom";
import floatieCssTxt from "./floatie.txt.css";
import { Logger } from "../../utils/logger";
import Storage from "../../utils/storage";
import manifest from "../../manifest.json";

/*
 * This component is responsible for rendering
 * the floatie and managing its lifecycle.
 * The floatie is rendered in a shadow dom to
 * avoid interference from parent document.
 * TODO: rename to Popover.ts.
 */
export class Floatie {
  container: HTMLElement;
  copyButton: HTMLElement;
  searchButton: HTMLElement;
  previewButton: HTMLElement;
  tooltipArrow: HTMLElement;
  documentFragment: DocumentFragment;
  isCopyActionEnabled = false;
  showTimeout?: number;
  logger = new Logger(this);
  allowSameSite = true;
  hoverAnchor: HTMLAnchorElement | null = null;
  hoverShowTimeout?: any;
  hoverHideTimeout?: any;

  constructor() {
    const markup = `
        <div id="sp-floatie-container">
            <div id="sp-floatie-arrow"></div>
            <div id="sp-floatie-search" class="sp-floatie-action" data-action="search">Search</div>
            <div id="sp-floatie-preview" class="sp-floatie-action" data-action="preview">Preview</div>
                        <div id="sp-floatie-copy" class="sp-floatie-action" data-action="copy">Copy</div>
        </div>
        `;
    // Parse markup.
    const range = document.createRange();
    range.selectNode(document.getElementsByTagName("body").item(0)!);
    this.documentFragment = range.createContextualFragment(markup);

    // Extract actions buttons.
    const container = this.documentFragment.getElementById(
      "sp-floatie-container",
    );
    const searchButton =
      this.documentFragment.getElementById("sp-floatie-search");
    const previewButton =
      this.documentFragment.getElementById("sp-floatie-preview");
    const copyButton = this.documentFragment.getElementById("sp-floatie-copy");
    const tooltipArrow =
      this.documentFragment.getElementById("sp-floatie-arrow");
    if (
      !container ||
      !searchButton ||
      !previewButton ||
      !copyButton ||
      !tooltipArrow
    ) {
      throw new Error("Impossible error obtaining action buttons from DOM");
    }
    this.container = container;
    this.searchButton = searchButton;
    this.previewButton = previewButton;
    this.copyButton = copyButton;
    this.tooltipArrow = tooltipArrow;

    this.logger.debug("Initialized floatie");
  }

  startListening(): void {
    if (this.inIframe()) {
      return;
    }

    const bft = document.createElement("better-previews-tooltip");
    const style = document.createElement("style");
    style.textContent = floatieCssTxt;
    bft.appendChild(style);
    bft.appendChild(this.documentFragment);
    bft.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>"; // slot prevents #attachShadow from wiping dom.
    document.body.appendChild(bft);

    // document.body.appendChild(this.documentFragment);

    // Window level events.
    window.onscroll = () => this.hideAll();
    window.onresize = () => this.hideAll();

    // Do not display in contextMenu.
    window.oncontextmenu = () => this.hideAll();

    // TODO:  Do not display in contentEditable.

    // Listen for mouse up events and suggest search if there's a selection.
    document.onmouseup = (e) => this.deferredMaybeShow(e);
    document.onkeydown = () => this.hideAll();

    this.setupLinkPreviews();
  }

  /*
   * Link previews are wired with ONE delegated listener per event rather than
   * listeners on every anchor. Eligibility is judged when the pointer arrives,
   * not when the anchor is created, which is what makes SPA links work: an
   * anchor rendered empty and filled in later, or given its real href after
   * hydration, is simply read at hover time when it is final.
   */
  setupLinkPreviews() {
    Storage.get("preview-same-site-links").then((v) => {
      this.allowSameSite = v ?? true;
    });

    // mouseover bubbles (mouseenter does not), so it can be delegated.
    document.addEventListener("mouseover", (e) => this.onLinkHover(e), true);
    this.setupDeepClick();
  }

  /*
   * Resolves the anchor under the pointer. Uses the composed path so links
   * inside shadow DOM are found too — the event target is retargeted to the
   * shadow host by the time it reaches the document.
   */
  anchorFromEvent(e: Event): HTMLAnchorElement | null {
    const path: EventTarget[] = e.composedPath ? e.composedPath() : [];
    for (const node of path) {
      if (node instanceof HTMLAnchorElement) {
        return node;
      }
    }
    let el: any = e.target;
    while (el) {
      if (el instanceof HTMLAnchorElement) {
        return el;
      }
      el = el.parentElement ?? el.host;
    }
    return null;
  }

  // Is there a link here worth previewing, and something visible to hover?
  isPreviewableLink(a: HTMLAnchorElement | null): a is HTMLAnchorElement {
    if (!a || !this.isGoodUrl(a.href)) {
      return false;
    }
    // textContent avoids the forced reflow innerText would cost on every hover.
    return !!a.textContent?.trim() || !!a.querySelector("img,svg");
  }

  async onLinkHover(e: MouseEvent) {
    const a = this.anchorFromEvent(e);
    if (a === this.hoverAnchor) {
      // Still within the same link (moving over its children).
      return;
    }
    this.hoverAnchor = a;
    clearTimeout(this.hoverShowTimeout);
    clearTimeout(this.hoverHideTimeout);

    if (!this.isPreviewableLink(a)) {
      this.hoverHideTimeout = setTimeout(() => this.hideAll(), 2000);
      return;
    }

    const previewOnHover = (await Storage.get("preview-on-hover")) ?? true;
    const delaySecs = (await Storage.get("preview-on-hover-delay")) ?? 1;
    this.allowSameSite = (await Storage.get("preview-same-site-links")) ?? true;
    if (this.hoverAnchor !== a) {
      // The pointer moved on while settings were being read.
      return;
    }

    if (previewOnHover) {
      // Preview directly on hover, no tooltip interaction needed.
      this.hoverShowTimeout = setTimeout(() => {
        this.hideAll();
        this.sendMessage("preview", a.href);
      }, delaySecs * 1000);
      return;
    }

    this.hoverShowTimeout = setTimeout(() => {
      this.showActions(a.getBoundingClientRect(), e, a.href, [
        this.previewButton,
      ]);
    }, 500);
  }

  /*
   * Approximates macOS Force Touch ("deep click") on a link: press and hold
   * for a moment to preview it immediately, instead of clicking through.
   * Chromium does not expose the trackpad force sensor (the webkitmouseforce*
   * events are Safari-only), so press-and-hold is the closest mapping; the
   * real force event is still wired up opportunistically in case it exists.
   */
  setupDeepClick() {
    let pressTimer: any = null;
    let pressedAnchor: HTMLAnchorElement | null = null;
    let previewFired = false;

    const fire = (a: HTMLAnchorElement) => {
      previewFired = true;
      // Don't let the hover timer fire the same preview a second time.
      clearTimeout(this.hoverShowTimeout);
      this.hideAll();
      this.sendMessage("preview", a.href);
    };

    const cancel = () => {
      pressedAnchor = null;
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    document.addEventListener(
      "pointerdown",
      async (e: PointerEvent) => {
        if (e.button !== 0) {
          return;
        }
        const a = this.anchorFromEvent(e);
        if (!this.isPreviewableLink(a)) {
          return;
        }
        pressedAnchor = a;
        previewFired = false;
        const deepClick = (await Storage.get("deep-click-preview")) ?? true;
        if (!deepClick || pressedAnchor !== a) {
          // Disabled, or released/left while settings were being read.
          return;
        }
        pressTimer = setTimeout(() => fire(a), 450);
      },
      true,
    );
    document.addEventListener("pointerup", cancel, true);
    // Releasing away from the link produces no click to swallow, so
    // previewFired must be cleared or a later normal click would be eaten.
    document.addEventListener(
      "pointercancel",
      () => {
        cancel();
        previewFired = false;
      },
      true,
    );

    // Real Force Touch, where the browser exposes it (Safari-only today).
    document.addEventListener("webkitmouseforcedown", async (e: Event) => {
      const a = this.anchorFromEvent(e);
      if (!this.isPreviewableLink(a)) {
        return;
      }
      const deepClick = (await Storage.get("deep-click-preview")) ?? true;
      if (!deepClick) {
        return;
      }
      cancel();
      fire(a);
    });

    // Swallow the click that ends a deep-click so the link doesn't navigate.
    document.addEventListener(
      "click",
      (e) => {
        if (previewFired) {
          e.preventDefault();
          e.stopImmediatePropagation();
          previewFired = false;
        }
      },
      true,
    );
  }

  stopListening(): void {
    // Remove all UI elements.
    document.body.removeChild(this.documentFragment);

    // Remove window/document. listeners.
    document.removeEventListener("onmouseup", () => {});
    window.removeEventListener("onscroll", () => {});
    window.removeEventListener("onresize", () => {});
  }

  deferredMaybeShow(e: MouseEvent): void {
    // Allow a little time for cancellation.
    this.showTimeout = window.setTimeout(() => this.maybeShow(e), 100);
  }

  maybeShow(e: MouseEvent): void {
    // Ensure button is hidden by default.
    this.hideAll();

    // Filter out empty/irrelevant selections.
    if (typeof window.getSelection == "undefined") {
      return;
    }
    const selection = window.getSelection()!;
    if (selection.isCollapsed) {
      return;
    }

    // Show appropriate buttons.
    const selectedText = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const boundingRect = range.getBoundingClientRect();
    this.logger.debug("Selected: ", selectedText);
    const actionsToShow: HTMLElement[] = [];
    if (this.shouldShowPreview(e, selectedText)) {
      actionsToShow.push(this.previewButton);
    } else if (this.shouldShowSearch(e, selectedText)) {
      actionsToShow.push(this.searchButton);
    }
    if (this.shouldShowCopy(selectedText)) {
      actionsToShow.push(this.copyButton);
    }
    this.showActions(boundingRect, e, selectedText, actionsToShow);
  }

  getAbsoluteUrl(urlStr: string): URL | null {
    const absoluteUrlMatcher = new RegExp("^(?:[a-z+]+:)?//", "i");
    let url: URL;
    try {
      if (absoluteUrlMatcher.test(urlStr)) {
        url = new URL(urlStr);
      } else {
        return null;
        // TODO: When same domain preview is enabled, check if urlStr is a fragment.
      }
    } catch (e) {
      // href is an invalid URL
      return null;
    }
    return url;
  }

  isGoodUrl(urlStr: string): boolean {
    if (!urlStr || !urlStr.trim()) {
      // There is no link.
      return false;
    }

    const url = this.getAbsoluteUrl(urlStr);
    if (url === null) {
      return false;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      // We don't want to preview other schemes like tel:
      return false;
    }

    if (url.hostname === window.location.hostname) {
      if (!this.allowSameSite) {
        return false;
      }
      // Even with same-site previews on, never preview the page itself
      // (self-links and #fragment anchors).
      if (url.href.split("#")[0] === window.location.href.split("#")[0]) {
        return false;
      }
    }

    // TODO: investigate potential issues with displaying https over http and vice versa.

    return true;
  }

  shouldShowCopy(selectedText: string): boolean {
    return this.isCopyActionEnabled && selectedText.length > 0;
  }

  shouldShowPreview(
    e: MouseEvent | KeyboardEvent,
    selectedText: string,
  ): boolean {
    const isGoodHyperlink = (e: MouseEvent | KeyboardEvent) => {
      var target: any = e.target;
      do {
        if (
          target.nodeName.toUpperCase() === "A" &&
          this.isGoodUrl(target.href)
        ) {
          return true;
        }
      } while ((target = target.parentElement));
      return false;
    };

    return this.isGoodUrl(selectedText) || isGoodHyperlink(e);
  }

  getPreviewUrl(
    e: MouseEvent | KeyboardEvent,
    selectedText: string,
  ): string | undefined {
    const isWrappedByLink = (e: MouseEvent | KeyboardEvent) => {
      var target: any = e.target;
      do {
        if (
          target.nodeName.toUpperCase() === "A" &&
          this.isGoodUrl(target.href)
        ) {
          return target.href;
        }
      } while ((target = target.parentElement));
      return undefined;
    };

    if (this.isGoodUrl(selectedText)) {
      return this.getAbsoluteUrl(selectedText)?.href;
    }

    return isWrappedByLink(e);
  }

  shouldShowSearch(e: MouseEvent, selectedText: string): boolean {
    const isQuerySize = (text: string) => {
      return text.length > 0 && text.length < 100;
    };

    const isEmail = (email: string) => {
      return String(email)
        .toLowerCase()
        .match(
          /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        );
    };

    const isDate = (dataStr: string) => {
      return !isNaN(Date.parse(dataStr));
    };

    const isNotSymbols = function (str: string) {
      let notSymbols: boolean = false;
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (
          (code >= 0 && code <= 47) ||
          (code >= 58 && code <= 64) ||
          (code >= 91 && code <= 96) ||
          (code >= 123 && code <= 255)
        ) {
          continue;
        } else {
          notSymbols = true;
          break;
        }
      }
      return notSymbols;
    };

    return (
      isQuerySize(selectedText) &&
      isNotSymbols(selectedText) &&
      !isEmail(selectedText) &&
      !isDate(selectedText) &&
      !this.shouldShowPreview(e, selectedText)
    );
  }

  showActions(
    boundingRect: DOMRect,
    e: MouseEvent,
    text: string,
    buttons: HTMLElement[],
  ) {
    this.hideAll();
    if (buttons.length === 0) {
      return;
    }

    this.showContainer(boundingRect);
    buttons.forEach((b) => {
      b.style.display = "inline-block";
      b.onclick = () => {
        // Get the latest selection again at click.
        if (typeof window.getSelection != "undefined") {
          const selection = window.getSelection()!;
          if (!selection.isCollapsed) {
            text = selection.toString().trim();
          }

          // Use href for previews.
          if (b.innerText == "Preview") {
            const href = this.getPreviewUrl(e, text);
            if (href) {
              text = href;
            }
          }
        }

        this.sendMessage(
          b.getAttribute("data-action") || "unknown-action",
          text,
        );
        this.hideAll();
      };
    });
  }

  sendMessage(action: string, data: any) {
    window.postMessage(
      { application: manifest.__package_name__, action: action, data: data },
      window.location.origin,
    );
    // chrome.runtime.sendMessage won't put because angular is executed in page context.
    // broadcast.postMessage is not ideal because multiple tabs of same origin get it.
  }

  // It should be a no-op to call this multiple times.
  showContainer(boundingRect: DOMRect): void {
    // Make container visible.
    this.container.style.display = "block";

    // Ensure it's not covered by other page UI.
    const getMaxZIndex = () => {
      return new Promise((resolve: (arg0: number) => void) => {
        const z = Math.max(
          ...Array.from(document.querySelectorAll("body *"), (el) =>
            parseFloat(window.getComputedStyle(el).zIndex),
          ).filter((zIndex) => !Number.isNaN(zIndex)),
          0,
        );
        resolve(z);
      });
    };

    // We cannot pass boundRect directly as the library treats it as an HTMLElement.
    const virtualEl = {
      getBoundingClientRect() {
        return {
          width: boundingRect.width,
          height: boundingRect.height,
          x: boundingRect.x,
          y: boundingRect.y,
          top: boundingRect.top,
          left: boundingRect.left,
          right: boundingRect.right,
          bottom: boundingRect.bottom,
        };
      },
    };

    // Position over reference element
    computePosition(virtualEl, this.container, {
      placement: "top",
      strategy: "absolute", // If you use "fixed", x, y would change to clientX/Y.
      middleware: [
        offset(12), // Space between mouse and tooltip.
        flip(),
        shift({ padding: 5 }), // Space from the edge of the browser.
        arrow({ element: this.tooltipArrow }),
      ],
    }).then(({ x, y, placement, middlewareData }) => {
      /*
       * screenX/Y - relative to physical screen.
       * clientX/Y - relative to browser viewport. Use with position:fixed.
       * pageX/Y - relative to page. Use this with position:absolute.
       */
      Object.assign(this.container.style, {
        top: `${y}px`,
        left: `${x}px`,
      });

      // Handle arrow placement.
      const coords = middlewareData.arrow;

      let staticSide = "bottom";
      switch (placement.split("-")[0]) {
        case "top":
          staticSide = "bottom";
          break;
        case "left":
          staticSide = "right";
          break;
        case "bottom":
          staticSide = "top";
          break;
        case "right":
          staticSide = "left";
          break;
      }
      Object.assign(this.tooltipArrow.style, {
        left: coords?.x != null ? `${coords.x}px` : "",
        top: coords?.y != null ? `${coords.y}px` : "",
        right: "",
        bottom: "",
        [staticSide]: "-4px", // If you update this, update height and width of arrow.
      });

      getMaxZIndex().then((maxZ: number) => {
        this.container.style.zIndex = "" + (maxZ + 10);
        this.tooltipArrow.style.zIndex = "" + (maxZ - 1);
      });
    });
  }

  hideAll(): void {
    clearTimeout(this.showTimeout);
    this.container.style.display = "none";
    this.copyButton.style.display = "none";
    this.searchButton.style.display = "none";
    this.previewButton.style.display = "none";
  }
  inIframe() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }
}
