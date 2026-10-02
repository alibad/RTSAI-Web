import { handleStatus } from "../../../../../lib/hosted-ai/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleStatus(request);
}
