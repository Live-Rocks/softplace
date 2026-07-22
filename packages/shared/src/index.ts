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

export type AvaAvailability = "available" | "busy" | "resting";

export type AvaProactiveLevel = "off" | "low" | "normal";

export type AvaMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proactive: boolean;
  createdAt: string;
  readAt?: string | null;
};

export type AvaMemory = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type AvaPreferences = {
  proactiveLevel: AvaProactiveLevel;
  quietStart: string;
  quietEnd: string;
  timezone: string;
};

export type AvaState = {
  companionKey: "ava";
  name: "Ava";
  availability: AvaAvailability;
  statusLabel: "有空" | "在忙" | "休息了";
  relationshipStage: "new" | "familiar" | "close";
  pendingReply: boolean;
  unreadCount: number;
  dailyUsed: number;
  dailyLimit: number;
  preferences: AvaPreferences;
};

export type AvaMessagesResponse = {
  messages: AvaMessage[];
  nextCursor: string | null;
  state: AvaState;
};

export type AvaSendResponse = {
  message: AvaMessage;
  assistantMessage?: AvaMessage;
  state: AvaState;
  crisisDetected: boolean;
};
