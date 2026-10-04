import { z } from "zod";

export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .max(40)
      .transform((value) => value.replace(/[\s().-]/g, ""))
      .pipe(
        z
          .string()
          .regex(
            /^\+[1-9]\d{7,14}$/,
            "Include a country code, for example +16045551234.",
          ),
      ),
    profession: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .default(null)
      .transform((value) => value || null),
    interests: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileSchema>;

export interface User {
  id: string;
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  phone: string | null;
  profession: string | null;
  interests: string[];
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}
