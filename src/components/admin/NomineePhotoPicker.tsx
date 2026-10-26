"use client";

import { useState, useRef, useEffect } from "react";

interface NomineePhotoPickerProps {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  nomineeName?: string;
  nomineeCode?: string;
  nomineeId?: string;
  disabled?: boolean;
}

export default function NomineePhotoPicker({
  value,
  onChange,
  nomineeName = "Nominee",
  nomineeCode = "",
  nomineeId = "",
  disabled = false,
}: NomineePhotoPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value || null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [showManualUrl, setShowManualUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState(value || "");

  useEffect(() => {
    setPreviewUrl(value || null);
    setManualUrl(value || "");
  }, [value]);

  const initials = nomineeName
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "NA";

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadSuccess(null);

    // Client-side pre-validation
    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      setUploadError("Invalid format. Please select a JPG, PNG, or WebP photo.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(`Selected file is ${sizeMb} MB. Maximum allowed size is 5 MB.`);
      return;
    }

    // Immediate local preview
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    // Upload to server
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (nomineeCode) formData.append("nomineeCode", nomineeCode);
      if (nomineeId) formData.append("nomineeId", nomineeId);

      const res = await fetch("/api/admin/nominees/upload", {
        method: "POST",
        headers: {
          "x-csrf-protect": "1",
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload photo to storage.");
      }

      setPreviewUrl(data.url);
      setManualUrl(data.url);
      onChange(data.url);
      setUploadSuccess(`Photo uploaded successfully (${data.width}x${data.height}px).`);
    } catch (err: unknown) {
      setPreviewUrl(value || null);
      if (err instanceof Error) {
        setUploadError(err.message);
      } else {
        setUploadError("An unexpected error occurred while uploading the photo.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleRemovePhoto() {
    setPreviewUrl(null);
    setManualUrl("");
    setUploadError(null);
    setUploadSuccess(null);
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleManualUrlChange(url: string) {
    setManualUrl(url);
    const trimmed = url.trim();
    setPreviewUrl(trimmed || null);
    onChange(trimmed || null);
  }

  return (
    <div className="nominee-photo-picker-container" style={{ margin: "0.75rem 0 1.25rem 0" }}>
      <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.875rem" }}>
        Nominee Profile Photo
      </label>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          padding: "1rem",
          background: "var(--color-bg-subtle, #f8fafc)",
          border: "1px solid var(--color-border-card, #e2e8f0)",
          borderRadius: "10px",
          flexWrap: "wrap",
        }}
      >
        {/* Avatar Preview Box */}
        <div
          style={{
            width: "88px",
            height: "88px",
            borderRadius: "12px",
            overflow: "hidden",
            position: "relative",
            background: "#ffffff",
            border: "2px solid rgba(217, 119, 6, 0.3)",
            boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`${nomineeName} preview`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
              onError={() => {
                setUploadError("Unable to display photo preview. Please verify image URL.");
                setPreviewUrl(null);
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #1b365d 0%, #10223d 100%)",
                color: "#ffffff",
                fontWeight: 800,
                fontSize: "1.5rem",
                letterSpacing: "0.05em",
              }}
            >
              {initials}
            </div>
          )}

          {uploading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(15, 23, 42, 0.7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontSize: "0.75rem",
                fontWeight: 600,
                textAlign: "center",
                padding: "0.25rem",
              }}
            >
              Uploading...
            </div>
          )}
        </div>

        {/* Controls Column */}
        <div style={{ flex: 1, minWidth: "220px" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleFileSelect}
              disabled={disabled || uploading}
              id="nominee-photo-file-input"
            />

            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="admin-action-btn admin-btn-activate"
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.825rem" }}
            >
              {uploading ? (
                "Uploading..."
              ) : previewUrl ? (
                <>&#128247; Replace Photo</>
              ) : (
                <>&#128247; Choose Photo</>
              )}
            </button>

            {previewUrl && (
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={handleRemovePhoto}
                className="admin-action-btn admin-btn-delete"
                style={{ padding: "0.45rem 0.85rem", fontSize: "0.825rem" }}
                title="Remove photo and revert to initials placeholder"
              >
                Remove Photo
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowManualUrl(!showManualUrl)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-navy-light, #2a4d7f)",
                textDecoration: "underline",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: "0.2rem",
              }}
            >
              {showManualUrl ? "Hide URL Field" : "Enter Image URL Manually"}
            </button>
          </div>

          <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.75rem", color: "var(--color-text-dim, #64748b)" }}>
            Supported formats: JPG, PNG, WebP (Max 5 MB).
          </p>

          {/* Optional Direct URL Input */}
          {showManualUrl && (
            <div style={{ marginTop: "0.5rem" }}>
              <input
                type="url"
                value={manualUrl}
                disabled={disabled || uploading}
                onChange={(e) => handleManualUrlChange(e.target.value)}
                placeholder="https://res.cloudinary.com/... or image URL"
                className="admin-input"
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.6rem" }}
              />
            </div>
          )}

          {/* Feedback Alerts */}
          {uploadError && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.35rem 0.65rem",
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: "6px",
                color: "#b91c1c",
                fontSize: "0.775rem",
                fontWeight: 600,
              }}
            >
              {uploadError}
            </div>
          )}

          {uploadSuccess && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.35rem 0.65rem",
                background: "#ecfdf5",
                border: "1px solid #a7f3d0",
                borderRadius: "6px",
                color: "#047857",
                fontSize: "0.775rem",
                fontWeight: 600,
              }}
            >
              &#10003; {uploadSuccess}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
