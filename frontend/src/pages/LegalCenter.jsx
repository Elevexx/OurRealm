/**
 * Public Legal Center — /legal (index) + /legal/:slug (document).
 * Renders ONLY published documents from the DB (drafts/history/admin
 * notes never reach this surface). Old routes (/terms, /privacy, …)
 * alias into LegalDocPage with a slug override.
 */
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import Logo from "@/components/Logo";

export function renderMarkdown(body, keyPrefix = "md") {
  const lines = (body || "").split("\n");
  const out = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      out.push(<ul key={`${keyPrefix}-ul-${out.length}`} className="list-disc pl-5 space-y-1">{list}</ul>);
      list = [];
    }
  };
  const inline = (text, k) => {
    const parts = [];
    let rest = text;
    let i = 0;
    const rx = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/;
    while (rest) {
      const m = rest.match(rx);
      if (!m) { parts.push(rest); break; }
      if (m.index > 0) parts.push(rest.slice(0, m.index));
      if (m[1] !== undefined) {
        const href = m[2];
        parts.push(href.startsWith("/")
          ? <Link key={`${k}-l${i}`} to={href} className="underline" style={{ color: "var(--primary)" }}>{m[1]}</Link>
          : <a key={`${k}-a${i}`} href={href} className="underline" style={{ color: "var(--primary)" }} rel="noreferrer">{m[1]}</a>);
      } else {
        parts.push(<b key={`${k}-b${i}`} style={{ color: "var(--text-main)" }}>{m[3]}</b>);
      }
      rest = rest.slice(m.index + m[0].length);
      i += 1;
    }
    return parts;
  };
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith("## ")) {
      flushList();
      const heading = t.slice(3);
      out.push(
        <h2 key={`${keyPrefix}-h-${idx}`} id={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          className="text-base sm:text-lg mt-5 mb-1.5" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
          {heading}
        </h2>);
    } else if (t.startsWith("- ")) {
      list.push(<li key={`${keyPrefix}-li-${idx}`} className="text-sm" style={{ color: "var(--text-muted)" }}>{inline(t.slice(2), `${keyPrefix}-${idx}`)}</li>);
    } else if (t) {
      flushList();
      out.push(<p key={`${keyPrefix}-p-${idx}`} className="text-sm" style={{ color: "var(--text-muted)" }}>{inline(t, `${keyPrefix}-${idx}`)}</p>);
    }
  });
  flushList();
  return out;
}

function Shell({ title, subtitle, meta, children, testid }) {
  return (
    <div className="min-h-screen px-4 py-10 sm:py-14" data-testid={testid}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Logo size={40} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.28em]" style={{ color: "var(--text-muted)" }}>OurRealm Legal</div>
            <h1 className="text-2xl sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>{title}</h1>
            {subtitle && <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
          </div>
          <Link to="/" className="or-btn or-btn-ghost" data-testid="legal-back-home" style={{ padding: "0.5rem 0.8rem", fontSize: "0.8rem" }}>← Back</Link>
        </div>
        <div className="or-surface p-6 sm:p-8 space-y-4" style={{ color: "var(--text-main)" }}>
          {meta}
          {children}
          <div className="text-xs pt-4" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-col)" }}>
            <Link to="/legal" className="underline" style={{ color: "var(--primary)" }}>All legal documents</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LegalIndexPage() {
  const [docs, setDocs] = useState(null);
  useEffect(() => {
    apiClient.get("/legal/documents").then(({ data }) => setDocs(data.documents)).catch(() => setDocs([]));
  }, []);
  return (
    <Shell title="Legal Center" subtitle="Published policies and agreements." testid="legal-index-page">
      {docs === null ? (
        <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>
      ) : (
        <ul className="space-y-2" data-testid="legal-index-list">
          {docs.map((d) => (
            <li key={d.slug}>
              <Link to={`/legal/${d.slug}`} className="flex items-center gap-2 text-sm underline"
                style={{ color: "var(--primary)" }} data-testid={`legal-index-${d.slug}`}>
                <FileText size={13} /> {d.title}
                <span className="text-[11px] no-underline" style={{ color: "var(--text-muted)" }}>
                  effective {d.effective_date}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export default function LegalDocPage({ slugOverride }) {
  const params = useParams();
  const slug = slugOverride || params.slug;
  const [doc, setDoc] = useState(null);
  const [sections, setSections] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setDoc(null); setErr("");
    apiClient.get(`/legal/documents/${slug}`)
      .then(({ data }) => { setDoc(data.document); setSections(data.sections || []); })
      .catch(() => setErr("Document not found"));
  }, [slug]);
  if (err) return <Shell title="Not Found" testid="legal-doc-404"><p className="text-sm" style={{ color: "var(--text-muted)" }}>{err}</p></Shell>;
  if (!doc) return <Shell title="Loading…" testid="legal-doc-loading"><div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div></Shell>;
  return (
    <Shell title={doc.title} subtitle={doc.subtitle} testid={`legal-doc-${doc.slug}`}
      meta={
        <div className="text-xs flex items-center justify-between flex-wrap gap-2" style={{ color: "var(--text-muted)" }}>
          <span>Effective date: <b style={{ color: "var(--text-main)" }}>{doc.effective_date}</b></span>
          <span>Last updated: <b style={{ color: "var(--text-main)" }}>{doc.last_updated}</b> · v{doc.published_version}</span>
        </div>
      }>
      {sections.length > 3 && (
        <nav className="text-xs flex flex-wrap gap-x-3 gap-y-1 pb-2" style={{ borderBottom: "1px solid var(--border-col)" }} data-testid="legal-doc-toc">
          {sections.map((s) => (
            <a key={s} href={`#${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="underline" style={{ color: "var(--primary)" }}>{s}</a>
          ))}
        </nav>
      )}
      <div className="space-y-2" data-testid="legal-doc-body">{renderMarkdown(doc.published_body)}</div>
    </Shell>
  );
}
