import type { BracketRenderMatch, BracketRenderModel, BracketRenderRound, PlacementEntry } from "./types.js";
import { buildBracketLayout } from "./bracket-layout.js";

const CARD_WIDTH = 280;
const CARD_HEIGHT = 104;
const CARD_INNER_PAD = 14;
const CARD_HEADER_HEIGHT = 28;
const COLUMN_GAP = 88;
const ROW_GAP = 28;
const HEADER_HEIGHT = 0;
const PAGE_INFO_HEIGHT = 0;
const LEFT_PAD = 48;
const TOP_PAD = 48;
const RIGHT_PAD = 48;
const BOTTOM_PAD = 48;
const SURFACE_RADIUS = 26;
const MAX_IMAGE_WIDTH = 1800;
const PLACEMENT_CARD_HEIGHT = 58;
const PLACEMENT_COLUMNS = 2;
const PLACEMENT_COLUMN_GAP = 20;
const PLACEMENT_SECTION_GAP = 28;
const FOOTER_TAB_HEIGHT = 34;
const FOOTER_SAFE_SPACE = 84;
const PLACEMENT_MAX_ROWS = 8;
const PLACEMENT_CARD_MIN_WIDTH = 220;
const PLACEMENT_CARD_MAX_WIDTH = 300;

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
    const layout = buildBracketLayout(rounds, {
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      columnGap: COLUMN_GAP,
      rowGap: ROW_GAP,
      leftPad: LEFT_PAD,
      topPad: TOP_PAD,
      rightPad: RIGHT_PAD,
      bottomPad: BOTTOM_PAD,
      headerHeight: HEADER_HEIGHT,
      pageInfoHeight: PAGE_INFO_HEIGHT
    });

    const cards: string[] = [];
    const connectors: string[] = [];
    const centers = new Map<string, { left: number; right: number; centerY: number }>();

    layout.rounds.forEach((round) => {
      round.matches.forEach((positionedMatch) => {
        cards.push(this.renderMatchCard(positionedMatch.x, positionedMatch.y, positionedMatch.match));
        centers.set(positionedMatch.match.id, {
          left: positionedMatch.x,
          right: positionedMatch.x + CARD_WIDTH,
          centerY: positionedMatch.centerY
        });
      });
    });

    layout.rounds.forEach((round) => {
      round.matches.forEach((positionedMatch) => {
        if (!positionedMatch.match.nextMatchId) {
          return;
        }

        const from = centers.get(positionedMatch.match.id);
        const to = centers.get(positionedMatch.match.nextMatchId);
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
      layout.width,
      layout.height,
      `${this.renderShell(model, layout.width, layout.height)}${connectors.join("")}${cards.join("")}`
    );
  }

  private renderPlacements(model: BracketRenderModel, placements: PlacementEntry[]): string {
    const placedEntries = placements.filter((entry) => entry.group === "PLACED");
    const activeEntries = placements.filter((entry) => entry.group === "ACTIVE");
    const activeColumns = this.resolvePlacementColumns(activeEntries.length);
    const placedColumns = this.resolvePlacementColumns(placedEntries.length);
    const sectionColumns = Math.max(activeColumns, placedColumns, 1);
    const placementCardWidth = this.resolvePlacementCardWidth(placements);
    const width =
      LEFT_PAD +
      RIGHT_PAD +
      sectionColumns * placementCardWidth +
      Math.max(0, sectionColumns - 1) * PLACEMENT_COLUMN_GAP;
    const rowGap = 16;
    const headingHeight = 26;
    const headerOffset = TOP_PAD;
    let cursorY = headerOffset;
    const cards: string[] = [];
    cursorY = this.renderPlacementSection(
      cards,
      width,
      cursorY,
      "Still In",
      activeEntries,
      rowGap,
      headingHeight,
      sectionColumns,
      placementCardWidth
    );
    if (placedEntries.length > 0 && activeEntries.length > 0) {
      cursorY += PLACEMENT_SECTION_GAP;
    }
    cursorY = this.renderPlacementSection(
      cards,
      width,
      cursorY,
      "Out",
      placedEntries,
      rowGap,
      headingHeight,
      sectionColumns,
      placementCardWidth
    );

    const height = Math.max(cursorY + FOOTER_SAFE_SPACE, 260);

    return this.wrapSvg(
      model,
      width,
      height,
      `${this.renderShell(model, width, height)}${cards.join("")}`
    );
  }

  private renderPlaceholder(model: BracketRenderModel): string {
    const width = 1320;
    const height = HEADER_HEIGHT + PAGE_INFO_HEIGHT + 220 + BOTTOM_PAD;
    const panelX = LEFT_PAD;
    const panelY = HEADER_HEIGHT + PAGE_INFO_HEIGHT + 24;
    const panelWidth = width - LEFT_PAD - RIGHT_PAD;
    const body = [
      this.renderShell(model, width, height),
      `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="180" rx="22" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<text x="${panelX + 28}" y="${panelY + 60}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="24" font-weight="700">Bracket pending</text>`,
      `<text x="${panelX + 28}" y="${panelY + 96}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="15">Waiting for enough live matches to render the bracket path.</text>`
    ];

    return this.wrapSvg(model, width, height, body.join(""));
  }

  private renderShell(model: BracketRenderModel, width: number, height: number): string {
    const tabSpacing = 14;
    const tabWidth = 118;
    const tabHeight = 34;
    const totalTabsWidth =
      model.tabs.length > 0 ? model.tabs.length * tabWidth + (model.tabs.length - 1) * tabSpacing : 0;
    const tabsStartX = width - RIGHT_PAD - totalTabsWidth;
    const tabsY = height - 72;

    const tabPills = model.tabs
      .map((tab, index) => {
        const x = tabsStartX + index * (tabWidth + tabSpacing);
        const active = tab.key === model.activeTab;
        return [
          `<rect x="${x}" y="${tabsY}" width="${tabWidth}" height="${tabHeight}" rx="17" fill="${active ? COLORS.accent : COLORS.pill}" stroke="${active ? COLORS.accent : COLORS.border}" stroke-width="1.5" />`,
          `<text x="${x + tabWidth / 2}" y="${tabsY + 22}" text-anchor="middle" fill="${active ? "#11151f" : COLORS.text}" font-family="${FONT_STACK}" font-size="14" font-weight="700">${escapeXml(tab.label)}</text>`
        ].join("");
      })
      .join("");

    return [
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${COLORS.background}" />`,
      `<rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="${SURFACE_RADIUS}" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<text x="${width - RIGHT_PAD}" y="56" text-anchor="end" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12">${escapeXml(model.updatedLabel)}</text>`,
      tabPills
    ].join("");
  }

  private renderMatchCard(x: number, y: number, match: BracketRenderMatch): string {
    const winnerIsPlayer1 = match.winnerName != null && match.winnerName === match.player1Name;
    const winnerIsPlayer2 = match.winnerName != null && match.winnerName === match.player2Name;
    const isStructuralPlaceholder =
      !match.player1Name &&
      !match.player2Name &&
      !match.winnerName &&
      match.scoreLabel == null;
    const statusLabel = isStructuralPlaceholder ? "Pending" : pretty(match.status);

    return [
      `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="18" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<rect x="${x + CARD_INNER_PAD}" y="${y + CARD_INNER_PAD}" width="${CARD_WIDTH - CARD_INNER_PAD * 2}" height="${CARD_HEADER_HEIGHT}" rx="14" fill="${isStructuralPlaceholder ? COLORS.surfaceAlt : COLORS.cardAlt}" />`,
      `<text x="${x + 22}" y="${y + 33}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="12" font-weight="700">MATCH ${match.sequence}</text>`,
      `<rect x="${x + CARD_WIDTH - 92}" y="${y + 16}" width="76" height="24" rx="12" fill="${isStructuralPlaceholder ? COLORS.pill : statusColor(match.status)}" />`,
      `<text x="${x + CARD_WIDTH - 54}" y="${y + 32}" text-anchor="middle" fill="${isStructuralPlaceholder ? COLORS.text : COLORS.background}" font-family="${FONT_STACK}" font-size="11" font-weight="700">${escapeXml(statusLabel)}</text>`,
      isStructuralPlaceholder
        ? ""
        : this.renderPlayerRow(x + 18, y + 60, match.player1Name || " ", winnerIsPlayer1),
      isStructuralPlaceholder
        ? ""
        : this.renderPlayerRow(x + 18, y + 88, match.player2Name || " ", winnerIsPlayer2),
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
      `<text x="${x}" y="${y}" fill="${winner ? COLORS.text : "#dce8ff"}" font-family="${FONT_STACK}" font-size="17" font-weight="${winner ? 700 : 600}">${escapeXml(truncate(name, 26))}</text>`
    ].join("");
  }

  private renderPlacementCard(x: number, y: number, width: number, entry: PlacementEntry): string {
    return [
      `<rect x="${x}" y="${y}" width="${width}" height="${PLACEMENT_CARD_HEIGHT}" rx="18" fill="${COLORS.card}" stroke="${COLORS.border}" stroke-width="2" />`,
      `<text x="${x + 22}" y="${y + 37}" fill="${COLORS.text}" font-family="${FONT_STACK}" font-size="18" font-weight="700">${escapeXml(truncate(entry.displayName, 24))}</text>`
    ].join("");
  }

  private renderPlacementSection(
    cards: string[],
    width: number,
    startY: number,
    heading: string,
    entries: PlacementEntry[],
    rowGap: number,
    headingHeight: number,
    columnCount: number,
    cardWidth: number
  ): number {
    if (entries.length === 0) {
      return startY;
    }

    cards.push(
      `<text x="${LEFT_PAD}" y="${startY + 18}" fill="${COLORS.muted}" font-family="${FONT_STACK}" font-size="15" font-weight="700" letter-spacing="0.8">${escapeXml(heading.toUpperCase())}</text>`
    );

    const actualColumns = Math.min(columnCount, this.resolvePlacementColumns(entries.length));
    const columnWidth = cardWidth;
    const gridStartY = startY + headingHeight;

    entries.forEach((entry, index) => {
      const column = Math.floor(index / PLACEMENT_MAX_ROWS);
      const row = index % PLACEMENT_MAX_ROWS;
      const x = LEFT_PAD + column * (columnWidth + PLACEMENT_COLUMN_GAP);
      const y = gridStartY + row * (PLACEMENT_CARD_HEIGHT + rowGap);
      cards.push(this.renderPlacementCard(x, y, columnWidth, entry));
    });

    const rows = Math.min(PLACEMENT_MAX_ROWS, entries.length);
    return gridStartY + rows * PLACEMENT_CARD_HEIGHT + Math.max(0, rows - 1) * rowGap;
  }

  private resolvePlacementColumns(entryCount: number): number {
    if (entryCount <= 0) {
      return 1;
    }

    return Math.min(PLACEMENT_COLUMNS, Math.ceil(entryCount / PLACEMENT_MAX_ROWS));
  }

  private resolvePlacementCardWidth(entries: PlacementEntry[]): number {
    if (entries.length === 0) {
      return PLACEMENT_CARD_MIN_WIDTH;
    }

    const longestVisibleNameLength = Math.max(
      ...entries.map((entry) => truncate(entry.displayName, 24).length)
    );

    const estimatedTextWidth = longestVisibleNameLength * 10.5;
    const desiredWidth = Math.ceil(estimatedTextWidth + 44);

    return Math.max(PLACEMENT_CARD_MIN_WIDTH, Math.min(PLACEMENT_CARD_MAX_WIDTH, desiredWidth));
  }

  private wrapSvg(model: BracketRenderModel, width: number, height: number, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${body}
</svg>`;
  }
}
