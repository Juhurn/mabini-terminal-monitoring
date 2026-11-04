
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bell, Boxes, Building2,
  CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign,
  ClipboardList, Download, FileCheck2, FileSpreadsheet, Filter, LayoutDashboard,
  Menu, PackageCheck, Search, Settings2, ShieldCheck, Truck, Wallet, X, Warehouse, Wrench, Plus, ArrowDownToLine, ArrowUpFromLine
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { db } from './firebase'
import { addDoc, collection, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'

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
  const user = {
    email: 'Public Access',
    displayName: 'SEAOIL Mabini Terminal'
  }

  const [active, setActive] = useState('Overview')
  const [workspace, setWorkspace] = useState(() => localStorage.getItem('mabini-active-workspace') || '')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('2026')
  const [mobileOpen, setMobileOpen] = useState(false)

  // Public, read-only Google Sheets connection
  const [liveData, setLiveData] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [lastSync, setLastSync] = useState(null)
  const [inventoryData, setInventoryData] = useState(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventoryError, setInventoryError] = useState('')

  const fetchLiveData = async () => {
    setDataLoading(true)
    setDataError('')

    try {
      const response = await fetch(
        'https://mabini-terminal-api.jhun-maranan.workers.dev/api/sheets',
        { method: 'GET' }
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

  const fetchInventoryData = async () => {
    setInventoryLoading(true)
    setInventoryError('')
    try {
      const response = await fetch('https://mabini-terminal-api.jhun-maranan.workers.dev/api/inventory')
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load inventory data.')
      setInventoryData(result.data)
    } catch (error) {
      console.error('Inventory sync error:', error)
      setInventoryError(error.message || 'Inventory synchronization failed.')
    } finally { setInventoryLoading(false) }
  }

  useEffect(() => {
    fetchLiveData()
    fetchInventoryData()
    const refresh = setInterval(() => { fetchLiveData(); fetchInventoryData() }, 60000)
    return () => clearInterval(refresh)
  }, [])

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

  const chooseWorkspace = value => {
    localStorage.setItem('mabini-active-workspace', value)
    setWorkspace(value)
    setActive('Overview')
  }

  if (!workspace) return (
    <div style={{ minHeight: '100vh', background: '#f3f6fa', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Nunito, sans-serif' }}>
      <div style={{ width: 'min(900px, 100%)', background: '#fff', borderRadius: 22, padding: 32, boxShadow: '0 16px 50px rgba(20,40,70,.10)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ color: '#477fce', fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>SEAOIL PHILIPPINES · MABINI TERMINAL</div>
          <h1 style={{ color: '#172b46', margin: '10px 0 6px', fontSize: 34 }}>Mabini Terminal</h1>
          <h2 style={{ color: '#526174', margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>Choose your dashboard</h2>
          <p style={{ color: '#718096', margin: 0 }}>SEAOIL Philippines · Centralized Terminal Monitoring System</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
          <button onClick={() => chooseWorkspace('operations')} style={{ textAlign: 'left', padding: 24, border: '1px solid #dbe6f2', borderRadius: 16, background: '#f7faff', cursor: 'pointer', color: '#172b46' }}>
            <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#e4efff', color: '#2869b2' }}><LayoutDashboard size={25}/></div>
            <h2 style={{ margin: '18px 0 6px' }}>Operations Monitoring</h2>
            <p style={{ color: '#718096', margin: 0, lineHeight: 1.6 }}>RQ / PO, EPR, SDCI, approvals, and reference master data.</p>
            <div style={{ marginTop: 18, color: '#2869b2', fontWeight: 800 }}>Open Operations →</div>
          </button>
          <button onClick={() => chooseWorkspace('warehouse')} style={{ textAlign: 'left', padding: 24, border: '1px solid #d8eee5', borderRadius: 16, background: '#f5fbf8', cursor: 'pointer', color: '#172b46' }}>
            <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#e1f4eb', color: '#16875d' }}><Warehouse size={25}/></div>
            <h2 style={{ margin: '18px 0 6px' }}>Warehouse Management</h2>
            <p style={{ color: '#718096', margin: 0, lineHeight: 1.6 }}>Inventory, receiving, issuance, approvals, equipment, and gate pass.</p>
            <div style={{ marginTop: 18, color: '#16875d', fontWeight: 800 }}>Open Warehouse →</div>
          </button>
          <button onClick={() => chooseWorkspace('inventory')} style={{ textAlign: 'left', padding: 24, border: '1px solid #f0dfbd', borderRadius: 16, background: '#fffbf3', cursor: 'pointer', color: '#172b46' }}>
            <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#fff0d4', color: '#b7791f' }}><Boxes size={25}/></div>
            <h2 style={{ margin: '18px 0 6px' }}>Mabini Daily Inventory Summary</h2>
            <p style={{ color: '#718096', margin: 0, lineHeight: 1.6 }}>Daily product stocks, tank levels, available inventory, ullage, and historical trends.</p>
            <div style={{ marginTop: 18, color: '#a66b12', fontWeight: 800 }}>Open Daily Inventory →</div>
          </button>
        </div>
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', color: '#718096', fontSize: 12 }}>
          <span>Public dashboard access · Read-only data connection</span>
        </div>
      </div>
    </div>
  )

  if (workspace === 'inventory') return <InventoryWorkspace data={inventoryData} loading={inventoryLoading} error={inventoryError} onRefresh={fetchInventoryData} onBack={() => { localStorage.removeItem('mabini-active-workspace'); setWorkspace('') }} />

  if (workspace === 'warehouse') return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f3f6fa', fontFamily: 'Nunito, sans-serif' }}>
      <div style={{ maxWidth: 560, padding: 30, borderRadius: 16, background: '#fff', boxShadow: '0 12px 40px rgba(20,40,70,.08)', textAlign: 'center' }}>
        <Warehouse size={36} color="#2869b2" />
        <h2 style={{ color: '#172b46' }}>Warehouse Management</h2>
        <p style={{ color: '#718096', lineHeight: 1.6 }}>This workspace uses a protected Firestore database and is not enabled in public mode. Operations Monitoring is available without sign-in.</p>
        <button onClick={() => { localStorage.removeItem('mabini-active-workspace'); setWorkspace('') }} style={{ border: 0, borderRadius: 8, background: '#2869b2', color: '#fff', padding: '11px 18px', fontWeight: 700, cursor: 'pointer' }}>Back to dashboard selection</button>
      </div>
    </div>
  )

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

        <button className="nav-item" onClick={() => { localStorage.removeItem('mabini-active-workspace'); setWorkspace(''); setMobileOpen(false) }} style={{ margin: '10px 12px 18px', width: 'calc(100% - 24px)', color: '#2869b2', background: '#eef5ff' }}>
          <Warehouse size={18}/><span>Switch Dashboard</span>
        </button>

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

          {isOverview ? (
            <>
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
            </>
          ) : (
            <OperationsModule active={active} liveData={liveData} liveRqRows={liveRqRows} query={query} setQuery={setQuery} money={money}/>
          )}

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


function OperationsModule({ active, liveData, liveRqRows, query, setQuery, money }) {
  const config = {
    'RQ / PO Monitoring': { title: 'RQ / PO Monitoring', description: 'Requisition and purchase order records from the connected workbook.', keys: ['rq'], headers: ['RQ No.', 'Date', 'Description', 'Supplier', 'PO No.', 'Amount', 'Status'] },
    'EPR Monitoring': { title: 'EPR Monitoring', description: 'EPR records from the connected workbook.', keys: ['epr'], headers: null },
    'SDCI Monitoring': { title: 'SDCI Monitoring', description: 'SDCI records from the connected workbook.', keys: ['sdci'], headers: null },
    'For Approval': { title: 'For Approval', description: 'Records listed in the approval worksheet. Review status here; approval actions are not enabled in this view.', keys: ['approvals', 'forApproval', 'approval'], headers: null },
    'Reference & Item Master': { title: 'Reference & Item Master', description: 'Reference and item master data from the connected workbook.', keys: ['sheet4', 'reference', 'itemMaster'], headers: null }
  }
  const cfg = config[active] || config['RQ / PO Monitoring']
  const source = cfg.keys.map(k => liveData?.[k]).find(Array.isArray) || []
  const rqRows = active === 'RQ / PO Monitoring' ? liveRqRows.map(r => [r.rq, r.date, r.description, r.supplier, r.po, money(r.amount), r.status]) : []
  const raw = active === 'RQ / PO Monitoring' ? rqRows : source
  const rows = raw.filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim()))
  const filteredRows = rows.filter(row => row.join(' ').toLowerCase().includes(query.toLowerCase()))
  const headers = active === 'RQ / PO Monitoring' ? cfg.headers : (rows[0] || []).map((v, i) => String(v || `Column ${i+1}`))
  const dataRows = active === 'RQ / PO Monitoring' ? filteredRows : filteredRows.slice(1)
  return <section className="panel transactions-panel">
    <div className="panel-head transaction-heading"><div><h3>{cfg.title}</h3><p>{cfg.description}</p></div><span className="environment">{liveData ? 'LIVE WORKBOOK' : 'WAITING FOR DATA'}</span></div>
    <div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${active}...`}/></div></div>
    {!liveData ? <div className="empty-state">Google Sheets data is not connected. Please check the data connection.</div> : rows.length === 0 ? <div className="empty-state">No rows were returned for this worksheet. Check the Worker sheet mapping and worksheet data.</div> : <div className="table-scroll"><table><thead><tr>{headers.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{dataRows.slice(0,250).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{String(cell ?? '')}</td>)}</tr>)}</tbody></table>{dataRows.length===0 && <div className="empty-state">No matching records.</div>}</div>}
    <div className="table-footer"><span>{dataRows.length} {active} rows {dataRows.length > 250 ? '(showing first 250)' : ''}</span><button className="btn text-btn" onClick={()=>setQuery('')}>Clear search</button></div>
  </section>
}

function WarehouseWorkspace({ user, onBack }) {
  const [section, setSection] = useState('Inventory')
  const [items, setItems] = useState([])
  const [transactions, setTransactions] = useState([])
  const [equipment, setEquipment] = useState([])
  const [gatepasses, setGatepasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [itemForm, setItemForm] = useState({ code:'', name:'', category:'Consumables', uom:'pcs', location:'Warehouse', openingStock:'0', reorderLevel:'0' })
  const [movement, setMovement] = useState({ itemId:'', quantity:'', reference:'', remarks:'' })
  const [equipmentForm, setEquipmentForm] = useState({ name:'', brand:'', model:'', serialNumber:'', quantity:'1', condition:'Good', assignedTo:'' })
  const [gateForm, setGateForm] = useState({ itemId:'', quantity:'', recipient:'', purpose:'', reference:'' })

  useEffect(() => {
    const unsubscribers = [
      onSnapshot(collection(db, 'warehouse_items'), snap => { setItems(snap.docs.map(d => ({ id:d.id, ...d.data() }))); setLoading(false) }, err => { setError(err.message); setLoading(false) }),
      onSnapshot(collection(db, 'warehouse_transactions'), snap => setTransactions(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))), err => setError(err.message)),
      onSnapshot(collection(db, 'warehouse_equipment'), snap => setEquipment(snap.docs.map(d => ({ id:d.id, ...d.data() }))), err => setError(err.message)),
      onSnapshot(collection(db, 'warehouse_gatepasses'), snap => setGatepasses(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))), err => setError(err.message))
    ]
    return () => unsubscribers.forEach(unsub => unsub())
  }, [])

  const available = id => items.find(item => item.id === id)
  const fmt = n => Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })
  const dateText = ts => ts?.toDate ? ts.toDate().toLocaleString() : '—'
  const updateField = (setter, key, value) => setter(prev => ({ ...prev, [key]: value }))

  const saveItem = async e => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const opening = Number(itemForm.openingStock)
      if (!itemForm.name.trim() || !Number.isFinite(opening) || opening < 0) throw new Error('Enter a valid item name and opening stock.')
      await addDoc(collection(db, 'warehouse_items'), {
        code:itemForm.code.trim(), name:itemForm.name.trim(), category:itemForm.category, uom:itemForm.uom.trim() || 'pcs',
        location:itemForm.location.trim(), stockOnHand:opening, openingStock:opening, reorderLevel:Math.max(0, Number(itemForm.reorderLevel)||0),
        createdAt:serverTimestamp(), updatedAt:serverTimestamp(), createdBy:user.email
      })
      setItemForm({ code:'', name:'', category:'Consumables', uom:'pcs', location:'Warehouse', openingStock:'0', reorderLevel:'0' })
      setNotice('Inventory item saved.')
    } catch(err) { setError(err.message) } finally { setBusy(false) }
  }

  const saveMovement = async (type, e) => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const qty = Number(movement.quantity)
      if (!movement.itemId || !Number.isFinite(qty) || qty <= 0) throw new Error('Select an item and enter a quantity greater than zero.')
      const itemRef = doc(db, 'warehouse_items', movement.itemId)
      await runTransaction(db, async tx => {
        const snap = await tx.get(itemRef)
        if (!snap.exists()) throw new Error('Selected item no longer exists.')
        const current = Number(snap.data().stockOnHand || 0)
        if (type === 'ISSUANCE' && qty > current) throw new Error(`Insufficient stock. Available: ${current}`)
        const next = type === 'RECEIVING' ? current + qty : current - qty
        tx.update(itemRef, { stockOnHand:next, updatedAt:serverTimestamp() })
        const transRef = doc(collection(db, 'warehouse_transactions'))
        tx.set(transRef, { type, itemId:movement.itemId, itemName:snap.data().name, itemCode:snap.data().code || '', quantity:qty, uom:snap.data().uom || 'pcs', balanceAfter:next, reference:movement.reference.trim(), remarks:movement.remarks.trim(), createdAt:serverTimestamp(), createdBy:user.email })
      })
      setMovement({ itemId:'', quantity:'', reference:'', remarks:'' })
      setNotice(type === 'RECEIVING' ? 'Stock received and balance updated.' : 'Stock issued and balance updated.')
    } catch(err) { setError(err.message) } finally { setBusy(false) }
  }

  const saveEquipment = async e => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      if (!equipmentForm.name.trim()) throw new Error('Equipment name is required.')
      await addDoc(collection(db, 'warehouse_equipment'), { ...equipmentForm, quantity:Math.max(1, Number(equipmentForm.quantity)||1), createdAt:serverTimestamp(), updatedAt:serverTimestamp(), createdBy:user.email })
      setEquipmentForm({ name:'', brand:'', model:'', serialNumber:'', quantity:'1', condition:'Good', assignedTo:'' })
      setNotice('Equipment record saved.')
    } catch(err) { setError(err.message) } finally { setBusy(false) }
  }

  const saveGatepass = async e => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const item = available(gateForm.itemId), qty = Number(gateForm.quantity)
      if (!item || !Number.isFinite(qty) || qty <= 0 || !gateForm.recipient.trim() || !gateForm.purpose.trim()) throw new Error('Complete item, quantity, recipient, and purpose.')
      if (qty > Number(item.stockOnHand || 0)) throw new Error('Gate pass quantity exceeds available stock.')
      await addDoc(collection(db, 'warehouse_gatepasses'), { itemId:item.id, itemName:item.name, quantity:qty, uom:item.uom || 'pcs', recipient:gateForm.recipient.trim(), purpose:gateForm.purpose.trim(), reference:gateForm.reference.trim(), status:'For review', createdAt:serverTimestamp(), createdBy:user.email })
      setGateForm({ itemId:'', quantity:'', recipient:'', purpose:'', reference:'' })
      setNotice('Gate pass request recorded. Stock is not deducted until issuance is recorded.')
    } catch(err) { setError(err.message) } finally { setBusy(false) }
  }

  const lowStock = items.filter(i => Number(i.stockOnHand || 0) <= Number(i.reorderLevel || 0))
  const inputStyle = { width:'100%', padding:'10px 12px', border:'1px solid #d8e0ea', borderRadius:8, font:'inherit', boxSizing:'border-box', background:'#fff' }
  const cardStyle = { background:'#fff', border:'1px solid #e5eaf0', borderRadius:14, padding:18, boxShadow:'0 3px 12px rgba(20,40,70,.04)' }
  const buttonStyle = { border:0, borderRadius:8, background:'#2869b2', color:'#fff', padding:'10px 15px', fontWeight:700, cursor:'pointer' }
  const field = (label, key, value, setter, type='text', placeholder='') => <label style={{display:'grid', gap:6, color:'#526174', fontSize:13}}>{label}<input style={inputStyle} type={type} value={value} placeholder={placeholder} onChange={e=>updateField(setter,key,e.target.value)}/></label>
  const selectField = (label,key,value,setter,options) => <label style={{display:'grid',gap:6,color:'#526174',fontSize:13}}>{label}<select style={inputStyle} value={value} onChange={e=>updateField(setter,key,e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
  const tabs = ['Inventory','Receiving','Issuance','Tools & Equipment','Gate Pass','Reports']
  const th = { textAlign:'left', padding:'11px 10px', color:'#718096', fontSize:11, letterSpacing:'.05em', borderBottom:'1px solid #e8edf3', whiteSpace:'nowrap' }
  const td = { padding:'12px 10px', borderBottom:'1px solid #eef1f5', fontSize:13, color:'#26384d' }

  return <div style={{minHeight:'100vh', background:'#f3f6fa', padding:24, fontFamily:'Nunito, sans-serif', color:'#172b46'}}>
    <div style={{maxWidth:1400, margin:'0 auto'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap', marginBottom:22}}>
        <div><div style={{fontSize:11, letterSpacing:2, color:'#477fce', fontWeight:800}}>SEAOIL PHILIPPINES / MABINI TERMINAL</div><h1 style={{margin:'7px 0', fontSize:28}}>Warehouse Management</h1><div style={{color:'#718096',fontSize:13}}>Inventory, stock movements, equipment accountability and gate passes</div></div>
        <button style={{...buttonStyle,background:'#fff',color:'#2869b2',border:'1px solid #cbd8e8'}} onClick={onBack}>← Back to Operations</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:18}}>
        {[['Inventory Items',items.length],['Total Units',fmt(items.reduce((s,i)=>s+Number(i.stockOnHand||0),0))],['Low Stock',lowStock.length],['Transactions',transactions.length]].map(([label,value])=><div key={label} style={cardStyle}><div style={{fontSize:12,color:'#718096'}}>{label}</div><div style={{fontSize:27,fontWeight:800,marginTop:7}}>{value}</div></div>)}
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>{tabs.map(t=><button key={t} onClick={()=>setSection(t)} style={{...buttonStyle,background:section===t?'#2869b2':'#fff',color:section===t?'#fff':'#526174',border:'1px solid #dbe3ed'}}>{t}</button>)}</div>
      {error && <div style={{...cardStyle,background:'#fff1f0',color:'#b42318',marginBottom:12}}>{error}</div>}
      {notice && <div style={{...cardStyle,background:'#ecfdf3',color:'#067647',marginBottom:12}}>{notice}</div>}
      {loading ? <div style={cardStyle}>Loading warehouse records…</div> : <>
        {section==='Inventory' && <div style={{display:'grid',gridTemplateColumns:'minmax(300px, .8fr) minmax(400px, 1.5fr)',gap:16,alignItems:'start'}}>
          <form onSubmit={saveItem} style={cardStyle}><h3 style={{marginTop:0}}>Add inventory item</h3><div style={{display:'grid',gap:11}}>
            {field('Item code','code',itemForm.code,setItemForm)}{field('Item name *','name',itemForm.name,setItemForm)}
            {selectField('Category','category',itemForm.category,setItemForm,['Consumables','Office Supplies','Maintenance','Safety / PPE','Electrical','Other'])}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{field('Unit of measure','uom',itemForm.uom,setItemForm)}{field('Opening stock','openingStock',itemForm.openingStock,setItemForm,'number')}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{field('Reorder level','reorderLevel',itemForm.reorderLevel,setItemForm,'number')}{field('Storage location','location',itemForm.location,setItemForm)}</div>
            <button disabled={busy} style={buttonStyle}>{busy?'Saving…':'Save inventory item'}</button>
          </div></form>
          <div style={cardStyle}><h3 style={{marginTop:0}}>Inventory masterlist</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Code','Item','Category','UOM','On hand','Reorder','Location'].map(x=><th style={th} key={x}>{x}</th>)}</tr></thead><tbody>{items.map(i=><tr key={i.id}><td style={td}>{i.code||'—'}</td><td style={td}><b>{i.name}</b></td><td style={td}>{i.category}</td><td style={td}>{i.uom}</td><td style={{...td,fontWeight:800,color:Number(i.stockOnHand||0)<=Number(i.reorderLevel||0)?'#b54708':'#067647'}}>{fmt(i.stockOnHand)}</td><td style={td}>{fmt(i.reorderLevel)}</td><td style={td}>{i.location||'—'}</td></tr>)}</tbody></table>{!items.length&&<p style={{color:'#718096'}}>No inventory items yet. Add the first actual item using the form.</p>}</div></div>
        </div>}
        {(section==='Receiving'||section==='Issuance') && <div style={{...cardStyle,maxWidth:650}}><h3 style={{marginTop:0}}>{section==='Receiving'?'Record stock receiving':'Record stock issuance'}</h3><form onSubmit={e=>saveMovement(section==='Receiving'?'RECEIVING':'ISSUANCE',e)} style={{display:'grid',gap:12}}>
          <label style={{display:'grid',gap:6,fontSize:13,color:'#526174'}}>Inventory item<select style={inputStyle} value={movement.itemId} onChange={e=>updateField(setMovement,'itemId',e.target.value)}><option value="">Select item</option>{items.map(i=><option key={i.id} value={i.id}>{i.code?i.code+' · ':''}{i.name} (On hand: {fmt(i.stockOnHand)} {i.uom})</option>)}</select></label>
          {field('Quantity','quantity',movement.quantity,setMovement,'number')}{field('Reference / DR / RIS','reference',movement.reference,setMovement)}{field('Remarks','remarks',movement.remarks,setMovement)}
          <button disabled={busy||!items.length} style={buttonStyle}>{busy?'Saving…':section==='Receiving'?'Save receiving':'Save issuance'}</button>
        </form></div>}
        {section==='Tools & Equipment' && <div style={{display:'grid',gridTemplateColumns:'minmax(300px,.8fr) minmax(400px,1.5fr)',gap:16,alignItems:'start'}}>
          <form onSubmit={saveEquipment} style={cardStyle}><h3 style={{marginTop:0}}>Add equipment record</h3><div style={{display:'grid',gap:11}}>{field('Equipment name *','name',equipmentForm.name,setEquipmentForm)}{field('Brand','brand',equipmentForm.brand,setEquipmentForm)}{field('Model / specification','model',equipmentForm.model,setEquipmentForm)}{field('Serial number','serialNumber',equipmentForm.serialNumber,setEquipmentForm)}{field('Quantity','quantity',equipmentForm.quantity,setEquipmentForm,'number')}{selectField('Condition','condition',equipmentForm.condition,setEquipmentForm,['Good','For repair','Under maintenance','Unserviceable'])}{field('Assigned to','assignedTo',equipmentForm.assignedTo,setEquipmentForm)}<button disabled={busy} style={buttonStyle}>Save equipment</button></div></form>
          <div style={cardStyle}><h3 style={{marginTop:0}}>Tools & equipment register</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Equipment','Brand / Model','Serial no.','Qty','Condition','Assigned to'].map(x=><th style={th} key={x}>{x}</th>)}</tr></thead><tbody>{equipment.map(x=><tr key={x.id}><td style={td}>{x.name}</td><td style={td}>{[x.brand,x.model].filter(Boolean).join(' / ')||'—'}</td><td style={td}>{x.serialNumber||'—'}</td><td style={td}>{x.quantity}</td><td style={td}>{x.condition}</td><td style={td}>{x.assignedTo||'—'}</td></tr>)}</tbody></table>{!equipment.length&&<p style={{color:'#718096'}}>No equipment records yet.</p>}</div></div>
        </div>}
        {section==='Gate Pass' && <div style={{display:'grid',gridTemplateColumns:'minmax(300px,.8fr) minmax(400px,1.5fr)',gap:16,alignItems:'start'}}>
          <form onSubmit={saveGatepass} style={cardStyle}><h3 style={{marginTop:0}}>Create gate pass request</h3><div style={{display:'grid',gap:11}}>
            <label style={{display:'grid',gap:6,fontSize:13,color:'#526174'}}>Item<select style={inputStyle} value={gateForm.itemId} onChange={e=>updateField(setGateForm,'itemId',e.target.value)}><option value="">Select item</option>{items.map(i=><option key={i.id} value={i.id}>{i.name} (On hand: {fmt(i.stockOnHand)})</option>)}</select></label>
            {field('Quantity','quantity',gateForm.quantity,setGateForm,'number')}{field('Recipient','recipient',gateForm.recipient,setGateForm)}{field('Purpose','purpose',gateForm.purpose,setGateForm)}{field('Reference','reference',gateForm.reference,setGateForm)}<button disabled={busy||!items.length} style={buttonStyle}>Save gate pass</button>
          </div></form>
          <div style={cardStyle}><h3 style={{marginTop:0}}>Gate pass register</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Date','Item','Qty','Recipient','Purpose','Status'].map(x=><th style={th} key={x}>{x}</th>)}</tr></thead><tbody>{gatepasses.map(g=><tr key={g.id}><td style={td}>{dateText(g.createdAt)}</td><td style={td}>{g.itemName}</td><td style={td}>{fmt(g.quantity)} {g.uom}</td><td style={td}>{g.recipient}</td><td style={td}>{g.purpose}</td><td style={td}>{g.status}</td></tr>)}</tbody></table>{!gatepasses.length&&<p style={{color:'#718096'}}>No gate pass requests yet.</p>}</div></div>
        </div>}
        {section==='Reports' && <div style={cardStyle}><h3 style={{marginTop:0}}>Warehouse activity report</h3><p>Low-stock items: <b>{lowStock.length}</b> · Receiving entries: <b>{transactions.filter(t=>t.type==='RECEIVING').length}</b> · Issuance entries: <b>{transactions.filter(t=>t.type==='ISSUANCE').length}</b></p><h4>Low-stock watchlist</h4>{lowStock.length?lowStock.map(i=><div key={i.id} style={{padding:'9px 0',borderBottom:'1px solid #eef1f5'}}>{i.name} — {fmt(i.stockOnHand)} {i.uom} remaining (reorder level: {fmt(i.reorderLevel)})</div>):<p>Walang item below reorder level.</p>}<h4 style={{marginTop:22}}>Recent stock movements</h4><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Date','Type','Item','Qty','Balance after','Reference','Encoded by'].map(x=><th style={th} key={x}>{x}</th>)}</tr></thead><tbody>{transactions.slice(0,100).map(t=><tr key={t.id}><td style={td}>{dateText(t.createdAt)}</td><td style={td}>{t.type}</td><td style={td}>{t.itemName}</td><td style={td}>{fmt(t.quantity)} {t.uom}</td><td style={td}>{fmt(t.balanceAfter)}</td><td style={td}>{t.reference||'—'}</td><td style={td}>{t.createdBy}</td></tr>)}</tbody></table>{!transactions.length&&<p>No stock movements recorded.</p>}</div></div>}
      </>}
      <div style={{marginTop:18,color:'#718096',fontSize:12}}>Public access · Warehouse database requires separate authorization</div>
    </div>
  </div>
}



function InventoryWorkspace({ data, loading, error, onRefresh, onBack }) {
  const tabs = data?.tabs || []
  const parseTab = tab => {
    const values = tab?.values || []
    const rows = values.slice(2).filter(r => Array.isArray(r) && r[0] !== undefined && r[1] !== undefined && !String(r[0]).toUpperCase().includes('TOTAL'))
    return rows.map(r => ({ tank:String(r[0] ?? ''), product:String(r[1] ?? '').trim(), total:Number(r[2]) || 0, deadstock:Number(r[3]) || 0, available:Number(r[4]) || 0, capacity:Number(r[5]) || 0, safeCapacity:Number(r[6]) || 0, ullage:Number(r[7]) || 0, dailySales:Number(r[8]) || 0, days:Number(r[9]) || 0, status:String(r[10] ?? '') })).filter(r => r.tank && r.product && Number.isFinite(r.total))
  }
  const parsed = tabs.map(t => ({ name:t.name, rows:parseTab(t) }))
  const latest = parsed[0] || {name:'No data',rows:[]}
  const products = [...new Set(latest.rows.map(r=>r.product))]
  const total = latest.rows.reduce((s,r)=>s+r.total,0)
  const available = latest.rows.reduce((s,r)=>s+r.available,0)
  const deadstock = latest.rows.reduce((s,r)=>s+r.deadstock,0)
  const fmt = n => Number(n || 0).toLocaleString('en-PH',{maximumFractionDigits:3})
  const card = {background:'#fff',border:'1px solid #e5eaf0',borderRadius:14,padding:18,boxShadow:'0 3px 12px rgba(20,40,70,.04)'}
  const tableHead = {textAlign:'left',padding:'11px 10px',color:'#718096',fontSize:11,borderBottom:'1px solid #e8edf3',whiteSpace:'nowrap'}
  const cell = {padding:'11px 10px',borderBottom:'1px solid #eef1f5',fontSize:13,color:'#26384d',whiteSpace:'nowrap'}
  const trend = parsed.slice().reverse().map(t=>({date:t.name, total:t.rows.reduce((s,r)=>s+r.total,0), available:t.rows.reduce((s,r)=>s+r.available,0)}))
  return <div style={{minHeight:'100vh',background:'#f3f6fa',padding:24,fontFamily:'Nunito, sans-serif',color:'#172b46'}}>
    <div style={{maxWidth:1450,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:22}}>
        <div><div style={{fontSize:11,letterSpacing:2,color:'#477fce',fontWeight:800}}>SEAOIL PHILIPPINES / MABINI TERMINAL</div><h1 style={{margin:'7px 0',fontSize:28}}>Mabini Daily Inventory Summary</h1><div style={{color:'#718096',fontSize:13}}>Latest daily stock position and historical tank inventory</div></div>
        <div style={{display:'flex',gap:8}}><button onClick={onRefresh} style={{border:'1px solid #cbd8e8',borderRadius:8,background:'#fff',color:'#2869b2',padding:'10px 14px',fontWeight:700,cursor:'pointer'}}>↻ Refresh</button><button onClick={onBack} style={{border:0,borderRadius:8,background:'#2869b2',color:'#fff',padding:'10px 14px',fontWeight:700,cursor:'pointer'}}>← All dashboards</button></div>
      </div>
      {error && <div style={{...card,background:'#fff1f0',color:'#b42318',marginBottom:14}}>{error}</div>}
      {loading && !data ? <div style={card}>Loading daily inventory from Google Sheets…</div> : !latest.rows.length ? <div style={card}>No inventory records returned. Check the inventory worksheet tabs and Worker mapping.</div> : <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginBottom:16}}>
          {[['Latest report',latest.name],['Total inventory',fmt(total)],['Available inventory',fmt(available)],['Deadstock volume',fmt(deadstock)],['Tank / skid records',latest.rows.length]].map(([k,v])=><div key={k} style={card}><div style={{fontSize:12,color:'#718096'}}>{k}</div><div style={{fontSize:25,fontWeight:800,marginTop:7}}>{v}</div></div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:14,marginBottom:16}}>
          {products.map(product=>{const list=latest.rows.filter(r=>r.product===product);const qty=list.reduce((s,r)=>s+r.total,0);const cap=list.reduce((s,r)=>s+r.safeCapacity,0);const pct=cap>0?Math.min(100,Math.max(0,qty/cap*100)):0;return <div key={product} style={card}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><b>{product}</b><b>{fmt(qty)}</b></div><div style={{height:13,background:'#edf1f5',borderRadius:20,overflow:'hidden',margin:'14px 0 8px'}}><div style={{height:'100%',width:`${pct}%`,background:'#2c83c7',borderRadius:20}}/></div><div style={{fontSize:12,color:'#718096'}}>{list.length} tank/skid record(s) · {cap ? `${pct.toFixed(1)}% of safe capacity` : 'Safe capacity not available'}</div></div>})}
        </div>
        <div style={{...card,marginBottom:16}}><h3 style={{marginTop:0}}>Tank inventory details · {latest.name}</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Tank / Skid','Product','Total Inventory','Deadstock','Available','Max Capacity','Safe Capacity','Ullage','Days Inventory','Status'].map(h=><th key={h} style={tableHead}>{h}</th>)}</tr></thead><tbody>{latest.rows.map((r,i)=><tr key={`${r.tank}-${i}`}><td style={cell}><b>{r.tank}</b></td><td style={cell}>{r.product}</td><td style={cell}>{fmt(r.total)}</td><td style={cell}>{fmt(r.deadstock)}</td><td style={cell}>{fmt(r.available)}</td><td style={cell}>{fmt(r.capacity)}</td><td style={cell}>{fmt(r.safeCapacity)}</td><td style={cell}>{fmt(r.ullage)}</td><td style={cell}>{r.days?fmt(r.days):'—'}</td><td style={cell}>{r.status||'—'}</td></tr>)}</tbody></table></div></div>
        <div style={{...card,marginBottom:16}}><h3 style={{marginTop:0}}>Historical inventory trend</h3><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={tableHead}>Report date</th><th style={tableHead}>Total inventory</th><th style={tableHead}>Available inventory</th><th style={tableHead}>Tank records</th></tr></thead><tbody>{trend.map(t=><tr key={t.date}><td style={cell}>{t.date}</td><td style={cell}>{fmt(t.total)}</td><td style={cell}>{fmt(t.available)}</td><td style={cell}>{parsed.find(p=>p.name===t.date)?.rows.length || 0}</td></tr>)}</tbody></table></div></div>
        <div style={{fontSize:12,color:'#718096'}}>Source: connected Mabini Daily Inventory Google Sheet · Auto-refresh every 60 seconds · Values shown as recorded in the source workbook; units are not assumed.</div>
      </>}
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


export default App
