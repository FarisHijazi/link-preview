import { Logger } from "../utils/logger";
import { WinBox } from "../utils/winbox/winbox";
import "./previewr.css";
import { sanitizeUrl } from "@braintree/sanitize-url";
import { Readability } from "@mozilla/readability";
import "../utils/feedback/feedback";
import { FeedbackData } from "../utils/feedback-checker";
import { FEEDBACK_DATA_KEY } from "../utils/storage";
import Storage from "../utils/storage";
import Analytics from "../utils/analytics";
import manifest from "../manifest.json";

const iframeName = manifest.__package_name__ + "/mainframe";
// Override the #setUrl method to set name attribute on iframe.
WinBox.prototype.setUrl = function (url, onload) {
  const node = this.body.firstChild;

  if (node && node.tagName.toLowerCase() === "iframe") {
    node.src = url;
  } else {
    this.body.innerHTML =
      '<iframe name="' + iframeName + '" src="' + url + '"></iframe>';
    onload && (this.body.firstChild.onload = onload);
  }

  return this;
};

// This class is responsible to loading/reloading/unloading the angular app into the UI.
export class Previewr {
  logger = new Logger(this);
  headerIconUrlBase = "https://www.google.com/s2/favicons?domain=";
  dialog?: WinBox;
  isVisible = false;
  url?: URL;
  // Where the cursor was when the preview was requested (viewport coords).
  previewPoint = { x: 0, y: 0 };
  // What opened the current preview: "hover" or "click".
  previewTrigger: "hover" | "click" = "hover";
  navStack: URL[] = [];
  displayReaderMode = false;
  isDemo = false;
  searchUrl = {
    google: "https://www.google.com/search?igu=1&q=",
    bing: "https://www.bing.com/search?q=",
    yahoo: "https://search.yahoo.com/search?p=",
    baidu: "https://www.baidu.com/s?wd=",
    yandex: "https://yandex.com/search/?text=",
    duckduckgo: "https://duckduckgo.com/?q=",
    ecosia: "https://www.ecosia.org/search?q=",
  };

  /* This function inserts an Angular custom element (web component) into the DOM. */
  init() {
    if (this.inIframe()) {
      this.logger.log(
        "Not inserting previewr in iframe: ",
        window.location.href,
      );
      return;
    }

    this.listenForCspError();
    this.listenForWindowMessages();
    document.addEventListener("keydown", this.onEscHandler);
    document.addEventListener("click", (e) => this.clickHandler(e));
    document.addEventListener("scroll", (e) => this.handleScroll(e));
  }

  listenForCspError() {
    document.addEventListener("securitypolicyviolation", (e) => {
      if (window.name !== iframeName) {
        return;
      }
      this.logger.error("CSP error", e, e.blockedURI);
    });
  }

  onEscHandler = (evt) => {
    evt = evt || window.event;
    var isEscape = false;
    if ("key" in evt) {
      isEscape = evt.key === "Escape" || evt.key === "Esc";
    } else {
      isEscape = evt.keyCode === 27;
    }
    if (isEscape) {
      this.handleMessage({
        action: "escape",
        href: document.location.href,
        sourceFrame: iframeName,
      });
    }
  };

  // Close the dialog preview on click outside of the preview panel.
  async clickHandler(e) {
    const autoHide =
      (await Storage.get("automatically-hide-previews")) ?? false;
    const closeOnClickOutside =
      (await Storage.get("close-on-click-outside")) ?? true;
    if (
      (autoHide || closeOnClickOutside) &&
      this.dialog &&
      !this.dialog.dom.contains(e.target)
    ) {
      this.dialog.close();
    }
  }

  // Close the dialog preview on scroll outside of the preview panel, when automatically-hide-previews is enabled.
  async handleScroll(e) {
    const autoHide =
      (await Storage.get("automatically-hide-previews")) ?? false;
    if (autoHide && this.dialog && !this.dialog.dom.contains(e.target)) {
      this.dialog.close();
    }
  }

  listenForWindowMessages() {
    window.addEventListener(
      "message",
      (event) => {
        if (event.origin !== window.location.origin) {
          this.logger.debug(
            "Ignoring message from different origin",
            event.origin,
            event.data,
          );
          return;
        }

        if (event.data.application !== manifest.__package_name__) {
          this.logger.debug(
            "Ignoring origin messsage not initiated by Better Previews",
            event.data,
          );
          return;
        }

        this.logger.log("#WindowMessage: ", event);
        this.handleMessage(event.data);
      },
      false,
    );
  }

  async handleMessage(message) {
    // Extract the url from the message.
    let urlStr;
    if (message.mode === "demo") {
      this.isDemo = true;
    }

    if (message.point) {
      this.previewPoint = message.point;
    }
    if (message.trigger) {
      this.previewTrigger = message.trigger;
    }

    // Hovering away only dismisses a preview that hovering opened; one opened
    // by a click stays until it is clicked away.
    if (message.action === "close-if-hover") {
      if (this.previewTrigger === "hover") {
        this.dialog?.close();
      }
      return;
    }

    if (message.action === "copy") {
      navigator.clipboard.writeText(message.data);
      return;
    } else if (message.action === "preview") {
      urlStr = message.data;
    } else if (message.action === "search") {
      const searchEngine = (await Storage.get("search-engine")) ?? "google";
      urlStr = this.searchUrl[searchEngine] + message.data;

      // Add override for google search without incognito.
      if (searchEngine === "google") {
        const disableIncognitoGoogle = await Storage.get(
          "disable-incognito-google",
        );
        if (disableIncognitoGoogle == true) {
          urlStr = "https://www.google.com/search?q=" + message.data;
        }
      }
    } else if (message.action === "load") {
      if (message.sourceFrame === iframeName && this.dialog) {
        this.dialog.setTitle(message.data.title);
        this.dialog.setIcon(
          this.headerIconUrlBase + new URL(message.href!).hostname,
        );
        // Keep the tracked URL in sync with redirects and in-iframe
        // navigation, so open-on-click opens what is actually displayed.
        try {
          this.url = new URL(message.href!);
        } catch (e) {
          this.logger.error(e);
        }
      }
    } else if (message.action === "navigate") {
      urlStr = message.href;
    } else if (message.action === "escape") {
      const closeOnEsc = (await Storage.get("close-on-esc")) ?? true;
      if (closeOnEsc) {
        this.dialog?.close();
      }
      return;
    } else {
      this.logger.warn("Unhandled action", message);
    }

    // Ensure it is valid.
    if (!urlStr || sanitizeUrl(urlStr) === "about:blank") {
      return;
    }
    let newUrl;
    try {
      newUrl = new URL(urlStr);
    } catch (e) {
      this.logger.error(e);
      return;
    }

    // Move the old URL to backstack.
    if (this.url && this.url.href !== newUrl.href) {
      this.navStack.push(this.url);
    }

    // Preview new URL.
    return this.previewUrl(newUrl);
  }

  async previewUrl(url: URL) {
    this.logger.log("#previewUrl: ", url);
    // If the dialog is mid close-animation, finish closing it now so the new
    // preview gets a fresh dialog instead of being destroyed by the pending
    // forced close.
    if ((this.dialog as any)?.spClosing) {
      this.dialog.close(true);
    }
    this.url = url;

    const winboxOptions = await this.getWinboxOptions(url);

    if (this.displayReaderMode) {
      let reader = new Readability(window.document.cloneNode(true) as Document);
      let article = reader.parse();
      if (!article) {
        console.error("Article is null");
        winboxOptions.html = `<h1>Failed to parse article</h1>`;
      }
      winboxOptions.html = `<h1>${article.title}</h1> <p>${article.byline}</p> ${article.content}`;
    } else {
      winboxOptions.url = this.url;
    }

    if (!this.dialog) {
      this.logger.debug("creating new dialog with options:", winboxOptions);
      this.dialog = new WinBox(url.hostname, winboxOptions);

      this.dialog.addControl({
        index: 2,
        class: "wb-nav-away",
        title: "Open in New Tab",
        image: "",
        click: (event, winbox) => {
          this.logger.log("#onOpenInNewTab: url", this.url);
          window.open(this.url, "_blank");
        },
      });
      this.dialog.addControl({
        index: 3,
        class: "wb-settings",
        title: "Extension Settings",
        image: "",
        click: (event, winbox) => {
          this.logger.log("#onOpenSettings: url", this.url);
          chrome.runtime.sendMessage("open_options_page");
        },
      });
    } else {
      this.logger.debug("restoring dialog");
      this.dialog.restore();
      // Each new peek opens where the cursor is, including a reused dialog.
      this.dialog.move(winboxOptions.x, winboxOptions.y);
      this.dialog.setUrl(url.href);
      this.dialog.setTitle(url.hostname);
      this.dialog.setIcon(this.headerIconUrlBase + url.hostname);
    }

    await this.updateOpenOnClickOverlay();

    this.dialog.removeControl("nav-back");
    if (this.navStack.length > 0) {
      this.dialog.addControl({
        index: 0,
        class: "nav-back",
        image: "",
        title: "Go Back",
        click: (event, winbox) => {
          this.navBack();
        },
      });
    }

    await this.registerFeedbackUI();
  }

  async registerFeedbackUI() {
    const feedbackData: FeedbackData | null =
      await Storage.get(FEEDBACK_DATA_KEY);
    const shouldShow = feedbackData?.status === "eligible";
    if (shouldShow) {
      this.dialog?.addClass("show-footer");
    }

    // Listen for component events.
    const ff = this.dialog?.dom.querySelector("feedback-form");
    ff.setProgressHandler((status, data) => {
      if (status === "started") {
        this.logger.log("started: this", this, chrome?.storage?.sync);
        const feedbackUpdate: FeedbackData = {
          status: "honored",
          timestamp: Date.now(),
          rating: data,
        };
        Storage.put(FEEDBACK_DATA_KEY, feedbackUpdate);

        Analytics.fireEvent("user_feedback", {
          action: "rate_experience",
          star_rating: data,
        });
      }

      if (status === "completed") {
        this.dialog?.removeClass("show-footer");
        Analytics.fireEvent("user_feedback", {
          action: "submit_feedback",
          feedback_text: data,
        });
      }
    });
  }

  /*
   * When enabled, a transparent overlay covers the preview body so that a
   * click anywhere on the preview opens the page in a new tab instead of
   * interacting with it — like Safari's Glance preview.
   */
  async updateOpenOnClickOverlay() {
    if (!this.dialog) {
      return;
    }
    const openOnClick = (await Storage.get("click-preview-to-open")) ?? false;
    const existing = this.dialog.body.querySelector(".sp-open-on-click");
    if (!openOnClick) {
      // The option may have been turned off while a dialog is open/reused.
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "sp-open-on-click";
    overlay.title = "Open in New Tab";
    overlay.addEventListener("click", () => {
      window.open(this.url, "_blank");
      this.dialog?.close();
    });
    this.dialog.body.appendChild(overlay);
  }

  navBack() {
    const lastUrl = this.navStack.pop();
    if (lastUrl) {
      this.previewUrl(lastUrl);
    }
  }

  /*
   * Returns true if this script is running inside an iframe,
   * since the content script is added to all frames.
   */
  inIframe() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  getMaxZIndex() {
    return new Promise((resolve: (arg0: number) => void) => {
      const z = Math.max(
        ...Array.from(document.querySelectorAll("body *"), (el) =>
          parseFloat(window.getComputedStyle(el).zIndex),
        ).filter((zIndex) => !Number.isNaN(zIndex)),
        0,
      );
      resolve(z);
    });
  }

  /*
   * Places the panel at the cursor, the way Safari's Glance opens where you
   * are looking rather than at a fixed edge of the screen. Offsets down-right
   * of the pointer, flips to the other side when that would overflow, and
   * clamps so the panel is never partly off-screen.
   */
  positionAtPointer(widthPx: number, heightPx: number) {
    const margin = 12;
    const gap = 16;

    // Along one axis: sit just after the pointer, else just before it, else —
    // when the panel is too big to clear the pointer either way — straddle it,
    // so the peek still appears where you are looking instead of snapping to
    // an edge. Always clamped fully on-screen.
    const place = (at: number, size: number, viewport: number) => {
      const after = at + gap;
      if (after + size <= viewport - margin) {
        return after;
      }
      const before = at - size - gap;
      if (before >= margin) {
        return before;
      }
      const straddle = at - size / 2;
      return Math.max(margin, Math.min(straddle, viewport - size - margin));
    };

    return {
      x: place(this.previewPoint.x, widthPx, window.innerWidth),
      y: place(this.previewPoint.y, heightPx, window.innerHeight),
    };
  }

  async getWinboxOptions(url: URL) {
    // Set width and height from options if present.
    let widthPct = (await Storage.get("previewr-width")) ?? 45;
    let heightPct = (await Storage.get("previewr-height")) ?? 60;

    // In demo mode, use small width and height.
    if (this.isDemo) {
      widthPct = 45;
      heightPct = 40;
    }
    const widthPx = (window.innerWidth * Number(widthPct)) / 100;
    const heightPx = (window.innerHeight * Number(heightPct)) / 100;
    const width = widthPct + "%";
    const height = heightPct + "%";
    const at = this.positionAtPointer(widthPx, heightPx);
    const glanceAnimation = (await Storage.get("glance-animation")) ?? true;
    let options: any = {
      icon: this.headerIconUrlBase + url.hostname,
      x: at.x,
      y: at.y,
      width: width,
      height: height,
      class: glanceAnimation
        ? ["no-max", "no-full", "sp-glance"]
        : ["no-max", "no-full"],
      index: await this.getMaxZIndex(),
      hidden: false,
      shadowel: "search-preview-window",
      framename: iframeName,

      onclose: (force?: boolean) => {
        // Play the close animation first, then close for real (force=true).
        if (!force && glanceAnimation && this.dialog) {
          const dialog: any = this.dialog;
          if (dialog.spClosing) {
            return true;
          }
          dialog.spClosing = true;
          dialog.addClass("sp-glance-out");
          // dialog.dom is nulled if something else already force-closed it.
          setTimeout(() => dialog.dom && dialog.close(true), 170);
          return true;
        }
        this.navStack = [];
        this.url = undefined;
        this.dialog = undefined;
      },
    };

    return options;
  }
}
new Previewr().init();
