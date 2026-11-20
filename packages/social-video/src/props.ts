/**
 * The matchday preview's props (T-1931, the spike's seed of T-1935's
 * `props.ts`): what one clip is drawn from, and the check that refuses a
 * clip the rules forbid before a frame is rendered.
 *
 * - Rule 6, D-454 point 6: one prediction product a clip. The preview is the
 *   statistical model's; the founder's analysis and the community's picks
 *   never share its props.
 * - Rule 5: the model's figures arrive with their model name and version and
 *   the time they were computed; a clip without a version is refused.
 * - D-454 point 5: no crest, logo, photo or address of one, under any key.
 * - Each frame is a pure function of the frame number and these props, so
 *   the countdown's "now" (`as_of`) is a prop, never the clock.
 */

export const LOCALES = ['en', 'fa'] as const;
export type ClipLocale = (typeof LOCALES)[number];

/** The three prediction products (rule 6). A clip names exactly one. */
export const PREDICTION_PRODUCTS = [
  'statistical_model',
  'founder_analysis',
  'community_consensus',
] as const;
export type PredictionProduct = (typeof PREDICTION_PRODUCTS)[number];

export type Outcome = 'home' | 'draw' | 'away';

export interface Localised {
  en: string;
  /** Absent where the site holds no Persian name; a Persian clip then refuses. */
  fa?: string;
}

export interface ClipTeam {
  name: Localised;
  /** The site's three-letter code, where it has one. */
  code: string | null;
}

/** A type alias, not an interface: Remotion's props must fit `Record<string, unknown>`. */
export type MatchdayPreviewProps = {
  format: 'matchday-preview';
  locale: ClipLocale;
  /** The canonical fixture id (rule 1). */
  fixture_id: string;
  competition: { name: Localised; round: Localised | null };
  home: ClipTeam;
  away: ClipTeam;
  kickoff_at: string;
  /** The instant the clip's first frame stands for; the countdown runs from it. */
  as_of: string;
  prediction: {
    product: 'statistical_model';
    model: { name: string; version: string; computed_at: string };
    percent: Record<Outcome, number>;
  };
  /** The on-frame line (D-454's open question 2). */
  disclosure: Localised;
};

/** Keys that would carry a picture or its address (D-454 point 5). */
const IMAGE_KEYS = /^(image|logo|crest|photo|url|src)$/i;
/** Keys under which another prediction product would ride along. */
const PRODUCT_KEYS =
  /^(predictions|founder|founder_analysis|community|community_consensus|consensus)$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const instant = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && !Number.isNaN(Date.parse(value));

function walk(value: unknown, path: string, visit: (key: string, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
  } else if (isBag(value)) {
    for (const [key, inner] of Object.entries(value)) {
      const at = path === '' ? key : `${path}.${key}`;
      visit(key, at);
      walk(inner, at, visit);
    }
  }
}

/**
 * Every reason these props may not become a clip; empty when they may. Takes
 * `unknown` because the props come from a file or a queue, not from a type.
 */
export function clipProblems(input: unknown): string[] {
  if (!isBag(input)) return ['props: not an object'];
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };

  need(input.format === 'matchday-preview', 'format: not "matchday-preview"');
  need(LOCALES.includes(input.locale as ClipLocale), 'locale: not "en" or "fa"');
  need(
    typeof input.fixture_id === 'string' && UUID.test(input.fixture_id),
    'fixture_id: not a UUID',
  );

  walk(input, '', (key, path) => {
    if (IMAGE_KEYS.test(key)) problems.push(`${path}: a picture or an address is not allowed`);
    if (PRODUCT_KEYS.test(key))
      problems.push(`${path}: a second prediction product in one clip (rule 6)`);
  });

  const prediction = input.prediction;
  if (!isBag(prediction)) {
    problems.push('prediction: missing');
  } else {
    need(
      PREDICTION_PRODUCTS.includes(prediction.product as PredictionProduct),
      'prediction.product: not a known prediction product',
    );
    need(
      prediction.product === 'statistical_model',
      "prediction.product: the matchday preview is the statistical model's clip (rule 6)",
    );
    const model = isBag(prediction.model) ? prediction.model : {};
    need(text(model.name), 'prediction.model.name: missing');
    need(
      typeof model.version === 'string' && SEMVER.test(model.version),
      'prediction.model.version: missing or not x.y.z (rule 5)',
    );
    need(instant(model.computed_at), 'prediction.model.computed_at: not an instant');
    const percent = isBag(prediction.percent) ? prediction.percent : {};
    const shares = (['home', 'draw', 'away'] as const).map((outcome) => percent[outcome]);
    if (shares.every((p): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0)) {
      const sum = shares.reduce((a, b) => a + b, 0);
      need(Math.abs(sum - 100) <= 0.2, `prediction.percent: sums to ${sum.toFixed(1)}, not 100`);
    } else {
      problems.push('prediction.percent: home, draw and away must be numbers of at least 0');
    }
  }

  const fa = input.locale === 'fa';
  const named = (value: unknown, path: string): void => {
    const bag = isBag(value) ? value : {};
    need(text(bag.en), `${path}.en: missing`);
    if (fa) need(text(bag.fa), `${path}.fa: missing for a Persian clip`);
  };
  for (const side of ['home', 'away'] as const) {
    const team = isBag(input[side]) ? (input[side] as Bag) : {};
    named(team.name, `${side}.name`);
  }
  const competition = isBag(input.competition) ? input.competition : {};
  named(competition.name, 'competition.name');
  if (competition.round != null) named(competition.round, 'competition.round');
  named(input.disclosure, 'disclosure');

  need(instant(input.kickoff_at), 'kickoff_at: not an instant');
  need(instant(input.as_of), 'as_of: not an instant');
  if (instant(input.kickoff_at) && instant(input.as_of))
    need(
      Date.parse(input.as_of) < Date.parse(input.kickoff_at),
      'as_of: a preview is made before kick-off',
    );

  return problems;
}

/** The props, checked; throws with every problem named. */
export function parseClipProps(input: unknown): MatchdayPreviewProps {
  const problems = clipProblems(input);
  if (problems.length > 0) throw new Error(`Refused clip props:\n- ${problems.join('\n- ')}`);
  return input as MatchdayPreviewProps;
}
