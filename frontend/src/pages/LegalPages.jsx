import React from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/Logo";

/**
 * Three small legal pages — Terms of Service, Terms & Conditions, and
 * Privacy Policy. The copy here is platform-standard boilerplate; product
 * may swap the body text later without touching the route/layout.
 */
const EFFECTIVE_DATE = "February 16, 2026";
const POLICY_VERSION = "2026-02-1";

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
          <div className="space-y-5">{children}</div>
          <div className="text-xs pt-4" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-col)" }}>
            Questions? Contact <a className="underline" href="mailto:legal@ourrealm.social" style={{ color: "var(--primary)" }}>legal@ourrealm.social</a>.
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

export function TermsOfServicePage() {
  return (
    <LegalShell title="Terms of Service" subtitle="Your agreement with OurRealm." testid="page-terms">
      <Section heading="1. Acceptance of Terms">
        <p>By creating an OurRealm account or otherwise using OurRealm (the "Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service.</p>
      </Section>
      <Section heading="2. Eligibility">
        <p>You must be at least 13 years old to use OurRealm. If you are between 13 and the age of majority in your jurisdiction, you confirm that a parent or legal guardian has reviewed these Terms with you. We comply with the Children's Online Privacy Protection Act (COPPA).</p>
      </Section>
      <Section heading="3. Your Account">
        <p>You are responsible for keeping your credentials secret and for all activity on your account. Notify us immediately of any unauthorized use. We may suspend or terminate accounts that violate these Terms.</p>
      </Section>
      <Section heading="4. Content and Conduct">
        <p>You own the content you create on OurRealm. By posting, you grant us a worldwide, royalty-free license to host, display, and distribute that content as part of running the Service. You agree not to post unlawful, infringing, harassing, hateful, or sexually exploitative content, and not to abuse, scrape, or interfere with the Service.</p>
      </Section>
      <Section heading="5. Privacy">
        <p>Our handling of personal data is described in the <Link to="/privacy" className="underline" style={{ color: "var(--primary)" }}>Privacy Policy</Link>, which is incorporated by reference.</p>
      </Section>
      <Section heading="6. Termination">
        <p>You may delete your account at any time from Account Settings. We may suspend or terminate your access if you violate these Terms or if continued service is no longer commercially reasonable.</p>
      </Section>
      <Section heading="7. Disclaimer & Limitation of Liability">
        <p>The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, OurRealm shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service.</p>
      </Section>
      <Section heading="8. Changes">
        <p>We may update these Terms from time to time. We will post the updated version with a new effective date. Continued use after changes take effect constitutes acceptance.</p>
      </Section>
    </LegalShell>
  );
}

export function TermsConditionsPage() {
  return (
    <LegalShell title="Terms & Conditions" subtitle="Community rules and service-specific conditions." testid="page-terms-conditions">
      <Section heading="1. Community Standards">
        <p>OurRealm is a creative social space. Be respectful. No harassment, hate speech, doxxing, or threats. No sexual content involving minors. No content that promotes self-harm or violence.</p>
      </Section>
      <Section heading="2. Authenticity">
        <p>Impersonation is prohibited. You may operate parody accounts only when clearly labeled and not designed to deceive.</p>
      </Section>
      <Section heading="3. Intellectual Property">
        <p>Do not post content you do not have the rights to share. Repeat infringement may result in account termination consistent with the DMCA and similar laws.</p>
      </Section>
      <Section heading="4. Monetization & Wallet">
        <p>If you connect or use OurRealm wallet/payment features, you agree to the additional terms of the underlying provider. OurRealm is not a bank and does not provide financial advice.</p>
      </Section>
      <Section heading="5. Beta Features">
        <p>Some features are released in beta and may change, break, or be removed without notice. We may collect additional telemetry on beta features to improve them.</p>
      </Section>
      <Section heading="6. Enforcement">
        <p>We may remove content, restrict features, or suspend accounts that violate these Conditions. Where possible we will explain the reason and offer an appeal.</p>
      </Section>
      <Section heading="7. Reporting">
        <p>Use the in-app report flow to flag content or accounts. For urgent safety issues contact <a className="underline" href="mailto:safety@ourrealm.social" style={{ color: "var(--primary)" }}>safety@ourrealm.social</a>.</p>
      </Section>
    </LegalShell>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" subtitle="What we collect and how we use it." testid="page-privacy">
      <Section heading="1. Information We Collect">
        <p>Account details (name, email, username, password hash), profile content you choose to share, content you post (text, images, video URLs, comments, likes), messages you send, device/IP metadata for security, and the timestamps and policy version of your acceptance of these terms.</p>
      </Section>
      <Section heading="2. How We Use Information">
        <p>We use your data to operate the Service, secure accounts, prevent abuse, personalize your feed, deliver notifications, and improve OurRealm. We do not sell personal information to third parties.</p>
      </Section>
      <Section heading="3. Children's Privacy (COPPA)">
        <p>OurRealm is not directed to children under 13. We require an age confirmation at signup. If we learn we have collected personal data from a child under 13, we will delete it.</p>
      </Section>
      <Section heading="4. Sharing">
        <p>We share data with service providers (hosting, analytics, payment processors) under contract, with law enforcement when legally required, and with other users only as you direct (e.g. public posts, friends-only posts, custom audiences).</p>
      </Section>
      <Section heading="5. Your Rights">
        <p>You can access, edit, or delete your data from Account Settings. EU/UK users may exercise GDPR rights (access, rectification, erasure, portability, objection). California residents may exercise CCPA rights. Email <a className="underline" href="mailto:privacy@ourrealm.social" style={{ color: "var(--primary)" }}>privacy@ourrealm.social</a>.</p>
      </Section>
      <Section heading="6. Security">
        <p>We use industry-standard safeguards including encryption in transit, hashed passwords, and least-privilege access. No system is perfectly secure; please use a strong unique password.</p>
      </Section>
      <Section heading="7. Retention">
        <p>We retain data while your account is active. After deletion we may retain limited data for legal, fraud-prevention, or safety reasons.</p>
      </Section>
      <Section heading="8. Changes">
        <p>If we make material changes we will notify you in-app or by email before they take effect.</p>
      </Section>
    </LegalShell>
  );
}
