import Link from 'next/link';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';

/**
 * The halves of a sentence with a link inside it, split around its `{link}`
 * placeholder (T-1302). The words either side of a link are one message, so
 * a language puts the link where its own word order wants it -- "Create an
 * account to follow your teams" leads with it in English and ends with it in
 * Persian. Both halves keep the message's status, so an untranslated sentence
 * is marked on both sides of its link.
 */
export function aroundLink(sentence: Message): { before: Message; after: Message } {
  const at = sentence.text.indexOf('{link}');
  if (at === -1) return { before: sentence, after: { text: '', status: sentence.status } };
  return {
    before: { text: sentence.text.slice(0, at), status: sentence.status },
    after: { text: sentence.text.slice(at + '{link}'.length), status: sentence.status },
  };
}

/** `sentence` with `link` rendered as a link where its `{link}` placeholder is. */
export function LinkedSentence({
  sentence,
  link,
  href,
  className = 'underline',
}: {
  sentence: Message;
  link: Message;
  href: string;
  className?: string;
}) {
  const { before, after } = aroundLink(sentence);
  return (
    <>
      {before.text !== '' && <MessageText message={before} />}
      <Link href={href} className={className}>
        <MessageText message={link} />
      </Link>
      {after.text !== '' && <MessageText message={after} />}
    </>
  );
}
