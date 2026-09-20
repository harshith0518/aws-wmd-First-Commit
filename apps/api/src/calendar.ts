import { Temporal } from '@js-temporal/polyfill';
import { calendarSchema, type BusinessCalendar } from '@campusfix/contracts';
import { ApiError } from './errors.js';
const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export function workingDeadline(
  start: string,
  workingDays: number,
  input: BusinessCalendar,
): string {
  const calendar = calendarSchema.parse(input);
  const open = Temporal.PlainTime.from(calendar.opensAt),
    close = Temporal.PlainTime.from(calendar.closesAt);
  let remaining = (close.hour * 60 + close.minute - open.hour * 60 - open.minute) * workingDays;
  let instant = Temporal.Instant.from(start);
  let date = instant.toZonedDateTimeISO(calendar.timezone).toPlainDate();
  for (let examined = 0; examined < 1000; examined++, date = date.add({ days: 1 })) {
    if (
      !calendar.workingDays.includes(
        weekdays[date.dayOfWeek - 1] as BusinessCalendar['workingDays'][number],
      ) ||
      calendar.holidays.includes(date.toString())
    )
      continue;
    const opening = date
      .toZonedDateTime({ timeZone: calendar.timezone, plainTime: open })
      .toInstant();
    const closing = date
      .toZonedDateTime({ timeZone: calendar.timezone, plainTime: close })
      .toInstant();
    const at = Temporal.Instant.compare(instant, opening) > 0 ? instant : opening;
    const available = Math.max(0, (closing.epochMilliseconds - at.epochMilliseconds) / 60000);
    if (remaining <= available)
      return new Date(at.epochMilliseconds + remaining * 60000).toISOString();
    remaining -= available;
  }
  throw new ApiError(
    503,
    'CALENDAR_UNAVAILABLE',
    'The campus service calendar cannot produce a deadline.',
  );
}
