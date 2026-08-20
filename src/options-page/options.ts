import "../content-script/content-script"; // To inject popup for dev mode.
import { Config, SettingsUI } from "../utils/settings/settings";
import "./options.css";
import manifest from "../manifest.json";
import analytics from "../utils/analytics";
import { i18n, translateMarkup } from "../utils/i18n";

const configOptions: Config[] = [
  {
    id: "search-engine",
    type: "select",
    title: i18n("Search engine"),
    description: i18n(
      "The search engine that would be used for inline search previews.",
    ),
    default_value: "google",
    options: [
      { id: "google", text: i18n("Google Search") },
      { id: "bing", text: i18n("Bing Search") },
      { id: "yahoo", text: i18n("Yahoo Search") },
      { id: "baidu", text: i18n("Baidu Search") },
      { id: "yandex", text: i18n("Yandex Search") },
    ],
  },
  {
    id: "previewr-width",
    type: "range",
    title: i18n("Preview Width (%)"),
    description: i18n("The width of the preview panel relative to the page."),
    default_value: 40,
    min: "20",
    max: "90",
  },
  {
    id: "previewr-height",
    type: "range",
    title: i18n("Preview Height (%)"),
    description: i18n("The height of the preview panel relative to the page."),
    default_value: 70,
    min: "20",
    max: "95",
  },
  {
    id: "previewr-position",
    type: "select",
    title: i18n("Panel Position"),
    description: i18n("The side of the page in which to display the preview."),
    default_value: "right",
    options: [
      { id: "right", text: i18n("Right side") },
      { id: "left", text: i18n("Left side") },
    ],
  },
  {
    id: "close-on-esc",
    type: "switch",
    title: i18n("Close on Escape Key"),
    description: i18n("Use the ESC (escape) key to close the preview panel."),
    default_value: true,
  },
  {
    id: "automatically-hide-previews",
    type: "switch",
    title: i18n("Automatically Hide Previews"),
    description: i18n(
      "Hides the preview panel when you scroll away or interact with the main page.",
    ),
    default_value: false,
  },
  {
    id: "preview-in-side-panel",
    type: "switch",
    title: i18n("Preview in Side Panel"),
    description: i18n(
      "Displays the view in Chrome Side Panel instead of a floating box.",
    ),
    default_value: false,
    dev_only: true,
  },
  {
    id: "preview-on-hover",
    type: "switch",
    title: "Automatic Preview on Hover",
    description:
      "Open the preview directly when hovering a link — no tooltip, no click needed.",
    default_value: true,
  },
  {
    id: "preview-on-hover-delay",
    type: "range",
    title: i18n("Preview-on-Hover Delay"),
    description: i18n(
      "When automatic preview on hover is enabled, this is the delay (in seconds) before the preview is shown.",
    ),
    default_value: 1,
    min: "0",
    max: "5",
  },
  {
    id: "deep-click-preview",
    type: "switch",
    title: "Deep Click to Preview",
    description:
      "Press and hold a link (like a macOS deep click) to preview it instantly instead of navigating.",
    default_value: true,
  },
  {
    id: "alt-click-preview",
    type: "switch",
    title: "Option/Alt + Click to Preview",
    description:
      "Hold Option (Alt) and click a link to preview it. This replaces Chrome's Alt+click 'download linked file' shortcut.",
    default_value: true,
  },
  {
    id: "preview-same-site-links",
    type: "switch",
    title: "Preview Same-Site Links",
    description:
      "Also preview links that point to the site you are on (needed for apps like Basecamp, GitHub, etc).",
    default_value: true,
  },
  {
    id: "blocked-sites",
    type: "textarea",
    title: "Disabled on Websites",
    description:
      "Extension will not run on these sites. Enter one site per line.",
    default_value: "",
  },
  {
    id: "enable-anti-frame-busting",
    type: "switch",
    title: i18n("[Advanced] Force Preview"),
    description: i18n(
      "For websites that **really** do not want to be previewed (e.g. stackoverflow.com) this forces a preview. Nerd alert: this is a frame-busting buster.",
    ),
    default_value: false,
  },
  {
    id: "disable-incognito-google",
    type: "switch",
    title: i18n("[Advanced] Disable Incognito Google"),
    description: i18n(
      "By default, the version of Google search used is always signed-out for privacy and security reasons. Though this may result in always seeing sign-in prompts.",
    ),
    default_value: false,
  },
];

const iframeName = "betterpreviews.com/mainframe";
const pcl = new URL(window.location.href).protocol;
if (window.name === iframeName) {
  configOptions["disable-on-this-site"] = {
    id: "disable-on-this-site",
    type: "switch",
    title: i18n("Disable Previews on this site"),
    description: i18n("The detail information about the checkbox here."),
    value: false,
  };
} else {
  configOptions["disabled-on-sites"] = {
    id: "disabled-on-sites",
    type: "textarea",
    title: i18n("Disabled on Websites"),
    description: i18n(
      "Extension will not run on these sites, you can disable a site by adding to this list.",
    ),
    value: "example.com\nexample.org",
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  document
    .querySelector(".options-container")
    ?.appendChild(new SettingsUI(configOptions));

  await analytics.firePageViewEvent("Options Page", "/options.html");

  window.onerror = (event, source, lineno, colno, error) => {
    analytics.fireErrorEvent(error, {
      event: event,
      source: source,
      lineno: lineno,
    });
  };

  document.querySelector("#show-preview")?.addEventListener("click", () => {
    window.postMessage(
      {
        application: manifest.__package_name__,
        action: "search",
        data: "hello world",
      },
      window.location.origin,
    );
  });
  translateMarkup(document);
});
