const PLANNER_SESSION_COOKIE_NAME = "planner-session-id";
const PLANNER_SESSION_STORAGE_KEY = "planner-session-id";
const PLANNER_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ResolvedClientPlannerSession = {
  sessionId: string | null;
  reloadRequired: boolean;
};

function readNamedCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    const key = separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie;
    if (key !== name) {
      continue;
    }

    const value = separatorIndex >= 0 ? cookie.slice(separatorIndex + 1) : "";
    return value ? decodeURIComponent(value) : null;
  }

  return null;
}

export function getPlannerSessionCookieName() {
  return PLANNER_SESSION_COOKIE_NAME;
}

export function writePlannerSessionCookie(sessionId: string) {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = [
    `${PLANNER_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${PLANNER_SESSION_COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function resolveClientPlannerSessionId(
  initialSessionId?: string | null
): ResolvedClientPlannerSession {
  if (typeof window === "undefined") {
    return {
      sessionId: initialSessionId ?? null,
      reloadRequired: false,
    };
  }

  const cookieSessionId = readNamedCookie(PLANNER_SESSION_COOKIE_NAME);
  const legacySessionId = window.localStorage.getItem(PLANNER_SESSION_STORAGE_KEY);
  const sessionId =
    cookieSessionId ??
    legacySessionId ??
    (typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : null);

  if (!sessionId) {
    return {
      sessionId: null,
      reloadRequired: false,
    };
  }

  writePlannerSessionCookie(sessionId);
  window.localStorage.setItem(PLANNER_SESSION_STORAGE_KEY, sessionId);

  return {
    sessionId,
    reloadRequired:
      (Boolean(initialSessionId) && initialSessionId !== sessionId) ||
      (!initialSessionId && Boolean(legacySessionId) && legacySessionId === sessionId),
  };
}
