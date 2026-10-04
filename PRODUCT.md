# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals training themselves. One person signs up and practises spotting scams, alone and at their own pace. There are no caregiver, admin or organisation audiences.

For the StormHacks 2026 demo, hackathon judges are a second, temporary audience. They see the product in a short, guided walkthrough.

## Product Purpose

Tellio builds a person's instinct for spotting scams through realistic, hands-on practice instead of reading or quizzes. Success means the person catches scams they used to miss, and their progress shows it over time.

## Positioning

The scams play out on a simulated phone built into the browser. Scam texts, phishing emails and AI-voiced scam calls arrive on it the way they would on a real device. The person reacts to them as they would on their own phone, but nothing real is ever at risk. Scenario and difficulty adapt to how that person has handled earlier simulations.

## Operating Context

- Everything runs in the web app. No real SMS, email or calls reach the user's own devices.
- The simulated phone has three channels: SMS (messaging app), email (mail app) and voice calls (AI voice).
- Planned backend services: Gemini picks and writes scenarios, ElevenLabs voices the calls, and a Python personalization engine chooses scenario and difficulty from the person's history (`backend/personalization/`). Twilio is in the scaffold, but the in-browser simulation makes real delivery unnecessary for the demo.
- Firebase Auth handles accounts (email/password and Google). Sign-in, sign-up and password reset are built. After sign-in, the user currently sees only a "coming soon" confirmation.

## Capabilities and Constraints

- Confirmed: SMS, email and voice simulations on the in-browser phone; adaptive difficulty; progress tracking over time.
- After each simulation: a short debrief shows the red flags in that scenario, then the person moves straight on to the next one. It's a quick reveal-and-continue, not a long lesson.
- Scope: hackathon demo. A polished end-to-end demo flow matters more than production depth.
- Stack in place: React 19, TypeScript, Vite, Tailwind CSS 4, React Router, Firebase, `motion`, `lucide-react`. The backend is a TypeScript API plus a Python personalization service, scaffolded but not yet implemented.
- Vocabulary in the codebase: campaign, attempt, message, event, scenario, difficulty.

## Brand Commitments

- Name: **Tellio**.
- Voice: warm and plain-spoken, never fear-driven. Say what the product does in concrete terms instead of slogans ("Tellio sends scam texts, emails and calls to a practice phone in your browser…"). The one kept tagline is "A little practice. A sharper instinct." This is how the current copy reads. The user has not explicitly bound it as a rule.

## Evidence on Hand

- No testimonials, user data, statistics or press. Future work must not invent figures about scam losses, user counts or results.
- Built: the auth flow (`frontend/src/pages/`, `frontend/src/features/auth/`), presented as an app screen (the signed-in app's bar plus one centred form column) with Tell, the speech-bubble mascot (`frontend/src/components/Mascot.tsx`).

## Product Principles

1. **Practice, not lectures.** People learn by handling realistic scams themselves. Explanations support the practice and never replace it.
2. **Realistic but safe.** Simulations must feel like a real phone, but nothing ever leaves the browser or touches real accounts.
3. **Meet people where they are.** Difficulty follows each person's history, so every scenario stretches them without overwhelming them.
4. **Visible growth.** Progress over time is part of the product, not an afterthought.
5. **Demo-ready first.** For StormHacks, one complete, convincing loop beats breadth.

## Accessibility & Inclusion

The existing auth screens were checked against WCAG 2.x A/AA with automated scans, keyboard navigation and focus management, 200% zoom, and widths from 320 to 1440px. New surfaces should meet the same bar, including the simulated phone and voice calls (which will need captions or a text alternative).
