import type { Audience } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { LOCALES } from '@/i18n/locales';
import { createAudienceAction } from '@/lib/campaign-actions';

/**
 * Audiences (T-332, D-075): saved filters with a live size. The vocabulary
 * is the form: what a member follows, where they are, what they read,
 * whether they verified, when they joined. Nothing here is a score.
 */
function describe(audience: Audience): string {
  const parts: string[] = [];
  const f = audience.filter;
  if (f.follows) parts.push(`follows ${f.follows.type} ${f.follows.id}`);
  if (f.country_id) parts.push(`country ${f.country_id}`);
  if (f.language) parts.push(`reads ${f.language}`);
  if (f.verified_only) parts.push('verified only');
  if (f.joined_after) parts.push(`joined after ${f.joined_after.slice(0, 10)}`);
  return parts.length === 0 ? 'every active member' : parts.join(' · ');
}

export function AudiencesAdmin({ locale, audiences }: { locale: string; audiences: Audience[] }) {
  return (
    <section className="flex flex-col gap-4" data-testid="audiences">
      <h2 className="text-lg font-semibold">Audiences</h2>
      <p className="text-sm opacity-70">
        A saved filter over members, and how many it reaches right now. An audience never changes;
        save a new one instead.
      </p>
      {audiences.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="audiences-empty">
          No audience saved yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-current/10" data-testid="audience-list">
          {audiences.map((audience) => (
            <li key={audience.id} className="flex flex-col gap-1 py-2" data-testid="audience">
              <span className="font-medium">
                {audience.name}{' '}
                <span className="text-sm opacity-70">· {audience.size} members</span>
              </span>
              <span className="text-sm opacity-80">{describe(audience)}</span>
              <span className="text-xs opacity-60">
                {audience.created_by ?? 'somebody'} · {audience.reason} · {audience.created_at}
              </span>
              <code className="text-xs opacity-60">{audience.id}</code>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm underline">Save a new audience</summary>
        <div className="pt-3">
          <ActionForm
            action={createAudienceAction.bind(null, locale)}
            fields={[
              { name: 'name', label: 'Name', required: true, maxLength: 80 },
              {
                name: 'follows_type',
                label: 'Follows',
                type: 'select',
                options: [
                  { value: 'none', label: 'no condition' },
                  { value: 'team', label: 'a team' },
                  { value: 'competition', label: 'a competition' },
                ],
              },
              {
                name: 'follows_id',
                label: 'Team or competition id',
                hint: 'The id, never a name.',
              },
              { name: 'country_id', label: 'Country id', hint: 'Leave empty for any country.' },
              {
                name: 'language',
                label: 'Reads',
                type: 'select',
                options: [
                  { value: 'any', label: 'any language' },
                  ...LOCALES.filter((code) => !code.startsWith('x-')).map((code) => ({
                    value: code,
                    label: code,
                  })),
                ],
              },
              { name: 'verified_only', label: 'Verified e-mail only', type: 'checkbox' },
              { name: 'joined_after', label: 'Joined after', hint: 'YYYY-MM-DD, or empty.' },
              { name: 'reason', label: 'Why this audience', required: true, maxLength: 300 },
            ]}
            submitLabel="Save audience"
            testId="audience-create"
          />
        </div>
      </details>
    </section>
  );
}
