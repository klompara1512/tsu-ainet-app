import { useState } from "react";

type TeamLogoSize = "small" | "normal" | "large" | "hero";

type Props = {
  url?: string;
  name: string;
  size?: TeamLogoSize;
  className?: string;
};

function TeamLogo({ url = "", name, size = "normal", className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "⚽";

  const classes = `team-logo team-logo-${size} ${className}`.trim();

  if (!url || failed) {
    return (
      <span className={`${classes} team-logo-fallback`} aria-label={`${name} Logo nicht verfügbar`}>
        {initials}
      </span>
    );
  }

  return (
    <img
      className={classes}
      src={url}
      alt={`${name} Logo`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export default TeamLogo;
