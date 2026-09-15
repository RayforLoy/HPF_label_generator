import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileCode2, Languages, Moon, RotateCcw, Search, Sun, Upload, Wrench } from 'lucide-react'
import csvUrl from '../lensDB.csv?url'
import type opentype from 'opentype.js'
import { contrastColor, createArtwork, createDxf, safeFilename } from './artwork'
import { DEFAULT_CONFIG, circumferenceMm, focalLengthFor, parseLensCsv, validateConfig } from './core'
import { downloadText, downloadBlob, svgToPng } from './download'
import { BUILT_IN_FONTS, loadFont, loadUploadedFont } from './fonts'
import { t } from './i18n'
import type { FontChoice, GeneratorConfig, Language, Lens, Theme } from './types'

type NumberKey = 'focalLengthMm' | 'extensionMmPerDeg' | 'maxAngleDeg' | 'ringDiameterMm' | 'ringWidthMm' | 'significantDigits' | 'dpi' | 'tickLengthMm' | 'tickWidthMm' | 'fontSizeMm' | 'letterSpacingMm' | 'frameWidthPx' | 'infinityMarginMm'

function Field({ label, help, unit, value, min, max, step, invalid, onChange }: { label: string; help: string; unit?: string; value: number; min?: number; max?: number; step?: number; invalid?: boolean; onChange: (value: number) => void }) {
  return <label className={`field ${invalid ? 'field-invalid' : ''}`}>
    <span className="field-heading"><span>{label}</span>{unit && <span className="unit">{unit}</span>}</span>
    <span className="input-shell"><input type="number" value={value} min={min} max={max} step={step ?? 'any'} onChange={(event) => onChange(Number(event.target.value))} /><span>{unit}</span></span>
    <small>{help}</small>
  </label>
}

function Toggle({ checked, label, help, onChange }: { checked: boolean; label: string; help?: string; onChange: (value: boolean) => void }) {
  return <label className="toggle-row">
    <span><strong>{label}</strong>{help && <small>{help}</small>}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="switch" aria-hidden="true" />
  </label>
}

function ParameterDiagram({ language }: { language: Language }) {
  return <div className="diagram-card">
    <div className="diagram-copy"><strong>{t(language, 'diagramTitle')}</strong><span>{t(language, 'formula')}</span></div>
    <svg viewBox="0 0 420 116" role="img" aria-label={t(language, 'diagramTitle')}>
      <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>
      <path className="diagram-ring" d="M62 18c26 0 47 18 47 40S88 98 62 98 15 80 15 58s21-40 47-40Z" />
      <line x1="15" y1="108" x2="109" y2="108" /><line x1="15" y1="102" x2="15" y2="114" /><line x1="109" y1="102" x2="109" y2="114" />
      <text x="62" y="102" textAnchor="middle">{t(language, 'diagramDiameter')}</text>
      <rect x="154" y="34" width="98" height="48" rx="3" /><line x1="268" y1="34" x2="268" y2="82" /><line x1="280" y1="34" x2="280" y2="82" />
      <line x1="154" y1="98" x2="252" y2="98" /><text x="203" y="112" textAnchor="middle">{t(language, 'diagramWidth')}</text>
      <path d="M300 70c18-25 51-27 71-7" markerEnd="url(#arrow)" /><text x="340" y="102" textAnchor="middle">{t(language, 'diagramRotation')}</text>
    </svg>
  </div>
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('hpf-language') as Language) || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('hpf-theme') as Theme) || 'dark')
  const [config, setConfig] = useState<GeneratorConfig>({ ...DEFAULT_CONFIG, lensName: 'MAKRO-SYMMAR_HM_180_5.6' })
  const [lenses, setLenses] = useState<Lens[]>([])
  const [fontChoices, setFontChoices] = useState<FontChoice[]>(BUILT_IN_FONTS)
  const [lensQuery, setLensQuery] = useState('')
  const [font, setFont] = useState<opentype.Font | null>(null)
  const [status, setStatus] = useState('loading')
  const [fontMessage, setFontMessage] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#06121f' : '#f5f6f1')
    localStorage.setItem('hpf-theme', theme)
  }, [theme])
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; localStorage.setItem('hpf-language', language) }, [language])
  useEffect(() => {
    Promise.all([fetch(csvUrl).then((response) => response.text()).then(parseLensCsv), loadFont(BUILT_IN_FONTS[0].url)])
      .then(([records, loadedFont]) => { setLenses(records); setFont(loadedFont); setStatus('ready') })
      .catch((error) => { console.error(error); setStatus('error') })
  }, [])

  const errors = useMemo(() => validateConfig(config), [config])
  const artwork = useMemo(() => font && errors.length === 0 ? createArtwork(config, font) : null, [config, font, errors])
  const preview = useMemo(() => font && errors.length === 0 ? createArtwork(config, font, true) : null, [config, font, errors])
  const selectedLens = useMemo(() => lenses.find((lens) => lens.lensName === config.lensName), [lenses, config.lensName])
  const visibleLenses = useMemo(() => {
    const query = lensQuery.trim().toLocaleLowerCase()
    if (!query) return lenses
    return lenses.filter((lens) => `${lens.lensName} ${lens.vender} ${lens.version}`.toLocaleLowerCase().includes(query))
  }, [lenses, lensQuery])

  const update = <K extends keyof GeneratorConfig>(key: K, value: GeneratorConfig[K]) => setConfig((current) => ({ ...current, [key]: value }))
  const updateNumber = (key: NumberKey, value: number) => update(key, value)

  const chooseLens = (name: string) => {
    const lens = lenses.find((item) => item.lensName === name)
    if (!lens) { setConfig((current) => ({ ...current, lensName: name, focalSource: 'manual' })); return }
    const focal = focalLengthFor(lens)
    setConfig((current) => ({ ...current, lensName: name, ...(focal ? { focalLengthMm: focal.value, focalSource: focal.source } : { focalSource: 'manual' as const }) }))
  }

  const chooseFont = async (id: string) => {
    const choice = fontChoices.find((item) => item.id === id)
    if (!choice) return
    setStatus('loading')
    try {
      setFont(await loadFont(choice.url))
      setConfig((current) => ({ ...current, fontId: choice.id, fontName: choice.label }))
      setStatus('ready')
    } catch (error) { console.error(error); setStatus('error') }
  }

  const uploadFont = async (file?: File) => {
    if (!file) return
    try {
      const result = await loadUploadedFont(file)
      const label = file.name.replace(/\.(ttf|otf)$/i, '')
      const choice = { id: `custom-${Date.now()}`, label, family: label, url: result.url }
      setFontChoices((current) => [...current.filter((item) => !item.id.startsWith('custom-')), choice])
      setFont(result.font); setConfig((current) => ({ ...current, fontId: choice.id, fontName: label })); setFontMessage(t(language, 'fontLoaded'))
    } catch (error) { console.error(error); setFontMessage(t(language, 'invalidFont')) }
  }

  const baseName = `${safeFilename(config.lensName)}_${Number(config.focalLengthMm.toFixed(2))}mm_HPF`
  const exportSvg = () => artwork && downloadText(artwork.svg, `${baseName}.svg`, 'image/svg+xml')
  const exportDxf = () => font && downloadText(createDxf(config, font), `${baseName}.dxf`, 'application/dxf')
  const exportJson = () => downloadText(JSON.stringify({ format: 'HPF label generator', version: 1, config }, null, 2), `${baseName}.json`, 'application/json')
  const exportPng = async () => artwork && downloadBlob(await svgToPng(artwork.svg, config), `${baseName}_${config.dpi}dpi.png`)

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><span>HPF</span><i /></div>
      <div className="title-group"><h1>{t(language, 'title')}</h1><p>{t(language, 'subtitle')}</p></div>
      <div className="top-actions">
        <button className="icon-button" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}><Languages size={18} /><span>{t(language, 'lang')}</span></button>
        <button className="icon-button icon-only" aria-label={t(language, 'theme')} title={t(language, 'theme')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
      </div>
    </header>

    <main>
      <aside className="controls">
        <section>
          <div className="section-title"><span>01</span><h2>{t(language, 'lens')}</h2></div>
          <label className="field lens-picker">
            <span className="field-heading"><span>{t(language, 'lens')}</span><span className="record-count">{lenses.length || '—'}</span></span>
            <span className="search-shell"><Search size={15} /><input type="search" value={lensQuery} placeholder={t(language, 'searchLens')} onChange={(event) => setLensQuery(event.target.value)} /></span>
            <select aria-label={t(language, 'chooseLens')} value={visibleLenses.some((lens) => lens.lensName === config.lensName) ? config.lensName : ''} onChange={(event) => { chooseLens(event.target.value); setLensQuery('') }}>
              <option value="" disabled>{visibleLenses.length ? t(language, 'chooseLens') : t(language, 'noLens')}</option>
              {visibleLenses.map((lens) => <option key={`${lens.lensName}-${lens.version}`} value={lens.lensName}>{lens.lensName} · {lens.vender}</option>)}
            </select>
            {selectedLens && <small>{selectedLens.vender} · {selectedLens.version}</small>}
          </label>
          <Field label={t(language, 'focal')} help={t(language, 'focalHelp')} unit="mm" value={config.focalLengthMm} min={1} step={0.1} invalid={errors.includes('focalLengthMm')} onChange={(value) => setConfig((current) => ({ ...current, focalLengthMm: value, focalSource: 'manual' }))} />
          <div className="source-pill"><Check size={13} />{config.focalSource === 'efl' ? t(language, 'sourceEfl') : config.focalSource === 'nominal' ? t(language, 'sourceNominal') : t(language, 'sourceManual')}</div>
        </section>

        <section>
          <div className="section-title"><span>02</span><h2>{t(language, 'mechanics')}</h2></div>
          <div className="field-grid">
            <Field label={t(language, 'extension')} help={t(language, 'extensionHelp')} unit="mm/°" value={config.extensionMmPerDeg} min={0.001} step={0.001} invalid={errors.includes('extensionMmPerDeg')} onChange={(value) => updateNumber('extensionMmPerDeg', value)} />
            <Field label={t(language, 'maxAngle')} help={t(language, 'maxAngleHelp')} unit="°" value={config.maxAngleDeg} min={5} max={355} step={5} invalid={errors.includes('maxAngleDeg')} onChange={(value) => updateNumber('maxAngleDeg', value)} />
            <Field label={t(language, 'diameter')} help={t(language, 'diameterHelp')} unit="mm" value={config.ringDiameterMm} min={1} step={0.1} invalid={errors.includes('ringDiameterMm')} onChange={(value) => updateNumber('ringDiameterMm', value)} />
            <Field label={t(language, 'width')} help={t(language, 'widthHelp')} unit="mm" value={config.ringWidthMm} min={2} step={0.1} invalid={errors.includes('ringWidthMm')} onChange={(value) => updateNumber('ringWidthMm', value)} />
          </div>
          <ParameterDiagram language={language} />
        </section>

        <section>
          <div className="section-title"><span>03</span><h2>{t(language, 'appearance')}</h2></div>
          <div className="field-grid">
            <Field label={t(language, 'precision')} help={t(language, 'precisionHelp')} value={config.significantDigits} min={2} max={6} step={1} onChange={(value) => updateNumber('significantDigits', value)} />
            <Field label={t(language, 'dpi')} help={t(language, 'dpiHelp')} unit="dpi" value={config.dpi} min={72} max={1200} step={1} onChange={(value) => updateNumber('dpi', value)} />
            <Field label={t(language, 'tickLength')} help={t(language, 'tickLengthHelp')} unit="mm" value={config.tickLengthMm} min={0.1} step={0.1} invalid={errors.includes('tickLengthMm')} onChange={(value) => updateNumber('tickLengthMm', value)} />
            <Field label={t(language, 'tickWidth')} help={t(language, 'tickWidthHelp')} unit="mm" value={config.tickWidthMm} min={0.05} step={0.05} invalid={errors.includes('tickWidthMm')} onChange={(value) => updateNumber('tickWidthMm', value)} />
            <Field label={t(language, 'fontSize')} help={t(language, 'fontSizeHelp')} unit="mm" value={config.fontSizeMm} min={0.5} step={0.1} invalid={errors.includes('fontSizeMm')} onChange={(value) => updateNumber('fontSizeMm', value)} />
            <Field label={t(language, 'letterSpacing')} help={t(language, 'letterSpacingHelp')} unit="mm" value={config.letterSpacingMm} min={-0.5} max={3} step={0.05} invalid={errors.includes('letterSpacingMm')} onChange={(value) => updateNumber('letterSpacingMm', value)} />
            <Field label={t(language, 'frameWidth')} help={t(language, 'frameWidthHelp')} unit="px" value={config.frameWidthPx} min={0} max={20} step={0.5} invalid={errors.includes('frameWidthPx')} onChange={(value) => updateNumber('frameWidthPx', value)} />
            <Field label={t(language, 'infinityMargin')} help={t(language, 'infinityMarginHelp')} unit="mm" value={config.infinityMarginMm} min={0} step={0.1} invalid={errors.includes('infinityMarginMm')} onChange={(value) => updateNumber('infinityMarginMm', value)} />
          </div>
          <label className="field"><span className="field-heading"><span>{t(language, 'font')}</span></span><select value={config.fontId} onChange={(event) => chooseFont(event.target.value)}>{fontChoices.map((choice) => <option value={choice.id} key={choice.id}>{choice.label}</option>)}</select><small>{t(language, 'fontHelp')}</small></label>
          <input ref={uploadRef} className="visually-hidden" type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(event) => uploadFont(event.target.files?.[0])} />
          <button className="upload-button" onClick={() => uploadRef.current?.click()}><Upload size={16} /><span>{t(language, 'uploadFont')}</span></button>
          <small className="upload-note">{fontMessage || t(language, 'uploadHelp')}</small>
          <div className="color-row">
            {([['backgroundColor', 'background'], ['tickColor', 'ticks'], ['textColor', 'text']] as const).map(([key, label]) => <label key={key}><input type="color" value={config[key]} onChange={(event) => update(key, event.target.value)} /><span>{t(language, label)}</span></label>)}
            <div className="auto-color"><i style={{ background: config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor) }} /><span>{t(language, 'frameAuto')}</span></div>
          </div>
          <Toggle checked={config.transparentBackground} label={t(language, 'transparent')} help={t(language, 'transparentHelp')} onChange={(value) => update('transparentBackground', value)} />
          <Toggle checked={config.showFocalLength} label={t(language, 'showFocal')} onChange={(value) => update('showFocalLength', value)} />
        </section>
        <button className="reset-button" onClick={() => setConfig({ ...DEFAULT_CONFIG, lensName: 'MAKRO-SYMMAR_HM_180_5.6' })}><RotateCcw size={15} />{t(language, 'reset')}</button>
      </aside>

      <section className="workspace">
        <div className="preview-heading"><div><span className="eyebrow">OUTPUT PREVIEW</span><h2>{t(language, 'preview')}</h2></div>{artwork && <div className="metrics"><span>{t(language, 'dimensions')} <strong>{artwork.widthMm.toFixed(1)} × {artwork.heightMm.toFixed(1)} mm</strong></span><span><strong>{artwork.marks.length}</strong> {t(language, 'marks')}</span></div>}</div>
        <div className={`preview-stage ${config.transparentBackground ? 'checkerboard' : ''}`}>
          {status === 'loading' && <div className="loading"><span />{t(language, 'loading')}</div>}
          {status === 'error' && <div className="loading error">{t(language, 'error')}</div>}
          {preview && <div className="scale-preview" dangerouslySetInnerHTML={{ __html: preview.svg }} />}
          <div className="dimension-line"><span>0</span><i /><span>{artwork?.heightMm.toFixed(1) ?? '—'} mm</span></div>
        </div>
        <div className="export-panel">
          <div className="export-copy"><FileCode2 size={22} /><div><strong>{t(language, 'export')}</strong><small>{t(language, 'vectorNote')}</small></div></div>
          <div className="export-buttons">
            <button disabled={!artwork} onClick={exportJson}><Download size={15} />{t(language, 'exportJson')}</button>
            <button disabled={!artwork || !font} onClick={exportDxf}><Download size={15} />{t(language, 'exportDxf')}</button>
            <button disabled={!artwork} onClick={exportSvg}><Download size={15} />{t(language, 'exportSvg')}</button>
            <button className="primary" disabled={!artwork} onClick={exportPng}><Download size={15} />{t(language, 'exportPng')}</button>
          </div>
        </div>
        <div className="formula-strip"><Wrench size={16} /><span>{t(language, 'formula')}</span><i /><span>{t(language, 'footer')}</span></div>
      </section>
    </main>
  </div>
}
