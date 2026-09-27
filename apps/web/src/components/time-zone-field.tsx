'use client';

import { type ReactNode, useEffect, useState } from 'react';

/**
 * The time zone step's field (T-620). The server renders the stored zone (or
 * UTC), so the form works without script. With script, and when `propose` is
 * set, the browser's own zone -- `Intl`'s, read on this device, never from an
 * address -- is selected and named above the list, for the reader to confirm
 * or change. Nothing is saved until they submit.
 */
export function TimeZoneField({
  zones,
  initial,
  propose,
  label,
  browserNote,
  confirmNote,
}: {
  zones: string[];
  initial: string;
  propose: boolean;
  label: ReactNode;
  browserNote: ReactNode;
  confirmNote: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [browser, setBrowser] = useState<string | null>(null);

  useEffect(() => {
    if (!propose) return;
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    if (zone !== undefined && zones.includes(zone)) {
      // Reading the device's zone is only possible after hydration; this
      // effect exists to sync with that external value once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrowser(zone);
      setValue(zone);
    }
  }, [propose, zones]);

  return (
    <div className="flex flex-col gap-2">
      {browser !== null && (
        <p role="status" data-testid="first-run-browser-zone">
          {browserNote} <strong>{browser}</strong>. {confirmNote}
        </p>
      )}
      <label htmlFor="first-run-timezone" className="text-sm font-medium">
        {label}
      </label>
      <select
        id="first-run-timezone"
        name="timezone"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="rounded border border-current/30 bg-transparent px-3 py-2 text-start"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </div>
  );
}
