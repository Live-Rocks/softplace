import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Keyboard, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { api } from "./api/client";
import { TabBar } from "./components/TabBar";
import { ChatScreen } from "./screens/ChatScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { AvaScreen } from "./screens/AvaScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { supabase } from "./integrations/supabase";
import { colors } from "./theme/theme";
import type { AppTab } from "./types";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<AppTab>("home");
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [chatResetVersion, setChatResetVersion] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [avaUnreadCount, setAvaUnreadCount] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setAuthReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const accessToken = session?.access_token;

    if (!accessToken) {
      setAvaUnreadCount(0);
      return;
    }

    if (tab === "ava") {
      setAvaUnreadCount(0);
      return;
    }

    let cancelled = false;

    const refreshUnread = async () => {
      try {
        const response = await api.ava(accessToken);
        if (!cancelled) setAvaUnreadCount(response.state.unreadCount);
      } catch {
        // A missed badge refresh should not interrupt the rest of the app.
      }
    };

    void refreshUnread();
    const interval = setInterval(() => void refreshUnread(), 30_000);
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refreshUnread();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [session?.access_token, tab]);

  const changeTab = useCallback((nextTab: AppTab) => {
    if (nextTab === "ava") setAvaUnreadCount(0);
    setTab(nextTab);
  }, []);

  const handleAvaUnreadCountChange = useCallback((count: number) => {
    setAvaUnreadCount(count);
  }, []);


  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (!authReady) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <LoginScreen />
      </SafeAreaView>
    );
  }

  const token = session.access_token;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.body}>
        <View style={[styles.screen, tab !== "home" && styles.hidden]}>
          <HomeScreen
            onStart={(prompt) => {
              setInitialPrompt(prompt);
              setTab("chat");
            }}
          />
        </View>
        <View style={[styles.screen, tab !== "chat" && styles.hidden]}>
          <ChatScreen
            accessToken={token}
            initialPrompt={initialPrompt}
            resetVersion={chatResetVersion}
            onInitialPromptConsumed={() => setInitialPrompt(undefined)}
          />
        </View>
        <View style={[styles.screen, tab !== "ava" && styles.hidden]}>
          <AvaScreen
            accessToken={token}
            active={tab === "ava"}
            onUnreadCountChange={handleAvaUnreadCountChange}
          />
        </View>
        <View style={[styles.screen, tab !== "settings" && styles.hidden]}>
          <SettingsScreen
            accessToken={token}
            email={session.user.email ?? ""}
            onConversationCleared={() => setChatResetVersion((value) => value + 1)}
          />
        </View>
      </View>
      {(tab === "chat" || tab === "ava") && keyboardVisible ? null : (
        <TabBar active={tab} avaUnreadCount={avaUnreadCount} onChange={changeTab} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg
  },
  body: {
    flex: 1
  },
  screen: {
    ...StyleSheet.absoluteFillObject
  },
  hidden: {
    display: "none"
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg
  }
});
