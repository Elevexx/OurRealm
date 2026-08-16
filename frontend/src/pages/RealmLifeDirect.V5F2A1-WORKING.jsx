import React, {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import apiClient from "@/api/client";

import LifeSimRuntime from "@/components/games/lifesim/LifeSimRuntime";


const GAME_ID =
  "realmlife-home-v1";


export default function RealmLifeDirect() {
  const navigate =
    useNavigate();

  const [payload, setPayload] =
    useState(null);

  const [error, setError] =
    useState("");


  useEffect(() => {
    let disposed =
      false;

    document.body.classList.add(
      "or-game-playing"
    );

    document.title =
      "RealmLife · OurRealm";


    apiClient
      .get(
        `/games/${GAME_ID}`
      )
      .then(
        (response) => {
          if (disposed)
            return;

          if (
            response.data?.blocked
          ) {
            setError(
              response.data?.message
              ||
              "RealmLife is currently unavailable."
            );

            return;
          }

          setPayload(
            response.data
          );
        }
      )
      .catch(
        (err) => {
          if (disposed)
            return;

          const detail =
            err?.response
              ?.data
              ?.detail;

          setError(
            typeof detail === "string"
              ? detail
              : (
                  detail?.message
                  ||
                  "RealmLife could not be loaded."
                )
          );
        }
      );


    return () => {
      disposed = true;

      document.body.classList.remove(
        "or-game-playing"
      );
    };
  }, []);


  if (error) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center p-5"
        style={{
          background: "#030911",
          color: "#fff",
        }}
      >
        <div className="text-center">
          <div className="text-2xl font-black">
            RealmLife
          </div>

          <div className="mt-2 opacity-70">
            {error}
          </div>

          <button
            type="button"
            onClick={() =>
              navigate("/games")
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
          background: "#030911",
          color: "#dffcff",
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
        background: "#030911",
      }}
    >
      <LifeSimRuntime
        game={payload.game}
        progress={payload.progress}
        onExit={() =>
          navigate("/games")
        }
      />
    </div>
  );
}
