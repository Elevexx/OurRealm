# OurRealm — Moderation Guidelines (Phase α)

> **OurRealm uses a reasonable-efforts approach to moderation. Not all content is reviewed proactively, and no automated system is perfect.**

This document is the internal reference for how moderation, reporting, support, and the underlying systems behave on OurRealm. It is intentionally light: the platform is early-stage and operates under a reasonable-efforts model — there are no SLAs, no legal promises, and no automated detection of every harmful pattern.

---

## 1. How users report content

Users can report any of the following surfaces from the in-app **Report** button (universal across the product):

- Posts
- Comments (and replies)
- Profiles
- Direct messages
- Media (images, video, audio)

When reporting, users pick one of the standard reasons:

| Reason key            | Display label                 |
|-----------------------|-------------------------------|
| `spam`                | Spam or Scam                  |
| `harassment`          | Harassment or Bullying        |
| `hate_speech`         | Hate or Threats               |
| `sexual_content`      | Sexual or Explicit Content    |
| `self_harm`           | Self-Harm Concerns            |
| `impersonation`       | Impersonation                 |
| `privacy_concern`     | Privacy Violation             |
| `other`               | Other                         |

Additional internal reasons may be added by the rule-based scanner.

Submitting a report:

- Always creates a **moderation_item** in the unified queue (`source = user_report`).
- Optionally accepts up to **8 screenshot images** uploaded as evidence.
- Returns the rendered report id and never exposes scanner internals to the reporter.

---

## 2. How admins review reports

The moderation queue (`GET /api/admin/moderation/queue`) is a single feed of items from **both** automation and user reports. Each item carries:

- `source` — `auto_scan` or `user_report`
- `content_type` — post / comment / profile / message / image / video
- `risk_score` — internal heuristic
- `report_count` — number of distinct user reports
- `matched_categories` — internal scanner labels (never user-facing)
- `current_status` — `approved` | `pending_review` | `hidden` | `removed`
- `created_at`, `last_scanned_at`, `reviewed_at`, `reviewed_by`

Admins act on items via `POST /api/admin/moderation/{content_type}/{id}/action` with one of: **Approve**, **Hide**, **Restore**, **Delete**, or **Ban User**. Counts on the dashboard update via existing realtime infrastructure (WebSocket / Supabase) — no new pollers are added.

### Response priorities

OurRealm operates a **reasonable-efforts model**, not an SLA. Internal priority is roughly:

1. Imminent-harm signals (self-harm, threats, illegal content reports)
2. High-risk content (high `risk_score` or multiple distinct reporters)
3. Aged reports with no admin review
4. Auto-scan items pending review

There are no guaranteed response times.

---

## 3. Risk scoring (lightweight)

Scoring is a small, deterministic heuristic — **no machine learning** is used. Allowed signals:

- Report count
- Keyword matches
- Regex matches
- URL detection
- Repeat offences

Bucketing:

| Tier        | Action                                  |
|-------------|-----------------------------------------|
| Low risk    | `approved`                              |
| Medium risk | `pending_review` (visible in the queue) |
| High risk   | `hidden pending admin review`           |

Automation **never bans a user** on its own. Bans are admin-only.

---

## 4. Admin roles & permissions (Phase α)

Three roles, stored on the user doc as `admin_role`:

| Role            | Username    | Granted on                            | Permissions                                    |
|-----------------|-------------|---------------------------------------|------------------------------------------------|
| `founder`       | `@stealth`  | Built-in seed                         | Full platform access                           |
| `support_admin` | `@support`  | Built-in seed                         | Support tickets + moderation only              |
| `moderator`     | Any user    | Server-controlled DB / env promotion  | Moderation queue only                          |

**No UI for promotions yet.** Moderators are promoted via either:

1. Direct MongoDB write, or
2. The `ADMIN_PROMOTE_USERNAMES` env variable, e.g.
   `ADMIN_PROMOTE_USERNAMES=alice:moderator,bob:support_admin`
   Re-parsed on every boot. Removing a username from the list demotes them on next deploy.

The `founder` role is reserved for `@stealth` and **cannot** be granted through env, API, or UI.

### Admin access to private messages

Admins do **not** read private messages by default. The ticket endpoint `GET /api/admin/support/tickets/{id}/report` returns only the report metadata (reason, screenshots the reporter uploaded, message id, conversation id) — never the message body. Direct access to message contents requires either:

- The message was reported (queue contains it), **or**
- It is required for an active support / moderation case.

---

## 5. Unified moderation queue

Both moderation sources feed the same queue (no separate inboxes):

- `source = auto_scan` — from the background scanner running every 5 minutes
- `source = user_report` — from `POST /api/reports`

Every moderation item stores:

```
moderation_id, source, content_id, content_type,
author_user_id, author_username,
report_count, risk_score, matched_categories,
current_status, created_at, last_scanned_at,
reviewed_at, reviewed_by
```

Content is **never duplicated** into the moderation collection — only references.

---

## 6. Dashboard metrics

The Admin Moderation dashboard surfaces four metric cards:

| Metric            | Definition                                          |
|-------------------|-----------------------------------------------------|
| Pending Review    | Items currently awaiting admin action.              |
| Auto-Hidden       | Content hidden by automation.                       |
| Total Reports     | All user-submitted reports (lifetime).              |
| Removed Today     | Content removed in the last 24 hours.               |

Counts refresh through the existing WebSocket / Supabase realtime channels. No new polling services are added.

---

## 7. Queue item display

For each queue item the UI shows:

- Truncated content preview
- Author username
- Content type
- Source badge — **Auto Scan** or **User Report**
- Risk score
- Report count
- Matched categories
- Timestamp
- Current status

Internal scanner keywords, regex patterns, detection logic, and rule weights are **never** surfaced to the UI.

---

## 8. User-facing notices

Only two notices are shown to end-users on hidden / removed content:

- **"This content is under review."**
- **"This content was removed for violating Community Standards."**

No internal moderation rules are ever exposed.

---

## 9. Media moderation

OurRealm performs basic file validation only:

- File type checks
- File size limits
- Duration limits
- Suspicious filename checks

The platform does **not** claim to detect nudity, violence, illegal imagery, or harmful audio automatically. Discovery of such content relies on user reports and admin review.

---

## 10. CSV exports (Phase β)

Authorized admins will be able to export CSV files for:

- Moderation actions
- User reports
- Support tickets
- User analytics
- Hashtag analytics

Exports are **on-demand only** — no background jobs are queued.

---

## 11. Internal webhook events (Phase β)

Internal-only events stored in `db.webhook_events` with a 30-day retention window:

- `moderation.report_created`
- `moderation.content_hidden`
- `moderation.user_banned`
- `ticket.created`
- `ticket.updated`
- `ticket.resolved`

No Slack / Discord / email / external services are integrated.

---

## 12. Support ticket categories (Phase α)

Admins (founder or support_admin) can create, edit, reorder, enable, or disable ticket categories. Defaults seeded on first boot:

- Bug Report
- Safety Concern
- Account Issue
- Feature Request
- Billing
- General Support

Default categories cannot be deleted — only disabled — so the baseline is always recoverable.

Public endpoint `GET /api/tickets/categories` returns enabled categories sorted by `sort_order`.

Admin CRUD endpoints live under `/api/admin/support/categories`.

---

## 13. API readiness — `/api/v1/...`

A versioned alias is exposed alongside every existing endpoint:

```
/api/messages         (canonical, unchanged)
/api/v1/messages      (alias, same handler)
```

Implementation: a single ASGI middleware rewrites `/api/v1/<rest>` → `/api/<rest>` before routing, and tags the response with `X-API-Version: v1`. **Full backward compatibility** is preserved — every existing client and endpoint continues to work without changes.

This prepares OurRealm for future internal API consumers; public API access is **not** enabled.

---

## 14. Audit log

Stored on every admin moderation action:

```
moderation_id, content_id, user_id, admin_id,
action_taken, previous_status, new_status,
timestamp, reason
```

- Retention: 90 days, except for active investigations.
- Not exposed publicly.
- No content duplication.

---

## 15. System limitations

OurRealm explicitly does **not** claim:

- End-to-end encryption
- Perfect moderation
- Automatic detection of all harmful content
- Human review of every report
- Guaranteed response times

This document, the in-product Community Standards page, and the Terms of Service are the canonical sources for what OurRealm does and does not promise.
