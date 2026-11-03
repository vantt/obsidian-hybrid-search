import { describe, expect, it } from 'vitest';
import { fold } from '../src/fold.js';
import { resolveOptions } from '../src/options.js';
import {
  accentedForms,
  restoreTokens,
  VocabularyCache,
  type RestoreInput,
} from '../src/restore.js';
import { fakeContext } from './fake-context.js';

const options = resolveOptions();
const forms = accentedForms('modern', false);

function inputs(text: string): RestoreInput[] {
  return text.split(' ').map((w) => ({ norm: w, folded: fold(w), pinned: fold(w) !== w }));
}

const VAULT = [
  'Kế hoạch bán hàng online cho quý một',
  'Chiến lược bán hàng qua mạng xã hội',
  'Bạn bè và bạn hàng của công ty',
  'Bàn làm việc mới, cái bàn gỗ',
  'Bạn học cũ gặp lại bạn thân',
  'Bản đồ thành phố',
  'Ban giám đốc họp',
  'Con đường đến trường',
  'Đường kính của ống nước',
];

describe('accentedForms', () => {
  it('lists every accented syllable that folds to the key', () => {
    const ban = forms.get('ban')!;
    for (const w of ['ban', 'bán', 'bàn', 'bản', 'bãn', 'bạn', 'băn', 'bằn', 'bận', 'bấn'])
      expect(ban).toContain(w);
    expect(forms.get('duong')).toEqual(expect.arrayContaining(['đường', 'dương', 'đương']));
    expect(forms.get('online')).toBeUndefined();
  });

  it('uses the requested tone placement', () => {
    expect(forms.get('hoa')).toContain('hoà');
    expect(accentedForms('classic', false).get('hoa')).toContain('hòa');
  });

  it('merges y into i with foldIY', () => {
    expect(accentedForms('modern', true).get('ki')).toEqual(
      expect.arrayContaining(['kĩ', 'kỹ', 'kì', 'kỳ']),
    );
    expect(forms.get('ki')).not.toContain('kỹ');
  });
});

describe('restoreTokens', () => {
  it('restores "ban hang online" to "bán hàng online" when the vault has the pair', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens(
      inputs('ban hang online'),
      ctx,
      new VocabularyCache(),
      options.restoreParams,
      forms,
    );
    expect(result.candidates[0]!.forms).toEqual(['bán', 'hàng', 'online']);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.tokens[2]).toMatchObject({ restored: false, variants: [{ form: 'online' }] });
  });

  it('prefers the attested pair over a more frequent single syllable', () => {
    // "bạn" occurs in more notes than "bán", but only "bán hàng" is a phrase... and
    // "bạn hàng" also is: the more frequent phrase wins, both stay in the list.
    const ctx = fakeContext([...VAULT, 'bán hàng tại chỗ']);
    const result = restoreTokens(
      inputs('ban hang'),
      ctx,
      new VocabularyCache(),
      options.restoreParams,
      forms,
    );
    expect(result.candidates[0]!.forms.join(' ')).toBe('bán hàng');
    expect(result.candidates.map((c) => c.forms.join(' '))).toContain('bạn hàng');
    const sum = result.candidates.reduce((s, c) => s + c.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('returns several variants of "ban" alone, by frequency', () => {
    const ctx = fakeContext([...VAULT, 'Gặp bạn cũ']);
    const result = restoreTokens(
      inputs('ban'),
      ctx,
      new VocabularyCache(),
      options.restoreParams,
      forms,
    );
    const variants = result.tokens[0]!.variants.map((v) => v.form);
    expect(variants[0]).toBe('bạn');
    expect(variants).toEqual(expect.arrayContaining(['bán', 'bàn', 'bản', 'ban']));
    expect(variants.length).toBeLessThanOrEqual(options.restoreParams.maxVariants);
    const docs = result.tokens[0]!.variants.map((v) => v.docs);
    expect([...docs].sort((a, b) => b - a)).toEqual(docs);
  });

  it('restores đ from d', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens(
      inputs('con duong'),
      ctx,
      new VocabularyCache(),
      options.restoreParams,
      forms,
    );
    expect(result.candidates[0]!.forms).toEqual(['con', 'đường']);
  });

  it('keeps pinned tokens and unknown syllables as typed', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens(
      inputs('bán xyz hang'),
      ctx,
      new VocabularyCache(),
      options.restoreParams,
      forms,
    );
    expect(result.candidates[0]!.forms).toEqual(['bán', 'xyz', 'hàng']);
    expect(result.tokens[0]!.pinned).toBe(true);
  });

  it('never offers more than maxVariants per syllable', () => {
    const many = ['ba', 'bà', 'bá', 'bả', 'bã', 'bạ', 'bâ', 'bầ'].map((w) => `${w} test`);
    const ctx = fakeContext(many);
    const result = restoreTokens(
      inputs('ba'),
      ctx,
      new VocabularyCache(),
      { ...options.restoreParams, maxVariants: 3 },
      forms,
    );
    expect(result.tokens[0]!.variants).toHaveLength(3);
  });

  it('restores at most maxSyllables tokens', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens(
      inputs('ban hang ban hang'),
      ctx,
      new VocabularyCache(),
      { ...options.restoreParams, maxSyllables: 2 },
      forms,
    );
    expect(result.candidates[0]!.forms.slice(2)).toEqual(['ban', 'hang']);
  });

  it('bounds phrase lookups', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens(
      inputs('ban ban ban ban ban ban'),
      ctx,
      new VocabularyCache(),
      { ...options.restoreParams, maxPhraseLookups: 10 },
      forms,
    );
    expect(result.phraseLookups).toBeLessThanOrEqual(10);
  });

  it('caches lookups per db version', () => {
    const ctx = fakeContext(VAULT);
    const cache = new VocabularyCache();
    restoreTokens(inputs('ban hang'), ctx, cache, options.restoreParams, forms);
    const first = { ...ctx.calls };
    restoreTokens(inputs('ban hang'), ctx, cache, options.restoreParams, forms);
    expect(ctx.calls).toEqual(first);
    ctx.bump();
    restoreTokens(inputs('ban hang'), ctx, cache, options.restoreParams, forms);
    expect(ctx.calls.termStats).toBeGreaterThan(first.termStats);
  });

  it('handles an empty input', () => {
    const ctx = fakeContext(VAULT);
    const result = restoreTokens([], ctx, new VocabularyCache(), options.restoreParams, forms);
    expect(result.candidates).toEqual([]);
    expect(result.confidence).toBe(1);
  });
});
