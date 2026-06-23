import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionResolverService } from '../../authz/permission-resolver.service';
import { AssistantQueryDto } from '../dto/assistant-query.dto';

const ASSISTANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  isActive: true,
  profileImage: true,
  lastActiveAt: true,
  createdAt: true,
  principalId: true,
  principal: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class AssistantQueryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private resolver: PermissionResolverService,
  ) {}

  async query(dto: AssistantQueryDto, actorId: string, actorRole: Role) {
    if (dto.assistantId) return this.findOne(dto, actorId, actorRole);
    return this.findMany(dto, actorId, actorRole);
  }

  private async findMany(dto: AssistantQueryDto, actorId: string, actorRole: Role) {
    const { search, isActive, page = 1, limit = 20 } = dto;

    // Assistants are users with a principal. Non-superadmins only see their own.
    const filters: Prisma.UserWhereInput[] = [{ principalId: { not: null } }];
    if (actorRole === 'SUPERADMIN') {
      if (dto.principalId) filters.push({ principalId: dto.principalId });
    } else {
      filters.push({ principalId: actorId });
    }
    if (typeof isActive === 'boolean') filters.push({ isActive });
    if (search) {
      filters.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.UserWhereInput = { AND: filters };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { ...ASSISTANT_SELECT, _count: { select: { permissionOverrides: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        grantedPermissionCount: r._count.permissionOverrides,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  private async findOne(dto: AssistantQueryDto, actorId: string, actorRole: Role) {
    const assistant = await this.prisma.user.findFirst({
      where: { id: dto.assistantId, principalId: { not: null } },
      select: ASSISTANT_SELECT,
    });
    if (!assistant) throw new NotFoundException('Assistant not found');

    if (actorRole !== 'SUPERADMIN' && assistant.principalId !== actorId) {
      throw new ForbiddenException('This assistant does not belong to you');
    }

    const grants = await this.prisma.userPermissionOverride.findMany({
      where: { userId: assistant.id, effect: 'GRANT' },
      select: { permission: { select: { key: true } } },
    });

    const [effective, principalPermissions] = await Promise.all([
      this.resolver.getEffectivePermissionList(assistant.id),
      this.resolver.getEffectivePermissionList(assistant.principalId!),
    ]);

    const [loginHistory, activity] = await Promise.all([
      dto.includeLoginHistory ? this.audit.listLoginHistory(assistant.id) : Promise.resolve(undefined),
      dto.includeActivity ? this.audit.listByActor(assistant.id) : Promise.resolve(undefined),
    ]);

    return {
      data: assistant,
      grantedPermissions: grants.map((g) => g.permission.key),
      effectivePermissions: effective,
      principalPermissions,
      loginHistory,
      activity,
    };
  }
}
