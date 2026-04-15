import { Resvg } from "@resvg/resvg-js";

import { BracketSvgRenderer } from "./bracket-svg-renderer.js";
import type { BracketRenderModel } from "./types.js";

export class BracketImageRenderer {
  public constructor(private readonly svgRenderer = new BracketSvgRenderer()) {}

  public renderPng(model: BracketRenderModel): Buffer {
    const svg = this.svgRenderer.render(model);
    const rendered = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: 1800
      }
    }).render();

    return rendered.asPng();
  }
}
