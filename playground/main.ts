import { mount } from "svelte";
import "../src/shared/tokens.css";
import "../src/shared/popup-ui.css";
import "../src/shared/view-transitions.css";
import "./playground.css";
import App from "./App.svelte";
import { mockBackend } from "./mock-backend";
import { createSeedJobs } from "./seed";
import { ensurePageButtonStyles } from "../src/entrypoints/sketchfab.content/page-button-styles";
import { app, setBackend } from "../src/shared/store.svelte";

setBackend(mockBackend);
// The page buttons live in the light DOM on Sketchfab; the stage mirrors that.
ensurePageButtonStyles();

const seeds = createSeedJobs();
app.jobs = seeds;
const survolt = seeds.find((j) => j.name.includes("Survolt"))!;
app.pageUid = survolt.uid;
app.pageUrl = survolt.url;

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");

const instance = mount(App, { target });

export default instance;
