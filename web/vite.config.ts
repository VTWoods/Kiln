import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
    plugins: [react(), tailwindcss()],
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
