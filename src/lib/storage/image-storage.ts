import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { ImageMetadata } from "./image-validator";

export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  provider: "cloudinary" | "local" | "mock";
}

export interface UploadOptions {
  nomineeCode?: string;
  originalFilename?: string;
}

export interface ImageStorageProvider {
  upload(buffer: Buffer, metadata: ImageMetadata, options?: UploadOptions): Promise<UploadResult>;
  delete(identifierOrUrl: string): Promise<boolean>;
}

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export class StorageExecutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "StorageExecutionError";
  }
}

/**
 * Cloudinary Production Storage Provider
 */
export class CloudinaryStorageProvider implements ImageStorageProvider {
  private configured = false;

  constructor() {
    this.init();
  }

  private init() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cloudinaryUrl = process.env.CLOUDINARY_URL;

    if (cloudinaryUrl) {
      cloudinary.config({
        cloudinary_url: cloudinaryUrl,
        secure: true,
      });
      this.configured = true;
    } else if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async upload(
    buffer: Buffer,
    metadata: ImageMetadata,
    options?: UploadOptions
  ): Promise<UploadResult> {
    if (!this.configured) {
      throw new StorageConfigurationError(
        "Cloudinary credentials are not configured. Please define CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in environment variables."
      );
    }

    const cleanCode = options?.nomineeCode
      ? options.nomineeCode.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : "nominee";
    const uniqueSuffix = crypto.randomBytes(6).toString("hex");
    const publicId = `nuas_nominees/${cleanCode}_${Date.now()}_${uniqueSuffix}`;

    return new Promise<UploadResult>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          folder: "nuas_nominees",
          resource_type: "image",
          format: metadata.extension,
          allowed_formats: ["jpg", "jpeg", "png", "webp"],
          transformation: [
            { quality: "auto:good" },
            { fetch_format: "auto" },
          ],
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            reject(
              new StorageExecutionError(
                error?.message || "Failed to upload image to Cloudinary storage.",
                error
              )
            );
          } else {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              format: result.format || metadata.extension,
              bytes: result.bytes || buffer.length,
              width: result.width || metadata.width,
              height: result.height || metadata.height,
              provider: "cloudinary",
            });
          }
        }
      );

      uploadStream.end(buffer);
    });
  }

  async delete(identifierOrUrl: string): Promise<boolean> {
    if (!this.configured || !identifierOrUrl) return false;

    try {
      let publicId = identifierOrUrl;
      // Extract public_id if full Cloudinary URL is provided
      if (identifierOrUrl.includes("res.cloudinary.com")) {
        const matches = identifierOrUrl.match(/upload\/(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+$/);
        if (matches && matches[1]) {
          publicId = matches[1];
        }
      }

      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
      });
      return res.result === "ok";
    } catch (err) {
      console.warn("[Cloudinary Delete Warning]", err);
      return false;
    }
  }
}

/**
 * Local Filesystem Provider for Development/Testing Only
 * Strictly forbidden in production.
 */
export class LocalStorageProvider implements ImageStorageProvider {
  private uploadDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), "public", "uploads", "nominees");
  }

  async upload(
    buffer: Buffer,
    metadata: ImageMetadata,
    options?: UploadOptions
  ): Promise<UploadResult> {
    if (process.env.NODE_ENV === "production") {
      throw new StorageConfigurationError(
        "Local filesystem image storage is strictly forbidden in production. Configure Cloudinary storage credentials."
      );
    }

    await fs.mkdir(this.uploadDir, { recursive: true });

    const cleanCode = options?.nomineeCode
      ? options.nomineeCode.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : "nominee";
    const filename = `${cleanCode}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${metadata.extension}`;
    const filePath = path.join(this.uploadDir, filename);

    await fs.writeFile(filePath, buffer);

    return {
      url: `/uploads/nominees/${filename}`,
      publicId: `local:${filename}`,
      format: metadata.extension,
      bytes: buffer.length,
      width: metadata.width,
      height: metadata.height,
      provider: "local",
    };
  }

  async delete(identifierOrUrl: string): Promise<boolean> {
    if (!identifierOrUrl) return false;

    try {
      let filename = identifierOrUrl;
      if (identifierOrUrl.startsWith("local:")) {
        filename = identifierOrUrl.replace("local:", "");
      } else if (identifierOrUrl.startsWith("/uploads/nominees/")) {
        filename = path.basename(identifierOrUrl);
      }

      // Security: ensure filename contains no path traversal sequences
      const safeFilename = path.basename(filename);
      const filePath = path.join(this.uploadDir, safeFilename);

      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Mock In-Memory Provider strictly for automated Vitest unit tests
 */
export class MockStorageProvider implements ImageStorageProvider {
  public files = new Map<string, { buffer: Buffer; metadata: ImageMetadata }>();
  public shouldFail = false;

  async upload(
    buffer: Buffer,
    metadata: ImageMetadata,
    options?: UploadOptions
  ): Promise<UploadResult> {
    if (this.shouldFail) {
      throw new StorageExecutionError("Simulated cloud storage provider outage.");
    }

    const cleanCode = options?.nomineeCode
      ? options.nomineeCode.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : "nominee";
    const filename = `${cleanCode}_mock_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${metadata.extension}`;
    const publicId = `mock:${filename}`;
    const url = `https://res.cloudinary.com/demo/image/upload/v12345/nuas_nominees/${filename}`;

    this.files.set(publicId, { buffer, metadata });

    return {
      url,
      publicId,
      format: metadata.extension,
      bytes: buffer.length,
      width: metadata.width,
      height: metadata.height,
      provider: "mock",
    };
  }

  async delete(identifierOrUrl: string): Promise<boolean> {
    Array.from(this.files.keys()).forEach((key) => {
      if (key === identifierOrUrl || identifierOrUrl.includes(key)) {
        this.files.delete(key);
      }
    });
    return true;
  }
}

// Global active provider reference (customizable in test environments)
let customProvider: ImageStorageProvider | null = null;

export function setCustomStorageProvider(provider: ImageStorageProvider | null) {
  customProvider = provider;
}

export function getImageStorageProvider(): ImageStorageProvider {
  if (customProvider) {
    return customProvider;
  }

  const cloudinaryProvider = new CloudinaryStorageProvider();

  if (cloudinaryProvider.isConfigured()) {
    return cloudinaryProvider;
  }

  // In production, failure to configure Cloudinary must throw explicitly — never silently fall back
  if (process.env.NODE_ENV === "production") {
    throw new StorageConfigurationError(
      "Production image storage is not configured. Please define CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your production environment."
    );
  }

  // In development and testing, use local filesystem provider
  return new LocalStorageProvider();
}
