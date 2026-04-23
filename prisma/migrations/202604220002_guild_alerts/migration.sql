ALTER TABLE "GuildConfig"
  ADD COLUMN "liveAlertsChannelId" TEXT,
  ADD COLUMN "twitchAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "twitchUsername" TEXT,
  ADD COLUMN "twitchUserId" TEXT,
  ADD COLUMN "twitchNotificationRoleId" TEXT,
  ADD COLUMN "twitchLastStreamId" TEXT,
  ADD COLUMN "twitchLastStartedAt" TIMESTAMP(3),
  ADD COLUMN "youtubeAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "youtubeChannelId" TEXT,
  ADD COLUMN "youtubeNotificationRoleId" TEXT,
  ADD COLUMN "youtubeLastVideoId" TEXT,
  ADD COLUMN "notificationRoleMessageChannelId" TEXT,
  ADD COLUMN "notificationRoleMessageId" TEXT;
