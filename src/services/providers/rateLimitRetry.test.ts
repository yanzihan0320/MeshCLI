import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRateLimitRetry } from './rateLimitRetry';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchWithRateLimitRetry', () => {
  it('retries a 429 response and reports the wait state', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'request reached max RPM, please try again after 1 seconds' },
      }), { status: 429 }))
      .mockResolvedValueOnce(new Response('ok'));
    const onRetry = vi.fn();

    const resultPromise = fetchWithRateLimitRetry('/api/llm', {}, { onRetry }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, 1_000);
  });
});
