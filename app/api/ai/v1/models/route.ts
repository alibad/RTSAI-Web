import { handleModels } from "../../../../../lib/hosted-ai/service";

export function GET() {
  return handleModels();
}
