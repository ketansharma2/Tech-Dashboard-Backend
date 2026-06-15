import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleTaskCompleteDto {
  @ApiProperty({ description: 'Completion status' })
  @IsBoolean()
  isCompleted: boolean;
}

export class ToggleTaskImportantDto {
  @ApiProperty({ description: 'Important status' })
  @IsBoolean()
  isImportant: boolean;
}

export class ToggleTaskMyDayDto {
  @ApiProperty({ description: 'My Day status' })
  @IsBoolean()
  isMyDay: boolean;
}

export class AssignTaskDto {
  @ApiProperty({ description: 'Assignee user ID (null to unassign)' })
  assigneeId: string | null;
}
