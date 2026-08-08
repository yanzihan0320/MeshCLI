import { describe, expect, it } from 'vitest';
import { providerResponseError } from './errors';

describe('providerResponseError', () => {
  it('extracts a useful JSON error instead of exposing a raw 502 body', async () => {
    const error = await providerResponseError(new Response(JSON.stringify({ error: 'Upstream request failed: connection refused' }), { status: 502 }));
    expect(error.message).toBe('Model service request failed (502): Upstream request failed: connection refused');
  });
});
