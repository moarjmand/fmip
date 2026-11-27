import type { MessageKey } from '@/i18n/messages';

/**
 * The privacy notice's shape (T-1969, D-465): thirteen numbered sections in
 * the order of the business adviser's draft 0.4, the third in seven parts,
 * each a run of paragraphs, lists and rows. The words are catalogue text
 * (`privacy.*`), English and Persian written, every other language the
 * English marked; the numbers are the order here, so the text's own "see
 * Section 6" stays true only while this order is the draft's.
 *
 * A table of the draft is a run of rows, each drawn as a card: the first
 * cell is the row's title, the others under their column's name. A card
 * reads at 375 px, where three columns of sentences would not.
 *
 * Where the draft leaves a value open (the e-mail service and where it is,
 * T-1952; the backup region; how long access logs are kept; the lawful basis
 * of campaign messages; the minimum age), the text says `{pending}` and the
 * page shows "not yet confirmed", never a value (rule 3).
 */

/** A cookie or storage name, shown as code, the same in every language. */
export interface CodeTitle {
  code: readonly string[];
}

export interface NoticeRow {
  title: MessageKey | CodeTitle;
  /** One per column, in the order of the block's `columns`. */
  cells: readonly MessageKey[];
}

export type NoticeBlock =
  | { kind: 'p'; text: MessageKey }
  | { kind: 'list'; items: readonly MessageKey[] }
  /** The controller and how to reach him: from the server's environment, never the catalogue. */
  | { kind: 'contact' }
  | {
      kind: 'rows';
      id: string;
      /** The names of the cells after the title. */
      columns: readonly MessageKey[];
      /** Short titles are drawn in bold; long ones carry their own bold lead. */
      strongTitles: boolean;
      rows: readonly NoticeRow[];
    };

export interface NoticePart {
  id: string;
  heading: MessageKey;
  blocks: readonly NoticeBlock[];
}

export interface NoticeSection extends NoticePart {
  parts?: readonly NoticePart[];
}

const CONTRACT: MessageKey = 'privacy.basis.contract';
const LEGITIMATE: MessageKey = 'privacy.basis.legitimate';
const YEAR: MessageKey = 'privacy.cookies.year';

export const NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    id: 'who-we-are',
    heading: 'privacy.who.title',
    blocks: [{ kind: 'p', text: 'privacy.who.body' }, { kind: 'contact' }],
  },
  {
    id: 'short-version',
    heading: 'privacy.short.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'privacy.short.visitors',
          'privacy.short.members',
          'privacy.short.noTracking',
          'privacy.short.control',
        ],
      },
    ],
  },
  {
    id: 'what-we-collect',
    heading: 'privacy.collect.title',
    blocks: [],
    parts: [
      {
        id: 'visitors',
        heading: 'privacy.visitors.title',
        blocks: [
          {
            kind: 'rows',
            id: 'visitors',
            columns: ['privacy.column.why', 'privacy.column.basis'],
            strongTitles: false,
            rows: [
              {
                title: 'privacy.visitors.requests.what',
                cells: ['privacy.visitors.requests.why', 'privacy.visitors.requests.basis'],
              },
              {
                title: 'privacy.visitors.ipCode.what',
                cells: ['privacy.visitors.ipCode.why', 'privacy.visitors.ipCode.basis'],
              },
              {
                title: 'privacy.visitors.choices.what',
                cells: ['privacy.visitors.choices.why', 'privacy.visitors.choices.basis'],
              },
              {
                title: 'privacy.visitors.ask.what',
                cells: ['privacy.visitors.ask.why', 'privacy.visitors.ask.basis'],
              },
            ],
          },
        ],
      },
      {
        id: 'members',
        heading: 'privacy.members.title',
        blocks: [
          {
            kind: 'rows',
            id: 'members',
            columns: ['privacy.column.why', 'privacy.column.basis'],
            strongTitles: false,
            rows: [
              {
                title: 'privacy.members.account.what',
                cells: ['privacy.members.account.why', 'privacy.members.account.basis'],
              },
              {
                title: 'privacy.members.password.what',
                cells: ['privacy.members.password.why', CONTRACT],
              },
              {
                title: 'privacy.members.sessions.what',
                cells: ['privacy.members.sessions.why', 'privacy.members.sessions.basis'],
              },
              {
                title: 'privacy.members.emailLinks.what',
                cells: ['privacy.members.emailLinks.why', CONTRACT],
              },
              {
                title: 'privacy.members.profile.what',
                cells: ['privacy.members.profile.why', CONTRACT],
              },
              {
                title: 'privacy.members.visibility.what',
                cells: ['privacy.members.visibility.why', CONTRACT],
              },
              {
                title: 'privacy.members.predictions.what',
                cells: ['privacy.members.predictions.why', CONTRACT],
              },
              {
                title: 'privacy.members.pendingPick.what',
                cells: ['privacy.members.pendingPick.why', CONTRACT],
              },
              {
                title: 'privacy.members.sharedCards.what',
                cells: ['privacy.members.sharedCards.why', 'privacy.members.sharedCards.basis'],
              },
              {
                title: 'privacy.members.signupSource.what',
                cells: ['privacy.members.signupSource.why', LEGITIMATE],
              },
              {
                title: 'privacy.members.ratings.what',
                cells: ['privacy.members.ratings.why', CONTRACT],
              },
              {
                title: 'privacy.members.follows.what',
                cells: ['privacy.members.follows.why', CONTRACT],
              },
              {
                title: 'privacy.members.social.what',
                cells: ['privacy.members.social.why', CONTRACT],
              },
              {
                title: 'privacy.members.savedNews.what',
                cells: ['privacy.members.savedNews.why', CONTRACT],
              },
              {
                title: 'privacy.members.display.what',
                cells: ['privacy.members.display.why', CONTRACT],
              },
              {
                title: 'privacy.members.notifications.what',
                cells: ['privacy.members.notifications.why', CONTRACT],
              },
              {
                title: 'privacy.members.push.what',
                cells: ['privacy.members.push.why', 'privacy.members.push.basis'],
              },
              {
                title: 'privacy.members.campaigns.what',
                cells: ['privacy.members.campaigns.why', 'privacy.members.campaigns.basis'],
              },
              {
                title: 'privacy.members.briefings.what',
                cells: ['privacy.members.briefings.why', CONTRACT],
              },
              {
                title: 'privacy.members.exports.what',
                cells: ['privacy.members.exports.why', 'privacy.members.exports.basis'],
              },
              {
                title: 'privacy.members.moderation.what',
                cells: ['privacy.members.moderation.why', 'privacy.members.moderation.basis'],
              },
              {
                title: 'privacy.members.rateLimits.what',
                cells: ['privacy.members.rateLimits.why', LEGITIMATE],
              },
            ],
          },
        ],
      },
      {
        id: 'staff',
        heading: 'privacy.staff.title',
        blocks: [{ kind: 'p', text: 'privacy.staff.body' }],
      },
      {
        id: 'emails',
        heading: 'privacy.emails.title',
        blocks: [
          {
            kind: 'list',
            items: [
              'privacy.emails.account',
              'privacy.emails.notifications',
              'privacy.emails.campaigns',
            ],
          },
        ],
      },
      {
        id: 'language-models',
        heading: 'privacy.models.title',
        blocks: [
          { kind: 'p', text: 'privacy.models.lead' },
          {
            kind: 'rows',
            id: 'language-models',
            columns: ['privacy.column.sent'],
            strongTitles: true,
            rows: [
              { title: 'privacy.models.ask', cells: ['privacy.models.ask.sent'] },
              { title: 'privacy.models.briefings', cells: ['privacy.models.briefings.sent'] },
              { title: 'privacy.models.summaries', cells: ['privacy.models.summaries.sent'] },
              { title: 'privacy.models.moderation', cells: ['privacy.models.moderation.sent'] },
            ],
          },
        ],
      },
      {
        id: 'people-we-write-about',
        heading: 'privacy.people.title',
        blocks: [{ kind: 'p', text: 'privacy.people.body' }],
      },
      {
        id: 'what-we-do-not-do',
        heading: 'privacy.not.title',
        blocks: [
          {
            kind: 'list',
            items: [
              'privacy.not.ads',
              'privacy.not.selling',
              'privacy.not.automated',
              'privacy.not.providers',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'what-is-public',
    heading: 'privacy.public.title',
    blocks: [{ kind: 'p', text: 'privacy.public.body' }],
  },
  {
    id: 'sharing',
    heading: 'privacy.sharing.title',
    blocks: [
      { kind: 'p', text: 'privacy.sharing.lead' },
      {
        kind: 'rows',
        id: 'processors',
        columns: ['privacy.column.does', 'privacy.column.where'],
        strongTitles: true,
        rows: [
          {
            title: 'privacy.sharing.developer',
            cells: ['privacy.sharing.developer.does', 'privacy.sharing.developer.where'],
          },
          {
            title: 'privacy.sharing.hetzner',
            cells: ['privacy.sharing.hetzner.does', 'privacy.sharing.hetzner.where'],
          },
          {
            title: 'privacy.sharing.cloudflare',
            cells: ['privacy.sharing.cloudflare.does', 'privacy.sharing.cloudflare.where'],
          },
          {
            title: 'privacy.sharing.backblaze',
            cells: ['privacy.sharing.backblaze.does', 'privacy.sharing.backblaze.where'],
          },
          {
            title: 'privacy.sharing.email',
            cells: ['privacy.sharing.email.does', 'privacy.sharing.email.where'],
          },
          {
            title: 'privacy.sharing.mistral',
            cells: ['privacy.sharing.mistral.does', 'privacy.sharing.mistral.where'],
          },
          {
            title: 'privacy.sharing.push',
            cells: ['privacy.sharing.push.does', 'privacy.sharing.push.where'],
          },
        ],
      },
      { kind: 'p', text: 'privacy.sharing.law' },
      { kind: 'p', text: 'privacy.sharing.members' },
    ],
  },
  {
    id: 'cookies',
    heading: 'privacy.cookies.title',
    blocks: [
      { kind: 'p', text: 'privacy.cookies.lead' },
      {
        kind: 'rows',
        id: 'cookies',
        columns: ['privacy.column.purpose', 'privacy.column.set', 'privacy.column.lasts'],
        strongTitles: true,
        rows: [
          {
            title: { code: ['fmip_session'] },
            cells: [
              'privacy.cookies.session.purpose',
              'privacy.cookies.session.set',
              'privacy.cookies.session.lasts',
            ],
          },
          {
            title: { code: ['fmip_first_run'] },
            cells: [
              'privacy.cookies.firstRun.purpose',
              'privacy.cookies.firstRun.set',
              'privacy.cookies.firstRun.lasts',
            ],
          },
          {
            title: { code: ['fmip_theme'] },
            cells: ['privacy.cookies.theme.purpose', 'privacy.cookies.theme.set', YEAR],
          },
          {
            title: { code: ['fmip_text_size', 'fmip_contrast', 'fmip_motion'] },
            cells: ['privacy.cookies.display.purpose', 'privacy.cookies.display.set', YEAR],
          },
          {
            title: { code: ['fmip_lite'] },
            cells: ['privacy.cookies.lite.purpose', 'privacy.cookies.lite.set', YEAR],
          },
          {
            title: { code: ['fmip_slow'] },
            cells: [
              'privacy.cookies.slow.purpose',
              'privacy.cookies.slow.set',
              'privacy.cookies.slow.lasts',
            ],
          },
          {
            title: { code: ['fmip_held_notice'] },
            cells: ['privacy.cookies.heldNotice.purpose', 'privacy.cookies.heldNotice.set', YEAR],
          },
          {
            title: { code: ['fmip_console'] },
            cells: [
              'privacy.cookies.console.purpose',
              'privacy.cookies.console.set',
              'privacy.cookies.console.lasts',
            ],
          },
        ],
      },
      { kind: 'p', text: 'privacy.cookies.storage' },
      { kind: 'p', text: 'privacy.cookies.video' },
      { kind: 'p', text: 'privacy.cookies.delete' },
    ],
  },
  {
    id: 'transfers',
    heading: 'privacy.transfers.title',
    blocks: [{ kind: 'p', text: 'privacy.transfers.body' }],
  },
  {
    id: 'retention',
    heading: 'privacy.retention.title',
    blocks: [
      { kind: 'p', text: 'privacy.retention.lead' },
      {
        kind: 'rows',
        id: 'retention',
        columns: ['privacy.column.howLong'],
        strongTitles: true,
        rows: [
          { title: 'privacy.retention.account', cells: ['privacy.retention.account.howLong'] },
          { title: 'privacy.retention.sessions', cells: ['privacy.retention.sessions.howLong'] },
          {
            title: 'privacy.retention.emailLinks',
            cells: ['privacy.retention.emailLinks.howLong'],
          },
          {
            title: 'privacy.retention.pendingPick',
            cells: ['privacy.retention.pendingPick.howLong'],
          },
          {
            title: 'privacy.retention.sharedCards',
            cells: ['privacy.retention.sharedCards.howLong'],
          },
          {
            title: 'privacy.retention.predictions',
            cells: ['privacy.retention.predictions.howLong'],
          },
          { title: 'privacy.retention.messages', cells: ['privacy.retention.messages.howLong'] },
          { title: 'privacy.retention.analysis', cells: ['privacy.retention.analysis.howLong'] },
          {
            title: 'privacy.retention.moderation',
            cells: ['privacy.retention.moderation.howLong'],
          },
          { title: 'privacy.retention.audit', cells: ['privacy.retention.audit.howLong'] },
          { title: 'privacy.retention.inbox', cells: ['privacy.retention.inbox.howLong'] },
          { title: 'privacy.retention.delivery', cells: ['privacy.retention.delivery.howLong'] },
          {
            title: 'privacy.retention.rateLimits',
            cells: ['privacy.retention.rateLimits.howLong'],
          },
          {
            title: 'privacy.retention.signupCounts',
            cells: ['privacy.retention.signupCounts.howLong'],
          },
          {
            title: 'privacy.retention.accessLogs',
            cells: ['privacy.retention.accessLogs.howLong'],
          },
          { title: 'privacy.retention.backups', cells: ['privacy.retention.backups.howLong'] },
        ],
      },
    ],
  },
  {
    id: 'rights',
    heading: 'privacy.rights.title',
    blocks: [
      { kind: 'p', text: 'privacy.rights.lead' },
      {
        kind: 'list',
        items: [
          'privacy.rights.access',
          'privacy.rights.rectify',
          'privacy.rights.erase',
          'privacy.rights.restrict',
          'privacy.rights.portability',
          'privacy.rights.withdraw',
        ],
      },
      { kind: 'p', text: 'privacy.rights.answer' },
    ],
  },
  {
    id: 'complaints',
    heading: 'privacy.complain.title',
    blocks: [{ kind: 'p', text: 'privacy.complain.body' }],
  },
  {
    id: 'children',
    heading: 'privacy.children.title',
    blocks: [{ kind: 'p', text: 'privacy.children.body' }],
  },
  {
    id: 'security',
    heading: 'privacy.security.title',
    blocks: [{ kind: 'p', text: 'privacy.security.body' }],
  },
  {
    id: 'changes',
    heading: 'privacy.changes.title',
    blocks: [{ kind: 'p', text: 'privacy.changes.body' }],
  },
];
