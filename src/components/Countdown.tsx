"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
  targetDateIso?: string | null;
  label?: string;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
}

function calculateTimeRemaining(targetTimestamp: number): TimeRemaining {
  const now = Date.now();
  const diff = targetTimestamp - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true };
  }

  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / 1000 / 60) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  return { days, hours, minutes, seconds, isPast: false };
}

export default function Countdown({
  targetDateIso,
  label,
}: CountdownProps) {
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<TimeRemaining>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isPast: false,
  });

  const parsedTimestamp = targetDateIso ? new Date(targetDateIso).getTime() : NaN;
  const hasValidTarget = !isNaN(parsedTimestamp);

  const displayLabel =
    label ||
    (hasValidTarget
      ? `Countdown to ${new Date(parsedTimestamp).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`
      : "Event Date To Be Announced");

  useEffect(() => {
    setMounted(true);
    if (!hasValidTarget) return;

    setTimeLeft(calculateTimeRemaining(parsedTimestamp));

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeRemaining(parsedTimestamp));
    }, 1000);

    return () => clearInterval(interval);
  }, [hasValidTarget, parsedTimestamp]);

  if (!hasValidTarget) {
    return (
      <div className="countdown-container">
        <p className="countdown-label">{displayLabel}</p>
        <span className="countdown-provisional-note">
          Official event schedule to be announced by the planning committee
        </span>
        <div className="countdown-boxes">
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Days</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Hours</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Mins</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Secs</span></div>
        </div>
      </div>
    );
  }

  if (!mounted) {
    // Render static placeholder during SSR to avoid hydration mismatch
    return (
      <div className="countdown-container">
        <p className="countdown-label">{displayLabel}</p>
        <span className="countdown-provisional-note">
          Provisional countdown • Subject to official ceremony commencement
        </span>
        <div className="countdown-boxes">
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Days</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Hours</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Mins</span></div>
          <div className="countdown-box"><span className="countdown-value">--</span><span className="countdown-unit">Secs</span></div>
        </div>
      </div>
    );
  }

  if (timeLeft.isPast) {
    return (
      <div className="countdown-container">
        <p className="countdown-label">{displayLabel}</p>
        <div className="countdown-past-badge">Event Day Has Arrived</div>
      </div>
    );
  }

  return (
    <div className="countdown-container">
      <p className="countdown-label">{displayLabel}</p>
      <span className="countdown-provisional-note">
        Official event date countdown • Knust Campus
      </span>
      <div className="countdown-boxes" role="timer" aria-label={displayLabel}>
        <div className="countdown-box">
          <span className="countdown-value">{String(timeLeft.days).padStart(2, "0")}</span>
          <span className="countdown-unit">Days</span>
        </div>
        <div className="countdown-box">
          <span className="countdown-value">{String(timeLeft.hours).padStart(2, "0")}</span>
          <span className="countdown-unit">Hours</span>
        </div>
        <div className="countdown-box">
          <span className="countdown-value">{String(timeLeft.minutes).padStart(2, "0")}</span>
          <span className="countdown-unit">Mins</span>
        </div>
        <div className="countdown-box">
          <span className="countdown-value">{String(timeLeft.seconds).padStart(2, "0")}</span>
          <span className="countdown-unit">Secs</span>
        </div>
      </div>
    </div>
  );
}
