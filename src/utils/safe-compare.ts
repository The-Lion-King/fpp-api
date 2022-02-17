import crypto from 'crypto';

import * as FppErrors from '../error';

export default function safeCompare(
  strA: string | {[key: string]: string;} | string[] | number[],
  strB: string | {[key: string]: string;} | string[] | number[],
): boolean {
  if (typeof strA === typeof strB) {
    let buffA: Buffer;
    let buffB: Buffer;

    if (typeof strA === 'object' && typeof strB === 'object') {
      buffA = Buffer.from(JSON.stringify(strA));
      buffB = Buffer.from(JSON.stringify(strB));
    } else {
      buffA = Buffer.from(strA);
      buffB = Buffer.from(strB);
    }

    if (buffA.length === buffB.length) {
      return crypto.timingSafeEqual(buffA, buffB);
    }
  } else {
    throw new FppErrors.SafeCompareError(
      `Mismatched data types provided: ${typeof strA} and ${typeof strB}`,
    );
  }
  return false;
}
