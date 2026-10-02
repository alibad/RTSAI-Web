import { handleChatCompletion } from "../../../../../../lib/hosted-ai/service";

// OpenAI-compatible chat completions backed by Claude Haiku 4.5. Nitro packages
// every route into the Node.js Vercel function (not Edge); the model key stays
// in server-only environment variables.
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleChatCompletion(request);
}
