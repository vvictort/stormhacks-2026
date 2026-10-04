import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { CallScenario, type Tactic } from '../../comms/src/types.ts';
import type { DifficultyLevel, ScamCategory, User } from '../models/user.ts';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.GEMINI_API_KEY || '';
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

export interface GeneratedEmail {
    id: string;
    senderName: string;
    senderEmail: string;
    subject: string;
    body: string;
    isScam: boolean;
    category: ScamCategory;
    difficulty: DifficultyLevel;
    redFlags: string[];
    explanation: string;
}

const emailJsonSchema = {
    type: 'object',
    properties: {
        senderName: {
            type: 'string',
            description: 'Display name of the sender (e.g. Netflix Billing, IT Department, Amazon Prime)',
        },
        senderEmail: {
            type: 'string',
            description:
                'Email address. If isScam=true, use realistic spoofed or lookalike domain (e.g. support@netflx-verify.com). If isScam=false, use an authentic domain (e.g. info@mailer.netflix.com).',
        },
        subject: {
            type: 'string',
            description: 'Subject line of the email.',
        },
        body: {
            type: 'string',
            description: 'The complete email body text, written in realistic email formatting.',
        },
        isScam: {
            type: 'boolean',
            description: 'true if this email is a scam or phishing attempt; false if authentic and safe.',
        },
        category: {
            type: 'string',
            enum: ['banking', 'shipping', 'account_security', 'workplace', 'promotional'],
            description: 'Theme/category of the email.',
        },
        difficulty: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            description: 'Detection difficulty level.',
        },
        redFlags: {
            type: 'array',
            items: { type: 'string' },
            description:
                'List of specific indicators/red flags if isScam=true (e.g. typo domain, artificial urgency). MUST be empty array [] if isScam=false.',
        },
        explanation: {
            type: 'string',
            description:
                'Detailed educational debrief explaining why this email is a scam (highlighting traps) or why it is legitimate.',
        },
    },
    required: [
        'senderName',
        'senderEmail',
        'subject',
        'body',
        'isScam',
        'category',
        'difficulty',
        'redFlags',
        'explanation',
    ],
};

export async function generateEmail(options?: {
    isScam?: boolean;
    difficulty?: DifficultyLevel;
    category?: ScamCategory;
    user?: User;
}): Promise<GeneratedEmail> {
    const user = options?.user;
    const difficulty = options?.difficulty || user?.currentDifficulty || 'intermediate';
    const category = options?.category || (user?.vulnerabilityProfile.weakCategories[0]) || 'account_security';
    const categoryClause = `in category "${category}"`;

    let isScamDirective: string;
    if (options?.isScam === true) {
        isScamDirective = 'The email MUST be a SCAM / PHISHING EMAIL (isScam: true).';
    } else if (options?.isScam === false) {
        isScamDirective = 'The email MUST be 100% LEGITIMATE and authentic (isScam: false).';
    } else {
        isScamDirective = 'Decide randomly whether this email is a SCAM (50% probability) or LEGITIMATE (50% probability).';
    }

    if (!client || !apiKey) {
        console.warn(
            '[Gemini] Notice: GEMINI_API_KEY is not set. Returning a sample email. Set GEMINI_API_KEY in backend/.env for live AI generation.'
        );
        return getOfflineSample(options?.isScam ?? true, user);
    }

    const userPersonaContext = user
        ? `
TARGET RECIPIENT PERSONA (Personalization):
- Recipient Name: ${user.name}
- Job Role / Department: ${user.role || 'Employee'}
- Organization: ${user.company || 'Company'}
- Recipient Skill Level: ${user.currentDifficulty}
${user.vulnerabilityProfile.weakCategories.length > 0 ? `- Demonstrated Weak Areas: ${user.vulnerabilityProfile.weakCategories.join(', ')}` : ''}
Address the email to the recipient or tailor the pretext (e.g. role-relevant requests for workplace/banking) to match this persona.
`
        : '';

    const prompt = `
You are a cybersecurity training scenario generator.
Generate a realistic simulated email for an educational phishing awareness game ${categoryClause}.

CRITICAL CONSTRAINT:
${isScamDirective}
Target Difficulty: ${difficulty}
${userPersonaContext}

RULES:
1. If isScam is true:
   - Beginner: Blatant errors, generic greeting ("Dear Valued Customer"), extreme urgency, obvious lookalike domain.
   - Intermediate: Believable branding, realistic pretext (package held, suspicious login, invoice), subtle lookalike domain (e.g. netflx-billing-update.com), embedded link asking for verification.
   - Advanced: Highly polished corporate or spear-phishing scenario, near-perfect layout, subtle pretext inconsistency.
   - "redFlags": Array of 2-4 specific clues embedded in the email.
2. If isScam is false:
   - Must be a genuine, benign email (e.g. standard receipt, monthly newsletter, regular account notification).
   - Must use standard authentic sender domain (e.g. no-reply@github.com, receipts@apple.com, support@google.com).
   - "redFlags": MUST be an empty array [].
   - "explanation": Explain the legitimate indicators (authentic domain, standard unsubscribe, no pushy panic).
`;

    try {
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API call timed out after 8s.')), 8000)
        );

        const apiPromise = client.interactions.create({
            model: 'gemini-3.8-flash',
            input: prompt,
            response_format: {
                type: 'text',
                mime_type: 'application/json',
                schema: emailJsonSchema,
            },
        });

        const interaction = await Promise.race([apiPromise, timeoutPromise]);

        let raw = interaction.output_text?.trim() || '{}';
        if (raw.startsWith('```')) {
            raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(raw);
        return {
            id: `email_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            ...parsed,
        };
    } catch (err: any) {
        console.warn(
            `[Gemini] Live generation failed (${err.message}). Falling back to simulation sample.`
        );
        return getOfflineSample(options?.isScam ?? true, user);
    }
}

export async function generateInboxBatch(count = 4): Promise<GeneratedEmail[]> {
    const promises = Array.from({ length: count }, (_, index) =>
        generateEmail({
            // Alternate scam and legitimate
            isScam: index % 2 === 0,
            difficulty: 'intermediate',
        })
    );
    return Promise.all(promises);
}

function getOfflineSample(isScam: boolean, user?: User): GeneratedEmail {
    const recipientGreeting = user?.name ? `Hi ${user.name}` : 'Hi Customer';

    if (isScam) {
        return {
            id: `email_${Date.now()}_sample_scam`,
            senderName: 'Netflix Membership Services',
            senderEmail: 'support@netflx-billing-resolve.com',
            subject: 'Urgent: Your subscription is on hold due to billing decline',
            body: `${recipientGreeting},

We were unable to process your most recent monthly payment of $15.49. Your membership will be permanently deactivated within 24 hours unless your payment method is updated immediately.

Please click the secure link below to update your payment details:
https://netflx-billing-resolve.com/auth/verify?id=98412

Thank you,
Netflix Support Team`,
            isScam: true,
            category: 'account_security',
            difficulty: user?.currentDifficulty || 'intermediate',
            redFlags: [
                'Spoofed domain (netflx-billing-resolve.com instead of netflix.com)',
                'Manufactured 24-hour urgency pressure to prevent critical thinking',
                'Unsolicited payment link requesting direct credential and card entry',
            ],
            explanation:
                'This is a phishing scam. The sender uses a lookalike domain "netflx-billing-resolve.com" rather than the official netflix.com, pairs it with an artificial 24-hour threat, and demands credit card verification through an external link.',
        };
    }

    return {
        id: `email_${Date.now()}_sample_legit`,
        senderName: 'GitHub',
        senderEmail: 'noreply@github.com',
        subject: '[GitHub] A personal access token has expired',
        body: `${user?.name ? `Hi ${user.name}` : 'Hi Developer'},

Your personal access token "stormhacks-deploy" expired on October 3, 2026.

To generate a new token or review existing tokens, visit your account settings:
https://github.com/settings/tokens

If you no longer need this token, you do not need to take any action.

Thanks,
The GitHub Team`,
        isScam: false,
        category: 'account_security',
        difficulty: user?.currentDifficulty || 'intermediate',
        redFlags: [],
        explanation:
            'This is a legitimate email. The sender domain is verified (@github.com), links point directly to the authentic github.com domain, there are no panic-inducing threats, and it gives the option to take no action.',
    };
}

export interface GenerateCallScenarioOptions {
    difficulty?: 1 | 2 | 3 | DifficultyLevel;
    category?: ScamCategory;
    tactics?: Tactic[];
    targetObjective?: 'otp' | 'payment_info' | 'personal_info' | 'remote_access' | 'action';
    user?: User;
    voiceId?: string;
}

const callScenarioJsonSchema = {
    type: 'object',
    properties: {
        title: {
            type: 'string',
            description:
                'Short, descriptive title of the call scam scenario (e.g. "Fake bank fraud alert requests OTP", "Urgent IT helpdesk password reset").',
        },
        tactics: {
            type: 'array',
            items: {
                type: 'string',
                enum: ['urgency', 'authority', 'suspicious_link', 'otp_request', 'info_request', 'reward', 'fear'],
            },
            description:
                'Social engineering tactics used during the call. Must contain between 1 and 4 applicable tactics from the enum.',
        },
        difficulty: {
            type: 'integer',
            enum: [1, 2, 3],
            description:
                '1 for beginner (obvious clues, pushy), 2 for intermediate (realistic pretext, professional tone), 3 for advanced (spear-phishing, highly nuanced pretext).',
        },
        callerLabel: {
            type: 'string',
            description:
                'Name or fake number displayed on the simulated incoming call UI (e.g. "Maple Trust Bank - Fraud Dept", "Corporate IT Support", "+1 (888) 555-0149").',
        },
        systemPrompt: {
            type: 'string',
            description:
                'Detailed instructions and persona for the ElevenLabs voice agent. Define: 1) Persona/Name; 2) Pretext; 3) Primary objective/extraction goal (e.g. get the user to read out the 6-digit OTP code sent to their phone, share last 4 digits of SSN, or agree to wire funds); 4) Push tactics / objection handling when user hesitates or questions caller legitimacy.',
        },
        firstMessage: {
            type: 'string',
            description:
                'The opening greeting spoken aloud immediately when the user answers the call. Must sound conversational, professional, and establish the pretext immediately.',
        },
    },
    required: ['title', 'tactics', 'difficulty', 'callerLabel', 'systemPrompt', 'firstMessage'],
};

function resolveCallDifficulty(diff?: 1 | 2 | 3 | DifficultyLevel): 1 | 2 | 3 {
    if (diff === 1 || diff === 2 || diff === 3) return diff;
    if (diff === 'beginner') return 1;
    if (diff === 'advanced') return 3;
    return 2;
}

export async function generateCallScenario(
    options?: GenerateCallScenarioOptions
): Promise<CallScenario> {
    const user = options?.user;
    const difficultyNum = resolveCallDifficulty(options?.difficulty ?? user?.currentDifficulty);
    const category = options?.category || user?.vulnerabilityProfile.weakCategories[0] || 'banking';

    if (!client || !apiKey) {
        console.warn(
            '[Gemini] Notice: GEMINI_API_KEY is not set. Returning a sample call scenario. Set GEMINI_API_KEY in backend/.env for live AI generation.'
        );
        return getOfflineCallScenarioSample(options);
    }

    const userPersonaContext = user
        ? `
TARGET RECIPIENT PERSONA (Personalization):
- Trainee Name: ${user.name}
- Job Title / Role: ${user.role || 'Employee'}
- Organization: ${user.company || 'Company'}
- Prior Weak Areas: ${user.vulnerabilityProfile.weakCategories.join(', ') || 'None specified'}
Tailor the pretext, organization name, and references to suit this target's role.
`
        : '';

    const targetObjectiveDirective = options?.targetObjective
        ? `PRIMARY EXTRACTION GOAL: The scammer must specifically try to get the victim to comply with: ${options.targetObjective}.`
        : '';

    const tacticsDirective =
        options?.tactics && options.tactics.length > 0
            ? `MANDATORY TACTICS TO EMBED: ${options.tactics.join(', ')}.`
            : '';

    const prompt = `
You are a cybersecurity training scenario generator specializing in phone call scams (vishing / voice phishing).
Generate a realistic phone call scam scenario in category "${category}" that fits the comms voice simulation engine.

TARGET DIFFICULTY LEVEL: ${difficultyNum} (1=beginner, 2=intermediate, 3=advanced)
${targetObjectiveDirective}
${tacticsDirective}
${userPersonaContext}

SPECIFICATION RULES:
1. "callerLabel":
   - Realistic name or phone display shown on the incoming call UI (e.g. "Maple Trust Bank - Fraud Dept", "IT Helpdesk Dispatch", "FedEx Security").
2. "firstMessage":
   - The exact opening line spoken aloud as soon as the user picks up the call.
   - Keep it natural, courteous, and immediately establish the pretext without sounding robotic.
3. "systemPrompt":
   - Detailed instructions for the ElevenLabs voice AI acting as the scam caller.
   - Describe who they are, their speaking demeanor (calm, authoritative, or urgent), the specific pretext (e.g. a fraudulent $842 charge, urgent MFA migration), and what specific confidential data or action they are trying to elicit from the victim (such as reading back an SMS verification OTP, sharing credentials, or wiring money).
   - Detail how they handle objections: if the user hesitates or asks to call back, how the caller creates urgency, references policy, or offers fake reassurance.
4. "tactics":
   - Array of 1 to 4 applicable tactics from: ['urgency', 'authority', 'suspicious_link', 'otp_request', 'info_request', 'reward', 'fear'].
5. "difficulty": Must be ${difficultyNum}.
`;

    try {
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API call timed out after 8s.')), 8000)
        );

        const apiPromise = client.interactions.create({
            model: 'gemini-3.8-flash',
            input: prompt,
            response_format: {
                type: 'text',
                mime_type: 'application/json',
                schema: callScenarioJsonSchema,
            },
        });

        const interaction = await Promise.race([apiPromise, timeoutPromise]);
        let raw = interaction.output_text?.trim() || '{}';
        if (raw.startsWith('```')) {
            raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(raw);
        const scenarioId = `call-${category}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

        const candidate = {
            id: scenarioId,
            title: parsed.title,
            tactics: parsed.tactics,
            difficulty: difficultyNum,
            callerLabel: parsed.callerLabel,
            systemPrompt: parsed.systemPrompt,
            firstMessage: parsed.firstMessage,
            ...(options?.voiceId || parsed.voiceId ? { voiceId: options?.voiceId || parsed.voiceId } : {}),
        };

        return CallScenario.parse(candidate);
    } catch (err: any) {
        console.warn(
            `[Gemini] Live call scenario generation failed (${err.message}). Falling back to simulation sample.`
        );
        return getOfflineCallScenarioSample(options);
    }
}

export function getOfflineCallScenarioSample(options?: GenerateCallScenarioOptions): CallScenario {
    const user = options?.user;
    const category = options?.category || user?.vulnerabilityProfile.weakCategories[0] || 'banking';
    const difficulty = resolveCallDifficulty(options?.difficulty ?? user?.currentDifficulty);

    if (category === 'workplace') {
        const companyName = user?.company || 'Corporate';
        return CallScenario.parse({
            id: `call-workplace-${Date.now()}`,
            title: 'Urgent IT Helpdesk SSO & MFA Re-sync',
            tactics: ['authority', 'urgency', 'otp_request', 'info_request'],
            difficulty,
            callerLabel: `${companyName} IT Helpdesk`,
            systemPrompt: `You are Sarah, an IT systems engineer from ${companyName} Infrastructure Support.
Tell the employee (${user?.name || 'the recipient'}) that an emergency single-sign-on (SSO) certificate upgrade requires synchronizing their multi-factor authentication (MFA) credentials immediately to avoid a full account lockout.
Sound professional, slightly hurried, and helpful. Your goal is to get them to confirm their corporate login and read back the 6-digit MFA push code they receive.
If they hesitate, warn them that the migration window closes in 10 minutes and manual reactivation takes up to 48 hours with manager escalation.`,
            firstMessage: `Hi ${user?.name ? user.name : 'there'}, this is Sarah from ${companyName} IT Support. We're performing an emergency SSO token sync before the maintenance window closes. Can you confirm your employee ID?`,
            ...(options?.voiceId ? { voiceId: options.voiceId } : {}),
        });
    }

    if (category === 'shipping') {
        return CallScenario.parse({
            id: `call-shipping-${Date.now()}`,
            title: 'Express Delivery Address & Customs Clearance',
            tactics: ['urgency', 'authority', 'info_request'],
            difficulty,
            callerLabel: 'Apex Express Logistics',
            systemPrompt: `You are Marcus from Apex Express Logistics customs and dispatch division.
Tell the customer a high-priority international parcel registered to their address is held at the regional distribution depot due to an incomplete delivery address and an outstanding $4.25 customs handling fee.
Sound polite, structured, and informative. Your goal is to get them to confirm their home address and credit card billing details to release the shipment today.
If they hesitate, remind them the parcel will be returned to the international sender tomorrow morning with a $50 return processing penalty.`,
            firstMessage:
                "Hello, this is Marcus calling from Apex Express Logistics dispatch. I'm trying to reach the recipient for tracking order AX-99214 regarding a time-sensitive delivery.",
            ...(options?.voiceId ? { voiceId: options.voiceId } : {}),
        });
    }

    return CallScenario.parse({
        id: `call-bank-${Date.now()}`,
        title: 'Fake fraud department asks for verification code',
        tactics: ['authority', 'urgency', 'fear', 'otp_request'],
        difficulty,
        callerLabel: 'Maple Trust Bank - Fraud Dept',
        systemPrompt: `You are Daniel, calling from the Maple Trust Bank fraud prevention team.
Tell the person a suspicious $842.17 purchase at an electronics retailer was just flagged on their debit card.
Sound calm, professional, and protective. Your goal is to get them to read back the 6-digit verification code 'we just texted them' so you can cancel the transaction and secure their account.
If they hesitate, add urgency: emphasize that the transaction will settle within minutes and the bank cannot guarantee a refund afterwards.
If they offer to hang up and call back, discourage it by explaining that the central phone queue has a 45-minute wait time during which the funds will be lost.`,
        firstMessage:
            "Hello, this is Daniel from the Maple Trust Bank fraud prevention team. We've just flagged a suspicious charge on your card. Do you have a moment to confirm a few details?",
        ...(options?.voiceId ? { voiceId: options.voiceId } : {}),
    });
}

export async function startCommsCallSimulation(
    commsBaseUrl: string,
    userId: string,
    scenario: CallScenario
): Promise<{ callId: string; callerLabel: string; call: unknown }> {
    const response = await fetch(`${commsBaseUrl.replace(/\/$/, '')}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, scenario }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start comms call (${response.status}): ${errorText}`);
    }

    return (await response.json()) as { callId: string; callerLabel: string; call: unknown };
}

