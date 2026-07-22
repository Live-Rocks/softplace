export async function sendAvaPush(tokens: string[], content: string) {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Ava",
    body: content,
    data: { tab: "ava" }
  }));
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages)
  });
  if (!response.ok) throw new Error(`expo_push_failed:${response.status}`);
}
