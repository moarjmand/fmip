import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationSettings, NotificationsResponse } from '@fmip/contracts';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_KINDS } from '@fmip/contracts';
import { ClientMessagesProvider } from '@/components/client-messages';
import { FollowingSection } from '@/components/following-section';
import { NotificationList } from '@/components/notification-list';
import { NotificationSettingsForm } from '@/components/notification-settings';
import { plural, resolveMessages } from '@/i18n/messages';
import {
  KIND_ROW_KEYS,
  NOTIFICATION_LIST_KEYS,
  NOTIFICATION_SETTINGS_KEYS,
} from '@/lib/notification-messages';

/**
 * Following and notifications in Persian (T-1305, D-175): the settings
 * section, the inbox and the notification settings render the catalogue's
 * Persian on `/fa`, and the English on `/en` word for word as before.
 */

function settings(): NotificationSettings {
  return {
    preferences: NOTIFICATION_KINDS.map((kind) => ({
      kind,
      in_product: NOTIFICATION_DEFAULTS[kind],
      chosen: false,
    })),
    quiet_hours: null,
    timezone: 'Asia/Tehran',
    mutes: [],
  };
}

function settingsForm(locale: 'en' | 'fa'): string {
  return renderToStaticMarkup(
    <ClientMessagesProvider messages={resolveMessages(locale, KIND_ROW_KEYS)}>
      <NotificationSettingsForm
        locale={locale}
        settings={settings()}
        teams={[]}
        competitions={null}
        messages={resolveMessages(locale, NOTIFICATION_SETTINGS_KEYS)}
        caps={{ message_received: plural(locale, 'alerts.cap', 10) }}
      />
    </ClientMessagesProvider>,
  );
}

const INBOX: NotificationsResponse = {
  notifications: [
    {
      id: 'n1',
      kind: 'friend_request',
      subject_type: 'member',
      subject_id: '00000000-0000-4000-8000-000000000001',
      subject_label: 'ada',
      headline: null,
      source: 'ada',
      created_at: '2026-09-15T12:00:00.000Z',
      read_at: null,
      held_reason: null,
    },
  ],
  unread: 3,
  generated_at: '2026-09-15T12:00:00.000Z',
  delivery: { in_product_only: true },
} as NotificationsResponse;

describe('notification settings in Persian', () => {
  it('names the sections, the switches and the hourly cap in Persian', () => {
    const html = settingsForm('fa');
    expect(html).toContain('آنچه می‌رسد');
    expect(html).toContain('وقتی یکی از پیش‌بینی‌هایم تسویه می‌شود');
    expect(html).toContain('پیش‌فرض');
    expect(html).toContain('حداکثر ۱۰ در ساعت');
    expect(html).toContain('ساعت‌های سکوت');
    // The member's zone is filled into the sentence, not translated.
    expect(html).toContain('(Asia/Tehran)');
    expect(html).not.toContain('What stays quiet');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('keeps the English as it was', () => {
    const html = settingsForm('en');
    expect(html).toContain('What arrives');
    expect(html).toContain('When a prediction of mine is settled');
    expect(html).toContain('Default · at most 10 an hour');
    expect(html).toContain('Times are on your own clock (Asia/Tehran).');
    expect(html).toContain('The competition list could not be loaded right now.');
  });
});

describe('the inbox in Persian', () => {
  it('says mark all read with a Persian count', () => {
    const html = renderToStaticMarkup(
      <NotificationList
        locale="fa"
        page={INBOX}
        reachable
        deletedMemberLabel="عضو حذف‌شده"
        messages={resolveMessages('fa', NOTIFICATION_LIST_KEYS)}
        markAll={plural('fa', 'notificationsPage.markAllRead', 3)}
        times={{ n1: '۲۴ شهریور ۱۴۰۵، ۱۵:۳۰' }}
      />,
    );
    expect(html).toContain('علامت خوانده‌شده برای هر ۳ اعلان');
    expect(html).toContain('خوانده شد');
    expect(html).toContain('۲۴ شهریور ۱۴۰۵، ۱۵:۳۰');
  });

  it('says the empty inbox in English, as before', () => {
    const html = renderToStaticMarkup(
      <NotificationList
        locale="en"
        page={{ ...INBOX, notifications: [], unread: 0 }}
        reachable
        deletedMemberLabel="A deleted member"
        messages={resolveMessages('en', NOTIFICATION_LIST_KEYS)}
        markAll={null}
        times={{}}
      />,
    );
    expect(html).toContain(
      'Nothing yet. Things that happen to you and to what you wrote turn up here.',
    );
  });
});

describe('the follows on the settings page in Persian', () => {
  it('names the pickers and the national team in Persian', () => {
    const html = renderToStaticMarkup(
      <FollowingSection
        locale="fa"
        following={[]}
        teams={[{ id: 't1', name: 'Iran', kind: 'national' } as never]}
        competitions={[]}
      />,
    );
    expect(html).toContain('دنبال‌شده‌ها');
    expect(html).toContain('هنوز چیزی را دنبال نمی‌کنید.');
    expect(html).toContain('دنبال کردن یک تیم');
    expect(html).toContain('Iran (تیم ملی)');
  });
});
