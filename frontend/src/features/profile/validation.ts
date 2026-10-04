export interface OnboardingValues {
  name: string
  countryCode: string
  phone: string
  profession: string
  interests: string
}

/**
 * Joins the two phone boxes into E.164 (+16045551234), or null when they can't
 * make a valid number.
 */
export function toE164(countryCode: string, phone: string) {
  // A number pasted with its own "+" already carries a country code.
  if (phone.trim().startsWith('+')) return valid('+' + phone.replace(/\D/g, ''))

  const code = countryCode.replace(/\D/g, '')
  // ponytail: drops a leading trunk 0 (UK 07700… → 7700…); Italy keeps it, add per-country rules if needed
  const digits = phone.replace(/\D/g, '')
  const number = code === '39' ? digits : digits.replace(/^0/, '')
  return code ? valid(`+${code}${number}`) : null
}

const valid = (e164: string) => (/^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null)

/**
 * Splits a stored E.164 number back into the two boxes; only +1 is split, other
 * codes stay whole in the number box.
 */
export function splitPhone(e164: string | null | undefined) {
  if (!e164) return { countryCode: '+1', phone: '' }
  return e164.startsWith('+1')
    ? { countryCode: '+1', phone: e164.slice(2) }
    : { countryCode: '', phone: e164 }
}

export function validateOnboarding(values: OnboardingValues) {
  const errors: Partial<Record<keyof OnboardingValues, string>> = {}
  if (!values.name.trim() || values.name.trim().length > 100) {
    errors.name = 'Enter a name between 1 and 100 characters.'
  }
  if (
    !values.phone.trim().startsWith('+') &&
    !/^\+?[1-9]\d{0,2}$/.test(values.countryCode.trim())
  ) {
    errors.countryCode = 'Enter a code like +1.'
  } else if (!toE164(values.countryCode, values.phone)) {
    errors.phone = 'Enter a valid phone number, for example 604 555 1234.'
  }
  if (values.profession.trim().length > 200) {
    errors.profession = 'Use at most 200 characters.'
  }

  const interests = values.interests
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (interests.length > 30 || interests.some((value) => value.length > 100)) {
    errors.interests = 'Enter up to 30 interests, each under 100 characters.'
  }

  return errors
}
