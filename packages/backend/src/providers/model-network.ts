import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { credential } from "../config.ts";

/** Initialize before API OAuth and worker inference. Node's env-proxy flag may be read before --env-file. */
export function configureModelNetwork() {
  const proxy = credential("models", "MODEL_PROXY_URL");
  if (!proxy) return;
  const url = new URL(proxy);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("MODEL_PROXY_URL must use HTTP or HTTPS");
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy: "localhost,127.0.0.1,::1" }));
}
