import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import "./styles/tailwind.css";
import "./styles/variables.css";
import "./styles/global.css";
import "./styles/animations.css";
import "./styles/components/layout.css";
import "./styles/components/forms.css";
import "./styles/components/rail.css";
import "./styles/components/hud.css";
import "./styles/components/chat.css";
import "./styles/components/inspector.css";
import "./styles/hero.css";
import "./styles/mobile-landing.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);