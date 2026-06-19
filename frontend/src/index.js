import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { registerOurRealmSW } from "@/sw-register";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Service worker — see /app/frontend/src/sw-register.js for the
// auto-update + stale-bundle recovery flow. Registration is deferred
// to `window.load` inside the helper so it never blocks first paint.
registerOurRealmSW();
