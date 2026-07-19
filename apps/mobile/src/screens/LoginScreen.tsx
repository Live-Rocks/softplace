import { HeartHandshake } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SoftButton } from "../components/SoftButton";
import { isSupabaseConfigured, supabase } from "../integrations/supabase";
import { colors } from "../theme/theme";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!supabase || !email.trim() || password.length < 6 || !accepted) return;
    setLoading(true);
    setMessage("");
    try {
      const credentials = { email: email.trim(), password };
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp(credentials);
      if (result.error) {
        setMessage(result.error.message);
        return;
      }
      if (mode === "signup" && !result.data.session) {
        setMessage("註冊完成。請先到信箱確認 Email，再回來登入。");
      }
    } catch {
      setMessage("目前無法連線，請確認網路後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
      <View style={styles.header}>
        <HeartHandshake size={34} color={colors.accent} />
        <Text style={styles.title}>SoftPlace</Text>
        <Text style={styles.subtitle}>給暫時無處安放的情緒，一個可以先靠一下的地方。</Text>
      </View>

      <View style={styles.panel}>
        {!isSupabaseConfigured ? (
          <Text style={styles.error}>尚未設定 Supabase。請先填寫 apps/mobile/.env。</Text>
        ) : null}
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.softText}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>密碼</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="至少 6 個字元"
          placeholderTextColor={colors.softText}
          style={styles.input}
          secureTextEntry
        />
        <Text style={styles.note}>
          私密成人測試版。SoftPlace 不提供心理治療或診斷；如果有立即危險，請聯絡真人與當地緊急資源。
        </Text>
        <SoftButton
          label={
            !accepted
              ? "我已滿 18 歲"
              : mode === "login"
                ? "登入 SoftPlace"
                : "建立帳號"
          }
          icon={HeartHandshake}
          onPress={accepted ? submit : () => setAccepted(true)}
          loading={loading}
          disabled={!isSupabaseConfigured || (accepted && (!email.trim() || password.length < 6))}
        />
        <SoftButton
          label={mode === "login" ? "第一次使用？建立帳號" : "已經有帳號？回到登入"}
          tone="quiet"
          onPress={() => {
            setMode((current) => (current === "login" ? "signup" : "login"));
            setMessage("");
          }}
        />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: 24
  },
  header: {
    gap: 10,
    marginBottom: 28
  },
  title: {
    color: colors.ink,
    fontSize: 36,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 17,
    lineHeight: 25
  },
  panel: {
    gap: 14
  },
  label: {
    color: colors.ink,
    fontWeight: "700"
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 16
  },
  note: {
    color: colors.muted,
    lineHeight: 21
  },
  message: {
    color: colors.accentDark,
    lineHeight: 21
  },
  error: {
    color: colors.warning,
    lineHeight: 21
  }
});
