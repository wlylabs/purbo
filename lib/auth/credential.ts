/**
 * The storage handle for a passkey record.
 *
 * A credential id is hashed rather than used raw so the key space cannot be
 * walked back into the ids a user's devices would present. Both sides need
 * the same answer: the server files and looks up records under it, and the
 * client uses it to name a passkey in a list and to ask for one to be
 * revoked — so the derivation lives here, in a module neither side owns.
 */

import { sha256, toHex, utf8Encode } from "@/lib/crypto/primitives";

export async function credentialHash(credentialId: string): Promise<string> {
  return toHex(await sha256(utf8Encode(`purbo:cred:v1:${credentialId}`)));
}
