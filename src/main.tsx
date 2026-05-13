import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        const swUrl = new URL("sw.js", document.baseURI).toString();

        navigator.serviceWorker.register(swUrl).catch((error) => {
            console.error("Service worker registration failed:", error);
        });
    });
}