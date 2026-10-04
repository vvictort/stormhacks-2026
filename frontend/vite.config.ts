import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same-origin in dev, so no CORS: the backend (backend/, port 3000) serves /api, including the
  // /api/comms text and call routes and their SSE stream.
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
