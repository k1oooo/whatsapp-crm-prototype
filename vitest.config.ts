import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors the "@/*" -> "./*" path alias from tsconfig.json so lib/ modules
// can be imported the same way in tests as they are in the app.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
