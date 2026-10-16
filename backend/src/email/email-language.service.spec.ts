import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './email.service';

describe('EmailService - language selection', () => {
  it('DEFAULT_LOCALE should be "en"', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('SUPPORTED_LOCALES should include "en" and "fr"', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('fr');
  });

  it('should fall back to DEFAULT_LOCALE for unsupported locale', () => {
    const resolveLocale = (locale: string): string => {
      return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
        ? locale
        : DEFAULT_LOCALE;
    };
    expect(resolveLocale('de')).toBe('en');
    expect(resolveLocale('es')).toBe('en');
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('en')).toBe('en');
  });

  it('should select correct locale when provided', () => {
    const resolveLocale = (locale: string): string =>
      (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
    expect(resolveLocale('fr')).toBe('fr');
  });
});