import { describe, it, expect } from 'vitest';
import { getProvider, listProviders } from '../registry';

describe('provider registry', () => {
  describe('getProvider', () => {
    it('returns the mock provider', () => {
      const provider = getProvider('mock');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('mock');
      expect(provider!.name).toBeTruthy();
    });

    it('returns the openai provider', () => {
      const provider = getProvider('openai');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('openai');
    });

    it('returns the anthropic provider', () => {
      const provider = getProvider('anthropic');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('anthropic');
    });

    it('returns undefined for an unknown provider', () => {
      expect(getProvider('unknown-provider')).toBeUndefined();
    });
  });

  describe('listProviders', () => {
    it('returns an array of all registered providers', () => {
      const providers = listProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(3);
    });

    it('includes mock, openai, and anthropic', () => {
      const ids = listProviders().map((p) => p.id);
      expect(ids).toContain('mock');
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
    });

    it('every provider has id, name, and streamChat', () => {
      for (const provider of listProviders()) {
        expect(typeof provider.id).toBe('string');
        expect(typeof provider.name).toBe('string');
        expect(typeof provider.streamChat).toBe('function');
      }
    });
  });
});
