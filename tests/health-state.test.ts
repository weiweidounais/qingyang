import { describe, it, expect } from "vitest";
import {
  healthReducer,
  balance,
  shanghaiDate,
} from "../src/lib/health/reducer";
import { makeSeed } from "../src/lib/health/seed";
import { readState, writeState } from "../src/lib/health/storage";
const date = "2026-10-18";
describe("health records and rewards", () => {
  it("rewards a daily task once and preserves previous dates", () => {
    let s = makeSeed(date);
    s = healthReducer(s, { type: "sign", date });
    s = healthReducer(s, { type: "sign", date });
    expect(s.ledger.filter((x) => x.key === `sign:${date}`)).toHaveLength(1);
    const old = s.ledger.length;
    s = healthReducer(s, { type: "sign", date: "2026-10-19" });
    expect(s.ledger.length).toBe(old + 1);
  });
  it("completes one workout once including calories", () => {
    let s = makeSeed(date);
    s = healthReducer(s, { type: "workout", date, id: "flow" });
    s = healthReducer(s, { type: "workout", date, id: "flow" });
    expect(
      s.completedWorkouts.filter((x) => x.id === "flow" && x.date === date),
    ).toHaveLength(1);
    expect(
      s.ledger.filter((x) => x.key === `workout:flow:${date}`),
    ).toHaveLength(1);
  });
  it("deduplicates bookings and allows cancellation", () => {
    let s = makeSeed(date);
    s = healthReducer(s, { type: "book", id: "yoga" });
    s = healthReducer(s, { type: "book", id: "yoga" });
    expect(s.bookings).toEqual(["yoga"]);
    s = healthReducer(s, { type: "cancel", id: "yoga" });
    expect(s.bookings).toEqual([]);
  });
  it("never redeems more points than available", () => {
    const s = makeSeed(date);
    expect(
      healthReducer(s, { type: "redeem", id: "bottle", cost: 9999, date }),
    ).toEqual(s);
    expect(balance(s)).toBe(320);
  });
  it("saves water and rejects invalid measurements", () => {
    const s = makeSeed(date);
    const next = healthReducer(s, { type: "water", date });
    expect(next.dailyRecords[date].water).toBe(1500);
    expect(healthReducer(s, { type: "weight", date, value: -1 })).toEqual(s);
  });
  it("separates Shanghai midnight from UTC dates", () => {
    expect(shanghaiDate(new Date("2026-10-18T15:59:59Z"))).toBe("2026-10-18");
    expect(shanghaiDate(new Date("2026-10-18T16:00:00Z"))).toBe("2026-10-19");
  });
});
describe("storage recovery", () => {
  it.each([
    "{bad",
    '{"version":0,"state":{}}',
    '{"version":1,"state":{"ledger":"oops"}}',
  ])("recovers corrupt state %s", (raw) => {
    expect(readState({ getItem: () => raw }).warning).toBeTruthy();
  });
  it("round-trips state and reports quota errors", () => {
    let raw = "";
    const s = makeSeed(date);
    expect(
      writeState(
        {
          setItem: (_, value) => {
            raw = value;
          },
        },
        s,
      ),
    ).toBe(true);
    expect(readState({ getItem: () => raw }).state).toEqual(s);
    expect(
      writeState(
        {
          setItem: () => {
            throw Error("quota");
          },
        },
        s,
      ),
    ).toBe(false);
  });
});
