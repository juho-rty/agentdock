import { assert, describe, it } from "@effect/vitest";

import { parseElicitationForm } from "./elicitationForm.ts";

describe("parseElicitationForm", () => {
  for (const type of ["string", "array"] as const) {
    it.each([
      { values: [" padded ", "", "plain"], labels: ["padded", '""', "plain"] },
      { values: [" a", "a", "b"], labels: ['" a"', '"a"', "b"] },
      { values: [" a", "a", '"a"'], labels: ['" a"', '"a"', '"\\"a\\""'] },
    ])(
      `preserves ${type} enum values with distinct readable labels: $values`,
      ({ values, labels }) => {
        const form = parseElicitationForm(
          {
            type: "object",
            properties: {
              answer:
                type === "array"
                  ? { type, items: { type: "string", enum: values } }
                  : { type, enum: values },
            },
            required: ["answer"],
          },
          "Choose",
        );
        assert(form !== undefined);
        const question = form.questions[0];
        assert(question !== undefined);
        assert.deepStrictEqual(
          question.options.map((option) => option.label),
          labels,
        );
        assert.deepStrictEqual(
          question.options.map((option) => option.value),
          values,
        );
        assert.strictEqual(question.allowCustomAnswer, false);
        assert.strictEqual(question.multiSelect, type === "array" ? true : undefined);
        for (const value of values) {
          const answer = type === "array" ? [value] : value;
          assert.deepStrictEqual(form.content({ answer }), { answer });
        }
      },
    );
  }

  it("asks each question once when a choice has a free-text companion field", () => {
    // OMP's ask dialog follows each choice `q<n>` with a free-text `q<n>__other` field.
    const ask = (question: string, header: string) => ({
      type: "string",
      title: question,
      description: header,
      oneOf: [
        { const: "Yes", title: "Yes" },
        { const: "No", title: "No" },
      ],
    });
    const form = parseElicitationForm(
      {
        type: "object",
        properties: {
          q0: ask("Use Postgres for the new service?", "Database"),
          q0__other: { type: "string", title: "Other (type your own)" },
          q1: ask("Deploy to staging first?", "Deploy"),
          q1__other: { type: "string", title: "Other (type your own)" },
        },
      },
      "Answer 2 questions",
    );
    assert(form !== undefined);
    assert.deepStrictEqual(
      form.questions.map((question) =>
        [question.header, question.question].some((text) => text.endsWith("?")),
      ),
      [true, true],
    );
    assert.deepStrictEqual(form.content({ q0: "Yes", q1: "Only on Fridays" }), {
      q0: "Yes",
      q1__other: "Only on Fridays",
    });

    // Antigravity puts the question in the title and pairs each multi-select with `<id>_other`.
    const multi = parseElicitationForm(
      {
        type: "object",
        properties: {
          q1: {
            type: "array",
            title: "Which databases?",
            items: { anyOf: [{ const: "1", title: "Postgres" }] },
          },
          q1_other: {
            type: "string",
            title: "Other",
            description: "Optional free-form answer to: Which databases?",
          },
        },
      },
      "The agent has 1 questions.",
    );
    assert(multi !== undefined);
    assert.deepStrictEqual(
      multi.questions.map((question) => [question.id, question.header, question.question]),
      [["q1", "Question 1", "Which databases?"]],
    );
    assert.strictEqual(multi.questions[0]?.allowCustomAnswer, undefined);
    assert.deepStrictEqual(multi.content({ q1: ["1"] }), { q1: ["1"] });
    assert.deepStrictEqual(multi.content({ q1: "SQLite" }), { q1_other: "SQLite" });
    assert.deepStrictEqual(multi.content({ q1: ["1", "SQLite"] }), {
      q1: ["1"],
      q1_other: "SQLite",
    });
  });
});
