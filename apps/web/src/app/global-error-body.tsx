'use client';

import { ErrorPageBody } from '@/components/error-page';
import '@fontsource-variable/vazirmatn';
// The interface face of a Latin-script page (D-198, D-263); the error page draws no
// editorial or mono text, so it needs no other family.
import '@fontsource-variable/archivo/wdth.css';
import './globals.css';

/**
 * The last boundary's body with its styles (T-809, T-1536). `global-error`
 * loads it only when it is drawn: a stylesheet imported by `global-error`
 * itself travels inside every page's HTML (the page's own copy of the same
 * 83 kB, which the HTML already carries in its <style>), whether or not
 * anything fails.
 */
export const GlobalErrorBody = ErrorPageBody;
