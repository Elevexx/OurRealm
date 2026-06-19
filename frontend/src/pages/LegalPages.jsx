/* eslint-disable react/no-unescaped-entities -- Legal copy contains intentional quotes/apostrophes (e.g. "as is", OurRealm's). React renders them correctly; lint rule is noise here. */
import React from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/Logo";

/**
 * OurRealm legal & policy surface.
 *
 * Pages share a single visual shell (LegalShell + Section) so all routes
 * stay consistent with the rest of the product (no new colours, no new
 * layout primitives). Copy is intentionally factual and constrained — it
 * reflects ONLY what the platform actually does today (beta status,
 * reasonable-efforts moderation, inactive wallet, etc.).
 *
 * Pages exported here (added Feb 18 2026):
 *   • TermsOfServicePage     /terms
 *   • TermsConditionsPage    /terms-conditions     (community-rules companion)
 *   • PrivacyPolicyPage      /privacy
 *   • CommunityStandardsPage /community
 *   • DMCAPolicyPage         /dmca                 (incl. Repeat Infringer)
 *   • SafetyPolicyPage       /safety
 *   • CookieNoticePage       /cookies
 *   • AccountDeletionPage    /account-deletion
 */
const EFFECTIVE_DATE = "February 18, 2026";
const POLICY_VERSION = "2026-02-18";
const CONTACT = {
  legal:     "OurRealmSocial@gmail.com",
  privacy:   "OurRealmSocial@gmail.com",
  safety:    "OurRealmSocial@gmail.com",
  copyright: "OurRealmSocial@gmail.com",
  support:   "OurRealmSocial@gmail.com",
};

function LegalShell({ title, subtitle, testid, children }) {
  return (
    <div className="min-h-screen px-4 py-10 sm:py-14" data-testid={testid}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Logo size={40} />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-[0.28em]" style={{ color: "var(--text-muted)" }}>
              OurRealm Legal
            </div>
            <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
            )}
          </div>
          <Link to="/" className="or-btn or-btn-ghost" data-testid="legal-back-home" style={{ padding: "0.5rem 0.8rem", fontSize: "0.8rem" }}>
            ← Back
          </Link>
        </div>
        <div className="or-surface p-6 sm:p-8 text-sm leading-relaxed space-y-5" style={{ color: "var(--text-main)" }}>
          <div className="text-xs flex items-center justify-between flex-wrap gap-2" style={{ color: "var(--text-muted)" }}>
            <span>Effective date: <b style={{ color: "var(--text-main)" }}>{EFFECTIVE_DATE}</b></span>
            <span>Version <b style={{ color: "var(--text-main)" }}>{POLICY_VERSION}</b></span>
          </div>
          <div className="text-xs p-3" style={{ background: "rgba(255,255,255,0.04)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
            <b style={{ color: "var(--text-main)" }}>Beta notice:</b> OurRealm is a beta platform. Features may change, be modified, or be removed without notice. The Service is provided "as is" and "as available."
          </div>
          <div className="space-y-5">{children}</div>
          <div className="text-xs pt-4" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-col)" }}>
            Other policies: {" "}
            <Link to="/terms" className="underline" style={{ color: "var(--primary)" }}>Terms</Link>{" · "}
            <Link to="/terms-conditions" className="underline" style={{ color: "var(--primary)" }}>Conditions</Link>{" · "}
            <Link to="/privacy" className="underline" style={{ color: "var(--primary)" }}>Privacy</Link>{" · "}
            <Link to="/community" className="underline" style={{ color: "var(--primary)" }}>Community Standards</Link>{" · "}
            <Link to="/safety" className="underline" style={{ color: "var(--primary)" }}>Safety</Link>{" · "}
            <Link to="/dmca" className="underline" style={{ color: "var(--primary)" }}>DMCA</Link>{" · "}
            <Link to="/cookies" className="underline" style={{ color: "var(--primary)" }}>Cookies</Link>{" · "}
            <Link to="/account-deletion" className="underline" style={{ color: "var(--primary)" }}>Account Deletion</Link>
            <div className="mt-2">Questions? <a className="underline" href={`mailto:${CONTACT.legal}`} style={{ color: "var(--primary)" }}>{CONTACT.legal}</a></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ heading, children }) {
  return (
    <section>
      <h2 className="text-base sm:text-lg mb-1.5" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
        {heading}
      </h2>
      <div className="text-sm space-y-2" style={{ color: "var(--text-muted)" }}>{children}</div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Terms of Service
// ───────────────────────────────────────────────────────────────────────
export function TermsOfServicePage() {
  return (
    <LegalShell title="Terms of Service" subtitle="Your agreement with OurRealm." testid="page-terms">
      <Section heading="1. Acceptance">
        <p>By creating an OurRealm account or using OurRealm (the "Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service. The Service is currently in beta — features may be added, changed, limited, or removed at any time without notice.</p>
      </Section>

      <Section heading="2. Eligibility">
        <p>You must be at least 13 years old to use OurRealm. If you are between 13 and the age of majority in your jurisdiction, you confirm that a parent or legal guardian has reviewed these Terms with you. We comply with the U.S. Children's Online Privacy Protection Act ("COPPA"). Accounts associated with users under 13 will be removed when discovered.</p>
      </Section>

      <Section heading="3. Your Account">
        <p>You sign up with an email and password and verify your email through a one-time code ("OTP"). You are responsible for keeping your credentials secret and for everything that happens on your account. Notify us promptly of unauthorized use. We may suspend or terminate accounts that violate these Terms or our <Link to="/community" className="underline" style={{ color: "var(--primary)" }}>Community Standards</Link>.</p>
      </Section>

      <Section heading="4. Your Content">
        <p>You keep ownership of the content you create on OurRealm — including text posts, images, video, audio, comments, reactions, hashtags, interests, saved items, shares, and any content shared in Groups or Realms. By posting, you grant OurRealm a worldwide, non-exclusive, royalty-free license to host, store, reproduce, display, transmit, and distribute that content as necessary to operate, secure, moderate, and improve the Service.</p>
        <p>You agree that the content you post does not violate these Terms, the <Link to="/community" className="underline" style={{ color: "var(--primary)" }}>Community Standards</Link>, applicable law, or anyone's rights (including intellectual property and privacy rights).</p>
        <p><b>You are responsible for everything you upload.</b> That includes audio uploads — you must own the rights to any audio you upload, or have permission from the rights holder. Before each sound upload you must check a confirmation box stating that you own or have permission to upload the audio; we store the timestamp and metadata of that confirmation. We may remove audio that is alleged or determined to infringe intellectual property rights, and <b>repeat copyright violations may result in account restrictions or termination</b> under our <Link to="/dmca" className="underline" style={{ color: "var(--primary)" }}>Copyright &amp; DMCA Policy</Link>.</p>
      </Section>

      <Section heading="5. Acceptable Use">
        <p>You will not use the Service to send spam or scams; harass, bully, threaten, or hate-target others; sexually exploit anyone or post content involving the abuse of minors; promote self-harm; impersonate others; violate someone's privacy; infringe copyright or other intellectual property; engage in illegal activity; or scrape, reverse-engineer, or interfere with the Service. Violations may result in content removal, temporary restrictions, account suspension, or account termination at our discretion.</p>
      </Section>

      <Section heading="6. Friends, Messages, Presence">
        <p>Direct messages on OurRealm are friend-only. Adding a friend is a two-sided handshake (request and acceptance). Presence indicators (online, messenger, invisible, live placeholder) reflect a user's chosen visibility — they are best-effort signals and may lag or be unavailable. The Service does <b>not</b> claim end-to-end encryption of messages.</p>
      </Section>

      <Section heading="7. Moderation (Reasonable Efforts)">
        <p>OurRealm uses a reasonable-efforts approach to moderation. Not all content is reviewed proactively, and no automated system is perfect. We combine in-app user reports with lightweight automated scanning (keyword, regex, URL, repeat-offender signals) to populate a unified moderation queue that admin reviewers act on. Admin actions include Approve, Hide, Restore, Delete, and Ban User. We do <b>not</b> guarantee response times, and we do <b>not</b> guarantee that every report will be reviewed by a human.</p>
        <p>For full details see the <Link to="/safety" className="underline" style={{ color: "var(--primary)" }}>Safety & Reporting Policy</Link>.</p>
      </Section>

      <Section heading="8. Media Validation">
        <p>Uploaded media is checked only for file type, file size, duration, and suspicious filenames. OurRealm does <b>not</b> automatically detect nudity, violence, illegal imagery, or harmful audio. Discovery of such content relies on user reports and admin review.</p>
      </Section>

      <Section heading="9. Wallet & Financial Features (Inactive)">
        <p>Wallet functionality in the app is currently <b>disabled</b>. Balances shown are read-only placeholders. Payments, subscriptions, creator payouts, monetization, and any other financial services are <b>not currently active</b>. If these features become available in the future, additional terms will be presented before you can use them.</p>
      </Section>

      <Section heading="10. Third-Party Content & Services">
        <p>The Service may embed or link to third-party content and services (for example, YouTube embeds). Third-party content is subject to the relevant third party's own terms and privacy policies. OurRealm is not responsible for third-party content, services, or practices.</p>
      </Section>

      <Section heading="11. Beta, Availability, Changes">
        <p>OurRealm is in beta. Features may be modified or removed at any time without notice. The Service is provided <b>"as is"</b> and <b>"as available"</b> with no representations or warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, security, or uninterrupted operation. We do <b>not</b> guarantee availability, performance, security, or that the Service will be free of errors or downtime.</p>
      </Section>

      <Section heading="12. Account Termination & Deletion">
        <p>You may delete your account at any time (see the <Link to="/account-deletion" className="underline" style={{ color: "var(--primary)" }}>Account Deletion Policy</Link>). We may suspend or terminate your access if you violate these Terms, if required by law, or if continued service is no longer reasonable. Deleted content may be retained for limited periods for legal compliance, fraud prevention, abuse prevention, and platform security — see the <Link to="/privacy" className="underline" style={{ color: "var(--primary)" }}>Privacy Policy</Link> for retention details.</p>
      </Section>

      <Section heading="13. Limitation of Liability">
        <p>To the maximum extent permitted by law, OurRealm and its affiliates will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, revenue, data, use, goodwill, or other intangible losses, arising out of or relating to your use of the Service. OurRealm's aggregate liability for any claim arising out of or relating to the Service will not exceed one hundred U.S. dollars ($100).</p>
      </Section>

      <Section heading="14. Indemnity">
        <p>You agree to indemnify and hold OurRealm harmless from any claims, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of your use of the Service, your content, your violation of these Terms, or your violation of any law or third-party right.</p>
      </Section>

      <Section heading="15. Changes to These Terms">
        <p>We may update these Terms from time to time. We will post the updated version with a new effective date and version. Continued use of the Service after changes take effect constitutes acceptance.</p>
      </Section>

      <Section heading="16. Contact">
        <p>For questions about these Terms, email <a className="underline" href={`mailto:${CONTACT.legal}`} style={{ color: "var(--primary)" }}>{CONTACT.legal}</a>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Terms & Conditions — kept as the community-rules companion to the
// Terms of Service. Sections that duplicated the ToS verbatim have been
// removed; this page now points to the canonical policy for each topic.
// ───────────────────────────────────────────────────────────────────────
export function TermsConditionsPage() {
  return (
    <LegalShell
      title="Terms & Conditions"
      subtitle="Community rules and service-specific conditions that supplement the Terms of Service."
      testid="page-terms-conditions"
    >
      <Section heading="1. Relationship to the Terms of Service">
        <p>These Terms & Conditions supplement the <Link to="/terms" className="underline" style={{ color: "var(--primary)" }}>Terms of Service</Link>. Where any conflict exists, the Terms of Service control. By using OurRealm, you accept both.</p>
      </Section>

      <Section heading="2. Community Standards">
        <p>All use of OurRealm is subject to the <Link to="/community" className="underline" style={{ color: "var(--primary)" }}>Community Standards</Link>, which prohibit spam, harassment, hate speech, threats, sexual exploitation, content sexualizing minors, self-harm promotion, impersonation, privacy violations, copyright infringement, and illegal activity. Violations may result in content removal, temporary restrictions, account suspension, or account termination.</p>
      </Section>

      <Section heading="3. Authenticity">
        <p>Do not impersonate others. Parody accounts are allowed only when clearly labeled and not designed to deceive.</p>
      </Section>

      <Section heading="4. Intellectual Property & DMCA">
        <p>Do not post content you do not have the rights to share. OurRealm follows the procedures described in our <Link to="/dmca" className="underline" style={{ color: "var(--primary)" }}>Copyright & DMCA Policy</Link>, including the Repeat Infringer Policy described there.</p>
      </Section>

      <Section heading="5. Wallet & Monetization (Inactive)">
        <p>Wallet, payment, subscription, creator-payout, and any other financial features are <b>not currently active</b>. Balances displayed in the app are read-only placeholders. No financial advice is provided. If monetization features later become available, separate terms will be presented before you can use them.</p>
      </Section>

      <Section heading="6. Beta Features">
        <p>Some features are released in beta and may change, break, or be removed without notice. We may collect additional usage and crash telemetry on beta features to improve them.</p>
      </Section>

      <Section heading="7. Reporting & Enforcement">
        <p>Use the in-app report flow to flag posts, comments, profiles, messages, or media. We act on reports using a reasonable-efforts model — see the <Link to="/safety" className="underline" style={{ color: "var(--primary)" }}>Safety & Reporting Policy</Link>. For urgent safety issues, email <a className="underline" href={`mailto:${CONTACT.safety}`} style={{ color: "var(--primary)" }}>{CONTACT.safety}</a>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Privacy Policy
// ───────────────────────────────────────────────────────────────────────
export function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" subtitle="What we collect and how we use it." testid="page-privacy">
      <Section heading="1. Information We Collect">
        <p>We collect the following categories of information when you use OurRealm:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Account information — email address, password hash, signup timestamp, OTP verification records.</li>
          <li>Username and profile information — display name, username, bio, avatar, banner, profile customization, selected interests, mode selection, public links.</li>
          <li>User-generated content — text posts, images, videos, sounds, comments, reactions, hashtags, saved items, shares, and content created in Groups or Realms.</li>
          <li>Messages — direct messages between friends, including support tickets in conversations with <b>@support</b>.</li>
          <li>Media uploads — uploaded images, video, and audio along with file metadata.</li>
          <li>Support tickets — subject, category, status, conversation contents, optional screenshot evidence attached to reports.</li>
          <li>Sound upload rights confirmation — when you upload a sound we store a timestamped record that you confirmed you own or have permission to upload the audio, plus the user id, sound id, app version, and the originating IP / user-agent. This is used internally for moderation and DMCA response.</li>
          <li>Device information — operating system, application version, locale.</li>
          <li>Browser information — user agent, viewport size, browser type and version.</li>
          <li>IP addresses — for security, abuse prevention, and approximate location.</li>
          <li>Approximate location — derived from IP (typically city/region level); we do not collect precise GPS without explicit prompt.</li>
          <li>Usage analytics — pages visited, features used, basic interaction events.</li>
          <li>Crash logs — exception and error reports to diagnose product issues.</li>
          <li>Security logs — sign-in attempts, failed logins, brute-force lockouts, session tokens.</li>
          <li>Moderation logs — actions taken by admins (Approve, Hide, Restore, Delete, Ban User) and associated audit data.</li>
          <li>Report data — user-submitted reports, including reason, optional detail, optional screenshot attachments.</li>
          <li>Cookie and session information — see the <Link to="/cookies" className="underline" style={{ color: "var(--primary)" }}>Cookie & Tracking Notice</Link>.</li>
        </ul>
      </Section>

      <Section heading="2. How We Use Information">
        <p>We use your information to operate, secure, and improve OurRealm; create and maintain your account; deliver friend, messaging, and presence features; personalize your feed based on interests, hashtags, and friends; respond to support tickets; enforce these Terms and our Community Standards; detect, investigate, and prevent abuse, fraud, and security incidents; and comply with legal obligations.</p>
      </Section>

      <Section heading="3. Sharing">
        <p>We do <b>not</b> sell personal information. We share data with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Service providers</b> — vendors required to operate the platform under contractual confidentiality (see the Vendor Inventory below).</li>
          <li><b>Other users</b> — only as you direct (public posts, friends-only posts, custom audiences).</li>
          <li><b>Law enforcement and legal authorities</b> — when required by valid legal process, or to protect users, our rights, our property, or public safety. See section 9 below.</li>
        </ul>
      </Section>

      <Section heading="4. Vendor Inventory">
        <p>We use the following categories of service providers. Specific vendors may change as the product evolves; this section is updated when material changes are made.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Hosting & infrastructure</b> — cloud compute, ingress, and edge networking.</li>
          <li><b>Database services</b> — managed MongoDB for primary data storage.</li>
          <li><b>Authentication</b> — first-party JWT and OTP today; future federated providers may be added with prior notice.</li>
          <li><b>Storage</b> — object and file storage for uploaded media (today: ephemeral pod storage; future: durable cloud object storage).</li>
          <li><b>Realtime / messaging</b> — Supabase Realtime for the unified messenger and online presence channels.</li>
          <li><b>Analytics</b> — first-party in-app analytics today; lightweight third-party analytics may be added with prior notice.</li>
          <li><b>Email delivery</b> — transactional email for OTP, password reset, and security notifications.</li>
          <li><b>Customer support</b> — internal admin ticketing today; future third-party CRM / help-desk may be added with prior notice.</li>
          <li><b>Payment processing</b> — <b>not currently active</b>. No payment processor is engaged at this time.</li>
        </ul>
      </Section>

      <Section heading="5. Children's Privacy (COPPA)">
        <p>OurRealm is not directed to children under 13. We require an age confirmation at signup. If we learn we have collected personal information from a child under 13, we will delete the account and any associated data. Parents or guardians who believe their child has created an account may email <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a>.</p>
      </Section>

      <Section heading="6. Your Rights">
        <p>You can access, edit, and delete most of your information from Account Settings, including deleting your account (see the <Link to="/account-deletion" className="underline" style={{ color: "var(--primary)" }}>Account Deletion Policy</Link>).</p>
        <p><b>GDPR (EU/UK users):</b> You have rights to access, rectify, erase, restrict, and port your data, and to object to certain processing. To exercise these rights, email <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a>.</p>
        <p><b>CCPA / CPRA (California residents):</b> You have rights to know what personal information we collect, request deletion, correct inaccurate information, and opt out of any sale or sharing of personal information. We do not sell personal information.</p>
      </Section>

      <Section heading="7. Data Retention">
        <p>We retain personal information for as long as your account is active and as needed to provide the Service. Specific retention practices:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>User accounts</b> — retained while active; on deletion, the visible profile is removed and the account row is anonymized. Limited records (e.g. for legal compliance or abuse prevention) may persist.</li>
          <li><b>Messages</b> — retained while both participants' accounts exist and the conversation has not been deleted.</li>
          <li><b>Support tickets</b> — retained while the linked account exists; closed tickets may be retained for audit and pattern-detection purposes.</li>
          <li><b>Moderation audit logs</b> — retained for up to <b>90 days</b> unless needed for an active investigation.</li>
          <li><b>Security logs</b> — login attempts, lockouts, and session records are retained for short security windows.</li>
          <li><b>Internal webhook event logs</b> — retained for up to <b>30 days</b> (these are internal-only event records, not external integrations).</li>
        </ul>
        <p>We do <b>not</b> claim immediate or irreversible deletion. Deleted content may be retained for limited periods for legal compliance, fraud prevention, abuse prevention, and platform security.</p>
      </Section>

      <Section heading="8. Security">
        <p>We use industry-standard safeguards including encryption in transit (HTTPS / WSS), hashed passwords, brute-force lockouts, role-based admin permissions, and audit logging on admin actions. No system is perfectly secure; please use a strong unique password and report suspicious activity to <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a>. The Service does not claim end-to-end encryption.</p>
      </Section>

      <Section heading="9. Legal Disclosures">
        <p>We may disclose information when required by law, in response to a valid subpoena, court order, search warrant, or preservation request, or when we believe in good faith disclosure is necessary to protect users, OurRealm's rights or property, or public safety. Our internal procedures for handling such requests are not published.</p>
      </Section>

      <Section heading="10. International Transfers">
        <p>OurRealm may process your information in countries other than the one in which you live. By using the Service, you consent to such transfers consistent with applicable law.</p>
      </Section>

      <Section heading="11. Changes">
        <p>If we make material changes we will post the updated policy with a new effective date and version. Material changes that affect your rights will be highlighted in-app or by email.</p>
      </Section>

      <Section heading="12. Contact">
        <p>Privacy questions: <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Community Standards
// ───────────────────────────────────────────────────────────────────────
export function CommunityStandardsPage() {
  return (
    <LegalShell title="Community Standards" subtitle="What we expect from everyone on OurRealm." testid="page-community">
      <Section heading="Our standards in one sentence">
        <p>Be authentic, be kind, and don't post content that endangers, exploits, deceives, or harasses others.</p>
      </Section>

      <Section heading="Prohibited content & conduct">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Spam & scams</b> — deceptive, fraudulent, or repetitive content; phishing; financial scams.</li>
          <li><b>Harassment & bullying</b> — targeting, dogpiling, or repeated unwanted contact.</li>
          <li><b>Hate speech & threats</b> — attacks based on identity (race, ethnicity, national origin, religion, caste, sex, gender, sexual orientation, disability, etc.); threats of violence.</li>
          <li><b>Sexual exploitation</b> — non-consensual intimate imagery, sexual coercion, sex trafficking.</li>
          <li><b>Child sexual abuse material (CSAM)</b> — strictly prohibited. CSAM is reported to the appropriate authorities and the account is terminated.</li>
          <li><b>Self-harm promotion</b> — content that encourages or glorifies self-harm or suicide. Resources are provided when self-harm signals are detected.</li>
          <li><b>Impersonation</b> — pretending to be another person or entity in a deceptive way.</li>
          <li><b>Privacy violations</b> — doxxing, sharing private information without consent, non-consensual recording.</li>
          <li><b>Copyright infringement</b> — see the <Link to="/dmca" className="underline" style={{ color: "var(--primary)" }}>Copyright & DMCA Policy</Link>.</li>
          <li><b>Illegal activity</b> — content that promotes or facilitates illegal acts.</li>
        </ul>
      </Section>

      <Section heading="What happens when a rule is broken">
        <p>Depending on severity, history, and context, violations may result in:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Content removal or hiding</li>
          <li>Temporary feature restrictions</li>
          <li>Account suspension</li>
          <li>Account termination</li>
        </ul>
        <p>Where possible we will explain the reason. Users see one of two notices on actioned content: <i>"This content is under review."</i> or <i>"This content was removed for violating Community Standards."</i></p>
      </Section>

      <Section heading="How we review">
        <p>OurRealm combines in-app user reports with lightweight automated scanning (keyword, regex, URL, repeat-offender signals) to populate a single moderation queue. Admin reviewers act on items in the queue. We follow a <b>reasonable-efforts</b> model — not all content is reviewed proactively, and no automated system is perfect. Full process detail: <Link to="/safety" className="underline" style={{ color: "var(--primary)" }}>Safety & Reporting Policy</Link>.</p>
      </Section>

      <Section heading="Report something">
        <p>Use the in-app Report button anywhere you see content (posts, comments, profiles, messages, images, video). For urgent safety issues, email <a className="underline" href={`mailto:${CONTACT.safety}`} style={{ color: "var(--primary)" }}>{CONTACT.safety}</a>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Copyright & DMCA Policy (includes Repeat Infringer Policy)
// ───────────────────────────────────────────────────────────────────────
export function DMCAPolicyPage() {
  return (
    <LegalShell title="Copyright & DMCA Policy" subtitle="How to report copyright infringement and counter-notify." testid="page-dmca">
      <Section heading="Reporting copyright infringement (DMCA notice)">
        <p>If you believe content on OurRealm infringes your copyright, send a notice that includes all of the following to <a className="underline" href={`mailto:${CONTACT.copyright}`} style={{ color: "var(--primary)" }}>{CONTACT.copyright}</a>:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>An electronic or physical signature of the copyright owner or person authorized to act on their behalf.</li>
          <li>Identification of the copyrighted work claimed to have been infringed.</li>
          <li>The exact URL(s) on OurRealm of the allegedly infringing material so we can locate it.</li>
          <li>Your name, address, telephone number, and email address.</li>
          <li>A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</li>
          <li>A statement, under penalty of perjury, that the information in the notice is accurate and that you are the copyright owner or authorized to act on the owner's behalf.</li>
        </ol>
        <p>Knowingly making a materially false statement in a DMCA notice may result in liability under U.S. law.</p>
      </Section>

      <Section heading="Counter-notice">
        <p>If your content was removed and you believe the removal was a mistake or misidentification, you may submit a counter-notice to <a className="underline" href={`mailto:${CONTACT.copyright}`} style={{ color: "var(--primary)" }}>{CONTACT.copyright}</a> including:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Your electronic or physical signature.</li>
          <li>Identification of the removed material and the location where it appeared before removal.</li>
          <li>A statement, under penalty of perjury, that you have a good-faith belief the material was removed as a result of mistake or misidentification.</li>
          <li>Your name, address, telephone number, and email address.</li>
          <li>A statement that you consent to the jurisdiction of the U.S. federal court for the district in which your address is located (or, if outside the U.S., any judicial district in which OurRealm may be found), and that you will accept service of process from the original notifier.</li>
        </ol>
      </Section>

      <Section heading="Repeat Infringer Policy">
        <p>It is OurRealm's policy to terminate accounts that are determined to be repeat infringers of copyright. We assess repeat infringement based on the number, severity, and pattern of valid notices we receive. Termination decisions are made by human admin review.</p>
      </Section>

      <Section heading="Designated contact">
        <p>All copyright communications: <a className="underline" href={`mailto:${CONTACT.copyright}`} style={{ color: "var(--primary)" }}>{CONTACT.copyright}</a>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Safety & Reporting Policy
// ───────────────────────────────────────────────────────────────────────
export function SafetyPolicyPage() {
  return (
    <LegalShell title="Safety & Reporting Policy" subtitle="How reports are handled and what to expect." testid="page-safety">
      <Section heading="Our approach">
        <p><b>OurRealm uses a reasonable-efforts approach to moderation. Not all content is reviewed proactively, and no automated system is perfect.</b> We do not guarantee response times and we do not guarantee that every report will be reviewed by a human.</p>
      </Section>

      <Section heading="Report categories">
        <p>Available report reasons:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Spam or Scam</li>
          <li>Harassment or Bullying</li>
          <li>Hate or Threats</li>
          <li>Sexual or Explicit Content</li>
          <li>Self-Harm Concerns</li>
          <li>Impersonation</li>
          <li>Privacy Violation</li>
          <li>Other</li>
        </ul>
      </Section>

      <Section heading="Where you can report">
        <p>Reports can be filed against posts, comments, replies, profiles, direct messages, and any uploaded media (images, video, sounds).</p>
      </Section>

      <Section heading="Reporting workflow">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Tap Report on the content. Choose a reason and (optionally) add detail or up to 8 screenshots.</li>
          <li>The report enters a unified moderation queue alongside automated scanner findings.</li>
          <li>An admin reviews the item and chooses Approve, Hide, Restore, Delete, or Ban User.</li>
          <li>Counts on the admin dashboard update through the existing realtime infrastructure (no new pollers).</li>
        </ol>
      </Section>

      <Section heading="Risk scoring overview">
        <p>OurRealm uses a small deterministic heuristic — no machine learning models. Allowed signals: report count, keyword matches, regex matches, URL detection, repeat offenses. Items are bucketed as low risk → <code>approved</code>, medium risk → <code>pending_review</code>, high risk → <code>hidden</code> pending admin review. Automation does <b>not</b> ban users on its own.</p>
      </Section>

      <Section heading="Moderation statuses">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>approved</b> — visible.</li>
          <li><b>pending_review</b> — awaiting admin action.</li>
          <li><b>hidden</b> — automatically hidden pending admin review.</li>
        </ul>
        <p>User-facing notices are limited to <i>"This content is under review."</i> and <i>"This content was removed for violating Community Standards."</i> Internal scanner rules, keywords, regex patterns, and detection logic are never disclosed.</p>
      </Section>

      <Section heading="Admin access to private messages">
        <p>Admins do <b>not</b> read direct messages by default. The ticket-detail endpoint returns only report metadata (reason, the screenshots the reporter uploaded, the message id, and the conversation id) — never the message body. Direct access to message contents is limited to messages that have been reported, or where required for an active support or moderation case.</p>
      </Section>

      <Section heading="Media moderation">
        <p>Uploaded media is validated only for file type, file size, duration, and suspicious filenames. OurRealm does not automatically detect nudity, violence, illegal imagery, or harmful audio. Discovery of such content relies on user reports.</p>
      </Section>

      <Section heading="Urgent safety">
        <p>For urgent safety issues, email <a className="underline" href={`mailto:${CONTACT.safety}`} style={{ color: "var(--primary)" }}>{CONTACT.safety}</a>. If you or someone else is in immediate danger, contact local emergency services.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Cookie & Tracking Notice
// ───────────────────────────────────────────────────────────────────────
export function CookieNoticePage() {
  return (
    <LegalShell title="Cookie & Tracking Notice" subtitle="How OurRealm uses cookies, storage, and similar technologies." testid="page-cookies">
      <Section heading="What we use">
        <p>OurRealm uses cookies, browser local storage, and session storage to keep you signed in, remember your preferences (e.g. theme/mode), and run the Service. We also use minimal in-app analytics to understand which features are used and to diagnose problems.</p>
      </Section>

      <Section heading="Categories">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Strictly necessary</b> — authentication cookies (access token, refresh token), session identifiers, brute-force / lockout protection, CSRF safeguards.</li>
          <li><b>Functional</b> — preferences such as selected mode (Neon / Business / Millennium / Stealth), feed filters, presence visibility.</li>
          <li><b>Analytics</b> — first-party usage and crash diagnostics. Third-party analytics may be added in the future with prior notice.</li>
        </ul>
        <p>We do not use cookies for advertising. We do not sell tracking data.</p>
      </Section>

      <Section heading="Embeds & third-party services">
        <p>The Service may embed third-party content (for example, YouTube). Those embeds load their own cookies and trackers governed by the relevant third-party privacy policies.</p>
      </Section>

      <Section heading="Your choices">
        <p>You can clear cookies and site storage at any time through your browser. Disabling strictly-necessary cookies will prevent you from signing in. Where required by law (for example, EU/UK / EEA), additional consent prompts may appear before non-essential trackers are loaded.</p>
      </Section>

      <Section heading="More detail">
        <p>For the broader picture of what data we collect and how it is used, see the <Link to="/privacy" className="underline" style={{ color: "var(--primary)" }}>Privacy Policy</Link>.</p>
      </Section>
    </LegalShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Account Deletion Policy
// ───────────────────────────────────────────────────────────────────────
export function AccountDeletionPage() {
  return (
    <LegalShell title="Account Deletion Policy" subtitle="How to delete your OurRealm account and what happens after." testid="page-account-deletion">
      <Section heading="How to delete your account">
        <p>You can request account deletion at any time from Account Settings, or by emailing <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a> from the email address on your account. Underage users (under 13) — or a parent or guardian acting on their behalf — may request immediate removal.</p>
      </Section>

      <Section heading="What happens to your data">
        <p>When your deletion request is processed:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your visible profile (name, username, avatar, banner, bio, widgets, custom layout) is removed or anonymized.</li>
          <li>Your active sessions are revoked and your password hash is cleared.</li>
          <li>Posts, comments, sounds, and media you created may be removed or disassociated from your username.</li>
          <li>Direct messages remain visible to the other participants of the conversation; references to your username may be anonymized.</li>
        </ul>
      </Section>

      <Section heading="Limited retention after deletion">
        <p>We do <b>not</b> claim immediate or irreversible deletion. Some records may be retained for limited periods for:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Legal compliance and response to lawful requests</li>
          <li>Fraud and abuse prevention</li>
          <li>Platform security (e.g. brute-force lockout history)</li>
          <li>Moderation audit logs — up to <b>90 days</b> unless needed for an active investigation</li>
          <li>Internal webhook event logs — up to <b>30 days</b></li>
        </ul>
      </Section>

      <Section heading="Reactivation">
        <p>If you delete your account and later wish to return, you will need to create a new account. Your previous username may not be available.</p>
      </Section>

      <Section heading="Questions">
        <p>Email <a className="underline" href={`mailto:${CONTACT.privacy}`} style={{ color: "var(--primary)" }}>{CONTACT.privacy}</a>.</p>
      </Section>
    </LegalShell>
  );
}
