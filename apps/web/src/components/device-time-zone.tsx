'use client';

import { useEffect } from 'react';

/**
 * Selects this device's own time zone in a form's zone list (T-1480), once,
 * after load: the register form otherwise opened on UTC, and a reader who did
 * not look registered in it. `Intl` reads the zone on this device, never from
 * an address. Only a zone the list offers is chosen, only while the list
 * still shows the server's default, and nothing is saved until the form is
 * sent. Without script the server's default stands.
 */
export function DeviceTimeZone({
  form,
  field,
  unless,
}: {
  form: string;
  field: string;
  unless: string;
}) {
  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    const select = document.querySelector<HTMLSelectElement>(
      `form[data-testid="${form}"] select[name="${field}"]`,
    );
    if (zone === undefined || select === null || select.value !== unless) return;
    if ([...select.options].some((option) => option.value === zone)) select.value = zone;
  }, [form, field, unless]);
  return null;
}
