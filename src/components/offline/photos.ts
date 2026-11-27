// Photos taken offline: compressed as usual, then kept in the outbox until they sync.
import type { PhotoTarget } from "@/modules/offline/logic";
import type { Compressed } from "@/components/issues/compress";
import { addChange, newClientId, offlineUser } from "./outbox";

export async function queuePhoto(projectId: string, target: PhotoTarget, name: string, caption: string, c: Compressed, href?: string) {
  const userId = offlineUser();
  if (!userId) throw new Error("Sign in again to keep photos on this device.");
  const clientId = newClientId();
  await addChange({
    clientId,
    projectId,
    userId,
    kind: "photo",
    label: name,
    href,
    photo: c.photo,
    thumb: c.thumb,
    change: { kind: "photo", clientId, madeAt: new Date().toISOString(), target, name, caption, size: c.photo.size, thumbSize: c.thumb.size },
  });
  return clientId;
}
