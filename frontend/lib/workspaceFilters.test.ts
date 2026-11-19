import { describe, expect, it } from "vitest";
import {
  areFiltersEqual,
  filtersFromSearchParams,
  isWorkspaceType,
  searchParamsFromFilters,
  toWorkspaceQuery,
} from "./workspaceFilters";
import type { WorkspaceType } from "./types/workspace";

const ALLOWED: readonly WorkspaceType[] = [
  "COWORKING",
  "PRIVATE_OFFICE",
  "MEETING_ROOM",
  "HOT_DESK",
  "DEDICATED_DESK",
];

describe("filtersFromSearchParams", () => {
  it("reads search and type", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("search=hub&type=HOT_DESK"),
      ALLOWED
    );

    expect(filters).toEqual({ search: "hub", type: "HOT_DESK" });
  });

  it("returns empty filters for an empty URL", () => {
    expect(filtersFromSearchParams(new URLSearchParams(""), ALLOWED)).toEqual({
      search: "",
      type: "",
    });
  });

  it("ignores a type the app does not recognise", () => {
    expect(
      filtersFromSearchParams(new URLSearchParams("type=WAREHOUSE"), ALLOWED)
    ).toEqual({ search: "", type: "" });
  });
});

describe("searchParamsFromFilters", () => {
  it("omits empty values so a cleared filter leaves a clean URL", () => {
    expect(searchParamsFromFilters({ search: "", type: "" })).toBe("");
    expect(searchParamsFromFilters({ search: "  ", type: "" })).toBe("");
  });

  it("serialises both filters", () => {
    expect(
      searchParamsFromFilters({ search: "hub", type: "COWORKING" })
    ).toBe("search=hub&type=COWORKING");
  });

  it("round-trips through filtersFromSearchParams", () => {
    const filters = { search: "annex room", type: "MEETING_ROOM" as const };

    expect(
      filtersFromSearchParams(
        new URLSearchParams(searchParamsFromFilters(filters)),
        ALLOWED
      )
    ).toEqual(filters);
  });
});

describe("toWorkspaceQuery", () => {
  it("omits empty filters so clearing the search fetches unfiltered results", () => {
    const query = toWorkspaceQuery({ search: "", type: "" }, 1, 9);

    expect(query).toEqual({ page: 1, limit: 9 });
    expect("search" in query).toBe(false);
    expect("type" in query).toBe(false);
  });

  it("does not send a whitespace-only search", () => {
    expect(toWorkspaceQuery({ search: "   ", type: "" }, 2, 9)).toEqual({
      page: 2,
      limit: 9,
    });
  });

  it("includes filters that are set", () => {
    expect(
      toWorkspaceQuery({ search: "hub", type: "HOT_DESK" }, 3, 9)
    ).toEqual({ page: 3, limit: 9, search: "hub", type: "HOT_DESK" });
  });

  it("changes the query when the search is cleared", () => {
    const filtered = toWorkspaceQuery({ search: "hub", type: "" }, 1, 9);
    const cleared = toWorkspaceQuery({ search: "", type: "" }, 1, 9);

    expect(filtered).not.toEqual(cleared);
  });
});

describe("areFiltersEqual", () => {
  it("ignores surrounding whitespace", () => {
    expect(
      areFiltersEqual({ search: " hub ", type: "" }, { search: "hub", type: "" })
    ).toBe(true);
  });

  it("distinguishes different filters", () => {
    expect(
      areFiltersEqual({ search: "hub", type: "" }, { search: "hub", type: "HOT_DESK" })
    ).toBe(false);
  });
});

// F20 — Reject workspace filter values outside available options ───────────────
//
// When the available workspace set changes (e.g. a workspace type is removed
// from the backend catalogue), any existing filter that referenced it must be
// cleared rather than forwarded as a stale, unrecognised value.

describe("F20 — stale filter rejection on available-set change", () => {
  it("isWorkspaceType returns false for a value not in the allowed set", () => {
    expect(isWorkspaceType("WAREHOUSE", ALLOWED)).toBe(false);
    expect(isWorkspaceType("HOT_DESK", ALLOWED)).toBe(true);
  });

  it("filtersFromSearchParams clears a type that is no longer available", () => {
    // Previously the user had "VIRTUAL" selected. Now VIRTUAL is removed from
    // the available set.
    const limited: readonly WorkspaceType[] = [
      "COWORKING",
      "PRIVATE_OFFICE",
      "MEETING_ROOM",
    ];

    const filters = filtersFromSearchParams(
      new URLSearchParams("type=HOT_DESK&search=annex"),
      limited
    );

    // HOT_DESK is not in `limited`, so it should be cleared.
    expect(filters.type).toBe("");
    // The search term is unaffected.
    expect(filters.search).toBe("annex");
  });

  it("filtersFromSearchParams keeps a type that remains available", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("type=COWORKING"),
      ALLOWED
    );
    expect(filters.type).toBe("COWORKING");
  });

  it("toWorkspaceQuery omits a stale (empty) type filter", () => {
    // After filtersFromSearchParams clears the stale type, the resulting
    // empty string is not forwarded to the API.
    const query = toWorkspaceQuery({ search: "", type: "" }, 1, 10);
    expect("type" in query).toBe(false);
  });

  it("isWorkspaceType rejects null and undefined without throwing", () => {
    expect(isWorkspaceType(null, ALLOWED)).toBe(false);
    expect(isWorkspaceType(undefined, ALLOWED)).toBe(false);
  });
});
