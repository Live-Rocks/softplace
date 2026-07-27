type ExpoPushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export async function sendAvaPush(tokens: string[], content: string) {
  if (!tokens.length) return { accepted: 0, receiptIds: [] as string[] };

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    priority: "high",
    channelId: "ava-messages",
    title: "Ava",
    body: content,
    data: { tab: "ava" }
  }));
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages)
  });

  if (!response.ok) {
    throw new Error(`expo_push_http_failed:${response.status}`);
  }

  const payload = await response.json() as { data?: ExpoPushTicket[] };
  const tickets = payload.data ?? [];
  const rejected = tickets.find((ticket) => ticket.status === "error");

  if (rejected?.status === "error") {
    const reason = rejected.details?.error ?? rejected.message ?? "unknown";
    throw new Error(`expo_push_ticket_failed:${reason}`);
  }

  const receiptIds = tickets
    .filter((ticket): ticket is Extract<ExpoPushTicket, { status: "ok" }> => ticket.status === "ok")
    .map((ticket) => ticket.id);

  if (receiptIds.length !== tokens.length) {
    throw new Error(`expo_push_ticket_count_mismatch:${receiptIds.length}/${tokens.length}`);
  }

  return { accepted: receiptIds.length, receiptIds };
}
