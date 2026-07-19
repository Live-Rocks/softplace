import type {
  CompanionMode,
  Conversation,
  Memory,
  MemoryCategory,
  Message,
  Plan,
  UsageState
} from "@softplace/shared";

export type AuthUser = {
  id: string;
  email?: string | null;
  plan: Plan;
};

export type CreateMessageInput = {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string | null;
  mode?: CompanionMode | null;
  imagePresent?: boolean;
  crisisDetected?: boolean;
};

export type CreateMemoryInput = {
  userId: string;
  content: string;
  category: MemoryCategory;
};

export type Repository = {
  getOrCreateProfile(user: Pick<AuthUser, "id" | "email">): Promise<AuthUser>;
  listConversations(userId: string): Promise<Conversation[]>;
  getConversation(userId: string, conversationId: string): Promise<Conversation | null>;
  createConversation(userId: string, title: string): Promise<Conversation>;
  getOrCreatePrimaryConversation(userId: string): Promise<Conversation>;
  touchConversation(userId: string, conversationId: string): Promise<void>;
  deleteConversation(userId: string, conversationId: string): Promise<void>;
  listMessages(
    userId: string,
    conversationId: string,
    options?: { limit?: number; before?: { createdAt: string; id: string } }
  ): Promise<Message[]>;
  createMessage(input: CreateMessageInput): Promise<Message>;
  listMemories(userId: string): Promise<Memory[]>;
  createMemory(input: CreateMemoryInput): Promise<Memory>;
  updateMemory(userId: string, memoryId: string, input: Partial<Pick<Memory, "content" | "category">>): Promise<Memory>;
  deleteMemory(userId: string, memoryId: string): Promise<void>;
  getUsage(userId: string, plan: Plan): Promise<UsageState>;
  incrementUsage(userId: string, usage: { deep?: number }): Promise<UsageState>;
};
