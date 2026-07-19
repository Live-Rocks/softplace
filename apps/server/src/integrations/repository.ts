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

export function createMemoryRepository(initialProfiles: AuthUser[] = []): Repository {
  const profiles = new Map<string, AuthUser>(initialProfiles.map((profile) => [profile.id, profile]));
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const memories = new Map<string, Memory>();
  const usages = new Map<string, UsageState>();
  const rateLimitWindows = new Map<string, number>();
  const reservations = new Map<
    string,
    {
      userId: string;
      month: string;
      status: "active" | "completed" | "released";
      expiresAt: number;
    }
  >();

  return {
    async getOrCreateProfile(user) {
      const existing = profiles.get(user.id);
      if (existing) return existing;
      const profile: AuthUser = { id: user.id, email: user.email, plan: "free" };
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
    async consumeChatRateLimit(userId, limits) {
      const timestamp = Date.now();
      const minuteStart = Math.floor(timestamp / 60_000) * 60_000;
      const hourStart = Math.floor(timestamp / 3_600_000) * 3_600_000;
      const minuteKey = `${userId}:minute:${minuteStart}`;
      const hourKey = `${userId}:hour:${hourStart}`;
      const minuteCount = rateLimitWindows.get(minuteKey) ?? 0;
      const hourCount = rateLimitWindows.get(hourKey) ?? 0;

      if (hourCount >= limits.perHour) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((hourStart + 3_600_000 - timestamp) / 1000)) };
      }
      if (minuteCount >= limits.perMinute) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((minuteStart + 60_000 - timestamp) / 1000)) };
      }

      rateLimitWindows.set(minuteKey, minuteCount + 1);
      rateLimitWindows.set(hourKey, hourCount + 1);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async reserveDeepUsage(userId, plan, ttlSeconds) {
      const key = `${userId}:${currentUsageMonth()}`;
      const usage = usages.get(key) ?? withPlanLimits(plan);
      usages.set(key, usage);

      const timestamp = Date.now();
      for (const reservation of reservations.values()) {
        if (reservation.status === "active" && reservation.expiresAt <= timestamp) {
          reservation.status = "released";
        }
      }
      const activeCount = [...reservations.values()].filter(
        (reservation) =>
          reservation.userId === userId &&
          reservation.month === usage.month &&
          reservation.status === "active" &&
          reservation.expiresAt > timestamp
      ).length;

      if (usage.deepMessagesUsed + activeCount >= usage.deepMessagesLimit) {
        return { reservationId: null, reserved: false, usage };
      }

      const reservationId = id();
      reservations.set(reservationId, {
        userId,
        month: usage.month,
        status: "active",
        expiresAt: timestamp + ttlSeconds * 1000
      });
      return { reservationId, reserved: true, usage };
    },
    async releaseDeepUsage(userId, reservationId) {
      const reservation = reservations.get(reservationId);
      if (!reservation || reservation.userId !== userId || reservation.status !== "active") return false;
      reservation.status = "released";
      return true;
    },
    async completeChatSuccess(userId, plan, input) {
      const conversation = conversations.get(input.conversationId);
      if (!conversation || conversation.userId !== userId) throw new Error("conversation_not_found");

      let usage = usages.get(`${userId}:${currentUsageMonth()}`) ?? withPlanLimits(plan);
      let reservation:
        | { userId: string; month: string; status: "active" | "completed" | "released"; expiresAt: number }
        | undefined;

      if (input.mode === "deep") {
        if (!input.reservationId) throw new Error("deep_reservation_required");
        reservation = reservations.get(input.reservationId);
        if (!reservation || reservation.userId !== userId) throw new Error("reservation_not_found");
        if (reservation.status !== "active") throw new Error("reservation_not_active");
        if (reservation.expiresAt <= Date.now()) throw new Error("reservation_expired");
        const usageKey = `${userId}:${reservation.month}`;
        usage = usages.get(usageKey) ?? withPlanLimits(plan, { month: reservation.month });
      } else if (input.reservationId) {
        throw new Error("light_mode_cannot_use_reservation");
      }

      const userMessage: Message = {
        id: id(),
        conversationId: input.conversationId,
        role: "user",
        content: input.userContent,
        modelUsed: null,
        mode: null,
        imagePresent: input.userImagePresent,
        crisisDetected: false,
        createdAt: now()
      };
      const assistantMessage: Message = {
        id: id(),
        conversationId: input.conversationId,
        role: "assistant",
        content: input.assistantContent,
        modelUsed: input.modelUsed,
        mode: input.mode,
        imagePresent: false,
        crisisDetected: false,
        createdAt: now()
      };

      if (reservation) {
        usage = { ...usage, deepMessagesUsed: usage.deepMessagesUsed + 1 };
        usages.set(`${userId}:${reservation.month}`, usage);
        reservation.status = "completed";
      }
      messages.set(userMessage.id, userMessage);
      messages.set(assistantMessage.id, assistantMessage);
      conversation.updatedAt = now();

      return { assistantMessage, usage };
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
        .insert({ id: user.id, email: user.email, plan: "free" })
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
    async consumeChatRateLimit(userId, limits) {
      const { data, error } = await db
        .rpc("consume_chat_rate_limit", {
          p_user_id: userId,
          p_minute_limit: limits.perMinute,
          p_hour_limit: limits.perHour
        })
        .single();
      if (error) throw error;
      const row = data as any;
      return {
        allowed: Boolean(row.allowed),
        retryAfterSeconds: Number(row.retry_after_seconds ?? 0)
      };
    },
    async reserveDeepUsage(userId, plan, ttlSeconds) {
      const { data, error } = await db
        .rpc("reserve_deep_usage", {
          p_user_id: userId,
          p_ttl_seconds: ttlSeconds
        })
        .single();
      if (error) throw error;
      const row = data as any;
      return {
        reservationId: row.reservation_id,
        reserved: Boolean(row.reserved),
        usage: withPlanLimits(plan, {
          month: row.usage_month,
          deepMessagesUsed: row.deep_messages_used
        })
      };
    },
    async releaseDeepUsage(userId, reservationId) {
      const { data, error } = await db.rpc("release_deep_usage", {
        p_user_id: userId,
        p_reservation_id: reservationId
      });
      if (error) throw error;
      return Boolean(data);
    },
    async completeChatSuccess(userId, plan, input) {
      const { data, error } = await db
        .rpc("complete_chat_success", {
          p_user_id: userId,
          p_conversation_id: input.conversationId,
          p_user_content: input.userContent,
          p_user_image_present: input.userImagePresent,
          p_assistant_content: input.assistantContent,
          p_model_used: input.modelUsed,
          p_mode: input.mode,
          p_reservation_id: input.reservationId ?? null
        })
        .single();
      if (error) throw error;
      const row = data as any;
      return {
        assistantMessage: {
          id: row.assistant_id,
          conversationId: row.assistant_conversation_id,
          role: row.assistant_role,
          content: row.assistant_content,
          modelUsed: row.assistant_model_used,
          mode: row.assistant_mode,
          imagePresent: row.assistant_image_present,
          crisisDetected: row.assistant_crisis_detected,
          createdAt: row.assistant_created_at
        },
        usage: withPlanLimits(plan, {
          month: row.usage_month,
          deepMessagesUsed: row.deep_messages_used
        })
      };
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
