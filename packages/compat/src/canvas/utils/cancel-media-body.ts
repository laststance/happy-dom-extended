import type { Response } from 'happy-dom'

/** Cancels discarded media streams for {@link fetchCanvasResource} without replacing the original load or policy failure.
 * @param body - Response body or its locked reader.
 * @param reason - Original failure forwarded to the consumer's cancellation algorithm.
 * @returns Completion even if the consumer's cancellation algorithm throws or rejects.
 * @example await cancelMediaBody(response.body, originalError);
 */
export async function cancelMediaBody(
  body: Pick<NonNullable<Response['body']>, 'cancel'> | null | undefined,
  reason?: unknown,
): Promise<void> {
  try {
    await body?.cancel(reason)
  } catch {
    // Cancellation is cleanup; the caller still reports the original media failure.
  }
}
