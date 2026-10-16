import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { vugenPlugin } from "./server/vite-plugin.js";

export default defineConfig({
  plugins: [tailwindcss(), vugenPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Aturan 7 (plan §4): hasil run dan Save tidak boleh memicu reload di tengah run.
    watch: {
      ignored: ["**/.cache/**", "**/samples/**", "**/node_modules/**"],
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.js", "src/**/*.test.js"],
    // Import dingin + banyak proses anak paralel kadang melewati 5 detik (terlihat 2x di mesin ini).
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
