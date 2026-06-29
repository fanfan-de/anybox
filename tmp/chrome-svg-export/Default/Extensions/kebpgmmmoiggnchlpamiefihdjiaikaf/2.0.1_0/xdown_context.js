const createContext = () => {
  chrome.contextMenus.create({
    "id": "open-link",
    "contexts": ["link"],
    "title": chrome.i18n.getMessage('downloadLinkTite')
  });
};

chrome.runtime.onInstalled.addListener(createContext);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-link') {
    transfer({
      finalUrl: info.linkUrl,
      referrer: info.pageUrl
    }, tab);
  }
});


const startXDown = () => {
  try {
    const port = chrome.runtime.connectNative('org.xdown.xmsg');
    port.disconnect();
  } catch (e) {
  }
};

chrome.runtime.onStartup.addListener(startXDown);

