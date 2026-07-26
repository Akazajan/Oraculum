import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { CreateWorkspaceDto } from '../dto/create-workspace.dto';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';

@Injectable()
export class CreateWorkspaceProvider {
  private readonly logger = new Logger(CreateWorkspaceProvider.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly cacheInvalidation: CacheInvalidationProvider,
  ) {}

  async create(dto: CreateWorkspaceDto): Promise<Workspace> {
    const existing = await this.workspacesRepository.findOne({
      where: { name: dto.name, isActive: true },
    });
    if (existing) {
      throw new ConflictException(
        `A workspace named "${dto.name}" already exists`,
      );
    }

    const workspace = this.workspacesRepository.create({
      ...dto,
      availableSeats: dto.totalSeats,
    });
    const saved = await this.workspacesRepository.save(workspace);

    this.cacheInvalidation
      .invalidateWorkspaceList()
      .catch(() => this.logger.warn('Failed to invalidate workspace cache'));

    return saved;
  }
}
