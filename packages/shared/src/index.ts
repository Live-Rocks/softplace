export type Plan = "free" | "plus" | "pro";

export type CompanionMode = "deep" | "light";

export type AiProvider = "openai" | "local";

export type MessageRole = "user" | "assistant" | "system";

export type MemoryCategory = "preference" | "emotional_context";

export type Conversation = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  modelUsed?: string | null;
  mode?: CompanionMode | null;
  imagePresent?: boolean;
  crisisDetected?: boolean;
  createdAt: string;
};

export type Memory = {
  id: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  updatedAt: string;
};

export type UsageState = {
  plan: Plan;
  month: string;
  deepMessagesUsed: number;
  deepMessagesLimit: number;
};

export type ChatRequest = {
  message: string;
  requestedMode: CompanionMode;
  entryIntent?: string;
  imageBase64?: string;
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
};

export type PendingMemorySuggestion = {
  content: string;
  category: MemoryCategory;
};

export type ChatResponse = {
  conversationId: string;
  assistantMessage: Message;
  usage: UsageState;
  mode: CompanionMode;
  modelUsed: string;
  provider: AiProvider;
  crisisDetected: boolean;
  memorySuggestions: PendingMemorySuggestion[];
  imageAccepted: boolean;
  quotaNotice?: string;
};

export type ConversationMessagesResponse = {
  conversation: Conversation;
  messages: Message[];
  nextCursor: string | null;
};

export type ApiErrorBody = {
  error: string;
  code?: string;
};
