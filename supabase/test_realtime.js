// Flow 4 — Supabase Realtime two-process delivery test.
// Process A: subscribe to messages for a known chat_id.
// Process B (after a delay): insert a message via REST.
// Measure how fast the subscriber sees it. Pass if < 5s.
//
// Reads keys from /app/frontend/.env directly so no values are logged.
const fs = require("fs");
const ws = require("ws");
const { createClient } = require("@supabase/supabase-js");

const envText = fs.readFileSync("/app/frontend/.env", "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

const URL = env.REACT_APP_SUPABASE_URL;
const KEY = env.REACT_APP_SUPABASE_ANON_KEY;
const TF1 = "4d050139-a1ba-4656-af57-436a5ad321f2";
const TF2 = "6fbd5bf2-6211-4fd1-b534-63595fad9fe2";

(async () => {
  const sb = createClient(URL, KEY, {
    realtime: { params: { eventsPerSecond: 5 }, transport: ws },
  });

  // Create a fresh chat for this test
  const { data: chat, error: cErr } = await sb
    .from("chats").insert({ participants: [TF1, TF2] }).select().single();
  if (cErr) { console.error("chat insert failed:", cErr); process.exit(1); }
  const chatId = chat.id;
  console.log("created realtime test chat:", chatId);

  let receivedAt = null;
  let sentAt = null;

  const channel = sb
    .channel(`messages:chat:${chatId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages",
        filter: `context_id=eq.${chatId}` },
      (payload) => {
        receivedAt = Date.now();
        const row = payload?.new || {};
        console.log("REALTIME EVENT received:", {
          id: row.id, text: row.text,
          latency_ms: sentAt ? receivedAt - sentAt : "n/a (sent unknown)",
        });
      }
    )
    .subscribe((status) => {
      console.log("subscribe status:", status);
    });

  // Wait until subscription is live
  await new Promise((r) => setTimeout(r, 2500));

  // Now insert a message — should hit the subscriber
  sentAt = Date.now();
  const { data: msg, error: mErr } = await sb
    .from("messages")
    .insert({ context_type: "chat", context_id: chatId, sender_id: TF1, text: "realtime probe" })
    .select().single();
  if (mErr) { console.error("msg insert failed:", mErr); process.exit(2); }
  console.log("inserted message:", msg.id, "sentAt:", sentAt);

  // Wait up to 5s for the realtime event
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !receivedAt) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (receivedAt) {
    console.log(`✅ Flow 4 PASS — realtime delivery latency: ${receivedAt - sentAt} ms`);
    await sb.removeChannel(channel);
    process.exit(0);
  } else {
    console.error("❌ Flow 4 FAIL — no realtime event within 5s");
    await sb.removeChannel(channel);
    process.exit(3);
  }
})();
