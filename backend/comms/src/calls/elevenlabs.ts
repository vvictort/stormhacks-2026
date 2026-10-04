import { config } from '../config.ts';

// Thin fetch wrapper over the ElevenLabs Agents API. The API key stays server-side.

const API_BASE = 'https://api.elevenlabs.io';

export class ElevenLabsNotConfigured extends Error {}

export class ElevenLabsError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`ElevenLabs API ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

export function requireAgentId() {
  if (!config.ELEVENLABS_AGENT_ID) {
    throw new ElevenLabsNotConfigured('ELEVENLABS_AGENT_ID is not set (run `npm run setup:agent`)');
  }
  return config.ELEVENLABS_AGENT_ID;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.ELEVENLABS_API_KEY) throw new ElevenLabsNotConfigured('ELEVENLABS_API_KEY is not set');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new ElevenLabsError(res.status, text);
  return JSON.parse(text) as T;
}

/** Short-lived WebRTC token the browser uses to start a session with the (private) agent. */
export const getConversationToken = (agentId: string) =>
  request<{ token: string; conversation_id?: string }>(
    `/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
  );

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

export const getConversation = (conversationId: string) =>
  request<ElevenLabsConversation>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`);

export const createAgent = (body: unknown) =>
  request<{ agent_id: string }>('/v1/convai/agents/create', { method: 'POST', body: JSON.stringify(body) });

export const updateAgent = (agentId: string, body: unknown) =>
  request<unknown>(`/v1/convai/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify(body) });
