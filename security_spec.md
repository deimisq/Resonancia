# Security Specification & Invariants — Resonancia

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document under `/users/{userId}`, `/users/{userId}/private/info`, and `/users/{userId}/takes/{takeId}` belongs strictly to `request.auth.uid == userId` with `request.auth.token.email_verified == true`.
2. **PII Separation**: Email addresses are stored exclusively in `/users/{userId}/private/info`, never in `/users/{userId}` or `/takes/{takeId}`.
3. **Zero Raw API Key Persistence**: Users' personal Gemini API keys are NEVER written to Firestore or stored in plain text in any database collection.
4. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, and `createdAt` cannot be modified after creation; `createdAt` and `updatedAt` must equal `request.time`.
5. **Bounded Payloads**: Every string field enforces strict `.size()` limits matching `firebase-blueprint.json`, preventing oversized document poisoning.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/{uid}`.
2. Authenticated user A reading `/users/{uidB}/private/info`.
3. Authenticated user A listing `/users/{uidB}/takes`.
4. User with `email_verified == false` creating a profile or take.
5. Creating `/users/{uidA}` with `uid: "{uidB}"` (identity spoofing).
6. Creating `/users/{uidA}/takes/{takeId}` with `ownerId: "{uidB}"`.
7. Shadow field injection (`isAdmin: true`, `apiKey: "AIza..."`) on `create` or `update`.
8. Modifying `createdAt` or `ownerId` during a take update.
9. Supplying a client-forged timestamp instead of `request.time`.
10. Poisoning document ID with invalid characters or >128 bytes (`/users/{uid}/takes/bad$id`).
11. Poisoning `scriptText` with >15,000 characters or `title` with empty string.
12. Creating `/users/{uid}/private/arbitraryDoc` instead of `info`.
