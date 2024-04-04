// import { z } from "zod";

// /**
//  * SQLite has no Boolean datatype. Use cast(true|false|SqliteBoolean).
//  * https://www.sqlite.org/quirks.html#no_separate_boolean_datatype
//  */
// export const SqliteBoolean = z
//   .number()
//   .refine(brand('SqliteBoolean', (n) => n === 0 || n === 1));
// export type SqliteBoolean = z.infer<typeof SqliteBoolean>;

// /**
//  * SQLite has no DateTime datatype. Use cast(new Date()|SqliteDateTime).
//  * https://www.sqlite.org/quirks.html#no_separate_datetime_datatype
//  */
// export const SqliteDateTime = z
//   .string()
//   .refine(brand('SqliteDateTime', (s) => !isNaN(new Date(s).getTime())));
// export type SqliteDateTime = z.infer<typeof SqliteDateTime>;

// export function cast(value: boolean): SqliteBoolean;
// export function cast(value: SqliteBoolean): boolean;
// export function cast(value: Date): SqliteDateTime;
// export function cast(value: SqliteDateTime): Date;
// export function cast(
//   value: boolean | SqliteBoolean | Date | SqliteDateTime,
// ): boolean | SqliteBoolean | Date | SqliteDateTime {
//   if (typeof value === 'boolean')
//     return (value === true ? 1 : 0) as SqliteBoolean;
//   if (typeof value === 'number') return value === 1;
//   if (value instanceof Date) return value.toISOString() as SqliteDateTime;
//   return new Date(value);
// }

export type SqliteBoolean = 0 | 1;
export const cast = (value: boolean): SqliteBoolean => (value ? 1 : 0);
