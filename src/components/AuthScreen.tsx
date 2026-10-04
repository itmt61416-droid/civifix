import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin'|'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const supabase = getSupabaseClient();
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (signUpError) throw signUpError;
        if (!data.session) setMessage('Account created. Check your email to confirm it, then sign in.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-visual">
      <a className="brand auth-brand" href="#"><span className="brand-mark">c</span><span><b>civifix</b><small>COMMUNITY PORTAL</small></span></a>
      <div className="auth-message"><span className="auth-kicker"><i/> YOUR COMMUNITY, MOVING FORWARD</span><h1>Small actions.<br/><em>Better neighborhoods.</em></h1><p>Report local issues, follow their progress, and help make your ward a better place to live.</p><div className="auth-stats"><div><b>01</b><span>Report what<br/>needs attention</span></div><i/><div><b>02</b><span>Follow every<br/>status update</span></div><i/><div><b>03</b><span>See progress<br/>in your ward</span></div></div></div>
      <div className="auth-footer"><ShieldCheck size={15}/> A community reporting prototype for Ward 14 · Green Park</div>
    </section>
    <section className="auth-form-side"><div className="auth-card"><div className="auth-overline">CIVIFIX ACCOUNT</div><h2>{mode==='signin'?'Welcome back':'Join your community'}</h2><p className="auth-subtitle">{mode==='signin'?'Sign in to continue to the community portal.':'Create an account to report and follow local issues.'}</p>
      <div className="auth-tabs"><button className={mode==='signin'?'selected':''} onClick={()=>{setMode('signin');setError('');setMessage('')}} type="button">Sign in</button><button className={mode==='signup'?'selected':''} onClick={()=>{setMode('signup');setError('');setMessage('')}} type="button">Create account</button></div>
      <form onSubmit={handleSubmit} className="auth-fields">{mode==='signup'&&<label>Your name<input autoComplete="name" required value={name} onChange={e=>setName(e.target.value)} placeholder="Enter your name"/></label>}<label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<span className="password-wrap"><input type={showPassword?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></span></label>{error&&<div className="auth-alert error">{error}</div>}{message&&<div className="auth-alert success">{message}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy?'Please wait…':mode==='signin'?'Sign in':'Create account'} {!busy&&<ArrowRight size={16}/>}</button></form>
      <div className="auth-privacy"><ShieldCheck size={15}/><span>Your account manages your own reports. Never share your password.</span></div>
    </div><p className="auth-demo-note">CiviFix is a prototype and is not connected to a municipal office.</p></section>
  </main>;
}
