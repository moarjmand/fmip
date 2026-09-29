import Link from 'next/link';
import type { NewsStoryCard } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { storyHref } from '@/lib/news';

/**
 * The homepage's breaking strip (blueprint 2.3, T-1004, D-125): the stories
 * an editor marked breaking whose window has not run out, each with the
 * editor's note, the publisher's headline (in its own language) and a way to
 * the story page. Nothing marked is no strip at all -- never an empty one
 * (rule 3). Logical properties only (rule 7).
 */
export function BreakingStrip({ locale, stories }: { locale: string; stories: NewsStoryCard[] }) {
  const marked = stories.filter((card) => card.breaking !== null);
  if (marked.length === 0) return null;
  return (
    <section
      aria-labelledby="breaking-heading"
      className="flex flex-col gap-2 border-s-4 border-s-accent ps-4"
      data-testid="breaking-strip"
    >
      <h2 id="breaking-heading" className="text-lg font-semibold">
        <Translated locale={locale} message="news.breaking.title" />
      </h2>
      <ul className="flex flex-col gap-2">
        {marked.map((card) => (
          <li key={card.story_id} className="flex flex-col gap-0.5" data-testid="breaking-story">
            <Link
              href={storyHref(locale, card.story_id)}
              className="font-medium underline"
              lang={card.language}
            >
              {card.headline}
            </Link>
            <span className="text-sm">{card.breaking?.note}</span>
            <span className="text-sm text-muted">
              <Translated locale={locale} message="news.readAt" /> {card.source.name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
