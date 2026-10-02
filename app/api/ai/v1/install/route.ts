import { handleInstall } from "../../../../../lib/hosted-ai/service";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleInstall(request);
}
