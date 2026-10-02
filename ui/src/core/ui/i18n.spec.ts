import { afterEach, describe, expect, it } from 'vitest'

import { i18n, isRtl, languages } from '@/core/ui/i18n'
import en from '@/i18n/en.json'

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('ships every translation file', () => {
    expect(languages).toHaveLength(29)
    expect(languages).toEqual(expect.arrayContaining(['en', 'de', 'he', 'pt-BR', 'zh-CN', 'zh-TW']))
  })

  it('has english loaded before anything renders', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    expect(i18n.t('form.button_close')).toBe(en['form.button_close' as keyof typeof en])
  })

  it('reads the dotted keys as flat keys, not paths', () => {
    expect(i18n.t('form.button_close')).not.toBe('form.button_close')
  })

  it('interpolates `{{ x }}` with the spaces the translation files use', () => {
    const translated = i18n.t('common.phrases.support', { github: '<a>GitHub</a>', discord: '<a>Discord</a>' })

    expect(translated).toContain('<a>GitHub</a>')
    expect(translated).toContain('<a>Discord</a>')
    expect(translated).not.toContain('{{')
  })

  it('does not escape interpolated values, like ngx-translate', () => {
    expect(i18n.t('common.phrases.support', { github: '<b>&</b>', discord: '' })).toContain('<b>&</b>')
  })

  it('leaves a placeholder alone when its value is not passed', () => {
    expect(i18n.t('common.phrases.support')).toContain('{{ github }}')
  })

  it('hands back the key for a missing translation', () => {
    expect(i18n.t('no.such.key')).toBe('no.such.key')
  })

  it('loads another language on demand', async () => {
    await i18n.changeLanguage('de')

    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true)
    expect(i18n.language).toBe('de')
  })

  it('falls back to english for a language it does not ship', async () => {
    await i18n.changeLanguage('kl')

    expect(i18n.t('form.button_close')).toBe(en['form.button_close' as keyof typeof en])
  })

  it('knows which languages are right to left', () => {
    // Only reported (Angular's unused `settings.rtl`): the app ships left to
    // right Bootstrap, so the layout is not turned around
    expect(isRtl('he')).toBe(true)
    expect(isRtl('fr')).toBe(false)
  })
})
