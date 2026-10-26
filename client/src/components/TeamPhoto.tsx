import { useEffect, useState } from "react";

/**
 * A team member's photo with the same fallback the page uses when there is no photo at all: the initial, in gold.
 * Oct 26, 2026: a headshot stored as a Google Drive link that Drive refuses showed as an empty box on the home page.
 */
export default function TeamPhoto({ photo, name, className, fallbackClassName }: { photo: string | null | undefined; name: string; className: string; fallbackClassName: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photo]);
  if (photo && !failed) return <img src={photo} alt={name} className={className} onError={() => setFailed(true)} />;
  return <span className={fallbackClassName} data-team-photo-fallback="true">{name.charAt(0)}</span>;
}
