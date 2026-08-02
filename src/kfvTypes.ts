export type KfvMatchStatus = "scheduled" | "finished" | "postponed" | "cancelled";

export type KfvMatch = {
  id: string;
  teamId: string;
  teamName: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  homeLogoUrl: string;
  awayLogoUrl: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffAt: Date;
  venue: string;
  venueAddress: string;
  referee: string;
  liveUrl: string;
  status: KfvMatchStatus;
  reportUrl: string;
  sourceUpdatedAt: Date | null;
  active: boolean;
};

export type KfvStandingRow = {
  id: string;
  teamId: string;
  teamName: string;
  competitionName: string;
  position: number;
  clubName: string;
  teamLogoUrl: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  active: boolean;
};


export type KfvSquadPlayer = {
  id: string;
  teamId: string;
  teamName: string;
  name: string;
  number: number | null;
  position: string;
  imageUrl: string;
  profileUrl: string;
  birthday: Date | null;
  active: boolean;
};


export type KfvClub = {
  id: string;
  name: string;
  normalizedName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  stadium: string;
  website: string;
  active: boolean;
};


export type KfvLineupPlayer = {
  name: string;
  number: number | null;
  position: string;
  playerUrl: string;
  captain: boolean;
};

export type KfvMatchEventType =
  | "goal"
  | "yellow"
  | "yellowRed"
  | "red"
  | "substitution"
  | "halfTime"
  | "fullTime"
  | "other";

export type KfvMatchEvent = {
  id: string;
  type: KfvMatchEventType;
  minute: number | null;
  minuteText: string;
  team: "home" | "away" | "neutral";
  playerName: string;
  secondaryPlayerName: string;
  description: string;
};

export type KfvMatchReport = {
  id: string;
  matchId: string;
  matchUid: string;
  oefbMatchId: string;
  reportUrl: string;
  homeTeam: string;
  awayTeam: string;
  homeLineup: KfvLineupPlayer[];
  awayLineup: KfvLineupPlayer[];
  homeBench: KfvLineupPlayer[];
  awayBench: KfvLineupPlayer[];
  homeCoach: string;
  awayCoach: string;
  referee: string;
  attendance: number | null;
  events: KfvMatchEvent[];
  sourceUpdatedAt: Date | null;
  active: boolean;
};
