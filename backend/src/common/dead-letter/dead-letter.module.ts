import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadLetterJob } from '../entities/dead-letter-job.entity';
import { DeadLetterProvider } from '../providers/dead-letter.provider';
import { DeadLetterService } from './dead-letter.service';
import { DeadLetterController } from './dead-letter.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeadLetterJob])],
  controllers: [DeadLetterController],
  providers: [DeadLetterProvider, DeadLetterService],
  exports: [DeadLetterService, DeadLetterProvider],
})
export class DeadLetterModule {}
