/** Personal reading is opt-in and only valid for a loopback deployment, never a cloud host. */
export function isLoopbackHost(host: string): boolean {
  try {
    const url = new URL(`http://${host}`);
    return !url.username && !url.password && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function localPreviewEnabled(env: Record<string, string | undefined>): boolean {
  if (env.LOCAL_FULLTEXT_PREVIEW !== "true" || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PUBLIC_DOMAIN) return false;
  try {
    return isLoopbackHost(new URL(env.SITE_URL ?? "").host)
      && isLoopbackHost(env.WEB_HOST || "127.0.0.1")
      && isLoopbackHost(env.API_HOST || "127.0.0.1");
  } catch { return false; }
}
