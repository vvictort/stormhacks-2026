# Tellio frontend

A responsive authentication experience for Tellio, a scam-awareness training web app. Built with the existing React, TypeScript, Vite, Tailwind CSS, React Router, and Firebase setup.

## Development

```sh
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` with the values from the Firebase console (Project settings → Your apps → Web app). `.env` is git-ignored; never commit it. For a deployed build, set the same `VITE_FIREBASE_*` variables in the host's build environment. The app throws on startup, naming any missing variable.

Open the Vite URL using **localhost**. The configured Firebase project's authorized domains currently include `localhost`, `stormhacks-2026.firebaseapp.com`, and `stormhacks-2026.web.app`. The IP address `127.0.0.1` is not currently authorized for Google sign-in.

```sh
npm run build
npm run lint
npm test
```

The dependency-free unit tests use Node's built-in test runner and TypeScript stripping (Node 22.18+). No additional runtime packages were introduced for the redesign.

## Routes and behavior

- `/login`: email/password login, Google sign-in, and an accessible password-reset dialog.
- `/signup`: name, email, password, confirmation, and Google sign-up.
- `/` and unknown routes redirect to `/login`.
- Existing or newly authenticated users see a signed-in confirmation with sign-out. There is no dashboard or onboarding yet.
- The layout uses two columns on desktop and a single auth card below 960px. The original semantic palette is preserved, with darker companion tokens for accessible text and controls.

## Authentication integration

`src/lib/firebase.ts` owns the Firebase app and Auth instance, configured from `VITE_FIREBASE_*` environment variables. `src/features/auth/service.ts` owns provider operations, and `src/features/auth/AuthProvider.tsx` exposes session state and pending/error states to the forms. The auth-state subscription is cleaned up on unmount; Firebase manages session persistence.

Email/password registration checks Firebase's current password policy, creates the account, and saves the supplied name with `updateProfile`. The interface requires at least eight characters; a stricter Firebase policy is also enforced and explained inline. Login accepts existing passwords without imposing the new-account minimum. Password whitespace is preserved.

Account creation and display-name saving have separate outcomes. If the account is created but saving the name fails, the user remains signed in and sees a warning. Retrying account creation is not offered.

Google authentication uses `GoogleAuthProvider` and `signInWithPopup` from the same Firebase instance. Both Google buttons share the same flow. Blocked/cancelled popups and provider errors receive friendly messages.

Password recovery uses `sendPasswordResetEmail` and Firebase's hosted reset handler. The confirmation is identical for existing and unknown accounts. No password, ID token, or credential is manually written to application storage or logs.

## Firebase Console checks before release

The client initialization and public project settings were verified. The public configuration confirms authorized domains and a six-character minimum (the Tellio interface deliberately requires eight). Public client configuration does not expose whether individual sign-in providers are enabled.

Confirm these settings in the existing project:

1. Authentication → Sign-in method: enable **Email/Password** and **Google**, including the Google support email.
2. Authentication → Settings → Authorized domains: add any additional deployed hostnames. Use `localhost` during development, or explicitly authorize other development hosts.
3. Authentication → Templates: review the password-reset email branding and hosted action flow for Tellio.
4. Keep password policy settings aligned with the desired experience. The signup form also validates stricter project requirements.

Live Google OAuth, delivery of password-reset emails, and live account creation still require a provider smoke test. Automated browser checks used intercepted Firebase responses and did not create production accounts or send emails.

Reference: [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [password authentication](https://firebase.google.com/docs/auth/web/password-auth), and [user management](https://firebase.google.com/docs/auth/web/manage-users).

When deploying to a static host, rewrite application routes to `index.html` so direct visits and refreshes at `/login` and `/signup` work.

## Verification

The unit suite covers required fields, email format, signup password requirements, significant password whitespace, credential-error privacy, and friendly provider/password-policy messages.

Browser checks cover:

- Root/fallback redirects, direct page loads, route focus, keyboard navigation, password visibility, and invalid-field focus.
- Pending controls, successful email/password authentication, restored sessions, sign-out, Firebase errors, and name saving.
- Profile-save failures after successful account creation and stricter Firebase password policies.
- Password-reset dialog focus trapping, Escape dismissal, focus restoration, and neutral unknown-account results.
- Google success/cancelled/blocked states using a test double; the real OAuth popup remains a live smoke test.
- Login and signup at 320, 390, 768, 1024, and 1440px, 200% zoom, and automated WCAG A/AA accessibility scans.

## Project structure

```
src/
  main.tsx, App.tsx, index.css   entry, routes, global styles and tokens
  lib/firebase.ts                Firebase app, Auth instance, lazy Analytics
  pages/                         one component per route
  features/
    auth/
      service.ts                 Firebase Auth operations
      AuthContext.ts, AuthProvider.tsx   session state for the UI
      errors.ts, validation.ts   pure helpers (covered by tests/auth.test.mjs)
      components/                auth layout, card, fields, dialogs
```

New product areas (for example the simulated phone) go in their own `features/<name>/` folder with the same shape.
