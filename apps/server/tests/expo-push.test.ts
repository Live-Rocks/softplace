import assert from "node:assert/strict";
import test from "node:test";
import { sendAvaPush } from "../src/integrations/expoPush.js";

test("Ava push uses the high-priority Android channel and returns receipt ids", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;

  globalThis.fetch = async (_input, init) => {
    request = init;
    return Response.json({
      data: [{ status: "ok", id: "receipt-1" }]
    });
  };

  try {
    const result = await sendAvaPush(["ExpoPushToken[test-token]"], "Ava 的訊息");
    const body = JSON.parse(String(request?.body));

    assert.deepEqual(result, { accepted: 1, receiptIds: ["receipt-1"] });
    assert.equal(body[0].channelId, "ava-messages");
    assert.equal(body[0].priority, "high");
    assert.equal(body[0].data.tab, "ava");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ava push treats an Expo ticket error as a failed send", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    data: [{
      status: "error",
      message: "The device is not registered",
      details: { error: "DeviceNotRegistered" }
    }]
  });

  try {
    await assert.rejects(
      sendAvaPush(["ExpoPushToken[expired-token]"], "Ava 的訊息"),
      /expo_push_ticket_failed:DeviceNotRegistered/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ava push skips the Expo request when no device token is registered", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    assert.deepEqual(
      await sendAvaPush([], "Ava 的訊息"),
      { accepted: 0, receiptIds: [] }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
