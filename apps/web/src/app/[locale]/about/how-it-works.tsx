import { Translated } from '@/components/translated';
import { localDigits } from '@/i18n/format';
import type { Locale } from '@/i18n/locales';
import type { MessageKey } from '@/i18n/messages';
import { AboutIcon, type AboutIconName } from './about-icons';
import { LANES, type Product, RECORD_SURFACES, type Tone } from './about-content';

/**
 * "How Stadiomind works" (T-1615, D-286): the path of one match, from the
 * licensed data to the records the forecasts build, as an ordered list that
 * is drawn as a diagram. The list is the diagram's text: every step's words
 * are on the page, in reading order, and only the wires and the gate marks
 * are pictures (decorative, hidden from assistive technology).
 *
 * The drawing is `about.css`. From 1024px the steps stand in columns and the
 * three prediction products run in lanes of their own (rule 6) from the
 * match record through kick-off and full time to a record each; narrower,
 * the steps stack and the three lanes travel down together as three
 * strands, never one. The wires follow the line of reading, so a
 * right-to-left page runs the other way. Motion -- the steps rising in
 * turn, dots flowing along the wires -- is only where the reader has not
 * asked for less; otherwise the diagram is drawn complete and still.
 */

const TONE_BADGE: Record<Tone, string> = {
  accent: 'border-accent text-accent',
  model: 'border-model text-model',
  founder: 'border-founder text-founder',
  community: 'border-community text-community',
};

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent',
  model: 'text-model',
  founder: 'text-founder',
  community: 'text-community',
};

const PRODUCTS: readonly Product[] = LANES.map((lane) => lane.product);

/** A wire between two steps: one strand, or the three lanes side by side. */
function Wire({
  place,
  axis,
  strands,
}: {
  place: 'next' | 'in' | 'out';
  axis: 'inline' | 'block';
  strands: readonly Tone[];
}) {
  return (
    <span aria-hidden="true" className={`how-wire how-${place}`} data-wire={place}>
      <svg focusable="false">
        {strands.map((tone, index) => {
          const at = `${String(((index + 1) * 100) / (strands.length + 1))}%`;
          const ends =
            axis === 'block'
              ? { x1: at, y1: '0', x2: at, y2: '100%' }
              : { x1: '0', y1: at, x2: '100%', y2: at };
          return <line key={tone} className={`how-strand how-tone--${tone}`} {...ends} />;
        })}
      </svg>
    </span>
  );
}

/** A step's head: its mark, its number in the reader's digits, its name. */
function StepLabel({
  locale,
  step,
  name,
  icon,
}: {
  locale: Locale;
  step: number;
  name: MessageKey;
  icon?: AboutIconName;
}) {
  return (
    <p className="how-label">
      {icon !== undefined && (
        <span
          className={`how-badge grid size-9 shrink-0 place-items-center rounded-pill border-2 bg-surface ${TONE_BADGE.accent}`}
        >
          <AboutIcon name={icon} size={18} />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span
          aria-hidden="true"
          className="font-mono text-xs text-caption tabular-nums [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        >
          {localDigits(locale, String(step).padStart(2, '0'))}
        </span>
        <strong className="text-sm leading-snug font-extrabold">
          <Translated locale={locale} message={name} />
        </strong>
      </span>
    </p>
  );
}

function Note({ locale, message }: { locale: Locale; message: MessageKey }) {
  return (
    <p className="how-note text-xs leading-relaxed text-muted">
      <Translated locale={locale} message={message} />
    </p>
  );
}

/** A gate every lane passes on its own: kick-off, then full time. */
function Gate({
  locale,
  step,
  id,
  name,
  body,
  icon,
  mark,
}: {
  locale: Locale;
  step: number;
  id: 'kickoff' | 'settle';
  name: MessageKey;
  body: MessageKey;
  icon: AboutIconName;
  mark: AboutIconName;
}) {
  return (
    <li className={`how-step how-gate how-${id}`} data-testid={`how-${id}`}>
      <StepLabel locale={locale} step={step} name={name} icon={icon} />
      {PRODUCTS.map((product) => (
        <span key={product} aria-hidden="true" className={`how-node how-tone--${product}`}>
          <span>
            <AboutIcon name={mark} size={14} />
          </span>
        </span>
      ))}
      <Note locale={locale} message={body} />
      <Wire place="next" axis="block" strands={PRODUCTS} />
    </li>
  );
}

export function HowItWorks({ locale }: { locale: Locale }) {
  return (
    <section aria-labelledby="about-how" className="flex flex-col gap-4">
      <div className="flex max-w-3xl flex-col gap-2">
        <h2
          id="about-how"
          className="text-[1.375rem] leading-tight font-extrabold font-stretch-semi-expanded"
        >
          <Translated locale={locale} message="about.how.title" />
        </h2>
        <p className="text-muted">
          <Translated locale={locale} message="about.how.intro" />
        </p>
      </div>

      <figure
        className="how rounded-card border border-default p-4 sm:p-6 xl:p-8"
        data-testid="how-it-works"
      >
        <ol className="how-flow" data-testid="how-steps">
          <li className="how-step how-source" data-testid="how-source">
            <div className="how-card flex flex-col gap-1.5 rounded-tile border border-default bg-surface p-3.5">
              <StepLabel locale={locale} step={1} name="about.how.source.name" icon="data" />
              <p className="text-sm text-muted">
                <Translated locale={locale} message="about.how.source.body" />
              </p>
            </div>
            <Wire place="next" axis="block" strands={['accent']} />
          </li>

          <li className="how-step how-record" data-testid="how-record">
            <div className="how-card flex h-full flex-col gap-3 rounded-tile border border-default bg-surface p-4">
              <StepLabel locale={locale} step={2} name="about.how.record.name" icon="pitch" />
              <p className="text-sm text-muted">
                <Translated locale={locale} message="about.how.record.body" />
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {RECORD_SURFACES.map((surface) => (
                  <li
                    key={surface}
                    className="rounded-pill border border-default bg-surface-raised px-2.5 py-0.5 text-xs font-semibold"
                  >
                    <Translated locale={locale} message={surface} />
                  </li>
                ))}
              </ul>
              <Note locale={locale} message="about.how.record.note" />
            </div>
            <Wire place="next" axis="block" strands={['accent']} />
          </li>

          <li className="how-step how-lanes" data-testid="how-lanes">
            <StepLabel locale={locale} step={3} name="about.how.lanes.title" />
            <ul className="how-trio">
              {LANES.map((lane) => (
                <li
                  key={lane.product}
                  data-product={lane.product}
                  className={`how-lane how-tone--${lane.product} flex gap-3 rounded-tile border border-default bg-surface p-3.5`}
                >
                  <Wire place="in" axis="inline" strands={[lane.product]} />
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-pill border-2 bg-surface ${TONE_BADGE[lane.product]}`}
                  >
                    <AboutIcon name={lane.icon} size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <strong
                      className={`leading-snug font-extrabold ${lane.product === 'founder' ? 'font-serif text-base' : 'text-sm'}`}
                    >
                      <Translated locale={locale} message={lane.name} />
                    </strong>
                    <span className="text-sm text-muted">
                      <Translated locale={locale} message={lane.body} />
                    </span>
                  </span>
                  <Wire place="out" axis="inline" strands={[lane.product]} />
                </li>
              ))}
            </ul>
            <Note locale={locale} message="about.how.apart" />
            <Wire place="next" axis="block" strands={PRODUCTS} />
          </li>

          <Gate
            locale={locale}
            step={4}
            id="kickoff"
            name="about.how.kickoff.name"
            body="about.how.kickoff.body"
            icon="lock"
            mark="lock"
          />
          <Gate
            locale={locale}
            step={5}
            id="settle"
            name="about.how.settle.name"
            body="about.how.settle.body"
            icon="whistle"
            mark="check"
          />

          <li className="how-step how-outcomes" data-testid="how-outcomes">
            <StepLabel locale={locale} step={6} name="about.how.outcomes.title" />
            <ul className="how-trio">
              {LANES.map((lane) => (
                <li
                  key={lane.product}
                  data-product={lane.product}
                  className={`how-outcome how-tone--${lane.product} flex gap-3 rounded-tile border border-default bg-surface p-3.5`}
                >
                  <AboutIcon
                    name={lane.outcome.icon}
                    size={22}
                    className={TONE_TEXT[lane.product]}
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <strong className="text-sm leading-snug font-extrabold">
                      <Translated locale={locale} message={lane.outcome.name} />
                    </strong>
                    <span className="text-sm text-muted">
                      <Translated locale={locale} message={lane.outcome.body} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <Note locale={locale} message="about.how.outcomes.note" />
          </li>
        </ol>
        <figcaption className="mt-6 border-t border-dashed border-default pt-3 text-sm text-muted">
          <Translated locale={locale} message="about.how.caption" />
        </figcaption>
      </figure>
    </section>
  );
}
