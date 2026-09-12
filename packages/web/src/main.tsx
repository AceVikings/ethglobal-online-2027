import "@fontsource/instrument-serif";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { PrivyAuthProvider } from "./auth/PrivyAuth";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyAuthProvider>
      <App />
    </PrivyAuthProvider>
  </StrictMode>,
);
