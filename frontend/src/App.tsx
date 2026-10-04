import { LazyMotion, MotionConfig } from 'motion/react'
import { Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { AuthLayout } from './features/auth/components/AuthLayout'
import {
  RedirectIfAuthed,
  RequireAuth,
  SessionLoading,
} from './features/auth/RouteGuards'
import { ProfileProvider } from './features/profile/ProfileProvider'
import { lazyPage, preloadPages } from './lib/lazyPage'
import { loadMotionFeatures } from './lib/motion'

// Each page is its own chunk; the one on screen loads first, the rest right after the first render.
const HomePage = lazyPage(() =>
  import('./pages/HomePage').then((m) => m.HomePage),
)
const ScenarioPage = lazyPage(() =>
  import('./pages/ScenarioPage').then((m) => m.ScenarioPage),
)
const OnboardingPage = lazyPage(() =>
  import('./pages/OnboardingPage').then((m) => m.OnboardingPage),
)
const LoginPage = lazyPage(() =>
  import('./pages/LoginPage').then((m) => m.LoginPage),
)
const SignupPage = lazyPage(() =>
  import('./pages/SignupPage').then((m) => m.SignupPage),
)
const CaughtPage = lazyPage(() =>
  import('./pages/CaughtPage').then((m) => m.CaughtPage),
)

function App() {
  useEffect(() => {
    preloadPages().catch(() => {})
  }, [])

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      {/* Reduced motion: Motion drops transform animations (slides, pops) and keeps fades. */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          {/* Synchronous route updates let a View Transition capture the new screen (see lib/viewTransition). */}
          <ProfileProvider>
            <BrowserRouter useTransitions={false}>
              <Suspense fallback={<SessionLoading />}>
                <Routes>
                  <Route element={<RequireAuth />}>
                    <Route element={<AuthLayout />}>
                      <Route path="/onboarding" element={<OnboardingPage />} />
                    </Route>
                    <Route path="/home" element={<HomePage />} />
                    <Route
                      path="/train/:scenarioId"
                      element={<ScenarioPage />}
                    />
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
              </Suspense>
            </BrowserRouter>
          </ProfileProvider>
        </AuthProvider>
      </MotionConfig>
    </LazyMotion>
  )
}

export default App
