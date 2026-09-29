import Link from 'next/link';
import type { CandidateRecord, CandidateRecordsResponse } from '@fmip/contracts';
import { Card, Notice } from '@/components/ui';

/**
 * The candidates in shadow and their records, for the console (T-1103,
 * D-140): each candidate's pre-kick-off forecasts counted toward the minimum
 * (D-031), and its log loss and Brier beside the published version's on the
 * same matches, per competition, from the stored evaluations. Read-only. It
 * never says which is better: below the minimum it says how many there are,
 * and at the minimum promotion is a decision entry with these numbers (D-082).
 */

const score = (value: number): string => value.toFixed(4);

function shadowLine(record: CandidateRecord): string {
  if (record.in_shadow === null) {
    return 'The model service did not answer, so whether it still runs in shadow is not known.';
  }
  return record.in_shadow
    ? 'In shadow now.'
    : 'No longer offered by the model service; its record stays.';
}

function CandidateSection({
  locale,
  record,
  minimum,
}: {
  locale: string;
  record: CandidateRecord;
  minimum: number;
}) {
  const reached = record.pre_kickoff_evaluated >= minimum;
  return (
    <Card
      heading={record.model_version}
      headingLevel={2}
      data-testid="candidate-record"
      data-model-version={record.model_version}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{shadowLine(record)}</p>
        <p className="text-sm" data-testid="candidate-count">
          <span className="font-semibold tabular-nums">
            {record.pre_kickoff_evaluated} of {minimum}
          </span>{' '}
          pre-kick-off forecasts evaluated.{' '}
          {reached
            ? 'The minimum is reached: promotion is a decision entry with these numbers, never a switch on this page.'
            : `Fewer than ${minimum}: this is a record, not a verdict.`}
        </p>
        <ul className="text-sm text-muted">
          <li>
            {record.pre_kickoff_awaiting} made before kick-off and waiting for the match to be
            evaluated.
          </li>
          <li>{record.after_kickoff} made after kick-off, which never count.</li>
          <li>{record.unavailable} answered as unavailable, which are not scored.</li>
        </ul>
        {record.competitions.length === 0 ? (
          <p className="text-sm text-muted" data-testid="candidate-no-pairs">
            No match yet where both this candidate and the published version have a pre-kick-off
            evaluation.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm" data-testid="candidate-pairs">
              <caption className="pb-2 text-start text-muted">
                Against the published version on the same matches: for each match and forecast kind,
                the latest pre-kick-off version of each. For both scores, lower is closer to what
                happened.
              </caption>
              <thead>
                <tr className="border-b border-default">
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    Competition
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-semibold">
                    Matches
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-semibold">
                    Log loss, candidate
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-semibold">
                    Log loss, published
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-semibold">
                    Brier, candidate
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-semibold">
                    Brier, published
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    Published version
                  </th>
                </tr>
              </thead>
              <tbody>
                {record.competitions.map((row) => (
                  <tr
                    key={row.competition.id}
                    className="border-b border-default"
                    data-testid="candidate-pair-row"
                  >
                    <td className="py-2 pe-4">
                      <Link
                        href={`/${locale}/competition/${row.competition.id}`}
                        className="underline"
                      >
                        {row.competition.name}
                      </Link>
                    </td>
                    <td className="py-2 pe-4 text-end tabular-nums">{row.pairs}</td>
                    <td className="py-2 pe-4 text-end tabular-nums">
                      {score(row.candidate.log_loss)}
                    </td>
                    <td className="py-2 pe-4 text-end tabular-nums">
                      {score(row.published.log_loss)}
                    </td>
                    <td className="py-2 pe-4 text-end tabular-nums">
                      {score(row.candidate.brier)}
                    </td>
                    <td className="py-2 pe-4 text-end tabular-nums">
                      {score(row.published.brier)}
                    </td>
                    <td className="py-2">{row.published_versions.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

export function CandidateRecordsReport({
  locale,
  report,
}: {
  locale: string;
  report: CandidateRecordsResponse;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Candidates run in shadow: computed beside every published forecast, stored and shown to no
        member (D-082). Only forecasts made before kick-off count (D-031).
      </p>
      {report.service === 'unreachable' && (
        <Notice tone="warning" data-testid="candidates-service-unreachable">
          The model service did not answer, so the list below is the stored records only; a
          candidate with no forecast yet cannot be shown.
        </Notice>
      )}
      {report.candidates.length === 0 ? (
        <p className="text-sm text-muted" data-testid="candidates-none">
          No candidate is in shadow and none has a stored record.
        </p>
      ) : (
        report.candidates.map((record) => (
          <CandidateSection
            key={record.model_version}
            locale={locale}
            record={record}
            minimum={report.minimum}
          />
        ))
      )}
    </div>
  );
}
