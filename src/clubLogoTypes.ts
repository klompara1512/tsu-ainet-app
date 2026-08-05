export type ClubLogoSource = "manual-upload" | "manual-url" | "imported";

export type ClubLogoEntry = {
  id: string;
  clubName: string;
  normalizedName: string;
  aliases: string[];
  normalizedAliases: string[];
  logoUrl: string;
  storagePath: string;
  source: ClubLogoSource;
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  updatedByUid: string;
  updatedByName: string;
  schemaVersion: 1;
};

export type ClubLogoInput = {
  clubName: string;
  aliases?: string[];
  logoUrl?: string;
  storagePath?: string;
  source?: ClubLogoSource;
  active?: boolean;
  updatedByUid?: string;
  updatedByName?: string;
};
