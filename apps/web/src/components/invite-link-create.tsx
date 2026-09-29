'use client';

import { type ReactNode, useActionState, useState } from 'react';
import type { InviteLinkActionState } from '@/lib/group-settings-actions';
import { Button, FormStatus, TextField } from '@/components/ui';

type LinkAction = (
  state: InviteLinkActionState,
  formData: FormData,
) => Promise<InviteLinkActionState>;

/**
 * Making an invite link (T-1026 over T-1021). Whatever fields the server
 * rendered, a submit button, and -- once -- the new link with a copy control.
 *
 * The token lives only in this form's state: the API stores its hash, the
 * list beside this never shows it, and reloading the page loses it for good,
 * which is what "shown once" means. Without JavaScript the link is still
 * shown, in a read-only field to select and copy by hand. The words arrive
 * already chosen from the catalogue by the server component that renders this.
 */
export function InviteLinkCreate({
  action,
  labels,
  children,
}: {
  action: LinkAction;
  labels: {
    submit: ReactNode;
    working: ReactNode;
    newLink: ReactNode;
    copy: ReactNode;
    copied: ReactNode;
    copyFailed: ReactNode;
  };
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const url = state !== null && state.ok && 'url' in state ? state.url : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-2" data-testid="group-link-new">
        {children}
        <Button
          type="submit"
          variant="primary"
          pending={pending}
          pendingLabel={labels.working}
          data-testid="group-link-new-submit"
          className="self-start"
        >
          {labels.submit}
        </Button>
        {state !== null && (
          <FormStatus ok={state.ok} data-testid="group-link-new-result">
            {state.ok ? (state.message ?? '') : state.message}
          </FormStatus>
        )}
      </form>
      {/* Keyed by the link, so a second link starts with no stale "Copied." beside it. */}
      {url !== null && <CreatedLink key={url} url={url} labels={labels} />}
    </div>
  );
}

function CreatedLink({
  url,
  labels,
}: {
  url: string;
  labels: { newLink: ReactNode; copy: ReactNode; copied: ReactNode; copyFailed: ReactNode };
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="group-link-created">
      {/* A URL reads left to right in any page; the field isolates it. */}
      <TextField
        label={labels.newLink}
        value={url}
        readOnly
        dir="ltr"
        onFocus={(event) => event.currentTarget.select()}
        data-testid="group-link-url"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copyLink()}
          data-testid="group-link-copy"
        >
          {labels.copy}
        </Button>
        {copy !== 'idle' && (
          <FormStatus ok={copy === 'copied'} data-testid="group-link-copy-result">
            {copy === 'copied' ? labels.copied : labels.copyFailed}
          </FormStatus>
        )}
      </div>
    </div>
  );
}
