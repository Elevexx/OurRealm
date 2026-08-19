import React, {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import apiClient from "@/api/client";

// REALMLIFE PERFORMANCE:
// Keep the full Three.js RealmLife world in its own chunk.
// RealmLife game data and the 3D runtime can now load in parallel.
const LifeSimRuntime = React.lazy(() =>
  import("@/components/games/lifesim/LifeSimRuntime")
);


const PREFERRED_GAME_ID =
  "realmlife-home-v1";


function findRealmLifeGame(
  node
) {
  if (!node) {
    return null;
  }


  if (
    Array.isArray(
      node
    )
  ) {
    for (
      const item
      of node
    ) {
      const result =
        findRealmLifeGame(
          item
        );

      if (result) {
        return result;
      }
    }

    return null;
  }


  if (
    typeof node
    !== "object"
  ) {
    return null;
  }


  const id =
    String(
      node.id
      || node.game_id
      || ""
    );

  const title =
    String(
      node.title
      || node.name
      || ""
    );


  const renderer =
    String(
      node.renderer
      || node.renderer_id
      || node.spec?.renderer
      || ""
    );


  const runtime =
    String(
      node.runtime
      || node.runtime_id
      || node.spec?.runtime
      || ""
    );


  const realmLifeCandidate =
    id.toLowerCase()
      .includes(
        "realmlife"
      )
    ||
    title.toLowerCase()
      .includes(
        "realmlife"
      )
    ||
    renderer
      === "renderer_life_sim_three_v1"
    ||
    runtime
      === "life_sim_3d";


  if (
    realmLifeCandidate
    && id
  ) {
    return {
      id,
      title,
    };
  }


  for (
    const value
    of Object.values(
      node
    )
  ) {
    if (
      value
      && (
        typeof value
        === "object"
      )
    ) {
      const result =
        findRealmLifeGame(
          value
        );

      if (result) {
        return result;
      }
    }
  }


  return null;
}


async function resolveRealmLife() {

  // ----------------------------------------------------------
  // Preferred stable RealmLife id.
  // ----------------------------------------------------------

  try {
    const response =
      await apiClient.get(
        `/games/${PREFERRED_GAME_ID}`
      );

    if (
      response.data
      && !response.data.blocked
    ) {
      return response.data;
    }

  } catch (error) {
    // Production may contain the same RealmLife game under a
    // different id. Fall through to public Games discovery.
  }


  // ----------------------------------------------------------
  // Resolve from the same catalog used by /games.
  // ----------------------------------------------------------

  const catalog =
    await apiClient.get(
      "/games",
      {
        params: {
          q:
            "RealmLife",
        },
      }
    );


  const candidate =
    findRealmLifeGame(
      catalog.data
    );


  if (
    !candidate?.id
  ) {
    throw new Error(
      "RealmLife game could not be resolved from the Games catalog."
    );
  }


  const response =
    await apiClient.get(
      `/games/${encodeURIComponent(
        candidate.id
      )}`
    );


  return response.data;
}


export default function RealmLifeDirect() {

  const navigate =
    useNavigate();


  const [
    payload,
    setPayload,
  ] =
    useState(null);


  const [
    error,
    setError,
  ] =
    useState("");


  useEffect(() => {

    let disposed =
      false;


    document.body
      .classList
      .add(
        "or-game-playing"
      );


    document.title =
      "RealmLife · OurRealm";


    // Start downloading the heavy 3D runtime immediately,
    // while the RealmLife API request happens at the same time.
    import("@/components/games/lifesim/LifeSimRuntime")
      .catch(() => {});

    resolveRealmLife()
      .then(
        (data) => {

          if (disposed) {
            return;
          }


          if (
            data?.blocked
          ) {
            setError(
              data.message
              ||
              "RealmLife is currently unavailable."
            );

            return;
          }


          if (
            !data?.game
          ) {
            setError(
              "RealmLife game data could not be loaded."
            );

            return;
          }


          setPayload(
            data
          );
        }
      )
      .catch(
        (err) => {

          if (disposed) {
            return;
          }


          const detail =
            err?.response
              ?.data
              ?.detail;


          setError(
            typeof detail
              === "string"
              ? detail
              : (
                  detail
                    ?.message
                  ||
                  err?.message
                  ||
                  "RealmLife could not be loaded."
                )
          );
        }
      );


    return () => {

      disposed =
        true;


      document.body
        .classList
        .remove(
          "or-game-playing"
        );
    };

  }, []);


  if (error) {

    return (
      <div
        className="fixed inset-0 flex items-center justify-center p-5"
        style={{
          background:
            "#030911",

          color:
            "#fff",
        }}
      >
        <div
          className="max-w-md text-center"
        >
          <div
            className="text-2xl font-black"
          >
            RealmLife
          </div>

          <div
            className="mt-2 text-sm opacity-70"
          >
            {error}
          </div>

          <button
            type="button"
            onClick={() =>
              navigate(
                "/games"
              )
            }
            className="mt-4 rounded-xl px-4 py-2 bg-white/10 border border-white/15"
          >
            Back to Games
          </button>
        </div>
      </div>
    );
  }


  if (!payload) {

    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{
          background:
            "#030911",

          color:
            "#dffcff",
        }}
      >
        Loading RealmLife…
      </div>
    );
  }


  return (
    <div
      className="fixed inset-0"
      style={{
        background:
          "#030911",

        // Immersive fullscreen: RealmLife sits above the site chrome.
        zIndex: 50,
      }}
    >
      <React.Suspense
        fallback={
          <div
            className="fixed inset-0 flex items-center justify-center"
            style={{
              background: "#030911",
              color: "#dffcff",
            }}
          >
            Loading RealmLife world…
          </div>
        }
      >
        <LifeSimRuntime
          game={
            payload.game
          }

          progress={
            payload.progress
          }

          onExit={() =>
            navigate(
              "/games"
            )
          }
        />
      </React.Suspense>
    </div>
  );
}
