/**
 * Lazy-load the YouTube IFrame Player API exactly once per page. All
 * VideoEmbed instances share the same `<script>` load; each one creates
 * its own `YT.Player` instance against a unique placeholder element.
 *
 * Returns a Promise that resolves with the global `YT` namespace once
 * `onYouTubeIframeAPIReady` has fired.
 */
let _ytPromise = null;

export function loadYouTubeApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_ytPromise) return _ytPromise;

  _ytPromise = new Promise((resolve, reject) => {
    // Chain onto any pre-existing callback so we don't clobber third parties.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { if (typeof prev === "function") prev(); } catch (e) { /* noop */ }
      if (window.YT && window.YT.Player) resolve(window.YT);
      else reject(new Error("YT.Player not present after API ready"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
    document.head.appendChild(tag);
  });
  return _ytPromise;
}
