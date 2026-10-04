import { Check, Circle, X } from 'lucide-react'
import { passwordChecks } from '../validation'

// Live password rules. After a failed submit, unmet rules turn into errors.
// How each rule is shown, and what a screen reader adds after its label.
const marks = {
  met: { Icon: Check, spoken: ', done' },
  unmet: { Icon: X, spoken: ', not met yet' },
  pending: { Icon: Circle, spoken: '' },
}

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
        let state: keyof typeof marks = 'pending'
        if (check.met) state = 'met'
        else if (showErrors) state = 'unmet'
        const { Icon, spoken } = marks[state]
        return (
          <li key={check.id} data-state={state}>
            <Icon
              key={state}
              size={15}
              strokeWidth={state === 'pending' ? 2 : 2.75}
              aria-hidden="true"
            />
            {check.label}
            <span className="sr-only">{spoken}</span>
          </li>
        )
      })}
    </ul>
  )
}
