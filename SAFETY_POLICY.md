# OurRealm — Safety & Reporting Policy

**Effective date:** February 18, 2026
**Version:** 2026-02-18

> **OurRealm uses a reasonable-efforts approach to moderation. Not all content is reviewed proactively, and no automated system is perfect.**

We do **not** guarantee response times. We do **not** guarantee that every report will be reviewed by a human.

## Available report categories
- Spam or Scam
- Harassment or Bullying
- Hate or Threats
- Sexual or Explicit Content
- Self-Harm Concerns
- Impersonation
- Privacy Violation
- Other

## Where you can report
Reports can be filed against posts, comments, replies, profiles, direct messages, and any uploaded media (images, video, sounds).

## Reporting workflow
1. Tap **Report** on the content. Choose a reason and (optionally) add detail or up to 8 screenshots.
2. The report enters a unified moderation queue alongside automated scanner findings (background rescans run every 5 minutes).
3. An admin reviews the item and chooses **Approve**, **Hide**, **Restore**, **Delete**, or **Ban User**.
4. Counts on the admin dashboard update through the existing realtime infrastructure (no new pollers).

## Risk scoring overview
OurRealm uses a small deterministic heuristic — **no machine learning models**. Allowed signals: report count, keyword matches, regex matches, URL detection, repeat offenses.

| Tier        | Action                                  |
|-------------|-----------------------------------------|
| Low risk    | `approved`                              |
| Medium risk | `pending_review` (visible in queue)     |
| High risk   | `hidden` pending admin review           |

Automation **never bans a user** on its own.

## Moderation statuses
- **approved** — visible.
- **pending_review** — awaiting admin action.
- **hidden** — automatically hidden pending admin review.

## User-facing notices
Only two notices are surfaced to end-users on actioned content:
- _"This content is under review."_
- _"This content was removed for violating Community Standards."_

Internal scanner rules, keywords, regex patterns, and detection logic are never disclosed.

## Admin access to private messages
Admins do **not** read direct messages by default. The ticket-detail endpoint returns only report metadata (reason, screenshots the reporter uploaded, message id, conversation id) — never the message body. Direct access to message contents is limited to messages that have been reported or where required for an active support/moderation case.

## Media moderation
Uploaded media is validated only for file type, file size, duration, and suspicious filenames. OurRealm does **not** automatically detect nudity, violence, illegal imagery, or harmful audio. Discovery of such content relies on user reports.

## Audit log retention
Moderation audit logs are retained for up to **90 days** unless needed for active investigation. Internal webhook event logs are retained for up to **30 days**.

## Urgent safety
safety@ourrealm.social. If you or someone else is in immediate danger, contact local emergency services.
