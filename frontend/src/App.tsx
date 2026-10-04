import { LazyMotion } from 'motion/react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { AuthLayout } from './features/auth/components/AuthLayout'
import { RedirectIfAuthed, RequireAuth } from './features/auth/RouteGuards'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { ScenarioPage } from './pages/ScenarioPage'
import { SignupPage } from './pages/SignupPage'
import { loadMotionFeatures } from './lib/motion'

function App() {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
    <AuthProvider>
      {/* Synchronous route updates let a View Transition capture the new screen (see lib/viewTransition). */}
      <BrowserRouter useTransitions={false}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/train/:scenarioId" element={<ScenarioPage />} />
          </Route>
          <Route element={<RedirectIfAuthed />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>
          </Route>
          {/* `/` and unknown paths go home; RequireAuth sends logged-out visitors on to /login. */}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </LazyMotion>
  )
}

export default App
