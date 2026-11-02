
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bell, Boxes, Building2,
  CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign,
  ClipboardList, Download, FileCheck2, FileSpreadsheet, Filter, LayoutDashboard,
  LogOut, Menu, PackageCheck, Search, Settings2, ShieldCheck, Truck, Wallet, X
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  onAuthStateChanged, signInWithPopup, signOut
} from 'firebase/auth'
import { auth, googleProvider } from './firebase'

const nav = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'RQ / PO Monitoring', icon: ClipboardList, count: '144' },
  { label: 'EPR Monitoring', icon: FileCheck2 },
  { label: 'SDCI Monitoring', icon: Boxes, count: '20' },
  { label: 'For Approval', icon: ShieldCheck },
  { label: 'Reference & Item Master', icon: PackageCheck },
]

const statusData = [
  { name: 'Closed', value: 88, color: '#15966b' },
  { name: 'Pending Approval', value: 14, color: '#e6a23c' },
  { name: 'Voided', value: 11, color: '#9aa8b8' },
  { name: 'Pending Order', value: 11, color: '#477fce' },
  { name: 'Fully Ordered', value: 10, color: '#35a6b4' },
  { name: 'Rejected', value: 4, color: '#d65d5d' },
  { name: 'Partially Received', value: 3, color: '#8b72c8' },
  { name: 'Unclassified', value: 2, color: '#c5cbd3' },
]

const trend = [
  { month: 'Jan', requests: 14, value: 110 },
  { month: 'Feb', requests: 18, value: 145 },
  { month: 'Mar', requests: 22, value: 180 },
  { month: 'Apr', requests: 16, value: 132 },
  { month: 'May', requests: 24, value: 210 },
  { month: 'Jun', requests: 19, value: 168 },
]

const rows = [
  { rq: 'RQ-MAB-2026-001', date: '2026-01-08', description: 'Electrical supplies and consumables', supplier: '—', po: 'For PO processing', amount: 41500, status: 'Pending Approval' },
  { rq: 'RQ-MAB-2026-014', date: '2026-02-12', description: 'General maintenance materials', supplier: 'ABC Industrial Supply', po: 'PO-2602-018', amount: 28600, status: 'Closed' },
  { rq: 'RQ-MAB-2026-021', date: '2026-03-03', description: 'Safety signage and labels', supplier: '—', po: 'For canvass', amount: 52000, status: 'Pending Order' },
  { rq: 'RQ-MAB-2026-032', date: '2026-03-21', description: 'Lighting replacement', supplier: 'EcoShift', po: 'PO-2603-027', amount: 52000, status: 'Fully Ordered' },
  { rq: 'RQ-MAB-2026-047', date: '2026-04-10', description: 'PPE replenishment', supplier: '—', po: '—', amount: 12750, status: 'Pending Approval' },
]

const money = n => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', maximumFractionDigits: 0
}).format(n)

const statusClass = s => s.toLowerCase().replaceAll(' ', '-')

const cleanCell = value => String(value ?? '').trim()
const parseAmount = value => {
  const parsed = Number(String(value ?? '').replace(/[₱,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function parseRqRows(rawRows = []) {
  if (!Array.isArray(rawRows)) return []
  const headerIndex = rawRows.findIndex(row =>
    Array.isArray(row) && row.some(cell => cleanCell(cell).toLowerCase() === 'rq no.')
  )
  if (headerIndex < 0) return []

  return rawRows.slice(headerIndex + 1)
    .filter(row => Array.isArray(row) && cleanCell(row[1]))
    .map((row, index) => {
      const status = cleanCell(row[10]) || cleanCell(row[11]) || 'Unclassified'
      return {
        id: `${cleanCell(row[1])}-${index}`,
        rq: cleanCell(row[1]),
        date: cleanCell(row[0]),
        description: cleanCell(row[4]),
        supplier: cleanCell(row[7]) || '—',
        po: cleanCell(row[6]) || '—',
        amount: parseAmount(row[8]),
        status
      }
    })
}

function summarizeStatuses(records) {
  const colors = {
    'Closed': '#15966b', 'Pending Approval': '#e6a23c', 'VOIDED': '#9aa8b8',
    'Voided': '#9aa8b8', 'Pending Order': '#477fce', 'Fully Ordered': '#35a6b4',
    'Rejected': '#d65d5d', 'Partially Received': '#8b72c8', 'Unclassified': '#c5cbd3'
  }
  const counts = new Map()
  records.forEach(record => {
    const name = record.status || 'Unclassified'
    counts.set(name, (counts.get(name) || 0) + 1)
  })
  return [...counts.entries()].map(([name, value]) => ({ name, value, color: colors[name] || '#7b8794' }))
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const [active, setActive] = useState('Overview')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('2026')
  const [mobileOpen, setMobileOpen] = useState(false)

  // Google Sheets live-data connection
  const [liveData, setLiveData] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [lastSync, setLastSync] = useState(null)

  const fetchLiveData = async (currentUser) => {
    setDataLoading(true)
    setDataError('')

    try {
      const token = await currentUser.getIdToken()
      const response = await fetch(
        'https://mabini-terminal-api.jhun-maranan.workers.dev/api/sheets',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Unable to load Google Sheets data.')
      }

      setLiveData(result.data)
      setLastSync(result.lastSync)
    } catch (error) {
      console.error('Data sync error:', error)
      setDataError(error.message || 'Data synchronization failed.')
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      if (!currentUser) {
        setUser(null)
        setAuthLoading(false)
        return
      }

      const email = currentUser.email?.toLowerCase() || ''

      if (!email.endsWith('@seaoil.com.ph')) {
        await signOut(auth)
        setUser(null)
        setAuthError('Access denied. Please use your authorized @seaoil.com.ph account.')
        setAuthLoading(false)
        return
      }

      setUser(currentUser)
      setAuthError('')
      setAuthLoading(false)
      await fetchLiveData(currentUser)
    })

    return unsubscribe
  }, [])

  const handleGoogleLogin = async () => {
    setLoginLoading(true)
    setAuthError('')

    try {
      const result = await signInWithPopup(auth, googleProvider)
      const email = result.user.email?.toLowerCase() || ''

      if (!email.endsWith('@seaoil.com.ph')) {
        await signOut(auth)
        setAuthError('Access denied. Only @seaoil.com.ph accounts are allowed.')
      }
    } catch (error) {
      setAuthError(
        error.code === 'auth/popup-closed-by-user'
          ? 'Sign-in was cancelled. Please try again.'
          : error.message || 'Unable to sign in. Please try again.'
      )
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    setActive('Overview')
  }

  const liveRqRows = useMemo(() => parseRqRows(liveData?.rq), [liveData])
  const displayedRows = liveData ? liveRqRows : rows
  const liveStatuses = useMemo(() => summarizeStatuses(liveRqRows), [liveRqRows])
  const displayedStatuses = liveData ? liveStatuses : statusData
  const totalAmount = liveRqRows.reduce((sum, record) => sum + record.amount, 0)
  const closedCount = liveRqRows.filter(record => record.status.toLowerCase() === 'closed').length
  const pendingCount = liveRqRows.filter(record => ['pending approval', 'pending order', 'rejected'].includes(record.status.toLowerCase())).length

  const filtered = useMemo(
    () => displayedRows.filter(r =>
      Object.values(r).join(' ').toLowerCase().includes(query.toLowerCase())
    ),
    [query, displayedRows]
  )

  const isOverview = active === 'Overview'

  if (authLoading) {
    return (
      <div style={loginPage}>
        <div style={loginCard}>
          <div style={loginLogo}><Activity size={28}/></div>
          <h2>SEAOIL Mabini Terminal</h2>
          <p>Checking secure access...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={loginPage}>
        <div style={loginCard}>
          <div style={loginLogo}><Activity size={30}/></div>
          <div style={{ color: '#477fce', fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>
            SEAOIL PHILIPPINES
          </div>
          <h1 style={{ fontSize: 25, color: '#172b46', margin: '12px 0 8px' }}>
            Mabini Terminal
          </h1>
          <p style={{ color: '#718096', fontSize: 14, marginBottom: 28 }}>
            Centralized Operations Monitoring System
          </p>

          <button
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            style={loginButton}
          >
            {loginLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>

          {authError && (
            <div style={{
              marginTop: 18, padding: 12, borderRadius: 8,
              background: '#fff1f0', color: '#b42318', fontSize: 13
            }}>
              {authError}
            </div>
          )}

          <p style={{ fontSize: 12, color: '#8995a5', marginTop: 25 }}>
            Authorized company accounts only
          </p>
          <p style={{ fontSize: 12, color: '#8995a5' }}>
            @seaoil.com.ph
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={21}/></div>
          <div><strong>MABINI <span>TERMINAL</span></strong><small>OPERATIONS MONITOR</small></div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18}/></button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <div className="terminal-switch">
          <div className="terminal-icon"><Building2 size={17}/></div>
          <div><b>Mabini Terminal</b><small>SEAOIL Philippines</small></div>
          <ChevronDown size={16}/>
        </div>

        <div className="nav-label">MAIN MENU</div>
        <nav>
          {nav.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                className={`nav-item ${active === item.label ? 'active' : ''}`}
                onClick={() => {setActive(item.label);setMobileOpen(false)}}
              >
                <Icon size={18}/>
                <span>{item.label}</span>
                {item.count && <em>{item.count}</em>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sync-card">
            <div className="sync-icon"><FileSpreadsheet size={17}/></div>
            <div><b>Data connection</b><small><i className={`dot ${dataError ? 'amber' : dataLoading ? 'amber' : liveData ? 'green' : 'amber'}`}/> {dataError ? 'Sync error' : dataLoading ? 'Syncing...' : liveData ? 'Google Sheets connected' : 'Awaiting data'}</small></div>
          </div>
          <button className="nav-item"><Settings2 size={18}/><span>Settings</span></button>
          <div className="user-profile">
            <div className="avatar">MT</div>
            <div><b>{user.displayName || 'SEAOIL User'}</b><small>{user.email}</small></div>
            <button onClick={handleLogout} title="Sign out" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
              <LogOut size={17}/>
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setMobileOpen(true)}><Menu/></button>
          <div className="breadcrumb">Operations <ChevronRight size={14}/> <b>{active}</b></div>
          <div className="top-actions">
            <span className="environment"><i className={`dot ${liveData && !dataError ? 'green' : 'amber'}`}/> {liveData && !dataError ? 'LIVE DATA' : 'DEMO DATA'}</span>
            <button className="icon-button" aria-label="Notifications"><Bell size={18}/><i/></button>
            <div className="top-avatar">MT</div>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">SEAOIL PHILIPPINES <span> / </span> MABINI TERMINAL</div>
              <h1>{isOverview ? 'Operations Overview' : active}</h1>
              <p>{isOverview ? 'A centralized view of terminal requests, procurement progress, and operational commitments.' : `Monitor and review ${active.toLowerCase()} records and activity.`}</p>
            </div>
            <div className="heading-actions">
              <button className="btn secondary"><CalendarDays size={16}/> Jan – Dec {period}<ChevronDown size={15}/></button>
              <button className="btn primary" onClick={() => setActive('RQ / PO Monitoring')}><ClipboardList size={16}/> View transactions</button>
            </div>
          </div>

          {!isOverview && (
            <div className="module-notice">
              <AlertCircle size={18}/>
              <div><b>{liveData ? 'Module data connected' : 'Prototype view'}</b><span>{liveData ? 'Google Sheets connection is active. This module view is being populated from the connected workbook.' : 'Live records will appear after the secure Google Sheets integration is configured.'}</span></div>
            </div>
          )}

          <section className="kpi-grid">
            <Kpi icon={ClipboardList} label="RQ line items" value={liveData ? liveRqRows.length.toLocaleString('en-PH') : '144'} note={liveData ? 'Rows read from live RQ sheet' : 'Workbook snapshot'} tone="blue" trend={liveData ? 'Live source' : 'Demo / snapshot'}/>
            <Kpi icon={CircleDollarSign} label="Recorded RQ value" value={liveData ? money(totalAmount) : '₱970.45K'} note={liveData ? 'Sum of populated live amount cells' : 'Snapshot amount total'} tone="green" trend={liveData ? 'Live source' : 'Provisional'}/>
            <Kpi icon={Wallet} label="Pending action" value={liveData ? pendingCount.toLocaleString('en-PH') : '29'} note={liveData ? 'Pending approval · order · rejected' : 'Snapshot status count'} tone="amber" trend="Needs review"/>
            <Kpi icon={CheckCircle2} label="Closed transactions" value={liveData ? closedCount.toLocaleString('en-PH') : '88'} note={liveData ? 'Based on live recorded status' : 'Snapshot status count'} tone="purple" trend={liveData ? 'Live source' : 'Workbook snapshot'}/>
          </section>

          {!liveData && <div className="alert-banner">
            <div className="alert-symbol"><AlertCircle size={19}/></div>
            <div><b>Source data validation required</b><p>RQ detail amounts total ₱970,450.86, while the workbook summary shows ₱928,950.86. A ₱41,500.00 difference needs reconciliation before financial KPIs are finalized.</p></div>
            <button onClick={() => setActive('RQ / PO Monitoring')}>Review records <ChevronRight size={16}/></button>
          </div>}

          <section className="analytics-grid">
            <div className="panel trend-panel">
              <div className="panel-head">
                <div><h3>Procurement activity</h3><p>Illustrative monthly trend · not yet connected to dated transaction aggregation</p></div>
                <button className="select-mini">2026 <ChevronDown size={14}/></button>
              </div>
              <div className="chart-legend"><span><i className="legend-dot blue"/> Requests</span><span><i className="legend-dot teal"/> Amount (₱K)</span></div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{top:8,right:10,left:-18,bottom:0}}>
                    <defs><linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3c82d6" stopOpacity={.18}/><stop offset="100%" stopColor="#3c82d6" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid stroke="#edf1f5" vertical={false}/>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:'#8a97a7',fontSize:12}}/>
                    <YAxis axisLine={false} tickLine={false} tick={{fill:'#8a97a7',fontSize:11}}/>
                    <Tooltip/>
                    <Area type="monotone" dataKey="requests" stroke="#3c82d6" strokeWidth={2.5} fill="url(#reqFill)"/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel status-panel">
              <div className="panel-head"><div><h3>RQ status distribution</h3><p>{liveData ? `${liveRqRows.length} live line items` : '142 classified · 2 unclassified'}</p></div><button className="more-button">•••</button></div>
              <div className="status-total"><strong>{liveData ? liveRqRows.length : 142}</strong><span>{liveData ? 'live line items' : 'classified line items'}</span></div>
              <div className="status-list">
                {displayedStatuses.map(s => (
                  <div className="status-row" key={s.name}>
                    <span><i style={{background:s.color}}/>{s.name}</span>
                    <b>{s.value}</b>
                    <div className="bar-track"><i style={{width:`${s.value/(liveData ? (liveRqRows.length || 1) : 142)*100}%`,background:s.color}}/></div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel transactions-panel">
            <div className="panel-head transaction-heading">
              <div><h3>Recent RQ / PO transactions</h3><p>{liveData ? 'Records loaded from the live RQ sheet' : 'Quick access to sample procurement records'}</p></div>
              <button className="btn text-btn" onClick={() => setActive('RQ / PO Monitoring')}>View all records <ChevronRight size={16}/></button>
            </div>
            <div className="table-toolbar">
              <div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search RQ, PO, description, supplier..."/></div>
              <button className="btn secondary compact"><Filter size={15}/> Filter</button>
              <button className="btn secondary compact"><Download size={15}/> Export</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>REQUEST REFERENCE</th><th>DATE</th><th>DESCRIPTION</th><th>SUPPLIER</th><th>PO REFERENCE</th><th className="right">AMOUNT</th><th>STATUS</th></tr></thead>
                <tbody>
                  {filtered.slice(0, 10).map(r => (
                    <tr key={r.id || r.rq}>
                      <td><b className="ref">{r.rq}</b></td><td>{r.date}</td><td>{r.description}</td><td>{r.supplier}</td><td>{r.po}</td><td className="right amount">{money(r.amount)}</td><td><span className={`status-pill ${statusClass(r.status)}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length===0 && <div className="empty-state">{liveData ? 'No matching live records.' : 'No matching sample records.'}</div>}
            </div>
            <div className="table-footer"><span>Showing {Math.min(filtered.length, 10)} of {filtered.length} {liveData ? 'live records' : 'sample records'}</span><button className="btn text-btn" onClick={()=>setQuery('')}>Clear search</button></div>
          </section>

          <footer className="footer">
            <span>© 2026 SEAOIL Mabini Terminal · Operations Monitoring</span>
            <span><i className={`dot ${liveData && !dataError ? 'green' : 'amber'}`}/> {dataError ? `Sync error: ${dataError}` : dataLoading ? 'Syncing Google Sheets...' : liveData ? `Live Google Sheets data · Last sync ${lastSync ? new Date(lastSync).toLocaleString() : 'just now'}` : 'Demo mode · Google Sheets sync pending'}</span>
          </footer>
        </div>
      </main>
      {mobileOpen && <button className="scrim" onClick={()=>setMobileOpen(false)} aria-label="Close menu"/>}
    </div>
  )
}

function Kpi({icon:Icon,label,value,note,tone,trend:tag}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top"><div className={`kpi-icon ${tone}`}><Icon size={19}/></div><span className="kpi-tag">{tag}</span></div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-note">{note}</div>
    </div>
  )
}

const loginPage = {
  minHeight: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: '#f3f6fa', padding: 20
}

const loginCard = {
  width: '100%', maxWidth: 430, background: '#fff', padding: '42px 35px',
  borderRadius: 16, boxShadow: '0 12px 40px rgba(20,40,70,.10)',
  textAlign: 'center', fontFamily: 'Nunito, sans-serif'
}

const loginLogo = {
  width: 58, height: 58, borderRadius: 16, background: '#eaf2ff',
  color: '#2869b2', display: 'flex', alignItems: 'center',
  justifyContent: 'center', margin: '0 auto 22px'
}

const loginButton = {
  width: '100%', padding: '14px 18px', border: 0, borderRadius: 9,
  background: '#2869b2', color: '#fff', fontSize: 15,
  fontWeight: 700, cursor: 'pointer'
}

export default App
