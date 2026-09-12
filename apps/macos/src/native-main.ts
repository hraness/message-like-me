import { mountPanel } from "./panel.ts";
import { nativePort } from "./native-port.ts";
import { nativeLifecyclePort } from "./lifecycle.ts";
mountPanel(document.querySelector<HTMLElement>("#app")!, nativePort, nativeLifecyclePort);
