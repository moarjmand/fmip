import type { ChatHealth, LiveHealth } from '@fmip/contracts';

/**
 * The two live paths, on the operator's page (T-236).
 *
 * Ingestion is already here, in its own section, from the administration
 * overview. What was missing is the pair that only a health endpoint knows: how
 * many readers the score stream is holding, and whether the chat socket layer is
 * doing anything at all.
 *
 * **Unreachable is stated, never rendered as zero.** "No connections" and "we
 * could not ask" are different facts, and the second one shown as the first is
 * the exact shape of rule 3: a module that looks populated and is not.
 *
 * **Every chat number belongs to one instance, and the panel says so.** Sockets
 * live on the process that accepted them; this page asked one of them. An
 * operator reading a total that was quietly summed from one instance's answer
 * would be reading a number nobody measured.
 */
export function HealthPanel({ live, chat }: { live: LiveHealth | null; chat: ChatHealth | null }) {
  return (
    <section className="flex flex-col gap-4" data-testid="admin-health">
      <h2 className="text-lg font-semibold">Live paths</h2>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Scores stream</h3>
        {live === null ? (
          <p className="text-sm" role="alert" data-testid="health-live-unreachable">
            The live path could not be asked.
          </p>
        ) : (
          <ul className="text-sm" data-testid="health-live">
            <li>Readers attached: {live.stream_subscribers}</li>
            <li className="opacity-70">Checked at {live.checked_at}</li>
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Chat</h3>
        {chat === null ? (
          <p className="text-sm" role="alert" data-testid="health-chat-unreachable">
            The chat layer could not be asked.
          </p>
        ) : (
          <>
            <ul className="text-sm" data-testid="health-chat">
              <li>
                Delivery channel: <strong>{busWords(chat.bus)}</strong>
              </li>
              <li>Sockets open: {chat.connections}</li>
              <li>Conversations subscribed: {chat.subscriptions}</li>
              <li>Delivered since this instance started: {chat.delivered}</li>
              <li>Subscriptions ended because the member had left: {chat.dropped}</li>
              <li>
                Handshakes refused: {chat.refused.unauthenticated} with no session,{' '}
                {chat.refused.origin} from another origin
              </li>
              <li>
                {chat.latency_ms === null
                  ? // Not zero: nothing has been delivered, which is a different
                    // thing from being instant.
                    'Delivery time: nothing delivered yet'
                  : `Delivery time: ${chat.latency_ms.p50} ms typical, ${chat.latency_ms.p95} ms slow, over ${chat.latency_ms.samples} messages`}
              </li>
              <li className="opacity-70">Checked at {chat.checked_at}</li>
            </ul>
            <p className="text-sm opacity-70" data-testid="health-chat-scope">
              These numbers are one instance — {chat.instance}. Sockets live on the process that
              accepted them, so a deployment with more than one has a separate answer for each.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Three states, in an operator's words. `absent` and `down` are kept apart
 * because "we never configured it" and "it broke" call for different people.
 */
function busWords(state: ChatHealth['bus']): string {
  if (state === 'connected') return 'connected';
  if (state === 'absent') return 'not configured — chat is not delivered live';
  if (state === 'down') return 'down — chat is not being delivered';
  // A state this panel has not been taught. The guard makes that a failing
  // test, and until somebody fixes it an operator is told the truth rather
  // than being shown whichever branch happened to be last.
  return `unrecognised (${String(state)}) — ask the API directly`;
}
