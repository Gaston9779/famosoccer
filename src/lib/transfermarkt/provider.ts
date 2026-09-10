import { TransfermarktClient } from "./client";
import { endpoints, playerUrl, tmapiPerformanceUrl } from "./endpoints";
import { parseListings } from "./parsers/listings";
import { parseProfile } from "./parsers/profile";
import { parsePerformance } from "./parsers/performance";
export class TransfermarktProvider {
  constructor(public client: TransfermarktClient) {}
  async teams() {
    return parseListings(await this.client.request(endpoints.teams));
  }
  async players(id: string) {
    return parseListings(await this.client.request(endpoints.players(id)));
  }
  async fetchPlayerProfile(id: string, canonicalUrl?: string | null) {
    const path = canonicalUrl
      ? playerUrl(new URL(canonicalUrl, "https://www.transfermarkt.com").href)
          .path
      : endpoints.profile(id);
    return parseProfile(
      await this.client.request(path, "html"),
      id,
      `https://www.transfermarkt.com${path}`,
    );
  }
  async performance(playerId: string) {
    const performance = tmapiPerformanceUrl(playerId);
    return parsePerformance(
      await this.client.request(
        performance.path,
        "json",
        { baseUrl: "https://tmapi.transfermarkt.technology" },
      ),
    );
  }
}
