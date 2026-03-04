// src/__tests__/webhook-auth.test.ts
import { describe, it, expect } from "bun:test";
import { createHmac } from "crypto";

// ── Helpers to generate known-good signatures for test fixtures ──────────────

function makeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  let str = url;
  for (const key of sortedKeys) {
    str += key + params[key];
  }
  return createHmac("sha1", authToken).update(str, "utf8").digest("base64");
}

function makeElevenLabsSignature(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  const signedString = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(signedString, "utf8").digest("hex");
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TWILIO_AUTH_TOKEN = "test_auth_token_abc123";
const TWILIO_URL = "https://example.com/voice/inbound";
const TWILIO_PARAMS = { CallSid: "CA123456", From: "+15551234567", To: "+18005559999" };
const VALID_TWILIO_SIG = makeTwilioSignature(TWILIO_AUTH_TOKEN, TWILIO_URL, TWILIO_PARAMS);

const ELEVEN_SECRET = "test_eleven_secret_xyz789";
const ELEVEN_TIMESTAMP = "1708550400";
const ELEVEN_BODY = '{"event_type":"transcript","agent_session_id":"sess_abc","call_sid":"CA123456"}';
const ELEVEN_V0 = makeElevenLabsSignature(ELEVEN_SECRET, ELEVEN_TIMESTAMP, ELEVEN_BODY);
const VALID_ELEVEN_HEADER = `t=${ELEVEN_TIMESTAMP},v0=${ELEVEN_V0}`;

// ── Twilio tests ──────────────────────────────────────────────────────────────

describe("verifyTwilioSignature", () => {
  it("passes with correct signature", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyTwilioSignature(TWILIO_AUTH_TOKEN, VALID_TWILIO_SIG, TWILIO_URL, TWILIO_PARAMS)).toBe(true);
  });

  it("fails with tampered param value", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    const tampered = { ...TWILIO_PARAMS, CallSid: "CA_ATTACKER" };
    expect(verifyTwilioSignature(TWILIO_AUTH_TOKEN, VALID_TWILIO_SIG, TWILIO_URL, tampered)).toBe(false);
  });

  it("fails with wrong auth token", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyTwilioSignature("wrong_token", VALID_TWILIO_SIG, TWILIO_URL, TWILIO_PARAMS)).toBe(false);
  });

  it("fails with empty signature string", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyTwilioSignature(TWILIO_AUTH_TOKEN, "", TWILIO_URL, TWILIO_PARAMS)).toBe(false);
  });

  it("passes with empty params (no body)", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    const sig = makeTwilioSignature(TWILIO_AUTH_TOKEN, TWILIO_URL, {});
    expect(verifyTwilioSignature(TWILIO_AUTH_TOKEN, sig, TWILIO_URL, {})).toBe(true);
  });

  it("sorts params alphabetically (CallSid before From before To)", async () => {
    const { verifyTwilioSignature } = await import("../middleware/webhook-auth.js");
    const reversed = { To: TWILIO_PARAMS.To, From: TWILIO_PARAMS.From, CallSid: TWILIO_PARAMS.CallSid };
    expect(verifyTwilioSignature(TWILIO_AUTH_TOKEN, VALID_TWILIO_SIG, TWILIO_URL, reversed)).toBe(true);
  });
});

// ── ElevenLabs tests ──────────────────────────────────────────────────────────

describe("verifyElevenLabsSignature", () => {
  it("passes with correct signature", async () => {
    const { verifyElevenLabsSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyElevenLabsSignature(ELEVEN_SECRET, VALID_ELEVEN_HEADER, ELEVEN_BODY)).toBe(true);
  });

  it("fails with tampered body", async () => {
    const { verifyElevenLabsSignature } = await import("../middleware/webhook-auth.js");
    const tampered = '{"event_type":"transcript","agent_session_id":"ATTACKER","call_sid":"CA123456"}';
    expect(verifyElevenLabsSignature(ELEVEN_SECRET, VALID_ELEVEN_HEADER, tampered)).toBe(false);
  });

  it("fails with wrong signing secret", async () => {
    const { verifyElevenLabsSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyElevenLabsSignature("wrong_secret", VALID_ELEVEN_HEADER, ELEVEN_BODY)).toBe(false);
  });

  it("fails with missing signature header", async () => {
    const { verifyElevenLabsSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyElevenLabsSignature(ELEVEN_SECRET, "", ELEVEN_BODY)).toBe(false);
  });

  it("fails with malformed header (missing v0)", async () => {
    const { verifyElevenLabsSignature } = await import("../middleware/webhook-auth.js");
    expect(verifyElevenLabsSignature(ELEVEN_SECRET, `t=${ELEVEN_TIMESTAMP}`, ELEVEN_BODY)).toBe(false);
  });
});
