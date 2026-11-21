import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiPort = env.API_PORT || env.PORT || "8091";
  const webPort = Number(env.WEB_PORT || "8090");

  const allowedHostsRaw = env.VITE_ALLOWED_HOSTS?.trim();
  const allowedHosts: true | string[] =
    !allowedHostsRaw || allowedHostsRaw === "true" || allowedHostsRaw === "*"
      ? true
      : allowedHostsRaw
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean);

  const hmrClientPort = env.VITE_HMR_CLIENT_PORT
    ? Number(env.VITE_HMR_CLIENT_PORT)
    : undefined;
  const hmrProtocol = env.VITE_HMR_PROTOCOL?.trim() || undefined;
  const hmrHost = env.VITE_HMR_HOST?.trim() || undefined;
  const hmr =
    hmrClientPort || hmrProtocol || hmrHost
      ? {
          ...(hmrClientPort ? { clientPort: hmrClientPort } : {}),
          ...(hmrProtocol ? { protocol: hmrProtocol } : {}),
          ...(hmrHost ? { host: hmrHost } : {}),
        }
      : undefined;

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "favicon.svg",
          "apple-touch-icon.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "pwa-maskable-512x512.png",
        ],
        manifest: {
          name: "Kiln — Recipes & Shopping Lists",
          short_name: "Kiln",
          description:
            "Personal recipe book, Cook Mode, and offline grocery shopping lists",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          theme_color: "#d97706",
          background_color: "#fafaf9",
          icons: [
            {
              src: "pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/django-static\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/api/images/"),
              handler: "CacheFirst",
              options: {
                cacheName: "kiln-recipe-images",
                expiration: {
                  maxEntries: 250,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: "module",
          navigateFallback: "index.html",
        },
      }),
    ],
    server: {
      host: "0.0.0.0",
      port: webPort,
      strictPort: true,
      allowedHosts,
      ...(hmr ? { hmr } : {}),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
