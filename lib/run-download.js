/**
 * Run the download pipeline in the extension service worker.
 * The ZIP is built and saved entirely in the service worker / offscreen
 * document; only metadata crosses the port back to the caller.
 */

import { pickJobFields } from "./settings.js";

/**
 * @param {string} url
 * @param {(msg: string) => void} [onProgress]
 * @param {{ onLog?: (entry: {level:string,msg:string,data?:any}) => void, devMode?: boolean }} [opts]
 * @returns {Promise<{zipName: string, name: string, author: string, hasGlb: boolean, fileCount: number, zipBytes: number, downloadId?: number, logText?: string}>}
 */
export function downloadModelInBackground(url, onProgress = () => {}, opts = {}) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        reject(new Error("Extension context invalidated."));
        return;
      }
      port = chrome.runtime.connect({ name: "sf-pipeline" });
    } catch (e) {
      reject(new Error(e && e.message ? e.message : String(e)));
      return;
    }

    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch (_) {}
      fn();
    };

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === "progress") {
        try {
          onProgress(msg.text || "");
        } catch (_) {}
        return;
      }

      if (msg.type === "log") {
        try {
          if (opts.onLog) opts.onLog(msg.entry || { level: "info", msg: msg.text });
        } catch (_) {}
        // Also mirror into progress line when dev
        if (opts.devMode && msg.entry?.msg) {
          try {
            onProgress(`[dev] ${msg.entry.msg}`);
          } catch (_) {}
        }
        return;
      }

      if (msg.type === "done") {
        finish(() =>
          resolve({
            zipName: msg.zipName,
            name: msg.name,
            author: msg.author,
            hasGlb: !!msg.hasGlb,
            fileCount: msg.fileCount || 0,
            zipBytes: msg.zipBytes || 0,
            downloadId: msg.downloadId,
            logText: msg.logText || "",
          })
        );
        return;
      }

      if (msg.type === "error") {
        finish(() => {
          const err = new Error(msg.error || "Download failed");
          err.logText = msg.logText || "";
          reject(err);
        });
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      let errMsg =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        "Background worker disconnected (service worker crashed or was killed)";
      if (/context invalidated/i.test(errMsg)) {
        errMsg =
          "Extension context invalidated. Refresh the model page after reloading the extension (large models also need the offscreen worker).";
      }
      settled = true;
      reject(new Error(errMsg));
    });

    const msg = {
      action: "download",
      url,
      devMode: !!opts.devMode,
      ...pickJobFields(opts),
    };
    port.postMessage(msg);
  });
}
