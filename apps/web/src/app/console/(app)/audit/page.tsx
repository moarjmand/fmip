import type { Metadata } from 'next';
import { consoleAudit } from '@/lib/console-api';
import { Card, when } from '../../ui';
import { auditActionWords, auditReasonWords } from '../../words';

export const metadata: Metadata = { title: 'کارنامه‌ی کنسول' };

/** Who did what in the console, newest first (rule 10, D-340). */
export default async function ConsoleAuditPage() {
  const result = await consoleAudit();
  const entries = result.ok ? result.data.entries : [];
  return (
    <Card title="کارنامه‌ی کنسول">
      {entries.length === 0 ? (
        <p className="text-sm text-muted">هنوز کاری ثبت نشده.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 text-start font-normal">زمان</th>
                <th className="py-2 text-start font-normal">چه کسی</th>
                <th className="py-2 text-start font-normal">چه کاری</th>
                <th className="py-2 text-start font-normal">روی چه</th>
                <th className="py-2 text-start font-normal">چرا</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={`${entry.at}-${i}`} className="border-t border-default align-top">
                  <td className="py-2 pe-3 whitespace-nowrap text-muted">{when(entry.at)}</td>
                  <td className="py-2 pe-3" dir="ltr">
                    {entry.actor}
                  </td>
                  <td className="py-2 pe-3">
                    {auditActionWords(entry.action).known ? (
                      auditActionWords(entry.action).words
                    ) : (
                      <span dir="ltr">{entry.action}</span>
                    )}
                  </td>
                  <td className="py-2 pe-3 text-xs text-caption" dir="ltr">
                    {entry.target}
                  </td>
                  <td className="py-2 text-muted" dir="auto">
                    {auditReasonWords(entry.reason)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
