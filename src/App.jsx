import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================
// CONSTANTS
// ============================================================

const STAR_SIGNAL_TYPES = {
  STATIC_TIER: 'STATIC_TIER',
  TEAM_STARS: 'TEAM_STARS',
  MINUTES_LEADER: 'MINUTES_LEADER',
  ESPN_STARTER: 'ESPN_STARTER',
  USAGE_LEADER: 'USAGE_LEADER',
};

const UNAVAILABLE_STATUSES = [
  'Out', 'Injured Reserve', 'IR', 'Doubtful',
  'Suspended', 'Day-To-Day', 'Questionable',
];

const AVAILABLE_STATUSES = ['Active', 'Probable', 'Available'];

const SPORT_CONFIG = {
  nba: { label: 'NBA', path: 'basketball/nba', color: 'orange', emoji: null },
  nfl: { label: 'NFL', path: 'football/nfl', color: 'green', emoji: null },
  mlb: { label: 'MLB', path: 'baseball/mlb', color: 'red', emoji: null },
};

const CACHE_TTL = 5 * 60 * 1000; // 5 min

// ============================================================
// STATIC PLAYER DATA (2024-25 Season)
// One signal source among many — multi-signal system
// ============================================================

const NBA_PLAYERS = {
  MVP_TIER: [
    'LeBron James', 'Stephen Curry', 'Giannis Antetokounmpo',
    'Nikola Jokic', 'Luka Doncic', 'Joel Embiid', 'Jayson Tatum',
    'Kevin Durant', 'Shai Gilgeous-Alexander', 'Anthony Edwards',
  ],
  ALL_STAR: [
    'Donovan Mitchell', 'Trae Young', 'Tyrese Haliburton', 'Ja Morant',
    "De'Aaron Fox", 'Devin Booker', 'Kyrie Irving', 'Jimmy Butler',
    'Bam Adebayo', 'Paolo Banchero', 'Jaylen Brown', 'Domantas Sabonis',
    'LaMelo Ball', 'Cade Cunningham', 'Jalen Brunson', 'Karl-Anthony Towns',
    'Julius Randle', 'Damian Lillard', 'Victor Wembanyama', 'Zion Williamson',
    'Alperen Sengun', 'Franz Wagner', 'Scottie Barnes', 'Desmond Bane',
    'Tyler Herro', 'Anthony Davis',
  ],
  TEAM_STARS: {
    LAL: ['LeBron James', 'Anthony Davis'],
    GSW: ['Stephen Curry', 'Jimmy Butler'],
    MIL: ['Giannis Antetokounmpo', 'Damian Lillard'],
    DEN: ['Nikola Jokic'],
    DAL: ['Luka Doncic', 'Kyrie Irving'],
    PHI: ['Joel Embiid'],
    BOS: ['Jayson Tatum', 'Jaylen Brown'],
    PHX: ['Kevin Durant', 'Devin Booker'],
    OKC: ['Shai Gilgeous-Alexander'],
    MIN: ['Anthony Edwards', 'Julius Randle'],
    CLE: ['Donovan Mitchell'],
    ATL: ['Trae Young'],
    IND: ['Tyrese Haliburton'],
    MEM: ['Ja Morant', 'Desmond Bane'],
    SAC: ["De'Aaron Fox", 'Domantas Sabonis'],
    MIA: ['Bam Adebayo', 'Tyler Herro'],
    ORL: ['Paolo Banchero', 'Franz Wagner'],
    CHA: ['LaMelo Ball'],
    DET: ['Cade Cunningham'],
    NYK: ['Jalen Brunson', 'Karl-Anthony Towns'],
    SAS: ['Victor Wembanyama'],
    NOP: ['Zion Williamson'],
    HOU: ['Alperen Sengun'],
    TOR: ['Scottie Barnes'],
    LAC: [], BKN: [], CHI: [], WAS: [], POR: [], UTA: [],
  },
};

const NFL_PLAYERS = {
  MVP_TIER: [
    'Patrick Mahomes', 'Josh Allen', 'Lamar Jackson', 'Joe Burrow',
    'Jalen Hurts', 'Travis Kelce', 'Tyreek Hill', 'Justin Jefferson',
    'CeeDee Lamb', "Ja'Marr Chase",
  ],
  ALL_STAR: [
    'Micah Parsons', 'T.J. Watt', 'Nick Bosa', 'Myles Garrett',
    'Derrick Henry', 'Saquon Barkley', 'Christian McCaffrey', 'Davante Adams',
    'A.J. Brown', 'Amon-Ra St. Brown', 'Garrett Wilson', 'George Kittle',
    'Tua Tagovailoa', 'Dak Prescott', 'Jordan Love', 'Brock Purdy',
    'C.J. Stroud', 'Caleb Williams',
  ],
  TEAM_STARS: {
    KC: ['Patrick Mahomes', 'Travis Kelce'],
    BUF: ['Josh Allen'],
    BAL: ['Lamar Jackson', 'Derrick Henry'],
    CIN: ['Joe Burrow', "Ja'Marr Chase"],
    SF: ['Brock Purdy', 'Nick Bosa', 'Christian McCaffrey'],
    MIA: ['Tyreek Hill', 'Tua Tagovailoa'],
    MIN: ['Justin Jefferson'],
    DAL: ['CeeDee Lamb', 'Micah Parsons', 'Dak Prescott'],
    PHI: ['Jalen Hurts', 'A.J. Brown', 'Saquon Barkley'],
    PIT: ['T.J. Watt'],
    CLE: ['Myles Garrett'],
    DET: ['Amon-Ra St. Brown'],
    GB: ['Jordan Love'],
    HOU: ['C.J. Stroud'],
    CHI: ['Caleb Williams'],
    NYJ: ['Garrett Wilson'],
    LV: ['Davante Adams'],
    TEN: [],
    LAR: [], SEA: [], ARI: [], CAR: [], TB: [], NO: [],
    ATL: [], NYG: [], WAS: [], NE: [], IND: [], JAX: [],
    DEN: [], LAC: [],
  },
};

const MLB_PLAYERS = {
  MVP_TIER: [
    'Shohei Ohtani', 'Mookie Betts', 'Ronald Acuna Jr.', 'Corey Seager',
    'Freddie Freeman', 'Aaron Judge', 'Juan Soto', 'Bryce Harper',
    'Mike Trout', 'Trea Turner',
  ],
  ALL_STAR: [
    'Manny Machado', 'Fernando Tatis Jr.', 'Julio Rodriguez',
    'Bobby Witt Jr.', 'Gunnar Henderson', 'Marcus Semien', 'Jose Ramirez',
    'Vladimir Guerrero Jr.', 'Bo Bichette', 'Rafael Devers',
    'Yordan Alvarez', 'Kyle Tucker', 'Corbin Carroll', 'Elly De La Cruz',
    'Matt Olson',
  ],
  TEAM_STARS: {
    LAD: ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman'],
    NYY: ['Aaron Judge', 'Juan Soto'],
    ATL: ['Ronald Acuna Jr.', 'Matt Olson'],
    TEX: ['Corey Seager', 'Marcus Semien'],
    PHI: ['Bryce Harper', 'Trea Turner'],
    LAA: ['Mike Trout'],
    SD: ['Manny Machado', 'Fernando Tatis Jr.'],
    SEA: ['Julio Rodriguez'],
    KC: ['Bobby Witt Jr.'],
    BAL: ['Gunnar Henderson'],
    CLE: ['Jose Ramirez'],
    TOR: ['Vladimir Guerrero Jr.', 'Bo Bichette'],
    BOS: ['Rafael Devers'],
    HOU: ['Yordan Alvarez', 'Kyle Tucker'],
    ARI: ['Corbin Carroll'],
    CIN: ['Elly De La Cruz'],
    SF: [], CHC: [], STL: [], MIL: [], NYM: [], TB: [],
    MIN: [], DET: [], CHW: [], OAK: [], MIA: [], COL: [],
    PIT: [], WAS: [],
  },
};

// ============================================================
// RIVALRIES
// ============================================================

const RIVALRIES = {
  nba: [
    { teams: ['LAL', 'BOS'], intensity: 'historic', bonus: 15 },
    { teams: ['LAL', 'LAC'], intensity: 'city', bonus: 10 },
    { teams: ['NYK', 'BKN'], intensity: 'city', bonus: 10 },
    { teams: ['BOS', 'PHI'], intensity: 'division', bonus: 5 },
    { teams: ['GSW', 'LAL'], intensity: 'conference', bonus: 8 },
    { teams: ['GSW', 'CLE'], intensity: 'finals', bonus: 12 },
    { teams: ['MIA', 'BOS'], intensity: 'playoff', bonus: 8 },
    { teams: ['PHX', 'MIL'], intensity: 'finals', bonus: 8 },
    { teams: ['DAL', 'BOS'], intensity: 'finals', bonus: 8 },
    { teams: ['DEN', 'MIA'], intensity: 'finals', bonus: 8 },
    { teams: ['CHI', 'CLE'], intensity: 'division', bonus: 5 },
    { teams: ['PHI', 'NYK'], intensity: 'division', bonus: 7 },
  ],
  nfl: [
    { teams: ['KC', 'BUF'], intensity: 'playoff', bonus: 12 },
    { teams: ['DAL', 'PHI'], intensity: 'historic', bonus: 15 },
    { teams: ['SF', 'DAL'], intensity: 'historic', bonus: 12 },
    { teams: ['GB', 'CHI'], intensity: 'historic', bonus: 15 },
    { teams: ['BAL', 'PIT'], intensity: 'division', bonus: 10 },
    { teams: ['NYG', 'DAL'], intensity: 'division', bonus: 8 },
    { teams: ['SF', 'SEA'], intensity: 'division', bonus: 7 },
    { teams: ['NE', 'NYJ'], intensity: 'division', bonus: 7 },
    { teams: ['MIN', 'GB'], intensity: 'division', bonus: 7 },
    { teams: ['KC', 'LV'], intensity: 'division', bonus: 5 },
  ],
  mlb: [
    { teams: ['NYY', 'BOS'], intensity: 'historic', bonus: 15 },
    { teams: ['LAD', 'SF'], intensity: 'historic', bonus: 12 },
    { teams: ['CHC', 'STL'], intensity: 'historic', bonus: 12 },
    { teams: ['NYY', 'NYM'], intensity: 'city', bonus: 10 },
    { teams: ['LAD', 'SD'], intensity: 'division', bonus: 7 },
    { teams: ['ATL', 'NYM'], intensity: 'division', bonus: 5 },
    { teams: ['HOU', 'TEX'], intensity: 'state', bonus: 8 },
    { teams: ['PHI', 'NYM'], intensity: 'division', bonus: 5 },
  ],
};

// ============================================================
// IN-MEMORY CACHES
// ============================================================

const INJURY_CACHE = {};
const ROSTER_CACHE = {};

// ============================================================
// DATE / TIME UTILITIES
// ============================================================

const getCurrentTimeET = () => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
};

const getTodayDateET = () => {
  const et = getCurrentTimeET();
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const d = String(et.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDateStringET = (offsetDays = 0) => {
  const et = getCurrentTimeET();
  et.setDate(et.getDate() + offsetDays);
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const d = String(et.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const convertUTCToET = (utcTimestamp) => {
  if (!utcTimestamp) return null;
  try {
    const date = new Date(utcTimestamp);
    if (isNaN(date.getTime())) return null;
    const etStr = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const [month, day, year] = etStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch {
    return null;
  }
};

const classifyGameDate = (startTimeUTC) => {
  const todayET = getTodayDateET();
  const tomorrowET = getDateStringET(1);
  if (!startTimeUTC) return { label: 'upcoming', eligible: false };
  const gameDateET = convertUTCToET(startTimeUTC);
  if (!gameDateET) return { label: 'upcoming', eligible: false };
  if (gameDateET === todayET) return { label: 'today', eligible: true };
  if (gameDateET === tomorrowET) return { label: 'tomorrow', eligible: false };
  return { label: 'upcoming', eligible: false };
};

const formatGameTime = (utcTimestamp) => {
  if (!utcTimestamp) return '';
  try {
    const d = new Date(utcTimestamp);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';
  } catch {
    return '';
  }
};

const formatDateHeading = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
};

// ============================================================
// GAME STATUS HELPERS
// ============================================================

const isGameFinal = (status) => {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes('FINAL') || s.includes('POST') || s.includes('COMPLETE') ||
    s.includes('POSTPONED') || s.includes('CANCELED');
};

const isGameLive = (status) => {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.includes('IN_PROGRESS') || s.includes('LIVE') || s.includes('HALFTIME') ||
    (s.includes('IN ') && !s.includes('FINAL'));
};

const isGameWatchable = (status) => !status || !isGameFinal(status);

// ============================================================
// SPORT-SCOPED PLAYER LOOKUP
// ============================================================

const getPlayerDB = (sport) => {
  if (sport === 'nba') return NBA_PLAYERS;
  if (sport === 'nfl') return NFL_PLAYERS;
  if (sport === 'mlb') return MLB_PLAYERS;
  return { MVP_TIER: [], ALL_STAR: [], TEAM_STARS: {} };
};

const getPlayersForTeam = (teamAbbr, sport) => {
  const db = getPlayerDB(sport);
  return db.TEAM_STARS?.[teamAbbr] || [];
};

const getStarTiers = (sport) => {
  const db = getPlayerDB(sport);
  return { mvp: db.MVP_TIER || [], allStar: db.ALL_STAR || [] };
};

const getPlayerTier = (name, sport) => {
  const { mvp, allStar } = getStarTiers(sport);
  if (mvp.includes(name)) return 'mvp';
  if (allStar.includes(name)) return 'allstar';
  return null;
};

// ============================================================
// MULTI-SIGNAL STAR QUALIFICATION
// ============================================================

const evaluateStarSignals = (playerName, teamAbbr, sport, rosterCtx = {}) => {
  const signals = [];
  if (!playerName || !teamAbbr || !sport) {
    return { signals: [], count: 0, isNotableStar: false, isEmerging: false };
  }

  const { mvp, allStar } = getStarTiers(sport);
  if (mvp.includes(playerName) || allStar.includes(playerName)) {
    signals.push(STAR_SIGNAL_TYPES.STATIC_TIER);
  }

  const teamStars = getPlayersForTeam(teamAbbr, sport);
  if (teamStars.includes(playerName)) {
    signals.push(STAR_SIGNAL_TYPES.TEAM_STARS);
  }

  if (rosterCtx.minutesLeaders?.includes(playerName)) {
    signals.push(STAR_SIGNAL_TYPES.MINUTES_LEADER);
  }
  if (rosterCtx.espnStarters?.includes(playerName)) {
    signals.push(STAR_SIGNAL_TYPES.ESPN_STARTER);
  }
  if (rosterCtx.usageLeaders?.includes(playerName)) {
    signals.push(STAR_SIGNAL_TYPES.USAGE_LEADER);
  }

  const count = signals.length;
  return {
    signals,
    count,
    isNotableStar: count >= 2,
    isEmerging: count === 1,
    playerName,
    teamAbbr,
  };
};

const buildRosterContext = (roster) => {
  if (!roster?.length) return {};
  const espnStarters = roster.filter(p => p.starter).map(p => p.displayName).filter(Boolean);
  const sorted = [...roster].filter(p => p.displayName).sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
  const minutesLeaders = sorted.slice(0, 2).map(p => p.displayName);
  const byUsage = [...roster].filter(p => p.displayName && p.ppg).sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
  const usageLeaders = byUsage.slice(0, 2).map(p => p.displayName);
  return { espnStarters, minutesLeaders, usageLeaders };
};

// ============================================================
// INJURY CACHE HELPERS
// ============================================================

const normalizePlayerName = (name) => {
  if (!name) return '';
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};

const cacheKey = (sport, team, name) => `${sport}:${team}:${normalizePlayerName(name)}`;

const setInjuryCache = (sport, team, name, status) => {
  INJURY_CACHE[cacheKey(sport, team, name)] = { status, updatedAt: Date.now(), originalName: name };
};

const getInjuryCache = (sport, team, name) => {
  return INJURY_CACHE[cacheKey(sport, team, name)] || null;
};

const isUnavailableStatus = (status) => {
  if (!status) return false;
  return UNAVAILABLE_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()));
};

const isPlayerAvailable = (playerName, teamAbbr, sport, rosterCtx = {}) => {
  if (!playerName || !teamAbbr) return { available: true, verified: false };
  const cached = getInjuryCache(sport, teamAbbr, playerName);
  const eval_ = evaluateStarSignals(playerName, teamAbbr, sport, rosterCtx);

  if (eval_.isNotableStar) {
    if (cached && isUnavailableStatus(cached.status)) {
      return { available: false, verified: true, status: cached.status, star: true };
    }
    return { available: true, verified: !!cached, status: cached?.status || 'Expected', star: true };
  }

  if (cached && isUnavailableStatus(cached.status)) {
    return { available: false, verified: true, status: cached.status };
  }
  return { available: true, verified: !!cached, status: cached?.status || 'Unknown' };
};

// ============================================================
// ESPN API FUNCTIONS
// ============================================================

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const fetchJSON = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[Gamenight] Fetch error:', url, err);
    return null;
  }
};

const fetchScoreboard = async (sport, dateStr) => {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg) return null;
  const espnDate = dateStr.replace(/-/g, '');
  const url = `${ESPN_BASE}/${cfg.path}/scoreboard?dates=${espnDate}`;
  return fetchJSON(url);
};

const fetchTeamRoster = async (teamId, sport) => {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg) return null;
  const url = `${ESPN_BASE}/${cfg.path}/teams/${teamId}/roster`;
  return fetchJSON(url);
};

// ============================================================
// ESPN DATA TRANSFORMER
// ============================================================

const transformESPNEvent = (event, sport) => {
  if (!event) return null;
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const homeComp = competition.competitors?.find(c => c.homeAway === 'home');
  const awayComp = competition.competitors?.find(c => c.homeAway === 'away');
  if (!homeComp || !awayComp) return null;

  const extractTeam = (comp) => {
    const team = comp.team || {};
    return {
      id: team.id,
      name: team.displayName || team.name || 'Unknown',
      shortName: team.shortDisplayName || team.name || '',
      abbreviation: team.abbreviation || '',
      logo: team.logo || team.logos?.[0]?.href || '',
      color: team.color ? `#${team.color}` : '#333',
      record: comp.records?.[0]?.summary || '',
      score: comp.score || '0',
    };
  };

  const status = competition.status?.type?.name || '';
  const statusDetail = competition.status?.type?.shortDetail ||
    competition.status?.type?.detail || '';

  const broadcasts = competition.broadcasts?.flatMap(b => b.names || []) || [];
  const odds = competition.odds?.[0];

  const startTime = event.date || competition.date;
  const dateClass = classifyGameDate(startTime);

  return {
    id: event.id,
    sport,
    startTime,
    status,
    statusDetail,
    dateLabel: dateClass.label,
    eligibleForPick: dateClass.eligible,
    homeTeam: extractTeam(homeComp),
    awayTeam: extractTeam(awayComp),
    broadcast: broadcasts.join(', ') || null,
    odds: odds ? {
      spread: odds.details || '',
      overUnder: odds.overUnder ? `O/U ${odds.overUnder}` : '',
    } : null,
    venue: competition.venue?.fullName || '',
    isLive: isGameLive(status),
    isFinal: isGameFinal(status),
    headline: event.competitions?.[0]?.notes?.[0]?.headline || null,
  };
};

// ============================================================
// INJURY PREFETCH
// ============================================================

const prefetchInjuries = async (games, sport) => {
  if (!games?.length) return;

  const teamIds = new Set();
  const teamMap = {};
  games.forEach(g => {
    if (g.homeTeam?.id) {
      teamIds.add(g.homeTeam.id);
      teamMap[g.homeTeam.id] = g.homeTeam.abbreviation;
    }
    if (g.awayTeam?.id) {
      teamIds.add(g.awayTeam.id);
      teamMap[g.awayTeam.id] = g.awayTeam.abbreviation;
    }
  });

  const BATCH = 4;
  const ids = Array.from(teamIds);
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    await Promise.all(batch.map(async (teamId) => {
      try {
        const data = await fetchTeamRoster(teamId, sport);
        if (!data) return;

        const abbr = teamMap[teamId];
        const athletes = data.athletes?.flatMap(g => g.items || []) || [];
        const rosterNames = new Set();

        athletes.forEach(a => {
          const name = a.displayName || a.fullName;
          if (!name) return;
          rosterNames.add(name);

          const injuries = a.injuries || [];
          const injuryStatus = injuries[0]?.status || a.status || 'Active';
          setInjuryCache(sport, abbr, name, injuryStatus);
        });

        ROSTER_CACHE[`${sport}:${abbr}`] = {
          playerNames: rosterNames,
          updatedAt: Date.now(),
          teamId,
        };
      } catch (err) {
        console.warn(`[Gamenight] Roster fetch error for team ${teamId}:`, err);
      }
    }));
  }
};

// ============================================================
// STAR MATCHUP BUILDER
// ============================================================

const getAvailableStars = (teamAbbr, sport, rosterCtx = {}) => {
  const { mvp, allStar } = getStarTiers(sport);
  const teamStars = getPlayersForTeam(teamAbbr, sport);
  const allCandidates = [...new Set([...teamStars, ...mvp, ...allStar])];

  const rosterKey = `${sport}:${teamAbbr}`;
  const rosterData = ROSTER_CACHE[rosterKey];
  const onRoster = rosterData?.playerNames || new Set();

  return allCandidates.filter(name => {
    // Must be associated with this team
    if (!teamStars.includes(name)) {
      // Check if on roster from cache
      if (onRoster.size > 0 && !onRoster.has(name)) return false;
    }
    const { available } = isPlayerAvailable(name, teamAbbr, sport, rosterCtx);
    return available;
  });
};

const getInjuredStars = (teamAbbr, sport) => {
  const teamStars = getPlayersForTeam(teamAbbr, sport);
  const { mvp, allStar } = getStarTiers(sport);
  const allCandidates = [...new Set([...teamStars, ...mvp, ...allStar])];

  return allCandidates
    .filter(name => {
      if (!teamStars.includes(name)) return false;
      const cached = getInjuryCache(sport, teamAbbr, name);
      return cached && isUnavailableStatus(cached.status);
    })
    .map(name => {
      const cached = getInjuryCache(sport, teamAbbr, name);
      return { name, status: cached?.status || 'Out', tier: getPlayerTier(name, sport) };
    });
};

const buildStarMatchup = (game) => {
  const { sport } = game;
  const homeAbbr = game.homeTeam.abbreviation;
  const awayAbbr = game.awayTeam.abbreviation;

  const homeStars = getAvailableStars(homeAbbr, sport);
  const awayStars = getAvailableStars(awayAbbr, sport);
  const homeInjured = getInjuredStars(homeAbbr, sport);
  const awayInjured = getInjuredStars(awayAbbr, sport);

  const homeBest = homeStars[0] || null;
  const awayBest = awayStars[0] || null;

  let matchupText = '';
  if (homeBest && awayBest) {
    matchupText = `${awayBest} vs ${homeBest}`;
  } else if (homeBest) {
    matchupText = `${homeBest} leads ${game.homeTeam.shortName}`;
  } else if (awayBest) {
    matchupText = `${awayBest} leads ${game.awayTeam.shortName}`;
  }

  return {
    homeStars,
    awayStars,
    homeInjured,
    awayInjured,
    matchupText,
    homeBest,
    awayBest,
  };
};

// ============================================================
// WATCHABILITY ALGORITHM
// ============================================================

const getRivalryBonus = (team1Abbr, team2Abbr, sport) => {
  const rivalries = RIVALRIES[sport] || [];
  const match = rivalries.find(r =>
    (r.teams.includes(team1Abbr) && r.teams.includes(team2Abbr))
  );
  return match ? { bonus: match.bonus, intensity: match.intensity } : { bonus: 0, intensity: null };
};

const calculateWatchability = (game) => {
  if (!game) return 0;
  const { sport } = game;
  let score = 50;

  // Star Power (up to +30)
  const matchup = buildStarMatchup(game);
  const homeTopTier = matchup.homeStars.filter(n => getPlayerTier(n, sport) === 'mvp');
  const awayTopTier = matchup.awayStars.filter(n => getPlayerTier(n, sport) === 'mvp');
  const homeAllStars = matchup.homeStars.filter(n => getPlayerTier(n, sport) === 'allstar');
  const awayAllStars = matchup.awayStars.filter(n => getPlayerTier(n, sport) === 'allstar');

  if (homeTopTier.length > 0 && awayTopTier.length > 0) {
    score += 30; // MVP vs MVP
  } else if ((homeTopTier.length > 0 && awayAllStars.length > 0) ||
             (awayTopTier.length > 0 && homeAllStars.length > 0)) {
    score += 20; // MVP vs All-Star
  } else if (homeTopTier.length > 0 || awayTopTier.length > 0) {
    score += 15; // Single MVP
  } else if (homeAllStars.length > 0 && awayAllStars.length > 0) {
    score += 10; // All-Star matchup
  } else if (homeAllStars.length > 0 || awayAllStars.length > 0) {
    score += 5;
  }

  // Rivalry bonus (+5 to +15)
  const rivalry = getRivalryBonus(
    game.homeTeam.abbreviation,
    game.awayTeam.abbreviation,
    sport
  );
  score += rivalry.bonus;

  // Broadcast bonus (nationally televised)
  if (game.broadcast) {
    const bc = game.broadcast.toUpperCase();
    if (bc.includes('ESPN') || bc.includes('TNT') || bc.includes('ABC') ||
        bc.includes('FOX') || bc.includes('NBC') || bc.includes('CBS')) {
      score += 3;
    }
  }

  // Headline / playoff context
  if (game.headline) {
    score += 5;
  }

  // Injury penalty
  const totalInjuredStars = (matchup.homeInjured?.length || 0) + (matchup.awayInjured?.length || 0);
  score -= totalInjuredStars * 3;

  return Math.min(100, Math.max(0, Math.round(score)));
};

const getWatchabilityTier = (score) => {
  if (score >= 85) return { label: 'Must Watch', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', ring: 'ring-yellow-400/20' };
  if (score >= 70) return { label: 'Great Game', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', ring: 'ring-emerald-400/20' };
  if (score >= 55) return { label: 'Solid Matchup', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30', ring: 'ring-blue-400/20' };
  return { label: 'Casual Watch', color: 'text-gray-400', bg: 'bg-white/5', border: 'border-white/10', ring: 'ring-white/5' };
};

const rankGames = (games) => {
  if (!games?.length) return [];
  return [...games].sort((a, b) => {
    const sa = a.watchScore || 0;
    const sb = b.watchScore || 0;
    if (sb !== sa) return sb - sa;
    return new Date(a.startTime || 0) - new Date(b.startTime || 0);
  });
};

// ============================================================
// LOCAL STORAGE CACHE (for API responses)
// ============================================================

const CACHE_PREFIX = 'gn2_';

const getCached = (key) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
};

const setCache = (key, data) => {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
};

// ============================================================
// SVG ICONS (inline to stay single-file)
// ============================================================

const Icons = {
  Star: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={props.className || 'w-4 h-4'}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  ),
  Clock: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  TV: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>
    </svg>
  ),
  ChevronRight: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  X: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-5 h-5'}>
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  AlertCircle: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  Trophy: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={props.className || 'w-5 h-5'}>
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6m12 5h1.5a2.5 2.5 0 000-5H18M9 22h6m-3-4v4M7 2h10v9a5 5 0 01-10 0V2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Refresh: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
    </svg>
  ),
  ArrowLeft: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-5 h-5'}>
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  Users: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  Zap: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={props.className || 'w-4 h-4'}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Heart: (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className || 'w-4 h-4'}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  ),
};

// ============================================================
// UI COMPONENTS
// ============================================================

const WatchabilityBadge = ({ score }) => {
  const tier = getWatchabilityTier(score);
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${tier.bg} ${tier.color} border ${tier.border}`}>
      {score >= 85 && <Icons.Zap className="w-3 h-3" />}
      {tier.label}
      <span className="opacity-60">{score}</span>
    </div>
  );
};

const Spinner = ({ size = 'md' }) => {
  const s = size === 'sm' ? 'w-4 h-4 border' : size === 'lg' ? 'w-8 h-8 border-2' : 'w-5 h-5 border-2';
  return <div className={`${s} border-white/20 border-t-white rounded-full animate-spin`} />;
};

const IMG_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect fill='%231a1a2e' width='40' height='40' rx='20'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='%23555' font-size='12' font-family='system-ui'%3E%3F%3C/text%3E%3C/svg%3E";

const handleImgError = (e) => {
  e.target.onerror = null;
  e.target.src = IMG_FALLBACK;
};

const TeamLogo = ({ team, size = 'md' }) => {
  const sizes = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-14 h-14', xl: 'w-20 h-20' };
  const sz = sizes[size] || sizes.md;

  if (team?.logo) {
    return (
      <img
        src={team.logo}
        alt={team?.abbreviation || ''}
        loading="lazy"
        onError={handleImgError}
        className={`${sz} object-contain`}
      />
    );
  }
  return (
    <div className={`${sz} rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-gray-400`}>
      {team?.abbreviation || '?'}
    </div>
  );
};

const LiveBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-red-500/20 text-red-400 rounded-full text-[10px] font-bold uppercase tracking-wider">
    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-livePulse" />
    Live
  </span>
);

const SkeletonCard = () => (
  <div className="bg-white/[0.03] rounded-2xl border border-white/5 p-4 space-y-3">
    <div className="flex justify-between items-center">
      <div className="skeleton h-6 w-28 rounded-full" />
      <div className="skeleton h-4 w-16 rounded-lg" />
    </div>
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-3 flex-1">
        <div className="skeleton w-10 h-10 rounded-full" />
        <div className="space-y-1.5">
          <div className="skeleton h-4 w-20 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>
      </div>
      <div className="skeleton h-5 w-8 rounded mx-3" />
      <div className="flex items-center gap-3 flex-1 justify-end">
        <div className="space-y-1.5 flex flex-col items-end">
          <div className="skeleton h-4 w-20 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>
        <div className="skeleton w-10 h-10 rounded-full" />
      </div>
    </div>
    <div className="skeleton h-3 w-36 rounded mx-auto" />
    <div className="flex justify-between pt-1 border-t border-white/5">
      <div className="skeleton h-3 w-16 rounded" />
      <div className="skeleton h-3 w-20 rounded" />
    </div>
  </div>
);

const SkeletonRosterRow = () => (
  <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
    <div className="skeleton w-8 h-8 rounded-full" />
    <div className="flex-1 space-y-1.5">
      <div className="skeleton h-3.5 w-28 rounded" />
      <div className="skeleton h-2.5 w-16 rounded" />
    </div>
    <div className="skeleton h-3 w-12 rounded" />
  </div>
);

// ============================================================
// GAME CARD
// ============================================================

const GameCard = ({ game, matchup, onClick, isFeatured }) => {
  const tier = getWatchabilityTier(game.watchScore);
  const rivalry = getRivalryBonus(game.homeTeam.abbreviation, game.awayTeam.abbreviation, game.sport);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border transition-all duration-200 hover:border-white/15 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
        isFeatured
          ? 'bg-gradient-to-br from-yellow-400/10 via-amber-500/5 to-transparent border-yellow-400/40 ring-2 ring-yellow-400/20 pulse-glow shadow-lg shadow-yellow-400/5'
          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
      }`}
    >
      {isFeatured && (
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-0">
          <div className="w-7 h-7 rounded-lg bg-yellow-400/15 flex items-center justify-center">
            <Icons.Trophy className="w-4 h-4 text-yellow-400" />
          </div>
          <div>
            <span className="text-xs font-extrabold text-yellow-400 uppercase tracking-widest">Tonight's Pick</span>
            <span className="block text-[10px] text-yellow-400/50 font-medium">Top rated matchup</span>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Top row: badge + time/status */}
        <div className="flex items-center justify-between">
          <WatchabilityBadge score={game.watchScore} />
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {game.isLive ? (
              <LiveBadge />
            ) : game.isFinal ? (
              <span className="text-gray-500 font-medium">Final</span>
            ) : (
              <>
                <Icons.Clock className="w-3 h-3" />
                <span>{formatGameTime(game.startTime)}</span>
              </>
            )}
          </div>
        </div>

        {/* Teams row */}
        <div className="flex items-center justify-between">
          {/* Away team */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <TeamLogo team={game.awayTeam} />
            <div className="min-w-0">
              <div className="font-semibold text-white text-sm truncate">{game.awayTeam.shortName}</div>
              <div className="text-[11px] text-gray-500">{game.awayTeam.record}</div>
            </div>
          </div>

          {/* Score or VS */}
          <div className="flex-shrink-0 px-3">
            {game.isLive || game.isFinal ? (
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold tabular-nums ${game.isFinal ? 'text-gray-400' : 'text-white'}`}>{game.awayTeam.score || '0'}</span>
                <span className="text-xs text-gray-600">-</span>
                <span className={`text-lg font-bold tabular-nums ${game.isFinal ? 'text-gray-400' : 'text-white'}`}>{game.homeTeam.score || '0'}</span>
              </div>
            ) : (
              <span className="text-xs font-bold text-gray-600 uppercase">vs</span>
            )}
          </div>

          {/* Home team */}
          <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
            <div className="min-w-0 text-right">
              <div className="font-semibold text-white text-sm truncate">{game.homeTeam.shortName}</div>
              <div className="text-[11px] text-gray-500">{game.homeTeam.record}</div>
            </div>
            <TeamLogo team={game.homeTeam} />
          </div>
        </div>

        {/* Star matchup text */}
        {matchup?.matchupText && (
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-yellow-400/80">
            <Icons.Star className="w-3 h-3" />
            <span>{matchup.matchupText}</span>
          </div>
        )}

        {/* Bottom info row */}
        <div className="flex items-center justify-between text-[11px] text-gray-600 pt-1 border-t border-white/5">
          <div className="flex items-center gap-3">
            {game.broadcast && (
              <span className="flex items-center gap-1">
                <Icons.TV className="w-3 h-3" />
                {game.broadcast}
              </span>
            )}
            {rivalry.intensity && (
              <span className="text-orange-400/70">
                {rivalry.intensity === 'historic' ? 'Rivalry' : rivalry.intensity === 'city' ? 'City Rivals' : 'Division'}
              </span>
            )}
          </div>
          {game.odds?.spread && (
            <span>{game.odds.spread}</span>
          )}
        </div>
      </div>
    </button>
  );
};

// ============================================================
// GAME DETAIL MODAL
// ============================================================

const GameDetailModal = ({ game, matchup, onClose, onTeamClick }) => {
  if (!game) return null;
  const tier = getWatchabilityTier(game.watchScore);
  const rivalry = getRivalryBonus(game.homeTeam.abbreviation, game.awayTeam.abbreviation, game.sport);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-backdropFadeIn" />
      <div
        className="relative w-full max-w-lg bg-[#12121a] rounded-t-3xl border-t border-white/10 max-h-[85vh] overflow-y-auto animate-slideUp no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2 bg-[#12121a]">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-8 space-y-6">
          {/* Status bar */}
          <div className="flex items-center justify-between">
            <WatchabilityBadge score={game.watchScore} />
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-gray-400 hover:bg-white/10 active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all duration-150">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>

          {/* Matchup display */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-6">
              <button onClick={() => onTeamClick(game.awayTeam)} className="flex flex-col items-center gap-2 hover:opacity-80 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-xl p-2 transition-all duration-150">
                <TeamLogo team={game.awayTeam} size="xl" />
                <div>
                  <div className="font-bold text-white">{game.awayTeam.shortName}</div>
                  <div className="text-xs text-gray-500">{game.awayTeam.record}</div>
                </div>
              </button>

              <div className="space-y-1">
                {game.isLive || game.isFinal ? (
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-extrabold text-white tabular-nums">{game.awayTeam.score || '0'}</span>
                    <span className="text-gray-600">-</span>
                    <span className="text-3xl font-extrabold text-white tabular-nums">{game.homeTeam.score || '0'}</span>
                  </div>
                ) : (
                  <span className="text-lg font-bold text-gray-600">VS</span>
                )}
                {game.isLive && <LiveBadge />}
                {game.isFinal && <span className="text-xs text-gray-500 font-medium">Final</span>}
              </div>

              <button onClick={() => onTeamClick(game.homeTeam)} className="flex flex-col items-center gap-2 hover:opacity-80 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-xl p-2 transition-all duration-150">
                <TeamLogo team={game.homeTeam} size="xl" />
                <div>
                  <div className="font-bold text-white">{game.homeTeam.shortName}</div>
                  <div className="text-xs text-gray-500">{game.homeTeam.record}</div>
                </div>
              </button>
            </div>

            {/* Star matchup */}
            {matchup?.matchupText && (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-400/5 border border-yellow-400/10">
                <Icons.Star className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-yellow-400">{matchup.matchupText}</span>
              </div>
            )}
          </div>

          {/* Game Info */}
          <div className="grid grid-cols-2 gap-3">
            <InfoTile label="Time" value={game.isLive ? 'LIVE' : game.isFinal ? 'Final' : formatGameTime(game.startTime)} />
            {game.broadcast && <InfoTile label="Watch On" value={game.broadcast} />}
            {game.odds?.spread && <InfoTile label="Spread" value={game.odds.spread} />}
            {game.odds?.overUnder && <InfoTile label="Total" value={game.odds.overUnder} />}
            {rivalry.intensity && <InfoTile label="Rivalry" value={rivalry.intensity.charAt(0).toUpperCase() + rivalry.intensity.slice(1)} />}
            {game.venue && <InfoTile label="Venue" value={game.venue} />}
          </div>

          {/* Star Players Available */}
          {(matchup?.homeStars?.length > 0 || matchup?.awayStars?.length > 0) && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Stars Playing</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-xs text-gray-500 font-medium">{game.awayTeam.shortName}</div>
                  {matchup.awayStars.length > 0 ? matchup.awayStars.map(name => (
                    <StarPlayerRow key={name} name={name} sport={game.sport} />
                  )) : <div className="text-xs text-gray-600">No notable stars</div>}
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-gray-500 font-medium">{game.homeTeam.shortName}</div>
                  {matchup.homeStars.length > 0 ? matchup.homeStars.map(name => (
                    <StarPlayerRow key={name} name={name} sport={game.sport} />
                  )) : <div className="text-xs text-gray-600">No notable stars</div>}
                </div>
              </div>
            </div>
          )}

          {/* Injured Stars */}
          {(matchup?.homeInjured?.length > 0 || matchup?.awayInjured?.length > 0) && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-red-400/80 uppercase tracking-wider flex items-center gap-2">
                <Icons.AlertCircle className="w-3.5 h-3.5" />
                Out Tonight
              </h3>
              <div className="space-y-2">
                {[...(matchup.awayInjured || []).map(p => ({ ...p, team: game.awayTeam.shortName })),
                  ...(matchup.homeInjured || []).map(p => ({ ...p, team: game.homeTeam.shortName }))
                ].map(p => (
                  <div key={p.name} className="flex items-center justify-between px-3 py-2 rounded-xl bg-red-400/5 border border-red-400/10">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{p.name}</span>
                      <span className="text-[10px] text-gray-500">{p.team}</span>
                    </div>
                    <span className="text-[11px] text-red-400 font-medium">{p.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tap teams hint */}
          <div className="text-center text-[11px] text-gray-600">
            Tap a team logo for full roster and details
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoTile = ({ label, value }) => (
  <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5">
    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</div>
    <div className="text-sm font-medium text-white truncate">{value}</div>
  </div>
);

const StarPlayerRow = ({ name, sport }) => {
  const tier = getPlayerTier(name, sport);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03]">
      {tier === 'mvp' && <Icons.Star className="w-3 h-3 text-yellow-400" />}
      {tier === 'allstar' && <Icons.Star className="w-3 h-3 text-blue-400" />}
      <span className="text-xs text-white truncate">{name}</span>
      {tier && (
        <span className={`text-[9px] ml-auto ${tier === 'mvp' ? 'text-yellow-400' : 'text-blue-400'}`}>
          {tier === 'mvp' ? 'MVP' : 'All-Star'}
        </span>
      )}
    </div>
  );
};

// ============================================================
// TEAM DETAIL SHEET
// ============================================================

const TeamDetailSheet = ({ team, sport, onClose }) => {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!team?.id) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const data = await fetchTeamRoster(team.id, sport);
      if (cancelled) return;

      if (data?.athletes) {
        const players = data.athletes.flatMap(group =>
          (group.items || []).map(a => ({
            id: a.id,
            displayName: a.displayName || a.fullName || '',
            position: a.position?.abbreviation || group.position || '',
            jersey: a.jersey || '',
            status: a.injuries?.[0]?.status || a.status || 'Active',
            starter: a.starter || false,
            headshot: a.headshot?.href || null,
            experience: a.experience?.years || 0,
          }))
        );
        setRoster(players);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [team?.id, sport]);

  if (!team) return null;

  const starters = roster.filter(p => p.starter);
  const bench = roster.filter(p => !p.starter);
  const injured = roster.filter(p => isUnavailableStatus(p.status));
  const rosterCtx = buildRosterContext(roster);

  const injuredSorted = [...injured].sort((a, b) => {
    const aEval = evaluateStarSignals(a.displayName, team.abbreviation, sport, rosterCtx);
    const bEval = evaluateStarSignals(b.displayName, team.abbreviation, sport, rosterCtx);
    return bEval.count - aEval.count;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-backdropFadeIn" />
      <div
        className="relative w-full max-w-lg bg-[#12121a] rounded-t-3xl border-t border-white/10 max-h-[90vh] overflow-y-auto animate-slideUp no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2 bg-[#12121a]">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-8 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-4">
            <TeamLogo team={team} size="lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{team.name}</h2>
              <div className="text-sm text-gray-400">{team.record}</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-gray-400 hover:bg-white/10 active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all duration-150">
              <Icons.X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1">
            {['overview', 'roster', 'injuries'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all duration-200 active:scale-95 focus:outline-none ${
                  activeTab === tab ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
                }`}
              >
                {tab} {tab === 'injuries' && injured.length > 0 ? `(${injured.length})` : ''}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonRosterRow key={i} />
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <StatBox label="Record" value={team.record || '-'} />
                    <StatBox label="Players" value={roster.length} />
                    <StatBox label="Injured" value={injured.length} />
                  </div>

                  {/* Key Players */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Key Players</h4>
                    {getPlayersForTeam(team.abbreviation, sport).map(name => {
                      const available = isPlayerAvailable(name, team.abbreviation, sport, rosterCtx);
                      return (
                        <div key={name} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                          <div className="flex items-center gap-2">
                            <Icons.Star className={`w-3.5 h-3.5 ${available.available ? 'text-yellow-400' : 'text-red-400'}`} />
                            <span className="text-sm text-white">{name}</span>
                          </div>
                          <span className={`text-[11px] font-medium ${available.available ? 'text-emerald-400' : 'text-red-400'}`}>
                            {available.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'roster' && (
                <div className="space-y-4">
                  {starters.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Starters</h4>
                      {starters.map(p => <RosterRow key={p.id} player={p} team={team} sport={sport} rosterCtx={rosterCtx} />)}
                    </div>
                  )}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {starters.length > 0 ? 'Bench' : 'Full Roster'}
                    </h4>
                    {bench.map(p => <RosterRow key={p.id} player={p} team={team} sport={sport} rosterCtx={rosterCtx} />)}
                  </div>
                </div>
              )}

              {activeTab === 'injuries' && (
                <div className="space-y-2">
                  {injuredSorted.length === 0 ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-4 rounded-xl text-sm text-center font-medium">
                      No injuries reported - full squad available
                    </div>
                  ) : (
                    injuredSorted.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-400/5 border border-red-400/10">
                        <div className="flex items-center gap-3">
                          {p.headshot ? (
                            <img src={p.headshot} alt="" loading="lazy" onError={handleImgError} className="w-8 h-8 rounded-full object-cover bg-white/5" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[10px] text-gray-500">
                              {p.jersey || '?'}
                            </div>
                          )}
                          <div>
                            <div className="text-sm text-white font-medium">{p.displayName}</div>
                            <div className="text-[11px] text-gray-500">{p.position} #{p.jersey}</div>
                          </div>
                        </div>
                        <span className="text-[11px] text-red-400 font-semibold">{p.status}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const RosterRow = ({ player, team, sport, rosterCtx }) => {
  const starEval = evaluateStarSignals(player.displayName, team.abbreviation, sport, rosterCtx);
  const isOut = isUnavailableStatus(player.status);

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-xl border ${
      isOut ? 'bg-red-400/5 border-red-400/10' : 'bg-white/[0.02] border-white/5'
    }`}>
      <div className="flex items-center gap-3">
        {player.headshot ? (
          <img src={player.headshot} alt="" loading="lazy" onError={handleImgError} className="w-8 h-8 rounded-full object-cover bg-white/5" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[10px] text-gray-500 font-bold">
            {player.jersey || '?'}
          </div>
        )}
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-medium ${isOut ? 'text-gray-500 line-through' : 'text-white'}`}>
              {player.displayName}
            </span>
            {starEval.isNotableStar && <Icons.Star className="w-3 h-3 text-yellow-400" />}
            {starEval.isEmerging && <Icons.Star className="w-3 h-3 text-blue-400/50" />}
          </div>
          <div className="text-[11px] text-gray-500">{player.position} #{player.jersey}</div>
        </div>
      </div>
      <div className="text-right">
        {isOut ? (
          <span className="text-[11px] text-red-400 font-medium">{player.status}</span>
        ) : player.starter ? (
          <span className="text-[11px] text-emerald-400 font-medium">Starter</span>
        ) : (
          <span className="text-[11px] text-gray-600">{player.status}</span>
        )}
      </div>
    </div>
  );
};

const StatBox = ({ label, value }) => (
  <div className="px-3 py-3 rounded-xl bg-white/[0.03] border border-white/5 text-center">
    <div className="text-lg font-bold text-white">{value}</div>
    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
  </div>
);

// ============================================================
// EMPTY STATES
// ============================================================

const EmptyState = ({ message, sub }) => (
  <div className="text-center py-16 space-y-3">
    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto text-2xl text-gray-600">
      <Icons.TV className="w-8 h-8" />
    </div>
    <div className="text-gray-400 font-medium">{message}</div>
    {sub && <div className="text-sm text-gray-600">{sub}</div>}
  </div>
);

// ============================================================
// MAIN APP COMPONENT
// ============================================================

export default function GamenightApp() {
  const [activeSport, setActiveSport] = useState('nba');
  const [activeDate, setActiveDate] = useState('today');
  const [games, setGames] = useState([]);
  const [matchups, setMatchups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const fetchRef = useRef(0);

  // Online/offline detection
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Compute date string for active tab
  const getDateStr = useCallback(() => {
    if (activeDate === 'today') return getTodayDateET();
    if (activeDate === 'tomorrow') return getDateStringET(1);
    return getDateStringET(2); // "upcoming" shows day after tomorrow
  }, [activeDate]);

  // Main data fetcher
  const loadGames = useCallback(async (showLoader = true) => {
    const fetchId = ++fetchRef.current;
    if (showLoader) setLoading(true);
    setError(null);

    try {
      const dateStr = getDateStr();
      const cacheKeyStr = `${activeSport}_${dateStr}`;

      // Check localStorage cache
      const cached = getCached(cacheKeyStr);
      if (cached && showLoader) {
        processGames(cached, activeSport, fetchId);
        setLoading(false);
        // Still fetch fresh in background
        fetchFresh(cacheKeyStr, dateStr, activeSport, fetchId, false);
        return;
      }

      await fetchFresh(cacheKeyStr, dateStr, activeSport, fetchId, true);
    } catch (err) {
      if (fetchRef.current === fetchId) {
        console.error('[Gamenight] Load error:', err);
        setError('Failed to load games. Pull down to retry.');
        setLoading(false);
      }
    }
  }, [activeSport, getDateStr]);

  const fetchFresh = async (cacheKeyStr, dateStr, sport, fetchId, setLoadingState) => {
    const data = await fetchScoreboard(sport, dateStr);
    if (fetchRef.current !== fetchId) return;

    if (!data?.events?.length) {
      setGames([]);
      setMatchups({});
      setLoading(false);
      setLastUpdated(new Date());
      return;
    }

    setCache(cacheKeyStr, data);
    await processGames(data, sport, fetchId);
    if (setLoadingState) setLoading(false);
  };

  const processGames = async (data, sport, fetchId) => {
    if (!data?.events) return;

    // Transform ESPN events
    let transformed = data.events
      .map(e => transformESPNEvent(e, sport))
      .filter(Boolean);

    // Prefetch injuries
    await prefetchInjuries(transformed, sport);
    if (fetchRef.current !== fetchId) return;

    // Calculate watchability and build matchups
    const matchupMap = {};
    transformed = transformed.map(g => {
      const matchup = buildStarMatchup(g);
      matchupMap[g.id] = matchup;
      return { ...g, watchScore: calculateWatchability(g) };
    });

    // Rank by watchability
    const ranked = rankGames(transformed);

    setGames(ranked);
    setMatchups(matchupMap);
    setLastUpdated(new Date());
  };

  // Load on sport/date change
  useEffect(() => {
    loadGames(true);
  }, [loadGames]);

  // Auto-refresh every 3 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      loadGames(false);
    }, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadGames]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadGames(false);
    setRefreshing(false);
  };

  // Today's pick = highest-scoring watchable game from "today"
  const todaysPick = activeDate === 'today'
    ? games.find(g => isGameWatchable(g.status))
    : null;

  const sports = Object.entries(SPORT_CONFIG);
  const dateTabs = [
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tomorrow' },
    { key: 'upcoming', label: formatDateHeading(getDateStringET(2)).split(',')[0] || 'Upcoming' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/90 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-extrabold tracking-tight">Gamenight</span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 text-gray-400 hover:bg-white/10 active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {refreshing ? <Spinner size="sm" /> : <Icons.Refresh className="w-4 h-4" />}
            </button>
          </div>

          {/* Sport Tabs */}
          <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 mb-3">
            {sports.map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setActiveSport(key)}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  activeSport === key
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
                }`}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Date Tabs */}
          <div className="flex gap-1">
            {dateTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveDate(tab.key)}
                className={`flex-1 py-2 rounded-lg text-[11px] font-semibold transition-all duration-200 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  activeDate === tab.key
                    ? 'bg-white/10 text-white'
                    : 'text-gray-600 hover:text-gray-400 hover:bg-white/[0.02]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-400 px-4 py-2 text-center text-xs font-medium animate-slideDown">
          You're offline - showing cached data
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-lg mx-auto px-4 py-4 pb-20 space-y-3">
        {/* Date heading */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400">
            {formatDateHeading(getDateStr())}
          </h2>
          {lastUpdated && (
            <span className="text-[10px] text-gray-600">
              Updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="animate-fadeIn">
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center space-y-4">
              <Icons.AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-sm text-gray-400">{error}</p>
              <button
                onClick={() => loadGames(true)}
                className="px-6 py-2.5 bg-white/10 rounded-xl text-sm font-semibold hover:bg-white/15 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all duration-150"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && games.length === 0 && (
          <EmptyState
            message={`No ${SPORT_CONFIG[activeSport].label} games scheduled`}
            sub={`Check back later or try a different date`}
          />
        )}

        {/* Game list */}
        {!loading && !error && games.length > 0 && (
          <div className="space-y-3">
            {games.map((game, idx) => {
              const isFeatured = todaysPick?.id === game.id && idx === 0;
              return (
                <div key={game.id}>
                  <div className="animate-fadeIn" style={{ animationDelay: `${idx * 50}ms` }}>
                    <GameCard
                      game={game}
                      matchup={matchups[game.id]}
                      onClick={() => setSelectedGame(game)}
                      isFeatured={isFeatured}
                    />
                  </div>
                  {/* Separator after featured pick */}
                  {isFeatured && games.length > 1 && (
                    <div className="flex items-center gap-3 mt-4 mb-1">
                      <div className="flex-1 h-px bg-white/5" />
                      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">More Games</span>
                      <div className="flex-1 h-px bg-white/5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Game count */}
        {!loading && games.length > 0 && (
          <div className="text-center text-[11px] text-gray-600 pt-2">
            {games.length} game{games.length !== 1 ? 's' : ''} {activeDate === 'today' ? 'today' : 'scheduled'}
          </div>
        )}
      </main>

      {/* Game Detail Modal */}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          matchup={matchups[selectedGame.id]}
          onClose={() => setSelectedGame(null)}
          onTeamClick={(team) => {
            setSelectedGame(null);
            setSelectedTeam({ ...team, sport: activeSport });
          }}
        />
      )}

      {/* Team Detail Sheet */}
      {selectedTeam && (
        <TeamDetailSheet
          team={selectedTeam}
          sport={selectedTeam.sport || activeSport}
          onClose={() => setSelectedTeam(null)}
        />
      )}
    </div>
  );
}
