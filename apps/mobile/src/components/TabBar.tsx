import { Heart, Home, MessageCircle, Settings } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/theme";
import type { AppTab } from "../types";

const tabs = [
  { key: "home", label: "入口", icon: Home },
  { key: "chat", label: "聊天", icon: MessageCircle },
  { key: "ava", label: "Ava", icon: Heart },
  { key: "settings", label: "設定", icon: Settings }
] as const;

type Props = {
  active: AppTab;
  avaUnreadCount: number;
  onChange: (tab: AppTab) => void;
};

export function TabBar({ active, avaUnreadCount, onChange }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const hasUnread = tab.key === "ava" && avaUnreadCount > 0;
        return (
          <Pressable
            accessibilityLabel={`${tab.label}${hasUnread ? "，有未讀訊息" : ""}`}
            accessibilityRole="button"
            key={tab.key}
            style={styles.item}
            onPress={() => onChange(tab.key)}
          >
            <View style={styles.iconWrap}>
              <Icon size={20} color={isActive ? colors.accentDark : colors.softText} />
              {hasUnread ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={[styles.label, isActive && styles.active]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: 8
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 4
  },
  iconWrap: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    position: "relative",
    width: 20
  },
  unreadDot: {
    backgroundColor: colors.rose,
    borderColor: colors.surface,
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: -4,
    top: -4,
    width: 10
  },
  label: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "600"
  },
  active: {
    color: colors.accentDark
  }
});
