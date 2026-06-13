import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const apiClient = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Attach bearer token (fallback for environments where cookies are blocked)
apiClient.interceptors.request.use((cfg) => {
  try {
    const t = localStorage.getItem("ourrealm.access");
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
  } catch { /* ignore */ }
  return cfg;
});

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default apiClient;
