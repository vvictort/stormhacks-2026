import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The livekit chunk (only reached from the lazy call path) is livekit-client's prebundled ESM build: one ~520 kB
    // module with its dependencies inlined, which no chunking can split. Every other chunk stays under 500 kB.
    chunkSizeWarningLimit: 540,
    rolldownOptions: {
      output: {
        // Vendor chunks that change less often than the app. LiveKit and ElevenLabs are only reachable from the lazy
        // CallExperience chunk, so their chunks load with a call and never for SMS, email or home.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: "firebase", test: /node_modules[\\/](firebase|@firebase)[\\/]/ },
            { name: "livekit", test: /node_modules[\\/](livekit-client|@livekit)[\\/]/ },
            { name: "elevenlabs", test: /node_modules[\\/]@elevenlabs[\\/]/ },
            // Icons are tiny; one chunk instead of a request per icon.
            { name: "icons", test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
  // Same-origin in dev, so no CORS: the backend (backend/, port 3000) serves /api, including the
  // /api/comms text and call routes and their SSE stream.
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
