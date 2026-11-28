import { getMetrics } from './metrics.js';

export function createSimulation({ tables: tableSpecs, arrivals, recallDelay }, policy = 'matching') {
  let time = 0;
  let nextArrival = 0;
  const events = [];
  const entered = new Set();
  const waiting = new Map();
  const tables = tableSpecs.map((spec) => ({ ...spec, busy: null, busyPeriods: [] }));
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const byCapacity = [...tables].sort((left, right) => left.seats - right.seats);

  function occupy(table, until) {
    table.busy = { start: time, end: until };
    table.busyPeriods.push(table.busy);
  }

  function emit(type, person, reason, tableId, extra = {}) {
    const event = { t: time, type, personId: person.personId, reason, ...extra };
    if (tableId !== undefined) event.tableId = tableId;
    if (person.storeId !== undefined) event.storeId = person.storeId;
    events.push(Object.freeze(event));
  }

  function queueArrivals() {
    while (arrivals[nextArrival]?.t <= time) {
      const person = arrivals[nextArrival++];
      if (entered.has(person.personId)) {
        emit('queued', person, '重复取号，保留首次记录');
        continue;
      }
      entered.add(person.personId);
      let earliestTable = Infinity;
      for (const table of tables) {
        if (table.storeId !== person.storeId || table.seats < person.partySize) continue;
        earliestTable = Math.min(earliestTable, table.busy?.end ?? time);
      }
      const estimatedWait = Number.isFinite(earliestTable) ? Math.ceil(earliestTable - time) : null;
      const reason = estimatedWait === null ? '到店取号，当前没有适配桌型'
        : `到店取号，适配桌预计最早 ${estimatedWait} 分钟可用`;
      emit('queued', person, reason, undefined, { partySize: person.partySize, estimatedWait });
      waiting.set(person.personId, {
        ...person, expiresAt: time + person.patience, away: false, recall: null, recovered: false,
      });
    }
  }

  function updateWaiting() {
    for (const person of waiting.values()) {
      if (person.expiresAt <= time) {
        waiting.delete(person.personId);
        emit('lost', person, '等待达到容忍时长，顾客离开');
      } else if (person.recall?.t <= time) {
        const reason = person.away ? '过号顾客已返回，恢复桌型匹配' : '跳号达到回捞时限，保留原排位继续匹配';
        emit('reflowed', person, reason, person.recall.tableId);
        person.away = false;
        person.recall = null;
        person.recovered = true;
      }
    }
  }

  function skip(person, table, reason) {
    emit('skipped', person, reason, table.id);
    if (policy === 'matching' && (person.away || (!person.recall && !person.recovered))) {
      person.recall = { t: time + recallDelay, tableId: table.id };
    }
  }

  function seatNext(table) {
    while (!table.busy) {
      const queue = [...waiting.values()].filter((person) => !person.away && person.storeId === table.storeId);
      if (!queue.length) return;
      const index = policy === 'fifo'
        ? (queue[0].partySize <= table.seats ? 0 : -1)
        : queue.findIndex((person) => person.partySize <= table.seats);
      if (index < 0) return;

      for (const person of queue.slice(0, index)) {
        skip(person, table, `桌型不匹配（${person.partySize} 人，空桌仅 ${table.seats} 座）`);
      }
      const person = queue[index];
      emit('called', person, `叫号：${person.partySize} 人可使用 ${table.seats} 人桌`, table.id);
      if (person.noShow) {
        person.noShow = false;
        person.away = true;
        skip(person, table, '叫号时顾客暂时不在场', table.id);
        continue;
      }

      waiting.delete(person.personId);
      occupy(table, time + person.dineMinutes);
      emit('seated', person, '顾客已应答并入座', table.id);
    }
  }

  function advanceTo(target) {
    while (true) {
      let next = arrivals[nextArrival]?.t ?? Infinity;
      for (const table of tables) next = Math.min(next, table.busy?.end ?? Infinity);
      for (const person of waiting.values()) {
        next = Math.min(next, person.expiresAt, person.recall?.t ?? Infinity);
      }
      if (next > target) break;

      time = next;
      for (const table of tables) {
        if (table.busy?.end <= time) table.busy = null;
      }
      updateWaiting();
      queueArrivals();
      for (const table of byCapacity) seatNext(table);
    }
    time = target;
  }

  function releaseTable(id) {
    const table = tablesById.get(id);
    if (!table) return false;
    if (table.busy) {
      table.busy.end = time;
      table.busy = null;
    }
    seatNext(table);
    return true;
  }

  for (const table of tables) {
    if (table.availableAt > 0) occupy(table, table.availableAt);
  }
  advanceTo(0);

  return {
    tables,
    events,
    get time() { return time; },
    advanceTo,
    releaseTable,
    getMetrics: (windowMinutes) => getMetrics(events, tables, time, windowMinutes),
  };
}
