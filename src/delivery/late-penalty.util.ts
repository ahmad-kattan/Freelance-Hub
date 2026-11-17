const DAY_MS = 24 * 60 * 60 * 1000;

export function calcLateDays(dueAt: Date | null, deliveredAt: Date): number {
  if (!dueAt) {
    return 0;
  }

  const diff = deliveredAt.getTime() - dueAt.getTime();
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
}

export function calcLatePenalty(price: bigint, lateDays: number, perDayPercent: number, maxPercent: number): bigint {
  if (lateDays <= 0) {
    return 0n;
  }

  const percent = Math.floor(Math.min(lateDays * perDayPercent, maxPercent));
  return (price * BigInt(percent)) / 100n;
}
