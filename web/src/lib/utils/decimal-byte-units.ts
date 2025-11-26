export const enum DecimalByteUnit {
  'B' = 'B',
  'KB' = 'KB',
  'MB' = 'MB',
  'GB' = 'GB',
  'TB' = 'TB',
  'PB' = 'PB',
  'EB' = 'EB',
}

const decimalByteUnits = [DecimalByteUnit.B, DecimalByteUnit.KB, DecimalByteUnit.MB, DecimalByteUnit.GB, DecimalByteUnit.TB, DecimalByteUnit.PB, DecimalByteUnit.EB];

/**
 * Convert bytes to best human readable unit and number of that unit.
 *
 * * For `1000` bytes, returns `1` and `KB`.
 * * For `1500` bytes, returns `1.5` and `KB`.
 *
 * @param bytes number of bytes
 * @param maxPrecision maximum number of decimal places, default is `1`
 * @returns size (number) and unit (string)
 */
export function getDecimalBytesWithUnit(bytes: number, maxPrecision = 1): [number, DecimalByteUnit] {
  const magnitude = Math.floor(Math.log(bytes === 0 ? 1 : bytes) / Math.log(1000));

  return [Number.parseFloat((bytes / 1000 ** magnitude).toFixed(maxPrecision)), decimalByteUnits[magnitude]];
}

/**
 * Localized number of bytes with a unit.
 *
 * For `1500` bytes:
 * * en: `1.5 KB`
 * * de: `1,5 KB`
 *
 * @param bytes number of bytes
 * @param locale locale to use, default is `navigator.language`
 * @param maxPrecision maximum number of decimal places, default is `1`
 * @returns localized bytes with unit as string
 */
export function getDecimalByteUnitString(bytes: number, locale?: string, maxPrecision = 1): string {
  const [size, unit] = getDecimalBytesWithUnit(bytes, maxPrecision);
  return `${size.toLocaleString(locale)} ${unit}`;
}

/**
 * Convert to bytes from on a specified unit.
 *
 * * `1, 'GB'`, returns `1000000000` bytes
 *
 * @param size value to be converted
 * @param unit unit to convert from
 * @returns bytes (number)
 */
export function convertDecimalToBytes(size: number, unit: DecimalByteUnit): number {
  return size * 1000 ** decimalByteUnits.indexOf(unit);
}

/**
 * Convert from bytes to a specified unit.
 *
 * * `1000000000, 'GB'`, returns `1` GB
 *
 * @param bytes value to be converted
 * @param unit unit to convert to
 * @returns bytes (number)
 */
export function convertDecimalFromBytes(bytes: number, unit: DecimalByteUnit): number {
  return bytes / 1000 ** decimalByteUnits.indexOf(unit);
}
