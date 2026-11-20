import { browser } from "wxt/browser";
import { createConverter } from "../../lib/converter.js";
import { downloadModel } from "../../lib/pipeline.js";

/** Chrome: the converter lives here, reached by runtime messages from the background service worker. */
const converter = createConverter({
  downloadModel,
  emit: (event) => {
    browser.runtime.sendMessage(event).catch(() => {});
  },
});

browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as { target?: string } | undefined;
  if (!msg || msg.target !== "offscreen") return;
  converter.handle(msg).then(sendResponse, () => sendResponse(undefined));
  return true;
});
