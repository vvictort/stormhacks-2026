import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apiKey = process.env.GEMINI_API_KEY || '';
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

import type { User, DifficultyLevel, ScamCategory } from '../models/user.js';

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

// Structured JSON schema for Gemini response format
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

/**
 * Generate a single email classified as either scam or legitimate
 */
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

    // If no Gemini API key is configured, return a realistic offline mock sample
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

/**
 * Generate a batch of mixed emails (e.g. for an inbox simulation view)
 */
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

// Fallback sample generator if API key is not yet set
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
