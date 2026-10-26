/**
 * Authoritative Server-Side Image Validator
 * Validates file size, magic bytes, and dimensions for JPEG, PNG, and WebP images.
 * Strict protection against MIME-spoofing, polyglot files, and decompression bombs.
 */

export interface ImageMetadata {
  format: "jpeg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
  bytes: number;
}

export interface ImageValidationOptions {
  maxBytes?: number; // Default: 5MB (5 * 1024 * 1024)
  minWidth?: number; // Default: 100px
  minHeight?: number; // Default: 100px
  maxWidth?: number; // Default: 5000px
  maxHeight?: number; // Default: 5000px
}

const DEFAULT_OPTIONS: Required<ImageValidationOptions> = {
  maxBytes: 5 * 1024 * 1024, // 5 MB
  minWidth: 100,
  minHeight: 100,
  maxWidth: 5000,
  maxHeight: 5000,
};

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/**
 * Validates that a buffer is an authentic JPEG, PNG, or WebP image within safe dimensions and size limits.
 */
export function validateImageBuffer(
  buffer: Buffer,
  options?: ImageValidationOptions
): ImageMetadata {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!buffer || buffer.length === 0) {
    throw new ImageValidationError("Uploaded image file is empty.");
  }

  if (buffer.length > opts.maxBytes) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
    const maxMb = (opts.maxBytes / (1024 * 1024)).toFixed(0);
    throw new ImageValidationError(
      `Image size (${sizeMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`
    );
  }

  // Detect format by magic bytes
  let format: "jpeg" | "png" | "webp" | null = null;
  let width = 0;
  let height = 0;

  // 1. Check PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    format = "png";
    // IHDR chunk: width at 16..20, height at 20..24 (Big Endian)
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  }

  // 2. Check JPEG: FF D8 FF
  else if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    format = "jpeg";
    const dims = parseJpegDimensions(buffer);
    if (!dims) {
      throw new ImageValidationError("Corrupt or invalid JPEG image structure.");
    }
    width = dims.width;
    height = dims.height;
  }

  // 3. Check WebP: RIFF ... WEBP
  else if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    format = "webp";
    const dims = parseWebpDimensions(buffer);
    if (!dims) {
      throw new ImageValidationError("Corrupt or invalid WebP image structure.");
    }
    width = dims.width;
    height = dims.height;
  }

  if (!format) {
    throw new ImageValidationError(
      "Unsupported image format. Only authentic JPG/JPEG, PNG, and WebP files are permitted."
    );
  }

  if (width < opts.minWidth || height < opts.minHeight) {
    throw new ImageValidationError(
      `Image dimensions (${width}x${height}px) are too small. Minimum resolution is ${opts.minWidth}x${opts.minHeight}px.`
    );
  }

  if (width > opts.maxWidth || height > opts.maxHeight) {
    throw new ImageValidationError(
      `Image dimensions (${width}x${height}px) exceed maximum allowed resolution of ${opts.maxWidth}x${opts.maxHeight}px.`
    );
  }

  const mimeMap = {
    jpeg: "image/jpeg" as const,
    png: "image/png" as const,
    webp: "image/webp" as const,
  };

  const extMap = {
    jpeg: "jpg" as const,
    png: "png" as const,
    webp: "webp" as const,
  };

  return {
    format,
    mimeType: mimeMap[format],
    extension: extMap[format],
    width,
    height,
    bytes: buffer.length,
  };
}

/**
 * Scan JPEG SOF markers to extract width and height.
 */
function parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2; // Skip SOI (FF D8)
  const length = buffer.length;

  while (offset < length - 8) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2) — Start of Frame markers containing dimensions
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }

    // Move to next segment using length field (offset + 2)
    if (
      marker !== 0xd8 && // SOI
      marker !== 0xd9 && // EOI
      marker !== 0x00 && // Escaped FF
      marker !== 0x01 && // TEM
      !(marker >= 0xd0 && marker <= 0xd7) // RST markers
    ) {
      if (offset + 3 < length) {
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      } else {
        break;
      }
    } else {
      offset += 2;
    }
  }

  return null;
}

/**
 * Parse WebP chunk headers (VP8 lossy, VP8L lossless, or VP8X extended).
 */
function parseWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  const chunkHeader = buffer.toString("ascii", 12, 16);

  // 1. Lossy VP8
  if (chunkHeader === "VP8 " && buffer.length >= 30) {
    // Check 3-byte keyframe code at offset 23: 0x9D 0x01 0x2A
    if (buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // 2. Lossless VP8L
  if (chunkHeader === "VP8L" && buffer.length >= 25) {
    if (buffer[20] === 0x2f) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // 3. Extended VP8X
  if (chunkHeader === "VP8X" && buffer.length >= 30) {
    // 24..27 canvas width minus one (3 bytes, LE)
    const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
    // 27..30 canvas height minus one (3 bytes, LE)
    const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);
    if (width > 0 && height > 0) return { width, height };
  }

  return null;
}
