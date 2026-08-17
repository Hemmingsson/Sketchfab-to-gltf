/**
 * Content script:
 * - Floating download panel with language switch + optional dev log
 * - Download runs in the service worker (WASM / CSP safe); SW saves ZIP
 */
(function () {
  const UID_RE =
    /sketchfab\.com\/(?:3d-models\/[^/?#]+-|models\/)([a-f0-9]{32})/i;

  let lang = "en";
  let i18n = null;
  let busy = false;
  let devMode = false;
  let liveLog = [];
  const statusCbs = [];

  function currentUid() {
    const m = location.href.match(UID_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function isModelPage() {
    return !!currentUid();
  }

  let uiProgress = null;
  let pendingTheme = "light";
  let pendingLang = "en";
  let appliedOk = false;
  let appliedTextures = false;
  let appliedPack = "full";
  let appliedEdge = 0;
  let settingsApi = null;
  let uiSettings = null;
  try {
    /* filled after dynamic import */
  } catch (_) {}

  function setProgress(pct) {
    const root = document.getElementById("sf-dl-root");
    if (!root) return;
    const wrap = root.querySelector("#sf-dl-progress");
    const bar = root.querySelector("#sf-dl-bar");
    const lab = root.querySelector("#sf-dl-pct");
    if (!wrap || !bar) return;
    const n = Math.max(0, Math.min(100, pct | 0));
    wrap.hidden = false;
    bar.style.width = n + "%";
    if (lab) lab.textContent = n + "%";
  }

  function setStatus(msg) {
    if (uiProgress && typeof uiProgress.progressFromMessage === "function") {
      const pct = uiProgress.progressFromMessage(msg);
      if (pct != null) setProgress(pct);
    } else {
      const tm = String(msg || "").match(/Texture\s+(\d+)\s*\/\s*(\d+)/i);
      if (tm) {
        setProgress(46 + Math.round((Number(tm[1]) / Number(tm[2])) * 32));
      } else if (/Saving |ZIP ready|✅/i.test(String(msg || ""))) {
        setProgress(/✅|ZIP ready|done /i.test(String(msg || "")) ? 100 : 96);
      }
    }
    const ready = document.querySelector("#sf-dl-ready");
    if (ready && !devMode) {
      const s = String(msg || "");
      if (/^✅/.test(s)) ready.textContent = tt("downloadOk");
      else if (/ERROR|❌/i.test(s)) ready.textContent = s.replace(/^❌\s*/, "");
      else if (busy) ready.textContent = tt("downloading");
    }
    for (const cb of statusCbs) {
      try {
        cb(msg);
      } catch (_) {}
    }
  }

  function tt(key, vars) {
    if (i18n && i18n.t) return i18n.t(lang, key, vars);
    return key;
  }

  function isSettingsDirty() {
    const root = document.getElementById("sf-dl-root");
    if (!root) return false;
    const tex = root.querySelector("#sf-dl-textoggle");
    const dev = root.querySelector("#sf-dl-devtoggle");
    const pending = {
      textures: !!(tex && tex.checked),
      devMode: !!(dev && dev.checked),
    };
    if (uiSettings && uiSettings.isJobDirty) {
      return uiSettings.isJobDirty(pending, {
        textures: appliedTextures,
        devMode,
      });
    }
    return (
      pending.textures !== appliedTextures || pending.devMode !== !!devMode
    );
  }

  async function persistInstantPanel(partial) {
    if (!settingsApi || !settingsApi.savePrefs) return null;
    const next = await settingsApi.savePrefs(partial);
    appliedPack = next.packMode === "glb" ? "glb" : "full";
    appliedEdge =
      next.maxTextureEdge === 2048 || next.maxTextureEdge === 4096
        ? next.maxTextureEdge
        : 0;
    pendingTheme = next.theme === "dark" ? "dark" : "light";
    pendingLang = next.lang === "ru" ? "ru" : "en";
    lang = pendingLang;
    const root = document.getElementById("sf-dl-root");
    if (root && settingsApi.applyTheme) settingsApi.applyTheme(root, next.theme);
    applyPanelI18n(root);
    return next;
  }

  function bindSettingsPills(root) {
    if (!root || !uiSettings) return;
    uiSettings.bindThemeSwitch(root.querySelector("#sf-dl-theme"), {
      getTheme: () => pendingTheme,
      onPick: (code) => persistInstantPanel({ theme: code }),
      t: (_lng, key) => tt(key),
      lang,
    });
    uiSettings.bindPillSwitch(root.querySelector("#sf-dl-pack"), {
      items: [
        { code: "full", label: tt("packFull") },
        { code: "glb", label: tt("packGlb") },
      ],
      get: () => appliedPack,
      onPick: (code) => persistInstantPanel({ packMode: code }),
    });
    uiSettings.bindPillSwitch(root.querySelector("#sf-dl-res"), {
      items: [
        { code: "0", label: tt("texSizeOrig") },
        { code: "2048", label: tt("texSize2k") },
        { code: "4096", label: tt("texSize4k") },
      ],
      get: () => String(appliedEdge || 0),
      onPick: (code) => persistInstantPanel({ maxTextureEdge: Number(code) || 0 }),
    });
  }

  function paintSettingsFlash() {
    const el = document.querySelector("#sf-dl-settings-flash");
    if (uiSettings && uiSettings.paintSettingsFlash) {
      uiSettings.paintSettingsFlash(el, {
        dirty: isSettingsDirty(),
        appliedOk,
        t: (lng, key) => tt(key),
        lang,
      });
      return;
    }
    if (!el) return;
    el.hidden = !isSettingsDirty() && !appliedOk;
    el.className = isSettingsDirty() ? "show dirty" : appliedOk ? "show ok" : "";
    el.textContent = isSettingsDirty()
      ? tt("settingsDirty")
      : appliedOk
        ? tt("settingsSaved")
        : "";
  }

  function appendLog(line) {
    liveLog.push(line);
    if (liveLog.length > 400) liveLog = liveLog.slice(-400);
    const el = document.querySelector("#sf-dl-devlog");
    if (el && devMode) {
      el.textContent = liveLog.join("\n");
      el.scrollTop = el.scrollHeight;
    }
  }

  function renderDevUi(root) {
    root = root || document.getElementById("sf-dl-root");
    if (!root) return;
    root.classList.toggle("sf-dev", !!devMode);
    const panel = root.querySelector("#sf-dl-devpanel");
    const toggle = root.querySelector("#sf-dl-devtoggle");
    const logEl = root.querySelector("#sf-dl-devlog");
    // Do not reset the checkbox here — pending value waits for Apply.
    if (panel) {
      panel.hidden = !devMode;
      if (!devMode) panel.setAttribute("hidden", "");
      else panel.removeAttribute("hidden");
    }
    root.querySelectorAll("[data-dev-only]").forEach((el) => {
      el.hidden = !devMode;
    });
    if (logEl && devMode) {
      logEl.textContent = liveLog.join("\n") || "—";
    }
  }

  async function ensureI18n() {
    if (i18n) return i18n;
    try {
      i18n = await import(chrome.runtime.getURL("lib/i18n.js"));
      lang = await i18n.getLang();
      pendingLang = lang;
    } catch (e) {
      console.warn("[sf-dl] i18n load failed", e);
      i18n = {
        t: (_l, k) => k,
        getLang: async () => "en",
        setLang: async (l) => l,
        createLangSwitch: () => document.createElement("div"),
        updateLangSwitch: () => {},
      };
      lang = "en";
    }
    return i18n;
  }

  async function ensureDevFlag() {
    try {
      const { isDevMode } = await import(
        chrome.runtime.getURL("lib/devlog.js")
      );
      devMode = await isDevMode();
    } catch (_) {
      devMode = false;
    }
  }

  async function runDownload(pageUrl, job) {
    if (busy) throw new Error(tt("alreadyDownloading"));
    busy = true;
    liveLog = [];
    appendLog(`start ${new Date().toISOString()}`);
    setProgress(4);
    setStatus(tt("starting"));
    try {
      await ensureDevFlag();
      renderDevUi();
      setStatus(tt("starting"));

      const { downloadModelInBackground } = await import(
        chrome.runtime.getURL("lib/run-download.js")
      );
      let wantTextures = appliedTextures;
      let wantDev = !!devMode;
      if (job && (job.downloadTextures === true || job.downloadTextures === false)) {
        wantTextures = job.downloadTextures === true;
      }
      if (job && (job.devMode === true || job.devMode === false)) {
        wantDev = job.devMode === true;
      }
      let packMode = appliedPack === "glb" ? "glb" : "full";
      let maxTextureEdge = appliedEdge === 2048 || appliedEdge === 4096 ? appliedEdge : 0;
      if (!job || typeof job.downloadTextures !== "boolean") {
        try {
          const s = await import(chrome.runtime.getURL("lib/settings.js"));
          const prefs = await s.loadPrefs();
          wantTextures = prefs.textures === true;
          wantDev = prefs.devMode === true;
          packMode = prefs.packMode === "glb" ? "glb" : "full";
          maxTextureEdge =
            prefs.maxTextureEdge === 2048 || prefs.maxTextureEdge === 4096
              ? prefs.maxTextureEdge
              : 0;
        } catch (_) {}
      } else {
        if (job.packMode === "glb" || job.packMode === "full") packMode = job.packMode;
        if (
          job.maxTextureEdge === 0 ||
          job.maxTextureEdge === 2048 ||
          job.maxTextureEdge === 4096
        ) {
          maxTextureEdge = job.maxTextureEdge;
        }
      }
      if (isSettingsDirty()) {
        setStatus(tt("settingsDirty"));
      }
      appendLog("settings textures=" + (wantTextures ? "on" : "off"));

      const result = await downloadModelInBackground(
        pageUrl || location.href,
        (m) => {
          setStatus(m);
          if (devMode) appendLog(m);
        },
        {
          devMode: wantDev,
          downloadTextures: wantTextures,
          packMode,
          maxTextureEdge,
          onLog: (entry) => {
            if (!entry) return;
            appendLog(
              `[${entry.level || "info"}] ${entry.msg}${
                entry.data ? " " + JSON.stringify(entry.data) : ""
              }`
            );
          },
        }
      );

      if (result.logText) {
        liveLog = result.logText.split("\n");
        renderDevUi();
      }

      setProgress(100);
      setStatus(
        `✅ ${tt("done")}: ${result.name} ${tt("by")} ${result.author}\n${
          result.zipName
        }${result.zipBytes ? ` (${result.zipBytes} B)` : ""}`
      );
      appendLog(`done ${result.zipName}`);
      return result;
    } catch (e) {
      console.error("[sf-dl]", e);
      let msg = e && e.message ? e.message : String(e);
      if (/context invalidated/i.test(msg)) msg = tt("errContextInvalid");
      else if (/worker stopped|worker crashed|was killed|disconnected/i.test(msg)) {
        msg = tt("errWorkerDied");
      }
      setStatus(`❌ ${msg}`);
      appendLog(`ERROR ${msg}`);
      if (e && e.logText) {
        liveLog = String(e.logText).split("\n");
        renderDevUi();
      }
      throw e;
    } finally {
      busy = false;
    }
  }

  function applyPanelI18n(root) {
    if (!root) return;
    const title = root.querySelector("#sf-dl-title-text");
    const meta = root.querySelector("#sf-dl-meta");
    const status = root.querySelector("#sf-dl-status");
    const dlBtn = root.querySelector("#sf-dl-btn");
    const bulkBtn = root.querySelector("#sf-dl-bulk");
    const devLab = root.querySelector("#sf-dl-devlabel");
    if (title) title.textContent = tt("panelTitle");
    const ready = root.querySelector("#sf-dl-ready");
    if (ready && !busy) ready.textContent = tt("readyDownload");
    if (meta && !busy) {
      const uid = currentUid();
      meta.textContent = uid
        ? `${tt("uidLabel")}: ${uid}`
        : tt("panelMeta");
    }
    if (
      status &&
      (status.dataset.i18nReady === "1" ||
        /^(Ready\.|Готово\.)$/.test((status.textContent || "").trim()))
    ) {
      status.textContent = tt("panelReady");
      status.dataset.i18nReady = "1";
    }
    if (dlBtn) dlBtn.textContent = tt("panelDownload");
    if (bulkBtn) bulkBtn.textContent = tt("panelBulk");
    if (devLab) devLab.textContent = tt("devMode");
    const copyBtn = root.querySelector("#sf-dl-copy-log");
    const clearBtn = root.querySelector("#sf-dl-clear-log");
    if (copyBtn) copyBtn.textContent = tt("copyLog");
    if (clearBtn) clearBtn.textContent = tt("clearLog");
    const saveBtn = root.querySelector("#sf-dl-save-log");
    if (saveBtn) saveBtn.textContent = tt("saveLog");
    const tabDl = root.querySelector("#sf-dl-tab-dl");
    const tabSet = root.querySelector("#sf-dl-tab-set");
    if (tabDl) tabDl.textContent = tt("tabDownload");
    if (tabSet) tabSet.textContent = tt("tabSettings");
    const setTitle = root.querySelector("#sf-dl-settings-title");
    if (setTitle) setTitle.textContent = tt("settingsTitle");
    const texLab = root.querySelector("#sf-dl-texlabel");
    if (texLab) texLab.textContent = tt("optTextures");
    const texHint = root.querySelector("#sf-dl-texhint");
    if (texHint) texHint.textContent = tt("optTexturesHint");
    const devHint = root.querySelector("#sf-dl-devhint");
    if (devHint) devHint.textContent = tt("optDevHint");
    const gh = root.querySelector("#sf-dl-gh");
    if (gh) gh.textContent = tt("githubRepo");
    const themeLab = root.querySelector("#sf-dl-theme-label");
    if (themeLab) themeLab.textContent = tt("optTheme");
    const langLab = root.querySelector("#sf-dl-lang-label");
    if (langLab) langLab.textContent = tt("language");
    const saveSet = root.querySelector("#sf-dl-save-settings");
    if (saveSet) saveSet.textContent = tt("saveSettings");
    const saveHint = root.querySelector("#sf-dl-save-hint");
    if (saveHint) saveHint.textContent = tt("settingsSaveHint");
    const packLab = root.querySelector("#sf-dl-pack-label");
    if (packLab) packLab.textContent = tt("optPack");
    const packHint = root.querySelector("#sf-dl-pack-hint");
    if (packHint) packHint.textContent = tt("packHint");
    const resLab = root.querySelector("#sf-dl-res-label");
    if (resLab) resLab.textContent = tt("optTexSize");
    const resHint = root.querySelector("#sf-dl-res-hint");
    if (resHint) resHint.textContent = tt("texSizeHint");
    const jobEl = root.querySelector("#sf-dl-job");
    if (jobEl && uiSettings && uiSettings.formatJobStatus) {
      jobEl.textContent = uiSettings.formatJobStatus(
        {
          textures: appliedTextures,
          devMode,
          packMode: appliedPack,
          maxTextureEdge: appliedEdge,
        },
        (lng, key, vars) => tt(key, vars),
        lang
      );
    }
    bindSettingsPills(root);
    if (i18n && i18n.updateLangSwitch) {
      i18n.updateLangSwitch(root.querySelector("#sf-dl-lang"), lang);
    }
    paintSettingsFlash();
    renderDevUi(root);
  }

  async function switchLang(code) {
    lang = code === "ru" ? "ru" : "en";
    pendingLang = lang;
    if (i18n && i18n.setLang) await i18n.setLang(lang);
    if (settingsApi && settingsApi.savePrefs) {
      await settingsApi.savePrefs({ lang });
    }
    applyPanelI18n(document.getElementById("sf-dl-root"));
  }

  async function ensureUi() {
    if (!isModelPage()) return;
    await ensureI18n();
    await ensureDevFlag();

    if (document.getElementById("sf-dl-root")) {
      applyPanelI18n(document.getElementById("sf-dl-root"));
      return;
    }

    const root = document.createElement("div");
    root.id = "sf-dl-root";
    root.setAttribute("data-theme", "light");
    root.innerHTML = `
      <div id="sf-dl-panel" hidden>
        <div id="sf-dl-header">
          <span class="sf-title-wrap">
            <i id="sf-dl-dot"></i>
            <span id="sf-dl-title-text">Sketchfab Downloader</span>
          </span>
          <div id="sf-dl-header-actions">
            <button id="sf-dl-close" type="button" aria-label="Close">✕</button>
          </div>
        </div>
        <nav class="sf-tabs" role="tablist">
          <button id="sf-dl-tab-dl" class="sf-tab active" type="button">Download</button>
          <button id="sf-dl-tab-set" class="sf-tab" type="button">Settings</button>
        </nav>
        <div id="sf-dl-body">
          <section id="sf-dl-pane-dl" class="sf-pane active">
            <div id="sf-dl-ready">Ready to download</div>
            <div id="sf-dl-job" class="sf-set-hint"></div>
            <div id="sf-dl-meta" data-dev-only>Public model → glTF (GLB)</div>
            <div id="sf-dl-status" data-dev-only data-i18n-ready="1">Ready.</div>
            <div id="sf-dl-progress" hidden>
              <div class="sf-progress-track"><i id="sf-dl-bar"></i></div>
              <span id="sf-dl-pct">0%</span>
            </div>
            <button id="sf-dl-btn" type="button">Download glTF ZIP</button>
            <button id="sf-dl-bulk" type="button" class="sf-secondary">Bulk download page…</button>
            <div id="sf-dl-devpanel" hidden>
              <div id="sf-dl-devactions">
                <button id="sf-dl-copy-log" type="button" class="sf-devbtn">Copy log</button>
                <button id="sf-dl-save-log" type="button" class="sf-devbtn">Save log</button>
                <button id="sf-dl-clear-log" type="button" class="sf-devbtn">Clear</button>
              </div>
              <pre id="sf-dl-devlog"></pre>
            </div>
          </section>
          <section id="sf-dl-pane-set" class="sf-pane">
            <p id="sf-dl-settings-title" class="sf-settings-title">Settings</p>
            <div class="sf-setting">
              <label>
                <input id="sf-dl-textoggle" type="checkbox" />
                <span id="sf-dl-texlabel">Download textures</span>
              </label>
              <p id="sf-dl-texhint" class="sf-set-hint"></p>
            </div>
            <div class="sf-setting">
              <label>
                <input id="sf-dl-devtoggle" type="checkbox" />
                <span id="sf-dl-devlabel">Dev mode</span>
              </label>
              <p id="sf-dl-devhint" class="sf-set-hint"></p>
            </div>
            <div class="sf-setting">
              <span id="sf-dl-theme-label" class="sf-set-cap">Theme</span>
              <div id="sf-dl-theme"></div>
            </div>
            <div class="sf-setting">
              <span id="sf-dl-lang-label" class="sf-set-cap">Language</span>
              <div id="sf-dl-lang"></div>
            </div>
            <div class="sf-setting">
              <span id="sf-dl-pack-label" class="sf-set-cap">Archive</span>
              <div id="sf-dl-pack"></div>
              <p id="sf-dl-pack-hint" class="sf-set-hint"></p>
            </div>
            <div class="sf-setting">
              <span id="sf-dl-res-label" class="sf-set-cap">Texture size</span>
              <div id="sf-dl-res"></div>
              <p id="sf-dl-res-hint" class="sf-set-hint"></p>
            </div>
            <button id="sf-dl-save-settings" type="button">Apply settings</button>
            <div id="sf-dl-settings-flash" hidden></div>
            <p id="sf-dl-save-hint" class="sf-set-hint"></p>
            <div class="sf-gh-box">
              <a id="sf-dl-gh" href="https://github.com/seryi882/sketchfab-downloader-extension" target="_blank" rel="noreferrer">GitHub</a>
              <span class="sf-gh-url">github.com/seryi882/sketchfab-downloader-extension</span>
            </div>
          </section>
        </div>
      </div>
      <button id="sf-dl-fab" type="button" title="Sketchfab Downloader">⬇</button>
    `;
    document.documentElement.appendChild(root);

    const panel = root.querySelector("#sf-dl-panel");
    const closeBtn = root.querySelector("#sf-dl-close");
    const dlBtn = root.querySelector("#sf-dl-btn");
    const bulkBtn = root.querySelector("#sf-dl-bulk");
    const statusEl = root.querySelector("#sf-dl-status");
    const metaEl = root.querySelector("#sf-dl-meta");
    const langHost = root.querySelector("#sf-dl-lang");
    const fab = root.querySelector("#sf-dl-fab");
    const devToggle = root.querySelector("#sf-dl-devtoggle");
    const texToggle = root.querySelector("#sf-dl-textoggle");
    const copyLogBtn = root.querySelector("#sf-dl-copy-log");
    const saveLogBtn = root.querySelector("#sf-dl-save-log");
    const clearLogBtn = root.querySelector("#sf-dl-clear-log");
    const tabDl = root.querySelector("#sf-dl-tab-dl");
    const tabSet = root.querySelector("#sf-dl-tab-set");
    const paneDl = root.querySelector("#sf-dl-pane-dl");
    const paneSet = root.querySelector("#sf-dl-pane-set");

    function showTab(name) {
      const onSet = name === "set";
      tabDl.classList.toggle("active", !onSet);
      tabSet.classList.toggle("active", onSet);
      paneDl.classList.toggle("active", !onSet);
      paneSet.classList.toggle("active", onSet);
    }
    tabDl.addEventListener("click", () => showTab("dl"));
    tabSet.addEventListener("click", () => showTab("set"));

    import(chrome.runtime.getURL("lib/ui-progress.js"))
      .then((m) => {
        uiProgress = m;
      })
      .catch(() => {});

    Promise.all([
      import(chrome.runtime.getURL("lib/settings.js")),
      import(chrome.runtime.getURL("lib/ui-settings.js")),
    ])
      .then(async ([s, ui]) => {
        settingsApi = s;
        uiSettings = ui;
        const prefs = await s.loadPrefs();
        appliedTextures = prefs.textures === true;
        appliedPack = prefs.packMode === "glb" ? "glb" : "full";
        appliedEdge = prefs.maxTextureEdge === 2048 || prefs.maxTextureEdge === 4096
          ? prefs.maxTextureEdge
          : 0;
        pendingTheme = prefs.theme;
        pendingLang = prefs.lang || lang;
        lang = prefs.lang || lang;
        if (texToggle) {
          texToggle.checked = prefs.textures === true;
          texToggle.disabled = false;
          texToggle.addEventListener("change", () => {
            appliedOk = false;
            paintSettingsFlash();
          });
        }
        if (devToggle) {
          devToggle.checked = prefs.devMode === true;
          devToggle.addEventListener("change", () => {
            appliedOk = false;
            paintSettingsFlash();
          });
        }
        s.applyTheme(root, prefs.theme);
        bindSettingsPills(root);

        const saveBtn = root.querySelector("#sf-dl-save-settings");
        if (saveBtn) {
          saveBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              const next = await s.savePrefs({
                textures: !!(texToggle && texToggle.checked),
                devMode: !!(devToggle && devToggle.checked),
              });
              appliedTextures = next.textures === true;
              if (texToggle) texToggle.checked = next.textures === true;
              if (devToggle) devToggle.checked = next.devMode === true;
              devMode = next.devMode === true;
              try {
                const d = await import(chrome.runtime.getURL("lib/devlog.js"));
                d.setDevModeCache(devMode);
              } catch (_) {}
              appliedOk = true;
              applyPanelI18n(root);
              setStatus(tt("settingsSaved"));
              paintSettingsFlash();
            } catch (err) {
              appliedOk = false;
              setStatus(
                "Apply failed: " + (err && err.message ? err.message : err)
              );
              paintSettingsFlash();
            }
          });
        }
        paintSettingsFlash();
        applyPanelI18n(root);
      })
      .catch(() => {
        if (texToggle) {
          texToggle.checked = false;
          texToggle.disabled = false;
        }
      });

    if (i18n && i18n.createLangSwitch) {
      langHost.appendChild(
        i18n.createLangSwitch(lang, (code) => switchLang(code))
      );
    }

    statusCbs.push((msg) => {
      statusEl.textContent = msg;
      delete statusEl.dataset.i18nReady;
    });

    function openPanel() {
      panel.hidden = false;
      fab.hidden = true;
      metaEl.textContent = `${tt("uidLabel")}: ${currentUid() || "—"}`;
      const ready = root.querySelector("#sf-dl-ready");
      if (ready && !busy) ready.textContent = tt("readyDownload");
    }

    function closePanel() {
      panel.hidden = true;
      fab.hidden = false;
    }

    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    });

    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });

    dlBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      dlBtn.disabled = true;
      try {
        await runDownload(location.href);
      } finally {
        dlBtn.disabled = false;
      }
    });

    bulkBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openBulkPage" });
    });

    // Dev toggle is pending until Apply settings.

    async function copyLogToClipboard() {
      const text =
        (root.querySelector("#sf-dl-devlog") &&
          root.querySelector("#sf-dl-devlog").textContent) ||
        liveLog.join("\n") ||
        "";
      try {
        await navigator.clipboard.writeText(text);
        setStatus(tt("logCopied"));
      } catch (_) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;left:-9999px;top:0";
          document.documentElement.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          ta.remove();
          setStatus(tt("logCopied"));
        } catch (e2) {
          setStatus("Copy failed: " + (e2.message || e2));
        }
      }
    }

    if (saveLogBtn) {
      saveLogBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = liveLog.join("\n") || "";
        const name = `sf-dl-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
        try {
          const m = uiProgress || (await import(chrome.runtime.getURL("lib/ui-progress.js")));
          uiProgress = m;
          m.saveTextFile(name, text);
          setStatus(tt("logSaved"));
        } catch (err) {
          setStatus("Save failed: " + (err && err.message ? err.message : err));
        }
      });
    }
    if (copyLogBtn) {
      copyLogBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyLogToClipboard();
      });
    }
    if (clearLogBtn) {
      clearLogBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        liveLog = [];
        renderDevUi(root);
      });
    }

    root._sfOpenPanel = openPanel;
    root._sfRunDownload = async () => {
      openPanel();
      if (busy) return;
      dlBtn.disabled = true;
      try {
        await runDownload(location.href);
      } finally {
        dlBtn.disabled = false;
      }
    };

    applyPanelI18n(root);
    // Keep panel closed; show FAB only
    closePanel();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === "ping") {
      sendResponse({
        ok: true,
        isModelPage: isModelPage(),
        uid: currentUid(),
        href: location.href,
        busy,
        lang,
        devMode,
      });
      return true;
    }

    if (msg.action === "openPanel") {
      ensureUi()
        .then(() => {
          const root = document.getElementById("sf-dl-root");
          if (root && root._sfOpenPanel) root._sfOpenPanel();
          sendResponse({ ok: true });
        })
        .catch((e) =>
          sendResponse({
            ok: false,
            error: e && e.message ? e.message : String(e),
          })
        );
      return true;
    }

    if (msg.action === "downloadCurrent") {
      if (!isModelPage()) {
        sendResponse({ ok: false, error: "Not a Sketchfab model page" });
        return true;
      }
      ensureUi()
        .then(() => {
          const root = document.getElementById("sf-dl-root");
          if (root && root._sfOpenPanel) root._sfOpenPanel();
          return runDownload(location.href, {
            downloadTextures:
              msg.downloadTextures === true || msg.downloadTextures === false
                ? msg.downloadTextures === true
                : undefined,
            devMode:
              msg.devMode === true || msg.devMode === false
                ? msg.devMode === true
                : undefined,
            packMode:
              msg.packMode === "glb" || msg.packMode === "full"
                ? msg.packMode
                : undefined,
            maxTextureEdge:
              msg.maxTextureEdge === 0 ||
              msg.maxTextureEdge === 2048 ||
              msg.maxTextureEdge === 4096
                ? msg.maxTextureEdge
                : undefined,
          });
        })
        .then((r) =>
          sendResponse({ ok: true, name: r.name, zipName: r.zipName })
        )
        .catch((e) =>
          sendResponse({
            ok: false,
            error: e && e.message ? e.message : String(e),
          })
        );
      return true;
    }

    if (msg.action === "setLang") {
      switchLang(msg.lang)
        .then(() => sendResponse({ ok: true, lang }))
        .catch((e) =>
          sendResponse({
            ok: false,
            error: e && e.message ? e.message : String(e),
          })
        );
      return true;
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.sf_lang) {
        const v = changes.sf_lang.newValue;
        if ((v === "en" || v === "ru") && v !== lang) {
          lang = v;
          applyPanelI18n(document.getElementById("sf-dl-root"));
        }
      }
      if (changes.sf_dev_mode) {
        devMode = !!changes.sf_dev_mode.newValue;
        renderDevUi();
      }
      if (changes.sf_prefs && changes.sf_prefs.newValue) {
        const p = changes.sf_prefs.newValue;
        appliedTextures = p.textures === true;
        appliedPack = p.packMode === "glb" ? "glb" : "full";
        appliedEdge =
          p.maxTextureEdge === 2048 || p.maxTextureEdge === 4096
            ? p.maxTextureEdge
            : 0;
        pendingTheme = p.theme === "dark" ? "dark" : "light";
        pendingLang = p.lang === "ru" ? "ru" : "en";
        lang = pendingLang;
        devMode = p.devMode === true;
        const dirty = isSettingsDirty();
        const el = document.querySelector("#sf-dl-textoggle");
        const devEl = document.querySelector("#sf-dl-devtoggle");
        if (!dirty) {
          if (el) {
            el.checked = p.textures === true;
            el.disabled = false;
          }
          if (devEl) devEl.checked = p.devMode === true;
          appliedOk = true;
        }
        const root = document.getElementById("sf-dl-root");
        if (root && settingsApi && settingsApi.applyTheme) {
          settingsApi.applyTheme(root, pendingTheme);
        } else if (root) {
          root.setAttribute("data-theme", pendingTheme);
        }
        applyPanelI18n(document.getElementById("sf-dl-root"));
      }
    });
  } catch (_) {}

  if (isModelPage()) ensureUi();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      const existing = document.getElementById("sf-dl-root");
      if (!isModelPage()) {
        if (existing) existing.remove();
      } else {
        ensureUi().then(() => {
          const meta = document.querySelector("#sf-dl-meta");
          if (meta) meta.textContent = `${tt("uidLabel")}: ${currentUid()}`;
          if (!busy) setStatus(tt("panelReady"));
        });
      }
    }
  }, 800);
})();
