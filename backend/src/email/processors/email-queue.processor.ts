import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EmailService } from '../email.service';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';

@Processor('email')
export class EmailQueueProcessor {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private readonly emailService: EmailService) {}

  @Process('send-email')
  async handleSendEmail(
    job: Job<{
      to: string;
      subject: string;
      html: string;
      attachments?: Array<{
        filename: string;
        content: string;
        contentType: string;
      }>;
    }>,
  ) {
    this.logger.log(`Processing email job ${job.id}: ${job.data.subject}`);
    try {
      const result = await (this.emailService as any).send(
        job.data.to,
        job.data.subject,
        job.data.html,
        job.data.attachments,
      );
      await job.progress(100);
      return { success: result, jobId: job.id };
    } catch (error) {
      this.logger.error(
        `Email job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  @Process('send-template-email')
  async handleSendTemplateEmail(
    job: Job<{
      to: string;
      subject: string;
      templateName: string;
      placeholders: Record<string, unknown>;
    }>,
  ) {
    this.logger.log(
      `Processing template email job ${job.id}: ${job.data.templateName}`,
    );
    try {
      const templatePath = path.join(
        __dirname,
        '..',
        'templates',
        `${job.data.templateName}.hbs`,
      );
      const source = fs.readFileSync(templatePath, 'utf8');
      const template = handlebars.compile(source);
      const html = template(job.data.placeholders);

      const result = await (this.emailService as any).send(
        job.data.to,
        job.data.subject,
        html,
      );
      await job.progress(100);
      return { success: result, jobId: job.id };
    } catch (error) {
      this.logger.error(
        `Template email job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
