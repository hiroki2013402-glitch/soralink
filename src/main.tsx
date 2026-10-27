import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyPrefs } from "./lib/preferences";

applyPrefs();

// The admin screen is loaded only when its path is opened, so regular visitors do not download it.
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

// /admin is the admin screen; every other path is the app.
const isAdminPath = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAdminPath ? <Suspense fallback={null}><AdminPage /></Suspense> : <App />}
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
