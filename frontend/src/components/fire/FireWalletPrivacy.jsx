/**
 * FireWalletPrivacy — Settings → Privacy section (Phase 1).
 * Per-stat visibility: Only Me / Friends / Everyone. Backend is
 * authoritative; this UI only edits the user's fire_privacy settings.
 * Hidden entirely while the founder `fire_wallet_enabled` flag is OFF.
 */
import React, { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFireStatus } from "@/lib/fireApi";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const FIELDS = [
  { key: "vault_balance", label: "Vault Balance" },
  { key: "lifetime_fire", label: "Lifetime Fire Earned" },
  { key: "fire_given", label: "Fire Given" },
  { key: "fire_received", label: "Fire Received" },
];
const OPTIONS = [
  { value: "only_me", label: "Only Me" },
  { value: "friends", label: "Friends" },
  { value: "everyone", label: "Everyone" },
];

export default function FireWalletPrivacy() {
  const { user } = useAuth();
  const fireStatus = useFireStatus(user?.id);
  const [privacy, setPrivacy] = useState(null);

  useEffect(() => {
    if (!user || !fireStatus?.wallet_enabled) return;
    let on = true;
    apiClient.get("/fire/privacy")
      .then((r) => { if (on) setPrivacy(r.data.privacy); })
      .catch(() => {});
    return () => { on = false; };
  }, [user, fireStatus?.wallet_enabled]);

  if (!user || !fireStatus?.wallet_enabled || !privacy) return null;

  const save = async (key, value) => {
    const prev = privacy;
    setPrivacy({ ...privacy, [key]: value });
    try {
      const r = await apiClient.patch("/fire/privacy", { [key]: value });
      setPrivacy(r.data.privacy);
      toast.success("Fire privacy updated");
    } catch (e) {
      setPrivacy(prev);
      toast.error(e?.response?.data?.detail || "Could not update privacy");
    }
  };

  return (
    <div className="or-surface p-5 mb-4" data-testid="fire-wallet-privacy-section">
      <h3 className="text-lg mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Flame size={17} style={{ color: "#FF7A1A" }} fill="#FF7A1A" /> Fire Wallet Privacy
      </h3>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Choose who can view your Fire Wallet statistics.
      </p>
      <div className="space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 flex-wrap"
            data-testid={`fire-privacy-row-${f.key}`}>
            <span className="text-sm" style={{ color: "var(--text-main)" }}>{f.label}</span>
            <Select value={privacy[f.key]} onValueChange={(v) => save(f.key, v)}>
              <SelectTrigger className="w-[150px]" data-testid={`fire-privacy-select-${f.key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}
                    data-testid={`fire-privacy-option-${f.key}-${o.value}`}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
        You always see your own full wallet. These settings only affect what other members can see.
      </p>
    </div>
  );
}
