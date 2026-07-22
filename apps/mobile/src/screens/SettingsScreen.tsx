import { LogOut, RefreshCw, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AiProvider, UsageState } from "@softplace/shared";
import { api } from "../api/client";
import { SoftButton } from "../components/SoftButton";
import { AvaSettings } from "../components/AvaSettings";
import { MemoriesScreen } from "./MemoriesScreen";
import { supabase } from "../integrations/supabase";
import { colors } from "../theme/theme";

type Props = {
  accessToken: string;
  email: string;
  onConversationCleared: () => void;
};

export function SettingsScreen({ accessToken, email, onConversationCleared }: Props) {
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [models, setModels] = useState<{ deep: string; light: string } | null>(null);

  async function load() {
    const usageResponse = await api.usage(accessToken);
    setUsage(usageResponse.usage);
    setProvider(usageResponse.provider);
    setModels(usageResponse.models);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [accessToken]);

  async function clearConversation() {
    await api.deleteConversation(accessToken);
    onConversationCleared();
    await load();
  }

  async function logout() {
    await supabase?.auth.signOut();
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>設定</Text>
        <Text style={styles.subtitle}>{email}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>本月用量</Text>
          <SoftButton label="更新" icon={RefreshCw} tone="quiet" onPress={load} />
        </View>
        {usage ? (
          <View style={styles.usageGrid}>
            <Text style={styles.usageItem}>方案：{usage.plan}</Text>
            <Text style={styles.usageItem}>
              深度陪伴：{usage.deepMessagesUsed}/{usage.deepMessagesLimit}
            </Text>
          </View>
        ) : (
          <Text style={styles.muted}>尚未載入用量。</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 連線</Text>
        <View style={styles.usageGrid}>
          <Text style={styles.usageItem}>來源：{provider === "openai" ? "OpenAI API" : "本機測試回覆"}</Text>
          <Text style={styles.muted}>輕量：{models?.light ?? "尚未載入"}</Text>
          <Text style={styles.muted}>深度：{models?.deep ?? "尚未載入"}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>聊天資料</Text>
        <Text style={styles.muted}>清除後無法復原。已確認的記憶會保留，仍可在下方個別刪除。</Text>
        <SoftButton
          label="清除所有聊天內容"
          icon={Trash2}
          tone="danger"
          onPress={() =>
            Alert.alert("清除聊天內容", "這會永久刪除整條聊天時間線。", [
              { text: "取消", style: "cancel" },
              { text: "清除", style: "destructive", onPress: clearConversation }
            ])
          }
        />
      </View>

      <View style={styles.section}>
        <MemoriesScreen accessToken={accessToken} embedded />
      </View>

      <View style={styles.section}>
        <AvaSettings accessToken={accessToken} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>安全邊界</Text>
        <Text style={styles.muted}>
          SoftPlace 不提供心理治療或診斷。如果你有立即傷害自己的可能，請立刻打 119 或 110；在台灣也可以撥打 1925 安心專線。
        </Text>
      </View>

      <SoftButton label="登出測試帳號" icon={LogOut} tone="quiet" onPress={logout} />
    </ScrollView>
  );
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
  section: {
    gap: 12
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  usageGrid: {
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14
  },
  usageItem: {
    color: colors.ink,
    fontWeight: "700"
  },
  muted: {
    color: colors.muted,
    lineHeight: 22
  }
});
