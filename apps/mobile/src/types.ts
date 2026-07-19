import type { Message, PendingMemorySuggestion } from "@softplace/shared";

export type AppTab = "home" | "chat" | "memories" | "settings";

export type LocalMessage = Message | {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  imagePresent?: boolean;
};

export type PendingMemory = PendingMemorySuggestion & {
  id: string;
};

