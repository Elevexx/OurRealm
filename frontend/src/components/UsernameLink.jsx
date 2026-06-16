/**
 * Lightweight clickable username link. Wherever a username (`@handle`)
 * appears, wrap it in <UsernameLink username="handle"> to navigate to
 * /public/{handle}. Keeps existing styling untouched unless `className`
 * is overridden.
 */
import React from "react";
import { useNavigate } from "react-router-dom";

export default function UsernameLink({
  username,
  prefix = "@",
  className = "",
  style,
  testid,
  onClick,
  children,
}) {
  const navigate = useNavigate();
  const handle = (username || "").trim().replace(/^@/, "").toLowerCase();
  if (!handle) return <span className={className} style={style}>{children || `${prefix}${username || ""}`}</span>;
  const go = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (onClick) onClick(e);
    navigate(`/public/${handle}`);
  };
  return (
    <button
      type="button"
      onClick={go}
      className={`username-link ${className}`}
      style={{ background: "transparent", padding: 0, color: "inherit", cursor: "pointer", ...style }}
      data-testid={testid || `username-link-${handle}`}
      title={`@${handle}`}
    >
      {children || `${prefix}${handle}`}
    </button>
  );
}
