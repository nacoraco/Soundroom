import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_PROXY_TARGET || "http://localhost:8000";
  const allowedHostsValue = (
    process.env.VITE_ALLOWED_HOSTS ??
    env.VITE_ALLOWED_HOSTS ??
    ""
  ).trim();
  const allowedHosts =
    allowedHostsValue === "*" || allowedHostsValue === "true"
      ? true
      : allowedHostsValue
        ? allowedHostsValue
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean)
        : undefined;

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      allowedHosts,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
