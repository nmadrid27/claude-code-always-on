/**
 * Twilio Webhook Handler
 *
 * Handles Twilio webhooks for inbound and outbound calls.
 * Connects calls to ElevenLabs voice agent with injected context.
 */

import { VoiceService, type VoiceContext } from "./voice.js";
import { MemoryService } from "./memory.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Twilio webhook event types
 */
export type TwilioEventType =
  | "call.ringing"
  | "call.initiated"
  | "call.answered"
  | "call.completed"
  | "call.failed"
  | "call.busy"
  | "call.no-answer";

/**
 * Twilio webhook payload for call status changes
 */
export interface TwilioCallStatus {
  /** Twilio Call SID */
  CallSid: string;

  /** Call status (ringing, in-progress, completed, etc.) */
  CallStatus: string;

  /** Direction of the call (inbound or outbound) */
  Direction: string;

  /** Caller's phone number */
  From: string;

  /** Called phone number */
  To: string;

  /** When the call was initiated */
  Timestamp: string;

  /** Optional caller ID name */
  CallerName?: string;

  /** Optional forwarded from number */
  ForwardedFrom?: string;
}

/**
 * ElevenLabs webhook payload for agent events
 */
export interface ElevenLabsAgentEvent {
  /** Event type */
  event_type: "agent_connected" | "agent_disconnected" | "transcript";

  /** Agent session ID */
  agent_session_id: string;

  /** Call SID from Twilio */
  call_sid: string;

  /** Transcript data (for transcript events) */
  transcript?: {
    role: "user" | "agent";
    text: string;
    timestamp: number;
  };
}

// ============================================================================
// WEBHOOK HANDLER CLASS
// ============================================================================

/**
 * Handles Twilio webhooks and integrates with VoiceService
 */
export class TwilioWebhookHandler {
  private voiceService: VoiceService;
  private memoryServices: Map<number, MemoryService>;
  private phoneToUserId: Map<string, number>;

  constructor(
    voiceService: VoiceService,
    memoryServices: Map<number, MemoryService>,
    phoneToUserId: Map<string, number>
  ) {
    this.voiceService = voiceService;
    this.memoryServices = memoryServices;
    this.phoneToUserId = phoneToUserId;
  }

  // ========================================================================
  // TWILIO WEBHOOK ENDPOINTS
  // ========================================================================

  /**
   * Handle inbound call - return TwiML to connect to ElevenLabs
   *
   * @param callSid - Twilio Call SID
   * @param fromNumber - Caller's phone number
   * @returns TwiML XML string
   */
  async handleInboundCall(callSid: string, fromNumber: string): Promise<string> {
    const userId = this.getUserIdByPhone(fromNumber);

    if (!userId) {
      console.warn(`Unknown caller: ${fromNumber}`);
      // Still allow call, but with empty context
    }

    // Fetch context from memory
    const context = await this.fetchContext(userId);

    // Create call session
    const session = this.voiceService.handleInboundCall(callSid, fromNumber, context);

    // Inject context into ElevenLabs agent
    // In real implementation, you'd get the agent_session_id from ElevenLabs
    // after the connection is established

    console.log(`Inbound call started: ${callSid} from ${fromNumber} (session: ${session.sessionId})`);

    // Return TwiML to connect to ElevenLabs
    return this.voiceService.generateInboundTwiML();
  }

  /**
   * Handle outbound call initiation
   *
   * @param toNumber - Phone number to call
   * @param userId - User ID initiating the call
   * @returns The call session
   */
  async handleOutboundCall(toNumber: string, userId: number): Promise<unknown> {
    const memoryService = this.memoryServices.get(userId);

    if (!memoryService) {
      throw new Error(`No memory service for user ${userId}`);
    }

    // Fetch context from memory
    const context = await this.fetchContext(userId);

    // Initiate call
    const session = await this.voiceService.initiateOutboundCall(toNumber, context);

    console.log(`Outbound call initiated to ${toNumber} (session: ${session.sessionId})`);

    return session;
  }

  /**
   * Handle call status updates from Twilio
   *
   * @param status - Call status payload
   */
  async handleCallStatus(status: TwilioCallStatus): Promise<void> {
    const eventType = this.getEventType(status);

    console.log(`Call ${status.CallSid}: ${eventType}`);

    switch (eventType) {
      case "call.answered":
        await this.onCallAnswered(status);
        break;

      case "call.completed":
        await this.onCallCompleted(status);
        break;

      case "call.failed":
      case "call.busy":
      case "call.no-answer":
        await this.onCallFailed(status);
        break;

      default:
        // Log other events but don't process
        break;
    }
  }

  // ========================================================================
  // ELEVENLABS WEBHOOK HANDLERS
  // ========================================================================

  /**
   * Handle ElevenLabs agent events
   *
   * @param event - Agent event payload
   */
  async handleAgentEvent(event: ElevenLabsAgentEvent): Promise<void> {
    switch (event.event_type) {
      case "agent_connected":
        await this.onAgentConnected(event);
        break;

      case "agent_disconnected":
        await this.onAgentDisconnected(event);
        break;

      case "transcript":
        await this.onTranscript(event);
        break;
    }
  }

  /**
   * Handle agent connection
   */
  private async onAgentConnected(event: ElevenLabsAgentEvent): Promise<void> {
    const session = this.voiceService.getSessionByCallSid(event.call_sid);

    if (!session) {
      console.warn(`No session found for call: ${event.call_sid}`);
      return;
    }

    console.log(`Agent connected for call: ${event.call_sid}`);

    // Inject context into the agent
    try {
      await this.voiceService.injectContext(event.agent_session_id, session.context);
    } catch (error) {
      console.error("Failed to inject context:", error);
    }
  }

  /**
   * Handle agent disconnection (call ended)
   */
  private async onAgentDisconnected(event: ElevenLabsAgentEvent): Promise<void> {
    const session = this.voiceService.getSessionByCallSid(event.call_sid);

    if (!session) {
      console.warn(`No session found for call: ${event.call_sid}`);
      return;
    }

    console.log(`Agent disconnected for call: ${event.call_sid}`);

    // Process the completed call
    await this.processCallEnd(session);
  }

  /**
   * Handle transcript updates
   */
  private async onTranscript(event: ElevenLabsAgentEvent): Promise<void> {
    if (!event.transcript) {
      return;
    }

    const session = this.voiceService.getSessionByCallSid(event.call_sid);

    if (!session) {
      console.warn(`No session found for call: ${event.call_sid}`);
      return;
    }

    // Add transcript entry
    this.voiceService.addTranscriptEntry(
      session.sessionId,
      event.transcript.role,
      event.transcript.text
    );

    // Store in memory (for both user and assistant messages)
    const userId = this.getUserIdByPhone(session.phoneNumber);
    const memoryService = userId ? this.memoryServices.get(userId) : null;

    if (memoryService) {
      await memoryService.storeMessage(
        event.transcript.text,
        event.transcript.role === "user" ? "user" : "assistant"
      );
    }
  }

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================

  /**
   * Handle call answered event
   */
  private async onCallAnswered(status: TwilioCallStatus): Promise<void> {
    const session = this.voiceService.getSessionByCallSid(status.CallSid);

    if (!session) {
      console.warn(`No session found for answered call: ${status.CallSid}`);
      return;
    }

    console.log(`Call answered: ${status.CallSid}`);
    // ElevenLabs connection is handled via TwiML
  }

  /**
   * Handle call completed event
   */
  private async onCallCompleted(status: TwilioCallStatus): Promise<void> {
    const session = this.voiceService.getSessionByCallSid(status.CallSid);

    if (!session) {
      console.warn(`No session found for completed call: ${status.CallSid}`);
      return;
    }

    console.log(`Call completed: ${status.CallSid}`);
    await this.processCallEnd(session);
  }

  /**
   * Handle call failed event
   */
  private async onCallFailed(status: TwilioCallStatus): Promise<void> {
    const session = this.voiceService.getSessionByCallSid(status.CallSid);

    if (!session) {
      console.warn(`No session found for failed call: ${status.CallSid}`);
      return;
    }

    console.log(`Call failed: ${status.CallSid} (${status.CallStatus})`);

    // End the session and log
    this.voiceService.endSession(session.sessionId);

    // Could send notification about failed call
  }

  /**
   * Process call end and extract actions
   */
  private async processCallEnd(session: unknown): Promise<void> {
    // End the session
    const endedSession = this.voiceService.endSession(
      (session as { sessionId: string }).sessionId
    );

    if (!endedSession) {
      return;
    }

    // Process the call transcript
    const result = await this.voiceService.processCompletedCall(endedSession);

    console.log(`Call processed: ${result.summary}`);
    console.log(`Tasks extracted: ${result.tasks.length}`);
    console.log(`Actions to execute: ${result.actions.length}`);

    // Execute actions (in real implementation, this would be async)
    for (const action of result.actions) {
      await this.executeAction(action, endedSession);
    }

    // Send Telegram notification if needed
    if (result.notifyTelegram) {
      await this.sendTelegramNotification(result, endedSession);
    }
  }

  // ========================================================================
  // ACTION EXECUTION
  // ========================================================================

  /**
   * Execute an action from the call
   */
  private async executeAction(action: unknown, session: unknown): Promise<void> {
    // In real implementation, this would:
    // 1. Parse the action type
    // 2. Execute via Claude Code or appropriate service
    // 3. Store results

    console.log(`Executing action: ${(action as { type: string }).type}`);
  }

  /**
   * Send notification to Telegram
   */
  private async sendTelegramNotification(result: unknown, session: unknown): Promise<void> {
    // In real implementation, this would:
    // 1. Format the call summary
    // 2. Send via Telegram bot to the user

    console.log("Sending Telegram notification about call");
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /**
   * Get event type from call status
   */
  private getEventType(status: TwilioCallStatus): TwilioEventType {
    switch (status.CallStatus) {
      case "ringing":
        return "call.ringing";
      case "queued":
      case "initiated":
        return "call.initiated";
      case "in-progress":
        return "call.answered";
      case "completed":
        return "call.completed";
      case "failed":
        return "call.failed";
      case "busy":
        return "call.busy";
      case "no-answer":
        return "call.no-answer";
      default:
        return "call.initiated";
    }
  }

  /**
   * Get user ID by phone number
   */
  private getUserIdByPhone(phoneNumber: string): number | undefined {
    // Normalize phone number (remove +, spaces, dashes)
    const normalized = phoneNumber.replace(/[\s\-\+]/g, "");
    return this.phoneToUserId.get(normalized);
  }

  /**
   * Fetch context for a user
   */
  private async fetchContext(userId?: number): Promise<VoiceContext> {
    const defaultContext: VoiceContext = {
      recentMessages: [],
      goals: [],
      facts: [],
      currentTime: new Date(),
    };

    if (!userId) {
      return defaultContext;
    }

    const memoryService = this.memoryServices.get(userId);

    if (!memoryService) {
      return defaultContext;
    }

    const memoryContext = await memoryService.fetchContext();

    return {
      recentMessages: memoryContext.recentMessages,
      goals: memoryContext.goals,
      facts: memoryContext.facts,
      currentTime: new Date(),
    };
  }
}

// ============================================================================
// EXPRESS/HTTP HANDLERS (for web server integration)
// ============================================================================

/**
 * Create HTTP request handlers for web server integration
 */
export function createWebhookHandlers(
  voiceService: VoiceService,
  memoryServices: Map<number, MemoryService>,
  phoneToUserId: Map<string, number>
) {
  const webhookHandler = new TwilioWebhookHandler(
    voiceService,
    memoryServices,
    phoneToUserId
  );

  return {
    /**
     * Handle inbound call from Twilio
     * POST /webhook/twilio/voice
     */
    inboundCall: async (req: { body: { CallSid: string; From: string } }): Promise<{
      statusCode: number;
      headers: { "Content-Type": string };
      body: string;
    }> => {
      const { CallSid, From } = req.body;

      const twiml = await webhookHandler.handleInboundCall(CallSid, From);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/xml" },
        body: twiml,
      };
    },

    /**
     * Handle call status updates
     * POST /webhook/twilio/status
     */
    callStatus: async (req: { body: TwilioCallStatus }): Promise<{
      statusCode: number;
      body: string;
    }> => {
      await webhookHandler.handleCallStatus(req.body);

      return {
        statusCode: 200,
        body: "OK",
      };
    },

    /**
     * Handle ElevenLabs agent events
     * POST /webhook/elevenlabs
     */
    agentEvent: async (req: { body: ElevenLabsAgentEvent }): Promise<{
      statusCode: number;
      body: string;
    }> => {
      await webhookHandler.handleAgentEvent(req.body);

      return {
        statusCode: 200,
        body: "OK",
      };
    },
  };
}
