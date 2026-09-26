import { mount } from "svelte";
import "../src/shared/tokens.css";
import "../src/shared/popup-ui.css";
import "../src/shared/view-transitions.css";
import "./playground.css";
import "./tuner.css";
import { mockBackend } from "./mock-backend";
import { createSeedJobs } from "./seed";
import { app, setBackend } from "../src/shared/store.svelte";
import Tuner from "./Tuner.svelte";
// Starts Theatre.js studio; after the CSS above so it reads the default tokens.
import "./transition-tuner";

setBackend(mockBackend);
app.jobs = createSeedJobs();

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");

export default mount(Tuner, { target });
