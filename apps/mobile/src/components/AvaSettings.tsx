import { Pencil, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import type { AvaMemory, AvaProactiveLevel, AvaState } from "@softplace/shared";
import { api } from "../api/client";
import { colors } from "../theme/theme";
import { SoftButton } from "./SoftButton";

export function AvaSettings({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<AvaState | null>(null);
  const [memories, setMemories] = useState<AvaMemory[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  async function load() {
    const [ava, memoryResponse] = await Promise.all([api.ava(accessToken), api.avaMemories(accessToken)]);
    setState(ava.state);
    setMemories(memoryResponse.memories);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [accessToken]);

  async function setLevel(level: AvaProactiveLevel) {
    const response = await api.updateAvaPreferences({ proactiveLevel: level }, accessToken);
    setState(response.state);
  }

  async function saveMemory() {
    if (!editingId || !editingText.trim()) return;
    await api.updateAvaMemory(editingId, editingText.trim(), accessToken);
    setEditingId(null);
    setEditingText("");
    await load();
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Ava</Text>
        <Text style={styles.muted}>Ava 是 AI 虛擬朋友。她會用自己的生活節奏回覆，也可能主動傳訊息。</Text>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>主動訊息</Text>
        <View style={styles.segment}>
          {(["off", "low", "normal"] as const).map((level) => (
            <SoftButton
              key={level}
              label={{ off: "關閉", low: "較少", normal: "一般" }[level]}
              tone={state?.preferences.proactiveLevel === level ? "primary" : "quiet"}
              onPress={() => setLevel(level)}
            />
          ))}
        </View>
        <Text style={styles.muted}>Ava 的休息時間：00:00–08:00</Text>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Ava 記得的事</Text>
        {!memories.length ? <Text style={styles.muted}>目前還沒有。Ava 只會保存較穩定、低敏感的背景。</Text> : null}
        {memories.map((memory) => (
          <View key={memory.id} style={styles.memory}>
            {editingId === memory.id ? (
              <>
                <TextInput value={editingText} onChangeText={setEditingText} style={styles.input} multiline maxLength={300} />
                <SoftButton label="儲存" onPress={saveMemory} />
              </>
            ) : (
              <>
                <Text style={styles.memoryText}>{memory.content}</Text>
                <View style={styles.actions}>
                  <SoftButton label="修改" icon={Pencil} tone="quiet" onPress={() => { setEditingId(memory.id); setEditingText(memory.content); }} />
                  <SoftButton label="刪除" icon={Trash2} tone="danger" onPress={async () => { await api.deleteAvaMemory(memory.id, accessToken); await load(); }} />
                </View>
              </>
            )}
          </View>
        ))}
      </View>

      <SoftButton
        label="清除與 Ava 的關係與對話"
        icon={Trash2}
        tone="danger"
        onPress={() => Alert.alert("清除 Ava 資料", "這會永久刪除你和 Ava 的訊息、關係進度與記憶。", [
          { text: "取消", style: "cancel" },
          { text: "清除", style: "destructive", onPress: async () => { await api.deleteAvaRelationship(accessToken); await load(); } }
        ])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  header: { gap: 7 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  group: { gap: 10 },
  label: { color: colors.ink, fontWeight: "800" },
  muted: { color: colors.muted, lineHeight: 21 },
  segment: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  memory: { gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
  memoryText: { color: colors.ink, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 8 },
  input: { minHeight: 72, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, color: colors.ink, backgroundColor: colors.surface }
});
