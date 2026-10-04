export interface OnboardingValues { name: string; phone: string; profession: string; interests: string }
export function validateOnboarding(values: OnboardingValues) {
  const errors: Partial<Record<keyof OnboardingValues, string>> = {}
  if (!values.name.trim() || values.name.trim().length > 100) errors.name = 'Enter a name between 1 and 100 characters.'
  const phone = values.phone.replace(/[\s().-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) errors.phone = 'Include your country code, for example +1 604 555 1234.'
  if (values.profession.trim().length > 200) errors.profession = 'Use at most 200 characters.'
  const interests = values.interests.split(',').map((value) => value.trim()).filter(Boolean)
  if (interests.length > 30 || interests.some((value) => value.length > 100)) errors.interests = 'Enter up to 30 interests, each under 100 characters.'
  return errors
}
