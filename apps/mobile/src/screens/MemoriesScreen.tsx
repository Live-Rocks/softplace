import { Pencil, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Memory, MemoryCategory } from "@softplace/shared";
import { api } from "../api/client";
import { SoftButton } from "../components/SoftButton";
import { colors } from "../theme/theme";

type Props = {
  accessToken: string;
  embedded?: boolean;
};

const memoryMaxLength = 300;

export function MemoriesScreen({ accessToken, embedded = false }: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const response = await api.memories(accessToken);
    setMemories(response.memories);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [accessToken]);

  async function saveMemory() {
    const trimmed = content.trim();
    if (!trimmed) {
      Alert.alert("還沒有內容", "先寫下一點你想讓我記住的事。");
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await api.updateMemory(editingId, { content: trimmed, category }, accessToken);
      } else {
        await api.createMemory({ content: trimmed, category }, accessToken);
      }
      setContent("");
      setEditingId(null);
      await load();
    } catch (error) {
      Alert.alert("無法儲存", error instanceof Error ? error.message : "請再試一次");
    } finally {
      setLoading(false);
    }
  }

  async function editMemory(memory: Memory) {
    setEditingId(memory.id);
    setContent(memory.content);
    setCategory(memory.category);
  }

  async function deleteMemory(memory: Memory) {
    await api.deleteMemory(memory.id, accessToken);
    await load();
  }

  const contentView = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>我記得的事</Text>
        <Text style={styles.subtitle}>只保存你確認過的陪伴偏好與重要情緒脈絡。每一條都可以刪除。</Text>
      </View>

      <View style={styles.addBox}>
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="例如：我焦慮時希望回覆短一點，或我喜歡你像熟悉朋友一樣自然接話。"
          placeholderTextColor={colors.softText}
          style={styles.input}
          multiline
          maxLength={memoryMaxLength}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>{content.length}/{memoryMaxLength}</Text>
        <View style={styles.segment}>
          <SoftButton
            label="偏好"
            tone={category === "preference" ? "primary" : "quiet"}
            onPress={() => setCategory("preference")}
          />
          <SoftButton
            label="情緒脈絡"
            tone={category === "emotional_context" ? "primary" : "quiet"}
            onPress={() => setCategory("emotional_context")}
          />
        </View>
        <SoftButton label={editingId ? "儲存修改" : "新增記憶"} icon={Plus} onPress={saveMemory} loading={loading} />
      </View>

      <View style={styles.list}>
        {memories.map((memory) => (
          <View key={memory.id} style={styles.memory}>
            <Text style={styles.badge}>{memory.category === "preference" ? "陪伴偏好" : "情緒脈絡"}</Text>
            <Text style={styles.memoryText}>{memory.content}</Text>
            <View style={styles.actions}>
              <SoftButton label="修改" icon={Pencil} tone="quiet" onPress={() => editMemory(memory)} />
              <SoftButton label="刪除" icon={Trash2} tone="danger" onPress={() => deleteMemory(memory)} />
            </View>
          </View>
        ))}
        {!memories.length ? <Text style={styles.empty}>目前還沒有記憶。聊天時你確認後，我才會記住。</Text> : null}
      </View>
    </>
  );

  if (embedded) return <View style={styles.embedded}>{contentView}</View>;
  return <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>{contentView}</ScrollView>;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  content: {
    padding: 20,
    gap: 20
  },
  embedded: {
    gap: 20
  },
  header: {
    gap: 8
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.muted,
    lineHeight: 22
  },
  addBox: {
    gap: 12
  },
  input: {
    minHeight: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    lineHeight: 22,
    color: colors.ink
  },
  counter: {
    alignSelf: "flex-end",
    color: colors.softText,
    fontSize: 12
  },
  segment: {
    flexDirection: "row",
    gap: 8
  },
  list: {
    gap: 12
  },
  memory: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 10
  },
  badge: {
    color: colors.accentDark,
    fontWeight: "800"
  },
  memoryText: {
    color: colors.ink,
    lineHeight: 22
  },
  actions: {
    flexDirection: "row",
    gap: 8
  },
  empty: {
    color: colors.muted,
    lineHeight: 22
  }
});
