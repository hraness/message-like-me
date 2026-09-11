import { mountPanel } from "./panel.ts";
import { nativePort } from "./native-port.ts";
mountPanel(document.querySelector<HTMLElement>("#app")!, nativePort);
