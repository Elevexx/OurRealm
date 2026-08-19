import React from "react";


export default function RealmLifePropertyPanel({
  open,
  setOpen,

  housing,
  inbox,

  busy,
  notice,

  approveEntry,
  declineEntry,

  acceptHouseholdInvite,
  approveHouseholdRequest,
  declineHouseholdOffer,

  leaveHousehold,
  destroyProperty,
  setGuestAccess,
  addHouseLevel,
}) {
  if (!open)
    return null;

  const membership =
    housing?.membership;

  const property =
    housing?.property;

  const members =
    housing?.members || [];

  const invites =
    inbox?.household_invites ||
    [];

  const householdRequests =
    inbox?.household_requests ||
    [];

  const entryRequests =
    inbox?.entry_requests ||
    [];

  const isOwner =
    membership?.role ===
    "owner";

  const canDestroy =
    !!membership
      ?.can_destroy_property;


  const destroy = async () => {
    const confirmation =
      window.prompt(
        "Type DESTROY PROPERTY to permanently destroy this property. Each contributor receives 50% of the Fire Power they personally burned into it."
      );

    if (
      confirmation !==
      "DESTROY PROPERTY"
    ) {
      return;
    }

    await destroyProperty(
      confirmation
    );
  };


  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center p-3"
      style={{
        background:
          "rgba(0,4,12,.58)",

        backdropFilter:
          "blur(7px)",
      }}
    >
      <div
        className="w-full max-w-[520px] max-h-[88%] overflow-y-auto rounded-2xl"
        style={{
          background:
            "linear-gradient(180deg,rgba(5,18,35,.97),rgba(2,8,18,.97))",

          border:
            "1px solid rgba(46,230,255,.34)",

          boxShadow:
            "0 18px 65px rgba(0,0,0,.55),0 0 34px rgba(46,230,255,.08)",

          color: "white",
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-center gap-3 p-4"
          style={{
            background:
              "rgba(4,14,29,.95)",

            borderBottom:
              "1px solid rgba(46,230,255,.18)",

            backdropFilter:
              "blur(14px)",
          }}
        >
          <div
            className="flex-1"
          >
            <div
              className="text-[10px] font-black tracking-[.2em] text-cyan-300"
            >
              REALMLIFE PROPERTY
            </div>

            <div
              className="text-lg font-black"
            >
              🏠 Property & Household
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              setOpen(false)
            }
            className="w-9 h-9 rounded-xl font-black"
            style={{
              background:
                "rgba(255,255,255,.07)",

              border:
                "1px solid rgba(255,255,255,.14)",
            }}
          >
            ✕
          </button>
        </div>


        <div
          className="p-4 space-y-4"
        >
          <div
            className="rounded-xl p-3"
            style={{
              background:
                "rgba(46,230,255,.06)",

              border:
                "1px solid rgba(46,230,255,.18)",
            }}
          >
            <div
              className="text-sm font-black"
            >
              🔒 Private Property
            </div>

            <div
              className="mt-1 text-xs opacity-75"
            >
              Your house and yard are private by default.
              Household members have permanent access.
              Approved guests keep temporary access until they leave.
            </div>

            <div
              className="grid grid-cols-2 gap-2 mt-3 text-xs"
            >
              <div
                className="rounded-lg p-2 bg-black/25"
              >
                <div
                  className="opacity-55"
                >
                  Property
                </div>

                <div
                  className="font-bold truncate"
                >
                  {property?.id ||
                    "Loading…"}
                </div>
              </div>

              <div
                className="rounded-lg p-2 bg-black/25"
              >
                <div
                  className="opacity-55"
                >
                  Status
                </div>

                <div
                  className="font-bold"
                >
                  {isOwner
                    ? "Original Owner"
                    : "Household Member"}
                </div>
              </div>
            </div>
          </div>


          <section
            data-testid="realmlife-house-levels-section"
            className="mb-4"
          >
            <div className="text-xs font-black text-cyan-300 mb-2">
              HOUSE LEVELS
            </div>

            {(() => {
              const above =
                property?.levels_above || 1;
              const below =
                property?.levels_below || 0;

              const row = (label, state, dir, target, testid) => (
                <div
                  key={testid}
                  className="flex items-center justify-between text-[11px] font-bold py-1"
                  style={{
                    borderBottom:
                      "1px solid rgba(255,255,255,.06)",
                  }}
                >
                  <span>{label}</span>

                  {state === "built" && (
                    <span className="text-emerald-300">✓ BUILT</span>
                  )}

                  {state === "add" && (
                    <button
                      type="button"
                      data-testid={testid}
                      disabled={busy}
                      onClick={() => addHouseLevel?.(dir, target)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-black"
                      style={{
                        background: "rgba(255,138,76,.2)",
                        border: "1px solid rgba(255,138,76,.55)",
                        color: "#ffd9c0",
                      }}
                    >
                      ADD — 🔥5,000 FIRE POWER
                    </button>
                  )}

                  {state === "locked" && (
                    <span className="opacity-40">LOCKED</span>
                  )}
                </div>
              );

              const rows = [
                row("GROUND", "built", null, null, "lvl-ground"),
                row(
                  "LEVEL 2",
                  above >= 2 ? "built" : "add",
                  "above",
                  2,
                  "realmlife-add-level-2"
                ),
                row(
                  "LEVEL 3",
                  above >= 3
                    ? "built"
                    : above >= 2
                    ? "add"
                    : "locked",
                  "above",
                  3,
                  "realmlife-add-level-3"
                ),
                row(
                  "BASEMENT 1",
                  below >= 1 ? "built" : "add",
                  "below",
                  1,
                  "realmlife-add-basement-1"
                ),
                row(
                  "BASEMENT 2",
                  below >= 2
                    ? "built"
                    : below >= 1
                    ? "add"
                    : "locked",
                  "below",
                  2,
                  "realmlife-add-basement-2"
                ),
                row(
                  "BASEMENT 3",
                  below >= 3
                    ? "built"
                    : below >= 2
                    ? "add"
                    : "locked",
                  "below",
                  3,
                  "realmlife-add-basement-3"
                ),
              ];

              return <div>{rows}</div>;
            })()}
          </section>

          <section
            data-testid="realmlife-guest-access-section"
            className="mb-4"
          >
            <div className="text-xs font-black text-cyan-300 mb-2">
              GUEST INTERIOR ACCESS
            </div>

            <div className="text-[10px] opacity-60 mb-2">
              Applies only to guests you have invited/approved.
              Everyone else stays blocked.
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                ["public", "ALL LEVELS PUBLIC"],
                ["private", "ALL LEVELS PRIVATE"],
                ["custom", "CUSTOM"],
              ].map(([mode, label]) => {
                const active =
                  (property?.guest_interior_access?.mode ||
                    "public") === mode;

                return (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`realmlife-guest-access-${mode}`}
                    disabled={busy}
                    onClick={() =>
                      setGuestAccess?.(
                        mode,
                        property?.guest_interior_access
                          ?.levels || {}
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-black"
                    style={{
                      background: active
                        ? "rgba(46,230,255,.22)"
                        : "rgba(255,255,255,.06)",
                      border: active
                        ? "1px solid rgba(46,230,255,.55)"
                        : "1px solid rgba(255,255,255,.12)",
                      color: "#fff",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {(property?.guest_interior_access?.mode ||
              "public") === "custom" && (
              <div className="flex flex-wrap gap-1.5">
                {["ground", "second", "third"].map((lvl) => {
                  const levels =
                    property?.guest_interior_access?.levels ||
                    {};
                  const on = levels[lvl] !== false;

                  return (
                    <button
                      key={lvl}
                      type="button"
                      data-testid={`realmlife-guest-level-${lvl}`}
                      disabled={busy}
                      onClick={() =>
                        setGuestAccess?.("custom", {
                          ...levels,
                          [lvl]: !on,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase"
                      style={{
                        background: on
                          ? "rgba(63,214,144,.2)"
                          : "rgba(255,90,90,.16)",
                        border: on
                          ? "1px solid rgba(63,214,144,.5)"
                          : "1px solid rgba(255,90,90,.45)",
                        color: "#fff",
                      }}
                    >
                      {lvl === "ground"
                        ? "GROUND"
                        : lvl.toUpperCase()}{" "}
                      {on ? "· PUBLIC" : "· PRIVATE"}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div
              className="text-xs font-black text-cyan-300 mb-2"
            >
              HOUSEHOLD
            </div>

            <div
              className="space-y-1.5"
            >
              {members.map(
                (member) => (
                  <div
                    key={
                      member.user_id
                    }
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{
                      background:
                        "rgba(255,255,255,.045)",

                      border:
                        "1px solid rgba(255,255,255,.08)",
                    }}
                  >
                    <span>
                      {member.role ===
                      "owner"
                        ? "👑"
                        : "🏠"}
                    </span>

                    <span
                      className="font-bold flex-1"
                    >
                      @
                      {member.username ||
                        "RealmLife User"}
                    </span>

                    <span
                      className="opacity-55"
                    >
                      {member.role}
                    </span>
                  </div>
                )
              )}
            </div>
          </section>


          {!!entryRequests.length && (
            <section>
              <div
                className="text-xs font-black text-cyan-300 mb-2"
              >
                ENTRY REQUESTS
              </div>

              <div
                className="space-y-2"
              >
                {entryRequests.map(
                  (request) => (
                    <div
                      key={
                        request.id
                      }
                      className="rounded-xl p-3"
                      style={{
                        background:
                          "rgba(197,140,255,.07)",

                        border:
                          "1px solid rgba(197,140,255,.18)",
                      }}
                    >
                      <div
                        className="text-xs font-bold"
                      >
                        @
                        {request.requester_username ||
                          "User"}{" "}
                        wants to enter your property.
                      </div>

                      <div
                        className="flex gap-2 mt-2"
                      >
                        <button
                          disabled={
                            busy
                          }
                          onClick={() =>
                            approveEntry(
                              request.id
                            )
                          }
                          className="flex-1 rounded-lg px-3 py-2 text-xs font-black"
                          style={{
                            background:
                              "rgba(46,230,255,.16)",

                            border:
                              "1px solid rgba(46,230,255,.32)",
                          }}
                        >
                          ✓ APPROVE
                        </button>

                        <button
                          disabled={
                            busy
                          }
                          onClick={() =>
                            declineEntry(
                              request.id
                            )
                          }
                          className="flex-1 rounded-lg px-3 py-2 text-xs font-black"
                          style={{
                            background:
                              "rgba(255,110,110,.12)",

                            border:
                              "1px solid rgba(255,110,110,.25)",
                          }}
                        >
                          ✕ DECLINE
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </section>
          )}


          {!!invites.length && (
            <section>
              <div
                className="text-xs font-black text-cyan-300 mb-2"
              >
                HOUSEHOLD INVITATIONS
              </div>

              {invites.map(
                (invite) => (
                  <div
                    key={
                      invite.id
                    }
                    className="rounded-xl p-3 mb-2"
                    style={{
                      background:
                        "rgba(255,170,80,.07)",

                      border:
                        "1px solid rgba(255,170,80,.20)",
                    }}
                  >
                    <div
                      className="text-xs font-bold"
                    >
                      @
                      {invite.created_by_username ||
                        "User"}{" "}
                      invited you to join their household.
                    </div>

                    <div
                      className="text-[10px] opacity-65 mt-1"
                    >
                      Joining surrenders your current personal property.
                      Eligible property contributions are restored at 50%.
                    </div>

                    <div
                      className="flex gap-2 mt-2"
                    >
                      <button
                        disabled={busy}
                        onClick={() =>
                          acceptHouseholdInvite(
                            invite.id
                          )
                        }
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-black bg-cyan-400/15 border border-cyan-300/30"
                      >
                        JOIN HOUSEHOLD
                      </button>

                      <button
                        disabled={busy}
                        onClick={() =>
                          declineHouseholdOffer(
                            invite.id
                          )
                        }
                        className="rounded-lg px-3 py-2 text-xs font-black bg-white/5 border border-white/10"
                      >
                        DECLINE
                      </button>
                    </div>
                  </div>
                )
              )}
            </section>
          )}


          {!!householdRequests.length && (
            <section>
              <div
                className="text-xs font-black text-cyan-300 mb-2"
              >
                HOUSEHOLD JOIN REQUESTS
              </div>

              {householdRequests.map(
                (request) => (
                  <div
                    key={
                      request.id
                    }
                    className="rounded-xl p-3 mb-2 bg-white/[.04] border border-white/10"
                  >
                    <div
                      className="text-xs font-bold"
                    >
                      @
                      {request.created_by_username ||
                        request.target_username ||
                        "User"}{" "}
                      wants to join your household.
                    </div>

                    <div
                      className="flex gap-2 mt-2"
                    >
                      <button
                        disabled={busy}
                        onClick={() =>
                          approveHouseholdRequest(
                            request.id
                          )
                        }
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-black bg-cyan-400/15 border border-cyan-300/30"
                      >
                        APPROVE
                      </button>

                      <button
                        disabled={busy}
                        onClick={() =>
                          declineHouseholdOffer(
                            request.id
                          )
                        }
                        className="rounded-lg px-3 py-2 text-xs font-black bg-white/5 border border-white/10"
                      >
                        DECLINE
                      </button>
                    </div>
                  </div>
                )
              )}
            </section>
          )}


          {!!notice && (
            <div
              className="rounded-lg px-3 py-2 text-xs font-bold"
              style={{
                background:
                  "rgba(255,255,255,.06)",

                border:
                  "1px solid rgba(255,255,255,.11)",
              }}
            >
              {notice}
            </div>
          )}


          {!isOwner && (
            <button
              disabled={busy}
              onClick={
                leaveHousehold
              }
              className="w-full rounded-xl px-3 py-3 text-xs font-black"
              style={{
                background:
                  "rgba(255,170,80,.10)",

                border:
                  "1px solid rgba(255,170,80,.24)",
              }}
            >
              LEAVE HOUSEHOLD
            </button>
          )}


          {canDestroy && (
            <button
              disabled={busy}
              onClick={destroy}
              className="w-full rounded-xl px-3 py-3 text-xs font-black"
              style={{
                background:
                  "rgba(255,70,70,.10)",

                border:
                  "1px solid rgba(255,90,90,.26)",

                color:
                  "#ffb5b5",
              }}
            >
              DESTROY PROPERTY
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
