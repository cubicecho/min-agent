import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ChatsRoute } from "@/routes/chats";
import { ConfigRoute } from "@/routes/config";
import { CronRoute } from "@/routes/cron";
import { McpRoute } from "@/routes/mcp";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/chats" });
  },
});

const chatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats",
  component: ChatsRoute,
});

const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats/$sessionId",
  component: ChatsRoute,
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp",
  component: McpRoute,
});
const cronRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cron",
  component: CronRoute,
});
const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: ConfigRoute,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    chatsRoute,
    chatSessionRoute,
    mcpRoute,
    cronRoute,
    configRoute,
  ]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
