/** Joins class lists, dropping the empty ones. No merging: a component's classes and the caller's must not fight. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part) => typeof part === 'string' && part.trim() !== '').join(' ');
}
