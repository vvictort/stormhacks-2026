import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The backend (backend/, port 3000) serves /api. Same-origin in dev, so no CORS.
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:3000" } },
});
