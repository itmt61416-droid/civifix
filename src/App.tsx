import { analyzeImage } from './lib/ai';
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, ArrowRight, Bell, Check, ChevronDown, Clock3, FilePlus2, Filter, LogOut, MapPin, Menu, Search, ShieldCheck, Siren, Users, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { Category, Issue, Status } from './types';
import { resolveWard } from './lib/ward';
import { createReport, getUserRole, listReports, requestReportRecheck, updateReportStatus, type CiviFixRole } from './lib/reports';
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import StatusBadge from './components/StatusBadge';
import SupervisorControls from './components/SupervisorControls';

// Map Imports
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default Leaflet map markers missing in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const categories: Category[] = ['Road & pothole','Garbage','Drainage','Streetlight','Water leakage','Other'];
const nextStatus: Partial<Record<Status,Status>> = { Submitted:'Under review', 'Under review':'Accepted', Accepted:'In progress', 'In progress':'Resolved' };
const shortDate = (s:string) => new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short'}).format(new Date(s));

export default function App() {
  const [session, setSession] = useState<Session|null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured()) { setCheckingSession(false); return; }
    let supabase: ReturnType<typeof getSupabaseClient>;
    try { supabase = getSupabaseClient(); }
    catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Supabase configuration is invalid.');
      setCheckingSession(false);
      return;
    }
    supabase.auth.getSession().then(({data,error}) => {
      if (error) setAuthError(error.message);
      setSession(data.session);
      setCheckingSession(false);
    }).catch((error:unknown) => {
      setAuthError(error instanceof Error ? error.message : 'Unable to check sign-in status.');
      setCheckingSession(false);
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,nextSession) => setSession(nextSession));
    return () => subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured()) return <main className="config-screen"><div className="config-card"><span className="brand-mark">c</span><h1>Connect CiviFix to Supabase</h1><p>Create <code>.env.local</code> in the project root with your Project URL and publishable key, then restart the Vite server.</p><pre>VITE_SUPABASE_URL=https://your-project-ref.supabase.co<br/>VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key</pre></div></main>;
  if (checkingSession) return <main className="auth-loading"><span className="brand-mark">c</span><p>Connecting securely…</p></main>;
  if (authError) return <main className="config-screen"><div className="config-card"><h1>Could not connect</h1><p>{authError}</p><p>Check the URL and publishable key in <code>.env.local</code>, then restart Vite.</p></div></main>;
  if (!session) return <AuthScreen/>;
  return <Dashboard userEmail={session.user.email ?? 'Signed-in user'} userId={session.user.id} onSignOut={()=>getSupabaseClient().auth.signOut()}/>;
}

function Dashboard({userEmail,userId,onSignOut}:{userEmail:string;userId:string;onSignOut:()=>unknown}) {
  const [issues,setIssues] = useState<Issue[]>([]);
  const [loadingReports,setLoadingReports] = useState(true);
  const [userRole,setUserRole] = useState<CiviFixRole>('citizen');
  const [page,setPage] = useState<'overview'|'reports'|'submit'|'ward'>('overview');
  const [filter,setFilter] = useState('All reports');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<Issue|null>(null);
  const [toast,setToast] = useState('');
  const [menuOpen,setMenuOpen] = useState(false);
  const update = (all:Issue[]) => { setIssues(all); };
  const notify = (s:string) => { setToast(s); window.setTimeout(()=>setToast(''),3000); };
  const canManage = userRole === 'supervisor' || userRole === 'senior_officer';
  useEffect(() => {
    let cancelled = false;
    Promise.all([listReports(),getUserRole(userId)]).then(([rows,role]) => {
      if (!cancelled) { setIssues(rows); setUserRole(role); }
    })
      .catch(error => { if (!cancelled) setToast(error instanceof Error ? error.message : 'Could not load your reports.'); })
      .finally(() => { if (!cancelled) setLoadingReports(false); });
    return () => { cancelled = true; };
  }, [userId]);
  const counts = useMemo(()=>({ total:issues.length, open:issues.filter(i=>!['Resolved','Rejected','Duplicate'].includes(i.status)).length, resolved:issues.filter(i=>i.status==='Resolved').length, urgent:issues.filter(i=>i.priority==='Urgent'&&!['Resolved','Rejected'].includes(i.status)).length }),[issues]);
  const visible = issues.filter(i => (filter==='All reports'||i.status===filter) && `${i.id} ${i.title} ${i.category} ${i.location}`.toLowerCase().includes(query.toLowerCase()));
  const advance = async (issue:Issue) => {
    if (!canManage) { notify('Only a ward supervisor or senior officer can change report status.'); return; }
    const status = nextStatus[issue.status]; if (!status) return;
    const text = status==='Resolved' ? 'Work marked resolved by ward supervisor' : `Status updated to ${status}`;
    try {
      const revised = await updateReportStatus(issue,status,text,userId);
      update(issues.map(x=>x.id===issue.id?revised:x)); setSelected(revised); notify(`${issue.id} moved to ${status}`);
    } catch(error) { notify(error instanceof Error ? error.message : 'Could not update this report.'); }
  };
  const markUnresolved = async (issue:Issue) => {
    try {
      const revised = await requestReportRecheck(issue,userId);
      update(issues.map(x=>x.id===issue.id?revised:x)); setSelected(revised); notify('Recheck request sent to the ward');
    } catch(error) { notify(error instanceof Error ? error.message : 'Could not request a recheck.'); }
  };
  const submit = async (form:HTMLFormElement) => {
    const data = new FormData(form);
    const file = data.get('photo') as File;
    const latValue = data.get('latitude'); const lonValue = data.get('longitude');
    const category = data.get('category') as Category;
    
    if (!latValue || !lonValue) {
      notify('Please select a location on the map first.');
      return;
    }

    try {
      const item = await createReport({
        title: String(data.get('title')),
        category,
        description: String(data.get('description')),
        location: String(data.get('location')),
        latitude: Number(latValue),
        longitude: Number(lonValue),
        urgent: data.get('urgent') === 'on',
        reporterId: userId,
        photo: file?.size ? file : null,
      });
      update([item,...issues]); form.reset(); setPage('reports'); notify(`Report ${item.id} saved to Supabase`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not submit this report. Please try again.');
    }
  };
  const nav = [{id:'overview' as const,label:'Overview',icon:Activity},{id:'reports' as const,label:'Issue reports',icon:FilePlus2,count:counts.open},{id:'ward' as const,label:'Ward performance',icon:MapPin}];
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen?'sidebar-open':''}`}>
      <a className="brand" href="#top" onClick={()=>setPage('overview')}><span className="brand-mark">c</span><span><b>civifix</b><small>COMMUNITY PORTAL</small></span></a>
      <div className="workspace-label">WORKSPACE <ChevronDown size={13}/></div><div className="ward-switch"><span className="ward-dot"/><span><b>Ward 14</b><small>Green Park · Demo</small></span><ChevronDown size={15}/></div>
      <div className="nav-label">MENU</div><nav>{nav.map(n=><button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>{setPage(n.id);setMenuOpen(false)}}><n.icon size={18}/><span>{n.label}</span>{n.count!==undefined&&<em>{n.count}</em>}</button>)}</nav>
      <div className="nav-label tools-label">TOOLS</div><button className="nav-item" onClick={()=>{setPage('submit');setMenuOpen(false)}}><FilePlus2 size={18}/><span>Submit an issue</span></button>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><ShieldCheck size={18}/></span><b>Building better wards</b><p>Every report helps your community get heard.</p><button onClick={()=>notify('Demo portal · Reports are stored in this browser')}>About CiviFix <ArrowRight size={14}/></button></div><div className="profile"><div className="avatar">{userEmail.slice(0,2).toUpperCase()}</div><span><b>{userEmail}</b><small>Signed-in account</small></span><button className="profile-logout" title="Sign out" onClick={()=>void onSignOut()}><LogOut size={15}/></button></div></div>
    </aside>
    {menuOpen&&<button aria-label="Close menu" className="scrim" onClick={()=>setMenuOpen(false)}/>}
    <main id="top" className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={()=>setMenuOpen(!menuOpen)}><Menu size={19}/></button><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{page==='overview'?'Overview':page==='reports'?'Issue reports':page==='submit'?'New report':'Ward performance'}</strong></div><div className="top-actions"><span className="live-indicator"><i/> Demo environment</span><button className="icon-button notification" title="Notifications" onClick={()=>notify('You are all caught up')}><Bell size={18}/><i/></button><button className="top-avatar account-avatar" title="Sign out" onClick={()=>void onSignOut()}>{userEmail.slice(0,2).toUpperCase()}</button></div></header>
      <div className="content">
       {page==='overview'&&<>
        <div className="welcome-row"><div><div className="eyebrow">THURSDAY, OCTOBER 1, 2026 <span>·</span> WARD 14</div><h1>Good morning, {canManage ? 'Supervisor' : 'Community Member'} <span>✳</span></h1><p>Here’s the latest on civic issues reported in your ward.</p></div><button className="primary-button" onClick={()=>setPage('submit')}><FilePlus2 size={17}/> Report an issue</button></div>
        <div className="metric-grid"><Metric label="Total reports" value={counts.total} change="Reports on this account" icon={<FilePlus2/>} tone="green"/><Metric label="Needs attention" value={counts.open} change={`${counts.urgent} urgent reports`} icon={<Clock3/>} tone="amber"/><Metric label="Resolved this month" value={counts.resolved} change="Updated from report status" icon={<Check/>} tone="blue"/><Metric label="Your submissions" value={counts.total} change="Reports linked to your account" icon={<Users/>} tone="purple"/></div>
        <div className="section-row"><div><h2>Recent issue reports</h2><p>Follow up on reports submitted from your account.</p></div><button className="text-button" onClick={()=>setPage('reports')}>View all reports <ArrowRight size={15}/></button></div>
        <div className="report-table-card"><div className="table-toolbar"><div className="table-title"><span className="green-pip"/> Your reports <span className="count-pill">{loadingReports?"…":issues.length}</span></div><button className="filter-button" onClick={()=>setPage('reports')}><Filter size={15}/> Filters</button></div><IssueTable issues={issues.slice(0,4)} onOpen={setSelected} onAdvance={advance} canManage={canManage}/><div className="table-footer"><span>Showing {Math.min(4,issues.length)} of {issues.length} reports</span><button onClick={()=>setPage('reports')}>View all reports <ArrowRight size={14}/></button></div></div>
        <div className="lower-grid"><div className="panel ward-health"><div className="panel-heading"><div><h3>Ward service snapshot</h3><p>Current reporting period · October</p></div><button className="more-button">•••</button></div><div className="snapshot-row"><div className="donut"><div><b>{counts.total?Math.round(counts.resolved/counts.total*100):0}%</b><small>resolved</small></div></div><div className="snapshot-stats"><Stat label="Reports received" value={counts.total} color="green"/><Stat label="Resolved" value={counts.resolved} color="blue"/><Stat label="Open / in progress" value={counts.open} color="amber"/></div></div><button className="panel-link" onClick={()=>setPage('ward')}>View ward performance <ArrowRight size={14}/></button></div>
        <div className="panel attention"><div className="panel-heading"><div><h3>Needs your attention</h3><p>Reports that may need action</p></div><span className="attention-icon"><Siren size={18}/></span></div>{issues.filter(i=>i.priority==='Urgent'&&!['Resolved','Rejected'].includes(i.status)).slice(0,2).map(i=><button className="attention-item" key={i.id} onClick={()=>setSelected(i)}><span className="attention-dot"/><span><b>{i.title}</b><small>{i.id} · {i.location}</small></span><ArrowRight size={15}/></button>)}{!issues.some(i=>i.priority==='Urgent'&&!['Resolved','Rejected'].includes(i.status))&&<p className="empty-line">No urgent reports at the moment.</p>}</div></div>
       </>}
       {page==='reports'&&<><div className="page-heading"><div><div className="eyebrow">WARD 14 · GREEN PARK</div><h1>Issue reports</h1><p>Check the status of reports submitted from your account.</p></div><button className="primary-button" onClick={()=>setPage('submit')}><FilePlus2 size={17}/> New report</button></div><div className="report-table-card full-table"><div className="list-toolbar"><div className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search reports, location..."/></div><select className="select-control" value={filter} onChange={e=>setFilter(e.target.value)}>{['All reports','Submitted','Under review','Accepted','In progress','Resolved','Rejected','Duplicate'].map(x=><option key={x}>{x}</option>)}</select><button className="filter-button" onClick={()=>{setFilter('All reports');setQuery('')}}><ArrowDownUp size={15}/> Reset</button></div><IssueTable issues={visible} onOpen={setSelected} onAdvance={advance} canManage={canManage}/><div className="table-footer"><span>Showing {visible.length} reports</span><span>Ward 14 · Supabase</span></div></div></>}
       {page==='submit'&&<SubmitPage onCancel={()=>setPage('overview')} onSubmit={submit}/>}
       {page==='ward'&&<><div className="page-heading"><div><div className="eyebrow">PUBLIC ACCOUNTABILITY</div><h1>Ward performance</h1><p>A transparent snapshot of reported civic issues in the pilot ward.</p></div><span className="period-chip">October 2026 <ChevronDown size={14}/></span></div><div className="performance-banner"><div className="banner-mark"><MapPin size={21}/></div><div><b>Ward 14 · Green Park</b><p>Demo ward · service targets are illustrative, not official commitments.</p></div><span className="health-chip"><i/> Tracking normally</span></div><div className="metric-grid performance-metrics"><Metric label="Reports received" value={counts.total} change="This demo period" icon={<FilePlus2/>} tone="green"/><Metric label="Resolved" value={counts.resolved} change={`${counts.total?Math.round(counts.resolved/counts.total*100):0}% of all reports`} icon={<Check/>} tone="blue"/><Metric label="Open reports" value={counts.open} change="Awaiting completion" icon={<Clock3/>} tone="amber"/><Metric label="Urgent open" value={counts.urgent} change="Prioritize for review" icon={<Siren/>} tone="red"/></div><div className="section-row"><div><h2>Report breakdown</h2><p>Counts by category for Ward 14.</p></div></div><div className="panel breakdown">{categories.filter(c=>issues.some(i=>i.category===c)).map(c=>{const n=issues.filter(i=>i.category===c).length;return <div className="breakdown-row" key={c}><span>{c}</span><div className="bar-track"><i style={{width:`${Math.max(8,n/issues.length*100)}%`}}/></div><b>{n}</b></div>})}</div><p className="disclaimer">Demo reporting only. This is not connected to a municipal authority; published summaries use sample data saved in this browser.</p></>}
      </div>
      <footer className="footer"><span>© 2026 CiviFix Community Portal</span><span><i/> Service status: operational <b>·</b> Pilot ward: Green Park</span></footer>
    </main>
    {selected&&<IssueDrawer issue={selected} onClose={()=>setSelected(null)} onAdvance={advance} onUnresolved={markUnresolved} canManage={canManage} userId={userId} onStatusUpdated={(revised) => { update(issues.map(x=>x.id===revised.id?revised:x)); setSelected(revised); notify('Status successfully updated'); }}/>}
    {toast&&<div className="toast"><Check size={17}/>{toast}<button onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}

function Metric({label,value,change,icon,tone}:{label:string;value:string|number;change:string;icon:React.ReactNode;tone:string}){return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className="metric-change">{change}</div></div>}
function Stat({label,value,color}:{label:string;value:number;color:string}){return <div className="stat-line"><i className={color}/><span>{label}</span><b>{value}</b></div>}
function IssueTable({issues,onOpen,onAdvance,canManage}:{issues:Issue[];onOpen:(i:Issue)=>void;onAdvance:(i:Issue)=>void;canManage:boolean}){return <div className="table-scroll"><table><thead><tr><th>REPORT</th><th>CATEGORY</th><th>LOCATION</th><th>STATUS</th><th>PRIORITY</th><th>DEADLINE</th><th/></tr></thead><tbody>{issues.map(i=><tr key={i.id} onClick={()=>onOpen(i)}><td><div className="report-cell"><span className={`category-thumb ${i.category==='Garbage'?'thumb-garbage':i.category==='Drainage'?'thumb-drain':i.category==='Streetlight'?'thumb-light':''}`}>{i.category==='Garbage'?'♻':i.category==='Drainage'?'≈':i.category==='Streetlight'?'☼':'⌁'}</span><span><b>{i.title}</b><small>{i.id} · {shortDate(i.createdAt)}</small></span></div></td><td>{i.category}</td><td><span className="location-cell"><MapPin size={13}/>{i.location}</span></td><td><StatusBadge status={i.status}/></td><td><span className={`priority ${i.priority.toLowerCase()}`}><i/>{i.priority}</span></td><td><span className="deadline">{shortDate(i.dueAt)}</span></td><td><button className="row-action" disabled={!canManage} onClick={e=>{e.stopPropagation();onAdvance(i)}} title={canManage?"Advance status":"Staff access required"}><ArrowRight size={15}/></button></td></tr>)}</tbody></table>{issues.length===0&&<div className="empty-state"><Search size={23}/><b>No matching reports</b><span>Try changing your search or filter.</span></div>}</div>}

// Helper component for the Leaflet map click events
function LocationMarker({ position, setPosition, setLocationString }: { position: L.LatLng | null, setPosition: (p: L.LatLng) => void, setLocationString: (s: string) => void }) {
  const map = useMapEvents({
    click(e) {
      setPosition(e.latlng);
      const w = resolveWard(e.latlng.lat, e.latlng.lng);
      setLocationString(w.ward === 'Outside pilot area' ? 'Outside the current demo ward' : `${w.ward} · Pinned on map`);
      map.flyTo(e.latlng, map.getZoom());
    },
  });
  return position === null ? null : <Marker position={position}></Marker>;
}

function SubmitPage({onCancel,onSubmit}:{onCancel:()=>void;onSubmit:(form:HTMLFormElement)=>void}) {
  const [location,setLocation]=useState('');
  const [coords,setCoords]=useState('');
  const [photo,setPhoto]=useState('');
  const [locError,setLocError]=useState('');
  const [mapPosition, setMapPosition] = useState<L.LatLng | null>(null);
  
  // AI States
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<{text: string, type: 'success' | 'error' | 'info'} | null>(null);

  const locate=()=>{
    if(!navigator.geolocation){
      setLocError('Location is not supported. Tap on the map instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(p=>{
      const lat=p.coords.latitude,lon=p.coords.longitude;
      setCoords(`${lat},${lon}`);
      setMapPosition(new L.LatLng(lat, lon));
      const w=resolveWard(lat,lon);
      setLocation(w.ward==='Outside pilot area'?'Outside the current demo ward':`${w.ward} · GPS location`);
      setLocError('');
    },()=>setLocError('Location denied. Please tap on the map to place a pin.'),{enableHighAccuracy:true,timeout:8000})
  };

  useEffect(() => {
    if (mapPosition) setCoords(`${mapPosition.lat},${mapPosition.lng}`);
  }, [mapPosition]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhoto(file?.name || '');
    if (!file) return;

    setAiLoading(true);
    setAiMessage({ text: 'AI is scanning your image...', type: 'info' });

    try {
      const analysis = await analyzeImage(file);
      if (!analysis.isValid) {
        setAiMessage({ text: `Invalid image: ${analysis.reason}`, type: 'error' });
        e.target.value = ''; // clear the file
        setPhoto('');
      } else {
        setSelectedCategory(analysis.category || 'Other');
        setAiMessage({ text: `AI categorized this as: ${analysis.category}`, type: 'success' });
      }
    } catch (err) {
      setAiMessage({ text: 'AI scan failed. Please select category manually.', type: 'error' });
    } finally {
      setAiLoading(false);
    }
  };

  return <><div className="page-heading"><div><div className="eyebrow">CITIZEN REPORTING</div><h1>Report a community issue</h1><p>Share enough detail so the ward team can review and route your report.</p></div><button className="secondary-button" onClick={onCancel}>Cancel</button></div>
  <form className="form-layout" onSubmit={e=>{e.preventDefault();onSubmit(e.currentTarget)}}>
    <div className="panel form-panel"><div className="form-section-title"><span>01</span><div><h3>Issue details</h3><p>Describe what needs attention.</p></div></div>
      
      <div className="field-label" style={{ marginBottom: '20px' }}>Photo <span className="optional">Optional · JPG, PNG, WebP up to 5 MB</span>
        <label className="upload-box" style={{ borderColor: aiMessage?.type === 'error' ? 'red' : '' }}>
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoUpload}/>
          <span className="upload-icon"><FilePlus2 size={20}/></span>
          <b>{aiLoading ? 'Scanning image...' : photo || 'Add a photo of the issue'}</b>
          <small>JPG, PNG, or WebP · Max 5 MB</small>
        </label>
        {aiMessage && <p className="field-hint" style={{ color: aiMessage.type === 'error' ? '#d93025' : aiMessage.type === 'success' ? '#188038' : '#1a73e8', marginTop: '8px', fontWeight: 500 }}>{aiMessage.text}</p>}
      </div>

      <label className="field-label">Issue title <em>Required</em><input name="title" required maxLength={90} placeholder="e.g. Large pothole near the bus stop"/></label>
      <label className="field-label">Category <em>Required</em>
        <select name="category" required value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value)}>
          <option value="" disabled>Select issue category</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="field-label">Description <em>Required</em><textarea name="description" required rows={4} maxLength={600} placeholder="Explain what you noticed, how long it has been there, or why it needs attention."/></label>
    </div>
    
    <div className="panel form-panel"><div className="form-section-title"><span>02</span><div><h3>Where is it?</h3><p>Tap the map to place a pin.</p></div></div>
      <div style={{ height: '250px', width: '100%', marginBottom: '16px', borderRadius: '8px', overflow: 'hidden', zIndex: 0, border: '1px solid #ddd' }}>
        <MapContainer center={[12.9716, 77.5946]} zoom={13} style={{ height: '100%', width: '100%', zIndex: 0 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <LocationMarker position={mapPosition} setPosition={setMapPosition} setLocationString={setLocation} />
        </MapContainer>
      </div>
      <div className="location-callout"><span><MapPin size={19}/></span><div><b>Tap the map to set a pin</b><small>Or let your device find you.</small></div><button type="button" className="outline-small" onClick={locate}>Use GPS</button></div>
      {coords&&<input type="hidden" name="latitude" value={coords.split(',')[0]} />}
      {coords&&<input type="hidden" name="longitude" value={coords.split(',')[1]} />}
      <label className="field-label">Street or Landmark Details <em>Required</em><input name="location" required value={location} onChange={e=>setLocation(e.target.value)} placeholder="E.g. Opposite the metro station"/></label>
      {locError&&<p className="field-hint warning-text">{locError}</p>}
      <div className="ward-preview"><span className="ward-preview-icon"><MapPin size={16}/></span><span><b>Likely destination</b><small>{coords?resolveWard(Number(coords.split(',')[0]),Number(coords.split(',')[1])).ward:'Ward 14 · Green Park (demo)'}</small></span><span className="auto-label">AUTO</span></div><label className="urgent-toggle"><input name="urgent" type="checkbox"/><span><b>This is an urgent safety concern</b><small>For immediate danger, contact local emergency services directly.</small></span></label><div className="privacy-note"><ShieldCheck size={16}/><span>Your report is part of a demonstration. Avoid personal details; this app is not connected to a real ward office.</span></div>
    </div>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={aiLoading}>Submit report <ArrowRight size={16}/></button></div>
  </form></>}

function IssueDrawer({issue,onClose,onAdvance,onUnresolved,canManage,userId,onStatusUpdated}:{issue:Issue;onClose:()=>void;onAdvance:(i:Issue)=>void;onUnresolved:(i:Issue)=>void;canManage:boolean;userId:string;onStatusUpdated:(i:Issue)=>void}){return <><button className="drawer-scrim" onClick={onClose} aria-label="Close report details"/><aside className="drawer"><div className="drawer-head"><span className="eyebrow">REPORT DETAILS</span><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="drawer-image">{issue.photo?<img src={issue.photo} alt="Uploaded issue"/>:<span>{issue.category==='Garbage'?'♻':issue.category==='Drainage'?'≈':issue.category==='Streetlight'?'☼':'⌁'}</span>}<div className="image-tag">{issue.category}</div></div><div className="drawer-content"><div className="drawer-id">{issue.id} <span>·</span> {shortDate(issue.createdAt)}</div><h2>{issue.title}</h2><div className="drawer-badges"><StatusBadge status={issue.status}/><span className={`priority ${issue.priority.toLowerCase()}`}><i/>{issue.priority}</span></div><p className="drawer-description">{issue.description}</p><div className="detail-line"><MapPin size={16}/><span><b>{issue.location}</b><small>{issue.ward}</small></span></div><div className="detail-line"><Users size={16}/><span><b>{issue.department}</b><small>Assigned department</small></span></div><div className="due-card"><Clock3 size={17}/><span><b>Target date</b><small>{shortDate(issue.dueAt)} · illustrative demo target</small></span></div><h3 className="timeline-title">Activity timeline</h3><div className="timeline">{[...issue.updates].reverse().map((u,i)=><div className="timeline-item" key={u.at+u.text}><i className={i===0?'current':''}/><span><b>{u.text}</b><small>{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(u.at))}</small></span></div>)}</div>{canManage && <SupervisorControls issue={issue} actorId={userId} onStatusUpdated={onStatusUpdated} />}{!canManage&&issue.status==='Resolved'&&<button className="secondary-button unresolved-button" onClick={()=>onUnresolved(issue)}>Still unresolved? Request review</button>}<p className="demo-note">CiviFix · Status and timeline updates are saved to Supabase.</p></div></aside></>}