/**
 * Voice Integration Service
 *
 * Integrates ElevenLabs for text-to-speech and conversational AI voice agents.
 * Sets up Twilio for inbound/outbound phone calls.
 * Implements context injection from Supabase memory and recent Telegram messages.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Voice agent configuration for ElevenLabs
 */
export interface VoiceAgentConfig {
  /** ElevenLabs API key */
  apiKey: string;

  /** ElevenLabs Agent ID for conversational AI */
  agentId: string;

  /** Voice ID to use (optional, uses agent default if not specified) */
  voiceId?: string;

  /** Region for ElevenLabs API */
  region?: string;
}

/**
 * Twilio configuration for phone calls
 */
export interface TwilioConfig {
  /** Twilio Account SID */
  accountSid: string;

  /** Twilio Auth Token */
  authToken: string;

  /** Twilio phone number to use for calls */
  phoneNumber: string;

  /** Base URL for TwiML webhook endpoints */
  webhookBaseUrl: string;
}

/**
 * Context for voice conversation injection
 */
export interface VoiceContext {
  /** Recent messages from Telegram (last 15) */
  recentMessages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;

  /** User's active goals */
  goals: Array<{
    description: string;
    deadline: string | null;
    status: string;
  }>;

  /** Relevant facts about the user */
  facts: Array<{
    key: string;
    value: string;
    confidence: number;
  }>;

  /** Current date/time for context */
  currentTime: Date;
}

/**
 * Call direction (inbound or outbound) */
export type CallDirection = "inbound" | "outbound";

/**
 * Active call session
 */
export interface CallSession {
  /** Unique call session ID */
  sessionId: string;

  /** Twilio Call SID */
  callSid: string;

  /** Direction of the call */
  direction: CallDirection;

  /** Phone number of the other party */
  phoneNumber: string;

  /** Context injected into the conversation */
  context: VoiceContext;

  /** When the call started */
  startedAt: Date;

  /** Full transcript of the conversation */
  transcript: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: Date;
  }>;

  /** Whether the call is still active */
  isActive: boolean;
}

/**
 * Processed call result after completion
 */
export interface ProcessedCallResult {
  /** The call session */
  session: CallSession;

  /** Summary of the conversation */
  summary: string;

  /** Tasks extracted from the conversation */
  tasks: string[];

  /** Actions to execute */
  actions: CallAction[];

  /** Whether to notify via Telegram */
  notifyTelegram: boolean;
}

/**
 * Action to execute after call
 */
export interface CallAction {
  /** Type of action */
  type: "task" | "reminder" | "goal" | "message" | "command";

  /** Action description */
  description: string;

  /** Action parameters (type-specific) */
  params: Record<string, unknown>;
}

// ============================================================================
// VOICE SERVICE CLASS
// ============================================================================

/**
 * Main voice service class integrating ElevenLabs and Twilio
 */
export class VoiceService {
  private elevenLabsConfig: VoiceAgentConfig;
  private twilioConfig: TwilioConfig;
  private activeCalls: Map<string, CallSession> = new Map();

  constructor(elevenLabsConfig: VoiceAgentConfig, twilioConfig: TwilioConfig) {
    this.elevenLabsConfig = elevenLabsConfig;
    this.twilioConfig = twilioConfig;
  }

  // ========================================================================
  // ELEVENLABS INTEGRATION
  // ========================================================================

  /**
   * Get the conversational AI agent URL from ElevenLabs
   *
   * @returns The agent URL for Twilio to connect to
   */
  getAgentUrl(): string {
    const region = this.elevenLabsConfig.region || "us";
    return `https://${region}.elevenlabs.io/v1/conv-agent/${this.elevenLabsConfig.agentId}/twilio`;
  }

  /**
   * Generate context prompt for ElevenLabs agent injection
   *
   * @param context - The voice context to inject
   * @returns Formatted context string
   */
  generateContextPrompt(context: VoiceContext): string {
    const sections: string[] = [];

    // Current time
    sections.push(`Current time: ${context.currentTime.toISOString()}`);

    // Recent messages
    if (context.recentMessages.length > 0) {
      sections.push("\n=== Recent Telegram Messages ===");
      for (const msg of context.recentMessages.slice(-15)) {
        sections.push(`[${msg.role}]: ${msg.content}`);
      }
    }

    // Goals
    if (context.goals.length > 0) {
      sections.push("\n=== Active Goals ===");
      for (const goal of context.goals) {
        const deadline = goal.deadline ? ` (due: ${goal.deadline})` : "";
        sections.push(`- ${goal.description}${deadline} [${goal.status}]`);
      }
    }

    // Facts
    if (context.facts.length > 0) {
      sections.push("\n=== Known Facts ===");
      for (const fact of context.facts) {
        sections.push(`- ${fact.key}: ${fact.value} (confidence: ${fact.confidence})`);
      }
    }

    return sections.join("\n");
  }

  /**
   * Inject context into an active ElevenLabs agent session
   *
   * @param agentSessionId - ElevenLabs agent session ID
   * @param context - Context to inject
   */
  async injectContext(agentSessionId: string, context: VoiceContext): Promise<void> {
    const contextPrompt = this.generateContextPrompt(context);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/conv-agent/${this.elevenLabsConfig.agentId}/session/${agentSessionId}/context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.elevenLabsConfig.apiKey,
        },
        body: JSON.stringify({
          context: contextPrompt,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to inject context: ${response.statusText}`);
    }
  }

  // ========================================================================
  // TWILIO INTEGRATION
  // ========================================================================

  /**
   * Generate TwiML for inbound calls
   *
   * @returns TwiML XML string
   */
  generateInboundTwiML(): string {
    const agentUrl = this.getAgentUrl();
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${agentUrl}" />
  </Connect>
</Response>`;
  }

  /**
   * Generate TwiML for outbound calls
   *
   * @returns TwiML XML string
   */
  generateOutboundTwiML(): string {
    const agentUrl = this.getAgentUrl();
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${agentUrl}" />
  </Connect>
</Response>`;
  }

  /**
   * Initiate an outbound call
   *
   * @param toNumber - Phone number to call
   * @param context - Context to inject
   * @returns The call session
   */
  async initiateOutboundCall(toNumber: string, context: VoiceContext): Promise<CallSession> {
    // For actual implementation, you would use the Twilio SDK
    // This is a placeholder that simulates the call initiation

    const sessionId = this.generateSessionId();
    const callSid = `CA_${sessionId}`; // Simulated Twilio Call SID

    const session: CallSession = {
      sessionId,
      callSid,
      direction: "outbound",
      phoneNumber: toNumber,
      context,
      startedAt: new Date(),
      transcript: [],
      isActive: true,
    };

    this.activeCalls.set(sessionId, session);

    // In real implementation, you would:
    // 1. Use @twilio/rest Client to create the call
    // 2. Point the TwiML to your webhook endpoint
    // 3. The webhook would return the agent URL via TwiML

    return session;
  }

  /**
   * Handle inbound call from Twilio webhook
   *
   * @param callSid - Twilio Call SID
   * @param fromNumber - Caller's phone number
   * @param context - Context to inject
   * @returns The call session
   */
  handleInboundCall(callSid: string, fromNumber: string, context: VoiceContext): CallSession {
    const sessionId = this.generateSessionId();

    const session: CallSession = {
      sessionId,
      callSid,
      direction: "inbound",
      phoneNumber: fromNumber,
      context,
      startedAt: new Date(),
      transcript: [],
      isActive: true,
    };

    this.activeCalls.set(sessionId, session);
    return session;
  }

  // ========================================================================
  // CALL SESSION MANAGEMENT
  // ========================================================================

  /**
   * Get an active call session
   *
   * @param sessionId - Call session ID
   * @returns The call session or undefined
   */
  getSession(sessionId: string): CallSession | undefined {
    return this.activeCalls.get(sessionId);
  }

  /**
   * Get session by Twilio Call SID
   *
   * @param callSid - Twilio Call SID
   * @returns The call session or undefined
   */
  getSessionByCallSid(callSid: string): CallSession | undefined {
    for (const session of this.activeCalls.values()) {
      if (session.callSid === callSid) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * End a call session
   *
   * @param sessionId - Call session ID
   * @returns The ended session or undefined
   */
  endSession(sessionId: string): CallSession | undefined {
    const session = this.activeCalls.get(sessionId);
    if (session) {
      session.isActive = false;
      this.activeCalls.delete(sessionId);
    }
    return session;
  }

  /**
   * Add a transcript entry to a session
   *
   * @param sessionId - Call session ID
   * @param role - Who spoke (user or agent)
   * @param text - What was said
   */
  addTranscriptEntry(sessionId: string, role: "user" | "agent", text: string): void {
    const session = this.activeCalls.get(sessionId);
    if (session) {
      session.transcript.push({
        role,
        text,
        timestamp: new Date(),
      });
    }
  }

  // ========================================================================
  // POST-CALL PROCESSING
  // ========================================================================

  /**
   * Process a completed call and extract tasks/actions
   *
   * @param session - The completed call session
   * @returns Processed result with tasks and actions
   */
  async processCompletedCall(session: CallSession): Promise<ProcessedCallResult> {
    const transcript = session.transcript;
    const fullTranscript = transcript
      .map((entry) => `[${entry.role}]: ${entry.text}`)
      .join("\n");

    // In real implementation, you would send this to Claude Code
    // to extract tasks, summarize conversation, and determine actions

    const summary = await this.generateCallSummary(session);
    const tasks = await this.extractTasks(session);
    const actions = await this.determineActions(session);

    return {
      session,
      summary,
      tasks,
      actions,
      notifyTelegram: tasks.length > 0 || actions.length > 0,
    };
  }

  /**
   * Generate a summary of the call
   *
   * @param session - The call session
   * @returns Call summary text
   */
  private async generateCallSummary(session: CallSession): Promise<string> {
    const transcript = session.transcript
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join("\n");

    // Placeholder - in real implementation, send to Claude Code
    return `Call with ${session.phoneNumber} on ${session.startedAt.toISOString()}\n\n${transcript}`;
  }

  /**
   * Extract tasks from the call transcript
   *
   * @param session - The call session
   * @returns Array of task descriptions
   */
  private async extractTasks(session: CallSession): Promise<string[]> {
    // Placeholder - in real implementation, use Claude Code to extract
    // actionable items from the conversation
    const tasks: string[] = [];

    for (const entry of session.transcript) {
      if (entry.role === "user") {
        // Simple keyword-based extraction for now
        if (entry.text.toLowerCase().includes("remind me")) {
          tasks.push(entry.text);
        }
        if (entry.text.toLowerCase().includes("don't forget")) {
          tasks.push(entry.text);
        }
      }
    }

    return tasks;
  }

  /**
   * Determine actions to execute after the call
   *
   * @param session - The call session
   * @returns Array of actions
   */
  private async determineActions(session: CallSession): Promise<CallAction[]> {
    const actions: CallAction[] = [];

    // Analyze transcript for action items
    const transcriptText = session.transcript.map((t) => t.text).join(" ").toLowerCase();

    // Check for goals
    if (transcriptText.includes("goal") || transcriptText.includes("need to")) {
      actions.push({
        type: "goal",
        description: "Create goal from call",
        params: { source: "voice_call", callId: session.sessionId },
      });
    }

    // Check for reminders
    if (transcriptText.includes("remind") || transcriptText.includes("remember")) {
      actions.push({
        type: "reminder",
        description: "Set reminder from call",
        params: { source: "voice_call", callId: session.sessionId },
      });
    }

    // Check for messages to send
    if (transcriptText.includes("tell") || transcriptText.includes("message") || transcriptText.includes("text")) {
      actions.push({
        type: "message",
        description: "Send message from call",
        params: { source: "voice_call", callId: session.sessionId },
      });
    }

    return actions;
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `voice_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): CallSession[] {
    return Array.from(this.activeCalls.values());
  }

  /**
   * Get count of active calls
   */
  getActiveCallCount(): number {
    return this.activeCalls.size;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a VoiceService instance from environment variables
 */
export function createVoiceService(): VoiceService {
  const elevenLabsConfig: VoiceAgentConfig = {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    agentId: process.env.ELEVENLABS_AGENT_ID || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    region: process.env.ELEVENLABS_REGION || "us",
  };

  const twilioConfig: TwilioConfig = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || "",
  };

  // Validate required config
  if (!elevenLabsConfig.apiKey) {
    throw new Error("ELEVENLABS_API_KEY is required");
  }
  if (!elevenLabsConfig.agentId) {
    throw new Error("ELEVENLABS_AGENT_ID is required");
  }
  if (!twilioConfig.accountSid) {
    throw new Error("TWILIO_ACCOUNT_SID is required");
  }
  if (!twilioConfig.authToken) {
    throw new Error("TWILIO_AUTH_TOKEN is required");
  }
  if (!twilioConfig.phoneNumber) {
    throw new Error("TWILIO_PHONE_NUMBER is required");
  }

  return new VoiceService(elevenLabsConfig, twilioConfig);
}
