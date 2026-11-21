import { test } from "node:test";
import assert from "node:assert/strict";
import { REMINDER_COOLDOWN_MS, reminderWait } from "./reminders";

test("a pair can be reminded once a day", () => {
  const sent = new Date("2026-11-01T10:00:00Z");
  assert.equal(reminderWait(null), 0);
  assert.equal(reminderWait(sent, sent.getTime() + 60_000), REMINDER_COOLDOWN_MS - 60_000);
  assert.equal(reminderWait(sent, sent.getTime() + REMINDER_COOLDOWN_MS), 0);
  assert.equal(reminderWait(sent, sent.getTime() + REMINDER_COOLDOWN_MS * 2), 0);
});
