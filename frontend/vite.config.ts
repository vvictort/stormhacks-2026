import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward comms API + SSE to the backend service (backend/comms, port 3001 by default).
    proxy: {
      "/comms": { target: process.env.COMMS_URL ?? "http://localhost:3001" },
    },
  },
});
