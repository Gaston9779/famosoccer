import { playingTimePercent, selectCurrentPerformance } from "@/lib/current-performance";

export type SportingPerformance = {
  season: string;
  competitionKey: string;
  competitionName?: string;
  possibleGames: number | null;
  gamesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  secondYellowCards: number | null;
  redCards: number | null;
  startElevenPercent: number | null;
  minutesPlayedPercent: number | null;
  minutesPlayed: number | null;
};

export function currentUz1Sporting<T extends Pick<SportingPerformance, "season" | "competitionKey">>(performances: T[]): T | null {
  return selectCurrentPerformance(performances, "UZ1");
}

export function displayStat(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "–" : new Intl.NumberFormat("en-US").format(value);
}

export function displayPercent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "–" : `${Number(value.toFixed(1))}%`;
}

function displayMinutes(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "–" : `${new Intl.NumberFormat("en-US").format(value)}'`;
}

export function PlayerSportingCard({
  performance,
  scope = "UZ1",
}: {
  performance: SportingPerformance | null;
  scope?: "UZ1" | "ITA" | "FRA";
}) {
  const involvement = playingTimePercent(performance);
  const involvementWidth = involvement == null || !Number.isFinite(involvement) ? 0 : Math.min(100, Math.max(0, involvement));
  const primary = performance ? [
    ["Appearances", displayStat(performance.gamesPlayed)],
    ["Minutes", displayMinutes(performance.minutesPlayed)],
    ["Goals", displayStat(performance.goals)],
    ["Assists", displayStat(performance.assists)],
  ] : [["Appearances", "–"], ["Minutes", "–"], ["Goals", "–"], ["Assists", "–"]];
  const secondary = performance ? [
    ["Start XI", displayPercent(performance.startElevenPercent)],
    ["Minutes %", displayPercent(involvement)],
    ["Possible games", displayStat(performance.possibleGames)],
    ["Yellow cards", displayStat(performance.yellowCards)],
  ] : [["Start XI", "–"], ["Minutes %", "–"], ["Possible games", "–"], ["Yellow cards", "–"]];

  return <section className="player-sporting-card" aria-labelledby="sporting-title">
    <header className="player-sporting-header">
      <div><h2 id="sporting-title">Sporting</h2><p>{performance ? (scope === "UZ1" ? "2026 · Uzbekistan Super League" : `${performance.season} · ${performance.competitionName ?? performance.competitionKey}`) : null}</p></div>
      <span className="player-sporting-current">Current season</span>
    </header>
    <div className="player-sporting-primary">
      {primary.map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}
    </div>
    <div className="player-sporting-secondary">
      {secondary.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
    </div>
    <div className="player-sporting-involvement">
      <div><span>Playing involvement</span><b>{displayPercent(involvement)}</b></div>
      <div className="player-sporting-bar" role="progressbar" aria-label="Playing involvement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={involvement == null || !Number.isFinite(involvement) ? undefined : involvementWidth}><i style={{ width: `${involvementWidth}%` }} /></div>
    </div>
    <footer className="player-sporting-discipline"><span>Discipline</span><p><b>YC</b> {displayStat(performance?.yellowCards)} <i>·</i> <b>2YC</b> {displayStat(performance?.secondYellowCards)} <i>·</i> <b>RC</b> {displayStat(performance?.redCards)}</p></footer>
    {!performance && <p className="player-sporting-empty">No current-season sporting data available.</p>}
  </section>;
}
