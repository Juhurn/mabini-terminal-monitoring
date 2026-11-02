
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bell, Boxes, Building2,
  CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign,
  ClipboardList, Download, FileCheck2, FileSpreadsheet, Filter, LayoutDashboard,
  LogOut, Menu, PackageCheck, Search, Settings2, ShieldCheck, Truck, Wallet, X, Warehouse, Wrench, Plus, ArrowDownToLine, ArrowUpFromLine
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  onAuthStateChanged, signInWithPopup, signOut
} from 'firebase/auth'
import { auth, googleProvider, db } from './firebase'
import { addDoc, collection, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'

const nav = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'RQ / PO Monitoring', icon: ClipboardList, count: '144' },
  { label: 'EPR Monitoring', icon: FileCheck2 },
  { label: 'SDCI Monitoring', icon: Boxes, count: '20' },
  { label: 'For Approval', icon: ShieldCheck },
  { label: 'Reference & Item Master', icon: PackageCheck },
  { label: 'Warehouse Management', icon: Warehouse },
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

  if (active === 'Warehouse Management') return <WarehouseWorkspace user={user} onBack={() => setActive('Overview')} />

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


function WarehouseWorkspace({ user, onBack }) {
  const [section, setSection] = useState('Dashboard')
  const [items, setItems] = useState([])
  const [transactions, setTransactions] = useState([])
  const [equipment, setEquipment] = useState([])
  const [gatepasses, setGatepasses] = useState([])
  const [requests, setRequests] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [itemForm, setItemForm] = useState({ code:'', name:'', category:'Consumables', uom:'pcs', location:'Warehouse', openingStock:'0', reorderLevel:'0' })
  const [editingItem, setEditingItem] = useState(null)
  const [movement, setMovement] = useState({ itemId:'', quantity:'', reference:'', remarks:'' })
  const [requestForm, setRequestForm] = useState({ itemId:'', quantity:'', purpose:'', neededBy:'', remarks:'' })
  const [equipmentForm, setEquipmentForm] = useState({ name:'', brand:'', model:'', serialNumber:'', quantity:'1', condition:'Good', assignedTo:'', location:'Warehouse' })
  const [maintenanceForm, setMaintenanceForm] = useState({ equipmentId:'', activity:'', remarks:'', nextDue:'' })
  const [gateForm, setGateForm] = useState({ itemId:'', quantity:'', recipient:'', purpose:'', reference:'' })
  const [adjustForm, setAdjustForm] = useState({ itemId:'', newBalance:'', reason:'' })

  useEffect(() => {
    const watch = (name, setter, sort=false) => onSnapshot(collection(db, name), snap => {
      const data = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      setter(sort ? data.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)) : data)
      setLoading(false)
    }, err => { setError(err.message); setLoading(false) })
    const unsub = [
      watch('warehouse_items', setItems),
      watch('warehouse_transactions', setTransactions, true),
      watch('warehouse_equipment', setEquipment),
      watch('warehouse_gatepasses', setGatepasses, true),
      watch('warehouse_requests', setRequests, true),
      watch('warehouse_maintenance', setMaintenance, true)
    ]
    return () => unsub.forEach(fn => fn())
  }, [])

  const fmt = n => Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })
  const dateText = ts => ts?.toDate ? ts.toDate().toLocaleString() : (ts || '—')
  const updateField = (setter, key, value) => setter(prev => ({ ...prev, [key]:value }))
  const itemById = id => items.find(x => x.id === id)
  const available = id => Number(itemById(id)?.stockOnHand || 0)
  const lowStock = items.filter(i => !i.archived && Number(i.stockOnHand||0) <= Number(i.reorderLevel||0))
  const pendingRequests = requests.filter(r => r.status === 'Pending')
  const pendingGates = gatepasses.filter(g => g.status === 'Pending approval')
  const inputStyle = { width:'100%', padding:'10px 12px', border:'1px solid #d8e0ea', borderRadius:8, font:'inherit', boxSizing:'border-box', background:'#fff' }
  const cardStyle = { background:'#fff', border:'1px solid #e5eaf0', borderRadius:14, padding:18, boxShadow:'0 3px 12px rgba(20,40,70,.04)' }
  const buttonStyle = { border:0, borderRadius:8, background:'#2869b2', color:'#fff', padding:'9px 13px', fontWeight:700, cursor:'pointer' }
  const secondaryStyle = { ...buttonStyle, background:'#eef4fb', color:'#285987', border:'1px solid #dbe6f2' }
  const field = (label,key,value,setter,type='text',placeholder='') => <label style={{display:'grid',gap:6,color:'#526174',fontSize:13}}>{label}<input required={label.includes('*')} style={inputStyle} type={type} min={type==='number'?'0':undefined} step={type==='number'?'any':undefined} value={value} placeholder={placeholder} onChange={e=>updateField(setter,key,e.target.value)}/></label>
  const selectField = (label,key,value,setter,options) => <label style={{display:'grid',gap:6,color:'#526174',fontSize:13}}>{label}<select style={inputStyle} value={value} onChange={e=>updateField(setter,key,e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
  const th = { textAlign:'left', padding:'10px', color:'#718096', fontSize:11, letterSpacing:'.04em', borderBottom:'1px solid #e8edf3', whiteSpace:'nowrap' }
  const td = { padding:'11px 10px', borderBottom:'1px solid #eef1f5', fontSize:13, color:'#26384d', verticalAlign:'top' }
  const run = async fn => { setBusy(true); setError(''); setNotice(''); try { await fn() } catch(e) { setError(e.message || 'Action failed.') } finally { setBusy(false) } }

  const saveItem = e => { e.preventDefault(); run(async()=>{
    const opening=Number(itemForm.openingStock), reorder=Number(itemForm.reorderLevel)
    if(!itemForm.name.trim() || !Number.isFinite(opening)||opening<0||!Number.isFinite(reorder)||reorder<0) throw Error('Check item name, opening stock, and reorder level.')
    const payload={code:itemForm.code.trim(),name:itemForm.name.trim(),category:itemForm.category,uom:itemForm.uom.trim()||'pcs',location:itemForm.location.trim(),reorderLevel:reorder,updatedAt:serverTimestamp(),updatedBy:user.email}
    if(editingItem) await updateDoc(doc(db,'warehouse_items',editingItem),payload)
    else {
      const ref=doc(collection(db,'warehouse_items'))
      await runTransaction(db,async tx=>{tx.set(ref,{...payload,stockOnHand:opening,openingStock:opening,archived:false,createdAt:serverTimestamp(),createdBy:user.email}); if(opening>0){const tr=doc(collection(db,'warehouse_transactions'));tx.set(tr,{type:'OPENING BALANCE',itemId:ref.id,itemName:payload.name,itemCode:payload.code,quantity:opening,uom:payload.uom,balanceAfter:opening,reference:'Initial inventory',remarks:'Opening balance on item creation',createdAt:serverTimestamp(),createdBy:user.email})}})
    }
    setItemForm({code:'',name:'',category:'Consumables',uom:'pcs',location:'Warehouse',openingStock:'0',reorderLevel:'0'});setEditingItem(null);setNotice(editingItem?'Item details updated.':'Inventory item created.')
  }) }
  const saveMovement = (type,e) => { e.preventDefault(); run(async()=>{
    const qty=Number(movement.quantity); if(!movement.itemId||!Number.isFinite(qty)||qty<=0) throw Error('Select an item and enter a quantity greater than zero.')
    const ref=doc(db,'warehouse_items',movement.itemId)
    await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists()||snap.data().archived)throw Error('Item unavailable.');const current=Number(snap.data().stockOnHand||0);if(type==='ISSUANCE'&&qty>current)throw Error(`Insufficient stock. Available: ${current}`);const next=type==='RECEIVING'?current+qty:current-qty;tx.update(ref,{stockOnHand:next,updatedAt:serverTimestamp(),updatedBy:user.email});const tr=doc(collection(db,'warehouse_transactions'));tx.set(tr,{type,itemId:ref.id,itemName:snap.data().name,itemCode:snap.data().code||'',quantity:qty,uom:snap.data().uom||'pcs',balanceBefore:current,balanceAfter:next,reference:movement.reference.trim(),remarks:movement.remarks.trim(),createdAt:serverTimestamp(),createdBy:user.email})})
    setMovement({itemId:'',quantity:'',reference:'',remarks:''});setNotice(type==='RECEIVING'?'Receiving posted; stock increased.':'Issuance posted; stock decreased.')
  }) }
  const saveRequest = e => {e.preventDefault();run(async()=>{const qty=Number(requestForm.quantity),item=itemById(requestForm.itemId);if(!item||!Number.isFinite(qty)||qty<=0||!requestForm.purpose.trim())throw Error('Complete item, quantity, and purpose.');if(qty>available(item.id))throw Error('Requested quantity exceeds current available stock.');await addDoc(collection(db,'warehouse_requests'),{itemId:item.id,itemName:item.name,itemCode:item.code||'',quantity:qty,uom:item.uom,purpose:requestForm.purpose.trim(),neededBy:requestForm.neededBy,remarks:requestForm.remarks.trim(),status:'Pending',requestedAt:serverTimestamp(),requestedBy:user.email});setRequestForm({itemId:'',quantity:'',purpose:'',neededBy:'',remarks:''});setNotice('Request submitted for approval. Stock has not been deducted.')})}
  const decideRequest = (r,approved) => run(async()=>{const reqRef=doc(db,'warehouse_requests',r.id);await updateDoc(reqRef,{status:approved?'Approved':'Rejected',reviewedAt:serverTimestamp(),reviewedBy:user.email});setNotice(`Request ${approved?'approved':'rejected'}. Approval alone does not deduct stock; record issuance when released.`)})
  const releaseRequest = r => run(async()=>{const itemRef=doc(db,'warehouse_items',r.itemId);await runTransaction(db,async tx=>{const [is,rs]=await Promise.all([tx.get(itemRef),tx.get(doc(db,'warehouse_requests',r.id))]);if(!is.exists()||rs.data()?.status!=='Approved')throw Error('Request must be approved and item must exist.');const current=Number(is.data().stockOnHand||0);if(Number(r.quantity)>current)throw Error(`Insufficient stock. Available: ${current}`);const next=current-Number(r.quantity);tx.update(itemRef,{stockOnHand:next,updatedAt:serverTimestamp(),updatedBy:user.email});tx.update(doc(db,'warehouse_requests',r.id),{status:'Released',releasedAt:serverTimestamp(),releasedBy:user.email});const tr=doc(collection(db,'warehouse_transactions'));tx.set(tr,{type:'ISSUANCE',itemId:r.itemId,itemName:r.itemName,itemCode:r.itemCode||'',quantity:Number(r.quantity),uom:r.uom,balanceBefore:current,balanceAfter:next,reference:`Request ${r.id}`,remarks:r.purpose,createdAt:serverTimestamp(),createdBy:user.email})});setNotice('Approved request released and stock deducted.')})
  const saveGate = e => {e.preventDefault();run(async()=>{const item=itemById(gateForm.itemId),qty=Number(gateForm.quantity);if(!item||!Number.isFinite(qty)||qty<=0||!gateForm.recipient.trim()||!gateForm.purpose.trim())throw Error('Complete item, quantity, recipient, and purpose.');if(qty>available(item.id))throw Error('Gate pass quantity exceeds available stock.');await addDoc(collection(db,'warehouse_gatepasses'),{itemId:item.id,itemName:item.name,quantity:qty,uom:item.uom,recipient:gateForm.recipient.trim(),purpose:gateForm.purpose.trim(),reference:gateForm.reference.trim(),status:'Pending approval',createdAt:serverTimestamp(),createdBy:user.email});setGateForm({itemId:'',quantity:'',recipient:'',purpose:'',reference:''});setNotice('Gate pass submitted. No stock deducted yet.')})}
  const decideGate = (g,approved) => run(async()=>{await updateDoc(doc(db,'warehouse_gatepasses',g.id),{status:approved?'Approved':'Rejected',reviewedAt:serverTimestamp(),reviewedBy:user.email});setNotice(`Gate pass ${approved?'approved':'rejected'}.`)})
  const releaseGate = g => run(async()=>{const itemRef=doc(db,'warehouse_items',g.itemId);await runTransaction(db,async tx=>{const [is,gs]=await Promise.all([tx.get(itemRef),tx.get(doc(db,'warehouse_gatepasses',g.id))]);if(!is.exists()||gs.data()?.status!=='Approved')throw Error('Gate pass must be approved first.');const current=Number(is.data().stockOnHand||0);if(Number(g.quantity)>current)throw Error(`Insufficient stock. Available: ${current}`);const next=current-Number(g.quantity);tx.update(itemRef,{stockOnHand:next,updatedAt:serverTimestamp(),updatedBy:user.email});tx.update(doc(db,'warehouse_gatepasses',g.id),{status:'Released',releasedAt:serverTimestamp(),releasedBy:user.email});const tr=doc(collection(db,'warehouse_transactions'));tr.id;tx.set(tr,{type:'ISSUANCE',itemId:g.itemId,itemName:g.itemName,quantity:Number(g.quantity),uom:g.uom,balanceBefore:current,balanceAfter:next,reference:`Gate pass ${g.id}`,remarks:`Released to ${g.recipient}: ${g.purpose}`,createdAt:serverTimestamp(),createdBy:user.email})});setNotice('Gate pass released and stock deducted.')})
  const adjustStock = e => {e.preventDefault();run(async()=>{const item=itemById(adjustForm.itemId),target=Number(adjustForm.newBalance);if(!item||!Number.isFinite(target)||target<0||!adjustForm.reason.trim())throw Error('Select item, valid new balance, and reason.');const ref=doc(db,'warehouse_items',item.id);await runTransaction(db,async tx=>{const snap=await tx.get(ref);const before=Number(snap.data().stockOnHand||0),delta=target-before;tx.update(ref,{stockOnHand:target,updatedAt:serverTimestamp(),updatedBy:user.email});const tr=doc(collection(db,'warehouse_transactions'));tx.set(tr,{type:'ADJUSTMENT',itemId:item.id,itemName:item.name,quantity:Math.abs(delta),balanceBefore:before,balanceAfter:target,uom:item.uom,reference:'Stock adjustment',remarks:adjustForm.reason.trim(),createdAt:serverTimestamp(),createdBy:user.email})});setAdjustForm({itemId:'',newBalance:'',reason:''});setNotice('Stock balance adjusted with audit entry.')})}
  const saveEquipment = e => {e.preventDefault();run(async()=>{if(!equipmentForm.name.trim())throw Error('Equipment name is required.');await addDoc(collection(db,'warehouse_equipment'),{...equipmentForm,quantity:Math.max(1,Number(equipmentForm.quantity)||1),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:user.email});setEquipmentForm({name:'',brand:'',model:'',serialNumber:'',quantity:'1',condition:'Good',assignedTo:'',location:'Warehouse'});setNotice('Equipment record saved.')})}
  const saveMaintenance = e => {e.preventDefault();run(async()=>{const eq=equipment.find(x=>x.id===maintenanceForm.equipmentId);if(!eq||!maintenanceForm.activity.trim())throw Error('Select equipment and enter maintenance activity.');await addDoc(collection(db,'warehouse_maintenance'),{equipmentId:eq.id,equipmentName:eq.name,activity:maintenanceForm.activity.trim(),remarks:maintenanceForm.remarks.trim(),nextDue:maintenanceForm.nextDue,createdAt:serverTimestamp(),createdBy:user.email});setMaintenanceForm({equipmentId:'',activity:'',remarks:'',nextDue:''});setNotice('Maintenance record saved.')})}
  const archiveItem = item => run(async()=>{if(Number(item.stockOnHand||0)!==0)throw Error('Only zero-balance items can be archived.');await updateDoc(doc(db,'warehouse_items',item.id),{archived:true,archivedAt:serverTimestamp(),archivedBy:user.email,updatedAt:serverTimestamp()});setNotice('Item archived; historical transactions retained.')})
  const exportCsv = (filename,rows) => {const csv=rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const blob=new Blob([`\uFEFF${csv}`],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
  const table = (headers,rows) => <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{headers.map(h=><th style={th} key={h}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
  const activeItems=items.filter(i=>!i.archived).filter(i=>`${i.code} ${i.name} ${i.category} ${i.location}`.toLowerCase().includes(search.toLowerCase()))

  const tabs=['Dashboard','Inventory','Receiving','Requests & Approval','Issuance','Stock Adjustment','Tools & Equipment','Gate Pass','Reports']
  return <div style={{minHeight:'100vh',background:'#f3f6fa',padding:24,fontFamily:'Nunito, sans-serif',color:'#172b46'}}>
    <div style={{maxWidth:1450,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap',marginBottom:20}}>
        <div><div style={{fontSize:11,letterSpacing:2,color:'#477fce',fontWeight:800}}>SEAOIL PHILIPPINES / MABINI TERMINAL</div><h1 style={{margin:'7px 0',fontSize:28}}>Warehouse Management</h1><div style={{color:'#718096',fontSize:13}}>Inventory control · Receiving · Approvals · Issuance · Equipment · Gate pass</div></div>
        <button onClick={onBack} style={secondaryStyle}>← Back to Operations</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:12,marginBottom:16}}>
        {[['Active Items',items.filter(i=>!i.archived).length],['Total Units',fmt(items.filter(i=>!i.archived).reduce((s,i)=>s+Number(i.stockOnHand||0),0))],['Low Stock',lowStock.length],['Pending Requests',pendingRequests.length],['Pending Gate Pass',pendingGates.length],['Movements',transactions.length]].map(([label,value])=><div key={label} style={cardStyle}><div style={{fontSize:12,color:'#718096'}}>{label}</div><div style={{fontSize:26,fontWeight:800,marginTop:7}}>{value}</div></div>)}
      </div>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:16}}>{tabs.map(t=><button key={t} onClick={()=>setSection(t)} style={{...buttonStyle,background:section===t?'#2869b2':'#fff',color:section===t?'#fff':'#526174',border:'1px solid #dbe3ed'}}>{t}</button>)}</div>
      {error&&<div style={{...cardStyle,background:'#fff1f0',color:'#b42318',marginBottom:12}}>{error}</div>}
      {notice&&<div style={{...cardStyle,background:'#ecfdf3',color:'#067647',marginBottom:12}}>{notice}</div>}
      {loading?<div style={cardStyle}>Loading warehouse records…</div>:<>
        {section==='Dashboard'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:14}}>
          <div style={cardStyle}><h3>Low-stock watchlist</h3>{lowStock.length?lowStock.map(i=><p key={i.id}>{i.name}: <b>{fmt(i.stockOnHand)} {i.uom}</b> (reorder at {fmt(i.reorderLevel)})</p>):<p>Walang item below reorder level.</p>}</div>
          <div style={cardStyle}><h3>Pending actions</h3><p>Requests for approval: <b>{pendingRequests.length}</b></p><p>Gate passes for approval: <b>{pendingGates.length}</b></p><p>Equipment maintenance logs: <b>{maintenance.length}</b></p></div>
          <div style={cardStyle}><h3>Recent movements</h3>{transactions.slice(0,8).map(t=><p key={t.id} style={{borderBottom:'1px solid #eef1f5',paddingBottom:7}}>{t.type} · {t.itemName} · {fmt(t.quantity)} {t.uom||''}</p>)}{!transactions.length&&<p>No stock movements yet.</p>}</div>
        </div>}
        {section==='Inventory'&&<div style={{display:'grid',gridTemplateColumns:'minmax(280px,.75fr) minmax(400px,1.5fr)',gap:14,alignItems:'start'}}>
          <form onSubmit={saveItem} style={cardStyle}><h3>{editingItem?'Edit inventory item':'Add inventory item'}</h3><div style={{display:'grid',gap:10}}>{field('Item code','code',itemForm.code,setItemForm)}{field('Item name *','name',itemForm.name,setItemForm)}{selectField('Category','category',itemForm.category,setItemForm,['Consumables','Office Supplies','Maintenance','Safety / PPE','Electrical','Tools','Other'])}{field('Unit of measure','uom',itemForm.uom,setItemForm)}{field('Opening stock (new item only)','openingStock',itemForm.openingStock,setItemForm,'number')}{field('Reorder level','reorderLevel',itemForm.reorderLevel,setItemForm,'number')}{field('Storage location','location',itemForm.location,setItemForm)}<div style={{display:'flex',gap:8}}><button disabled={busy} style={buttonStyle}>{busy?'Saving…':editingItem?'Update item':'Save item'}</button>{editingItem&&<button type="button" style={secondaryStyle} onClick={()=>{setEditingItem(null);setItemForm({code:'',name:'',category:'Consumables',uom:'pcs',location:'Warehouse',openingStock:'0',reorderLevel:'0'})}}>Cancel edit</button>}</div></div></form>
          <div style={cardStyle}><div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><h3>Inventory masterlist</h3><input style={{...inputStyle,maxWidth:260}} placeholder="Search item…" value={search} onChange={e=>setSearch(e.target.value)}/></div>{table(['Code','Item','Category','UOM','On hand','Reorder','Location','Actions'],activeItems.map(i=><tr key={i.id}><td style={td}>{i.code||'—'}</td><td style={td}><b>{i.name}</b></td><td style={td}>{i.category}</td><td style={td}>{i.uom}</td><td style={{...td,fontWeight:800,color:Number(i.stockOnHand||0)<=Number(i.reorderLevel||0)?'#b54708':'#067647'}}>{fmt(i.stockOnHand)}</td><td style={td}>{fmt(i.reorderLevel)}</td><td style={td}>{i.location||'—'}</td><td style={td}><button style={secondaryStyle} onClick={()=>{setEditingItem(i.id);setItemForm({code:i.code||'',name:i.name||'',category:i.category||'Consumables',uom:i.uom||'pcs',location:i.location||'',openingStock:'0',reorderLevel:String(i.reorderLevel||0)})}}>Edit</button>{' '}<button style={secondaryStyle} onClick={()=>archiveItem(i)}>Archive</button></td></tr>))}{!activeItems.length&&<p>No active inventory items yet.</p>}</div>
        </div>}
        {section==='Receiving'&&<div style={{...cardStyle,maxWidth:650}}><h3>Record stock receiving</h3><form onSubmit={e=>saveMovement('RECEIVING',e)} style={{display:'grid',gap:11}}><label>Inventory item<select style={inputStyle} required value={movement.itemId} onChange={e=>updateField(setMovement,'itemId',e.target.value)}><option value="">Select item</option>{activeItems.map(i=><option key={i.id} value={i.id}>{i.name} · On hand {fmt(i.stockOnHand)} {i.uom}</option>)}</select></label>{field('Quantity *','quantity',movement.quantity,setMovement,'number')}{field('Delivery receipt / reference','reference',movement.reference,setMovement)}{field('Remarks','remarks',movement.remarks,setMovement)}<button disabled={busy} style={buttonStyle}>Post receiving</button></form></div>}
        {section==='Requests & Approval'&&<div style={{display:'grid',gridTemplateColumns:'minmax(270px,.7fr) minmax(420px,1.5fr)',gap:14,alignItems:'start'}}>
          <form onSubmit={saveRequest} style={cardStyle}><h3>Submit stock request</h3><div style={{display:'grid',gap:10}}><label>Item<select required style={inputStyle} value={requestForm.itemId} onChange={e=>updateField(setRequestForm,'itemId',e.target.value)}><option value="">Select item</option>{activeItems.map(i=><option key={i.id} value={i.id}>{i.name} · {fmt(i.stockOnHand)} {i.uom}</option>)}</select></label>{field('Quantity *','quantity',requestForm.quantity,setRequestForm,'number')}{field('Purpose *','purpose',requestForm.purpose,setRequestForm)}{field('Needed by','neededBy',requestForm.neededBy,setRequestForm,'date')}{field('Remarks','remarks',requestForm.remarks,setRequestForm)}<button disabled={busy} style={buttonStyle}>Submit for approval</button></div></form>
          <div style={cardStyle}><h3>Request register & approval</h3>{table(['Date','Item','Qty','Requested by','Purpose','Status','Action'],requests.map(r=><tr key={r.id}><td style={td}>{dateText(r.requestedAt)}</td><td style={td}>{r.itemName}</td><td style={td}>{fmt(r.quantity)} {r.uom}</td><td style={td}>{r.requestedBy}</td><td style={td}>{r.purpose}</td><td style={td}>{r.status}</td><td style={td}>{r.status==='Pending'&&<><button disabled={busy} style={buttonStyle} onClick={()=>decideRequest(r,true)}>Approve</button>{' '}<button disabled={busy} style={secondaryStyle} onClick={()=>decideRequest(r,false)}>Reject</button></>}{r.status==='Approved'&&<button disabled={busy} style={buttonStyle} onClick={()=>releaseRequest(r)}>Release stock</button>}</td></tr>))}{!requests.length&&<p>No requests yet.</p>}</div>
        </div>}
        {section==='Issuance'&&<div style={cardStyle}><h3>Direct stock issuance</h3><p style={{color:'#718096'}}>Use for authorized walk-in releases. For requests, approve them under Requests & Approval first.</p><form onSubmit={e=>saveMovement('ISSUANCE',e)} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><label>Item<select required style={inputStyle} value={movement.itemId} onChange={e=>updateField(setMovement,'itemId',e.target.value)}><option value="">Select item</option>{activeItems.map(i=><option key={i.id} value={i.id}>{i.name} · {fmt(i.stockOnHand)} {i.uom}</option>)}</select></label>{field('Quantity *','quantity',movement.quantity,setMovement,'number')}{field('RIS / reference','reference',movement.reference,setMovement)}{field('Recipient / remarks','remarks',movement.remarks,setMovement)}<button disabled={busy} style={buttonStyle}>Post issuance</button></form></div>}
        {section==='Stock Adjustment'&&<div style={{...cardStyle,maxWidth:650}}><h3>Stock balance adjustment</h3><p style={{color:'#718096'}}>Use only for verified physical-count corrections. Every adjustment is logged.</p><form onSubmit={adjustStock} style={{display:'grid',gap:11}}><label>Item<select required style={inputStyle} value={adjustForm.itemId} onChange={e=>updateField(setAdjustForm,'itemId',e.target.value)}><option value="">Select item</option>{activeItems.map(i=><option key={i.id} value={i.id}>{i.name} · Current {fmt(i.stockOnHand)}</option>)}</select></label>{field('New verified balance *','newBalance',adjustForm.newBalance,setAdjustForm,'number')}{field('Reason / physical count reference *','reason',adjustForm.reason,setAdjustForm)}<button disabled={busy} style={buttonStyle}>Save adjustment</button></form></div>}
        {section==='Tools & Equipment'&&<div style={{display:'grid',gridTemplateColumns:'minmax(280px,.8fr) minmax(400px,1.4fr)',gap:14,alignItems:'start'}}>
          <div style={{display:'grid',gap:12}}><form onSubmit={saveEquipment} style={cardStyle}><h3>Add equipment</h3><div style={{display:'grid',gap:9}}>{field('Equipment name *','name',equipmentForm.name,setEquipmentForm)}{field('Brand','brand',equipmentForm.brand,setEquipmentForm)}{field('Model / specification','model',equipmentForm.model,setEquipmentForm)}{field('Serial number','serialNumber',equipmentForm.serialNumber,setEquipmentForm)}{field('Quantity','quantity',equipmentForm.quantity,setEquipmentForm,'number')}{selectField('Condition','condition',equipmentForm.condition,setEquipmentForm,['Good','For repair','Under maintenance','Unserviceable'])}{field('Assigned to','assignedTo',equipmentForm.assignedTo,setEquipmentForm)}{field('Location','location',equipmentForm.location,setEquipmentForm)}<button style={buttonStyle}>Save equipment</button></div></form>
          <form onSubmit={saveMaintenance} style={cardStyle}><h3>Log maintenance</h3><div style={{display:'grid',gap:9}}><label>Equipment<select required style={inputStyle} value={maintenanceForm.equipmentId} onChange={e=>updateField(setMaintenanceForm,'equipmentId',e.target.value)}><option value="">Select equipment</option>{equipment.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{field('Activity *','activity',maintenanceForm.activity,setMaintenanceForm)}{field('Remarks','remarks',maintenanceForm.remarks,setMaintenanceForm)}{field('Next due','nextDue',maintenanceForm.nextDue,setMaintenanceForm,'date')}<button style={buttonStyle}>Save maintenance log</button></div></form></div>
          <div style={cardStyle}><h3>Equipment register</h3>{table(['Equipment','Brand / Model','Serial','Qty','Condition','Assigned to','Location'],equipment.map(x=><tr key={x.id}><td style={td}>{x.name}</td><td style={td}>{[x.brand,x.model].filter(Boolean).join(' / ')||'—'}</td><td style={td}>{x.serialNumber||'—'}</td><td style={td}>{x.quantity}</td><td style={td}>{x.condition}</td><td style={td}>{x.assignedTo||'—'}</td><td style={td}>{x.location||'—'}</td></tr>))}</div>
          <div style={{...cardStyle,gridColumn:'1 / -1'}}><h3>Maintenance history</h3>{table(['Date','Equipment','Activity','Remarks','Next due','Encoded by'],maintenance.map(m=><tr key={m.id}><td style={td}>{dateText(m.createdAt)}</td><td style={td}>{m.equipmentName}</td><td style={td}>{m.activity}</td><td style={td}>{m.remarks}</td><td style={td}>{m.nextDue||'—'}</td><td style={td}>{m.createdBy}</td></tr>))}</div>
        </div>}
        {section==='Gate Pass'&&<div style={{display:'grid',gridTemplateColumns:'minmax(270px,.7fr) minmax(420px,1.5fr)',gap:14,alignItems:'start'}}>
          <form onSubmit={saveGate} style={cardStyle}><h3>Create gate pass</h3><div style={{display:'grid',gap:10}}><label>Item<select required style={inputStyle} value={gateForm.itemId} onChange={e=>updateField(setGateForm,'itemId',e.target.value)}><option value="">Select item</option>{activeItems.map(i=><option key={i.id} value={i.id}>{i.name} · {fmt(i.stockOnHand)}</option>)}</select></label>{field('Quantity *','quantity',gateForm.quantity,setGateForm,'number')}{field('Recipient *','recipient',gateForm.recipient,setGateForm)}{field('Purpose *','purpose',gateForm.purpose,setGateForm)}{field('Reference','reference',gateForm.reference,setGateForm)}<button style={buttonStyle}>Submit gate pass</button></div></form>
          <div style={cardStyle}><h3>Gate pass register</h3>{table(['Date','Item','Qty','Recipient','Purpose','Status','Action'],gatepasses.map(g=><tr key={g.id}><td style={td}>{dateText(g.createdAt)}</td><td style={td}>{g.itemName}</td><td style={td}>{fmt(g.quantity)} {g.uom}</td><td style={td}>{g.recipient}</td><td style={td}>{g.purpose}</td><td style={td}>{g.status}</td><td style={td}>{g.status==='Pending approval'&&<><button style={buttonStyle} onClick={()=>decideGate(g,true)}>Approve</button>{' '}<button style={secondaryStyle} onClick={()=>decideGate(g,false)}>Reject</button></>}{g.status==='Approved'&&<button style={buttonStyle} onClick={()=>releaseGate(g)}>Release</button>}</td></tr>))}</div>
        </div>}
        {section==='Reports'&&<div style={cardStyle}><div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><h3>Warehouse reports & audit trail</h3><button style={buttonStyle} onClick={()=>exportCsv('warehouse-stock-movements.csv',[['Date','Type','Item','Quantity','UOM','Balance before','Balance after','Reference','Remarks','User'],...transactions.map(t=>[dateText(t.createdAt),t.type,t.itemName,t.quantity,t.uom,t.balanceBefore,t.balanceAfter,t.reference,t.remarks,t.createdBy])])}>Export movement CSV</button></div><p>Active inventory: <b>{items.filter(i=>!i.archived).length}</b> · Low stock: <b>{lowStock.length}</b> · Receiving: <b>{transactions.filter(t=>t.type==='RECEIVING').length}</b> · Issuance: <b>{transactions.filter(t=>t.type==='ISSUANCE').length}</b> · Adjustments: <b>{transactions.filter(t=>t.type==='ADJUSTMENT').length}</b></p><h4>Stock movement audit trail</h4>{table(['Date','Type','Item','Qty','Before','After','Reference','Remarks','Encoded by'],transactions.map(t=><tr key={t.id}><td style={td}>{dateText(t.createdAt)}</td><td style={td}>{t.type}</td><td style={td}>{t.itemName}</td><td style={td}>{fmt(t.quantity)} {t.uom||''}</td><td style={td}>{fmt(t.balanceBefore)}</td><td style={td}>{fmt(t.balanceAfter)}</td><td style={td}>{t.reference||'—'}</td><td style={td}>{t.remarks||'—'}</td><td style={td}>{t.createdBy}</td></tr>))}</div>}
      </>}
      <div style={{marginTop:18,color:'#718096',fontSize:12}}>Signed in as {user.email} · Firestore live sync · All stock movements are recorded with user and timestamp.</div>
    </div>
  </div>
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
