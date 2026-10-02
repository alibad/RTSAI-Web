import { verifyFirebaseIdentity } from "../../../../../lib/firebase-token";
import { handleLink } from "../../../../../lib/hosted-ai/service";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleLink(request, (idToken) =>
    verifyFirebaseIdentity(new Request(request.url, { headers: { authorization: `Bearer ${idToken}` } })),
  );
}
