import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleQueryDto } from '../dto/role-query.dto';

@Injectable()
export class RoleQueryService {
  constructor(private prisma: PrismaService) {}

  async query(dto: RoleQueryDto) {
    if (dto.roleId) return this.findOne(dto.roleId, dto.includeUsers);
    return this.findMany(dto);
  }

  private async findOne(id: string, includeUsers?: boolean) {
    const role = await this.prisma.appRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: {
              select: { key: true, module: true, action: true, label: true },
            },
          },
        },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');

    const users = includeUsers
      ? await this.prisma.user.findMany({
          where: { roleId: id },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            isActive: true,
            profileImage: true,
          },
          orderBy: [{ firstName: 'asc' }],
          take: 500,
        })
      : undefined;

    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      userCount: role._count.users,
      permissionKeys: role.permissions.map((rp) => rp.permission.key),
      permissions: role.permissions.map((rp) => rp.permission),
      users,
    };
  }

  private async findMany(dto: RoleQueryDto) {
    const { search, isActive, isSystem, sortBy = 'name', sortOrder = 'asc', page = 1, limit = 20 } = dto;

    const where: Prisma.AppRoleWhereInput = {};
    if (typeof isActive === 'boolean') where.isActive = isActive;
    if (typeof isSystem === 'boolean') where.isSystem = isSystem;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.AppRoleOrderByWithRelationInput =
      sortBy === 'createdAt'
        ? { createdAt: sortOrder }
        : sortBy === 'updatedAt'
          ? { updatedAt: sortOrder }
          : { name: sortOrder };

    const [rows, total] = await Promise.all([
      this.prisma.appRole.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { users: true, permissions: true } } },
      }),
      this.prisma.appRole.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystem: r.isSystem,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        userCount: r._count.users,
        permissionCount: r._count.permissions,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
