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
import FormatterPicker from "@/components/widget-builder/FormatterPicker";

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

  // ─── Single-value formatters (Phase 3.2) ──────────────────────────
  const formatters = ds.formatters || {};
  const setFormatter = (fieldKey, cfg) => {
    const next = { ...(ds.formatters || {}) };
    if (!cfg || (cfg.type || "none") === "none") delete next[fieldKey];
    else next[fieldKey] = cfg;
    setDS({ formatters: next });
  };

  // ─── Array bindings (Phase 3.1) ───────────────────────────────────
  const arrayBindings = ds.array_bindings || [];

  const addArrayBinding = (preset) => {
    const fieldsList = form.editor_config.fields || [];
    const arrayField = fieldsList.find((f) => ["rich_item", "option_list"].includes(f.type)) ||
                       fieldsList.find((f) => f.type === "image" && (f.max_count || 0) > 1);
    const fieldKey = preset?.field_key || arrayField?.key || "items";
    const next = preset || {
      field_key: fieldKey,
      array_path: "",
      max_items: 10,
      empty_text: "No items available.",
      item_map: {},
    };
    setDS({ array_bindings: [...arrayBindings, next] });
  };

  const updateArrayBinding = (idx, patch) => {
    setDS({ array_bindings: arrayBindings.map((b, i) => (i === idx ? { ...b, ...patch } : b)) });
  };

  const removeArrayBinding = (idx) => {
    setDS({ array_bindings: arrayBindings.filter((_, i) => i !== idx) });
  };

  const applyArrayHint = (hint) => {
    // One-click preset from endpoint.array_hints. Picks a sensible
    // target field (first rich_item/option_list field, or 'items').
    addArrayBinding({
      field_key: (form.editor_config.fields || []).find((f) => ["rich_item", "option_list"].includes(f.type))?.key || "items",
      array_path: hint.array_path,
      max_items: 10,
      empty_text: "No items available.",
      item_map: { ...(hint.item_map || {}) },
    });
  };

  const runTest = async () => {
    setTesting(true); setError(null);
    try {
      const { data } = await apiClient.post("/admin/widgets/test-api", {
        provider: ds.provider,
        endpoint: ds.endpoint_key,
        params: ds.params || {},
        response_map: ds.response_map || {},
        array_bindings: ds.array_bindings || [],
        formatters: ds.formatters || {},
        bypass_cache: true,
      });
      setTestResp(data);
      if (data?.mapped || data?.mapped_arrays) {
        setForm((f) => ({
          ...f,
          editor_config: {
            ...f.editor_config,
            data: {
              ...(f.editor_config.data || {}),
              ...(data.mapped || {}),
              ...(data.mapped_arrays || {}),
            },
          },
        }));
      }
    } catch (e) {
      setError(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Test failed");
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
                  formatters={formatters}
                  fields={form.editor_config.fields || []}
                  onParamChange={setParam}
                  onBind={bindField}
                  onUnbind={clearBinding}
                  onFormatterChange={setFormatter}
                  onTest={runTest}
                  testing={testing}
                  error={error}
                  testResp={testResp}
                />
              )}

              {endpoint && (
                <ArrayBindingsPanel
                  endpoint={endpoint}
                  fields={form.editor_config.fields || []}
                  bindings={arrayBindings}
                  testResp={testResp}
                  onAdd={() => addArrayBinding(null)}
                  onApplyHint={applyArrayHint}
                  onUpdate={updateArrayBinding}
                  onRemove={removeArrayBinding}
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

function ParamsAndBindings({ provider, endpoint, params, responseMap, formatters, fields, onParamChange, onBind, onUnbind, onFormatterChange, onTest, testing, error, testResp }) {
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
            <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Field Bindings & Formatters</div>
            <div className="space-y-1.5" data-testid="api-bindings">
              {fields.map((f) => (
                <FieldBinding
                  key={f.key}
                  field={f}
                  bound={responseMap[f.key] || ""}
                  formatter={formatters?.[f.key]}
                  sampleValue={(testResp?.mapped || {})[f.key]}
                  onChange={(v) => v ? onBind(f.key, v) : onUnbind(f.key)}
                  onFormatterChange={(cfg) => onFormatterChange(f.key, cfg)}
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

function FieldBinding({ field, bound, formatter, sampleValue, onChange, onFormatterChange }) {
  return (
    <div className="space-y-1">
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
      {bound && (
        <FormatterPicker
          value={formatter}
          onChange={onFormatterChange}
          sampleValue={sampleValue}
          testid={`api-formatter-${field.key}`}
        />
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

// ─────────────────────────────────────────────────────────────────────
// Phase 3.1 — Array Bindings panel
// Lets the founder map an array in the API response (e.g. articles,
// data.children) onto a repeated-item widget field (e.g. items, media).
// Includes one-click "Apply hint" for endpoints with array_hints
// declared in the provider registry (NewsAPI articles, Reddit posts,
// CoinGecko markets, ...).
// ─────────────────────────────────────────────────────────────────────
function ArrayBindingsPanel({ endpoint, fields, bindings, testResp, onAdd, onApplyHint, onUpdate, onRemove }) {
  const arrayFieldCandidates = (fields || []).filter((f) =>
    ["rich_item", "option_list", "image", "video", "sound"].includes(f.type),
  );
  const hints = endpoint?.array_hints || [];
  return (
    <div className="or-surface p-3" style={{ background: "var(--surface-2)" }} data-testid="array-bindings-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Array Bindings <span style={{ color: "var(--primary)" }}>· Phase 3.1</span>
        </div>
        <button className="or-btn or-btn-ghost text-xs" onClick={onAdd} data-testid="array-binding-add">
          <Icons.Plus size={12} /> Add binding
        </button>
      </div>
      <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
        Map a JSON array onto a repeated-item field (List, Grid, Media Grid, …). Use it for headlines, top posts, markets, search results, etc.
      </p>

      {hints.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Quick presets</div>
          <div className="flex flex-wrap gap-1">
            {hints.map((h) => (
              <button
                key={h.array_path + h.label}
                className="text-[10px] px-2 py-1 rounded-full transition-colors"
                style={{ background: "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: "var(--brand-green)" }}
                onClick={() => onApplyHint(h)}
                data-testid={`array-hint-${h.array_path || "root"}`}
              >
                <Icons.Sparkles size={9} className="inline" /> {h.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {bindings.length === 0 ? (
        <div className="text-[11px] italic" style={{ color: "var(--text-muted)" }}>
          No array bindings yet. Add one to populate List / Grid / Media Grid fields from a JSON array.
        </div>
      ) : (
        <div className="space-y-3">
          {bindings.map((b, i) => (
            <ArrayBindingRow
              key={i}
              binding={b}
              fields={arrayFieldCandidates}
              testResp={testResp}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArrayBindingRow({ binding, fields, testResp, onUpdate, onRemove }) {
  // Preview the first 3 items by resolving array_path against the
  // test response and applying item_map. Pure-frontend resolution so
  // it stays snappy without re-calling the proxy on every keystroke.
  const preview = useMemo(() => {
    if (!testResp?.data) return null;
    const arr = resolvePath(testResp.data, binding.array_path);
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 3).map((raw) => {
      const out = {};
      for (const [k, p] of Object.entries(binding.item_map || {})) {
        out[k] = resolvePath(raw, p);
      }
      return out;
    });
  }, [testResp, binding]);

  const updateMap = (k, p) => onUpdate({ item_map: { ...(binding.item_map || {}), [k]: p } });
  const removeMapEntry = (k) => {
    const next = { ...(binding.item_map || {}) };
    delete next[k];
    onUpdate({ item_map: next });
    // also remove any formatter for that key
    if (binding.item_formatters && binding.item_formatters[k]) {
      const nf = { ...binding.item_formatters };
      delete nf[k];
      onUpdate({ item_formatters: nf });
    }
  };
  const updateItemFormatter = (k, cfg) => {
    const next = { ...(binding.item_formatters || {}) };
    if (!cfg || (cfg.type || "none") === "none") delete next[k];
    else next[k] = cfg;
    onUpdate({ item_formatters: next });
  };
  const addMapEntry = () => {
    const key = window.prompt("Item field key (e.g. label, body, value, image, url):");
    if (!key) return;
    updateMap(key.trim(), "");
  };

  const itemMapKeys = Object.keys(binding.item_map || {});
  // Sample of the first preview row for per-item formatter previews.
  const sampleRow = preview && preview[0] ? preview[0] : null;

  return (
    <div className="or-surface p-2.5" style={{ background: "var(--surface-1)" }} data-testid={`array-binding-row-${binding.field_key}`}>
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-2">
        <label className="sm:col-span-4">
          <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>Target field</div>
          <select
            className="or-input w-full text-xs"
            value={binding.field_key || ""}
            onChange={(e) => onUpdate({ field_key: e.target.value })}
            data-testid="array-binding-field"
          >
            {fields.length === 0 && <option value="items">items (add a rich_item field)</option>}
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key} ({f.type})</option>)}
          </select>
        </label>
        <label className="sm:col-span-5">
          <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>Array Path (empty = root array)</div>
          <input
            className="or-input w-full text-xs"
            placeholder="e.g. articles or data.children"
            value={binding.array_path || ""}
            onChange={(e) => onUpdate({ array_path: e.target.value })}
            data-testid="array-binding-path"
          />
        </label>
        <label className="sm:col-span-2">
          <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>Max</div>
          <input
            type="number"
            className="or-input w-full text-xs"
            value={binding.max_items || 10}
            min={1}
            max={100}
            onChange={(e) => onUpdate({ max_items: parseInt(e.target.value, 10) || 10 })}
            data-testid="array-binding-max"
          />
        </label>
        <div className="sm:col-span-1 flex items-end justify-end">
          <button className="starbar-icon" style={{ width: 24, height: 24, color: "#FF5A6B" }} onClick={onRemove} title="Remove binding">
            <Icons.Trash2 size={11} />
          </button>
        </div>
        <label className="sm:col-span-12">
          <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>Empty State Text</div>
          <input
            className="or-input w-full text-xs"
            placeholder="No items available."
            value={binding.empty_text || ""}
            onChange={(e) => onUpdate({ empty_text: e.target.value })}
            data-testid="array-binding-empty-text"
          />
        </label>
      </div>

      <div className="border-t pt-2 mb-2" style={{ borderColor: "var(--border-col)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Item Field Mapping</div>
          <button className="or-btn or-btn-ghost text-[10px]" onClick={addMapEntry} data-testid="array-binding-add-map">
            <Icons.Plus size={10} /> Add
          </button>
        </div>
        {itemMapKeys.length === 0 ? (
          <div className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>No item fields mapped. Use "Quick presets" above or click + Add.</div>
        ) : (
          <div className="space-y-2">
            {itemMapKeys.map((k) => (
              <div key={k} className="space-y-1">
                <div className="flex items-center gap-1">
                  <code className="text-[10px] px-1.5 py-0.5 rounded shrink-0 min-w-[60px] text-center" style={{ background: "var(--surface-2)", color: "var(--primary)" }}>
                    {k}
                  </code>
                  <Icons.ArrowRight size={9} style={{ color: "var(--text-muted)" }} />
                  <input
                    className="or-input flex-1 text-[10px]"
                    placeholder="path relative to each item (e.g. title, source.name)"
                    value={binding.item_map[k] || ""}
                    onChange={(e) => updateMap(k, e.target.value)}
                    data-testid={`array-binding-map-${k}`}
                  />
                  <button className="starbar-icon" style={{ width: 20, height: 20, color: "#FF5A6B" }} onClick={() => removeMapEntry(k)}>
                    <Icons.X size={9} />
                  </button>
                </div>
                {binding.item_map[k] && (
                  <div className="pl-[68px]">
                    <FormatterPicker
                      value={(binding.item_formatters || {})[k]}
                      onChange={(cfg) => updateItemFormatter(k, cfg)}
                      sampleValue={sampleRow ? sampleRow[k] : undefined}
                      testid={`array-item-formatter-${k}`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && preview.length > 0 && (
        <div className="border-t pt-2" style={{ borderColor: "var(--border-col)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Preview (first {preview.length})</div>
          <pre
            className="text-[9px] p-2 rounded overflow-auto max-h-32"
            style={{ background: "var(--surface-2)", color: "var(--text-main)", fontFamily: "ui-monospace, monospace" }}
            data-testid="array-binding-preview"
          >
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}
      {preview && preview.length === 0 && (
        <div className="text-[10px] italic" style={{ color: "var(--text-muted)" }} data-testid="array-binding-preview-empty">
          Array resolves to 0 items at "{binding.array_path || "<root>"}". Empty state will show in the widget.
        </div>
      )}
    </div>
  );
}

// Lightweight client-side path resolver — mirrors backend get_path()
// so the array-binding preview renders without re-hitting the API.
function resolvePath(obj, path) {
  if (!path) return obj;
  if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  const norm = String(path).replace(/\[(\d+)\]/g, ".$1");
  const parts = norm.split(".").filter((p) => p !== "");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    const k = parts[i];
    if (Array.isArray(cur)) {
      const idx = parseInt(k, 10);
      cur = Number.isNaN(idx) ? undefined : cur[idx];
    } else if (typeof cur === "object") {
      if (k in cur) cur = cur[k];
      else {
        const rest = parts.slice(i).join(".");
        if (rest in cur) return cur[rest];
        return undefined;
      }
    } else { return undefined; }
  }
  return cur;
}
