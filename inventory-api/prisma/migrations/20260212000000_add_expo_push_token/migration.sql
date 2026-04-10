-- Add Expo push token to users for task notifications
ALTER TABLE "users" ADD COLUMN "expo_push_token" TEXT;
