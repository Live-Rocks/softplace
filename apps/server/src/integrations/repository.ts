import crypto from "node:crypto";
import type { Conversation, Memory, Message, Plan, UsageState } from "@softplace/shared";
import { currentUsageMonth, withPlanLimits } from "../domain/usage.js";
import { supabaseAdmin } from "./supabase.js";
import type { AuthUser, CreateMemoryInput, CreateMessageInput, Repository } from "../types.js";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export function createRepository(): Repository {
  return supabaseAdmin ? createSupabaseRepository() : createMemoryRepository();
}

export function createMemoryRepository(): Repository {
  const profiles = new Map<string, AuthUser>();
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const memories = new Map<string, Memory>();
  const usages = new Map<string, UsageState>();

  return {
    async getOrCreateProfile(user) {
      const existing = profiles.get(user.id);
      if (existing) return existing;
      const profile: AuthUser = { id: user.id, email: user.email, plan: "plus" };
      profiles.set(user.id, profile);
      return profile;
    },
    async listConversations(userId) {
      return [...conversations.values()]
        .filter((conversation) => conversation.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getConversation(userId, conversationId) {
      const conversation = conversations.get(conversationId);
      return conversation?.userId === userId ? conversation : null;
    },
    async createConversation(userId, title) {
      const conversation: Conversation = {
        id: id(),
        userId,
        title,
        createdAt: now(),
        updatedAt: now()
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async getOrCreatePrimaryConversation(userId) {
      const existing = [...conversations.values()].find((conversation) => conversation.userId === userId);
      if (existing) return existing;
      const conversation: Conversation = {
        id: id(),
        userId,
        title: "我的 SoftPlace",
        createdAt: now(),
        updatedAt: now()
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async touchConversation(userId, conversationId) {
      const conversation = conversations.get(conversationId);
      if (conversation?.userId === userId) {
        conversation.updatedAt = now();
      }
    },
    async deleteConversation(userId, conversationId) {
      const conversation = conversations.get(conversationId);
      if (conversation?.userId !== userId) return;
      conversations.delete(conversationId);
      for (const message of messages.values()) {
        if (message.conversationId === conversationId) messages.delete(message.id);
      }
    },
    async listMessages(userId, conversationId, options = {}) {
      const conversation = conversations.get(conversationId);
      if (conversation?.userId !== userId) return [];
      const limit = options.limit ?? 24;
      return [...messages.values()]
        .filter((message) => message.conversationId === conversationId)
        .filter(
          (message) =>
            !options.before ||
            message.createdAt < options.before.createdAt ||
            (message.createdAt === options.before.createdAt && message.id < options.before.id)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(-limit);
    },
    async createMessage(input) {
      const message: Message = {
        id: id(),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        modelUsed: input.modelUsed ?? null,
        mode: input.mode ?? null,
        imagePresent: Boolean(input.imagePresent),
        crisisDetected: Boolean(input.crisisDetected),
        createdAt: now()
      };
      messages.set(message.id, message);
      return message;
    },
    async listMemories(userId) {
      return [...memories.values()]
        .filter((memory) => memory.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createMemory(input) {
      const memory: Memory = {
        id: id(),
        userId: input.userId,
        content: input.content,
        category: input.category,
        createdAt: now(),
        updatedAt: now()
      };
      memories.set(memory.id, memory);
      return memory;
    },
    async updateMemory(userId, memoryId, input) {
      const existing = memories.get(memoryId);
      if (!existing || existing.userId !== userId) throw new Error("Memory not found");
      const updated: Memory = { ...existing, ...input, updatedAt: now() };
      memories.set(memoryId, updated);
      return updated;
    },
    async deleteMemory(userId, memoryId) {
      const existing = memories.get(memoryId);
      if (existing?.userId === userId) memories.delete(memoryId);
    },
    async getUsage(userId, plan) {
      const key = `${userId}:${currentUsageMonth()}`;
      const usage = usages.get(key) ?? withPlanLimits(plan);
      usages.set(key, usage);
      return usage;
    },
    async incrementUsage(userId, delta) {
      const profile = profiles.get(userId);
      const plan = profile?.plan ?? "plus";
      const key = `${userId}:${currentUsageMonth()}`;
      const usage = usages.get(key) ?? withPlanLimits(plan);
      const updated = {
        ...usage,
        deepMessagesUsed: usage.deepMessagesUsed + (delta.deep ?? 0)
      };
      usages.set(key, updated);
      return updated;
    }
  };
}

function createSupabaseRepository(): Repository {
  const db = supabaseAdmin!;
  const getConversation = async (userId: string, conversationId: string) => {
    const { data, error } = await db
      .from("conversations")
      .select("id,user_id,title,created_at,updated_at")
      .eq("user_id", userId)
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapConversation(data) : null;
  };
  const getUsage = async (userId: string, plan: Plan) => {
    const month = currentUsageMonth();
    const { data, error } = await db
      .from("usage_limits")
      .select("month,deep_messages_used")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();
    if (error) throw error;
    if (!data) return withPlanLimits(plan, { month });
    return withPlanLimits(plan, {
      month: data.month,
      deepMessagesUsed: data.deep_messages_used
    });
  };
  const getOrCreatePrimaryConversation = async (userId: string) => {
    const { data: existing, error: selectError } = await db
      .from("conversations")
      .select("id,user_id,title,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return mapConversation(existing);

    const { data, error } = await db
      .from("conversations")
      .insert({ user_id: userId, title: "我的 SoftPlace" })
      .select("id,user_id,title,created_at,updated_at")
      .single();
    if (!error) return mapConversation(data);

    if (error.code === "23505") {
      const { data: raced, error: racedError } = await db
        .from("conversations")
        .select("id,user_id,title,created_at,updated_at")
        .eq("user_id", userId)
        .single();
      if (racedError) throw racedError;
      return mapConversation(raced);
    }
    throw error;
  };

  return {
    async getOrCreateProfile(user) {
      const { data: existing, error: selectError } = await db
        .from("profiles")
        .select("id,email,plan")
        .eq("id", user.id)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) return { id: existing.id, email: existing.email, plan: existing.plan };

      const { data, error } = await db
        .from("profiles")
        .insert({ id: user.id, email: user.email, plan: "plus" })
        .select("id,email,plan")
        .single();
      if (error?.code === "23505") {
        const { data: raced, error: racedError } = await db
          .from("profiles")
          .select("id,email,plan")
          .eq("id", user.id)
          .single();
        if (racedError) throw racedError;
        return { id: raced.id, email: raced.email, plan: raced.plan };
      }
      if (error) throw error;
      return { id: data.id, email: data.email, plan: data.plan };
    },
    async listConversations(userId) {
      const { data, error } = await db
        .from("conversations")
        .select("id,user_id,title,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapConversation);
    },
    async getConversation(userId, conversationId) {
      return getConversation(userId, conversationId);
    },
    async createConversation(userId, title) {
      const { data, error } = await db
        .from("conversations")
        .insert({ user_id: userId, title })
        .select("id,user_id,title,created_at,updated_at")
        .single();
      if (error) throw error;
      return mapConversation(data);
    },
    async getOrCreatePrimaryConversation(userId) {
      return getOrCreatePrimaryConversation(userId);
    },
    async touchConversation(userId, conversationId) {
      const { error } = await db
        .from("conversations")
        .update({ updated_at: now() })
        .eq("id", conversationId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    async deleteConversation(userId, conversationId) {
      const { error } = await db
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    async listMessages(userId, conversationId, options = {}) {
      const conversation = await getConversation(userId, conversationId);
      if (!conversation) return [];
      const limit = options.limit ?? 24;
      let query = db
        .from("messages")
        .select("id,conversation_id,role,content,model_used,mode,image_present,crisis_detected,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (options.before) {
        query = query.or(
          `created_at.lt.${options.before.createdAt},and(created_at.eq.${options.before.createdAt},id.lt.${options.before.id})`
        );
      }
      const { data, error } = await query
        .limit(limit);
      if (error) throw error;
      return (data ?? []).reverse().map(mapMessage);
    },
    async createMessage(input) {
      const { data, error } = await db
        .from("messages")
        .insert({
          conversation_id: input.conversationId,
          role: input.role,
          content: input.content,
          model_used: input.modelUsed,
          mode: input.mode,
          image_present: Boolean(input.imagePresent),
          crisis_detected: Boolean(input.crisisDetected)
        })
        .select("id,conversation_id,role,content,model_used,mode,image_present,crisis_detected,created_at")
        .single();
      if (error) throw error;
      return mapMessage(data);
    },
    async listMemories(userId) {
      const { data, error } = await db
        .from("memories")
        .select("id,user_id,content,category,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapMemory);
    },
    async createMemory(input) {
      const { data, error } = await db
        .from("memories")
        .insert({ user_id: input.userId, content: input.content, category: input.category })
        .select("id,user_id,content,category,created_at,updated_at")
        .single();
      if (error) throw error;
      return mapMemory(data);
    },
    async updateMemory(userId, memoryId, input) {
      const { data, error } = await db
        .from("memories")
        .update({ content: input.content, category: input.category, updated_at: now() })
        .eq("id", memoryId)
        .eq("user_id", userId)
        .select("id,user_id,content,category,created_at,updated_at")
        .single();
      if (error) throw error;
      return mapMemory(data);
    },
    async deleteMemory(userId, memoryId) {
      const { error } = await db.from("memories").delete().eq("id", memoryId).eq("user_id", userId);
      if (error) throw error;
    },
    async getUsage(userId, plan) {
      return getUsage(userId, plan);
    },
    async incrementUsage(userId, delta) {
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("plan")
        .eq("id", userId)
        .single();
      if (profileError) throw profileError;
      const current = await getUsage(userId, profile.plan);
      const next = {
        user_id: userId,
        month: current.month,
        deep_messages_used: current.deepMessagesUsed + (delta.deep ?? 0)
      };
      const { data, error } = await db
        .from("usage_limits")
        .upsert(next, { onConflict: "user_id,month" })
        .select("month,deep_messages_used")
        .single();
      if (error) throw error;
      return withPlanLimits(profile.plan, {
        month: data.month,
        deepMessagesUsed: data.deep_messages_used
      });
    }
  };
}

function mapConversation(row: any): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    modelUsed: row.model_used,
    mode: row.mode,
    imagePresent: row.image_present,
    crisisDetected: row.crisis_detected,
    createdAt: row.created_at
  };
}

function mapMemory(row: any): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
