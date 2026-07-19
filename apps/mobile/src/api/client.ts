import type {
  ChatRequest,
  ChatResponse,
  ConversationMessagesResponse,
  Message,
  Memory,
  PendingMemorySuggestion,
  UsageState
} from "@softplace/shared";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? "Request failed");
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  chat: (request: ChatRequest, token: string) =>
    apiRequest<ChatResponse>("/api/chat", { method: "POST", body: request, token }),
  conversationMessages: (token: string, before?: string) => {
    const query = new URLSearchParams({ limit: "50" });
    if (before) query.set("before", before);
    return apiRequest<ConversationMessagesResponse>(`/api/conversations/current/messages?${query}`, { token });
  },
  deleteConversation: (token: string) =>
    apiRequest<void>("/api/conversations/current", { method: "DELETE", token }),
  usage: (token: string) =>
    apiRequest<{
      usage: UsageState;
      provider: "openai" | "local";
      models: { deep: string; light: string };
    }>("/api/me/usage", { token }),
  memories: (token: string) => apiRequest<{ memories: Memory[] }>("/api/memories", { token }),
  createMemory: (memory: PendingMemorySuggestion, token: string) =>
    apiRequest<{ memory: Memory }>("/api/memories", { method: "POST", body: memory, token }),
  updateMemory: (memoryId: string, memory: Partial<Memory>, token: string) =>
    apiRequest<{ memory: Memory }>(`/api/memories/${memoryId}`, { method: "PATCH", body: memory, token }),
  deleteMemory: (memoryId: string, token: string) =>
    apiRequest<void>(`/api/memories/${memoryId}`, { method: "DELETE", token })
};
