#!/usr/bin/env node
/**
 * Local stand-in for the Anthropic Messages API (POST /v1/messages) used by the
 * hosted-AI tests and the end-to-end rehearsal when no real API key is
 * available. Point the SDK at it with ANTHROPIC_BASE_URL=http://127.0.0.1:<port>.
 *
 * Usage is estimated, not tokenized: about 4 characters per text token and
 * width × height / 750 per image (after Claude's 1.15 MP downscale). Fault
 * injection: put MOCK_FAIL_400 or MOCK_FAIL_529 in the system prompt.
 *
 *   node scripts/mock-anthropic.mjs --port 4787
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

function imageSize(base64) {
  const bytes = Buffer.from(base64.slice(0, 200_000), "base64");
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  return { width: 1092, height: 1092 };
}

function imageTokens(source) {
  const { width, height } = imageSize(source.data ?? "");
  const scale = Math.min(1, Math.sqrt(1_150_000 / (width * height)), 1_568 / Math.max(width, height));
  return Math.ceil((width * scale * height * scale) / 750);
}

function sample(schema, root) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return sample((root.$defs ?? root.definitions ?? {})[name], root);
  }
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (Array.isArray(schema.anyOf)) return sample(schema.anyOf.find((item) => item.type !== "null") ?? schema.anyOf[0], root);
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const keys = schema.required ?? Object.keys(schema.properties ?? {});
    return Object.fromEntries(keys.map((key) => [key, sample(schema.properties?.[key], root)]));
  }
  if (type === "array") return [];
  if (type === "string") return "mock";
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return null;
}

export function respond(body, counter) {
  let characters = typeof body.system === "string" ? body.system.length : JSON.stringify(body.system ?? "").length;
  let images = 0;
  let imageTokenTotal = 0;
  let lastText = "";
  for (const message of body.messages ?? []) {
    for (const block of typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content) {
      if (block.type === "text") { characters += block.text.length; if (message.role === "user") lastText = block.text; }
      else if (block.type === "image") { images += 1; imageTokenTotal += imageTokens(block.source); }
      else characters += JSON.stringify(block).length;
    }
  }
  characters += JSON.stringify(body.tools ?? []).length + JSON.stringify(body.output_config ?? {}).length;
  const choice = body.tool_choice?.type;
  let content;
  let stopReason = "end_turn";
  if (body.tools?.length && (choice === "any" || choice === "tool")) {
    // A forced tool choice always produces a tool call, as the real API does.
    const tool = choice === "tool" ? body.tools.find((item) => item.name === body.tool_choice.name) : body.tools[0];
    content = [{ type: "tool_use", id: `toolu_mock_${counter}`, name: tool.name, input: sample(tool.input_schema, tool.input_schema) ?? {} }];
    stopReason = "tool_use";
  } else if (body.output_config?.format?.schema) {
    content = [{ type: "text", text: JSON.stringify(sample(body.output_config.format.schema, body.output_config.format.schema)) }];
  } else {
    const subject = lastText.replace(/\s+/g, " ").slice(0, 60);
    content = [{ type: "text", text: `Mock Haiku reply (${images} image${images === 1 ? "" : "s"}): hold the ore field and scout east. [${subject}]` }];
  }
  const outputCharacters = JSON.stringify(content).length;
  return {
    id: `msg_mock_${counter}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: Math.ceil(characters / 4) + imageTokenTotal,
      output_tokens: Math.max(1, Math.ceil(outputCharacters / 4)),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

export function startMockAnthropic({ port = 0, host = "127.0.0.1" } = {}) {
  const requests = [];
  let counter = 0;
  const server = createServer((request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { "content-type": "application/json", "request-id": `req_mock_${counter}` });
      response.end(JSON.stringify(value));
    };
    if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "not found" } });
    if (!request.headers["x-api-key"]) return send(401, { type: "error", error: { type: "authentication_error", message: "missing x-api-key" } });
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      counter += 1;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } }); }
      requests.push(body);
      const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
      if (system.includes("MOCK_FAIL_529")) return send(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
      if (system.includes("MOCK_FAIL_400")) return send(400, { type: "error", error: { type: "invalid_request_error", message: "mock rejected the request" } });
      const reply = respond(body, counter);
      if (process.env.MOCK_ANTHROPIC_LOG === "1") {
        console.log(`messages.create #${counter}: model=${body.model} input_tokens=${reply.usage.input_tokens} output_tokens=${reply.usage.output_tokens} stop=${reply.stop_reason}`);
      }
      send(200, reply);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ url: `http://${host}:${address.port}`, requests, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--port");
  const port = Number(index > 0 ? process.argv[index + 1] : 4787);
  const mock = await startMockAnthropic({ port });
  console.log(`Mock Anthropic Messages API listening at ${mock.url}`);
}
