/**
 * Role type - matches Prisma enum values
 */
export type Role = 'SUPERADMIN' | 'ADMIN' | 'HOD' | 'LEAD' | 'ASSOCIATE';

/**
 * JWT Payload Interface
 * Defines the structure of data stored in JWT tokens
 */
export interface JwtPayload {
  sub: string; // User ID
  email: string;
  role: Role;
  iat?: number; // Issued at
  exp?: number; // Expiration time
}

/**
 * User from JWT
 * Type for user object extracted from JWT and attached to request
 */
export interface UserFromJwt {
  id: string;
  email: string;
  role: Role;
}
