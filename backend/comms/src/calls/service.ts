import { config } from '../config.ts';
import { callEvent, type EventSink } from '../events.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { redact } from '../lib/redact.ts';
import type { CommsStore } from '../store.ts';
import { COMPROMISING_SIGNALS, type CallRecord, type CallScenario, type Outcome, type Signal } from '../types.ts';
import { getConversation, getConversationToken, requireAgentId, type ElevenLabsConversation } from './elevenlabs.ts';
import { withPreamble } from './preamble.ts';

/** Give up waiting for ElevenLabs' post-call analysis after this long. */
const ANALYSIS_TIMEOUT_MS = 90_000;
const POLL_DELAYS_MS = [2000, 3000, 5000, 5000, 10_000];
/** A call still ringing after this long (tab closed) is marked missed. */
const RING_ABANDON_MS = 2 * 60_000;
/** An accepted call never reported as ended (tab closed) is analyzed after max duration + this grace. */
const IN_CALL_GRACE_MS = 60_000;

/** Agent data-collection fields (see scripts/setup-agent.ts) → signals. */
const DATA_COLLECTION_SIGNALS: Record<string, Signal> = {
  shared_otp: 'shared_code',
  shared_personal_info: 'shared_personal_info',
  shared_payment_info: 'shared_payment_info',
  agreed_to_action: 'agreed_to_action',
  challenged_caller: 'challenged',
  asked_to_verify: 'asked_to_verify',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Session overrides in the shape `@elevenlabs/client` / `@elevenlabs/react` `startSession` expects. */
function buildOverrides(scenario: CallScenario) {
  return {
    agent: { prompt: { prompt: withPreamble(scenario.systemPrompt) }, firstMessage: scenario.firstMessage },
    ...(scenario.voiceId ? { tts: { voiceId: scenario.voiceId } } : {}),
  };
}

export type CallAccept = { call: CallRecord; conversationToken: string; overrides: ReturnType<typeof buildOverrides> };

export class CallService {
  private analyzing = new Set<string>();
  private readonly store: CommsStore;
  private readonly events: EventSink;

  constructor(store: CommsStore, events: EventSink) {
    this.store = store;
    this.events = events;
  }

  async start(userId: string, scenario: CallScenario): Promise<CallRecord> {
    const call: CallRecord = { id: newId('call'), userId, scenario, status: 'ringing', createdAt: nowIso(), signals: [] };
    await this.store.createCall(call);
    await this.events.emit(callEvent('call.ringing', call, { callerLabel: scenario.callerLabel, difficulty: scenario.difficulty }));
    return call;
  }

  get(callId: string) {
    return this.store.getCall(callId);
  }

  /** User picked up: fetch a fresh token so it can't expire while ringing. */
  async accept(callId: string): Promise<CallAccept | 'not_found' | 'wrong_state'> {
    const current = await this.store.getCall(callId);
    if (!current) return 'not_found';
    if (current.status !== 'ringing') return 'wrong_state';

    const { token, conversation_id } = await getConversationToken(requireAgentId());
    const now = Date.now();
    const { call, result: accepted } = await this.store.updateCall(callId, (c) => {
      if (c.status !== 'ringing') return false;
      c.status = 'in_call';
      c.acceptedAt = new Date(now).toISOString();
      c.conversationId = conversation_id;
      return true;
    });
    if (!accepted) return 'wrong_state';

    await this.events.emit(callEvent('call.accepted', call, { ringMs: now - Date.parse(call.createdAt) }));
    return { call, conversationToken: token, overrides: buildOverrides(call.scenario) };
  }

  async decline(callId: string, reason: 'declined' | 'missed'): Promise<CallRecord | 'not_found' | 'wrong_state'> {
    if (!(await this.store.getCall(callId))) return 'not_found';
    const now = Date.now();
    const { call, result: declined } = await this.store.updateCall(callId, (c) => {
      if (c.status !== 'ringing') return false;
      c.status = 'completed';
      c.outcome = reason;
      c.completedAt = new Date(now).toISOString();
      return true;
    });
    if (!declined) return 'wrong_state';
    await this.events.emit(callEvent(reason === 'declined' ? 'call.declined' : 'call.missed', call, { ringMs: now - Date.parse(call.createdAt) }));
    return call;
  }

  /** Browser hung up (or the agent ended the call). Analysis continues in the background. */
  async ended(callId: string, conversationId?: string): Promise<CallRecord | 'not_found' | 'wrong_state'> {
    const current = await this.store.getCall(callId);
    if (!current) return 'not_found';
    if (current.status !== 'in_call') return 'wrong_state';
    if (conversationId && current.conversationId && conversationId !== current.conversationId) {
      console.warn(`[calls] ${callId}: browser conversation id ${conversationId} != token's ${current.conversationId}; using the browser's`);
    }

    const { call } = await this.store.updateCall(callId, (c) => {
      c.status = 'analyzing';
      c.endedAt = nowIso();
      c.conversationId = conversationId ?? c.conversationId;
    });
    await this.events.emit(callEvent('call.ended', call, { conversationId: call.conversationId }));
    void this.analyze(callId);
    return call;
  }

  /** Recovers calls abandoned by a closed tab or interrupted by a restart. */
  async sweep() {
    const now = Date.now();
    for (const c of await this.store.listCallsByStatus('ringing')) {
      if (now - Date.parse(c.createdAt) >= RING_ABANDON_MS) await this.decline(c.id, 'missed');
    }
    for (const c of await this.store.listCallsByStatus('in_call')) {
      if (now - Date.parse(c.acceptedAt!) >= config.CALL_MAX_SECONDS * 1000 + IN_CALL_GRACE_MS) await this.ended(c.id);
    }
    for (const c of await this.store.listCallsByStatus('analyzing')) {
      if (!this.analyzing.has(c.id)) void this.analyze(c.id);
    }
  }

  private async analyze(callId: string) {
    if (this.analyzing.has(callId)) return;
    this.analyzing.add(callId);
    try {
      const call = await this.store.getCall(callId);
      if (!call || call.status !== 'analyzing') return;
      if (!call.conversationId) return await this.fail(callId, 'no conversation id');

      const deadline = Date.parse(call.endedAt ?? nowIso()) + ANALYSIS_TIMEOUT_MS;
      for (let attempt = 0; ; attempt++) {
        try {
          const conv = await getConversation(call.conversationId);
          if (conv.status === 'done' && conv.analysis) return await this.complete(callId, conv);
          if (conv.status === 'failed') return await this.fail(callId, 'ElevenLabs conversation failed');
        } catch (err) {
          // The conversation can briefly 404 right after hang-up; keep polling until the deadline.
          console.warn(`[calls] ${callId}: fetching conversation failed`, err instanceof Error ? err.message : err);
        }
        if (Date.now() >= deadline) return await this.fail(callId, 'timed out waiting for call analysis');
        await sleep(POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]!);
      }
    } finally {
      this.analyzing.delete(callId);
    }
  }

  private async complete(callId: string, conv: ElevenLabsConversation) {
    const results = conv.analysis?.data_collection_results ?? {};
    const signals = new Set<Signal>();
    for (const [field, signal] of Object.entries(DATA_COLLECTION_SIGNALS)) {
      const value = results[field]?.value;
      if (value === true || value === 'true') signals.add(signal);
    }
    const transcript = conv.transcript
      .filter((t) => t.message)
      .map((t) => ({ role: t.role, message: redact(t.message!), timeInCallSecs: t.time_in_call_secs }));
    if (transcript.some((t) => t.role === 'user')) signals.add('engaged');

    const outcome: Outcome = [...signals].some((s) => COMPROMISING_SIGNALS.includes(s)) ? 'compromised' : 'resisted';
    const dataCollection = Object.fromEntries(
      Object.entries(results).map(([k, r]) => [k, { value: r.value, rationale: r.rationale && redact(r.rationale) }]),
    );

    const { call } = await this.store.updateCall(callId, (c) => {
      c.status = 'completed';
      c.outcome = outcome;
      c.completedAt = nowIso();
      c.signals = [...signals];
      c.transcript = transcript;
      c.dataCollection = dataCollection;
      c.durationSecs = conv.metadata?.call_duration_secs;
      c.summary = conv.analysis?.transcript_summary && redact(conv.analysis.transcript_summary);
      c.resisted = conv.analysis?.evaluation_criteria_results?.user_resisted?.result;
    });
    await this.events.emit(
      callEvent('call.analyzed', call, {
        outcome,
        signals: call.signals,
        resisted: call.resisted,
        durationSecs: call.durationSecs,
        terminationReason: conv.metadata?.termination_reason,
        dataCollection: Object.fromEntries(Object.entries(dataCollection).map(([k, r]) => [k, r.value])),
        summary: call.summary,
        transcript,
      }),
    );
  }

  private async fail(callId: string, error: string) {
    const { call } = await this.store.updateCall(callId, (c) => {
      c.status = 'completed';
      c.outcome = 'error';
      c.completedAt = nowIso();
      c.error = error;
    });
    await this.events.emit(callEvent('call.failed', call, { error }));
  }
}
