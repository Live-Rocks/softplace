import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react-native";
import {
  ArrowLeft,
  Bell,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  LogOut,
  RefreshCw,
  Sparkles,
  Trash2
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import type { AiProvider, AvaState, UsageState } from "@softplace/shared";
import { api } from "../api/client";
import { AvaSettings } from "../components/AvaSettings";
import { SoftButton } from "../components/SoftButton";
import { supabase } from "../integrations/supabase";
import type { PushRegistrationState } from "../integrations/notifications";
import { colors } from "../theme/theme";
import { MemoriesScreen } from "./MemoriesScreen";

type SettingsRoute = "root" | "memories" | "ava";

type Props = {
  accessToken: string;
  active: boolean;
  email: string;
  pushRegistration: PushRegistrationState;
  onRetryPushRegistration: () => Promise<void>;
  onConversationCleared: () => void;
};

export function SettingsScreen({
  accessToken,
  active,
  email,
  pushRegistration,
  onRetryPushRegistration,
  onConversationCleared
}: Props) {
  const [route, setRoute] = useState<SettingsRoute>("root");
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [models, setModels] = useState<{ deep: string; light: string } | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [avaState, setAvaState] = useState<AvaState | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [memoriesError, setMemoriesError] = useState(false);
  const [avaError, setAvaError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);

  const loadSummaries = useCallback(async () => {
    setRefreshing(true);

    const [usageResult, memoriesResult, avaResult] = await Promise.allSettled([
      api.usage(accessToken),
      api.memories(accessToken),
      api.ava(accessToken)
    ]);

    if (usageResult.status === "fulfilled") {
      setUsage(usageResult.value.usage);
      setProvider(usageResult.value.provider);
      setModels(usageResult.value.models);
      setUsageError(false);
    } else {
      setUsageError(true);
    }

    if (memoriesResult.status === "fulfilled") {
      setMemoryCount(memoriesResult.value.memories.length);
      setMemoriesError(false);
    } else {
      setMemoriesError(true);
    }

    if (avaResult.status === "fulfilled") {
      setAvaState(avaResult.value.state);
      setAvaError(false);
    } else {
      setAvaError(true);
    }

    setRefreshing(false);
  }, [accessToken]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  const returnToRoot = useCallback(() => {
    setRoute("root");
    void loadSummaries();
  }, [loadSummaries]);

  useEffect(() => {
    if (!active || route === "root") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      returnToRoot();
      return true;
    });

    return () => subscription.remove();
  }, [active, returnToRoot, route]);

  async function clearConversation() {
    await api.deleteConversation(accessToken);
    onConversationCleared();
    await loadSummaries();
  }

  async function logout() {
    await supabase?.auth.signOut();
  }

  if (route === "memories") {
    return (
      <View style={styles.page}>
        <SettingsSubpageHeader title="安放記憶" onBack={returnToRoot} />
        <MemoriesScreen accessToken={accessToken} showHeader={false} />
      </View>
    );
  }

  if (route === "ava") {
    return (
      <View style={styles.page}>
        <SettingsSubpageHeader title="Ava" onBack={returnToRoot} />
        <ScrollView style={styles.wrap} contentContainerStyle={styles.subpageContent}>
          <View style={styles.subpageIntro}>
            <Text style={styles.subpageLead}>Ava 是 AI 虛擬朋友，會依自己的生活節奏回覆，也可能主動傳訊息。</Text>
          </View>

          <SettingsSection title="通知">
            <View style={styles.detailBlock}>
              <View style={styles.detailHeader}>
                <View style={styles.detailTitle}>
                  <Bell size={20} color={colors.accent} />
                  <Text style={styles.rowTitle}>{pushRegistrationLabel(pushRegistration.status)}</Text>
                </View>
                <IconButton
                  accessibilityLabel="重新檢查 Ava 通知"
                  icon={RefreshCw}
                  loading={pushRegistration.status === "registering"}
                  onPress={() => void onRetryPushRegistration()}
                />
              </View>
              <Text style={styles.rowDescription}>{pushRegistrationDescription(pushRegistration.status)}</Text>
            </View>
          </SettingsSection>

          <AvaSettings
            accessToken={accessToken}
            showHeader={false}
            onChanged={() => void loadSummaries()}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>設定</Text>
        <Text style={styles.subtitle}>{email}</Text>
      </View>

      <SettingsSection
        title="帳號與用量"
        action={
          <IconButton
            accessibilityLabel="重新整理設定摘要"
            icon={RefreshCw}
            loading={refreshing}
            onPress={() => void loadSummaries()}
          />
        }
      >
        <View style={styles.accountDetails}>
          {usage ? (
            <>
              <DetailLine label="方案" value={planLabel(usage.plan)} />
              <DetailLine
                label="深度陪伴"
                value={`${usage.deepMessagesUsed}/${usage.deepMessagesLimit}`}
              />
            </>
          ) : (
            <Text style={styles.errorText}>
              {usageError ? "暫時無法載入用量，請重新整理。" : "正在載入用量…"}
            </Text>
          )}
        </View>
      </SettingsSection>

      <SettingsSection title="陪伴設定">
        <SettingsRow
          accessibilityLabel="開啟安放記憶設定"
          icon={Brain}
          title="安放記憶"
          description={
            memoriesError
              ? "暫時無法載入"
              : memoryCount === null
                ? "正在載入…"
                : memoryCount === 0
                  ? "目前沒有已確認記憶"
                  : `已保存 ${memoryCount} 則記憶`
          }
          showDivider
          onPress={() => setRoute("memories")}
        />
        <SettingsRow
          accessibilityLabel="開啟 Ava 設定"
          icon={Sparkles}
          title="Ava"
          description={
            avaError
              ? "暫時無法載入"
              : avaState
                ? `主動訊息：${proactiveLabel(avaState.preferences.proactiveLevel)} · 通知：${pushSummaryLabel(pushRegistration.status)}`
                : "正在載入…"
          }
          onPress={() => setRoute("ava")}
        />
      </SettingsSection>

      <SettingsSection title="安全說明">
        <Text style={styles.safetyText}>
          SoftPlace 不提供心理治療或診斷。如果你有立即傷害自己的可能，請立刻打 119 或 110；在台灣也可以撥打 1925 安心專線。
        </Text>
      </SettingsSection>

      <SettingsSection title="測試資訊">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={technicalOpen ? "收合測試資訊" : "展開測試資訊"}
          accessibilityState={{ expanded: technicalOpen }}
          onPress={() => setTechnicalOpen((value) => !value)}
          style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
        >
          <Text style={styles.rowTitle}>連線與模型</Text>
          {technicalOpen ? (
            <ChevronUp size={20} color={colors.muted} />
          ) : (
            <ChevronDown size={20} color={colors.muted} />
          )}
        </Pressable>
        {technicalOpen ? (
          <View style={styles.technicalDetails}>
            <DetailLine
              label="AI 來源"
              value={provider === null ? "尚未載入" : provider === "openai" ? "OpenAI API" : "本機測試回覆"}
            />
            <DetailLine label="輕量模型" value={models?.light ?? "尚未載入"} />
            <DetailLine label="深度模型" value={models?.deep ?? "尚未載入"} />
            <DetailLine label="推播狀態" value={pushRegistrationLabel(pushRegistration.status)} />
            {pushRegistration.status === "error" ? (
              <Text style={styles.technicalMessage}>{pushRegistration.message}</Text>
            ) : null}
          </View>
        ) : null}
      </SettingsSection>

      <View style={styles.footerActions}>
        <SoftButton
          label="清除安放聊天"
          icon={Trash2}
          tone="danger"
          onPress={() =>
            Alert.alert("清除聊天內容", "這會永久刪除整條安放聊天時間線。已確認的記憶會保留。", [
              { text: "取消", style: "cancel" },
              { text: "清除", style: "destructive", onPress: clearConversation }
            ])
          }
        />
        <SoftButton label="登出" icon={LogOut} tone="quiet" onPress={logout} />
      </View>
    </ScrollView>
  );
}

function SettingsSection({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function SettingsRow({
  accessibilityLabel,
  icon: Icon,
  title,
  description,
  showDivider = false,
  onPress
}: {
  accessibilityLabel: string;
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  showDivider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        showDivider && styles.settingsRowDivider,
        pressed && styles.pressed
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon size={21} color={colors.accent} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <ChevronRight size={20} color={colors.softText} />
    </Pressable>
  );
}

function SettingsSubpageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.subpageHeader}>
      <IconButton accessibilityLabel="返回設定" icon={ArrowLeft} onPress={onBack} />
      <Text style={styles.subpageTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function IconButton({
  accessibilityLabel,
  icon: Icon,
  loading = false,
  onPress
}: {
  accessibilityLabel: string;
  icon: ComponentType<LucideProps>;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, (pressed || loading) && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Icon size={20} color={colors.accent} />
      )}
    </Pressable>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function planLabel(plan: UsageState["plan"]) {
  return { free: "Free", plus: "Plus", pro: "Pro" }[plan];
}

function proactiveLabel(level: AvaState["preferences"]["proactiveLevel"]) {
  return { off: "關閉", low: "較少", normal: "一般" }[level];
}

function pushSummaryLabel(status: PushRegistrationState["status"]) {
  switch (status) {
    case "registered":
      return "已開啟";
    case "registering":
      return "檢查中";
    case "denied":
      return "未允許";
    case "error":
      return "暫時失敗";
    case "unsupported":
      return "不支援";
    default:
      return "尚未檢查";
  }
}

function pushRegistrationLabel(status: PushRegistrationState["status"]) {
  switch (status) {
    case "registered":
      return "通知已開啟";
    case "registering":
      return "正在檢查通知";
    case "denied":
      return "通知權限未允許";
    case "unsupported":
      return "此平台不支援通知";
    case "error":
      return "通知暫時無法使用";
    default:
      return "通知尚未檢查";
  }
}

function pushRegistrationDescription(status: PushRegistrationState["status"]) {
  switch (status) {
    case "registered":
      return "Ava 回覆或主動傳訊息時，可以在這台裝置收到通知。";
    case "registering":
      return "正在確認這台裝置的通知權限。";
    case "denied":
      return "可到 Android 系統設定中允許 SoftPlace 通知。";
    case "unsupported":
      return "目前使用的環境無法接收 Ava 裝置通知。";
    case "error":
      return "可以稍後重新檢查，不影響在 App 內閱讀 Ava 訊息。";
    default:
      return "重新檢查後會顯示這台裝置的通知狀態。";
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg
  },
  wrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 28
  },
  header: {
    gap: 6
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
    gap: 8
  },
  sectionHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  accountDetails: {
    paddingVertical: 10,
    gap: 4
  },
  detailLine: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16
  },
  detailLabel: {
    color: colors.muted
  },
  detailValue: {
    flexShrink: 1,
    color: colors.ink,
    fontWeight: "700",
    textAlign: "right"
  },
  settingsRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10
  },
  settingsRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  rowIcon: {
    width: 32,
    alignItems: "center"
  },
  rowCopy: {
    flex: 1,
    gap: 3
  },
  rowTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700"
  },
  rowDescription: {
    color: colors.muted,
    lineHeight: 20
  },
  safetyText: {
    color: colors.muted,
    lineHeight: 22,
    paddingVertical: 12
  },
  disclosure: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10
  },
  technicalDetails: {
    gap: 2,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  technicalMessage: {
    color: colors.warning,
    lineHeight: 20,
    paddingTop: 4
  },
  errorText: {
    color: colors.warning,
    lineHeight: 22,
    paddingVertical: 8
  },
  footerActions: {
    gap: 10
  },
  subpageHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.bg
  },
  subpageTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  headerSpacer: {
    width: 44,
    height: 44
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  pressed: {
    opacity: 0.62
  },
  subpageContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 24
  },
  subpageIntro: {
    paddingBottom: 2
  },
  subpageLead: {
    color: colors.muted,
    lineHeight: 22
  },
  detailBlock: {
    paddingVertical: 12,
    gap: 5
  },
  detailHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  detailTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  }
});
