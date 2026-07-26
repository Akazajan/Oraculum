import { Injectable } from '@nestjs/common';
import * as moment from 'moment-timezone';

@Injectable()
export class TimezoneSlotGenerator {
  generateSlots(startDate: Date, endDate: Date, timezone: string) {
    const slots = [];
    const start = moment(startDate).tz(timezone);
    const end = moment(endDate).tz(timezone);
    
    while (start.isBefore(end)) {
      slots.push({ time: start.toDate(), tz: timezone });
      start.add(30, 'minutes');
    }
    return slots;
  }
}
