import { SETTINGS_STALE_TIME } from "@shared/client/queries.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { router } from "@/router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Sessions have to stay fresh — the list is redrawn after every turn — but these two do not.
queryClient.setQueryDefaults(["config"], { staleTime: SETTINGS_STALE_TIME });
queryClient.setQueryDefaults(["models"], { staleTime: SETTINGS_STALE_TIME });

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
