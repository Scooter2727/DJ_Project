import { defineConfig } from "vite";
import { resolve } from "node:path";
import { createAiMixMiddleware } from "../backend/aiMix/api.mjs";

export default defineConfig({
  plugins: [{
    name: "mainstage-ai-mix",
    configureServer(server) {
      server.middlewares.use(createAiMixMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createAiMixMiddleware());
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        visionLab: resolve(import.meta.dirname, "vision-lab.html"),
      },
    },
  },
});
