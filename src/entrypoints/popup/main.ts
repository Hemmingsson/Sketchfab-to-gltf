import { mount } from "svelte";
import "../../shared/tokens.css";
import "../../shared/popup-ui.css";
import "../../shared/view-transitions.css";
import "./popup.css";
import PopupShell from "../../components/PopupShell.svelte";
import { setBackend } from "../../shared/store.svelte";
import { chromeBackend, listenForJobs, loadJobs, loadSettings, watchSettings } from "../../shared/chrome-backend";

setBackend(chromeBackend);
watchSettings();
listenForJobs();
Promise.allSettled([loadJobs(), loadSettings()]).then(() => {
  mount(PopupShell, { target: document.getElementById("app")!, props: { framed: false } });
});
