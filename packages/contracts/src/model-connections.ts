export interface ModelConnections {
  modelCallsEnabled: boolean;
  workerOnline: boolean;
  counts: { articles: number; published: number };
  tasks: Array<{ id: string; connection_id: string; kind: "verify" | "bootstrap"; status: "queued" | "running" | "complete" | "failed"; error?: string | null; detail?: unknown }>;
  connections: Array<{ id: string; name: string; provider: string; authMode: "api_key" | "oauth"; modelId: string; baseUrl: string | null; configured: boolean; active: boolean; loginStatus: string; loginError?: string | null; verifiedAt?: string | null }>;
  providers: Array<{ id: string; name: string; apiKey: boolean; oauth: boolean; subscription: boolean; models: Array<{ id: string; name: string }> }>;
}
export interface ModelLogin {
  id: string;
  connectionId: string;
  error?: string;
  status: "pending" | "complete" | "failed" | "cancelled";
  events: Array<{ type: string; message?: string; url?: string; instructions?: string; userCode?: string; verificationUri?: string }>;
  prompt?: { id: string; type: "text" | "secret" | "select" | "manual_code"; message: string; placeholder?: string; options?: ReadonlyArray<{ id: string; label: string }> };
}
