// PILOT: subpath fetch interceptor (prepends BASE_URL to absolute /api/* fetches)
(() => {
  const BASE = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
  if (!BASE) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input: any, init?: any) => {
    if (typeof input === "string" && input.startsWith("/api/")) input = BASE + input;
    else if (input && typeof input === "object" && typeof input.url === "string" && input.url.startsWith("/api/")) input = new Request(BASE + input.url, input);
    return orig(input, init);
  };
  const wsOrig = window.WebSocket;
  // @ts-ignore
  window.WebSocket = function(url: string, p?: any) { if (typeof url === "string" && url.startsWith("/")) url = location.protocol.replace("http","ws") + "//" + location.host + BASE + url; return new wsOrig(url, p); };
})();

import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { CompanyProvider, useCompany } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { EditorAutocompleteProvider } from "./context/EditorAutocompleteContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function CompanyAwareBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { selectedCompany } = useCompany();
  return <BreadcrumbProvider companyName={selectedCompany?.name ?? null}>{children}</BreadcrumbProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
          <CompanyProvider>
            <EditorAutocompleteProvider>
              <ToastProvider>
                <LiveUpdatesProvider>
                  <TooltipProvider>
                    <CompanyAwareBreadcrumbProvider>
                      <SidebarProvider>
                        <PanelProvider>
                          <PluginLauncherProvider>
                            <DialogProvider>
                              <App />
                            </DialogProvider>
                          </PluginLauncherProvider>
                        </PanelProvider>
                      </SidebarProvider>
                    </CompanyAwareBreadcrumbProvider>
                  </TooltipProvider>
                </LiveUpdatesProvider>
              </ToastProvider>
            </EditorAutocompleteProvider>
          </CompanyProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
