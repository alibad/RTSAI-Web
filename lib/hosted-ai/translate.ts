import type Anthropic from "@anthropic-ai/sdk";
import { ALLOWED_MODEL_ALIASES, HOSTED_MODEL, type HostedAiConfig } from "./config";
import { invalid } from "./errors";
import { parseImageUrl } from "./images";
import { imageTokenEstimate } from "./pricing";

/**
 * Translation between the OpenAI chat-completions surface the companion and
 * the Agents SDK already speak and the Anthropic Messages API.
 *
 * Supported: system/developer/user/assistant/tool messages, text and base64
 * image parts, function tools, tool_calls, tool_choice, parallel_tool_calls,
 * response_format (json_schema and json_object), stop, temperature and
 * max_tokens. Streaming is refused: neither `router.py` nor the Agents SDK
 * runner used by the companion streams. OpenAI-only knobs (reasoning_effort,
 * verbosity, store, metadata, seed, penalties, top_p, extra_body fields) are
 * ignored. Haiku 4.5 runs without extended thinking and without `effort`.
 */

export type TranslatedRequest = {
  params: Anthropic.MessageCreateParamsNonStreaming;
  requestedModel: string;
  maxTokens: number;
  textCharacters: number;
  imageCount: number;
  imageBytes: number;
  imageTokens: number;
  structuredOutput: boolean;
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_MESSAGES = 80;
const MAX_TOOLS = 64;
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "maxItems", "uniqueItems", "minProperties", "maxProperties",
  "default", "examples", "discriminator", "patternProperties", "propertyNames",
]);

function toolId(value: unknown, index: number) {
  const raw = typeof value === "string" && value ? value : `call_${index}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

/**
 * Structured outputs accept a JSON-schema subset: every object needs
 * `additionalProperties: false` and numeric/string/array bounds are not
 * enforced. Loosening is safe because the companion validates every reply.
 */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!isObject(schema)) return schema;
  const output: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    if (key === "format" && (typeof value !== "string" || !SUPPORTED_FORMATS.has(value))) continue;
    if (key === "properties" || key === "$defs" || key === "definitions") {
      output[key] = Object.fromEntries(Object.entries(isObject(value) ? value : {}).map(([name, item]) => [name, sanitizeSchema(item)]));
      continue;
    }
    output[key] = sanitizeSchema(value);
  }
  if (output.type === "object" || isObject(output.properties)) output.additionalProperties = false;
  return output;
}

function textOf(content: unknown, role: string): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (!Array.isArray(content)) throw invalid("unsupported_content", `${role} content must be a string or an array of parts`);
  return content
    .map((part) => {
      if (isObject(part) && (part.type === "text" || part.type === "input_text") && typeof part.text === "string") return part.text;
      throw invalid("unsupported_content", `${role} content only supports text parts`);
    })
    .join("\n");
}

export function translateRequest(body: unknown, config: HostedAiConfig): TranslatedRequest {
  if (!isObject(body)) throw invalid("invalid_body", "The request body must be a JSON object");
  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  if (!ALLOWED_MODEL_ALIASES.has(requestedModel)) {
    throw invalid("model_not_allowed", `Model '${requestedModel.slice(0, 80)}' is not available; use ${HOSTED_MODEL}`);
  }
  if (body.stream === true) throw invalid("streaming_not_supported", "Streaming responses are not supported by the RTS AI proxy");
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw invalid("unsupported_parameter", "Only n=1 is supported");
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw invalid("invalid_messages", "messages must be a non-empty array");
  if (body.messages.length > MAX_MESSAGES) throw invalid("too_many_messages", `At most ${MAX_MESSAGES} messages are accepted`);

  const system: string[] = [];
  const messages: Anthropic.MessageParam[] = [];
  let textCharacters = 0;
  let imageCount = 0;
  let imageBytes = 0;
  let imageTokens = 0;

  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return;
    const previous = messages.at(-1);
    if (previous && previous.role === role && Array.isArray(previous.content)) {
      previous.content.push(...blocks);
      return;
    }
    messages.push({ role, content: blocks });
  };

  body.messages.forEach((raw, index) => {
    if (!isObject(raw)) throw invalid("invalid_messages", `messages[${index}] must be an object`);
    const role = raw.role;
    if (role === "system" || role === "developer") {
      const text = textOf(raw.content, String(role));
      textCharacters += text.length;
      if (text.trim()) system.push(text);
      return;
    }
    if (role === "user") {
      if (typeof raw.content === "string") {
        textCharacters += raw.content.length;
        if (raw.content.trim()) push("user", [{ type: "text", text: raw.content }]);
        return;
      }
      if (!Array.isArray(raw.content)) throw invalid("unsupported_content", "user content must be a string or an array of parts");
      const blocks: Anthropic.ContentBlockParam[] = [];
      for (const part of raw.content) {
        if (isObject(part) && (part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
          textCharacters += part.text.length;
          if (part.text.trim()) blocks.push({ type: "text", text: part.text });
        } else if (isObject(part) && part.type === "image_url") {
          imageCount += 1;
          if (imageCount > config.maxImages) {
            throw invalid("too_many_images", `At most ${config.maxImages} images are accepted per request`);
          }
          const imageUrl = isObject(part.image_url) ? part.image_url.url : part.image_url;
          const image = parseImageUrl(imageUrl, config.maxImageBytes);
          imageBytes += image.bytes;
          if (imageBytes > config.maxTotalImageBytes) {
            throw invalid("images_too_large", `Images may total at most ${Math.floor(config.maxTotalImageBytes / 1_000)} KB per request`);
          }
          imageTokens += imageTokenEstimate(image.width, image.height);
          blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
        } else {
          throw invalid("unsupported_content", "user content supports only text and image_url parts");
        }
      }
      push("user", blocks);
      return;
    }
    if (role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      const text = textOf(raw.content, "assistant");
      textCharacters += text.length;
      if (text.trim()) blocks.push({ type: "text", text });
      if (raw.tool_calls !== undefined && raw.tool_calls !== null) {
        if (!Array.isArray(raw.tool_calls)) throw invalid("invalid_tool_calls", "tool_calls must be an array");
        raw.tool_calls.forEach((call, callIndex) => {
          const fn = isObject(call) && isObject(call.function) ? call.function : null;
          if (!fn || typeof fn.name !== "string" || !TOOL_NAME.test(fn.name)) {
            throw invalid("invalid_tool_calls", "Each tool call needs a valid function name");
          }
          let input: unknown = {};
          const args = typeof fn.arguments === "string" ? fn.arguments : "{}";
          textCharacters += args.length;
          try {
            input = args.trim() ? JSON.parse(args) : {};
          } catch {
            throw invalid("invalid_tool_calls", `Tool call arguments for '${fn.name}' are not valid JSON`);
          }
          blocks.push({
            type: "tool_use",
            id: toolId(isObject(call) ? call.id : undefined, callIndex),
            name: fn.name,
            input: isObject(input) ? input : { value: input },
          });
        });
      }
      push("assistant", blocks);
      return;
    }
    if (role === "tool") {
      const content = textOf(raw.content, "tool");
      textCharacters += content.length;
      push("user", [{ type: "tool_result", tool_use_id: toolId(raw.tool_call_id, index), content: content || "(empty result)" }]);
      return;
    }
    throw invalid("unsupported_role", `Message role '${String(role).slice(0, 20)}' is not supported`);
  });

  if (!messages.length || messages[0].role !== "user") {
    throw invalid("invalid_messages", "The conversation must start with a user message");
  }

  const requested = Number(body.max_completion_tokens ?? body.max_tokens ?? config.defaultMaxTokens);
  const maxTokens = Math.max(1, Math.min(config.maxTokens, Number.isFinite(requested) ? Math.floor(requested) : config.defaultMaxTokens));

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: HOSTED_MODEL,
    max_tokens: maxTokens,
    messages,
  };

  if (typeof body.temperature === "number" && Number.isFinite(body.temperature)) {
    params.temperature = Math.min(1, Math.max(0, body.temperature));
  }
  const stops = (typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 4);
  if (stops.length) params.stop_sequences = stops;

  let structuredOutput = false;
  const format = isObject(body.response_format) ? body.response_format : null;
  if (format?.type === "json_schema") {
    const schema = isObject(format.json_schema) ? format.json_schema.schema : undefined;
    if (!isObject(schema)) throw invalid("invalid_response_format", "response_format.json_schema.schema must be an object");
    params.output_config = { format: { type: "json_schema", schema: sanitizeSchema(schema) as Json } };
    structuredOutput = true;
  } else if (format?.type === "json_object") {
    system.push("Respond with exactly one JSON object and nothing else: no prose and no code fences.");
  } else if (format && format.type !== "text") {
    throw invalid("invalid_response_format", "response_format.type must be text, json_object or json_schema");
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    if (body.tools.length > MAX_TOOLS) throw invalid("too_many_tools", `At most ${MAX_TOOLS} tools are accepted`);
    params.tools = body.tools.map((tool) => {
      const fn = isObject(tool) && tool.type === "function" && isObject(tool.function) ? tool.function : null;
      if (!fn || typeof fn.name !== "string" || !TOOL_NAME.test(fn.name)) {
        throw invalid("invalid_tools", "Only function tools with names matching [a-zA-Z0-9_-]{1,64} are supported");
      }
      const parameters = isObject(fn.parameters) ? fn.parameters : { type: "object", properties: {} };
      textCharacters += JSON.stringify(parameters).length + String(fn.description ?? "").length;
      return {
        name: fn.name,
        ...(typeof fn.description === "string" && fn.description ? { description: fn.description } : {}),
        input_schema: { ...parameters, type: "object" } as Anthropic.Tool.InputSchema,
      };
    });
    const choice = body.tool_choice;
    const disableParallel = body.parallel_tool_calls === false ? { disable_parallel_tool_use: true } : {};
    if (choice === "none") params.tool_choice = { type: "none" };
    else if (choice === "required") params.tool_choice = { type: "any", ...disableParallel };
    else if (isObject(choice) && choice.type === "function" && isObject(choice.function) && typeof choice.function.name === "string") {
      if (!params.tools.some((tool) => "name" in tool && tool.name === (choice.function as Json).name)) {
        throw invalid("invalid_tool_choice", "tool_choice names a tool that was not supplied");
      }
      params.tool_choice = { type: "tool", name: choice.function.name, ...disableParallel };
    } else params.tool_choice = { type: "auto", ...disableParallel };
  }

  if (system.length) params.system = system.join("\n\n");
  if (params.tools?.length) {
    // Agent tool loops resend the same tools + instructions every turn (the MCP
    // planner sends ~12K characters of schemas). Automatic prompt caching makes
    // later turns read that prefix at 0.1x. Single-shot chat stays uncached:
    // it is below Haiku 4.5's 4,096-token minimum and would never be reused.
    params.cache_control = { type: "ephemeral" };
  }

  return { params, requestedModel, maxTokens, textCharacters, imageCount, imageBytes, imageTokens, structuredOutput };
}

const finishReasons: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  pause_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

export function translateResponse(message: Anthropic.Message, extras: Json = {}) {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const toolCalls = message.content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));
  const cached = message.usage.cache_read_input_tokens ?? 0;
  const prompt = message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + cached;
  return {
    id: `chatcmpl-${message.id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: HOSTED_MODEL,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || (toolCalls.length ? null : ""),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          ...(message.stop_reason === "refusal" ? { refusal: "The model declined this request." } : {}),
        },
        finish_reason: finishReasons[message.stop_reason ?? "end_turn"] ?? "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: message.usage.output_tokens,
      total_tokens: prompt + message.usage.output_tokens,
      prompt_tokens_details: { cached_tokens: cached },
    },
    ...extras,
  };
}
