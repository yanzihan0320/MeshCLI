import type { StreamCallbacks } from './types';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function abortableDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function retryAfterMs(response: Response) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  try {
    const body = await response.clone().text();
    const match = body.match(/(?:try again|retry)\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*seconds?/i);
    if (match) return Number(match[1]) * 1_000;
  } catch {
    // Fall back to exponential backoff when the response body is unavailable.
  }

  return undefined;
}

export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  callbacks: Pick<StreamCallbacks, 'onRetry'>,
  signal: AbortSignal,
) {
  for (let retryIndex = 0; ; retryIndex += 1) {
    const response = await fetch(input, { ...init, signal });
    if (response.status !== 429 || retryIndex >= RETRY_DELAYS_MS.length) return response;

    const suggestedDelay = await retryAfterMs(response);
    const delayMs = Math.max(RETRY_DELAYS_MS[retryIndex], suggestedDelay ?? 0);
    callbacks.onRetry?.(retryIndex + 1, delayMs);
    await abortableDelay(delayMs, signal);
  }
}
