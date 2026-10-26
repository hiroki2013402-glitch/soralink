import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminPage from "./pages/admin/AdminPage";
import "./styles.css";

// /admin is the admin screen; every other path is the app.
const isAdminPath = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAdminPath ? <AdminPage /> : <App />}
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
