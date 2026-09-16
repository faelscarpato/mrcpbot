import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "EVAL" &&
          warning.message.includes("web-tree-sitter")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
});
