import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same-origin in dev, so no CORS: the main backend (backend/, port 3000) serves /api, and
  // the comms service (backend/comms, port 3001 by default) serves /comms, including SSE.
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/comms": { target: process.env.COMMS_URL ?? "http://localhost:3001" },
    },
  },
});
