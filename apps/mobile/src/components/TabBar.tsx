import { Home, MessageCircle, Settings, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/theme";
import type { AppTab } from "../types";

const tabs = [
  { key: "home", label: "入口", icon: Home },
  { key: "chat", label: "聊天", icon: MessageCircle },
  { key: "memories", label: "記憶", icon: Sparkles },
  { key: "settings", label: "設定", icon: Settings }
] as const;

type Props = {
  active: AppTab;
  onChange: (tab: AppTab) => void;
};

export function TabBar({ active, onChange }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <Pressable key={tab.key} style={styles.item} onPress={() => onChange(tab.key)}>
            <Icon size={20} color={isActive ? colors.accentDark : colors.softText} />
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
  label: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "600"
  },
  active: {
    color: colors.accentDark
  }
});
