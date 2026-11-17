// Pages Chrome will not let us script, or where injecting would be pointless.
const RESTRICTED_PROTOCOLS = [
  "chrome:",
  "chrome-untrusted:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:",
  "file:"
];

// The Web Store itself blocks content-script injection on these hosts.
const RESTRICTED_HOSTS = ["chromewebstore.google.com", "chrome.google.com"];

function isRestricted(tab) {
  if (!tab || !tab.url) return true;

  let url;
  try {
    url = new URL(tab.url);
  } catch (e) {
    return true;
  }

  if (RESTRICTED_PROTOCOLS.indexOf(url.protocol) !== -1) return true;
  return RESTRICTED_HOSTS.indexOf(url.hostname) !== -1;
}

function flashBadge(tabId, text) {
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#d93025" });
  chrome.action.setBadgeText({ tabId: tabId, text: text });
  setTimeout(() => chrome.action.setBadgeText({ tabId: tabId, text: "" }), 2000);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id === undefined) return;

  if (isRestricted(tab)) {
    flashBadge(tab.id, "N/A");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (err) {
    // Injection can still fail (e.g. the tab navigated away mid-click).
    console.error("Webtext: could not inject content script.", err);
    flashBadge(tab.id, "!");
  }
});
