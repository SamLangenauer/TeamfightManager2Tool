# TFM2 Analyst

A browser companion for Teamfight Manager 2. Load a save file to browse it, scout teams, study the meta, and get help while you draft in the game.

Everything runs in your browser. The save never leaves your computer, and there is no server.

An unofficial fan tool. Not affiliated with Team Samoyed.

## Using it

1. Open the site (see "Hosting" below), or serve this folder locally with `python3 -m http.server` and open http://localhost:8000.
2. Click the drop area and pick a save file, or drag it onto the page. Saves live here on Windows:
   `%APPDATA%\TeamSamoyed\TeamfightManager2\data\save_*.data`
3. Optional: choose `bundle.game_data` from the game folder so the app can read every champion's abilities. You only need to do this once per game update.
4. Decoding takes a few seconds. The last save you opened is remembered, so next time you can click "Open it again".

The game files are only read, never changed.

## What's in it

- **Home:** your team's record, standings for your league and a quick link to the draft.
- **Players:** every athlete with stats, position ratings, potential, contract and champion pool. Filter by region, team, role or free agents, and keep a watchlist.
- **Teams:** each team's roster, starting five, record, most picked champions, what they ban and what gets banned against them. Use it to scout your next opponent, then jump straight into a draft against them.
- **Scout:** find players to sign. Filter by role, age, potential, league, free agents or expiring contracts, ranked by current level, room to grow and recent form.
- **Meta:** pick, ban and win rates per champion for any patch, region or league, plus the best pairs and counters.
- **Games:** every pro game in the save, with drafts, scores and per-player stats.
- **Draft:** pick your opponent and your side, then enter each ban and pick as it happens in the game. Every suggestion shows why it scored that way: meta strength, how well it fits your players, synergy with your picks, how it does against their picks, team composition, and what it takes away from them. When it's their turn, it shows what they are likely to do. A win chance updates after every pick, and each suggested pick shows your win chance if you take it.
- **Fearless series:** turn on Fearless on the Draft page (hard: nobody can repick a champion used earlier in the series; soft: each team cannot repick its own) and set best of 3, 5 or 7. Each finished game's picks are carried into the next game when you move on, and you can add champions from earlier games by hand. Suggestions skip locked champions, value taking a champion away from the opponent for the rest of the series, and weigh saving your players' best champions for later games.
- **Game plan:** once both teams have picked, the Draft page suggests a four-slot item build for each of your players and a choice for each team tactic. Builds come from what pro players set on each champion and how those games went, adjusted for whether the enemy deals mostly physical or magic damage. If the enemy ends up playing a champion in a different role, set it on the board and the plan updates. Tactics are rules applied to the draft, because the save does not record which tactics teams used. Whatever you pick is saved with the result, so your record with each choice builds up on the Results page.
- **Results:** when a draft is done, record whether you won. The win model retrains right away and the suggestions change with it. This page shows how accurate the model is, what it has learned decides games, and which champions are doing better or worse than expected for you. Your match history stays in your browser and is kept whatever save you load, so you can load a fresh save before every game. If you are not sure of the result yet, choose "Fill it in from my next save": when you load a save that contains that game, the result is filled in (and any result you entered is checked against it). Export the history to back it up.

## How the win model learns

The win chance comes from a logistic regression on seven draft features, each compared between the two teams: player and role fit, champion strength, synergy, matchups, team composition, overall player strength, and which side picks first. It is trained on every pro game in the save. Each game's own result is left out of the stats used to describe it, so it cannot cheat.

On the newest 20% of pro games, held out from training, it picks the winner about 70% of the time. The old hand-made formula managed about 65%.

Each result you record counts as five pro games. The learned weights then scale the matching parts of the draft suggestions (between ×0.25 and ×3). Champions that beat or miss the model's expectations in your games get a small "Your results" bonus or penalty. Loading a newer save also adds every game played since, including yours.

## Notes on the data

- Winners are read from the final score of each game. This agrees with series results about 96% of the time.
- Potential and the other hidden traits are the true values stored in the save, not the scouted estimates the game shows you.
- Champion data (names, roles, stats and skills) is in `data/champions.tsv`, taken from the game's data file.
- Champion kits are not shipped with the site. Point the app at your own `bundle.game_data` once (load screen or any champion page; in Steam: Manage, then Browse local files). The app reads only the champion data from it, in your browser, and keeps it there until you read it again after a game update. Each champion page then shows every ability with its numbers filled in, and a kit profile: how it plays (frontline, diver, backline carry, poke, bruiser, enchanter or control), its physical and magic damage split, burst, damage over a fight, area damage, toughness, crowd control, range, what it does for allies, and what it threatens. Profiles use base values at level 6. Against the save's season stats, the damage estimate ranks champions in close agreement with real damage dealt (rank correlation 0.64), and toughness with damage taken (0.63). Healing is only roughly estimated, because most of it comes from passives and items.

## Hosting on GitHub Pages

In the repository, go to Settings, then Pages. Under "Build and deployment", choose "Deploy from a branch", pick `main` and `/ (root)`, and save. The site appears at `https://<user>.github.io/TeamfightManager2Tool/` after a minute or two.

## Development

No build step. Plain ES modules:

- `js/decoder.js` reads the save format (see the comments there).
- `js/worker.js` decodes in a Web Worker.
- `js/model.js` builds indexes and statistics.
- `js/gamefiles.js` reads champion kits from the game's `bundle.game_data`; `js/kits.js` fills in ability descriptions; `js/profile.js` builds kit profiles.
- `js/draft.js` is the draft engine; `js/draftview.js` is its page.
- `js/views.js` holds the other pages.

`node tools/test-decode.mjs <save file>` decodes a save in Node and prints a summary.
