import type { AuthError } from "@supabase/supabase-js";
import { HeartHandshake } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SoftButton } from "../components/SoftButton";
import { isSupabaseConfigured, supabase } from "../integrations/supabase";
import { colors } from "../theme/theme";

type AuthStep = "email" | "verify";
type FeedbackTone = "info" | "error";
type AuthAction = "send" | "verify" | "resend";

const RESEND_COOLDOWN_SECONDS = 60;

function getAuthErrorMessage(error: AuthError, action: AuthAction) {
  switch (error.code) {
    case "invalid_credentials":
    case "otp_expired":
      return action === "verify"
        ? "驗證碼不正確或已失效，請確認後再試一次。"
        : "這次無法寄出驗證碼，請稍後再試。";
    case "over_email_send_rate_limit":
      return "驗證信寄送得太頻繁了，請稍等一會兒再試。";
    case "over_request_rate_limit":
      return "操作太頻繁了，請稍等一會兒再試。";
    case "email_address_invalid":
      return "請輸入有效的 Email 地址。";
    case "signup_disabled":
      return "目前暫時無法建立新帳號。";
    case "email_provider_disabled":
    case "otp_disabled":
      return "目前暫時無法使用 Email 驗證碼登入。";
    default:
      return action === "verify"
        ? "這次沒有完成驗證，請稍後再試一次。"
        : "這次沒有成功寄出驗證碼，請稍後再試。";
  }
}

export function LoginScreen() {
  const authRequestInFlight = useRef(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [step, setStep] = useState<AuthStep>("email");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<FeedbackTone>("info");

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  function showMessage(text: string, tone: FeedbackTone = "info") {
    setMessage(text);
    setMessageTone(tone);
  }

  function showVerification(nextEmail: string) {
    setVerificationEmail(nextEmail);
    setOtp("");
    setStep("verify");
    setResendSeconds(RESEND_COOLDOWN_SECONDS);
    showMessage("驗證碼已寄出，請到信箱查看。");
  }

  async function sendCode() {
    if (!supabase || !email.trim() || authRequestInFlight.current) return;
    const normalizedEmail = email.trim().toLowerCase();
    authRequestInFlight.current = true;
    setLoading(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true }
      });
      if (result.error) {
        showMessage(getAuthErrorMessage(result.error, "send"), "error");
        return;
      }
      showVerification(normalizedEmail);
    } catch {
      showMessage("目前無法連線，請確認網路後再試一次。", "error");
    } finally {
      authRequestInFlight.current = false;
      setLoading(false);
    }
  }

  async function verifyCode() {
    if (!supabase || otp.length !== 6 || !verificationEmail || authRequestInFlight.current) return;
    authRequestInFlight.current = true;
    setLoading(true);
    setMessage("");
    try {
      const result = await supabase.auth.verifyOtp({
        email: verificationEmail,
        token: otp,
        type: "email"
      });
      if (result.error) {
        showMessage(getAuthErrorMessage(result.error, "verify"), "error");
        return;
      }
      if (!result.data.session) {
        showMessage("驗證完成，但登入狀態尚未建立，請重新取得驗證碼。", "error");
      }
    } catch {
      showMessage("目前無法連線，請確認網路後再試一次。", "error");
    } finally {
      authRequestInFlight.current = false;
      setLoading(false);
    }
  }

  async function resendCode() {
    if (!supabase || !verificationEmail || resendSeconds > 0 || authRequestInFlight.current) return;
    authRequestInFlight.current = true;
    setResending(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithOtp({
        email: verificationEmail,
        options: { shouldCreateUser: false }
      });
      if (result.error) {
        showMessage(getAuthErrorMessage(result.error, "resend"), "error");
        return;
      }
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      showMessage("新的驗證碼已寄出，請到信箱查看。");
    } catch {
      showMessage("目前無法連線，請確認網路後再試一次。", "error");
    } finally {
      authRequestInFlight.current = false;
      setResending(false);
    }
  }

  function changeEmail() {
    setStep("email");
    setEmail(verificationEmail);
    setOtp("");
    setVerificationEmail("");
    setResendSeconds(0);
    setMessage("");
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardWrap}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <HeartHandshake size={34} color={colors.accent} />
          <Text style={styles.title}>SoftPlace</Text>
          <Text style={styles.subtitle}>給暫時無處安放的情緒，一個可以先靠一下的地方。</Text>
        </View>

        <View style={styles.panel}>
          {!isSupabaseConfigured ? (
            <Text style={styles.error}>尚未設定 Supabase。請先填寫 apps/mobile/.env。</Text>
          ) : null}

          {step === "email" ? (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.softText}
                style={styles.input}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="send"
                textContentType="emailAddress"
                onSubmitEditing={sendCode}
              />
              <Text style={styles.note}>
                目前為小規模測試版。SoftPlace 不提供心理治療或診斷；如果有立即危險，請聯絡真人與當地緊急資源。
              </Text>
              <SoftButton
                label="寄送登入驗證碼"
                icon={HeartHandshake}
                onPress={sendCode}
                loading={loading}
                disabled={!isSupabaseConfigured || !email.trim()}
              />
            </>
          ) : (
            <>
              <Text style={styles.verifyTitle}>確認你的 Email</Text>
              <Text style={styles.note}>驗證碼已寄到</Text>
              <Text style={styles.verificationEmail}>{verificationEmail}</Text>
              <Text style={styles.label}>六位數驗證碼</Text>
              <TextInput
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.softText}
                style={[styles.input, styles.otpInput]}
                autoComplete="one-time-code"
                autoFocus
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
              />
              <SoftButton
                label="確認並進入 SoftPlace"
                icon={HeartHandshake}
                onPress={verifyCode}
                loading={loading}
                disabled={otp.length !== 6}
              />
              <View style={styles.secondaryActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={resendSeconds > 0 || loading || resending}
                  hitSlop={8}
                  onPress={resendCode}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text
                    style={[
                      styles.textAction,
                      (resendSeconds > 0 || loading || resending) && styles.textActionDisabled
                    ]}
                  >
                    {resending
                      ? "寄送中..."
                      : resendSeconds > 0
                        ? `${resendSeconds} 秒後可重新寄送`
                        : "重新寄送驗證碼"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={loading || resending}
                  hitSlop={8}
                  onPress={changeEmail}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={[styles.textAction, (loading || resending) && styles.textActionDisabled]}>
                    更換 Email
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {message ? (
            <Text style={messageTone === "error" ? styles.error : styles.message}>{message}</Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  wrap: {
    flexGrow: 1,
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
  otpInput: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center"
  },
  verifyTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "800"
  },
  verificationEmail: {
    color: colors.accentDark,
    fontSize: 16,
    fontWeight: "700"
  },
  secondaryActions: {
    minHeight: 36,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16
  },
  textAction: {
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22
  },
  textActionDisabled: {
    color: colors.softText
  },
  pressed: {
    opacity: 0.65
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
