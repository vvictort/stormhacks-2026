import { Check, Circle, X } from 'lucide-react'
import { passwordChecks } from '../validation'

// Live password rules. After a failed submit, unmet rules turn into errors.
export function PasswordChecklist({
  id,
  password,
  confirmPassword,
  showErrors,
}: {
  id: string
  password: string
  confirmPassword: string
  showErrors: boolean
}) {
  return (
    <ul
      id={id}
      className="password-checklist"
      aria-label="Password requirements"
      aria-live="polite"
    >
      {passwordChecks(password, confirmPassword).map((check) => {
        const state = check.met ? 'met' : showErrors ? 'unmet' : 'pending'
        const Icon = state === 'met' ? Check : state === 'unmet' ? X : Circle
        return (
          <li key={check.id} data-state={state}>
            <Icon
              key={state}
              size={15}
              strokeWidth={state === 'pending' ? 2 : 2.75}
              aria-hidden="true"
            />
            {check.label}
            <span className="sr-only">
              {state === 'met'
                ? ', done'
                : state === 'unmet'
                  ? ', not met yet'
                  : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
