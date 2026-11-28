export const DEFAULT_WINDOW_MINUTES = 120;
const MIN_SAMPLE_SIZE = 30;

export function getMetrics(events, tables, time, windowMinutes) {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new RangeError('统计窗口分钟数需要为有限正数');
  }

  const detail = { queued: 0, called: 0, seated: 0, lost: 0, skipped: 0, reflowed: 0, dedupRemoved: 0 };
  const queuedAt = new Map();
  const finished = new Set();
  const recalled = new Set();
  let totalWait = 0;
  let recallSuccesses = 0;

  for (const { t, type, personId } of events) {
    // 窗口是 [0, windowMinutes)，结束后继续推进也不改写该窗口的计数。
    if (t >= windowMinutes) break;
    switch (type) {
      case 'queued':
        if (queuedAt.has(personId)) {
          detail.dedupRemoved += 1;
        } else {
          queuedAt.set(personId, t);
          detail.queued += 1;
        }
        break;
      case 'seated':
      case 'lost':
        if (!queuedAt.has(personId) || finished.has(personId)) break;
        finished.add(personId);
        detail[type] += 1;
        if (type === 'seated') {
          totalWait += t - queuedAt.get(personId);
          if (recalled.has(personId)) recallSuccesses += 1;
        }
        break;
      case 'reflowed':
        recalled.add(personId);
        detail.reflowed += 1;
        break;
      case 'called':
      case 'skipped':
        detail[type] += 1;
        break;
    }
  }

  const minutes = Math.min(time, windowMinutes);
  let occupiedMinutes = 0;
  for (const table of tables) {
    for (const { start, end } of table.busyPeriods) {
      occupiedMinutes += Math.max(0, Math.min(end, minutes) - start);
    }
  }
  const tableMinutes = tables.length * minutes;
  const sampleSize = detail.seated + detail.lost;
  const sufficient = sampleSize >= MIN_SAMPLE_SIZE;

  return {
    lossRate: sufficient ? detail.lost / sampleSize : null,
    sampleSize,
    censored: detail.queued - sampleSize,
    reason: sufficient ? null : `样本不足（n=${sampleSize}，需 ≥${MIN_SAMPLE_SIZE}）`,
    aux: {
      skipOutRate: detail.called ? detail.skipped / detail.called : null,
      avgWait: detail.seated ? totalWait / detail.seated : null,
      idleTableRatio: tableMinutes ? Math.max(0, tableMinutes - occupiedMinutes) / tableMinutes : null,
      reflowSuccess: detail.reflowed ? recallSuccesses / detail.reflowed : null,
    },
    window: { start: 0, minutes },
    detail,
  };
}
