import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      containerClassName="toast-container"
      gutter={10}
      toastOptions={{
        duration: 4000,
        className: "toast-custom",
        style: {
          background: "#14161c",
          color: "#f2f3f5",
          border: "1px solid #23262e",
          borderRadius: "12px",
          boxShadow: "0 10px 34px rgba(0,0,0,0.65)",
          fontSize: "13px",
          maxWidth: "22rem",
        },
        success: { iconTheme: { primary: "#22c55e", secondary: "#14161c" } },
        error: { iconTheme: { primary: "#ef4444", secondary: "#14161c" } },
      }}
    />
  </React.StrictMode>
);
