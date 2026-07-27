import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api/client";

export const AVA_NOTIFICATION_CHANNEL_ID = "ava-messages";

export type PushRegistrationState = {
  status: "idle" | "registering" | "registered" | "denied" | "unsupported" | "error";
  message: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export async function registerForAvaPushNotifications(accessToken: string) {
  if (Platform.OS === "web") {
    return {
      status: "unsupported",
      message: "Web 版本不註冊裝置推播。"
    } satisfies PushRegistrationState;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(AVA_NOTIFICATION_CHANNEL_ID, {
      name: "Ava 訊息",
      description: "Ava 回覆與主動訊息",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250]
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  const permission = existingPermission.granted
    ? existingPermission
    : await Notifications.requestPermissionsAsync();

  if (!permission.granted) {
    return {
      status: "denied",
      message: "通知權限尚未允許，請到 Android 系統設定開啟。"
    } satisfies PushRegistrationState;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error("EAS project ID is missing. Run eas init before registering push notifications.");
  }

  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.registerPushToken(pushToken.data, Platform.OS === "android" ? "android" : "ios", accessToken);
  return {
    status: "registered",
    message: "這台裝置已完成 Ava 推播註冊。"
  } satisfies PushRegistrationState;
}

export function isAvaNotificationResponse(response: Notifications.NotificationResponse | null) {
  return response?.notification.request.content.data?.tab === "ava";
}
