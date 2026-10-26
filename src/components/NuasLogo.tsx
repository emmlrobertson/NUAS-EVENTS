import Image from "next/image";
import Link from "next/link";

interface NuasLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  showMotto?: boolean;
  variant?: "header" | "hero" | "footer" | "admin";
  href?: string;
  className?: string;
}

export default function NuasLogo({
  size = "md",
  showText = true,
  showMotto = false,
  variant = "header",
  href,
  className = "",
}: NuasLogoProps) {
  const dimensions = {
    xs: { width: 28, height: 28 },
    sm: { width: 36, height: 36 },
    md: { width: 44, height: 44 },
    lg: { width: 64, height: 64 },
    xl: { width: 96, height: 96 },
  }[size];

  const content = (
    <div className={`nuas-logo-container nuas-logo-${variant} ${className}`}>
      <div className="nuas-logo-image-wrap">
        <Image
          src="/images/nuas-logo.png"
          alt="NUAS — National Union of Anglican Students Official Crest"
          width={dimensions.width}
          height={dimensions.height}
          priority={size === "lg" || size === "xl" || variant === "header"}
          className="nuas-logo-img"
        />
      </div>

      {showText && (
        <div className="nuas-logo-text-block">
          <div className="nuas-logo-brand-row">
            <span className="nuas-logo-title">NUAS KNUST AWARDS 2026</span>
          </div>
          {variant !== "header" && (
            <span className="nuas-logo-sub">National Union of Anglican Students</span>
          )}
          {showMotto && (
            <span className="nuas-logo-motto">
              &ldquo;FOR CHRIST &amp; MANKIND&rdquo;
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="nuas-logo-link" aria-label="NUAS KNUST Dinner and Awards Night Homepage">
        {content}
      </Link>
    );
  }

  return content;
}
