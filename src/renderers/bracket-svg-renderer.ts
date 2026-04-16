import type { BracketRenderMatch, BracketRenderModel, BracketRenderRound, PlacementEntry } from "./types.js";

const CARD_WIDTH = 280;
const CARD_HEIGHT = 104;
const CARD_INNER_PAD = 14;
const COLUMN_GAP = 88;
const ROW_GAP = 28;
const HEADER_HEIGHT = 116;
const PAGE_INFO_HEIGHT = 42;
const LEFT_PAD = 48;
const TOP_PAD = 32;
const RIGHT_PAD = 48;
const BOTTOM_PAD = 40;
const SURFACE_RADIUS = 26;
const MAX_IMAGE_WIDTH = 1800;
const PLACEMENT_CARD_HEIGHT = 82;
const PLACEMENT_COLUMNS = 2;

const COLORS = {
  background: "#08111f",
  surface: "#111c30",
  surfaceAlt: "#17243b",
  card: "#1a2943",
  cardAlt: "#20304f",
  border: "#314867",
  connector: "#35507a",
  text: "#f3f7ff",
  muted: "#8ea4c5",
  pill: "#253958",
  accent: "#f3c755",
  success: "#4ade80",
  ready: "#60a5fa",
  pending: "#f59e0b"
};

const FONT_STACK = "Arial, Helvetica, sans-serif";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const pretty = (value: string): string =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const statusColor = (status: string): string => {
  if (status === "COMPLETED") return COLORS.success;
  if (status === "READY") return COLORS.ready;
  return COLORS.pending;
};

const connectorPath = (fromX: number, fromY: number, toX: number, toY: number): string => {
  const midX = fromX + COLUMN_GAP / 2;
  return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
};

export class BracketSvgRenderer {
  public render(model: BracketRenderModel): string {
    if (model.pageModel.placements) {
      return this.renderPlacements(model, model.pageModel.placements);
    }

    if (model.pageModel.rounds.length === 0) {
      return this.renderPlaceholder(model);
    }

    return this.renderBracket(model, model.pageModel.rounds);
  }

  private renderBracket(model: BracketRenderModel, rounds: BracketRenderRound[]): string {
    const width =
      LEFT_PAD +
      rounds.length * CARD_WIDTH +
      Math.max(0, rounds.length - 1) * COLUMN_GAP +
      RIGHT_PAD;

    const roundCenters = rounds.map((round, index) =>
      this.computeRoundPositions(round.matches.length, index)
    );
    const maxY = Math.max(
      ...roundCenters.flatMap((centers) => centers.map((center) => center + CARD_HEIGHT / 2))
    );
    const height = HEADER_HEIGHT + PAGE_INFO_HEIGHT + maxY + BOTTOM_PAD;

    const cards: string[] = [];
    const connectors: string[] = [];
    const centers = new Map<string, { left: number; right: number; centerY: number }>();

    rounds.forEach((round, roundIndex) => {
      const x = LEFT_PAD + roundIndex * (CARD_WIDTH + COLUMN_GAP);
      cards.push(
        `<text x="${x}" y="${HEADER_HEIGHT + PAGE_INFO_HEIGHT + 10}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="16" font-weight="700" letter-spacing="1.2">${escapeXml(round.name.toUpperCase())}</text>`
      );

      round.matches.forEach((match, matchIndex) => {
        const centerY = roundCenters[roundIndex]![matchIndex]!;
        const y = centerY - CARD_HEIGHT / 2;
        cards.push(this.renderMatchCard(x, y, match));
        centers.set(match.id, {
          left: x,
          right: x + CARD_WIDTH,
          centerY
        });
      });
    });

    rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (!match.nextMatchId) {
          return;
        }

        const from = centers.get(match.id);
        const to = centers.get(match.nextMatchId);
        if (!from || !to) {
          return;
        }

        connectors.push(
          `<path d="${connectorPath(from.right, from.centerY, to.left, to.centerY)}" fill="none" stroke="${COLORS.connector}" stroke-width="4" stroke-linecap="round" />`
        );
      });
    });

    return this.wrapSvg(
      model,
      width,
      height,
      `${this.renderShell(model, width, height)}${connectors.join("")}${cards.join("")}`
    );
  }

  private renderPlacements(model: BracketRenderModel, placements: PlacementEntry[]): string {
    const width = 1240;
    const rows = Math.ceil(Math.max(1, placements.length) / PLACEMENT_COLUMNS);
    const height =
      HEADER_HEIGHT +
      PAGE_INFO_HEIGHT +
      rows * PLACEMENT_CARD_HEIGHT +
      Math.max(0, rows - 1) * 22 +
      BOTTOM_PAD;

    const cards: string[] = [];
    placements.forEach((entry, index) => {
      const column = index % PLACEMENT_COLUMNS;
      const row = Math.floor(index / PLACEMENT_COLUMNS);
      const columnWidth = (width - LEFT_PAD - RIGHT_PAD - 24) / PLACEMENT_COLUMNS;
      const x = LEFT_PAD + column * (columnWidth + 24);
      const y = HEADER_HEIGHT + PAGE_INFO_HEIGHT + row * (PLACEMENT_CARD_HEIGHT + 22);
      cards.push(this.renderPlacementCard(x, y, columnWidth, entry));
    });

    return this.wrapSvg(
      model,
      width,
      height,
      `${this.renderShell(model, width, height)}${cards.join("")}`
    );
  }

  private renderPlaceholder(model: BracketRenderModel): string {
    const placeholderNames = model.placeholder?.entrantNames ?? [];
    const visibleEntrants = Math.min(16, Math.max(placeholderNames.length, 8));
    const matches = Math.ceil(visibleEntrants / 2);
    const pseudoRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, visibleEntrants))));
    const width =
      LEFT_PAD + pseudoRounds * CARD_WIDTH + Math.max(0, pseudoRounds - 1) * COLUMN_GAP + RIGHT_PAD;
    const roundCenters = Array.from({ length: pseudoRounds }, (_, roundIndex) =>
      this.computeRoundPositions(Math.max(1, Math.ceil(matches / 2 ** roundIndex)), roundIndex)
    );
    const maxY = Math.max(...roundCenters.flatMap((centers) => centers.map((center) => center + CARD_HEIGHT / 2)));
    const height = HEADER_HEIGHT + PAGE_INFO_HEIGHT + maxY + BOTTOM_PAD;

    const body: string[] = [this.renderShell(model, width, height)];
    for (let roundIndex = 0; roundIndex < pseudoRounds; roundIndex += 1) {
      const x = LEFT_PAD + roundIndex * (CARD_WIDTH + COLUMN_GAP);
      body.push(
        `<text x="${x}" y="${HEADER_HEIGHT + PAGE_INFO_HEIGHT + 10}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="16" font-weight="700" letter-spacing="1.2">ROUND ${roundIndex + 1}</text>`
      );

      const centers = roundCenters[roundIndex]!;
      for (let matchIndex = 0; matchIndex < centers.length; matchIndex += 1) {
        const y = centers[matchIndex]! - CARD_HEIGHT / 2;
        const player1 = roundIndex === 0 ? placeholderNames[matchIndex * 2] ?? "" : "";
        const player2 = roundIndex === 0 ? placeholderNames[matchIndex * 2 + 1] ?? "" : "";
        body.push(this.renderPlaceholderCard(x, y, matchIndex + 1, player1, player2));
      }
    }

    return this.wrapSvg(model, width, height, body.join(""));
  }

  private renderShell(model: BracketRenderModel, width: number, height: number): string {
    const tabPills = model.tabs
      .map((tab, index) => {
        const x = LEFT_PAD + index * 134;
        const active = tab.key === model.activeTab;
        return [
          `<rect x="${x}" y="64" width="118" height="34" rx="17" fill="${active ? COLORS.accent : COLORS.pill}" stroke="${active ? COLORS.accent : COLORS.border}" stroke-width="1.5" />`,
          `<text x="${x + 59}" y="86" text-anchor="middle" fill="${active ? "#11151f" : COLORS.text}" font-family="${FONT_STACK}" font-size="14" font-weight="700">${escapeXml(tab.label)}</text>`
        ].join("");
      })
      .join("");

    return [
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.background}" />`,
      `<rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="${SURFACE_RADIUS}" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<text x="${LEFT_PAD}" y="56" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="30" font-weight="700">${escapeXml(truncate(model.tournamentName, 42))}</text>`,
      `<text x="${LEFT_PAD}" y="122" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="15" font-weight="600">${escapeXml(model.pageModel.title)}</text>`,
      `<text x="${LEFT_PAD}" y="144" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="13">${escapeXml(model.pageModel.subtitle)}</text>`,
      `<text x="${width - RIGHT_PAD}" y="56" text-anchor="end" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="14" font-weight="700">${escapeXml(pretty(model.status))}</text>`,
      `<text x="${width - RIGHT_PAD}" y="80" text-anchor="end" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="13">${escapeXml(`Page ${model.page}/${model.totalPages}`)}</text>`,
      `<text x="${width - RIGHT_PAD}" y="102" text-anchor="end" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12">${escapeXml(model.updatedLabel)}</text>`,
      tabPills
    ].join("");
  }

  private renderMatchCard(x: number, y: number, match: BracketRenderMatch): string {
    const winnerIsPlayer1 = match.winnerName != null && match.winnerName === match.player1Name;
    const winnerIsPlayer2 = match.winnerName != null && match.winnerName === match.player2Name;

    return [
      `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<rect x="${x + CARD_INNER_PAD}" y="${y + CARD_INNER_PAD}" width="${CARD_WIDTH - CARD_INNER_PAD * 2}" height="24" rx="12" fill="${COLORS.cardAlt}" />`,
      `<text x="${x + 24}" y="${y + 31}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">MATCH ${match.sequence}</text>`,
      `<rect x="${x + CARD_WIDTH - 102}" y="${y + 14}" width="78" height="24" rx="12" fill="${statusColor(match.status)}" />`,
      `<text x="${x + CARD_WIDTH - 63}" y="${y + 30}" text-anchor="middle" fill="${COLORS.background}" font-family="${FONT_STACK}" font-size="11" font-weight="700">${escapeXml(pretty(match.status))}</text>`,
      this.renderPlayerRow(x + 16, y + 48, match.player1Name || " ", winnerIsPlayer1),
      this.renderPlayerRow(x + 16, y + 76, match.player2Name || " ", winnerIsPlayer2),
      match.scoreLabel
        ? `<text x="${x + CARD_WIDTH - 20}" y="${y + CARD_HEIGHT - 14}" text-anchor="end" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">${escapeXml(match.scoreLabel)}</text>`
        : ""
    ].join("");
  }

  private renderPlayerRow(x: number, y: number, name: string, winner: boolean): string {
    return [
      winner
        ? `<rect x="${x - 8}" y="${y - 15}" width="${CARD_WIDTH - 32}" height="22" rx="11" fill="rgba(74, 222, 128, 0.18)" />`
        : "",
      winner
        ? `<rect x="${x - 8}" y="${y - 15}" width="4" height="22" rx="2" fill="${COLORS.success}" />`
        : "",
      `<text x="${x + 2}" y="${y}" fill="${winner ? COLORS.text : "#dce8ff"}" font-family="${FONT_STACK}" font-size="17" font-weight="${winner ? 700 : 600}">${escapeXml(truncate(name, 26))}</text>`
    ].join("");
  }

  private renderPlacementCard(x: number, y: number, width: number, entry: PlacementEntry): string {
    return [
      `<rect x="${x}" y="${y}" width="${width}" height="${PLACEMENT_CARD_HEIGHT}" rx="18" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<rect x="${x + 18}" y="${y + 16}" width="72" height="34" rx="17" fill="${entry.placement <= 3 ? COLORS.accent : COLORS.pill}" />`,
      `<text x="${x + 54}" y="${y + 38}" text-anchor="middle" fill="${entry.placement <= 3 ? "#11151f" : COLORS.text}" font-family="${FONT_STACK}" font-size="14" font-weight="700">${escapeXml(entry.label)}</text>`,
      `<text x="${x + 110}" y="${y + 38}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="20" font-weight="700">${escapeXml(truncate(entry.displayName, 28))}</text>`,
      `<text x="${x + 110}" y="${y + 60}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="13" font-weight="600">${escapeXml(entry.status)}</text>`
    ].join("");
  }

  private renderPlaceholderCard(x: number, y: number, matchNumber: number, player1: string, player2: string): string {
    return [
      `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<text x="${x + 22}" y="${y + 28}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">MATCH ${matchNumber}</text>`,
      player1
        ? `<text x="${x + 22}" y="${y + 58}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(truncate(player1, 25))}</text>`
        : "",
      player2
        ? `<text x="${x + 22}" y="${y + 82}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(truncate(player2, 25))}</text>`
        : ""
    ].join("");
  }

  private computeRoundPositions(matchCount: number, roundIndex: number): number[] {
    const positions: number[] = [];
    const step = (CARD_HEIGHT + ROW_GAP) * 2 ** roundIndex;
    const offset = HEADER_HEIGHT + PAGE_INFO_HEIGHT + CARD_HEIGHT / 2 + ((2 ** roundIndex - 1) * (CARD_HEIGHT + ROW_GAP)) / 2;
    for (let index = 0; index < matchCount; index += 1) {
      positions.push(offset + index * step);
    }
    return positions;
  }

  private wrapSvg(model: BracketRenderModel, width: number, height: number, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${body}
</svg>`;
  }
}
