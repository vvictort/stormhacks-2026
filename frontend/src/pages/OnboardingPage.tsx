import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'
import { useProfile } from '../features/profile/ProfileContext'
import { AuthCard } from '../features/auth/components/AuthCard'
import { AuthField } from '../features/auth/components/AuthField'
import { AuthNotice } from '../features/auth/components/AuthNotice'
import { splitPhone, toE164, validateOnboarding, type OnboardingValues } from '../features/profile/validation'

export function OnboardingPage() {
  const { user, logout, pending, error: authError } = useAuth()
  const { profile, save } = useProfile()
  const navigate = useNavigate()
  const [values, setValues] = useState<OnboardingValues>({ name: profile?.name || user?.displayName || '', ...splitPhone(profile?.phone), profession: profile?.profession || '', interests: profile?.interests.join(', ') || '' })
  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingValues, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  function change(field: keyof OnboardingValues, value: string) { setValues((previous) => ({ ...previous, [field]: value })); setErrors((previous) => ({ ...previous, [field]: undefined })); setError(null) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || pending) return
    const next = validateOnboarding(values)
    setErrors(next)
    if (Object.keys(next).length) { form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(next)[0]}"]`)?.focus(); return }
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await save({ name: values.name.trim(), phone: toE164(values.countryCode, values.phone)!, profession: values.profession.trim() || null, interests: values.interests.split(',').map((part) => part.trim()).filter(Boolean) })
      navigate('/home', { replace: true })
    } catch { setError('We couldn’t save your profile. Your entries are still here—please try again.') }
    finally { busy.current = false; setSaving(false) }
  }
  const disabled = saving || Boolean(pending)
  return <AuthCard title={profile?.onboardingComplete ? 'Your personal profile' : 'Make practice personal'} description="A few details help us build scenarios that feel relevant to your everyday life.">
    <p className="onboarding-step text-muted-strong">{profile?.onboardingComplete ? 'EDIT PROFILE' : 'STEP 2 OF 2 · PERSONAL DETAILS'}</p>
    <form ref={form} onSubmit={submit} noValidate aria-busy={saving}>
      <fieldset className="auth-fields" disabled={disabled}><legend className="sr-only">Personal profile</legend>
        <AuthField id="profile-name" name="name" label="Your name" autoComplete="name" maxLength={100} value={values.name} required error={errors.name} onChange={(event) => change('name', event.target.value)} />
        <AuthField id="profile-email" label="Account email" type="email" value={profile?.email || user?.email || ''} readOnly hint="Managed by your login account." />
        <div className="phone-fields">
          <AuthField id="profile-country-code" name="countryCode" label="Code" type="tel" autoComplete="tel-country-code" maxLength={4} placeholder="+1" value={values.countryCode} required error={errors.countryCode} onChange={(event) => change('countryCode', event.target.value)} />
          <AuthField id="profile-phone" name="phone" label="Phone number" type="tel" autoComplete="tel-national" maxLength={40} placeholder="604 555 1234" value={values.phone} required error={errors.phone} onChange={(event) => change('phone', event.target.value)} />
        </div>
        <AuthField id="profile-profession" name="profession" label="Profession (optional)" maxLength={200} placeholder="Student, designer, nurse…" value={values.profession} error={errors.profession} onChange={(event) => change('profession', event.target.value)} />
        <AuthField id="profile-interests" name="interests" label="Interests (optional)" placeholder="Gaming, shopping, travel" hint="Separate interests with commas." value={values.interests} error={errors.interests} onChange={(event) => change('interests', event.target.value)} />
      </fieldset>
      {error && <AuthNotice>{error}</AuthNotice>}
      {authError && <AuthNotice>{authError}</AuthNotice>}
      <button type="submit" className="primary-button" disabled={disabled}>{saving ? <><LoaderCircle size={18} className="spinner" />Saving profile…</> : <>{profile?.onboardingComplete ? 'Save changes' : 'Save & continue'}<ArrowRight size={18} /></>}</button>
    </form>
    <button type="button" className="onboarding-signout text-link" disabled={disabled} onClick={() => void logout()}><LogOut size={14} />Sign out</button>
  </AuthCard>
}
