import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, getMeta, recommend, searchSpaces } from './api'
import type { AgentReply, Filters, Meta, Space } from './api'

const AMENITY_LABEL: Record<string, string> = {
  whiteboard: 'Whiteboard', chalkboard: 'Chalkboard', tv_display: 'Display', projector: 'Projector', computers: 'Computers',
  video_conferencing: 'Video calls', document_camera: 'Document camera', speakers: 'Speakers', power_outlets: 'Powered seats',
  accessible: 'Accessible', movable_furniture: 'Movable furniture', flip_chart: 'Flip chart', mirrored_wall: 'Mirrors',
}
const EXAMPLES = ['A quiet room for 4 this afternoon', 'Computer lab free around 2pm', 'Room for 30 with a projector tomorrow morning', 'Gym space tonight']
const DAY_START = 420, DAY_SPAN = 960 // timeline covers 7:00 to 23:00

const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3)
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clock = (t: string) => { const m = toMin(t), h = Math.floor(m / 60); return `${h % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${h < 12 || h === 24 ? 'AM' : 'PM'}` }
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

function freeLabel(s: Space): { text: string; free: boolean } {
  const w = s.availability.free_windows
  if (!s.availability.known || !w) return { text: 'Availability unknown', free: false }
  const n = nowMin(), cur = w.map((x) => x.split('-')).find(([a, b]) => toMin(a) <= n && n < toMin(b))
  if (cur) return { text: `Free until ${clock(cur[1])}`, free: true }
  const next = w.map((x) => x.split('-')).find(([a]) => toMin(a) > n)
  return next ? { text: `Free from ${clock(next[0])}`, free: false } : { text: 'Booked for the rest of today', free: false }
}

function Timeline({ windows }: { windows: string[] | null }) {
  if (!windows) return null
  const pos = Math.min(100, Math.max(0, ((nowMin() - DAY_START) / DAY_SPAN) * 100))
  return (
    <div className="timeline" role="img" aria-label={windows.length ? `Free today: ${windows.map((w) => w.split('-').map(clock).join(' to ')).join(', ')}` : 'No free time today'}>
      {windows.map((w) => { const [a, b] = w.split('-').map(toMin); return <i key={w} style={{ left: `${((a - DAY_START) / DAY_SPAN) * 100}%`, width: `${((b - a) / DAY_SPAN) * 100}%` }} /> })}
      <b style={{ left: `${pos}%` }} />
    </div>
  )
}

function SpaceCard({ s, reason }: { s: Space; reason?: string }) {
  const f = freeLabel(s)
  return (
    <article className="space-card">
      {reason && <p className="reason">{reason}</p>}
      <div className="space-top">
        <div><h3>{s.name}</h3><p className="where">{s.building}</p></div>
        <span className={`avail ${f.free ? 'free' : ''}`}>{f.text}</span>
      </div>
      <Timeline windows={s.availability.free_windows} />
      <div className="axis"><span>7 AM</span><span>3 PM</span><span>11 PM</span></div>
      <div className="facts"><span>{s.space_type}</span><span>Seats up to {s.max_capacity}</span>
        {s.table_type.value && <span title={s.table_type.source ? 'Inferred from 25Live room layouts' : undefined}>{s.table_type.value} tables{s.table_type.source ? ' (est.)' : ''}</span>}
      </div>
      <div className="amenities">{s.amenities.filter((a) => AMENITY_LABEL[a]).map((a) => <span key={a}>{AMENITY_LABEL[a]}</span>)}</div>
      <a className="btn" href={s.url} target="_blank" rel="noopener noreferrer">Reserve in 25Live</a>
    </article>
  )
}

type View = 'home' | 'ask' | 'choose'
const viewFromHash = (): View => (location.hash === '#ask' ? 'ask' : location.hash === '#choose' ? 'choose' : 'home')

export default function App() {
  const [view, setView] = useState<View>(viewFromHash)
  useEffect(() => { const on = () => setView(viewFromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])
  useEffect(() => { window.scrollTo(0, 0); if (view === 'ask') document.getElementById('q')?.focus() }, [view])
  const [meta, setMeta] = useState<Meta | null>(null)
  const affiliation = ''
  const [f, setF] = useState<Omit<Filters, 'start_time' | 'end_time' | 'affiliation'>>({ limit: 24 })
  const [when, setWhen] = useState(''); const [dur, setDur] = useState(60)
  const [spaces, setSpaces] = useState<Space[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState('')
  const [q, setQ] = useState(''); const [ai, setAi] = useState<AgentReply | null>(null); const [aiBusy, setAiBusy] = useState(false); const [aiErr, setAiErr] = useState('')

  useEffect(() => { getMeta().then(setMeta).catch(() => setErr('Can’t reach the ReserveCMU server. Is the backend running?')) }, [])

  const window_ = useMemo(() => {
    if (!when) return {}
    const start = when === 'now' ? nowMin() : toMin(when)
    return { start_time: hhmm(Math.min(start, 1439)), end_time: hhmm(Math.min(start + dur, 1439)) }
  }, [when, dur])

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => searchSpaces({ ...f, ...window_, affiliation: affiliation || undefined }).then((r) => { setSpaces(r); setErr('') }).catch((e) => setErr(e.message)).finally(() => setLoading(false)), 200)
    return () => clearTimeout(t)
  }, [f, window_, affiliation])

  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, limit: 24 }))
  const num = (v: string) => (v ? +v : undefined)

  async function ask(e?: FormEvent, text = q) {
    e?.preventDefault(); if (text.trim().length < 3) return
    setQ(text); setAiBusy(true); setAiErr(''); setAi(null)
    try { setAi(await recommend(text, affiliation)) }
    catch (x) { setAiErr(x instanceof ApiError && x.status === 503 ? 'The assistant isn’t switched on yet (no API key on the server). You can still pick a space yourself under Choose.' : `The assistant couldn’t answer just now (${x instanceof Error ? x.message : 'unknown error'}). You can still pick a space yourself under Choose.`) }
    finally { setAiBusy(false) }
  }

  const asOf = meta && Object.values(meta.availability_as_of).find((v) => /Z$|\+00:00$/.test(v))
  const mins = asOf ? Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 60000)) : null

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="ReserveCMU home"><span>Reserve<span>CMU</span></span></a>
        {view !== 'home' && (
          <nav className="modes" aria-label="How to find a space">
            <a href="#ask" aria-current={view === 'ask' ? 'page' : undefined}>Ask</a>
            <a href="#choose" aria-current={view === 'choose' ? 'page' : undefined}>Choose</a>
          </nav>
        )}
      </header>

      {view === 'home' && (
        <main className="landing">
          <h1 className="sr-only">How do you want to find a space?</h1>
          <a className="door door-ask" href="#ask"><span className="door-word">Ask</span><span className="door-sub">Type your room preference</span></a>
          <a className="door door-choose" href="#choose"><span className="door-word">Choose</span><span className="door-sub">Browse and filter every space yourself</span></a>
        </main>
      )}

      {view !== 'home' && <main id="top">
        {view === 'ask' && <>
        <section className="hero">
          <div className="hero-inner">
            <h1>Tell us what you need.<br />We’ll find the space.</h1>
            <p className="hero-sub">Describe your group, your time and the kind of room.</p>
            <form className="ask" onSubmit={ask}>
              <label htmlFor="q" className="sr-only">What space do you need?</label>
              <input id="q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="e.g. quiet room for 4 with a whiteboard this afternoon" />
              <button className="btn" disabled={aiBusy}>{aiBusy ? 'Looking…' : 'Find a space'}</button>
            </form>
            <div className="chips">{EXAMPLES.map((x) => <button key={x} type="button" onClick={() => ask(undefined, x)}>{x}</button>)}</div>
          </div>
        </section>

        {(ai || aiErr || aiBusy) && (
          <section className="content answer" aria-live="polite">
            {aiBusy && <p className="muted">Checking availability…</p>}
            {aiErr && <p className="notice">{aiErr}</p>}
            {ai && <>
              <p className="summary">{ai.summary}</p>
              <div className="grid">{ai.recommendations.map((r) => <SpaceCard key={r.space.id} s={r.space} reason={r.reason} />)}</div>
              {!ai.recommendations.length && <p className="muted">Nothing matched. Try a different time or a smaller group, or pick a space yourself under Choose.</p>}
            </>}
          </section>
        )}
        </>}

        {view === 'choose' && <section className="content">
          <div className="section-head"><h2>Browse every space</h2>
            <p className="muted">{meta ? `${meta.counts.spaces} spaces` : ''}{mins !== null ? `, availability updated ${mins} min ago` : ''}.</p></div>
          <div className="filters">
            <label>Type<select onChange={(e) => set({ space_types: e.target.value ? [e.target.value] : undefined })}><option value="">Any</option>{meta?.space_types.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Building<select onChange={(e) => set({ building: e.target.value || undefined })}><option value="">Any</option>{meta?.buildings.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>People<input type="number" min={1} placeholder="Any" onChange={(e) => set({ min_capacity: num(e.target.value) })} /></label>
            <label>When<select value={when.match(/^\d/) ? 'custom' : when} onChange={(e) => setWhen(e.target.value === 'custom' ? '12:00' : e.target.value)}><option value="">Any time</option><option value="now">Right now</option><option value="custom">Pick a time</option></select></label>
            {when.match(/^\d/) && <label>Start<input type="time" value={when} onChange={(e) => setWhen(e.target.value || '12:00')} /></label>}
            {when && <label>For<select value={dur} onChange={(e) => setDur(+e.target.value)}>{[30, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d >= 60 ? `${d / 60} hr` : `${d} min`}</option>)}</select></label>}
            <label>Tables<select onChange={(e) => set({ table_type: e.target.value || undefined })}><option value="">Any</option><option value="collaborative">Collaborative</option><option value="individual">Individual</option></select></label>
          </div>
          <div className="amen-pick" role="group" aria-label="Amenities">
            {meta?.amenities.map((a) => { const on = f.amenities?.includes(a); return <button key={a} type="button" className={on ? 'on' : ''} aria-pressed={!!on}
              onClick={() => set({ amenities: on ? f.amenities!.filter((x) => x !== a) : [...(f.amenities ?? []), a] })}>{AMENITY_LABEL[a] ?? a}</button> })}
          </div>
          {err && <p className="notice">{err}</p>}
          <p className="muted count">{loading ? 'Searching…' : `Showing ${spaces.length} spaces free today that match`}</p>
          <div className="grid">{spaces.map((s) => <SpaceCard key={s.id} s={s} />)}</div>
          {!loading && !err && spaces.length === 0 && <p className="empty">No spaces match all of that. Loosen a filter, or try Ask.</p>}
          {spaces.length >= f.limit && <button className="btn ghost more" onClick={() => setF((x) => ({ ...x, limit: x.limit + 24 }))}>Show more</button>}
        </section>}
      </main>}

    </div>
  )
}
