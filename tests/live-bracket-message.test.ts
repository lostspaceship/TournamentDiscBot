import { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { describe, expect, it } from "vitest";

import { parseSignedCustomId } from "../src/interactions/secure-payload.js";
import { buildLiveBracketMessagePayload } from "../src/renderers/live-bracket-message.js";
import type { BracketRenderModel } from "../src/renderers/types.js";

const baseModel: BracketRenderModel = {
  tournamentId: "tour-1",
  tournamentName: "V2 1v1 Viewer Tournament",
  status: "IN_PROGRESS",
  mode: "OFFICIAL",
  updatedLabel: "Updated now",
  activeTabLabel: "Winners",
  activeTab: "WINNERS",
  page: 2,
  totalPages: 3,
  tabs: [
    { key: "WINNERS", label: "Winners", pageCount: 3 },
    { key: "FINALS", label: "Finals", pageCount: 1 },
    { key: "PLACEMENTS", label: "Placements", pageCount: 1 }
  ],
  registrationCount: 18,
  pageModel: {
    title: "Winners Page 2",
    subtitle: "Participants 17-18",
    rounds: [],
    entrantIds: [],
    placements: []
  }
};

describe("buildLiveBracketMessagePayload", () => {
  it("generates valid signed custom ids for tab and page controls", () => {
    const result = buildLiveBracketMessagePayload(
      "tour-1",
      baseModel,
      {
        renderPng: () => Buffer.from("png")
      } as never
    );

    const rows = result.payload.components as ActionRowBuilder<ButtonBuilder>[];
    const tabButtons = rows[0]!.components;
    const pageButtons = rows[1]!.components;

    expect(tabButtons.length).toBe(3);
    expect(pageButtons.length).toBe(2);

    const winnersTab = parseSignedCustomId((tabButtons[0]!.data as { custom_id: string }).custom_id, { maxAgeMs: 60_000 });
    const previousPage = parseSignedCustomId((pageButtons[0]!.data as { custom_id: string }).custom_id, { maxAgeMs: 60_000 });
    const nextPage = parseSignedCustomId((pageButtons[1]!.data as { custom_id: string }).custom_id, { maxAgeMs: 60_000 });

    expect(winnersTab.entityId).toBe("tour-1|WINNERS|1");
    expect(previousPage.entityId).toBe("tour-1|WINNERS|1");
    expect(nextPage.entityId).toBe("tour-1|WINNERS|3");
  });
});
