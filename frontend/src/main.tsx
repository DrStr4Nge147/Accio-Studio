import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./lib/pwa";
import { watchTheme } from "./store/ui";
import { watchNotifyKeepAlive, watchNotifyUnlock } from "./lib/notify";
import "./index.css";

watchTheme();
watchNotifyUnlock();
watchNotifyKeepAlive();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
