import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { graphqlCodegen } from "./plugins/graphql-codegen.ts";

export default defineConfig(({ mode }) => {
  // The API server takes HOST and PORT from .env, so the proxy has to read the same file
  // or it goes on knocking at 8787 after the server has moved. An empty prefix means
  // every variable, not just the VITE_ ones, and the shell still wins over the file.
  const env = loadEnv(mode, process.cwd(), "");
  // A wildcard bind is what to connect *through*, not to.
  const host = !env.HOST || env.HOST === "0.0.0.0" || env.HOST === "::" ? "localhost" : env.HOST;

  return {
    plugins: [graphqlCodegen(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy: {
        "/graphql": {
          target: `http://${host}:${env.PORT || 8787}`,
          changeOrigin: true,
        },
      },
    },
  };
});
