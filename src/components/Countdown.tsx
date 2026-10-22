"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
  targetDateIso: string;
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
  label = "Countdown to Saturday, 21 November 2026",
}: CountdownProps) {
  const targetTimestamp = new Date(targetDateIso).getTime();
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<TimeRemaining>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isPast: false,
  });

  useEffect(() => {
    setMounted(true);
    setTimeLeft(calculateTimeRemaining(targetTimestamp));

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeRemaining(targetTimestamp));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTimestamp]);

  if (!mounted) {
    // Render static placeholder during SSR to avoid hydration mismatch
    return (
      <div className="countdown-container">
        <p className="countdown-label">{label}</p>
        <span className="countdown-provisional-note">
          Date-only provisional countdown • Official event start time to be announced
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
        <p className="countdown-label">{label}</p>
        <div className="countdown-past-badge">Event Day Has Arrived</div>
      </div>
    );
  }

  return (
    <div className="countdown-container">
      <p className="countdown-label">{label}</p>
      <span className="countdown-provisional-note">
        Date-only provisional countdown • Official event start time to be announced
      </span>
      <div className="countdown-boxes" role="timer" aria-label={label}>
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
