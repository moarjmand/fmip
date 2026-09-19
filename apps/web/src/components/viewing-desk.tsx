import type { Broadcaster, MatchViewing } from '@fmip/contracts';
import { BROADCASTER_KINDS, VIEWING_ACCESS } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, message } from '@/i18n/messages';
import { ACCESS_KEY, KIND_KEY } from '@/lib/viewing';
import {
  addBroadcasterAction,
  declareCoverageAction,
  listOptionAction,
  removeHighlightAction,
  removeOptionAction,
  setHighlightAction,
} from '@/lib/viewing-actions';

/**
 * The editorial desk on the match page (T-313, D-069), for an editor only:
 * declaring coverage for this match's season in a territory, adding a
 * broadcaster, listing the match on a service, setting the official
 * highlight page, and taking a listing or a highlight down with a reason.
 * The forms default to the territory the page is currently answering for,
 * so an editor sees what a viewer there sees, then changes it. Nothing here
 * takes a player or a thumbnail: the desk grants a link (`PL017`).
 */
export function ViewingDesk({
  locale,
  fixtureId,
  seasonId,
  seasonLabel,
  viewing,
  broadcasters,
}: {
  locale: string;
  fixtureId: string;
  seasonId: string;
  seasonLabel: string;
  viewing: MatchViewing | null;
  broadcasters: Broadcaster[];
}) {
  const t = (key: MessageKey): string =>
    message(isLocale(locale) ? locale : DEFAULT_LOCALE, key).text;
  const code = viewing?.territory.state === 'chosen' ? viewing.territory.territory.code : '';
  const territoryField = {
    name: 'territory',
    label: t('viewing.desk.territory'),
    type: 'text' as const,
    defaultValue: code,
    hint: t('viewing.desk.territoryHint'),
    required: true,
  };
  const options = viewing?.options.data ?? [];
  const highlights = viewing?.highlights.data ?? [];

  return (
    <section className="flex flex-col gap-6 border-t pt-4" data-testid="viewing-desk">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('viewing.desk.title')}</h2>
        <p className="text-sm opacity-80">{t('viewing.desk.lead')}</p>
      </div>

      <div className="flex flex-col gap-2" data-testid="desk-coverage">
        <h3 className="font-semibold">
          {t('viewing.desk.coverage')} · {seasonLabel}
        </h3>
        <ActionForm
          action={declareCoverageAction.bind(null, locale, fixtureId, seasonId)}
          fields={[
            territoryField,
            {
              name: 'module',
              label: t('viewing.desk.module'),
              type: 'select',
              options: [
                { value: 'viewing', label: t('viewing.desk.moduleViewing') },
                { value: 'highlights', label: t('viewing.desk.moduleHighlights') },
              ],
            },
            {
              name: 'state',
              label: t('viewing.desk.state'),
              type: 'select',
              options: [
                { value: 'available', label: t('viewing.desk.stateAvailable') },
                { value: 'limited', label: t('viewing.desk.stateLimited') },
                { value: 'not_supplied', label: t('viewing.desk.stateNotSupplied') },
              ],
            },
            { name: 'note', label: t('viewing.desk.note'), type: 'text', required: true },
          ]}
          submitLabel={t('viewing.desk.declare')}
          testId="desk-coverage-form"
        />
      </div>

      <div className="flex flex-col gap-2" data-testid="desk-listing">
        <h3 className="font-semibold">{t('viewing.desk.listing')}</h3>
        {broadcasters.length === 0 ? (
          <p className="text-sm opacity-70">{t('viewing.desk.noBroadcasters')}</p>
        ) : (
          <ActionForm
            action={listOptionAction.bind(null, locale, fixtureId)}
            fields={[
              territoryField,
              {
                name: 'broadcaster_id',
                label: t('viewing.desk.service'),
                type: 'select',
                options: broadcasters.map((b) => ({ value: b.id, label: b.name })),
              },
              {
                name: 'access',
                label: t('viewing.desk.access'),
                type: 'select',
                options: VIEWING_ACCESS.map((access) => ({
                  value: access,
                  label: t(ACCESS_KEY[access]),
                })),
              },
              { name: 'url', label: t('viewing.desk.url'), type: 'url', required: true },
            ]}
            submitLabel={t('viewing.desk.list')}
            testId="desk-listing-form"
          />
        )}
        {options.length > 0 && (
          <ul className="flex flex-col gap-3" data-testid="desk-options">
            {options.map((option) => (
              <li key={option.id} className="flex flex-col gap-1 text-sm">
                <span>
                  {option.broadcaster.name} · {t(ACCESS_KEY[option.access])} · {option.url}
                </span>
                <ActionForm
                  action={removeOptionAction.bind(null, locale, fixtureId, option.id)}
                  fields={[
                    {
                      name: 'reason',
                      label: t('viewing.desk.reason'),
                      type: 'text',
                      required: true,
                    },
                  ]}
                  submitLabel={t('viewing.desk.remove')}
                  testId="desk-remove-option"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="desk-broadcaster">
        <h3 className="font-semibold">{t('viewing.desk.broadcaster')}</h3>
        <ActionForm
          action={addBroadcasterAction.bind(null, locale, fixtureId)}
          fields={[
            { name: 'name', label: t('viewing.desk.name'), type: 'text', required: true },
            { name: 'homepage_url', label: t('viewing.desk.homepage'), type: 'url' },
            {
              name: 'kind',
              label: t('viewing.desk.kind'),
              type: 'select',
              options: BROADCASTER_KINDS.map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) })),
            },
          ]}
          submitLabel={t('viewing.desk.addBroadcaster')}
          testId="desk-broadcaster-form"
        />
      </div>

      <div className="flex flex-col gap-2" data-testid="desk-highlight">
        <h3 className="font-semibold">{t('viewing.desk.highlight')}</h3>
        <ActionForm
          action={setHighlightAction.bind(null, locale, fixtureId)}
          fields={[
            territoryField,
            { name: 'url', label: t('viewing.desk.url'), type: 'url', required: true },
          ]}
          submitLabel={t('viewing.desk.setHighlight')}
          testId="desk-highlight-form"
        />
        {highlights.length > 0 && (
          <ul className="flex flex-col gap-3" data-testid="desk-highlights">
            {highlights.map((highlight) => (
              <li key={highlight.id} className="flex flex-col gap-1 text-sm">
                <span>
                  {highlight.territory} · {highlight.url}
                </span>
                <ActionForm
                  action={removeHighlightAction.bind(null, locale, fixtureId, highlight.territory)}
                  fields={[
                    {
                      name: 'reason',
                      label: t('viewing.desk.reason'),
                      type: 'text',
                      required: true,
                    },
                  ]}
                  submitLabel={t('viewing.desk.remove')}
                  testId="desk-remove-highlight"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
