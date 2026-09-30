import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { message } from '@/i18n/messages';
import { LinkedSentence, aroundLink } from './linked-sentence';

describe('a sentence with a link inside it (T-1302)', () => {
  it('puts the link where each language puts it', () => {
    const en = renderToStaticMarkup(
      <LinkedSentence
        sentence={message('en', 'home.guestInvite')}
        link={message('en', 'home.guestInvite.link')}
        href="/en/register"
      />,
    );
    expect(en).toBe(
      '<a class="underline" href="/en/register">Create an account</a> to follow your teams, predict matches and earn a rating.',
    );
    const fa = renderToStaticMarkup(
      <LinkedSentence
        sentence={message('fa', 'home.guestInvite')}
        link={message('fa', 'home.guestInvite.link')}
        href="/fa/register"
      />,
    );
    expect(fa).toBe(
      'برای دنبال کردن تیم‌هایتان، پیش‌بینی بازی‌ها و کسب امتیاز عملکرد، <a class="underline" href="/fa/register">حساب کاربری بسازید</a>.',
    );
  });

  it('keeps an untranslated sentence marked on both sides of its link', () => {
    const { before, after } = aroundLink({ text: 'New here? {link}.', status: 'untranslated' });
    expect(before).toEqual({ text: 'New here? ', status: 'untranslated' });
    expect(after).toEqual({ text: '.', status: 'untranslated' });
  });
});
