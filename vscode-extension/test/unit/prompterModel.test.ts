import { strict as assert } from "node:assert";
import { buildInitialState, validate } from "../../prompter/model";
import type {
  ParameterDefinition,
  PrompterDefinition
} from "../../prompter/types";

suite("Prompter model and validation", () => {
  test("buildInitialState uses default values and marks errors", () => {
    const parameter: ParameterDefinition = {
      name: "PARM1",
      description: "Sample parameter",
      inputType: "text",
      required: true,
      defaultValue: "ABC",
      attributes: {
        maxLength: 5
      }
    };

    const definition: PrompterDefinition = {
      keyword: "CMD",
      description: "Command",
      parameters: [parameter]
    };

    const state = buildInitialState(definition, {});
    assert.equal(state.keyword, "CMD");
    assert.equal(state.fields.length, 1);
    assert.equal(state.fields[0]?.value, "ABC");
    assert.equal(state.fields[0]?.error, undefined);
    assert.equal(state.hasErrors, false);
  });

  test("validate enforces required and numericOnly and maxLength", () => {
    const parameter: ParameterDefinition = {
      name: "LEN",
      description: "Length",
      inputType: "text",
      required: true,
      attributes: {
        numericOnly: true,
        maxLength: 3
      }
    };

    const errorRequired = validate(parameter, "");
    assert.ok(errorRequired, "Expected error for empty required value");

    const errorTooLong = validate(parameter, "1234");
    assert.ok(errorTooLong, "Expected error for value exceeding maxLength");

    const errorNotNumeric = validate(parameter, "12A");
    assert.ok(errorNotNumeric, "Expected error for non-numeric value");

    const ok = validate(parameter, "123");
    assert.equal(ok, undefined);
  });

  test("validate checks options when provided", () => {
    const parameter: ParameterDefinition = {
      name: "OPT",
      description: "Option",
      inputType: "dropdown",
      required: false,
      options: [
        { label: "A", value: "A" },
        { label: "B", value: "B" }
      ]
    };

    const errorInvalid = validate(parameter, "C");
    assert.ok(errorInvalid, "Expected error for value not in options");

    const ok = validate(parameter, "A");
    assert.equal(ok, undefined);
  });
});

