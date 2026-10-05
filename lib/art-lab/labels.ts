import type { ActorArt } from "./types";

/** "main-battle-tank" -> "Main battle tank"; falls back to the category. */
export function roleLabel(actor: Pick<ActorArt, "roles" | "category">) {
  const role = actor.roles[0];
  if (!role) return actor.category;
  const text = role.replace(/-/g, " ");
  return text[0].toUpperCase() + text.slice(1);
}
