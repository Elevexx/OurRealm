# OurRealm — Legal & Policy Changelog

## 2026-02-18 — Phase α policy refresh

**Version bump:** `2026-02-1` → `2026-02-18`
**Effective date:** February 18, 2026
**Scope:** Synchronized every legal / compliance document with the platform's actual capabilities, removed contradictory or aspirational language, and added the missing policy pages required for a beta social product.

### New sections added
- **Beta notice** on every policy page (top callout): "OurRealm is a beta platform … 'as is' and 'as available'."
- **Reasonable-efforts moderation** statement added to Terms of Service, Community Standards, and Safety policy.
- **Vendor inventory** section added to Privacy Policy (Hosting & infrastructure, Database services, Authentication, Storage, Realtime/messaging, Analytics, Email delivery, Customer support, Payment processing — **payment processing marked NOT active**).
- **Detailed data-collection categories** added to Privacy Policy: account, username/profile, user-generated content, messages, media uploads, support tickets, device info, browser info, IP, approximate location, usage analytics, crash logs, security logs, moderation logs, report data, cookies/sessions.
- **Retention practices** spelled out: user accounts, messages, support tickets, moderation audit logs (90 days), security logs, internal webhook logs (30 days).
- **Repeat Infringer Policy** added as its own subsection of the DMCA page.
- **Admin access to private messages** policy: admins do not read DMs unless the message was reported or it is required for an active support/moderation case.

### New policy pages
| Route | Page | Markdown |
|-------|------|----------|
| `/community` | Community Standards | `COMMUNITY_STANDARDS.md` |
| `/dmca`, `/copyright` | Copyright & DMCA (incl. Repeat Infringer) | `DMCA_POLICY.md` |
| `/safety` | Safety & Reporting | `SAFETY_POLICY.md` |
| `/cookies` | Cookie & Tracking Notice | (in-app only) |
| `/account-deletion` | Account Deletion Policy | (in-app only) |

### Policies updated
- **Terms of Service** — eligibility (13+), wallet inactive section, beta/availability "as is", media validation scope, friend-only messaging, no-end-to-end-encryption disclaimer, limitation of liability cap ($100), indemnity clause.
- **Terms & Conditions** — de-duplicated from ToS; now scoped to community rules + monetization (inactive) + reporting / DMCA pointers.
- **Privacy Policy** — full rewrite per data categories listed above; vendor inventory; GDPR + CCPA/CPRA rights; legal disclosures section; international-transfers section.

### Contradictions removed
- Removed wallet/monetization legal language that previously implied an active payment processor; marked **inactive**.
- Removed legacy "encryption in transit and at rest" claim that overstated scope — now only **encryption in transit**.
- Removed open-ended "we share with payment processors" — now explicitly **not currently active**.
- Removed the prior "we will explain the reason and offer an appeal" guarantee on enforcement — replaced with "where possible we will explain the reason" to match actual capability.
- Removed phrasing implying immediate or irreversible deletion — now states "we do not claim immediate or irreversible deletion."

### Features reflected (now mirrored in policy text)
- Account creation flow (email + password + OTP), 13+ age confirmation, multi-checkbox compliance gate.
- Friend-only direct messaging with two-sided friend handshake.
- Presence indicators (online, messenger, invisible, live placeholder) — described as best-effort.
- Content surfaces — text, image, video, sound, comments, reactions, hashtags, interests, saved, shares, Groups, Realms.
- Moderation system — unified queue, reasonable-efforts, keyword/regex/URL scanner, 5-minute rescans, lightweight risk scoring, admin actions (Approve, Hide, Restore, Delete, Ban User), support tickets, admin analytics dashboard.
- Admin role model (Phase α) — founder, support_admin, moderator; admins cannot read DMs unless reported.
- Media validation — file type / size / duration / suspicious filename only; no automatic detection claims.
- Wallet — read-only placeholder, all financial features inactive.
- Embedded third-party content — YouTube and similar may appear; subject to third-party terms.

### Signup compliance gate (already enforced)
The existing signup flow on `/signup` requires all four acknowledgements before submission:
1. Terms of Service
2. Terms & Conditions
3. Privacy Policy
4. ≥ 13 years old (COPPA)

On successful registration the backend persists:
- `compliance.accepted_terms`, `accepted_privacy`, `accepted_conditions`, `age_confirmed_13`
- `compliance.policy_version` (default updated to `"2026-02-18"`)
- `compliance.accepted_at` (ISO timestamp)

No behaviour change — only the **default policy version constant** was bumped.

### Files touched
- `frontend/src/pages/LegalPages.jsx` — full rewrite + 5 new exported page components (`CommunityStandardsPage`, `DMCAPolicyPage`, `SafetyPolicyPage`, `CookieNoticePage`, `AccountDeletionPage`).
- `frontend/src/App.js` — added 6 new routes: `/community`, `/dmca`, `/copyright`, `/safety`, `/cookies`, `/account-deletion`.
- `backend/routers/auth.py` — default `policy_version` literal bumped to `"2026-02-18"`.
- New markdown docs at `/app/`: `TERMS_OF_SERVICE.md`, `PRIVACY_POLICY.md`, `COMMUNITY_STANDARDS.md`, `DMCA_POLICY.md`, `SAFETY_POLICY.md`.

### Unchanged on purpose
- Existing visual styling, layout, colours, and animations — every page uses the existing `LegalShell` + `Section` primitives.
- Existing app functionality and route map (only additions).
- Existing endpoints — all backward compatible.
- Existing FAQ, email templates, and app-store metadata — left untouched (none reference legal language directly today; future updates can pull verbatim from the new markdown files).
- The `policy_version` field is still client-controlled (defaults are server-side only) so older clients keep working.

### Remaining items requiring attorney review
This refresh aligns documents with actual platform behaviour; it is **not** a legal-review pass. Before any public marketing push or paid feature launch, an attorney should review:

1. **Jurisdiction / governing law clause** — currently omitted; add appropriate state + dispute-resolution language for the company's home jurisdiction.
2. **Mandatory arbitration / class-action waiver** — none today; legal counsel should advise.
3. **EU representative** under GDPR Article 27 (if the platform actively markets in the EU).
4. **California "Do Not Sell or Share" link** — confirm wording and placement once CCPA/CPRA enforcement posture is finalized.
5. **Designated DMCA agent registration** with the U.S. Copyright Office (required to claim full safe-harbor protection).
6. **Children & teen safety operational playbook** — beyond COPPA confirmation, finalize internal procedures for handling underage discovery and parental requests.
7. **Wallet / monetization terms** — must be drafted before payment processing is activated.
8. **App store privacy labels** — re-confirm against final vendor list when shipping to iOS / Android stores.
9. **Cookie consent banner** — required by EU ePrivacy / UK PECR before non-essential trackers load (currently the Cookie Notice describes behaviour but no consent UI exists yet).
10. **Operational playbook for legal requests** — subpoenas, court orders, search warrants, preservation requests, emergency disclosure — referenced in the Privacy Policy but kept internal; counsel should finalize the SOP.
