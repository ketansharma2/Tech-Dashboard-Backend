import { Prisma } from '@prisma/client';

/**
 * Canonical column set returned to clients for a user. Deliberately excludes
 * passwordHash and refresh tokens. Shared by the query and action services so
 * every user payload has an identical, safe shape.
 */
export const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  profileImage: true,
  department: true,
  jobTitle: true,
  phone: true,
  location: true,
  managerId: true,
  createdAt: true,
  updatedAt: true,
  manager: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} satisfies Prisma.UserSelect;

export type SanitizedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
