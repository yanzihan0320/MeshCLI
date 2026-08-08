export async function providerResponseError(response: Response): Promise<Error> {
  const raw = await response.text();
  let detail = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { error?: string | { message?: string }; message?: string };
    detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message || parsed.message || detail;
  } catch {
    // Preserve a plain-text upstream response.
  }
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`Model service request failed (${response.status})${suffix}`);
}
