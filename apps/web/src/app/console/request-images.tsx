'use client';

import {
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { ApiError, ConsoleRequestImage } from '@fmip/contracts';
import {
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_IMAGE_CAPTION_MAX,
  CONSOLE_REQUEST_IMAGE_MAX_BYTES,
  CONSOLE_REQUEST_IMAGES_MAX,
  CONSOLE_REQUEST_TITLE_MAX,
} from '@fmip/contracts/console';
import {
  captionRequestImage,
  createRequest,
  refreshRequests,
  removeRequestImage,
} from '@/lib/console-actions';
import { apiErrorWords } from './words';

/**
 * Pictures on the teammate requests (T-1731, D-357), the console's only
 * client code besides its form: an attachment zone with several ways in
 * (choose files, drag and drop onto the zone or the card, paste anywhere in
 * the form, a phone's camera), a strip of what is waiting or uploading with
 * its progress, and on each card the thumbnails with a lightbox (arrows, Esc,
 * swipe). Uploads go one at a time to `request-images/<request>` with the
 * file's own bytes; the server checks and re-encodes every one.
 *
 * Imported only by the console's routes, so none of it reaches a public
 * page's bundle.
 */

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const BUTTON = `inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised has-[:disabled]:pointer-events-none has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${FOCUS}`;
const PRIMARY = `min-h-touch rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 ${FOCUS}`;
const INPUT =
  'min-h-touch w-full rounded-control border border-strong bg-canvas px-3 text-sm text-fg focus:outline-2 focus:outline-focus';

/** The chooser's types: a phone converts a HEIC photo to JPEG for these. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const UPLOAD_HEADER = 'x-fmip-console-upload';
const MB = CONSOLE_REQUEST_IMAGE_MAX_BYTES / 1024 / 1024;

const fa = (n: number): string => new Intl.NumberFormat('fa-IR').format(n);

/** Where the console's pages reach a picture: under the base, never the API. */
export const pictureUrl = (base: string, requestId: string, imageId: string, thumb = false) =>
  `${base}/request-images/${requestId}/${imageId}${thumb ? '?size=thumb' : ''}`;

// --- Choosing files ------------------------------------------------------------

type Kind = 'png' | 'jpeg' | 'gif' | 'webp' | 'heic' | null;

/** What the first bytes say, as the server will judge it: the name and the stated type count for nothing. */
export function sniffKind(head: Uint8Array): Kind {
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0x89 && text(1, 4) === 'PNG') return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (text(0, 4) === 'GIF8') return 'gif';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  if (text(4, 8) === 'ftyp' && /^(hei[cxms]|hev[cx]|mif1|msf1)$/.test(text(8, 12))) return 'heic';
  return null;
}

/** Why a file cannot go, in Persian; `null` when it can. */
export function fileProblem(name: string, size: number, kind: Kind): string | null {
  const label = `«${name}»`;
  if (size === 0) return `${label} خالی است.`;
  if (size > CONSOLE_REQUEST_IMAGE_MAX_BYTES)
    return `${label} بزرگ‌تر از ${fa(MB)} مگابایت است؛ نسخهٔ کوچک‌تری بفرستید.`;
  if (kind === 'heic')
    return `${label} عکس آیفون با قالب اچ‌ئی‌آی‌سی است و اینجا خوانده نمی‌شود؛ از آن اسکرین‌شات بگیرید یا جی‌پگ بفرستید.`;
  if (kind === null) return `${label} تصویر پی‌ان‌جی، جی‌پگ، وب‌پی یا گیف نیست.`;
  return null;
}

/** The files a person gave, split into those that can go and why the rest cannot. */
async function screen(
  files: File[],
  room: number,
): Promise<{ accepted: File[]; problems: string[] }> {
  const accepted: File[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const problem = fileProblem(file.name || 'تصویر', file.size, sniffKind(head));
    if (problem !== null) problems.push(problem);
    else if (accepted.length >= room)
      problems.push(
        `هر درخواست حداکثر ${fa(CONSOLE_REQUEST_IMAGES_MAX)} تصویر دارد؛ «${file.name || 'تصویر'}» اضافه نشد.`,
      );
    else accepted.push(file);
  }
  return { accepted, problems };
}

/** The image files on a clipboard or in a drop. */
function filesOf(items: DataTransferItemList | null, files: FileList | null): File[] {
  const out: File[] = [];
  if (items !== null)
    for (const item of Array.from(items))
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file !== null) out.push(file);
      }
  if (out.length === 0 && files !== null) out.push(...Array.from(files));
  return out;
}

// --- Uploading -----------------------------------------------------------------

type Uploaded = { ok: true } | { ok: false; message: string };

/** One picture, its bytes as they are, with its progress; the answer's English worded in Persian. */
function upload(
  base: string,
  requestId: string,
  file: File,
  caption: string,
  onProgress: (share: number) => void,
): Promise<Uploaded> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const query = caption.trim() === '' ? '' : `?caption=${encodeURIComponent(caption.trim())}`;
    xhr.open('POST', `${base}/request-images/${requestId}${query}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader(UPLOAD_HEADER, '1');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ ok: true });
      let message: string | undefined;
      try {
        message = (JSON.parse(xhr.responseText) as ApiError).message;
      } catch {
        message = undefined;
      }
      resolve({ ok: false, message: apiErrorWords(message, 'تصویر بارگذاری نشد.') });
    };
    xhr.onerror = () => resolve({ ok: false, message: 'اتصال قطع شد؛ تصویر بارگذاری نشد.' });
    xhr.send(file);
  });
}

interface Pending {
  key: string;
  file: File;
  preview: string;
  caption: string;
  state: 'waiting' | 'uploading' | 'failed';
  progress: number;
  error: string | null;
}

let counter = 0;
const pendingOf = (file: File): Pending => ({
  key: `p${(counter += 1)}`,
  file,
  preview: URL.createObjectURL(file),
  caption: '',
  state: 'waiting',
  progress: 0,
  error: null,
});

/** The waiting pictures, kept with their previews released when they go. */
function usePending() {
  const [pending, setPending] = useState<Pending[]>([]);
  const ref = useRef(pending);
  useEffect(() => {
    ref.current = pending;
  });
  useEffect(() => () => ref.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  const patch = (key: string, change: Partial<Pending>) =>
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const drop = (key: string) =>
    setPending((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone !== undefined) URL.revokeObjectURL(gone.preview);
      return list.filter((p) => p.key !== key);
    });
  return { pending, setPending, patch, drop };
}

// --- The zone ------------------------------------------------------------------

/**
 * Where pictures come in: a button for files (several), on a touch screen a
 * second for the camera, and the zone itself takes a drop. Paste and drops on
 * the surrounding form or card are wired by the owner.
 */
export function AttachZone({
  onFiles,
  remaining,
  disabled = false,
  dragging = false,
}: {
  onFiles: (files: File[]) => void;
  remaining: number;
  disabled?: boolean;
  dragging?: boolean;
}) {
  const take = (input: HTMLInputElement) => {
    if (input.files !== null && input.files.length > 0) onFiles(Array.from(input.files));
    input.value = '';
  };
  const full = remaining <= 0;
  return (
    <div
      data-testid="attach-zone"
      data-state={full ? 'full' : dragging ? 'drag' : 'idle'}
      className={`flex flex-col gap-2 rounded-tile border-2 border-dashed p-3 transition-colors ${
        dragging ? 'border-brand bg-surface-raised' : 'border-default bg-canvas'
      }`}
    >
      {full ? (
        <p className="text-sm text-muted">
          این درخواست {fa(CONSOLE_REQUEST_IMAGES_MAX)} تصویر دارد؛ برای افزودن، یکی را حذف کنید.
        </p>
      ) : (
        <>
          <p className="text-sm text-fg">
            تصویر را اینجا بکشید و رها کنید، از کلیپ‌بورد بچسبانید (
            <kbd dir="ltr" className="rounded-sm border border-default px-1 text-xs">
              Ctrl+V
            </kbd>
            ) یا انتخاب کنید.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className={BUTTON}>
              <span aria-hidden="true">＋</span>
              انتخاب تصویر
              <input
                type="file"
                accept={ACCEPT}
                multiple
                disabled={disabled}
                className="sr-only"
                onChange={(event) => take(event.currentTarget)}
              />
            </label>
            <label className={`${BUTTON} hidden pointer-coarse:inline-flex`}>
              گرفتن عکس
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={disabled}
                className="sr-only"
                onChange={(event) => take(event.currentTarget)}
              />
            </label>
          </div>
          <p className="text-xs text-caption">
            <span dir="ltr">PNG · JPEG · WebP · GIF</span>؛ هر تصویر تا {fa(MB)} مگابایت، حداکثر{' '}
            {fa(CONSOLE_REQUEST_IMAGES_MAX)} تصویر. همهٔ اطلاعات پنهان عکس (مثل مکان) پاک می‌شود.
            {remaining < CONSOLE_REQUEST_IMAGES_MAX && ` ${fa(remaining)} جای خالی مانده.`}
          </p>
        </>
      )}
    </div>
  );
}

/** The waiting and uploading pictures, each with its preview, caption, progress and ×. */
export function PendingStrip({
  pending,
  onCaption,
  onRemove,
  captions = true,
}: {
  pending: Pending[];
  onCaption: (key: string, caption: string) => void;
  onRemove: (key: string) => void;
  captions?: boolean;
}) {
  if (pending.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-3" aria-label="تصویرهای پیوست" data-testid="pending-strip">
      {pending.map((p) => (
        <li
          key={p.key}
          data-state={p.state}
          className={`flex w-36 flex-col gap-1.5 rounded-tile border bg-surface p-1.5 ${
            p.state === 'failed' ? 'border-danger' : 'border-default'
          }`}
        >
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob:), not a page image */}
            <img
              src={p.preview}
              alt=""
              className="aspect-[4/3] w-full rounded-control bg-canvas object-cover"
            />
            {p.state !== 'uploading' && (
              <button
                type="button"
                onClick={() => onRemove(p.key)}
                aria-label={`حذف «${p.file.name || 'تصویر'}»`}
                className={`absolute end-1 top-1 grid size-7 place-items-center rounded-full bg-fg text-sm leading-none text-canvas ${FOCUS}`}
              >
                ×
              </button>
            )}
          </div>
          {p.state === 'uploading' ? (
            <div
              role="progressbar"
              aria-label="بارگذاری"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p.progress * 100)}
              className="h-1.5 overflow-hidden rounded-pill bg-surface-raised"
            >
              <div
                className="h-full bg-brand transition-[inline-size]"
                style={{ inlineSize: `${Math.round(p.progress * 100)}%` }}
              />
            </div>
          ) : captions ? (
            <input
              value={p.caption}
              onChange={(event) => onCaption(p.key, event.currentTarget.value)}
              maxLength={CONSOLE_REQUEST_IMAGE_CAPTION_MAX}
              dir="auto"
              placeholder="توضیح (اختیاری)"
              aria-label="توضیح تصویر"
              className={`${INPUT} min-h-9 px-2 text-xs`}
            />
          ) : null}
          {p.error !== null && (
            <p role="alert" className="text-xs text-danger">
              {p.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Drag-over state and the drop, for an element that is not the zone (a card, a form). */
function useDropTarget(
  target: RefObject<HTMLElement | null>,
  onFiles: (files: File[]) => void,
  enabled: boolean,
): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  });
  useEffect(() => {
    const element = target.current;
    if (element === null || !enabled) return;
    let depth = 0;
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      latest.current(filesOf(event.dataTransfer?.items ?? null, event.dataTransfer?.files ?? null));
    };
    element.addEventListener('dragenter', enter);
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', drop);
    return () => {
      element.removeEventListener('dragenter', enter);
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', drop);
    };
  }, [target, enabled]);
  return dragging;
}

/** Image files pasted into the element (a screenshot copied on a phone or a computer). */
function pastedFiles(event: ClipboardEvent | ReactClipboardEvent): File[] {
  return filesOf(event.clipboardData?.items ?? null, event.clipboardData?.files ?? null).filter(
    (file) => file.type.startsWith('image/') || file.type === '',
  );
}

// --- The new request -----------------------------------------------------------

/**
 * The new-request form with its pictures: the request is written first (the
 * server action), then each picture is uploaded to it in turn with its
 * caption and progress; what could not go is said, per picture, in Persian.
 */
export function NewRequestForm({ base }: { base: string }) {
  const form = useRef<HTMLFormElement>(null);
  const { pending, setPending, patch, drop } = usePending();
  const [problems, setProblems] = useState<string[]>([]);
  const [status, setStatus] = useState<{ error: string | null; done: string | null }>({
    error: null,
    done: null,
  });
  const [busy, startTransition] = useTransition();
  const room = CONSOLE_REQUEST_IMAGES_MAX - pending.length;

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    const { accepted, problems: found } = await screen(files, room);
    setProblems(found);
    setPending((list) => [...list, ...accepted.map(pendingOf)]);
  };
  const dragging = useDropTarget(form, (files) => void add(files), !busy);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const element = event.currentTarget;
    startTransition(async () => {
      setStatus({ error: null, done: null });
      const created = await createRequest({ error: null, done: null }, data);
      if (created.error !== null || created.id === undefined) {
        setStatus({ error: created.error ?? 'درخواست ثبت نشد.', done: null });
        return;
      }
      const failed: string[] = [];
      for (const p of pending) {
        patch(p.key, { state: 'uploading', progress: 0, error: null });
        const sent = await upload(base, created.id, p.file, p.caption, (share) =>
          patch(p.key, { progress: share }),
        );
        if (!sent.ok) failed.push(`«${p.file.name || 'تصویر'}»: ${sent.message}`);
        drop(p.key);
      }
      element.reset();
      setProblems(failed);
      setStatus(
        failed.length === 0
          ? {
              error: null,
              done:
                pending.length === 0
                  ? 'درخواست ثبت شد.'
                  : `درخواست با ${fa(pending.length)} تصویر ثبت شد.`,
            }
          : {
              error: `درخواست ثبت شد، اما ${fa(failed.length)} تصویر بارگذاری نشد؛ می‌توانید روی کارت درخواست دوباره اضافه کنید.`,
              done: null,
            },
      );
      if (pending.length > 0) await refreshRequests();
    });
  };

  return (
    <form
      ref={form}
      onSubmit={submit}
      onPaste={(event) => {
        const files = pastedFiles(event);
        if (files.length === 0) return;
        event.preventDefault();
        void add(files);
      }}
      className="flex flex-col gap-3"
      data-testid="new-request-form"
    >
      <label className="flex flex-col gap-1 text-xs text-muted">
        عنوان
        <input
          name="title"
          required
          maxLength={CONSOLE_REQUEST_TITLE_MAX}
          dir="auto"
          placeholder="هم‌تیمی چه می‌خواهد؟"
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        جزئیات (اختیاری)
        <textarea
          name="body"
          rows={3}
          maxLength={CONSOLE_REQUEST_BODY_MAX}
          dir="auto"
          className={`${INPUT} py-2`}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-muted">تصویر (اختیاری)</legend>
        <AttachZone
          onFiles={(files) => void add(files)}
          remaining={room}
          disabled={busy}
          dragging={dragging}
        />
        <PendingStrip
          pending={pending}
          onCaption={(key, caption) => patch(key, { caption })}
          onRemove={drop}
        />
        <Problems problems={problems} />
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" name="priority" value="high" className="size-4 accent-brand" />
        فوری
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? '…' : 'ثبت درخواست'}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {status.error !== null && <span className="text-danger">{status.error}</span>}
          {status.done !== null && <span className="text-success">{status.done}</span>}
        </p>
      </div>
    </form>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul
      role="alert"
      className="flex flex-col gap-1 text-xs text-danger"
      data-testid="attach-problems"
    >
      {problems.map((problem, i) => (
        <li key={i}>{problem}</li>
      ))}
    </ul>
  );
}

// --- A card's pictures ---------------------------------------------------------

/**
 * A request's pictures on its card: the thumbnails (a click opens the
 * lightbox) and, while the request is open, the caption of each, its ×, and
 * the attachment zone. A drop anywhere on the card, or a paste while the
 * focus is in it, adds pictures; they upload at once, one at a time.
 */
export function CardImages({
  base,
  requestId,
  images,
  open,
}: {
  base: string;
  requestId: string;
  images: ConsoleRequestImage[];
  open: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement | null>(null);
  const { pending, setPending, patch, drop } = usePending();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, startTransition] = useTransition();
  const room = CONSOLE_REQUEST_IMAGES_MAX - images.length - pending.length;

  useEffect(() => {
    card.current = anchor.current?.closest('article') ?? null;
  }, []);

  const add = async (files: File[]) => {
    if (!open || files.length === 0) return;
    const { accepted, problems: found } = await screen(files, room);
    setProblems(found);
    if (accepted.length === 0) return;
    const queued = accepted.map(pendingOf);
    setPending((list) => [...list, ...queued]);
    startTransition(async () => {
      const failed: string[] = [];
      for (const p of queued) {
        patch(p.key, { state: 'uploading', progress: 0 });
        const sent = await upload(base, requestId, p.file, '', (share) =>
          patch(p.key, { progress: share }),
        );
        if (sent.ok) drop(p.key);
        else {
          patch(p.key, { state: 'failed', error: sent.message });
          failed.push(`«${p.file.name || 'تصویر'}»: ${sent.message}`);
        }
      }
      setProblems((list) => [...list, ...failed]);
      await refreshRequests();
    });
  };
  const dragging = useDropTarget(card, (files) => void add(files), open);

  useEffect(() => {
    const element = card.current;
    if (element === null || !open) return;
    const paste = (event: ClipboardEvent) => {
      const files = pastedFiles(event);
      if (files.length === 0) return;
      event.preventDefault();
      void add(files);
    };
    element.addEventListener('paste', paste);
    return () => element.removeEventListener('paste', paste);
  });

  if (images.length === 0 && !open) return <div ref={anchor} hidden />;
  return (
    <div ref={anchor} className="flex flex-col gap-2" data-testid="card-images">
      {images.length > 0 && (
        <Gallery base={base} requestId={requestId} images={images} editable={open && !busy} />
      )}
      {open && (
        <details className="group" open={pending.length > 0 || dragging || undefined}>
          <summary
            className={`inline-flex min-h-touch cursor-pointer items-center rounded-control px-2 text-sm text-brand ${FOCUS}`}
          >
            افزودن تصویر
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <AttachZone
              onFiles={(files) => void add(files)}
              remaining={room}
              disabled={busy}
              dragging={dragging}
            />
            <PendingStrip
              pending={pending}
              captions={false}
              onCaption={() => undefined}
              onRemove={drop}
            />
            <Problems problems={problems} />
          </div>
        </details>
      )}
    </div>
  );
}

/** The thumbnails, each a button to the lightbox; on an open request its caption and ×. */
export function Gallery({
  base,
  requestId,
  images,
  editable,
}: {
  base: string;
  requestId: string;
  images: ConsoleRequestImage[];
  editable: boolean;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const remove = (image: ConsoleRequestImage) => {
    if (!window.confirm('این تصویر از درخواست حذف شود؟')) return;
    startTransition(async () => {
      const done = await removeRequestImage(requestId, image.id);
      setMessage(done.error);
    });
  };
  const caption = (image: ConsoleRequestImage, value: string) => {
    if (value.trim() === (image.caption ?? '')) return;
    startTransition(async () => {
      const done = await captionRequestImage(requestId, image.id, value);
      setMessage(done.error);
    });
  };
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label="تصویرهای درخواست" data-testid="thumbnails">
        {images.map((image, i) => (
          <li key={image.id} className="flex w-28 flex-col gap-1 sm:w-32">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`بزرگ‌نمایی تصویر ${fa(image.position)}${image.caption ? `: ${image.caption}` : ''}`}
                className={`block w-full overflow-hidden rounded-control border border-default bg-canvas ${FOCUS}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private picture behind the console session, not an optimisable asset */}
                <img
                  src={pictureUrl(base, requestId, image.id, true)}
                  width={image.thumb_width}
                  height={image.thumb_height}
                  loading="lazy"
                  alt={image.caption ?? `تصویر ${fa(image.position)}`}
                  className="aspect-[4/3] w-full object-cover"
                />
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove(image)}
                  aria-label={`حذف تصویر ${fa(image.position)}`}
                  className={`absolute end-1 top-1 grid size-7 place-items-center rounded-full bg-fg text-sm leading-none text-canvas ${FOCUS}`}
                >
                  ×
                </button>
              )}
            </div>
            {editable ? (
              <input
                defaultValue={image.caption ?? ''}
                maxLength={CONSOLE_REQUEST_IMAGE_CAPTION_MAX}
                dir="auto"
                placeholder="توضیح (اختیاری)"
                aria-label={`توضیح تصویر ${fa(image.position)}`}
                onBlur={(event) => caption(image, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className={`${INPUT} min-h-9 px-2 text-xs`}
              />
            ) : (
              image.caption !== null && (
                <p className="line-clamp-2 break-words text-xs text-muted" dir="auto">
                  {image.caption}
                </p>
              )
            )}
          </li>
        ))}
      </ul>
      {message !== null && (
        <p role="alert" className="text-xs text-danger">
          {message}
        </p>
      )}
      <Lightbox
        base={base}
        requestId={requestId}
        images={images}
        index={index}
        onIndex={setIndex}
      />
    </>
  );
}

/**
 * One picture at full size in a modal dialog: Esc closes (the dialog's own),
 * the arrows move (in right-to-left reading the next picture lies to the
 * left), a swipe moves on a phone, with the caption, the place in the
 * series and a download link. The full picture is asked for only while open.
 */
export function Lightbox({
  base,
  requestId,
  images,
  index,
  onIndex,
}: {
  base: string;
  requestId: string;
  images: ConsoleRequestImage[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  const shown = index === null ? null : (images[index] ?? null);
  const count = images.length;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (shown !== null && !element.open) element.showModal?.();
    if (shown === null && element.open) element.close();
  }, [shown]);

  const move = (step: number) => {
    if (index !== null && count > 0) onIndex((index + step + count) % count);
  };
  const keys = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowLeft') move(1);
    else if (event.key === 'ArrowRight') move(-1);
    else return;
    event.preventDefault();
  };
  const down = (event: ReactPointerEvent) => {
    start.current = event.clientX;
  };
  const up = (event: ReactPointerEvent) => {
    if (start.current === null) return;
    const dx = event.clientX - start.current;
    start.current = null;
    // Right to left: dragging to the right brings in the next picture.
    if (Math.abs(dx) > 50) move(dx > 0 ? 1 : -1);
  };

  return (
    <dialog
      ref={dialog}
      data-testid="lightbox"
      aria-label="نمایش تصویر"
      onClose={() => onIndex(null)}
      onKeyDown={keys}
      onClick={(event) => {
        if (event.target === event.currentTarget) onIndex(null);
      }}
      className="m-auto max-h-[100dvh] w-[min(100vw,72rem)] max-w-full rounded-card border border-default bg-canvas p-0 text-fg backdrop:bg-canvas/90"
    >
      <div className="flex max-h-[100dvh] flex-col gap-2 p-2 sm:p-4">
        <div className="flex items-center justify-between gap-2 text-sm text-fg">
          <span>{shown === null ? '' : `تصویر ${fa((index ?? 0) + 1)} از ${fa(count)}`}</span>
          <div className="flex items-center gap-2">
            {shown !== null && (
              <a
                href={pictureUrl(base, requestId, shown.id)}
                download={`request-${requestId.slice(0, 8)}-${shown.position}.webp`}
                className={`inline-flex min-h-touch items-center rounded-control border border-strong px-3 text-fg hover:bg-surface-raised ${FOCUS}`}
              >
                دانلود
              </a>
            )}
            <button
              type="button"
              onClick={() => onIndex(null)}
              aria-label="بستن"
              className={`grid size-11 place-items-center rounded-control text-2xl leading-none text-fg hover:bg-surface-raised ${FOCUS}`}
            >
              ×
            </button>
          </div>
        </div>
        <div
          className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center"
          onPointerDown={down}
          onPointerUp={up}
        >
          {shown !== null && (
            // eslint-disable-next-line @next/next/no-img-element -- a private picture behind the console session
            <img
              key={shown.id}
              src={pictureUrl(base, requestId, shown.id)}
              width={shown.width}
              height={shown.height}
              alt={shown.caption ?? `تصویر ${fa(shown.position)}`}
              draggable={false}
              className="max-h-[78dvh] w-auto max-w-full select-none rounded-control object-contain"
            />
          )}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="تصویر قبلی"
                className={`absolute start-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-strong bg-surface text-2xl text-fg ${FOCUS}`}
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="تصویر بعدی"
                className={`absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-strong bg-surface text-2xl text-fg ${FOCUS}`}
              >
                ‹
              </button>
            </>
          )}
        </div>
        {shown !== null && shown.caption !== null && (
          <p className="break-words text-center text-sm text-fg" dir="auto">
            {shown.caption}
          </p>
        )}
      </div>
    </dialog>
  );
}
