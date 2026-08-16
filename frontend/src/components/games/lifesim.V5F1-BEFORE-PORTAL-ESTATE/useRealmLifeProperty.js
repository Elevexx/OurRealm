import {
  useCallback,
  useEffect,
  useState,
} from "react";

import apiClient from "@/api/client";


function errorText(err) {
  const detail =
    err?.response?.data?.detail;

  if (
    typeof detail === "string"
  ) {
    return detail;
  }

  if (
    detail?.message
  ) {
    return detail.message;
  }

  return (
    err?.message ||
    "RealmLife property request failed."
  );
}


export function useRealmLifeProperty(
  gameId
) {
  const [housing, setHousing] =
    useState(null);

  const [inbox, setInbox] =
    useState(null);

  const [open, setOpen] =
    useState(false);

  const [busy, setBusy] =
    useState(false);

  const [notice, setNotice] =
    useState("");


  const refresh =
    useCallback(
      async () => {
        if (!gameId) return;

        try {
          const [
            housingRes,
            inboxRes,
          ] =
            await Promise.all([
              apiClient.get(
                `/games/${gameId}/realmlife/housing`
              ),

              apiClient.get(
                `/games/${gameId}/realmlife/property/inbox`
              ),
            ]);

          setHousing(
            housingRes.data
          );

          setInbox(
            inboxRes.data
          );
        } catch (err) {
          console.error(
            "[RealmLife Property] refresh",
            err
          );
        }
      },
      [gameId]
    );


  useEffect(() => {
    refresh();

    if (!gameId)
      return undefined;

    // Keep pending invitations and requests reasonably fresh
    // without making this a high-frequency polling system.
    const timer =
      window.setInterval(
        refresh,
        10000
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [
    gameId,
    refresh,
  ]);


  const run =
    useCallback(
      async (
        request,
        successMessage
      ) => {
        setBusy(true);
        setNotice("");

        try {
          const res =
            await request();

          if (
            successMessage
          ) {
            setNotice(
              successMessage
            );
          }

          await refresh();

          return res.data;
        } catch (err) {
          const msg =
            errorText(err);

          setNotice(msg);

          throw new Error(msg);
        } finally {
          setBusy(false);
        }
      },
      [refresh]
    );


  const inviteToProperty =
    useCallback(
      (
        targetUserId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/invite`,
              {
                target_user_id:
                  targetUserId,
              }
            ),

          "Property invitation granted."
        ),
      [
        gameId,
        run,
      ]
    );


  const requestEntry =
    useCallback(
      (
        propertyId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/entry-request`,
              {
                property_id:
                  propertyId,
              }
            ),

          "Entry request sent."
        ),
      [
        gameId,
        run,
      ]
    );


  const approveEntry =
    useCallback(
      (
        requestId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/entry-requests/${requestId}/approve`
            ),

          "Entry approved."
        ),
      [
        gameId,
        run,
      ]
    );


  const declineEntry =
    useCallback(
      (
        requestId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/entry-requests/${requestId}/decline`
            ),

          "Entry declined."
        ),
      [
        gameId,
        run,
      ]
    );


  const inviteToHousehold =
    useCallback(
      (
        targetUserId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/invite`,
              {
                target_user_id:
                  targetUserId,
              }
            ),

          "Household invitation sent."
        ),
      [
        gameId,
        run,
      ]
    );


  const requestHousehold =
    useCallback(
      (
        propertyId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/request`,
              {
                property_id:
                  propertyId,
              }
            ),

          "Household request sent."
        ),
      [
        gameId,
        run,
      ]
    );


  const acceptHouseholdInvite =
    useCallback(
      (
        offerId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/invites/${offerId}/accept`
            ),

          "You joined the household."
        ),
      [
        gameId,
        run,
      ]
    );


  const approveHouseholdRequest =
    useCallback(
      (
        offerId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/requests/${offerId}/approve`
            ),

          "Household request approved."
        ),
      [
        gameId,
        run,
      ]
    );


  const declineHouseholdOffer =
    useCallback(
      (
        offerId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/offers/${offerId}/decline`
            ),

          "Request declined."
        ),
      [
        gameId,
        run,
      ]
    );


  const leaveHousehold =
    useCallback(
      () =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/household/leave`
            ),

          "You left the household and received a new property."
        ),
      [
        gameId,
        run,
      ]
    );


  const evictGuest =
    useCallback(
      (
        targetUserId
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/evict`,
              {
                target_user_id:
                  targetUserId,
              }
            ),

          "Guest evicted."
        ),
      [
        gameId,
        run,
      ]
    );


  const destroyProperty =
    useCallback(
      (
        confirmation
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/property/destroy`,
              {
                confirmation,
              }
            ),

          "Property destroyed. Contributor restorations processed."
        ),
      [
        gameId,
        run,
      ]
    );


  return {
    housing,
    inbox,

    open,
    setOpen,

    busy,
    notice,
    setNotice,

    refresh,

    inviteToProperty,
    requestEntry,
    approveEntry,
    declineEntry,

    inviteToHousehold,
    requestHousehold,
    acceptHouseholdInvite,
    approveHouseholdRequest,
    declineHouseholdOffer,

    leaveHousehold,
    evictGuest,
    destroyProperty,
  };
}
