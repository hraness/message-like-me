import { mountPanel } from "./panel.ts";
import { createDemoPort } from "./demo-port.ts";
mountPanel(document.querySelector<HTMLElement>("#app")!, createDemoPort());
