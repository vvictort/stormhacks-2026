import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The backend (backend/, port 3000) serves /api. Same-origin in dev, so no CORS.
  server: { proxy: { "/api": "http://localhost:3000" } },
});
