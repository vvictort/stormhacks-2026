import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The backend (backend/, port 3000) serves /api. Same-origin in dev, so no CORS.
    proxy: {
      "/api": "http://localhost:3000",
      // Forward comms API + SSE to the backend service (backend/comms, port 3001 by default).
      "/comms": { target: process.env.COMMS_URL ?? "http://localhost:3001" },
    },
  },
});
