import type { ComponentType } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { LucideProps } from "lucide-react-native";
import { colors } from "../theme/theme";

type Props = {
  label: string;
  onPress: () => void;
  icon?: ComponentType<LucideProps>;
  tone?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  loading?: boolean;
};

export function SoftButton({ label, onPress, icon: Icon, tone = "primary", disabled, loading }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === "primary" && styles.primary,
        tone === "quiet" && styles.quiet,
        tone === "danger" && styles.danger,
        (pressed || disabled || loading) && styles.pressed
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === "quiet" ? colors.accent : "#fff"} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={18} color={tone === "quiet" ? colors.accent : "#fff"} /> : null}
          <Text style={[styles.label, tone === "quiet" && styles.quietLabel]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  quiet: {
    backgroundColor: colors.surface,
    borderColor: colors.line
  },
  danger: {
    backgroundColor: colors.rose,
    borderColor: colors.rose
  },
  pressed: {
    opacity: 0.72
  },
  label: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15
  },
  quietLabel: {
    color: colors.accent
  }
});

