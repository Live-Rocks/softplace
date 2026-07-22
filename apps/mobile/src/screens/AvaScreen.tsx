import { Send } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { AvaMessage, AvaState } from "@softplace/shared";
import { api } from "../api/client";
import { SoftButton } from "../components/SoftButton";
import { colors } from "../theme/theme";

type Props = {
  accessToken: string;
  active: boolean;
  onUnreadCountChange: (count: number) => void;
};

export function AvaScreen({ accessToken, active, onUnreadCountChange }: Props) {
  const [messages, setMessages] = useState<AvaMessage[]>([]);
  const [state, setState] = useState<AvaState | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const listRef = useRef<FlatList<AvaMessage>>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.avaMessages(accessToken);
      setMessages(response.messages);
      setNotice("");
      if (active && response.state.unreadCount) {
        await api.markAvaRead(accessToken);
        setState({ ...response.state, unreadCount: 0 });
        onUnreadCountChange(0);
      } else {
        setState(response.state);
        onUnreadCountChange(response.state.unreadCount);
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: !quiet }), 40);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暫時無法載入 Ava。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [accessToken, active, onUnreadCountChange]);

  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(() => load(true), 12_000);
    return () => clearInterval(timer);
  }, [active, load]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setNotice("");
    setText("");
    Keyboard.dismiss();
    const local: AvaMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      proactive: false,
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString()
    };
    setMessages((current) => [...current, local]);
    try {
      const response = await api.sendAvaMessage(content, accessToken);
      setMessages((current) => [
        ...current.filter((message) => message.id !== local.id),
        response.message,
        ...(response.assistantMessage ? [response.assistantMessage] : [])
      ]);
      setState(response.state);
      onUnreadCountChange(0);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== local.id));
      setText(content);
      setNotice(error instanceof Error ? error.message : "這次沒有送出去，請再試一次。");
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior="padding">
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>A</Text></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Ava</Text>
          <Text style={styles.status}>{state?.statusLabel ?? "載入中"}</Text>
        </View>
        <Text style={styles.usage}>{state ? `${state.dailyUsed}/${state.dailyLimit}` : ""}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.accent} style={styles.empty} /> : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>你們還沒說過話</Text>
              <Text style={styles.emptyText}>Ava 有自己的生活節奏。你可以先從今天的一件小事開始。</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.avaBubble]}>
            {item.proactive ? <Text style={styles.proactive}>Ava 主動傳來</Text> : null}
            <Text style={[styles.messageText, item.role === "user" && styles.userText]}>{item.content}</Text>
          </View>
        )}
      />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.composer}>
        <TextInput value={text} onChangeText={setText} style={styles.input} multiline maxLength={4000} />
        <SoftButton label="送出" icon={Send} onPress={send} loading={sending} disabled={!text.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#D8B7B0" },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "800" },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "800" },
  status: { color: colors.muted, fontSize: 12 },
  usage: { color: colors.softText, fontSize: 12 },
  messages: { flexGrow: 1, padding: 16, gap: 12 },
  empty: { alignItems: "center", justifyContent: "center", padding: 40, gap: 8 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  emptyText: { color: colors.muted, lineHeight: 21, textAlign: "center" },
  bubble: { maxWidth: "86%", borderRadius: 8, padding: 13, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.accent, borderColor: colors.accent },
  avaBubble: { alignSelf: "flex-start", backgroundColor: colors.surface, borderColor: colors.line },
  messageText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  proactive: { color: colors.rose, fontSize: 11, fontWeight: "700", marginBottom: 5 },
  notice: { color: colors.warning, paddingHorizontal: 16, paddingVertical: 7 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 48, maxHeight: 118, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, color: colors.ink, backgroundColor: colors.bg }
});
