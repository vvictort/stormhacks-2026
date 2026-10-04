import { AppError } from '../http/errors.ts';

// Thin fetch wrapper over the ElevenLabs Agents API. The API key stays server-side.

const API_BASE = 'https://api.elevenlabs.io';

/** Without keys calls still ring and score; only accept fails, and the frontend offers caption-only practice. */
export class ElevenLabsNotConfigured extends AppError {
  constructor(message: string) {
    super(503, 'elevenlabs_not_configured', message);
  }
}

export class ElevenLabsError extends AppError {
  constructor(upstreamStatus: number) {
    super(502, 'elevenlabs_error', 'The voice service failed. Please try again.', { status: upstreamStatus });
  }
}

export interface ElevenLabsConversation {
  conversation_id: string;
  status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  transcript: { role: 'user' | 'agent'; message: string | null; time_in_call_secs: number }[];
  metadata?: { call_duration_secs?: number; termination_reason?: string };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
    evaluation_criteria_results?: Record<string, { result: string; rationale?: string }>;
    data_collection_results?: Record<string, { value: unknown; rationale?: string }>;
  } | null;
}

export function createElevenLabs({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!apiKey) throw new ElevenLabsNotConfigured('ELEVENLABS_API_KEY is not set');
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // The body can explain the failure, but it never goes to the browser.
      console.error(`ElevenLabs API ${res.status}: ${text.slice(0, 500)}`);
      throw new ElevenLabsError(res.status);
    }
    return JSON.parse(text) as T;
  }

  return {
    /** Short-lived WebRTC token the browser uses to start a session with the (private) agent. */
    conversationToken() {
      if (!agentId) throw new ElevenLabsNotConfigured('ELEVENLABS_AGENT_ID is not set (run `npm run setup:agent`)');
      return request<{ token: string; conversation_id?: string }>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);
    },
    getConversation: (conversationId: string) =>
      request<ElevenLabsConversation>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`),
    createAgent: (body: unknown) =>
      request<{ agent_id: string }>('/v1/convai/agents/create', { method: 'POST', body: JSON.stringify(body) }),
    updateAgent: (id: string, body: unknown) =>
      request<unknown>(`/v1/convai/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  };
}

export type ElevenLabs = ReturnType<typeof createElevenLabs>;
