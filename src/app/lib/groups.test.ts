import { describe, expect, test } from "bun:test";
import { groupCodeError, groupNameError, parseGroupCode, validateGroupName } from "./groups";

describe("groupNameError", () => {
  test("null for every name validateGroupName takes", () => {
    for (const ok of ["Pune Office EV Club", "ab", "x".repeat(30)]) {
      expect(validateGroupName(ok)).not.toBeNull();
      expect(groupNameError(ok)).toBeNull();
    }
  });

  test("each way a group name is turned down gets its own message", () => {
    expect(groupNameError("")).toBe("Enter the group name.");
    expect(groupNameError("x")).toBe("Use at least 2 characters in the group name.");
    expect(groupNameError("x".repeat(31))).toBe("Use 30 characters or fewer in the group name.");
    expect(groupNameError("EV-Club!")).toBe("Use only letters, numbers and spaces in the group name.");
    expect(groupNameError("shit club")).toBe("That name isn't allowed. Pick another one.");
  });
});

describe("groupCodeError", () => {
  test("null for every code parseGroupCode takes", () => {
    for (const ok of ["ABC-234", "abc234", " ABC 234 "]) {
      expect(parseGroupCode(ok)).not.toBeNull();
      expect(groupCodeError(ok)).toBeNull();
    }
  });

  test("a blank code and a wrong one get their own message", () => {
    for (const blank of ["", "  ", null]) expect(groupCodeError(blank)).toBe("Enter the group code, like ABC-234.");
    // 0 and 1 aren't in codes (no mixing up O and I).
    for (const bad of ["ABC-23", "ABC-2345", "ABC-201"]) expect(groupCodeError(bad)).toBe("A group code is 6 letters and numbers, like ABC-234.");
  });
});
