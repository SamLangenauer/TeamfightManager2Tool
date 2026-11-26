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
- **Next actions:** what to do next as a manager, measured on the save's own pro games. It suggests lineup changes, which strong champions to train on which starter when nobody in your five plays them (skipping champions the player dislikes), contract decisions (re-sign, extend early, let expire, trim the bench, starters paid well above the market rate), and signings ranked by win chance gained per million of salary, with free agents and contracts ending this year first. It also shows your promotion race and fan pool. Players are rated by **impact**: a weighted average of their 12 stats, with the weights learned from which stats the winning lineups had more of. On the newest 20% of pro games it picks the winner 63.6% of the time, against 59.8% for the plain stat average. Last hit, skill dodge and skill accuracy count most; teamwork and aggression made no measurable difference. Market rates come from a fit on every contract in the save (impact, potential and age explain 90% of salary differences). In pro games, players on a champion with under 100 proficiency won 42% of the time, with 200 to 349 57%, and with 500 or more 60%.
- **Draft:** pick your opponent and your side, then enter each ban and pick as it happens in the game. Every suggestion shows why it scored that way: meta strength, how well it fits your players, synergy with your picks, how it does against their picks, team composition, and what it takes away from them. When it's their turn, it shows what they are likely to do. A win chance updates after every pick, and each suggested pick shows your win chance if you take it.
- **Fearless series:** turn on Fearless on the Draft page (hard: nobody can repick a champion used earlier in the series; soft: each team cannot repick its own) and set best of 3, 5 or 7. Each finished game's picks are carried into the next game when you move on, and you can add champions from earlier games by hand. Suggestions skip locked champions, value taking a champion away from the opponent for the rest of the series, and weigh saving your players' best champions for later games.
- **Game plan:** once both teams have picked, the Draft page suggests a four-slot item build for each of your players and a choice for each team tactic. With your game file read, builds are worked out from each kit. Damage items are first limited to the ones that fit the champion: with 15 or more pro builds, the damage lines pros actually put on it (any line in under 8% of their slots is left out) and the same number of damage items they usually carry; with fewer, the stats its abilities scale with, plus AD and Attack Speed only when basic attacks are most of its damage. This stops the math from putting AD and Attack Speed on ability champions, whose basic attacks the game data lists as plain physical hits. The remaining sets of four items are scored on the damage they add after the enemy's armor and magic resist, and on how much longer they keep the champion alive against the enemy draft's actual damage (physical, magic, basic attacks vs abilities). Frontliners lean toward survival, carries toward damage, and backline champions lean toward survival when the enemy has divers. Slots are ordered so each adds the most at that point, with the reason shown, and the pro record for the same set is shown as a second opinion. Without the game file, builds come from what pro players set on each champion and how those games went. If the enemy ends up playing a champion in a different role, set it on the board and the plan updates. Tactics are rules applied to the draft, because the save does not record which tactics teams used. With your game file read, the rules use each kit profile instead of champion tags: teamfight strength is crowd control, toughness and area damage; side-lane splitters are bruisers and divers who sustain or soak damage; gankers are junglers with a gap closer plus burst or hard crowd control; dives count divers and mobile frontliners; and when they have two or more divers against two or more of your backline carries, the defense suggestion is to stay together. Whatever you pick is saved with the result, so your record with each choice builds up on the Results page.
- **Compositions:** with your game file read, the Draft page shows what each side's draft is built to do. It scores six styles from the five kits: dive (gap closers and burst), poke and siege (range and zones), pick (single-target catches), protect the carry (one damage dealer plus heals, shields and peel), teamfight (area crowd control with area damage) and split push (a side laner who wins alone). It then gives a win condition, what each side is missing (no frontline, no engage, one damage type, no peel against divers, no healing cut against healing), who the main damage dealer is and how much gold that role gets, range matchups in each lane, and the pro record of one style against the other. Suggestions carry short kit reasons such as "Gives you a frontline", "Builds your dive" or "Out-ranged by Archer in Mid with little way in". Tactics follow the draft's style (dive towers with a dive draft, siege from range with poke, split with a strong side laner), and item builds lean toward survival against pick and poke drafts. Champion pages show finer types (engage tank, peel tank, juggernaut, skirmisher, assassin, hypercarry, utility carry, burst mage, artillery, enchanter, catcher, area controller and more) and every buff and debuff in the kit, with who it hits and for how long.
- **Combos:** pairs and trios that work together. With your game file read, every pair is checked for kit links: attack buffs on an auto-attacker (and buffs that stack with its own, like Plague Doctor on Siege Breaker), heals, shields or protection on a carry, peel for a carry, area crowd control into area damage, chained crowd control, engage with a follow-up, a catch with burst, resistance shred for a carry, cooldown cuts for a caster, and speed into a dive. Each pair shows its pro record together against what the two champions win apart ("lift"), and your own record with it. Trios with 12 or more pro games together are ranked the same way. Champion pages list the best partners, and draft suggestions say which of your picks a champion pairs with.
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

## What the pro games say about compositions

Every composition factor was checked on the save's 2,665 pro games, the same way as the model's own features: trained on older games, tested on newer ones.

- On their own, the composition styles predict about 58% of winners, and range about 55%. So they capture something real.
- On top of the win model they add nothing (accuracy −0.4 points). Champion strength, synergy and matchup stats already contain the same information. For that reason the styles, missing pieces, range and lane factors explain suggestions but do not change their scores.
- Patterns in this save: dive drafts won 70% of 277 games against poke drafts and 64% against protect drafts. Poke drafts won only 36% against split push. Teams missing a way to start fights won only 30%, and teams without a frontline 42%. A longer range in lane did not help on its own: the side with more lane range won only 40%, because melee and dive champions are strong in this save.
- Gold by role (pro average per game): Bottom 2,868, Jungle 2,659, Mid 2,534, Top 2,469, Support 1,280. A gold lead in Mid goes with a win most often (63%).
- In the first 40 games of a patch, when champion stats are still thin, the kit factors did improve the model, but that test covers only 40 games, so it is weak evidence.

The per-game player stats (gold, CS, kills, deaths, damage) are stored by role, not by pick order. The app now reads them that way, so the champion page's average damage and each player's game log are correct.

## What the pro games say about combos

- Pairs with a kit link won about as often together as apart (+0.05 points on average over 38,618 pair-games), the same as pairs without one (−0.2 points). Across 951 pairs with 15+ games, kit link strength and pro lift barely relate (rank correlation 0.03).
- Some pairs really do win more together: 36 pairs are more than two standard deviations above expectation, where chance would give about 22. But a pair's lift in the older half of the games only weakly predicts its lift in the newer half (rank correlation 0.12), so treat a single pair's record with care, and lean on pairs with many games.
- Plague Doctor with Siege Breaker: the kits link strongly (stacking attack buffs, attack buffs on an auto-attacker, and keeping it alive), but pros won 17 of 32 games together, about what the two win apart (55%).
- Adding a team's total kit combo strength to the win model made no reliable difference (between 0 and +0.5 points depending on small details), so it is not part of the win chance. Combos explain suggestions; they do not change scores.

## Ask Claude (Claude artifact)

The same app also runs as a Claude artifact. There the Draft page gets an **Ask Claude** tab, and an **Ask** button on each suggestion. A question goes to Claude on the viewer's own Claude account with the live draft: both teams, bans and picks with roles, each lineup player's best champions, the app's suggestions with their score parts, the win chance, compositions, range warnings and the patch meta. Claude can also call four page functions to look up more numbers from the save (`champion_info`, `win_chance`, `player_pool`, `pair_record`). The save itself is never sent.

- `artifact.html` is the artifact's page: `index.html` without the html, head and body tags, which the publisher adds. Everything else is the same files as the site.
- `js/askclaude.js` holds the chat. It only shows when `window.claude.use('sample')` answers, so on GitHub Pages the tab stays hidden.
- To publish an update, publish `artifact.html` with every file under `js/`, `css/app.css` and `data/champions.tsv` (as `text/plain`), and the `sample` capability.
- Saves are decoded in a worker, or on the page if a view does not allow workers.

## Hosting on GitHub Pages

In the repository, go to Settings, then Pages. Under "Build and deployment", choose "Deploy from a branch", pick `main` and `/ (root)`, and save. The site appears at `https://<user>.github.io/TeamfightManager2Tool/` after a minute or two.

## Development

No build step. Plain ES modules:

- `js/decoder.js` reads the save format (see the comments there).
- `js/worker.js` decodes in a Web Worker.
- `js/model.js` builds indexes and statistics.
- `js/gamefiles.js` reads champion kits from the game's `bundle.game_data`; `js/kits.js` fills in ability descriptions; `js/profile.js` builds kit profiles; `js/effects.js` reads each buff and debuff; `js/comps.js` works out champion types, composition styles, missing pieces and range matchups; `js/compview.js` shows them on the Draft page; `js/combos.js` finds kit combos and their pro record, and `js/comboview.js` is the Combos page.
- `js/manager.js` works out the Next actions advice (impact weights, market rates, training, contracts, signings); `js/nextview.js` is its page.
- `js/draft.js` is the draft engine; `js/draftview.js` is its page.
- `js/views.js` holds the other pages.

`node tools/test-decode.mjs <save file>` decodes a save in Node and prints a summary.
