// Time zones for the pickers (the server accepts only these IANA names)
export const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Denver"];

// This device's zone if the server knows it, otherwise ByteSize's default
export function browserTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return TIMEZONES.includes(tz) ? tz : "America/Denver";
}
