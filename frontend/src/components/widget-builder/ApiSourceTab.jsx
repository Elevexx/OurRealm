/**
 * ApiSourceTab — the "API Source" tab inside the WidgetBuilder.
 *
 * Lets the founder pick a provider + endpoint, fill in endpoint
 * params, run a "Test API" call (proxied through /api/admin/widgets/
 * test-api), inspect the JSON response, and click any sample path to
 * bind it to a field in the widget's editor_config.fields[].
 *
 * Three columns on wide screens:
 *   [Provider Picker] [Params + Test] [Response viewer + Bindings]
 *
 * The result is written into `editor_config.data_source = {
 *   kind: "api", provider, endpoint_key, params, response_map,
 *   refresh_seconds, cache_seconds
 * }`. The renderer (CustomWidgetRenderer) picks this up at runtime
 * and proxies its own calls through /api/widgets/api-call.
 */
import React, { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";

const DEFAULT_REFRESH_OPTIONS = [
  { v: 60, l: "1 min" },
  { v: 300, l: "5 min" },
  { v: 600, l: "10 min" },
  { v: 1800, l: "30 min" },
  { v: 3600, l: "1 hour" },
  { v: 21600, l: "6 hours" },
  { v: 86400, l: "24 hours" },
];

export default function ApiSourceTab({ form, setForm }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testResp, setTestResp] = useState(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  const ds = form.editor_config.data_source || { kind: "static" };
  const isApi = ds.kind === "api";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/admin/widgets/api-providers");
        if (!cancelled) setProviders(data?.providers || []);
      } catch { /* */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const provider = providers.find((p) => p.key === ds.provider) || null;
  const endpoint = provider?.endpoints?.find((e) => e.key === ds.endpoint_key) || null;

  const setDS = (patch) => setForm((f) => ({
    ...f,
    editor_config: {
      ...f.editor_config,
      data_source: { ...(f.editor_config.data_source || {}), ...patch },
    },
  }));

  const switchKind = (kind) => {
    if (kind === "api") {
      setDS({ kind: "api", provider: ds.provider || "", endpoint_key: ds.endpoint_key || "",
              params: ds.params || {}, response_map: ds.response_map || {},
              refresh_seconds: ds.refresh_seconds || 600, cache_seconds: ds.cache_seconds || 600 });
    } else {
      setDS({ kind: "static", provider: null, endpoint_key: null, params: {}, response_map: {} });
    }
  };

  const pickProvider = (p) => {
    const ep = (p.endpoints || [])[0] || null;
    setDS({
      kind: "api",
      provider: p.key,
      endpoint_key: ep?.key || "",
      params: defaultParams(ep),
      response_map: {},
      refresh_seconds: p.default_refresh_seconds || 600,
      cache_seconds: p.default_cache_seconds || 600,
    });
    setTestResp(null); setError(null);
  };

  const pickEndpoint = (ep) => {
    setDS({ endpoint_key: ep.key, params: defaultParams(ep), response_map: {} });
    setTestResp(null); setError(null);
  };

  const setParam = (name, value) => {
    setDS({ params: { ...(ds.params || {}), [name]: value } });
  };

  const bindField = (fieldKey, path) => {
    setDS({ response_map: { ...(ds.response_map || {}), [fieldKey]: path } });
  };

  const clearBinding = (fieldKey) => {
    const next = { ...(ds.response_map || {}) };
    delete next[fieldKey];
    setDS({ response_map: next });
  };

  const runTest = async () => {
    setTesting(true); setError(null);
    try {
      const { data } = await apiClient.post("/admin/widgets/test-api", {
        provider: ds.provider,
        endpoint: ds.endpoint_key,
        params: ds.params || {},
        response_map: ds.response_map || {},
        bypass_cache: true,
      });
      setTestResp(data);
      // Mirror mapped values into editor_config.data so the live
      // preview renders the freshly-fetched data immediately.
      if (data?.mapped && typeof data.mapped === "object") {
        setForm((f) => ({
          ...f,
          editor_config: {
            ...f.editor_config,
            data: { ...(f.editor_config.data || {}), ...data.mapped },
          },
        }));
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "Test failed");
      setTestResp(null);
    } finally { setTesting(false); }
  };

  if (loading) {
    return <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>;
  }

  return (
    <div className="space-y-4" data-testid="api-source-tab">
      <KindToggle kind={ds.kind} onChange={switchKind} />

      {!isApi ? (
        <div className="or-surface p-4 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          Static widgets use the values you type in the <b>Data</b> tab. Switch to <b>Live API</b> above to pull live data from a provider.
        </div>
      ) : (
        <>
          <ProviderPicker
            providers={providers}
            selected={ds.provider}
            onPick={pickProvider}
          />

          {provider && (
            <>
              <EndpointPicker
                provider={provider}
                selected={ds.endpoint_key}
                onPick={pickEndpoint}
              />

              {endpoint && (
                <ParamsAndBindings
                  provider={provider}
                  endpoint={endpoint}
                  params={ds.params || {}}
                  responseMap={ds.response_map || {}}
                  fields={form.editor_config.fields || []}
                  onParamChange={setParam}
                  onBind={bindField}
                  onUnbind={clearBinding}
                  onTest={runTest}
                  testing={testing}
                  error={error}
                  testResp={testResp}
                />
              )}

              <RefreshControls
                refreshSeconds={ds.refresh_seconds || 600}
                cacheSeconds={ds.cache_seconds || 600}
                onRefresh={(v) => setDS({ refresh_seconds: v })}
                onCache={(v) => setDS({ cache_seconds: v })}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function KindToggle({ kind, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background: "var(--surface-2)" }}>
      {[
        { id: "static", label: "Static / User Content" },
        { id: "api", label: "Live API" },
      ].map((opt) => {
        const on = opt.id === kind;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="px-3 py-1 text-xs rounded-full transition-colors"
            style={{
              background: on ? "var(--primary)" : "transparent",
              color: on ? "#000" : "var(--text-muted)",
              fontWeight: on ? 700 : 500,
            }}
            data-testid={`api-kind-${opt.id}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ProviderPicker({ providers, selected, onPick }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Provider</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {providers.map((p) => {
          const Icon = Icons[p.icon] || Icons.Plug;
          const isSelected = p.key === selected;
          const disabled = p.coming_soon || !p.has_credential;
          return (
            <button
              key={p.key}
              onClick={() => !disabled && onPick(p)}
              disabled={disabled}
              className="or-surface p-3 text-left transition-transform hover:-translate-y-0.5"
              style={{
                background: "var(--surface-2)",
                outline: isSelected ? "2px solid var(--primary)" : "none",
                opacity: disabled ? 0.55 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              data-testid={`api-provider-${p.key}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} style={{ color: isSelected ? "var(--primary)" : "var(--text-main)" }} />
                <span className="font-semibold text-xs" style={{ color: "var(--text-main)" }}>{p.name}</span>
                {p.coming_soon && (
                  <span className="ml-auto text-[8px] uppercase tracking-widest px-1 rounded" style={{ background: "rgba(255,90,107,0.18)", color: "#FF8080" }}>
                    Soon
                  </span>
                )}
                {!p.coming_soon && !p.has_credential && (
                  <span className="ml-auto text-[8px] uppercase tracking-widest px-1 rounded" style={{ background: "rgba(244,200,74,0.16)", color: "#F4C84A" }}>
                    Add Key
                  </span>
                )}
                {p.has_credential && !p.coming_soon && (
                  <span className="ml-auto text-[8px] uppercase tracking-widest px-1 rounded" style={{ background: "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: "var(--brand-green)" }}>
                    Ready
                  </span>
                )}
              </div>
              <div className="text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>{p.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EndpointPicker({ provider, selected, onPick }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Endpoint</div>
      <div className="flex flex-wrap gap-1">
        {(provider.endpoints || []).map((ep) => {
          const on = ep.key === selected;
          return (
            <button
              key={ep.key}
              onClick={() => onPick(ep)}
              className="px-3 py-1 text-xs rounded-full transition-colors"
              style={{ background: on ? "var(--primary)" : "var(--surface-2)", color: on ? "#000" : "var(--text-muted)", fontWeight: on ? 700 : 500 }}
              data-testid={`api-endpoint-${ep.key}`}
            >
              {ep.method} · {ep.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ParamsAndBindings({ provider, endpoint, params, responseMap, fields, onParamChange, onBind, onUnbind, onTest, testing, error, testResp }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* LEFT: params + test button */}
      <div className="or-surface p-3" style={{ background: "var(--surface-2)" }}>
        <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Params</div>
        <div className="space-y-2">
          {(endpoint.params || []).map((spec) => (
            <ParamInput key={spec.name} spec={spec} value={params[spec.name] ?? spec.default ?? ""} onChange={(v) => onParamChange(spec.name, v)} />
          ))}
          {(endpoint.params || []).length === 0 && (
            <div className="text-[11px] italic" style={{ color: "var(--text-muted)" }}>No params required.</div>
          )}
        </div>
        {error && (
          <div className="text-[11px] mt-3 px-2 py-1.5 rounded" style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }} data-testid="api-test-error">
            {error}
          </div>
        )}
        <button
          className="or-btn or-btn-primary mt-3 w-full text-sm"
          onClick={onTest}
          disabled={testing}
          data-testid="api-test-button"
        >
          {testing ? <Icons.Loader2 size={14} className="animate-spin" /> : <Icons.Play size={14} />} Test API
        </button>
        {provider.docs_url && (
          <a className="block text-[10px] mt-2 hover:underline" style={{ color: "var(--text-muted)" }} href={provider.docs_url} target="_blank" rel="noreferrer">
            Provider docs ↗
          </a>
        )}
      </div>

      {/* RIGHT: response viewer + bindings */}
      <div className="or-surface p-3" style={{ background: "var(--surface-2)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Response</div>
          {testResp && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: testResp.cached ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: testResp.cached ? "var(--primary)" : "var(--brand-green)" }}>
              {testResp.cached ? `Cached (${testResp.cache_tier})` : "Live"}
            </span>
          )}
        </div>

        {/* Sample paths — one-click bind to any widget field */}
        {(endpoint.sample_paths || []).length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Quick-bind suggestions</div>
            <div className="flex flex-wrap gap-1">
              {(endpoint.sample_paths || []).map((sp) => (
                <PathChip key={sp.path} path={sp.path} label={sp.label} fields={fields} responseMap={responseMap} onBind={onBind} />
              ))}
            </div>
          </div>
        )}

        {/* Bindings list per field */}
        {fields.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Field Bindings</div>
            <div className="space-y-1.5" data-testid="api-bindings">
              {fields.map((f) => (
                <FieldBinding
                  key={f.key}
                  field={f}
                  bound={responseMap[f.key] || ""}
                  onChange={(v) => v ? onBind(f.key, v) : onUnbind(f.key)}
                />
              ))}
            </div>
          </div>
        )}

        {testResp && (
          <>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Raw JSON</div>
            <pre
              className="text-[10px] overflow-auto max-h-48 p-2 rounded"
              style={{ background: "var(--surface-1)", color: "var(--text-main)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              data-testid="api-raw-response"
            >
              {JSON.stringify(testResp.data, null, 2)}
            </pre>
            {testResp.mapped && Object.keys(testResp.mapped).length > 0 && (
              <>
                <div className="text-[10px] mt-2 mb-1" style={{ color: "var(--text-muted)" }}>Mapped Values</div>
                <pre className="text-[10px] overflow-auto max-h-24 p-2 rounded" style={{ background: "var(--surface-1)", color: "var(--primary)" }}>
                  {JSON.stringify(testResp.mapped, null, 2)}
                </pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PathChip({ path, label, fields, responseMap, onBind }) {
  // Allow binding to the FIRST unbound field by default, or open a menu.
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="text-[10px] px-2 py-1 rounded-full transition-colors"
        style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)", color: "var(--primary)" }}
        onClick={() => setOpen((o) => !o)}
      >
        <Icons.Plus size={9} className="inline" /> {label}
      </button>
      {open && (
        <div
          className="absolute z-10 mt-1 or-surface p-2 min-w-[200px]"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)" }}
        >
          <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Bind to field</div>
          {fields.length === 0 ? (
            <div className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>Add a field first.</div>
          ) : fields.map((f) => (
            <button
              key={f.key}
              className="block w-full text-left text-[11px] px-2 py-1 hover:bg-[var(--surface-1)] rounded"
              onClick={() => { onBind(f.key, path); setOpen(false); }}
              style={{ color: "var(--text-main)" }}
            >
              {f.label || f.key} <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>({f.type})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldBinding({ field, bound, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <code className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}>
        {field.key}
      </code>
      <input
        className="or-input flex-1 text-[10px]"
        value={bound}
        placeholder="jsonpath e.g. main.temp"
        onChange={(e) => onChange(e.target.value)}
        data-testid={`api-binding-${field.key}`}
      />
      {bound && (
        <button className="starbar-icon" style={{ width: 22, height: 22, color: "#FF5A6B" }} onClick={() => onChange("")} title="Clear">
          <Icons.X size={10} />
        </button>
      )}
    </div>
  );
}

function ParamInput({ spec, value, onChange }) {
  const label = `${spec.label || spec.name}${spec.required ? " *" : ""}`;
  if (spec.type === "select" && Array.isArray(spec.enum)) {
    return (
      <label className="block">
        <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
        <select className="or-input w-full text-xs" value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={`api-param-${spec.name}`}>
          {spec.enum.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (spec.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-testid={`api-param-${spec.name}`} />
        <span style={{ color: "var(--text-main)" }}>{label}</span>
      </label>
    );
  }
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <input
        type={spec.type === "number" ? "number" : "text"}
        className="or-input w-full text-xs"
        value={value ?? ""}
        placeholder={String(spec.default ?? "")}
        onChange={(e) => onChange(spec.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        data-testid={`api-param-${spec.name}`}
      />
    </label>
  );
}

function RefreshControls({ refreshSeconds, cacheSeconds, onRefresh, onCache }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block">
        <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Auto-refresh</div>
        <select className="or-input w-full text-xs" value={refreshSeconds} onChange={(e) => onRefresh(parseInt(e.target.value, 10))} data-testid="api-refresh-seconds">
          {DEFAULT_REFRESH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </label>
      <label className="block">
        <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Cache duration</div>
        <select className="or-input w-full text-xs" value={cacheSeconds} onChange={(e) => onCache(parseInt(e.target.value, 10))} data-testid="api-cache-seconds">
          {DEFAULT_REFRESH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </label>
    </div>
  );
}

function defaultParams(endpoint) {
  if (!endpoint) return {};
  const out = {};
  for (const p of endpoint.params || []) {
    if (p.default !== undefined && p.default !== null) out[p.name] = p.default;
  }
  return out;
}
