import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, currentTheme } from "./themes";

applyTheme(currentTheme().id); // the theme and light/dark mode last used in this browser, before anything draws
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
