import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "../server/src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
