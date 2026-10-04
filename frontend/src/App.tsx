import { LazyMotion } from 'motion/react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { AuthLayout } from './features/auth/components/AuthLayout'
import { RedirectIfAuthed, RequireAuth } from './features/auth/RouteGuards'
import { CaughtPage } from './pages/CaughtPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { ProfileProvider } from './features/profile/ProfileProvider'
import { ScenarioPage } from './pages/ScenarioPage'
import { SignupPage } from './pages/SignupPage'
import { loadMotionFeatures } from './lib/motion'

function App() {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
    <AuthProvider>
      {/* Synchronous route updates let a View Transition capture the new screen (see lib/viewTransition). */}
      <ProfileProvider><BrowserRouter useTransitions={false}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<AuthLayout />}><Route path="/onboarding" element={<OnboardingPage />} /></Route>
            <Route path="/home" element={<HomePage />} />
            <Route path="/train/:scenarioId" element={<ScenarioPage />} />
          </Route>
          <Route element={<RedirectIfAuthed />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>
          </Route>
          {/* Public: tracked practice links land here, signed in or not. */}
          <Route path="/caught" element={<CaughtPage />} />
          {/* `/` and unknown paths go home; RequireAuth sends logged-out visitors on to /login. */}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter></ProfileProvider>
    </AuthProvider>
    </LazyMotion>
  )
}

export default App
