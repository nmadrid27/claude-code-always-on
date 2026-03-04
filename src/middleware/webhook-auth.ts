/**
 * Webhook Signature Verification
 *
 * Implements HMAC verification for Twilio (SHA1) and ElevenLabs (SHA256)
 * webhook requests. Uses constant-time comparison to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies a Twilio webhook request signature.
 *
 * Algorithm:
 * 1. Concatenate the request URL
 * 2. Sort POST params alphabetically by key, append each key+value pair
 * 3. HMAC-SHA1 with the Twilio auth token → base64
 * 4. Constant-time compare to X-Twilio-Signature header value
 *
 * @param authToken - TWILIO_AUTH_TOKEN env var value
 * @param signature - Value of the X-Twilio-Signature request header
 * @param url       - Full request URL (scheme + host + port + path + query)
 * @param params    - Parsed POST body parameters as key-value object
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;

  // Build the string to sign: URL + sorted params
  const sortedKeys = Object.keys(params).sort();
  let str = url;
  for (const key of sortedKeys) {
    str += key + params[key];
  }

  const expected = createHmac("sha1", authToken)
    .update(str, "utf8")
    .digest("base64");

  // Constant-time comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");

  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Verifies an ElevenLabs webhook request signature.
 *
 * Algorithm:
 * 1. Parse header: "t=<timestamp>,v0=<hex-signature>"
 * 2. Construct signed string: "<timestamp>.<rawBody>"
 * 3. HMAC-SHA256 with the ElevenLabs signing secret → hex
 * 4. Constant-time compare to v0 field
 *
 * @param signingSecret   - ELEVENLABS_SIGNING_SECRET env var value
 * @param signatureHeader - Value of the ElevenLabs-Signature request header
 * @param rawBody         - The raw request body string (before JSON parsing)
 */
export function verifyElevenLabsSignature(
  signingSecret: string,
  signatureHeader: string,
  rawBody: string,
): boolean {
  if (!signatureHeader) return false;

  // Parse "t=1234567890,v0=abcdef..."
  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(",")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx > 0) {
      parts[segment.slice(0, eqIdx)] = segment.slice(eqIdx + 1);
    }
  }

  const timestamp = parts["t"];
  const v0 = parts["v0"];

  if (!timestamp || !v0) return false;

  const signedString = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", signingSecret)
    .update(signedString, "utf8")
    .digest("hex");

  // Constant-time comparison
  let expectedBuf: Buffer;
  let v0Buf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    v0Buf = Buffer.from(v0, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== v0Buf.length || expectedBuf.length === 0) return false;
  return timingSafeEqual(expectedBuf, v0Buf);
}
