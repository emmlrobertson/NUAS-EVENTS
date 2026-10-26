import crypto from "crypto";
import QRCode from "qrcode";

const QR_VERSION_PREFIX = "NUAS-TKT-V1";

/**
 * Returns the dedicated secret key for signing and validating QR credentials and ticket access keys.
 * In production: Strictly requires TICKET_SIGNING_SECRET (>= 32 chars).
 * Silent fallback to SESSION_SECRET is strictly forbidden.
 */
export function getTicketSigningSecret(): string {
  const secret = process.env.TICKET_SIGNING_SECRET;

  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.trim().length < 32) {
      throw new Error(
        "[FATAL SECURITY] Dedicated TICKET_SIGNING_SECRET must be explicitly configured with at least 32 characters in production. Silent fallback to SESSION_SECRET is strictly forbidden."
      );
    }
    return secret.trim();
  }

  // Development and testing fallback
  return secret?.trim() || "dev-ticket-signing-secret-minimum-32-chars-long";
}

/**
 * Derives a clean 3-4 character classification tag from the ticket type name.
 */
function deriveTypeCode(ticketTypeName: string): string {
  const cleaned = ticketTypeName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length <= 4) return cleaned || "TKT";
  if (cleaned.includes("VIP")) return "VIP";
  if (cleaned.includes("COUPLE")) return "CPL";
  if (cleaned.includes("REGULAR") || cleaned.includes("SINGLE")) return "REG";
  if (cleaned.includes("TABLE")) return "TBL";
  return cleaned.slice(0, 3);
}

/**
 * Generates a human-readable, collision-resistant ticket number.
 * Example: NUAS26-VIP-4A8E2B
 */
export function generateTicketNumber(ticketTypeName: string, year = 26): string {
  const typeCode = deriveTypeCode(ticketTypeName);
  const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `NUAS${year}-${typeCode}-${randomHex}`;
}

export interface GeneratedQrCredential {
  qrPayload: string;
  ticketId: string;
  nonce: string;
  signature: string;
}

/**
 * Generates a cryptographically signed, unguessable QR credential.
 * 
 * Payload structure: NUAS-TKT-V1.<ticketId>.<nonce>.<hmacSignature>
 * - Never includes PII (no phone, no email, no personal details).
 * - Nonce provides 128 bits of CSPRNG entropy.
 * - HMAC-SHA256 signature guarantees authenticity and tamper resistance.
 */
export function createQrCredential(ticketId: string): GeneratedQrCredential {
  if (!ticketId || typeof ticketId !== "string" || ticketId.trim().length === 0) {
    throw new Error("Cannot create QR credential: valid ticketId is required.");
  }

  const cleanTicketId = ticketId.trim();
  const nonce = crypto.randomBytes(16).toString("hex");
  const secret = getTicketSigningSecret();

  const dataToSign = `${QR_VERSION_PREFIX}:${cleanTicketId}:${nonce}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest("base64url");

  const qrPayload = `${QR_VERSION_PREFIX}.${cleanTicketId}.${nonce}.${signature}`;

  return {
    qrPayload,
    ticketId: cleanTicketId,
    nonce,
    signature,
  };
}

export interface QrVerificationResult {
  valid: boolean;
  ticketId?: string;
  error?: string;
}

/**
 * Parses and cryptographically validates a QR payload.
 * Uses timingSafeEqual to protect against side-channel timing attacks.
 */
export function parseAndVerifyQrCredential(qrPayload: string): QrVerificationResult {
  if (!qrPayload || typeof qrPayload !== "string") {
    return { valid: false, error: "Missing or invalid QR payload." };
  }

  const parts = qrPayload.trim().split(".");
  if (parts.length !== 4) {
    return { valid: false, error: "Invalid QR credential token structure." };
  }

  const [prefix, ticketId, nonce, signature] = parts;

  if (prefix !== QR_VERSION_PREFIX) {
    return { valid: false, error: "Unsupported QR credential version." };
  }

  if (!ticketId || !nonce || !signature) {
    return { valid: false, error: "Malformed QR credential components." };
  }

  const secret = getTicketSigningSecret();
  const dataToSign = `${QR_VERSION_PREFIX}:${ticketId}:${nonce}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest("base64url");

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (signatureBuf.length !== expectedBuf.length) {
    return { valid: false, error: "Invalid QR signature." };
  }

  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return { valid: false, error: "Invalid QR signature." };
  }

  return {
    valid: true,
    ticketId,
  };
}

/**
 * Generates an unguessable, cryptographically signed capability access key for viewing an individual ticket.
 * Prevents URL parameter tampering / predictable sequential ID enumeration.
 */
export function generateTicketAccessKey(ticketId: string, ticketNumber: string): string {
  const secret = getTicketSigningSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(`NUAS-TKT-VIEW:${ticketId}:${ticketNumber}`)
    .digest("hex");
}

/**
 * Verifies a ticket capability access key in constant time.
 */
export function verifyTicketAccessKey(
  ticketId: string,
  ticketNumber: string,
  accessKey: string
): boolean {
  if (!accessKey || typeof accessKey !== "string") return false;

  const expectedKey = generateTicketAccessKey(ticketId, ticketNumber);
  const keyBuf = Buffer.from(accessKey.trim());
  const expectedBuf = Buffer.from(expectedKey);

  if (keyBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, expectedBuf);
}

/**
 * Generates an access key for viewing all tickets belonging to a specific order.
 */
export function generateOrderAccessKey(orderId: string, orderNumber: string): string {
  const secret = getTicketSigningSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(`NUAS-ORDER-VIEW:${orderId}:${orderNumber}`)
    .digest("hex");
}

/**
 * Verifies an order capability access key in constant time.
 */
export function verifyOrderAccessKey(
  orderId: string,
  orderNumber: string,
  accessKey: string
): boolean {
  if (!accessKey || typeof accessKey !== "string") return false;

  const expectedKey = generateOrderAccessKey(orderId, orderNumber);
  const keyBuf = Buffer.from(accessKey.trim());
  const expectedBuf = Buffer.from(expectedKey);

  if (keyBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, expectedBuf);
}

/**
 * Renders a QR code as a high-resolution PNG Data URL.
 * Uses #0B132B (Gala Navy) for contrast and medium error correction.
 */
export async function generateQrCodeDataUrl(payload: string): Promise<string> {
  return await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: {
      dark: "#0B132B",
      light: "#FFFFFF",
    },
  });
}

/**
 * Renders a QR code as an SVG string for crisp vector printing / scaling.
 */
export async function generateQrCodeSvg(payload: string): Promise<string> {
  return await QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: {
      dark: "#0B132B",
      light: "#FFFFFF",
    },
  });
}

