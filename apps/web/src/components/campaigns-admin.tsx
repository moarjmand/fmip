import type { Audience, Campaign } from '@fmip/contracts';
import { ActionForm } from '@/components/action-form';
import { createCampaignAction, sendCampaignAction } from '@/lib/campaign-actions';

/**
 * Campaigns (T-332, D-075): a message to an audience, sent once, with the
 * report of who it reached. A member who turned campaigns off is counted as
 * muted, never reached around the side; the numbers here are the inbox's.
 */
function Report({ campaign }: { campaign: Campaign }) {
  const d = campaign.dispatch;
  if (d === null) {
    return (
      <span className="text-sm opacity-70" data-testid="campaign-unsent">
        Not sent yet.
      </span>
    );
  }
  return (
    <span className="text-sm" data-testid="campaign-report">
      Sent by {d.started_by ?? 'somebody'} at {d.started_at} to an audience of {d.audience_size}:{' '}
      {d.reached} reached, {d.delayed} held for quiet hours, {d.muted} muted, {d.duplicate} already
      told, {d.failed} failed
      {d.finished_at === null ? ' · still sending' : ''}.
    </span>
  );
}

export function CampaignsAdmin({
  locale,
  audiences,
  campaigns,
}: {
  locale: string;
  audiences: Audience[];
  campaigns: Campaign[];
}) {
  return (
    <section className="flex flex-col gap-4" data-testid="campaigns">
      <h2 className="text-lg font-semibold">Campaigns</h2>
      <p className="text-sm opacity-70">
        A title, a body and the page it opens, sent once to an audience through every member&apos;s
        own inbox, e-mail and push. Nobody receives the same campaign twice.
      </p>
      {campaigns.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="campaigns-empty">
          No campaign yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-current/10" data-testid="campaign-list">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="flex flex-col gap-2 py-3" data-testid="campaign">
              <span className="font-medium">{campaign.title}</span>
              <span className="text-sm">{campaign.body}</span>
              <span className="text-xs opacity-60">
                opens {campaign.path} · audience {campaign.audience_name} ·{' '}
                {campaign.created_by ?? 'somebody'} · {campaign.reason} · {campaign.created_at}
              </span>
              <Report campaign={campaign} />
              {campaign.dispatch === null && (
                <details>
                  <summary className="cursor-pointer text-sm underline">Send now</summary>
                  <div className="pt-3">
                    <ActionForm
                      action={sendCampaignAction.bind(null, locale, campaign.id)}
                      fields={[
                        { name: 'reason', label: 'Why now', required: true, maxLength: 300 },
                      ]}
                      submitLabel="Send this campaign once"
                      testId={`campaign-send-${campaign.id}`}
                    />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm underline">Create a campaign</summary>
        <div className="pt-3">
          {audiences.length === 0 ? (
            <p className="text-sm opacity-70">Save an audience first.</p>
          ) : (
            <ActionForm
              action={createCampaignAction.bind(null, locale)}
              fields={[
                {
                  name: 'audience_id',
                  label: 'Audience',
                  type: 'select',
                  options: audiences.map((audience) => ({
                    value: audience.id,
                    label: `${audience.name} (${audience.size})`,
                  })),
                },
                { name: 'title', label: 'Title', required: true, maxLength: 120 },
                { name: 'body', label: 'Body', type: 'textarea', required: true, maxLength: 2000 },
                {
                  name: 'path',
                  label: 'Opens',
                  required: true,
                  hint: 'A page in the app, without the language: /scores, /match/<id>.',
                  defaultValue: '/scores',
                },
                { name: 'reason', label: 'Why this campaign', required: true, maxLength: 300 },
              ]}
              submitLabel="Create campaign"
              testId="campaign-create"
            />
          )}
        </div>
      </details>
    </section>
  );
}
