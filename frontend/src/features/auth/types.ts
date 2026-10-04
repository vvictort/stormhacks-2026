export interface UserProfile {
  id: string
  uid: string
  email: string
  emailVerified: boolean
  name: string | null
  phone: string | null
  profession: string | null
  interests: string[]
  onboardingComplete: boolean
  createdAt: string
  updatedAt: string
}
export interface ProfileInput {
  name: string
  phone: string
  profession: string | null
  interests: string[]
}
