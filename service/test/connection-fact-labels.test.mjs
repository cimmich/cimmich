import assert from "node:assert/strict";
import test from "node:test";
import { displayedConnectionFactLabel } from "../src/connection-facts.mjs";

const row = {
  direction: "outgoing",
  inverse_label: "Friend",
  inverse_past_label: "Friend (Former)",
  label: "Friend",
  past_label: "Friend (Former)",
  validity: "current",
};

test("connection modifiers are grouped with their relationship type", () => {
  assert.equal(
    displayedConnectionFactLabel(row, [
      { behavior: "qualifier", label: "Childhood" },
      { behavior: "qualifier", label: "School" },
    ]),
    "Friend (Childhood, School)",
  );
});

test("Former shares one modifier group with relationship qualifiers", () => {
  assert.equal(
    displayedConnectionFactLabel({ ...row, validity: "past" }, [
      { behavior: "historical", label: "Former" },
      { behavior: "qualifier", label: "Childhood" },
    ]),
    "Friend (Former, Childhood)",
  );
});

test("past Place verbs remain the base while qualifiers use brackets", () => {
  assert.equal(
    displayedConnectionFactLabel(
      {
        ...row,
        inverse_label: "Works here",
        inverse_past_label: "Worked here",
        label: "Works here",
        past_label: "Worked here",
        validity: "past",
      },
      [{ behavior: "qualifier", label: "School" }],
    ),
    "Worked here (School)",
  );
});
