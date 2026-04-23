import { env } from "../config/env.js";
import { ValidationError } from "../utils/errors.js";

interface TwitchAccessTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface TwitchUserProfile {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

export interface TwitchLiveStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  title: string;
  gameName: string;
  startedAt: string;
  thumbnailUrl: string;
  viewerCount: number;
}

export class TwitchApiService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  public isConfigured(): boolean {
    return Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
  }

  public async getUserByLogin(login: string): Promise<TwitchUserProfile | null> {
    const response = await this.helixRequest(`users?login=${encodeURIComponent(login.trim().toLowerCase())}`);
    const payload = await response.json() as {
      data?: Array<{
        id: string;
        login: string;
        display_name: string;
        profile_image_url: string;
      }>;
    };
    const user = payload.data?.[0];

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url
    };
  }

  public async getLiveStreamByUserId(userId: string): Promise<TwitchLiveStream | null> {
    const response = await this.helixRequest(`streams?user_id=${encodeURIComponent(userId)}`);
    const payload = await response.json() as {
      data?: Array<{
        id: string;
        user_id: string;
        user_login: string;
        user_name: string;
        title: string;
        game_name: string;
        started_at: string;
        thumbnail_url: string;
        viewer_count: number;
      }>;
    };
    const stream = payload.data?.[0];

    if (!stream) {
      return null;
    }

    return {
      id: stream.id,
      userId: stream.user_id,
      userLogin: stream.user_login,
      userName: stream.user_name,
      title: stream.title,
      gameName: stream.game_name,
      startedAt: stream.started_at,
      thumbnailUrl: stream.thumbnail_url,
      viewerCount: stream.viewer_count
    };
  }

  private async helixRequest(path: string): Promise<Response> {
    const token = await this.getAppAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Client-Id": env.TWITCH_CLIENT_ID!
      }
    });

    if (!response.ok) {
      throw new ValidationError(`Twitch API request failed with ${response.status}.`);
    }

    return response;
  }

  private async getAppAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ValidationError("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET before enabling Twitch alerts.");
    }

    const refreshThresholdMs = 60_000;
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - refreshThresholdMs) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID!,
      client_secret: env.TWITCH_CLIENT_SECRET!,
      grant_type: "client_credentials"
    });
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      throw new ValidationError(`Twitch token request failed with ${response.status}.`);
    }

    const payload = await response.json() as TwitchAccessTokenResponse;
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = Date.now() + payload.expires_in * 1000;
    return this.accessToken;
  }
}
