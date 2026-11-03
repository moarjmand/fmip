import type { ConsoleRequestImage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { isConsoleUpload, UPLOAD_HEADER } from './request-images/picture-route';

vi.mock('@/lib/console-actions', () => {
  const action = async () => ({ error: null, done: null });
  return {
    createRequest: action,
    editRequest: action,
    requestAction: action,
    decideRequest: action,
    removeRequestImage: action,
    captionRequestImage: action,
    refreshRequests: async () => undefined,
  };
});

const {
  AttachZone,
  CardImages,
  Lightbox,
  NewRequestForm,
  PendingStrip,
  fileProblem,
  pictureUrl,
  sniffKind,
} = await import('./request-images');
const { RequestCard } = await import('./requests');

/**
 * Pictures on the teammate requests (T-1731, D-357), as the console draws
 * them: the attachment zone's ways in and its states, the waiting strip with
 * progress, a card's thumbnails and the lightbox; Persian throughout, sides
 * logical only (rule 7), and every picture's address under the console's base.
 */

const REQUEST = '0f8fad5b-d9cb-469f-a165-70867728950e';
const image = (overrides: Partial<ConsoleRequestImage> = {}): ConsoleRequestImage => ({
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  position: 1,
  caption: 'جدول روی گوشی',
  content_type: 'image/webp',
  byte_size: 90_000,
  width: 1170,
  height: 2400,
  sha256: 'a'.repeat(64),
  thumb_width: 234,
  thumb_height: 480,
  uploaded_by: 'مصطفی',
  created_at: '2026-11-03T08:00:00.000Z',
  ...overrides,
});
const SECOND = image({ id: '9b2d3f0a-1c4e-4b7a-8f61-2d5e7a9c0b14', position: 2, caption: null });

const noPhysicalSides = (html: string) =>
  expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);

describe('the attachment zone', () => {
  it('offers files (several), the camera on a touch screen, drop and paste', () => {
    const html = renderToStaticMarkup(<AttachZone onFiles={() => undefined} remaining={8} />);
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('انتخاب تصویر');
    expect(html).toMatch(
      /type="file" accept="image\/png,image\/jpeg,image\/webp,image\/gif" multiple=""/,
    );
    expect(html).toContain('گرفتن عکس');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('pointer-coarse:inline-flex');
    expect(html).toContain('بکشید و رها کنید');
    expect(html).toMatch(/<kbd dir="ltr"[^>]*>Ctrl\+V<\/kbd>/);
    expect(html).toContain('۸ مگابایت');
    expect(html).toContain('مکان');
    noPhysicalSides(html);
  });

  it('shows a drag over it, and says when the request is full', () => {
    expect(
      renderToStaticMarkup(<AttachZone onFiles={() => undefined} remaining={3} dragging />),
    ).toContain('data-state="drag"');
    const full = renderToStaticMarkup(<AttachZone onFiles={() => undefined} remaining={0} />);
    expect(full).toContain('data-state="full"');
    expect(full).toContain('۸ تصویر دارد');
    expect(full).not.toContain('type="file"');
  });

  it('draws what waits, uploads (with progress) and failed', () => {
    const file = { name: 'screen.png' } as File;
    const html = renderToStaticMarkup(
      <PendingStrip
        onCaption={() => undefined}
        onRemove={() => undefined}
        pending={[
          {
            key: 'a',
            file,
            preview: 'blob:a',
            caption: '',
            state: 'waiting',
            progress: 0,
            error: null,
          },
          {
            key: 'b',
            file,
            preview: 'blob:b',
            caption: '',
            state: 'uploading',
            progress: 0.42,
            error: null,
          },
          {
            key: 'c',
            file,
            preview: 'blob:c',
            caption: '',
            state: 'failed',
            progress: 0,
            error: 'هر تصویر حداکثر ۸ مگابایت است.',
          },
        ]}
      />,
    );
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain('placeholder="توضیح (اختیاری)"');
    expect(html).toContain('maxLength="300"');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="42"/);
    expect(html).toContain('inline-size:42%');
    expect(html).toContain('role="alert"');
    expect(html).toContain('حذف «screen.png»');
    // No × while a picture is on its way.
    expect(html.match(/aria-label="حذف/g)).toHaveLength(2);
    noPhysicalSides(html);
  });
});

describe('the new-request form', () => {
  it('has the title, the details, the pictures and the priority', () => {
    const html = renderToStaticMarkup(<NewRequestForm base="/agents" />);
    expect(html).toContain('data-testid="new-request-form"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="body"');
    expect(html).toContain('تصویر (اختیاری)');
    expect(html).toContain('data-testid="attach-zone"');
    expect(html).toContain('name="priority"');
    expect(html).toContain('ثبت درخواست');
    expect(html).toContain('role="status"');
  });
});

describe("a card's pictures", () => {
  it('draws thumbnails under the base, each opening the lightbox, with captions and × while open', () => {
    const html = renderToStaticMarkup(
      <CardImages base="/agents" requestId={REQUEST} images={[image(), SECOND]} open />,
    );
    expect(html).toContain(`src="/agents/request-images/${REQUEST}/${image().id}?size=thumb"`);
    expect(html).toContain('width="234" height="480"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="جدول روی گوشی"');
    expect(html).toContain('alt="تصویر ۲"');
    expect(html).toContain('بزرگ‌نمایی تصویر ۱: جدول روی گوشی');
    expect(html).toContain('حذف تصویر ۱');
    expect(html).toContain('value="جدول روی گوشی"');
    expect(html).toContain('افزودن تصویر');
    expect(html).toContain('data-testid="lightbox"');
    // The full picture is not asked for until the lightbox opens.
    expect(html).not.toContain(`request-images/${REQUEST}/${image().id}"`);
    noPhysicalSides(html);
  });

  it('on a closed request shows the pictures only', () => {
    const html = renderToStaticMarkup(
      <CardImages base="" requestId={REQUEST} images={[image()]} open={false} />,
    );
    expect(html).toContain(`src="/request-images/${REQUEST}/${image().id}?size=thumb"`);
    expect(html).toContain('جدول روی گوشی');
    expect(html).not.toContain('حذف تصویر');
    expect(html).not.toContain('افزودن تصویر');
    expect(html).not.toContain('data-testid="attach-zone"');
    expect(
      renderToStaticMarkup(<CardImages base="" requestId={REQUEST} images={[]} open={false} />),
    ).not.toContain('data-testid="card-images"');
  });

  it('puts the pictures under the details on the card', () => {
    const html = renderToStaticMarkup(
      <RequestCard
        base="/agents"
        request={{
          id: REQUEST,
          title: 'جدول',
          body: 'جزئیات',
          status: 'new',
          priority: 'normal',
          created_by: 'مصطفی',
          created_at: '2026-11-03T08:00:00.000Z',
          updated_at: '2026-11-03T08:00:00.000Z',
          result: null,
          result_at: null,
          decision_question: null,
          decision_asked_at: null,
          decision_choice: null,
          decision_text: null,
          decision_by: null,
          decided_at: null,
          execute_requested_at: null,
          images: [image()],
          events: [],
        }}
      />,
    );
    expect(html.indexOf('جزئیات')).toBeLessThan(html.indexOf('data-testid="thumbnails"'));
    expect(html.indexOf('data-testid="thumbnails"')).toBeLessThan(
      html.indexOf('data-testid="result-box"'),
    );
  });
});

describe('the lightbox', () => {
  it('shows the picture, its caption, its place, a download link, and moves both ways', () => {
    const html = renderToStaticMarkup(
      <Lightbox
        base="/agents"
        requestId={REQUEST}
        images={[image(), SECOND]}
        index={0}
        onIndex={() => undefined}
      />,
    );
    expect(html).toMatch(/<dialog[^>]*aria-label="نمایش تصویر"/);
    expect(html).toContain(`src="${pictureUrl('/agents', REQUEST, image().id)}"`);
    expect(html).toContain('width="1170" height="2400"');
    expect(html).toContain('تصویر ۱ از ۲');
    expect(html).toContain('جدول روی گوشی');
    expect(html).toContain(`download="request-0f8fad5b-1.webp"`);
    expect(html).toContain('دانلود');
    expect(html).toContain('aria-label="بستن"');
    expect(html).toContain('aria-label="تصویر قبلی"');
    expect(html).toContain('aria-label="تصویر بعدی"');
    noPhysicalSides(html);
  });

  it('asks for nothing while closed, and has no arrows for one picture', () => {
    const closed = renderToStaticMarkup(
      <Lightbox
        base=""
        requestId={REQUEST}
        images={[image()]}
        index={null}
        onIndex={() => undefined}
      />,
    );
    expect(closed).not.toContain('<img');
    const one = renderToStaticMarkup(
      <Lightbox
        base=""
        requestId={REQUEST}
        images={[image()]}
        index={0}
        onIndex={() => undefined}
      />,
    );
    expect(one).not.toContain('تصویر بعدی');
  });
});

describe('choosing a file', () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(
      values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
    );

  it('reads the type from the first bytes, as the server does', () => {
    expect(sniffKind(bytes(0x89, 'PNG', 13, 10))).toBe('png');
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffKind(bytes('GIF89a'))).toBe('gif');
    expect(sniffKind(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp');
    expect(sniffKind(bytes(0, 0, 0, 24, 'ftypheic'))).toBe('heic');
    expect(sniffKind(bytes('<svg'))).toBeNull();
  });

  it('says in Persian why a file cannot go', () => {
    expect(fileProblem('a.png', 9 * 1024 * 1024, 'png')).toContain('بزرگ‌تر از ۸ مگابایت');
    expect(fileProblem('a.heic', 1000, 'heic')).toContain('اسکرین‌شات');
    expect(fileProblem('a.pdf', 1000, null)).toContain('نیست');
    expect(fileProblem('a.png', 0, 'png')).toContain('خالی');
    expect(fileProblem('a.png', 1000, 'png')).toBeNull();
    for (const text of [
      fileProblem('x', 9 * 1024 * 1024, 'png'),
      fileProblem('x', 1, 'heic'),
      fileProblem('x', 1, null),
    ])
      expect(text).not.toMatch(/[A-Za-z]{2,}/);
  });
});

describe('the upload route', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('takes an upload only from the console page on this host', () => {
    expect(
      isConsoleUpload(
        headers({
          [UPLOAD_HEADER]: '1',
          origin: 'https://traveltohormuz.ir',
          host: 'traveltohormuz.ir',
        }),
      ),
    ).toBe(true);
    expect(
      isConsoleUpload(headers({ origin: 'https://traveltohormuz.ir', host: 'traveltohormuz.ir' })),
    ).toBe(false);
    expect(
      isConsoleUpload(
        headers({
          [UPLOAD_HEADER]: '1',
          origin: 'https://evil.example',
          host: 'traveltohormuz.ir',
        }),
      ),
    ).toBe(false);
    expect(isConsoleUpload(headers({ [UPLOAD_HEADER]: '1', host: 'traveltohormuz.ir' }))).toBe(
      false,
    );
    expect(
      isConsoleUpload(
        headers({
          [UPLOAD_HEADER]: '1',
          origin: 'https://agents.traveltohormuz.ir',
          host: 'web:3000',
          'x-forwarded-host': 'agents.traveltohormuz.ir',
        }),
      ),
    ).toBe(true);
  });
});
