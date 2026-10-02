import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { POST as chatCompletions } from "../app/api/ai/v1/chat/completions/route";
import { POST as install } from "../app/api/ai/v1/install/route";
import { GET as models } from "../app/api/ai/v1/models/route";
import { GET as status } from "../app/api/ai/v1/status/route";
import { hostedAiConfig } from "../lib/hosted-ai/config";
import { costMicros } from "../lib/hosted-ai/pricing";
import { handleLink, missingProductionSettings, setHostedAiOverrides, utcDay } from "../lib/hosted-ai/service";
import { reachedThresholds, resetSpendAlertMemo } from "../lib/hosted-ai/spend-alerts";
import { MemoryUsageStore } from "../lib/hosted-ai/store";
import { sanitizeSchema } from "../lib/hosted-ai/translate";
import { startMockAnthropic } from "../scripts/mock-anthropic.mjs";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const NOW = Date.parse("2026-10-02T12:00:30Z");
const tunables = [
  "RTSAI_AI_KILL_SWITCH",
  "RTSAI_AI_ANON_DAILY_USD",
  "RTSAI_AI_GLOBAL_DAILY_CAP_USD",
  "RTSAI_AI_REQUESTS_PER_MINUTE",
  "RTSAI_AI_INSTALLS_PER_IP_PER_DAY",
  "RTSAI_AI_MAX_BODY_BYTES",
  "RTSAI_AI_STORE",
  "RTSAI_AI_LINKED_DAILY_USD",
  "RTSAI_AI_FIREBASE_SERVICE_ACCOUNT",
  "VERCEL_ENV",
  "MAIL_FIREBASE_PROJECT_ID",
  "MAIL_FIREBASE_API_KEY",
  "MAIL_GROUP",
  "FEEDBACK_ADMIN_EMAIL",
];
const MODEL_KEY = "test-placeholder-not-a-real-key";
const TOKEN_SECRET = "test-secret-0123456789abcdef0123456789abcdef";

let mock: Awaited<ReturnType<typeof startMockAnthropic>>;
let store: MemoryUsageStore;

before(async () => {
  mock = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = MODEL_KEY;
  process.env.RTSAI_AI_TOKEN_SECRET = TOKEN_SECRET;
});

after(async () => {
  await mock.close();
});

beforeEach(() => {
  for (const name of tunables) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = MODEL_KEY;
  process.env.RTSAI_AI_TOKEN_SECRET = TOKEN_SECRET;
  resetSpendAlertMemo();
  store = new MemoryUsageStore();
  setHostedAiOverrides({ store, now: () => NOW });
  mock.requests.length = 0;
});

async function newInstall(ip = "203.0.113.7") {
  const response = await install(new Request("https://rtsai.net/api/ai/v1/install", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ client: "rtsai-companion" }),
  }));
  assert.equal(response.status, 201);
  return (await response.json()) as { token: string; install_id: string; daily_allowance_usd: number };
}

function chat(token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return chatCompletions(new Request("https://rtsai.net/api/ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  }));
}

const simple = { model: "claude-haiku-4-5", messages: [{ role: "system", content: "One sentence." }, { role: "user", content: "Status?" }] };

test("install issues a zero-click token that authorizes a translated Haiku chat call", async () => {
  const { token, daily_allowance_usd } = await newInstall();
  assert.equal(daily_allowance_usd, 0.25);
  const response = await chat(token, { ...simple, max_tokens: 50_000, reasoning_effort: "low", temperature: 1.7 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-rtsai-ai-state"), "ok");
  const payload = await response.json();
  assert.equal(payload.object, "chat.completion");
  assert.equal(payload.model, "claude-haiku-4-5");
  assert.match(payload.choices[0].message.content, /Mock Haiku reply/);
  assert.equal(payload.choices[0].finish_reason, "stop");
  assert.ok(payload.usage.prompt_tokens > 0 && payload.usage.completion_tokens > 0);
  assert.ok(payload.rtsai.cost_usd > 0 && payload.rtsai.remaining_usd < 0.25);

  const upstream = mock.requests[0];
  assert.equal(upstream.model, "claude-haiku-4-5");
  assert.equal(upstream.max_tokens, 1_024, "max_tokens is clamped");
  assert.equal(upstream.temperature, 1, "temperature is clamped to Anthropic's range");
  assert.equal(upstream.system, "One sentence.");
  assert.equal("thinking" in upstream, false, "Haiku 4.5 runs without extended thinking");
  assert.equal("output_config" in upstream, false, "no effort parameter for Haiku 4.5");
  assert.equal("cache_control" in upstream, false, "single-shot chat is not cached");
  assert.deepEqual(upstream.messages, [{ role: "user", content: [{ type: "text", text: "Status?" }] }]);
});

test("vision requests forward at most two inline images and refuse oversize or remote images", async () => {
  const { token } = await newInstall();
  const image = { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1X1}`, detail: "high" } };
  const ok = await chat(token, { model: "claude-haiku-4-5", messages: [{ role: "user", content: [{ type: "text", text: "Map?" }, image, image] }] });
  assert.equal(ok.status, 200);
  const blocks = mock.requests[0].messages[0].content;
  assert.deepEqual(blocks.map((block: { type: string }) => block.type), ["text", "image", "image"]);
  assert.equal(blocks[1].source.media_type, "image/png");

  const three = await chat(token, { model: "claude-haiku-4-5", messages: [{ role: "user", content: [image, image, image] }] });
  assert.equal(three.status, 400);
  assert.equal((await three.json()).error.code, "too_many_images");

  const huge = `data:image/png;base64,${"A".repeat(700_000)}`;
  const big = await chat(token, { model: "claude-haiku-4-5", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: huge } }] }] });
  assert.equal((await big.json()).error.code, "image_too_large");

  const remote = await chat(token, { model: "claude-haiku-4-5", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] });
  assert.equal((await remote.json()).error.code, "unsupported_image");
  assert.equal(mock.requests.length, 1, "rejected requests never reach the model");
});

test("function tools, tool_choice and tool results round-trip through Anthropic tool use", async () => {
  const { token } = await newInstall();
  const tools = [{
    type: "function",
    function: { name: "battlefield", description: "Read the match", parameters: { type: "object", properties: { detail: { type: "string" } }, required: ["detail"] } },
  }];
  const first = await chat(token, {
    model: "claude-haiku-4-5",
    messages: [{ role: "user", content: "Look." }],
    tools,
    tool_choice: "required",
    parallel_tool_calls: false,
  });
  const firstPayload = await first.json();
  assert.equal(firstPayload.choices[0].finish_reason, "tool_calls");
  const call = firstPayload.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "battlefield");
  assert.deepEqual(JSON.parse(call.function.arguments), { detail: "mock" });
  assert.deepEqual(mock.requests[0].tool_choice, { type: "any", disable_parallel_tool_use: true });
  assert.equal(mock.requests[0].tools[0].input_schema.type, "object");
  assert.deepEqual(mock.requests[0].cache_control, { type: "ephemeral" }, "tool loops cache their stable prefix");

  const second = await chat(token, {
    model: "claude-haiku-4-5",
    messages: [
      { role: "user", content: "Look." },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "{\"cash\":500}" },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "battlefield" } },
  });
  assert.equal(second.status, 200);
  const replayed = mock.requests[1];
  assert.deepEqual(replayed.messages[1].content[0], { type: "tool_use", id: call.id, name: "battlefield", input: { detail: "mock" } });
  assert.deepEqual(replayed.messages[2].content[0], { type: "tool_result", tool_use_id: call.id, content: "{\"cash\":500}" });
  assert.deepEqual(replayed.tool_choice, { type: "tool", name: "battlefield" });
});

test("json_schema response formats become Anthropic structured outputs", async () => {
  const { token } = await newInstall();
  const schema = {
    type: "object",
    properties: { verb: { type: "string", enum: ["attack", "move"] }, count: { type: "integer", minimum: 1, maximum: 12 } },
    required: ["verb", "count"],
  };
  const response = await chat(token, {
    model: "claude-haiku-4-5",
    messages: [{ role: "user", content: "attack" }],
    response_format: { type: "json_schema", json_schema: { name: "order", schema, strict: true } },
    temperature: 0,
  });
  const payload = await response.json();
  assert.deepEqual(JSON.parse(payload.choices[0].message.content), { verb: "attack", count: 0 });
  const format = mock.requests[0].output_config.format;
  assert.equal(format.type, "json_schema");
  assert.equal(format.schema.additionalProperties, false);
  assert.equal("minimum" in format.schema.properties.count, false);
});

test("guardrails reject other models, streaming, bad tokens and oversize bodies with clear codes", async () => {
  const { token } = await newInstall();
  const wrongModel = await chat(token, { ...simple, model: "claude-opus-5-5" });
  assert.equal(wrongModel.status, 400);
  assert.equal((await wrongModel.json()).error.code, "model_not_allowed");

  const streaming = await chat(token, { ...simple, stream: true });
  assert.equal((await streaming.json()).error.code, "streaming_not_supported");

  const missing = await chat("", simple);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("x-rtsai-ai-state"), "unauthorized");
  const forged = await chat(`${token.slice(0, -4)}AAAA`, simple);
  assert.equal((await forged.json()).error.code, "install_token_invalid");

  process.env.RTSAI_AI_MAX_BODY_BYTES = "64000";
  const tooLarge = await chat(token, { ...simple, messages: [{ role: "user", content: "x".repeat(70_000) }] });
  assert.equal(tooLarge.status, 413);
  assert.equal(mock.requests.length, 0);
});

test("an exhausted daily allowance returns 429 with a reset time and never calls the model", async () => {
  const { token, install_id } = await newInstall();
  store.seedSpend(install_id, utcDay(NOW), 250_000, 0);
  const response = await chat(token, simple);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-rtsai-ai-state"), "allowance");
  assert.equal(response.headers.get("retry-after"), String(12 * 3_600 - 30));
  assert.equal((await response.json()).error.code, "daily_allowance_exhausted");
  assert.equal(mock.requests.length, 0);

  const report = await (await status(new Request("https://rtsai.net/api/ai/v1/status", { headers: { authorization: `Bearer ${token}` } }))).json();
  assert.equal(report.state, "allowance");
  assert.equal(report.remaining_usd, 0);

  const second = await newInstall("203.0.113.8");
  store.seedSpend(second.install_id, utcDay(NOW), 246_000, 0);
  const nearlyUsed = await (await status(new Request("https://rtsai.net/api/ai/v1/status", { headers: { authorization: `Bearer ${second.token}` } }))).json();
  assert.equal(nearlyUsed.state, "allowance", "a remainder smaller than a typical call reads as used up");
  assert.equal(nearlyUsed.remaining_usd, 0.004);
});

test("the global spend cap and the kill switch stop all model calls with 503", async () => {
  const { token, install_id } = await newInstall();
  process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD = "1";
  store.seedSpend("someone-else", utcDay(NOW), 1_000_000);
  const capped = await chat(token, simple);
  assert.equal(capped.status, 503);
  assert.equal((await capped.json()).error.code, "global_budget_exhausted");
  assert.equal(capped.headers.get("x-rtsai-ai-state"), "budget");
  assert.equal((await store.usage(install_id, utcDay(NOW))).installMicros, 0, "the failed reservation is rolled back");

  delete process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD;
  process.env.RTSAI_AI_KILL_SWITCH = "1";
  const paused = await chat(token, simple);
  assert.equal(paused.status, 503);
  assert.equal(paused.headers.get("x-rtsai-ai-state"), "paused");
  assert.equal((await paused.json()).error.code, "service_paused");
  assert.equal(mock.requests.length, 0);
});

test("per-token minute limits and per-IP install limits return 429", async () => {
  process.env.RTSAI_AI_REQUESTS_PER_MINUTE = "2";
  const { token } = await newInstall();
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal((await chat(token, simple)).status, 200);
  const limited = await chat(token, simple);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "rate_limited");

  process.env.RTSAI_AI_INSTALLS_PER_IP_PER_DAY = "2";
  await newInstall("198.51.100.1");
  const second = await install(new Request("https://rtsai.net/api/ai/v1/install", { method: "POST", headers: { "x-forwarded-for": "198.51.100.1" } }));
  assert.equal(second.status, 201, "second install from this IP is still allowed");
  const third = await install(new Request("https://rtsai.net/api/ai/v1/install", { method: "POST", headers: { "x-forwarded-for": "198.51.100.1" } }));
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error.code, "install_rate_limited");
});

test("upstream failures release the reservation and map to retryable 503s", async () => {
  const { token, install_id } = await newInstall();
  const response = await chat(token, { ...simple, messages: [{ role: "system", content: "MOCK_FAIL_529" }, { role: "user", content: "hi" }] });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "upstream_unavailable");
  assert.equal((await store.usage(install_id, utcDay(NOW))).installMicros, 0);

  const rejected = await chat(token, {
    model: "claude-haiku-4-5",
    messages: [{ role: "system", content: "MOCK_FAIL_400" }, { role: "user", content: "hi" }],
    response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "object", properties: {} } } },
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error.message, /response_format/);
});

test("the production deployment refuses per-instance memory quotas", async () => {
  setHostedAiOverrides({ now: () => NOW });
  process.env.VERCEL_ENV = "production";
  process.env.RTSAI_AI_STORE = "memory";
  const response = await install(new Request("https://rtsai.net/api/ai/v1/install", { method: "POST" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "store_unavailable");
});

test("linking an account raises the allowance through the seam", async () => {
  const { token, install_id } = await newInstall();
  const request = () => new Request("https://rtsai.net/api/ai/v1/link", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ firebase_id_token: "valid-firebase-token" }),
  });
  const rejected = await handleLink(request(), async () => null);
  assert.equal(rejected.status, 401);
  const linked = await handleLink(request(), async (idToken) => (idToken === "valid-firebase-token" ? { uid: "firebase-uid-1" } : null));
  assert.equal(linked.status, 200);
  assert.equal((await store.getInstall(install_id))?.linkedUid, "firebase-uid-1");
  const report = await (await status(new Request("https://rtsai.net/api/ai/v1/status", { headers: { authorization: `Bearer ${token}` } }))).json();
  assert.equal(report.tier, "linked");
  assert.equal(report.daily_allowance_usd, 1);
});

test("model catalogue, cost math and schema sanitizing", async () => {
  const catalogue = await (await models()).json();
  assert.deepEqual(catalogue.data.map((model: { id: string }) => model.id), ["claude-haiku-4-5"]);
  assert.equal(costMicros({ input_tokens: 2_000, output_tokens: 100 }), 2_500);
  assert.equal(costMicros({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 1_000 }), 2_250);
  assert.deepEqual(
    sanitizeSchema({ type: "object", properties: { a: { type: "string", maxLength: 4, format: "regex" }, b: { type: "array", items: { type: "object", properties: {} }, maxItems: 3 } } }),
    { type: "object", properties: { a: { type: "string" }, b: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } } }, additionalProperties: false },
  );
});

test("unset or blank spend settings default to a $0.25 install allowance and a $10 global cap", async () => {
  let config = hostedAiConfig();
  assert.equal(config.anonymousDailyUsd, 0.25);
  assert.equal(config.globalDailyCapUsd, 10);
  assert.equal(config.linkedDailyUsd, 1);
  process.env.RTSAI_AI_ANON_DAILY_USD = " ";
  process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD = "";
  config = hostedAiConfig();
  assert.equal(config.anonymousDailyUsd, 0.25, "a blank value counts as unset");
  assert.equal(config.globalDailyCapUsd, 10);
  process.env.RTSAI_AI_ANON_DAILY_USD = "0.5";
  process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD = "25";
  config = hostedAiConfig();
  assert.equal(config.anonymousDailyUsd, 0.5, "explicit values still win");
  assert.equal(config.globalDailyCapUsd, 25);
});

test("production refuses every route until the model key, token secret and durable store are set", async () => {
  setHostedAiOverrides({ now: () => NOW });
  process.env.VERCEL_ENV = "production";
  process.env.RTSAI_AI_STORE = "firestore";
  const fakeAccount = { project_id: "demo-rtsai", client_email: "proxy@demo-rtsai.iam.gserviceaccount.com", private_key: "not-a-key" };
  const codeOf = async (response: Response) => {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-rtsai-ai-state"), "unavailable");
    return (await response.json()).error.code;
  };
  const statusRequest = () => status(new Request("https://rtsai.net/api/ai/v1/status", { headers: { authorization: "Bearer x" } }));
  const installRequest = () => install(new Request("https://rtsai.net/api/ai/v1/install", { method: "POST" }));

  assert.deepEqual(missingProductionSettings(hostedAiConfig()), ["RTSAI_AI_FIREBASE_SERVICE_ACCOUNT"]);
  assert.equal(await codeOf(await installRequest()), "store_unavailable");

  process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT = JSON.stringify(fakeAccount);
  delete process.env.RTSAI_AI_TOKEN_SECRET;
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(missingProductionSettings(hostedAiConfig()), ["RTSAI_AI_TOKEN_SECRET", "ANTHROPIC_API_KEY"]);
  assert.equal(await codeOf(await installRequest()), "token_secret_not_configured");

  process.env.RTSAI_AI_TOKEN_SECRET = TOKEN_SECRET;
  assert.equal(await codeOf(await installRequest()), "upstream_not_configured", "no install tokens are issued without the model key");
  assert.equal(await codeOf(await statusRequest()), "upstream_not_configured");
  assert.equal(await codeOf(await chat("x", simple)), "upstream_not_configured");

  process.env.ANTHROPIC_API_KEY = MODEL_KEY;
  assert.deepEqual(missingProductionSettings(hostedAiConfig()), [], "nothing else is required: spend settings have defaults");
  assert.equal(mock.requests.length, 0);
});

test("spend alerts queue one email per threshold per day at 50% and 80% of the global cap", async () => {
  const mails: { to: string | string[]; subject: string; text: string; html: string }[] = [];
  setHostedAiOverrides({ store, now: () => NOW, sendMail: async (mail) => { mails.push(mail); return "mail-id"; } });
  process.env.MAIL_FIREBASE_PROJECT_ID = "demo-mail";
  process.env.MAIL_FIREBASE_API_KEY = "test-placeholder";
  process.env.FEEDBACK_ADMIN_EMAIL = "ops@example.com";
  process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD = "1";
  const day = utcDay(NOW);
  const { token, install_id } = await newInstall();

  store.seedSpend("someone-else", day, 499_990);
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(mails.length, 1, "crossing 50% queues one alert");
  assert.deepEqual(mails[0].to, "ops@example.com");
  assert.match(mails[0].subject, /passed 50% of today's cap \(\$0\.50 of \$1\.00\)/);
  assert.match(mails[0].text, /RTSAI_AI_GLOBAL_DAILY_CAP_USD/);
  assert.equal(`${mails[0].text}${mails[0].html}`.includes(install_id), false, "alerts carry totals only, no install ids");
  assert.equal(`${mails[0].text}${mails[0].html}`.includes("Status?"), false, "alerts never include prompts");

  assert.equal((await chat(token, simple)).status, 200);
  resetSpendAlertMemo(); // a fresh server instance still sees the store's claim
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(mails.length, 1, "the 50% alert is sent once per day");

  store.seedSpend("someone-else", day, 300_000);
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(mails.length, 2);
  assert.match(mails[1].subject, /passed 80%/);
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(mails.length, 2, "no third email: there are only two thresholds");
  assert.deepEqual(reachedThresholds(999_999, 1_000_000), [50, 80]);
  assert.deepEqual(reachedThresholds(499_999, 1_000_000), []);
  assert.deepEqual(reachedThresholds(5, 0), [], "a zero cap never alerts");
});

test("a failed alert email releases the claim for a later retry; alerts stay off without mail settings", async () => {
  let attempts = 0;
  const sent: string[] = [];
  let clock = NOW;
  setHostedAiOverrides({
    store,
    now: () => clock,
    sendMail: async (mail) => {
      attempts += 1;
      if (attempts === 1) throw new Error("Firebase mail write failed (503)");
      sent.push(mail.subject.match(/passed (\d+)%/)?.[1] ?? "?");
      return "mail-id";
    },
  });
  process.env.RTSAI_AI_GLOBAL_DAILY_CAP_USD = "1";
  const day = utcDay(NOW);
  const { token } = await newInstall();
  store.seedSpend("someone-else", day, 799_990);

  assert.equal((await chat(token, simple)).status, 200, "without mail settings the answer is served and nothing is sent");
  assert.equal(attempts, 0);

  process.env.MAIL_FIREBASE_PROJECT_ID = "demo-mail";
  process.env.MAIL_FIREBASE_API_KEY = "test-placeholder";
  process.env.MAIL_GROUP = "archive@example.com, second@example.com";
  assert.equal((await chat(token, simple)).status, 200, "a failing mail backend never fails the player's call");
  assert.equal(attempts, 2, "the 50% send failed, the 80% send went out");
  assert.deepEqual(sent, ["80"]);

  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(attempts, 2, "this instance backs off before retrying");
  clock = NOW + 5 * 60_000 + 1;
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(sent, ["80", "50"], "the released 50% claim is retried and sent once");
  assert.equal((await chat(token, simple)).status, 200);
  assert.equal(attempts, 3);
});
