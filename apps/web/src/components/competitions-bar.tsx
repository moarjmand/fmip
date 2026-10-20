import type { CompetitionDirectoryResponse } from '@fmip/contracts';
import { CompetitionsBarLinks } from '@/components/competitions-bar-links';
import { EntityImage } from '@/components/entity-image';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { attribute, message } from '@/i18n/messages';
import { type ApiResult, fetchCompetitionDirectory } from '@/lib/api';
import { barCompetitions, barName } from '@/lib/competitions-directory';
import { type KeptAnswer, sharedAnswer } from '@/lib/live-strip';

const KEPT = new Map<string, KeptAnswer<ApiResult<CompetitionDirectoryResponse>>>();

/**
 * The directory for the bar, or none when the API could not answer. A plain
 * function, not a component: it reads the clock, once per request.
 */
async function loadDirectory(lang: string) {
  const answer = await sharedAnswer(KEPT, lang, Date.now(), fetchCompetitionDirectory).catch(
    () => null,
  );
  return answer !== null && answer.ok ? answer.data.competitions : [];
}

/**
 * The competitions bar (T-1433): right under the header on every page, the
 * main competitions in the product's order (D-207) as a row that scrolls
 * sideways, after "All competitions", which opens the page with every one.
 *
 * One request per language, shared between pages for a few seconds as the
 * live strip's is (`sharedAnswer`). Rendered on the server with the header,
 * so it is there at first paint and nothing below it moves. When the API
 * cannot answer, the bar is "All competitions" alone: the page it opens
 * says what went wrong, and no row of names is guessed (rule 3).
 */
export async function CompetitionsBar({ locale }: { locale: string }) {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const list = await loadDirectory(lang);
  return (
    <CompetitionsBarLinks
      locale={locale}
      items={barCompetitions(list).map((c) => ({
        id: c.id,
        label: barName(c),
        icon: <EntityImage media={c.logo} kind="logo" name={barName(c)} size={20} />,
      }))}
      all={message(lang, 'competitions.bar.all')}
      navLabel={attribute(lang, 'competitions.bar.label')}
    />
  );
}
