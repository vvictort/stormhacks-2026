import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import type { ProfileInput, User } from "./users.schema.ts";

function mapUser(row: QueryResultRow): User {
  return {
    id: row.id,
    uid: row.firebase_uid,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    phone: row.phone,
    profession: row.profession,
    interests: row.interests,
    onboardingComplete: Boolean(row.onboarding_completed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class UsersRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async ensureUser(identity: DecodedIdToken) {
    if (!identity.email) {
      throw new AppError(401, "INVALID_TOKEN", "An account email is required.");
    }
    const name =
      typeof identity.name === "string"
        ? identity.name.trim().slice(0, 100) || null
        : null;
    const { rows } = await this.db.query(
      `INSERT INTO user_profiles(id,firebase_uid,email,email_verified,name)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(firebase_uid) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,
      name=COALESCE(user_profiles.name,EXCLUDED.name) RETURNING *`,
      [
        randomUUID(),
        identity.uid,
        identity.email,
        identity.email_verified ?? false,
        name,
      ],
    );
    return mapUser(rows[0]);
  }

  async updateProfile(identity: DecodedIdToken, profile: ProfileInput) {
    if (!identity.email) {
      throw new AppError(401, "INVALID_TOKEN", "An account email is required.");
    }
    const { rows } = await this.db.query(
      `INSERT INTO user_profiles(id,firebase_uid,email,email_verified,name,phone,profession,interests,onboarding_completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(firebase_uid) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,
      name=EXCLUDED.name,phone=EXCLUDED.phone,profession=EXCLUDED.profession,interests=EXCLUDED.interests,
      onboarding_completed_at=COALESCE(user_profiles.onboarding_completed_at,now()),updated_at=now() RETURNING *`,
      [
        randomUUID(),
        identity.uid,
        identity.email,
        identity.email_verified ?? false,
        profile.name,
        profile.phone,
        profile.profession,
        profile.interests,
      ],
    );
    return mapUser(rows[0]);
  }
}
