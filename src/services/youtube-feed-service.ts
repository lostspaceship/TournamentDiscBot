import { ValidationError } from "../utils/errors.js";

export interface YouTubeFeedEntry {
  videoId: string;
  channelId: string;
  title: string;
  url: string;
  publishedAt: string;
}

const extractTag = (source: string, tagName: string): string | null => {
  const match = source.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim() ?? null;
};

const decodeXml = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");

export class YouTubeFeedService {
  public normalizeChannelId(input: string): string {
    const trimmed = input.trim();
    if (/^UC[\w-]{10,}$/.test(trimmed)) {
      return trimmed;
    }

    const directMatch = trimmed.match(/channel\/(UC[\w-]{10,})/i);
    if (directMatch?.[1]) {
      return directMatch[1];
    }

    const feedMatch = trimmed.match(/channel_id=(UC[\w-]{10,})/i);
    if (feedMatch?.[1]) {
      return feedMatch[1];
    }

    throw new ValidationError("Use a YouTube channel ID or a channel URL that includes the channel ID.");
  }

  public async getLatestVideo(channelId: string): Promise<YouTubeFeedEntry | null> {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!response.ok) {
      throw new ValidationError(`YouTube feed request failed with ${response.status}.`);
    }

    const xml = await response.text();
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
    if (!entryMatch?.[1]) {
      return null;
    }

    const entryXml = entryMatch[1];
    const videoId = extractTag(entryXml, "yt:videoId");
    const resolvedChannelId = extractTag(entryXml, "yt:channelId") ?? channelId;
    const title = extractTag(entryXml, "title");
    const publishedAt = extractTag(entryXml, "published");
    const linkMatch = entryXml.match(/<link[^>]+href="([^"]+)"/i);
    const url = linkMatch?.[1] ?? null;

    if (!videoId || !title || !publishedAt || !url) {
      throw new ValidationError("Could not parse the YouTube feed response.");
    }

    return {
      videoId,
      channelId: resolvedChannelId,
      title: decodeXml(title),
      url,
      publishedAt
    };
  }
}
