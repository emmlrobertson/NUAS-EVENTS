import { getEnv } from "@/lib/env";

export interface ClientIpExtractionResult {
  ip: string;
  isTrusted: boolean;
  source: "socket" | "cf-connecting-ip" | "x-real-ip" | "x-forwarded-for" | "unknown";
}

export interface ClientIpOptions {
  trustProxy?: boolean;
}

/**
 * Shared Client IP Extraction Policy for NUAS KNUST Platform.
 *
 * ARCHITECTURAL SPECIFICATION & DEPLOYMENT CONFIGURATION:
 * --------------------------------------------------------
 * 1. UNTRUSTED PROXY MODE (default when TRUST_PROXY is false or omitted):
 *    - Applicable for direct node servers or deployments without a dedicated, verified upstream proxy.
 *    - Client-supplied headers (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`)
 *      are STRICTLY IGNORED. An untrusted adversary can trivially inject arbitrary values into these
 *      headers to spoof client identities and evade IP-based rate limiting or auditing.
 *    - Only the direct peer socket IP (e.g. NextRequest.ip provided by the Edge/Node runtime socket)
 *      is trusted.
 *    - If no runtime socket IP is available (e.g. absent in standard synthetic or decoupled HTTP requests),
 *      the policy returns "unknown-client". It NEVER silently masks all absent traffic as "127.0.0.1",
 *      which would cluster diverse external clients into one shared rate-limiting bucket.
 *
 * 2. TRUSTED PROXY MODE (enabled via TRUST_PROXY=true in production):
 *    - MUST be enabled ONLY when the hosting environment places the application behind an authoritative
 *      reverse proxy (such as Cloudflare, AWS CloudFront/ALB, Vercel Edge Network, or Nginx) that is
 *      EXPLICITLY CONFIGURED to strip or overwrite any incoming client-supplied forwarding headers.
 *    - Proxy headers are evaluated in strict priority:
 *      a. `CF-Connecting-IP` / `True-Client-IP` (validated by Cloudflare / CDN edge)
 *      b. `X-Real-IP` (single-hop reverse proxy client address)
 *      c. Leftmost IP of `X-Forwarded-For` (canonical client address prepended by trusted ingress)
 *    - If trusted proxy headers are absent, falls back to direct runtime socket IP or "unknown-client".
 */
export function extractClientIp(
  request: Request | { headers: Headers | Record<string, string | string[] | undefined>; ip?: string },
  options?: ClientIpOptions
): ClientIpExtractionResult {
  let trustProxy = options?.trustProxy;
  if (trustProxy === undefined) {
    try {
      trustProxy = getEnv().TRUST_PROXY;
    } catch {
      // Fallback if environment is not yet initialized
      trustProxy = process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1";
    }
  }

  // Direct socket IP provided by Next.js / Node runtime socket
  const socketIp =
    "ip" in request && typeof request.ip === "string" && request.ip.trim().length > 0
      ? request.ip.trim()
      : undefined;

  if (!trustProxy) {
    if (socketIp) {
      return { ip: socketIp, isTrusted: true, source: "socket" };
    }
    // Do NOT silently assign "127.0.0.1" for unidentifiable clients.
    return { ip: "unknown-client", isTrusted: false, source: "unknown" };
  }

  // Trusted proxy mode: read proxy headers safely
  const getHeader = (name: string): string | null => {
    if ("headers" in request && request.headers) {
      if (typeof (request.headers as any).get === "function") {
        return (request.headers as Headers).get(name);
      }
      const val =
        (request.headers as Record<string, any>)[name] ??
        (request.headers as Record<string, any>)[name.toLowerCase()];
      if (Array.isArray(val)) return val[0];
      return typeof val === "string" ? val : null;
    }
    return null;
  };

  const cfConnectingIp = getHeader("cf-connecting-ip") || getHeader("true-client-ip");
  if (cfConnectingIp && cfConnectingIp.trim().length > 0) {
    return { ip: cfConnectingIp.trim(), isTrusted: true, source: "cf-connecting-ip" };
  }

  const xRealIp = getHeader("x-real-ip");
  if (xRealIp && xRealIp.trim().length > 0) {
    return { ip: xRealIp.trim(), isTrusted: true, source: "x-real-ip" };
  }

  const xForwardedFor = getHeader("x-forwarded-for");
  if (xForwardedFor) {
    const parts = xForwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return { ip: parts[0], isTrusted: true, source: "x-forwarded-for" };
    }
  }

  if (socketIp) {
    return { ip: socketIp, isTrusted: true, source: "socket" };
  }

  return { ip: "unknown-client", isTrusted: false, source: "unknown" };
}

/**
 * Convenience helper returning the extracted client IP string.
 */
export function getClientIp(
  request: Request | { headers: Headers | Record<string, string | string[] | undefined>; ip?: string },
  options?: ClientIpOptions
): string {
  return extractClientIp(request, options).ip;
}
